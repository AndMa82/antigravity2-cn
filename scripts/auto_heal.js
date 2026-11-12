#!/usr/bin/env node
"use strict";

/**
 * scripts/auto_heal.js
 * 官方更新后自动重汉化双方案统一引擎：
 * - 跨进程原子锁 (~/.antigravity-hanhua/patch.lock，支持僵尸锁自动回收)
 * - 无全局 Node 自举能力 (降级使用内置 Electron + ELECTRON_RUN_AS_NODE=1，macOS 走 Helper.app 零 Dock 弹跳)
 * - 方案 A (--create-launcher / --remove-launcher): 零后台驻留智能自愈启动器 (<5ms 探针, <120ms ASAR 重注)
 * - 方案 B (--install-guard / --uninstall-guard / --guard-status): 系统级空闲态静默守护 (LaunchAgent / 无句柄 statSync 轮询)
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const child_process = require("child_process");
const { isAsarLocalizedFast } = require("./asar_patcher");

const ROOT_DIR = path.resolve(__dirname, "..");
const ENGINE_SCRIPT = path.join(ROOT_DIR, "localization_engine.js");
const EXT_HOOK_END = "/* --- ANTIGRAVITY HANHUA PROXY END --- */";
const LAUNCH_AGENT_LABEL = "com.antigravity.hanhua.guard";
const WIN_TASK_NAME = "AntigravityHanhuaGuard";

function resolveRealUserAndHome() {
    if (process.env.AG_HOME_OVERRIDE) {
        return {
            user: process.env.USER || "sandbox",
            uid: typeof process.getuid === "function" ? process.getuid() : 0,
            home: path.resolve(process.env.AG_HOME_OVERRIDE)
        };
    }
    if (process.platform === "darwin" && process.env.SUDO_USER && process.env.SUDO_USER !== "root") {
        const sudoHome = path.join("/Users", process.env.SUDO_USER);
        let sudoUid = typeof process.getuid === "function" ? process.getuid() : 501;
        try {
            const out = child_process.execSync(`id -u "${process.env.SUDO_USER}"`, { encoding: "utf8" }).trim();
            if (/^\d+$/.test(out)) sudoUid = Number(out);
        } catch (_) {}
        if (fs.existsSync(sudoHome)) {
            return { user: process.env.SUDO_USER, uid: sudoUid, home: sudoHome };
        }
    }
    return {
        user: process.env.USER || process.env.USERNAME || "user",
        uid: typeof process.getuid === "function" ? process.getuid() : 501,
        home: os.homedir()
    };
}

function getStatePaths() {
    const { user, uid, home } = resolveRealUserAndHome();
    const stateDir = process.env.AG_STATE_DIR_OVERRIDE
        ? path.resolve(process.env.AG_STATE_DIR_OVERRIDE)
        : path.join(home, ".antigravity-hanhua");
    return {
        user,
        uid,
        home,
        stateDir,
        lockPath: path.join(stateDir, "patch.lock"),
        pendingFlagPath: path.join(stateDir, "pending_patch.flag"),
        configPath: path.join(stateDir, "config.json"),
        uiStatePath: path.join(stateDir, "ui_state.json"),
        guardLogPath: path.join(stateDir, "guard.log"),
        guardPidPath: path.join(stateDir, "guard.pid"),
        watchSnapshotPath: path.join(stateDir, "watch_snapshot.json"),
        plistPath: process.env.AG_PLIST_PATH_OVERRIDE
            ? path.resolve(process.env.AG_PLIST_PATH_OVERRIDE)
            : path.join(home, "Library", "LaunchAgents", `${LAUNCH_AGENT_LABEL}.plist`),
        macLauncherDir: process.env.AG_LAUNCHER_DIR_OVERRIDE
            ? path.resolve(process.env.AG_LAUNCHER_DIR_OVERRIDE)
            : path.join(home, "Applications"),
        winLauncherDir: process.env.AG_LAUNCHER_DIR_OVERRIDE
            ? path.resolve(process.env.AG_LAUNCHER_DIR_OVERRIDE)
            : path.join(process.env.LOCALAPPDATA || path.join(home, "AppData", "Local"), "AntigravityHanhua")
    };
}

function appendGuardLog(msg) {
    try {
        const { stateDir, guardLogPath } = getStatePaths();
        fs.mkdirSync(stateDir, { recursive: true });
        const line = `[${new Date().toISOString()}] [pid:${process.pid}] ${msg}\n`;
        if (fs.existsSync(guardLogPath)) {
            const st = fs.statSync(guardLogPath);
            if (st.size > 128 * 1024) {
                const tail = fs.readFileSync(guardLogPath, "utf8").slice(-64 * 1024);
                fs.writeFileSync(guardLogPath, tail + line, "utf8");
                return;
            }
        }
        fs.appendFileSync(guardLogPath, line, "utf8");
    } catch (_) {}
}

// ==========================================
// 1. 跨进程原子互斥锁 (patch.lock + 僵尸锁回收)
// ==========================================
function isPidAlive(pid) {
    const numPid = Number(pid);
    if (!Number.isInteger(numPid) || numPid <= 0) return false;
    if (numPid === process.pid) return true;
    try {
        process.kill(numPid, 0);
        return true;
    } catch (err) {
        if (err && err.code === "EPERM") {
            return true; // 进程存活但属于其他用户（如 sudo/root）
        }
        return false; // ESRCH: 进程已不存在（僵尸锁）
    }
}

function acquirePatchLock(holder = "auto_heal") {
    const { stateDir, lockPath } = getStatePaths();
    fs.mkdirSync(stateDir, { recursive: true });

    const payload = JSON.stringify({
        pid: process.pid,
        holder,
        startedAt: Date.now(),
        isoTime: new Date().toISOString()
    });

    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const fd = fs.openSync(lockPath, "wx", 0o644);
            try {
                fs.writeFileSync(fd, payload, "utf8");
            } finally {
                fs.closeSync(fd);
            }
            return {
                acquired: true,
                lockPath,
                release() {
                    try {
                        if (fs.existsSync(lockPath)) {
                            const cur = JSON.parse(fs.readFileSync(lockPath, "utf8"));
                            if (cur.pid === process.pid) {
                                fs.unlinkSync(lockPath);
                            }
                        }
                    } catch (_) {}
                }
            };
        } catch (err) {
            if (!err || err.code !== "EEXIST") {
                throw err;
            }
            // 检查锁持有进程是否仍存活
            try {
                const raw = fs.readFileSync(lockPath, "utf8");
                const info = JSON.parse(raw);
                if (info && isPidAlive(info.pid)) {
                    return {
                        acquired: false,
                        holderPid: info.pid,
                        holder: info.holder || "unknown"
                    };
                }
                // 持有者已退出 -> 自动回收僵尸锁并重试一次
                fs.unlinkSync(lockPath);
                appendGuardLog(`Reclaimed stale patch.lock from dead pid ${info && info.pid}`);
            } catch (_) {
                try { fs.unlinkSync(lockPath); } catch (_e) {}
            }
        }
    }

    return { acquired: false, holderPid: null, holder: "contended" };
}

function withPatchLock(holder, fn) {
    const lock = acquirePatchLock(holder);
    if (!lock.acquired) {
        return { skipped: true, reason: "locked", holderPid: lock.holderPid };
    }
    try {
        const result = fn();
        return { skipped: false, result };
    } finally {
        lock.release();
    }
}

// ==========================================
// 2. 无全局 Node 自举解析器 (支持 ELECTRON_RUN_AS_NODE=1)
// ==========================================
function resolveJsRunner(candidateInstallations = []) {
    const { home } = resolveRealUserAndHome();

    // 若当前并非在 Electron 内运行，当前 process.execPath 即原生 Node
    if (!process.versions.electron && fs.existsSync(process.execPath)) {
        return { bin: process.execPath, env: {}, isElectronFallback: false };
    }

    const candidateNodes = [];
    if (process.platform === "win32") {
        const pf = process.env.ProgramFiles || "C:\\Program Files";
        const pf86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
        const localApp = process.env.LOCALAPPDATA || path.join(home, "AppData", "Local");
        candidateNodes.push(
            path.join(pf, "nodejs", "node.exe"),
            path.join(pf86, "nodejs", "node.exe"),
            path.join(localApp, "Programs", "nodejs", "node.exe"),
            path.join(home, ".volta", "bin", "node.exe")
        );
    } else {
        candidateNodes.push(
            "/opt/homebrew/bin/node",
            "/usr/local/bin/node",
            "/opt/local/bin/node",
            path.join(home, ".volta", "bin", "node"),
            path.join(home, ".asdf", "shims", "node"),
            path.join(home, ".local", "share", "mise", "shims", "node"),
            path.join(home, ".fnm", "current", "bin", "node")
        );
        const nvmDir = path.join(home, ".nvm", "versions", "node");
        if (fs.existsSync(nvmDir)) {
            try {
                const vers = fs.readdirSync(nvmDir).sort().reverse();
                for (const v of vers) {
                    candidateNodes.push(path.join(nvmDir, v, "bin", "node"));
                }
            } catch (_) {}
        }
    }

    for (const n of candidateNodes) {
        if (n && fs.existsSync(n)) {
            return { bin: n, env: {}, isElectronFallback: false };
        }
    }

    // 降级使用客户端内置 Electron 二进制 + ELECTRON_RUN_AS_NODE=1
    const searchApps = [...candidateInstallations];
    if (process.platform === "darwin") {
        searchApps.push("/Applications/Antigravity.app", "/Applications/Antigravity IDE.app");
    } else if (process.platform === "win32") {
        const localApp = process.env.LOCALAPPDATA || path.join(home, "AppData", "Local");
        searchApps.push(
            path.join(localApp, "Programs", "antigravity"),
            path.join(localApp, "Programs", "Antigravity IDE"),
            "C:\\Program Files\\Antigravity",
            "C:\\Program Files\\Antigravity IDE"
        );
    }

    for (const appDir of searchApps) {
        if (!appDir || !fs.existsSync(appDir)) continue;
        if (process.platform === "darwin") {
            const helpers = [
                path.join(appDir, "Contents", "Frameworks", "Antigravity Helper.app", "Contents", "MacOS", "Antigravity Helper"),
                path.join(appDir, "Contents", "Frameworks", "Antigravity IDE Helper.app", "Contents", "MacOS", "Antigravity IDE Helper"),
                path.join(appDir, "Contents", "MacOS", "Antigravity"),
                path.join(appDir, "Contents", "MacOS", "Antigravity IDE")
            ];
            for (const h of helpers) {
                if (fs.existsSync(h)) {
                    return { bin: h, env: { ELECTRON_RUN_AS_NODE: "1" }, isElectronFallback: true };
                }
            }
        } else if (process.platform === "win32") {
            const exes = [
                path.join(appDir, "Antigravity.exe"),
                path.join(appDir, "Antigravity IDE.exe")
            ];
            for (const exe of exes) {
                if (fs.existsSync(exe)) {
                    return { bin: exe, env: { ELECTRON_RUN_AS_NODE: "1" }, isElectronFallback: true };
                }
            }
        }
    }

    return { bin: process.execPath, env: {}, isElectronFallback: Boolean(process.versions.electron) };
}

// ==========================================
// 3. 极速签名探针 (<5ms 全目标状态检测)
// ==========================================
function hasTailSignatureFast(filePath, signature, windowBytes = 24576) {
    if (!filePath || !fs.existsSync(filePath)) return false;
    let fd = null;
    try {
        const st = fs.statSync(filePath);
        if (!st.isFile() || st.size <= 0) return false;
        fd = fs.openSync(filePath, "r");
        const readLen = Math.min(st.size, windowBytes);
        const buf = Buffer.allocUnsafe(readLen);
        fs.readSync(fd, buf, 0, readLen, st.size - readLen);
        return buf.indexOf(Buffer.from(signature, "utf8")) !== -1;
    } catch (_) {
        return false;
    } finally {
        if (fd !== null) {
            try { fs.closeSync(fd); } catch (_) {}
        }
    }
}

function discoverExternalExtensionDirs(extraSearchParents = []) {
    const { home } = resolveRealUserAndHome();
    const parents = [...extraSearchParents];
    if (process.env.AG_EXT_SEARCH_DIRS) {
        for (const p of process.env.AG_EXT_SEARCH_DIRS.split(path.delimiter)) {
            if (p.trim()) parents.push(path.resolve(p.trim()));
        }
    }
    if (!process.env.AG_ONLY_EXPLICIT_TARGETS) {
        parents.push(
            path.join(home, ".antigravity-ide", "extensions"),
            path.join(home, ".vscode", "extensions"),
            path.join(home, ".vscode-insiders", "extensions"),
            path.join(home, ".cursor", "extensions"),
            path.join(home, ".windsurf", "extensions"),
            path.join(home, ".vscode-oss", "extensions")
        );
    }

    const found = [];
    const seen = new Set();
    for (const parent of parents) {
        if (!parent || !fs.existsSync(parent)) continue;
        // 若直接传入的就是单个扩展目录
        if (fs.existsSync(path.join(parent, "package.json")) && fs.existsSync(path.join(parent, "vscode", "extension.js"))) {
            const real = path.resolve(parent);
            if (!seen.has(real)) {
                seen.add(real);
                found.push(real);
            }
            continue;
        }
        try {
            const entries = fs.readdirSync(parent, { withFileTypes: true });
            for (const ent of entries) {
                if (!ent.isDirectory()) continue;
                const lower = ent.name.toLowerCase();
                if (lower.startsWith("google.google-antigravity") || lower === "agy") {
                    const extDir = path.resolve(path.join(parent, ent.name));
                    if (
                        !seen.has(extDir) &&
                        fs.existsSync(path.join(extDir, "package.json")) &&
                        fs.existsSync(path.join(extDir, "vscode", "extension.js"))
                    ) {
                        seen.add(extDir);
                        found.push(extDir);
                    }
                }
            }
        } catch (_) {}
    }
    return found;
}

function discoverClientAndIdeDirs(manualDirs = []) {
    if (manualDirs && manualDirs.length > 0) {
        return manualDirs.map(d => path.resolve(d)).filter(d => fs.existsSync(d));
    }
    if (process.env.AG_INSTALL_DIRS_OVERRIDE) {
        return process.env.AG_INSTALL_DIRS_OVERRIDE
            .split(path.delimiter)
            .map(s => s.trim())
            .filter(Boolean)
            .map(d => path.resolve(d))
            .filter(d => fs.existsSync(d));
    }
    if (process.env.AG_ONLY_EXPLICIT_TARGETS) {
        return [];
    }

    const { home } = resolveRealUserAndHome();
    const candidates = [];
    if (process.platform === "darwin") {
        candidates.push(
            "/Applications/Antigravity.app",
            path.join(home, "Applications", "Antigravity.app"),
            "/Applications/Antigravity IDE.app",
            path.join(home, "Applications", "Antigravity IDE.app")
        );
    } else if (process.platform === "win32") {
        const localApp = process.env.LOCALAPPDATA || path.join(home, "AppData", "Local");
        candidates.push(
            process.env.ANTIGRAVITY_INSTALL_DIR,
            path.join(localApp, "Programs", "antigravity"),
            path.join(localApp, "Programs", "Antigravity IDE"),
            "C:\\Program Files\\Antigravity",
            "C:\\Program Files\\Antigravity IDE",
            "D:\\Programs\\Antigravity",
            "D:\\Programs\\Antigravity IDE"
        );
    }

    const found = [];
    const seen = new Set();
    for (const c of candidates) {
        if (!c || !fs.existsSync(c)) continue;
        const resolved = path.resolve(c);
        const k = resolved.toLowerCase();
        if (seen.has(k)) continue;
        const hasAsar =
            fs.existsSync(path.join(resolved, "Contents", "Resources", "app.asar")) ||
            fs.existsSync(path.join(resolved, "resources", "app.asar")) ||
            fs.existsSync(path.join(resolved, "app.asar"));
        const hasIdeApp =
            fs.existsSync(path.join(resolved, "Contents", "Resources", "app", "product.json")) ||
            fs.existsSync(path.join(resolved, "resources", "app", "product.json")) ||
            fs.existsSync(path.join(resolved, "app", "product.json"));
        if (hasAsar || hasIdeApp) {
            seen.add(k);
            found.push(resolved);
        }
    }
    return found;
}

function readTargetVersion(targetDir) {
    try {
        const plistPath = path.join(targetDir, "Contents", "Info.plist");
        if (fs.existsSync(plistPath)) {
            const s = fs.readFileSync(plistPath, "utf8");
            const m = s.match(/<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/);
            if (m) return m[1].trim();
        }
        const pkgCandidates = [
            path.join(targetDir, "package.json"),
            path.join(targetDir, "Contents", "Resources", "app", "package.json"),
            path.join(targetDir, "resources", "app", "package.json")
        ];
        for (const p of pkgCandidates) {
            if (fs.existsSync(p)) {
                const pkg = JSON.parse(fs.readFileSync(p, "utf8"));
                if (pkg.version) return String(pkg.version);
            }
        }
    } catch (_) {}
    return "unknown";
}

function probeAppTargetStatus(installDir) {
    const asarCandidates = [
        path.join(installDir, "Contents", "Resources", "app.asar"),
        path.join(installDir, "resources", "app.asar"),
        path.join(installDir, "app.asar")
    ];
    const asarPath = asarCandidates.find(p => fs.existsSync(p));
    if (asarPath) {
        let localized = isAsarLocalizedFast(asarPath);
        let proxyDllOk = true;
        if (process.platform === "win32" && fs.existsSync(path.join(ROOT_DIR, "proxy_config", "version.dll"))) {
            proxyDllOk = fs.existsSync(path.join(installDir, "version.dll"));
        }
        return {
            kind: "desktop-v2",
            path: installDir,
            asarPath,
            version: readTargetVersion(installDir),
            localized: localized && proxyDllOk,
            asarLocalized: localized,
            proxyDllOk
        };
    }

    const appDir = [
        path.join(installDir, "Contents", "Resources", "app"),
        path.join(installDir, "resources", "app"),
        path.join(installDir, "app")
    ].find(p => fs.existsSync(p));

    if (appDir) {
        const wbCandidates = [
            path.join(appDir, "out", "vs", "code", "electron-sandbox", "workbench", "workbench.html"),
            path.join(appDir, "out", "vs", "code", "electron-browser", "workbench", "workbench.html")
        ];
        const wbHtml = wbCandidates.find(p => fs.existsSync(p));
        const extJs = path.join(appDir, "extensions", "agy", "vscode", "extension.js");
        const htmlOk = wbHtml
            ? fs.readFileSync(wbHtml, "utf8").includes("ag_agent_hanhua.js")
            : false;
        const extOk = fs.existsSync(extJs) ? hasTailSignatureFast(extJs, EXT_HOOK_END) : true;
        let proxyDllOk = true;
        if (process.platform === "win32" && fs.existsSync(path.join(ROOT_DIR, "proxy_config", "version.dll"))) {
            proxyDllOk = fs.existsSync(path.join(installDir, "version.dll"));
        }
        return {
            kind: "ide",
            path: installDir,
            appDir,
            version: readTargetVersion(installDir),
            localized: htmlOk && extOk && proxyDllOk,
            htmlOk,
            extOk,
            proxyDllOk
        };
    }

    return {
        kind: "unknown",
        path: installDir,
        version: "unknown",
        localized: false
    };
}

function probeExtensionStatus(extDir) {
    const extJs = path.join(extDir, "vscode", "extension.js");
    const hanhuaJs = path.join(extDir, "vscode", "ag_agent_hanhua.js");
    const nlsJson = path.join(extDir, "package.nls.json");
    const hookOk = hasTailSignatureFast(extJs, EXT_HOOK_END);
    const filesOk = fs.existsSync(hanhuaJs) && fs.existsSync(nlsJson);
    let extJsMtimeMs = 0;
    try {
        extJsMtimeMs = fs.statSync(extJs).mtimeMs;
    } catch (_) {}
    return {
        kind: "vscode-ext",
        path: extDir,
        version: readTargetVersion(extDir),
        localized: hookOk && filesOk,
        hookOk,
        filesOk,
        extJsMtimeMs
    };
}

function probeAllTargets(options = {}) {
    const startMs = Date.now();
    const appDirs = discoverClientAndIdeDirs(options.installDirs);
    const extDirs = discoverExternalExtensionDirs(options.extDirs || []);

    const apps = appDirs.map(probeAppTargetStatus);
    const extensions = extDirs.map(probeExtensionStatus);
    return {
        apps,
        extensions,
        elapsedMs: Date.now() - startMs
    };
}

// ==========================================
// 4. 持久化配置与运行态安全检测
// ==========================================
function saveInstallPreferences(prefs = {}) {
    const { stateDir, configPath } = getStatePaths();
    fs.mkdirSync(stateDir, { recursive: true });
    let existing = {};
    if (fs.existsSync(configPath)) {
        try { existing = JSON.parse(fs.readFileSync(configPath, "utf8")); } catch (_) {}
    }
    const merged = {
        ...existing,
        ...prefs,
        repoRoot: ROOT_DIR,
        updatedAt: new Date().toISOString()
    };
    fs.writeFileSync(configPath, JSON.stringify(merged, null, 2) + "\n", "utf8");
    return merged;
}

function loadInstallPreferences() {
    const { configPath } = getStatePaths();
    if (!fs.existsSync(configPath)) return {};
    try {
        return JSON.parse(fs.readFileSync(configPath, "utf8"));
    } catch (_) {
        return {};
    }
}

function buildEngineArgsFromPrefs(extraArgs = []) {
    const prefs = loadInstallPreferences();
    const args = ["--no-kill"];
    if (prefs.useTw) args.push("--tw");
    if (prefs.brandTitle) args.push("--brand-title", String(prefs.brandTitle));
    if (prefs.keepOptionNamesEn) args.push("--keep-option-en");
    if (prefs.embedDualZh) args.push("--embed-dual-zh");
    if (prefs.hideFloatBtn) args.push("--hide-float-btn");
    args.push(...extraArgs);
    return args;
}

function isClientOrUpdaterRunning(targetPaths) {
    if (process.env.AG_MOCK_APP_RUNNING === "1") return true;
    if (process.env.AG_MOCK_APP_RUNNING === "0") return false;
    const list = Array.isArray(targetPaths)
        ? targetPaths.filter(Boolean)
        : (targetPaths ? [targetPaths] : []);
    try {
        if (process.platform === "darwin") {
            if (list.length > 0) {
                for (const tp of list) {
                    const macosBinDir = path.join(path.resolve(tp), "Contents", "MacOS") + "/";
                    const r = child_process.spawnSync("pgrep", ["-f", macosBinDir], { encoding: "utf8" });
                    if (r.status === 0 && (r.stdout || "").trim().length > 0) return true;
                }
                const shipIt = child_process.spawnSync(
                    "pgrep",
                    ["-if", "antigravity.*ShipIt|ShipIt.*antigravity|ShipIt.*jetski"],
                    { encoding: "utf8" }
                );
                return shipIt.status === 0 && (shipIt.stdout || "").trim().length > 0;
            }
            const out = child_process.execSync(
                'pgrep -x Antigravity || pgrep -f "/Contents/MacOS/Antigravity" || pgrep -if "antigravity.*ShipIt|ShipIt.*antigravity|ShipIt.*jetski"',
                { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
            );
            return out.trim().length > 0;
        } else if (process.platform === "win32") {
            const out = child_process.execSync("tasklist /nh", {
                encoding: "utf8",
                stdio: ["ignore", "pipe", "ignore"]
            }).toLowerCase();
            if (out.includes("antigravitysetup")) return true;
            if (list.length > 0) {
                for (const tp of list) {
                    const isIde = tp.toLowerCase().includes("ide");
                    if (isIde && out.includes("antigravity ide.exe")) return true;
                    if (!isIde && out.includes("antigravity.exe")) return true;
                }
                return false;
            }
            return out.includes("antigravity.exe") || out.includes("antigravity ide.exe");
        }
    } catch (_) {}
    return false;
}

function writePendingFlag(reason) {
    const { stateDir, pendingFlagPath } = getStatePaths();
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(
        pendingFlagPath,
        JSON.stringify({ reason, createdAt: new Date().toISOString() }, null, 2) + "\n",
        "utf8"
    );
}

function clearPendingFlag() {
    const { pendingFlagPath } = getStatePaths();
    try {
        if (fs.existsSync(pendingFlagPath)) fs.unlinkSync(pendingFlagPath);
    } catch (_) {}
}

function runEngineSubprocess(engineArgs, installDirs = []) {
    const runner = resolveJsRunner(installDirs);
    const res = child_process.spawnSync(runner.bin, [ENGINE_SCRIPT, ...engineArgs], {
        cwd: ROOT_DIR,
        encoding: "utf8",
        windowsHide: true,
        env: { ...process.env, ...runner.env }
    });
    return {
        ok: res.status === 0,
        status: res.status,
        stdout: res.stdout || "",
        stderr: res.stderr || ""
    };
}

// ==========================================
// 5. 方案 A：零驻留智能自愈启动器 (--create-launcher / --remove-launcher)
// ==========================================
function findFirstIcnsFile(appPath) {
    const resDir = path.join(appPath, "Contents", "Resources");
    if (!fs.existsSync(resDir)) return null;
    try {
        const icns = fs.readdirSync(resDir).filter(f => f.endsWith(".icns"));
        if (icns.length === 0) return null;
        const preferred = icns.find(f => /electron|app|antigravity|code/i.test(f)) || icns[0];
        return path.join(resDir, preferred);
    } catch (_) {
        return null;
    }
}

function createMacLauncherBundle(targetAppPath, launcherDir) {
    const isIde = targetAppPath.toLowerCase().includes("ide");
    const bundleName = isIde
        ? "Antigravity IDE (智能汉化启动).app"
        : "Antigravity (智能汉化启动).app";
    const bundleId = isIde
        ? "com.antigravity.hanhua.launcher.ide"
        : "com.antigravity.hanhua.launcher.client";

    const bundlePath = path.join(launcherDir, bundleName);
    const contentsDir = path.join(bundlePath, "Contents");
    const macosDir = path.join(contentsDir, "MacOS");
    const resDir = path.join(contentsDir, "Resources");

    fs.mkdirSync(macosDir, { recursive: true });
    fs.mkdirSync(resDir, { recursive: true });

    const srcIcns = findFirstIcnsFile(targetAppPath);
    let iconPlistEntry = "";
    if (srcIcns && fs.existsSync(srcIcns)) {
        fs.copyFileSync(srcIcns, path.join(resDir, "launcher.icns"));
        iconPlistEntry = "\n  <key>CFBundleIconFile</key>\n  <string>launcher.icns</string>";
    }

    const infoPlist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key>
  <string>${bundleName.replace(/\.app$/, "")}</string>
  <key>CFBundleDisplayName</key>
  <string>${bundleName.replace(/\.app$/, "")}</string>
  <key>CFBundleIdentifier</key>
  <string>${bundleId}</string>
  <key>CFBundleVersion</key>
  <string>1.0.0</string>
  <key>CFBundleShortVersionString</key>
  <string>1.0.0</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleExecutable</key>
  <string>launcher</string>
  <key>LSUIElement</key>
  <true/>${iconPlistEntry}
</dict>
</plist>
`;
    fs.writeFileSync(path.join(contentsDir, "Info.plist"), infoPlist, "utf8");

    const runner = resolveJsRunner([targetAppPath]);
    const escapedHealScript = path.join(__dirname, "auto_heal.js").replace(/(["\\$`])/g, "\\$1");
    const escapedTargetApp = targetAppPath.replace(/(["\\$`])/g, "\\$1");
    const escapedDefaultRunner = runner.bin.replace(/(["\\$`])/g, "\\$1");

    const launcherSh = [
        "#!/bin/bash",
        'export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.volta/bin:$HOME/.fnm/current/bin:$PATH"',
        "NODE_BIN=$(command -v node 2>/dev/null || true)",
        'USE_ELECTRON_NODE="0"',
        'if [ -z "$NODE_BIN" ]; then',
        `  if [ -x "${escapedDefaultRunner}" ]; then`,
        `    NODE_BIN="${escapedDefaultRunner}"`,
        `    USE_ELECTRON_NODE="${runner.isElectronFallback ? "1" : "0"}"`,
        `  elif [ -x "${escapedTargetApp}/Contents/Frameworks/Antigravity Helper.app/Contents/MacOS/Antigravity Helper" ]; then`,
        `    NODE_BIN="${escapedTargetApp}/Contents/Frameworks/Antigravity Helper.app/Contents/MacOS/Antigravity Helper"`,
        '    USE_ELECTRON_NODE="1"',
        `  elif [ -x "${escapedTargetApp}/Contents/Frameworks/Antigravity IDE Helper.app/Contents/MacOS/Antigravity IDE Helper" ]; then`,
        `    NODE_BIN="${escapedTargetApp}/Contents/Frameworks/Antigravity IDE Helper.app/Contents/MacOS/Antigravity IDE Helper"`,
        '    USE_ELECTRON_NODE="1"',
        "  fi",
        "fi",
        'if [ -n "$NODE_BIN" ]; then',
        '  if [ "$USE_ELECTRON_NODE" = "1" ]; then',
        `    ELECTRON_RUN_AS_NODE=1 "$NODE_BIN" "${escapedHealScript}" --heal-before-launch --target-app "${escapedTargetApp}" >/dev/null 2>&1 || true`,
        "  else",
        `    "$NODE_BIN" "${escapedHealScript}" --heal-before-launch --target-app "${escapedTargetApp}" >/dev/null 2>&1 || true`,
        "  fi",
        "fi",
        `open -a "${escapedTargetApp}" "$@"`,
        "exit 0",
        ""
    ].join("\n");

    const launcherExecPath = path.join(macosDir, "launcher");
    fs.writeFileSync(launcherExecPath, launcherSh, { encoding: "utf8", mode: 0o755 });
    fs.chmodSync(launcherExecPath, 0o755);

    try {
        child_process.spawnSync("codesign", ["--force", "--deep", "--sign", "-", bundlePath], { stdio: "ignore" });
    } catch (_) {}

    return bundlePath;
}

function writeWindowsVbsFile(filePath, content) {
    // Windows wscript.exe 不支持 UTF-8，含中文/Unicode 路径时必须使用带 BOM 的 UTF-16LE
    const withBom = content.startsWith("\uFEFF") ? content : "\uFEFF" + content;
    fs.writeFileSync(filePath, Buffer.from(withBom, "utf16le"));
}

function createWindowsLauncherVbs(targetInstallDir, launcherDir, options = {}) {
    fs.mkdirSync(launcherDir, { recursive: true });
    const isIde = targetInstallDir.toLowerCase().includes("ide");
    const exeName = fs.existsSync(path.join(targetInstallDir, "Antigravity IDE.exe"))
        ? "Antigravity IDE.exe"
        : "Antigravity.exe";
    const exePath = path.join(targetInstallDir, exeName);
    const vbsName = isIde ? "launcher_ide.vbs" : "launcher_client.vbs";
    const vbsPath = path.join(launcherDir, vbsName);

    const runner = resolveJsRunner([targetInstallDir]);
    const healScript = path.join(__dirname, "auto_heal.js");
    const vbsEsc = (s) => String(s).replace(/"/g, '""');

    const envPrefix = runner.isElectronFallback
        ? 'sh.Environment("PROCESS")("ELECTRON_RUN_AS_NODE") = "1"\r\n'
        : "";

    const vbsContent = [
        "Option Explicit",
        'Dim sh, fso, args, i, healCmd, launchCmd',
        'Set sh = CreateObject("WScript.Shell")',
        'Set fso = CreateObject("Scripting.FileSystemObject")',
        'args = ""',
        "For i = 0 To WScript.Arguments.Count - 1",
        '    args = args & " """ & Replace(WScript.Arguments(i), """", """""") & """"',
        "Next",
        envPrefix.trimEnd(),
        `healCmd = """${vbsEsc(runner.bin)}"" ""${vbsEsc(healScript)}"" --heal-before-launch --target-app ""${vbsEsc(targetInstallDir)}"""`,
        "On Error Resume Next",
        "sh.Run healCmd, 0, True",
        'sh.Environment("PROCESS")("ELECTRON_RUN_AS_NODE") = ""',
        `launchCmd = """${vbsEsc(exePath)}""" & args`,
        "sh.Run launchCmd, 1, False",
        ""
    ]
        .filter(Boolean)
        .join("\r\n");

    writeWindowsVbsFile(vbsPath, vbsContent);

    if ((process.platform === "win32" || options.simulateWinShortcuts) && !options.skipShortcuts) {
        const { home } = resolveRealUserAndHome();
        const backupDir = path.join(launcherDir, "shortcut_backups");
        const createdManifestPath = path.join(backupDir, "created_shortcuts.json");
        fs.mkdirSync(backupDir, { recursive: true });
        let createdList = [];
        if (fs.existsSync(createdManifestPath)) {
            try { createdList = JSON.parse(fs.readFileSync(createdManifestPath, "utf8")) || []; } catch (_) {}
        }
        const shortcutName = isIde ? "Antigravity IDE.lnk" : "Antigravity.lnk";
        const desktopDirs = [
            path.join(home, "Desktop"),
            process.env.OneDrive ? path.join(process.env.OneDrive, "Desktop") : null,
            path.join(process.env.APPDATA || "", "Microsoft", "Windows", "Start Menu", "Programs")
        ].filter(d => d && fs.existsSync(d));

        for (let idx = 0; idx < desktopDirs.length; idx++) {
            const lnkPath = path.join(desktopDirs[idx], shortcutName);
            const existedBefore = fs.existsSync(lnkPath);
            if (!existedBefore && idx > 0) continue;
            const bakLnk = path.join(backupDir, `${idx}_${shortcutName}`);
            if (existedBefore && !fs.existsSync(bakLnk) && !createdList.includes(lnkPath)) {
                try { fs.copyFileSync(lnkPath, bakLnk); } catch (_) {}
            } else if (!existedBefore && !createdList.includes(lnkPath)) {
                createdList.push(lnkPath);
            }
            if (options.simulateWinShortcuts) {
                fs.writeFileSync(lnkPath, `MOCK_LNK:${vbsPath}`, "utf8");
            } else {
                const psCmd = `$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut('${lnkPath.replace(/'/g, "''")}'); $s.TargetPath = 'wscript.exe'; $s.Arguments = '//B //NoLogo "${vbsPath.replace(/'/g, "''")}"'; $s.WorkingDirectory = '${targetInstallDir.replace(/'/g, "''")}'; $s.IconLocation = '${exePath.replace(/'/g, "''")},0'; $s.Save()`;
                child_process.spawnSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", psCmd], {
                    windowsHide: true,
                    stdio: "ignore"
                });
            }
        }
        fs.writeFileSync(createdManifestPath, JSON.stringify(createdList, null, 2) + "\n", "utf8");
    }

    return vbsPath;
}

function createLaunchers(options = {}) {
    const paths = getStatePaths();
    const appDirs = discoverClientAndIdeDirs(options.installDirs);
    if (appDirs.length === 0) {
        console.warn("[启动器] 未探测到 Antigravity 客户端或 IDE 安装目录。");
        return [];
    }

    const created = [];
    if (process.platform === "darwin" && !options.forceWinVbs) {
        fs.mkdirSync(paths.macLauncherDir, { recursive: true });
        for (const appDir of appDirs) {
            const bundle = createMacLauncherBundle(appDir, paths.macLauncherDir);
            created.push(bundle);
            console.log(`[启动器] 已生成智能自愈启动器: ${bundle}`);
        }
        // 若通过 sudo 运行，修正启动器归属权给真实登录用户
        if (process.env.SUDO_USER && process.env.SUDO_USER !== "root") {
            for (const b of created) {
                child_process.spawnSync("chown", ["-R", process.env.SUDO_USER, b], { stdio: "ignore" });
            }
        }
    } else {
        for (const appDir of appDirs) {
            const vbs = createWindowsLauncherVbs(appDir, paths.winLauncherDir, options);
            created.push(vbs);
            console.log(`[启动器] 已生成无窗智能自愈启动器: ${vbs}`);
        }
    }
    return created;
}

function removeLaunchers(options = {}) {
    const paths = getStatePaths();
    const removed = [];

    if (process.platform === "darwin" && !options.forceWinVbs) {
        const names = [
            "Antigravity (智能汉化启动).app",
            "Antigravity IDE (智能汉化启动).app"
        ];
        for (const name of names) {
            const p = path.join(paths.macLauncherDir, name);
            if (fs.existsSync(p)) {
                fs.rmSync(p, { recursive: true, force: true });
                removed.push(p);
                console.log(`[启动器] 已移除智能启动器: ${p}`);
            }
        }
    } else {
        const backupDir = path.join(paths.winLauncherDir, "shortcut_backups");
        if ((process.platform === "win32" || options.simulateWinShortcuts) && fs.existsSync(backupDir) && !options.skipShortcuts) {
            const desktopDirs = [
                path.join(paths.home, "Desktop"),
                process.env.OneDrive ? path.join(process.env.OneDrive, "Desktop") : null,
                path.join(process.env.APPDATA || "", "Microsoft", "Windows", "Start Menu", "Programs")
            ].filter(Boolean);
            for (const f of fs.readdirSync(backupDir)) {
                const m = f.match(/^(\d+)_(.+\.lnk)$/);
                if (m && desktopDirs[Number(m[1])]) {
                    const destLnk = path.join(desktopDirs[Number(m[1])], m[2]);
                    try {
                        fs.copyFileSync(path.join(backupDir, f), destLnk);
                        fs.unlinkSync(path.join(backupDir, f));
                    } catch (_) {}
                }
            }
            const createdManifestPath = path.join(backupDir, "created_shortcuts.json");
            if (fs.existsSync(createdManifestPath)) {
                try {
                    const createdList = JSON.parse(fs.readFileSync(createdManifestPath, "utf8")) || [];
                    for (const createdLnk of createdList) {
                        if (createdLnk && fs.existsSync(createdLnk)) {
                            try { fs.unlinkSync(createdLnk); } catch (_) {}
                        }
                    }
                    fs.unlinkSync(createdManifestPath);
                } catch (_) {}
            }
        }
        for (const vbs of ["launcher_client.vbs", "launcher_ide.vbs"]) {
            const p = path.join(paths.winLauncherDir, vbs);
            if (fs.existsSync(p)) {
                fs.unlinkSync(p);
                removed.push(p);
                console.log(`[启动器] 已清理启动脚本: ${p}`);
            }
        }
    }
    return removed;
}

function healBeforeLaunch(targetAppPath, options = {}) {
    const { pendingFlagPath } = getStatePaths();
    const hasPending = fs.existsSync(pendingFlagPath);
    let pendingReason = "";
    if (hasPending) {
        try {
            pendingReason = JSON.parse(fs.readFileSync(pendingFlagPath, "utf8")).reason || "";
        } catch (_) {}
    }
    const isDictSyncPending = pendingReason.startsWith("dict_sync");

    const targetStatus = targetAppPath ? probeAppTargetStatus(targetAppPath) : null;
    const extStatuses = discoverExternalExtensionDirs(options.extDirs || []).map(probeExtensionStatus);
    const extsToPatch = isDictSyncPending ? extStatuses : extStatuses.filter(e => !e.localized);

    const needAppHeal = targetStatus && (!targetStatus.localized || hasPending);
    const needExtHeal = extsToPatch.length > 0;

    if (!needAppHeal && !needExtHeal && !hasPending) {
        return { healed: false, reason: "already_localized" };
    }

    return withPatchLock("launcher", () => {
        let patchedAny = false;
        const runEngine = options.customEngineRunner
            ? options.customEngineRunner
            : (args, dirs) => runEngineSubprocess(args, dirs);

        if (targetStatus && (!targetStatus.localized || hasPending) && !isClientOrUpdaterRunning(targetStatus.path)) {
            const args = buildEngineArgsFromPrefs(["--install-dir", targetStatus.path]);
            const res = runEngine(args, [targetStatus.path]);
            if (res && res.ok) {
                patchedAny = true;
                appendGuardLog(`Launcher healed target before launch: ${targetStatus.path}`);
            } else {
                appendGuardLog(`Launcher heal failed on ${targetStatus.path}: ${(res && res.stderr) || "unknown error"}`);
            }
        }

        // 若存在词典同步更新挂起，顺便静默刷新其它未运行客户端，避免过早清除全局 pending_patch.flag
        let skippedOtherRunningApp = false;
        if (isDictSyncPending) {
            const allApps = discoverClientAndIdeDirs(options.installDirs);
            for (const appDir of allApps) {
                if (targetStatus && path.resolve(appDir) === path.resolve(targetStatus.path)) continue;
                if (isClientOrUpdaterRunning(appDir)) {
                    skippedOtherRunningApp = true;
                    continue;
                }
                const args = buildEngineArgsFromPrefs(["--install-dir", appDir]);
                const res = runEngine(args, [appDir]);
                if (res && res.ok) {
                    patchedAny = true;
                    appendGuardLog(`Launcher synced idle peer app: ${appDir}`);
                } else {
                    skippedOtherRunningApp = true;
                }
            }
        }

        for (const ext of extsToPatch) {
            const args = buildEngineArgsFromPrefs(["--target", "vscode-ext", "--ext-dir", ext.path]);
            const res = runEngine(args, [ext.path]);
            if (res && res.ok) {
                patchedAny = true;
                appendGuardLog(`Launcher healed extension: ${ext.path}`);
            }
        }

        // 仅当全部发现目标均已汉化且无跳过运行中实例时清除挂起标志
        if (!skippedOtherRunningApp) {
            const after = probeAllTargets({
                installDirs: options.installDirs,
                extDirs: options.extDirs
            });
            if (after.apps.every(a => a.localized) && after.extensions.every(e => e.localized)) {
                clearPendingFlag();
            }
        }
        return { healed: patchedAny };
    });
}

// ==========================================
// 6. 方案 B：系统级空闲态静默守护 (--install-guard / --uninstall-guard)
// ==========================================
function buildMacLaunchAgentPlistXml(options = {}) {
    const paths = getStatePaths();
    const appDirs = discoverClientAndIdeDirs(options.installDirs);
    const runner = resolveJsRunner(appDirs);

    const candidateWatchPaths = [];
    for (const appDir of appDirs) {
        const resDir = path.join(appDir, "Contents", "Resources");
        candidateWatchPaths.push(fs.existsSync(resDir) ? resDir : appDir);
    }
    const extParents = [
        path.join(paths.home, ".antigravity-ide", "extensions"),
        path.join(paths.home, ".vscode", "extensions"),
        path.join(paths.home, ".vscode-insiders", "extensions"),
        path.join(paths.home, ".cursor", "extensions"),
        path.join(paths.home, ".windsurf", "extensions"),
        ...(options.extDirs || [])
    ];
    for (const ep of extParents) {
        if (ep && fs.existsSync(ep)) candidateWatchPaths.push(path.resolve(ep));
    }
    const uniqueWatchPaths = Array.from(new Set(candidateWatchPaths)).filter(p => fs.existsSync(p));

    const xmlEsc = (s) =>
        String(s)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;");

    const envEntries = [
        `    <key>PATH</key>\n    <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>`
    ];
    if (runner.isElectronFallback) {
        envEntries.push(`    <key>ELECTRON_RUN_AS_NODE</key>\n    <string>1</string>`);
    }

    const watchPathsXml = uniqueWatchPaths.map(p => `    <string>${xmlEsc(p)}</string>`).join("\n");

    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LAUNCH_AGENT_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xmlEsc(runner.bin)}</string>
    <string>${xmlEsc(path.join(__dirname, "auto_heal.js"))}</string>
    <string>--guard-tick</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
${envEntries.join("\n")}
  </dict>
  <key>WatchPaths</key>
  <array>
${watchPathsXml}
  </array>
  <key>KeepAlive</key>
  <dict>
    <key>PathState</key>
    <dict>
      <key>${xmlEsc(paths.pendingFlagPath)}</key>
      <true/>
    </dict>
  </dict>
  <key>ThrottleInterval</key>
  <integer>15</integer>
  <key>StandardOutPath</key>
  <string>${xmlEsc(paths.guardLogPath)}</string>
  <key>StandardErrorPath</key>
  <string>${xmlEsc(paths.guardLogPath)}</string>
</dict>
</plist>
`;
}

function runLaunchctlAsUser(args) {
    const { user, uid } = resolveRealUserAndHome();
    if (process.platform === "darwin" && process.getuid && process.getuid() === 0 && user && user !== "root") {
        return child_process.spawnSync("sudo", ["-u", user, "launchctl", ...args], {
            encoding: "utf8",
            stdio: "pipe"
        });
    }
    return child_process.spawnSync("launchctl", args, {
        encoding: "utf8",
        stdio: "pipe",
        env: { ...process.env, UID: String(uid) }
    });
}

function installGuard(options = {}) {
    const paths = getStatePaths();
    fs.mkdirSync(paths.stateDir, { recursive: true });

    if (process.platform === "darwin" && !options.forceWinGuard) {
        fs.mkdirSync(path.dirname(paths.plistPath), { recursive: true });
        const xml = buildMacLaunchAgentPlistXml(options);
        fs.writeFileSync(paths.plistPath, xml, "utf8");
        if (process.env.SUDO_USER && process.env.SUDO_USER !== "root") {
            child_process.spawnSync("chown", [process.env.SUDO_USER, paths.plistPath], { stdio: "ignore" });
        }
        if (!options.skipLaunchctl) {
            runLaunchctlAsUser(["bootout", `gui/${paths.uid}`, paths.plistPath]);
            const boot = runLaunchctlAsUser(["bootstrap", `gui/${paths.uid}`, paths.plistPath]);
            if (boot.status !== 0) {
                runLaunchctlAsUser(["load", "-w", paths.plistPath]);
            }
        }
        appendGuardLog(`Installed macOS LaunchAgent guard at ${paths.plistPath}`);
        console.log(`[守护] 已安装 macOS 零驻留空闲守护服务: ${paths.plistPath}`);
        return { platform: "darwin", plistPath: paths.plistPath };
    } else {
        fs.mkdirSync(paths.winLauncherDir, { recursive: true });
        const appDirs = discoverClientAndIdeDirs(options.installDirs);
        const runner = resolveJsRunner(appDirs);
        const guardVbsPath = path.join(paths.winLauncherDir, "guard_runner.vbs");
        const vbsEsc = (s) => String(s).replace(/"/g, '""');
        const envLine = runner.isElectronFallback
            ? 'sh.Environment("PROCESS")("ELECTRON_RUN_AS_NODE") = "1"\r\n'
            : "";
        const vbsContent = [
            'Dim sh',
            'Set sh = CreateObject("WScript.Shell")',
            envLine.trimEnd(),
            `sh.Run """${vbsEsc(runner.bin)}"" ""${vbsEsc(path.join(__dirname, "auto_heal.js"))}"" --guard-daemon", 0, False`,
            ""
        ]
            .filter(Boolean)
            .join("\r\n");
        writeWindowsVbsFile(guardVbsPath, vbsContent);

        if (process.platform === "win32" && !options.skipSchtasks) {
            const tr = `wscript.exe //B //NoLogo "${guardVbsPath}"`;
            child_process.spawnSync(
                "schtasks",
                ["/Create", "/TN", WIN_TASK_NAME, "/TR", tr, "/SC", "ONLOGON", "/F"],
                { windowsHide: true, stdio: "ignore" }
            );
            const child = child_process.spawn("wscript.exe", ["//B", "//NoLogo", guardVbsPath], {
                detached: true,
                stdio: "ignore",
                windowsHide: true
            });
            child.unref();
        }
        appendGuardLog(`Installed Windows handle-free polling guard at ${guardVbsPath}`);
        console.log(`[守护] 已安装 Windows 无目录句柄静默守护服务: ${guardVbsPath}`);
        return { platform: "win32", guardVbsPath };
    }
}

function uninstallGuard(options = {}) {
    const paths = getStatePaths();
    clearPendingFlag();

    if (process.platform === "darwin" && !options.forceWinGuard) {
        if (fs.existsSync(paths.plistPath)) {
            if (!options.skipLaunchctl) {
                runLaunchctlAsUser(["bootout", `gui/${paths.uid}`, paths.plistPath]);
                runLaunchctlAsUser(["unload", "-w", paths.plistPath]);
            }
            fs.unlinkSync(paths.plistPath);
            console.log(`[守护] 已卸载 macOS 守护服务: ${paths.plistPath}`);
        }
    } else {
        if (fs.existsSync(paths.guardPidPath)) {
            try {
                const pid = Number(fs.readFileSync(paths.guardPidPath, "utf8").trim());
                if (isPidAlive(pid)) process.kill(pid);
            } catch (_) {}
            try { fs.unlinkSync(paths.guardPidPath); } catch (_) {}
        }
        if (process.platform === "win32" && !options.skipSchtasks) {
            child_process.spawnSync("schtasks", ["/Delete", "/TN", WIN_TASK_NAME, "/F"], {
                windowsHide: true,
                stdio: "ignore"
            });
        }
        const guardVbsPath = path.join(paths.winLauncherDir, "guard_runner.vbs");
        if (fs.existsSync(guardVbsPath)) {
            try { fs.unlinkSync(guardVbsPath); } catch (_) {}
        }
        console.log("[守护] 已卸载 Windows 静默守护服务。");
    }
}

function getGuardAndLauncherStatus(options = {}) {
    const paths = getStatePaths();
    const probe = probeAllTargets(options);

    let launcherInstalled = false;
    const launcherPaths = [];
    if (process.platform === "darwin") {
        for (const n of ["Antigravity (智能汉化启动).app", "Antigravity IDE (智能汉化启动).app"]) {
            const p = path.join(paths.macLauncherDir, n);
            if (fs.existsSync(p)) {
                launcherInstalled = true;
                launcherPaths.push(p);
            }
        }
    } else {
        for (const n of ["launcher_client.vbs", "launcher_ide.vbs"]) {
            const p = path.join(paths.winLauncherDir, n);
            if (fs.existsSync(p)) {
                launcherInstalled = true;
                launcherPaths.push(p);
            }
        }
    }

    let guardInstalled = false;
    let guardRunning = false;
    if (process.platform === "darwin") {
        guardInstalled = fs.existsSync(paths.plistPath);
        if (guardInstalled && !process.env.AG_PLIST_PATH_OVERRIDE) {
            const res = runLaunchctlAsUser(["print", `gui/${paths.uid}/${LAUNCH_AGENT_LABEL}`]);
            guardRunning = res.status === 0;
        } else {
            guardRunning = guardInstalled;
        }
    } else {
        const guardVbsPath = path.join(paths.winLauncherDir, "guard_runner.vbs");
        guardInstalled = fs.existsSync(guardVbsPath);
        if (fs.existsSync(paths.guardPidPath)) {
            try {
                const pid = Number(fs.readFileSync(paths.guardPidPath, "utf8").trim());
                guardRunning = isPidAlive(pid);
            } catch (_) {}
        }
    }

    const pendingPatch = fs.existsSync(paths.pendingFlagPath);
    return {
        probe,
        launcherInstalled,
        launcherPaths,
        guardInstalled,
        guardRunning,
        pendingPatch,
        stateDir: paths.stateDir
    };
}

function sleepMs(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 安全空闲状态机单次 Tick：
 * 1) 外部 VS Code 扩展新目录若稳定 >=3s（无进程锁），立即热注入
 * 2) Desktop/IDE 若运行中发现更新覆盖 -> 仅写 pending_patch.flag，绝不强杀、绝不运行态重签名
 * 3) Desktop/IDE 退出且静默 >=8s 无 ShipIt/更新器后 -> 原子锁保护下静默重注并清除 flag
 */
async function runGuardTick(options = {}) {
    const paths = getStatePaths();
    const quietWindowMs = typeof options.quietWindowMs === "number" ? options.quietWindowMs : 8000;
    const extSettleMs = typeof options.extSettleMs === "number" ? options.extSettleMs : 3000;

    const status = probeAllTargets(options);
    const now = Date.now();
    let patchedExtensions = 0;
    let patchedApps = 0;

    const hasPending = fs.existsSync(paths.pendingFlagPath);
    let pendingReason = "";
    if (hasPending) {
        try {
            pendingReason = JSON.parse(fs.readFileSync(paths.pendingFlagPath, "utf8")).reason || "";
        } catch (_) {}
    }
    const isDictSyncPending = pendingReason.startsWith("dict_sync");

    // Step 1: 热注入已落盘稳定的新版外部扩展目录（或词典同步更新后刷新全部外部扩展）
    const extsToPatch = isDictSyncPending ? status.extensions : status.extensions.filter(e => !e.localized);
    for (const ext of extsToPatch) {
        if (!ext.localized && ext.extJsMtimeMs > 0 && now - ext.extJsMtimeMs < extSettleMs) {
            // 仍在解压中，置位 pending 等待下一次触发
            writePendingFlag("extension_unpacking");
            continue;
        }
        const lockOutcome = withPatchLock("guard-ext", () => {
            const args = buildEngineArgsFromPrefs(["--target", "vscode-ext", "--ext-dir", ext.path]);
            return options.customEngineRunner
                ? options.customEngineRunner(args, [ext.path])
                : runEngineSubprocess(args, [ext.path]);
        });
        if (!lockOutcome.skipped && lockOutcome.result && lockOutcome.result.ok) {
            patchedExtensions++;
            appendGuardLog(`Guard hot-patched VS Code extension: ${ext.path}`);
        }
    }

    // Step 2: 检查 Desktop / IDE 主客户端
    const unlocalizedApps = status.apps.filter(a => !a.localized);

    if (unlocalizedApps.length === 0 && !hasPending) {
        return { action: patchedExtensions > 0 ? "patched_ext" : "noop", patchedExtensions, patchedApps: 0 };
    }

    if (unlocalizedApps.length === 0 && hasPending && status.extensions.every(e => e.localized)) {
        if (!isDictSyncPending) {
            clearPendingFlag();
            return { action: "cleared_flag", patchedExtensions, patchedApps: 0 };
        }
        if (status.apps.length === 0) {
            clearPendingFlag();
            return { action: patchedExtensions > 0 ? "patched_ext" : "cleared_flag", patchedExtensions, patchedApps: 0 };
        }
    }

    const targetsToPatch = unlocalizedApps.length > 0 ? unlocalizedApps : status.apps;
    const targetPathsToCheck = targetsToPatch.map(a => a.path);

    if (isClientOrUpdaterRunning(targetPathsToCheck)) {
        writePendingFlag("client_running_deferred");
        appendGuardLog("Detected unlocalized/updated client while running; deferred via pending_patch.flag");
        return { action: "deferred_busy", patchedExtensions, patchedApps: 0 };
    }

    // 空闲静默确认窗口（默认 8s，确认非官方更新器重启间隙）
    if (quietWindowMs > 0) {
        await sleepMs(Math.floor(quietWindowMs / 2));
        if (isClientOrUpdaterRunning(targetPathsToCheck)) {
            writePendingFlag("updater_restarting_deferred");
            return { action: "deferred_restarting", patchedExtensions, patchedApps: 0 };
        }
        await sleepMs(quietWindowMs - Math.floor(quietWindowMs / 2));
        if (isClientOrUpdaterRunning(targetPathsToCheck)) {
            writePendingFlag("updater_restarting_deferred");
            return { action: "deferred_restarting", patchedExtensions, patchedApps: 0 };
        }
    }
    const lockRes = withPatchLock("guard-idle", () => {
        let okCount = 0;
        for (const app of targetsToPatch) {
            const args = buildEngineArgsFromPrefs(["--install-dir", app.path]);
            const r = options.customEngineRunner
                ? options.customEngineRunner(args, [app.path])
                : runEngineSubprocess(args, [app.path]);
            if (r && r.ok) {
                okCount++;
                appendGuardLog(`Guard silently healed idle client: ${app.path}`);
            } else {
                appendGuardLog(`Guard failed on ${app.path}: ${(r && r.stderr) || "unknown error"}`);
            }
        }
        return okCount;
    });

    if (!lockRes.skipped) {
        patchedApps = lockRes.result || 0;
        const postCheck = probeAllTargets(options);
        if (postCheck.apps.every(a => a.localized) && postCheck.extensions.every(e => e.localized)) {
            clearPendingFlag();
        }
    }

    return { action: "healed_idle", patchedExtensions, patchedApps };
}

function collectStatFingerprint(options = {}) {
    const parts = [];
    const appDirs = discoverClientAndIdeDirs(options.installDirs);
    for (const appDir of appDirs) {
        const targets = [
            path.join(appDir, "Contents", "Resources", "app.asar"),
            path.join(appDir, "resources", "app.asar"),
            path.join(appDir, "app.asar"),
            path.join(appDir, "Contents", "Resources", "app", "out", "vs", "code", "electron-browser", "workbench", "workbench.html"),
            path.join(appDir, "Contents", "Resources", "app", "out", "vs", "code", "electron-browser", "workbench", "workbench-jetski-agent.html"),
            path.join(appDir, "Contents", "Resources", "app", "out", "vs", "code", "electron-sandbox", "workbench", "workbench.html"),
            path.join(appDir, "Contents", "Resources", "app", "out", "vs", "code", "electron-sandbox", "workbench", "workbench-jetski-agent.html"),
            path.join(appDir, "Contents", "Resources", "app", "extensions", "agy", "vscode", "extension.js"),
            path.join(appDir, "resources", "app", "out", "vs", "code", "electron-browser", "workbench", "workbench.html"),
            path.join(appDir, "resources", "app", "out", "vs", "code", "electron-browser", "workbench", "workbench-jetski-agent.html"),
            path.join(appDir, "resources", "app", "out", "vs", "code", "electron-sandbox", "workbench", "workbench.html"),
            path.join(appDir, "resources", "app", "out", "vs", "code", "electron-sandbox", "workbench", "workbench-jetski-agent.html"),
            path.join(appDir, "resources", "app", "extensions", "agy", "vscode", "extension.js")
        ];
        for (const t of targets) {
            if (fs.existsSync(t)) {
                try {
                    const st = fs.statSync(t);
                    parts.push(`${t}:${st.mtimeMs}:${st.size}`);
                } catch (_) {}
            }
        }
    }
    const extDirs = discoverExternalExtensionDirs(options.extDirs || []);
    for (const ed of extDirs) {
        const ej = path.join(ed, "vscode", "extension.js");
        if (fs.existsSync(ej)) {
            try {
                const st = fs.statSync(ej);
                parts.push(`${ej}:${st.mtimeMs}:${st.size}`);
            } catch (_) {}
        }
    }
    return parts.sort().join("|");
}

/**
 * Windows 专用零句柄 statSync 轮询守护循环（每 20s 轮询一次，绝不占用目录句柄）
 */
async function runGuardDaemon(options = {}) {
    const paths = getStatePaths();
    fs.mkdirSync(paths.stateDir, { recursive: true });
    if (fs.existsSync(paths.guardPidPath)) {
        try {
            const oldPid = Number(fs.readFileSync(paths.guardPidPath, "utf8").trim());
            if (oldPid && oldPid !== process.pid && isPidAlive(oldPid)) {
                return; // 单实例保护
            }
        } catch (_) {}
    }
    fs.writeFileSync(paths.guardPidPath, String(process.pid), "utf8");
    const intervalMs = options.pollIntervalMs || 20000;
    let lastFingerprint = "";

    const cleanup = () => {
        try {
            if (fs.existsSync(paths.guardPidPath)) {
                const cur = Number(fs.readFileSync(paths.guardPidPath, "utf8").trim());
                if (cur === process.pid) fs.unlinkSync(paths.guardPidPath);
            }
        } catch (_) {}
        process.exit(0);
    };
    process.on("SIGINT", cleanup);
    process.on("SIGTERM", cleanup);

    while (true) {
        try {
            const fp = collectStatFingerprint(options);
            const hasPending = fs.existsSync(paths.pendingFlagPath);
            if (fp !== lastFingerprint || hasPending) {
                lastFingerprint = fp;
                await runGuardTick(options);
                lastFingerprint = collectStatFingerprint(options);
            }
        } catch (err) {
            appendGuardLog(`Daemon tick error: ${err.message}`);
        }
        await sleepMs(intervalMs);
    }
}

/**
 * 供 sync_repos.js Stage 5 调用：词库同步有更新后触发安全重汉化
 */
function handlePostSyncRelocalize({ addedCount = 0, updatedCount = 0 } = {}) {
    const extDirs = discoverExternalExtensionDirs();
    for (const extDir of extDirs) {
        withPatchLock("sync-ext", () => {
            runEngineSubprocess(buildEngineArgsFromPrefs(["--target", "vscode-ext", "--ext-dir", extDir]));
        });
    }

    if (isClientOrUpdaterRunning()) {
        writePendingFlag(`dict_sync:${addedCount + updatedCount}`);
        console.log(
            `[同步联动] 检测到客户端正在运行，已写入延迟重汉化标记 (~/.antigravity-hanhua/pending_patch.flag)，将在客户端退出或下次通过启动器打开时自动生效。`
        );
    } else {
        const res = withPatchLock("sync-idle", () => {
            return runEngineSubprocess(buildEngineArgsFromPrefs());
        });
        if (!res.skipped && res.result && res.result.ok) {
            clearPendingFlag();
            console.log("[同步联动] 客户端处于空闲状态，已完成静默自动重汉化！");
        }
    }
}

function printFormattedStatus(options = {}) {
    const info = getGuardAndLauncherStatus(options);
    console.log("======================================================");
    console.log(" Antigravity 全景汉化与自愈状态报告 (--status)");
    console.log("======================================================");
    console.log(`[探测耗时] ${info.probe.elapsedMs}ms`);
    console.log("\n[1] 桌面客户端与 IDE 本体:");
    if (info.probe.apps.length === 0) {
        console.log("  - (未检测到已安装的 Desktop / Antigravity IDE)");
    } else {
        for (const a of info.probe.apps) {
            const badge = a.localized ? "✓ 已汉化" : "✗ 未汉化 (原版英文)";
            console.log(`  - [${a.kind}] v${a.version} | ${badge} | ${a.path}`);
        }
    }
    console.log("\n[2] 外部编辑器扩展 (VS Code / Cursor / Windsurf 等):");
    if (info.probe.extensions.length === 0) {
        console.log("  - (未在 ~/.vscode 等目录检测到外部 google.google-antigravity 扩展)");
    } else {
        for (const e of info.probe.extensions) {
            const badge = e.localized ? "✓ 已汉化 (含 NLS + 设置页代理)" : "✗ 未汉化";
            console.log(`  - [vscode-ext] v${e.version} | ${badge} | ${e.path}`);
        }
    }
    console.log("\n[3] 更新后自动重汉化状态:");
    console.log(
        `  - 方案 A (智能自愈启动器): ${info.launcherInstalled ? "✓ 已启用 (" + info.launcherPaths.join(", ") + ")" : "未创建 (可通过 --create-launcher 启用)"}`
    );
    console.log(
        `  - 方案 B (空闲态静默守护): ${info.guardInstalled ? (info.guardRunning ? "✓ 已注册并就绪" : "! 已注册但未激活") : "未安装 (可通过 --install-guard 启用)"}`
    );
    console.log(`  - 待执行重注标记 (pending): ${info.pendingPatch ? "是 (等待客户端空闲自动重注)" : "无"}`);
    console.log("======================================================");
    return info;
}

async function cliMain(argv = process.argv.slice(2)) {
    let targetApp = "";
    for (let i = 0; i < argv.length; i++) {
        if (argv[i] === "--target-app") {
            targetApp = argv[++i] || "";
        } else if (argv[i].startsWith("--target-app=")) {
            targetApp = argv[i].slice("--target-app=".length);
        }
    }

    if (argv.includes("--heal-before-launch")) {
        healBeforeLaunch(targetApp);
        return;
    }
    if (argv.includes("--create-launcher")) {
        createLaunchers();
    }
    if (argv.includes("--remove-launcher")) {
        removeLaunchers();
    }
    if (argv.includes("--install-guard")) {
        installGuard();
    }
    if (argv.includes("--uninstall-guard")) {
        uninstallGuard();
    }
    if (argv.includes("--guard-tick")) {
        await runGuardTick();
        return;
    }
    if (argv.includes("--guard-daemon")) {
        await runGuardDaemon();
        return;
    }
    if (argv.includes("--guard-status") || argv.includes("--status")) {
        printFormattedStatus();
    }
}

if (require.main === module) {
    cliMain().catch(err => {
        appendGuardLog(`CLI fatal: ${err.message}`);
        console.error(`[自愈错误] ${err.message}`);
        process.exit(1);
    });
}

module.exports = {
    getStatePaths,
    isPidAlive,
    acquirePatchLock,
    withPatchLock,
    resolveJsRunner,
    discoverExternalExtensionDirs,
    discoverClientAndIdeDirs,
    probeAppTargetStatus,
    probeExtensionStatus,
    probeAllTargets,
    saveInstallPreferences,
    loadInstallPreferences,
    createLaunchers,
    removeLaunchers,
    healBeforeLaunch,
    buildMacLaunchAgentPlistXml,
    installGuard,
    uninstallGuard,
    getGuardAndLauncherStatus,
    runGuardTick,
    runGuardDaemon,
    handlePostSyncRelocalize,
    printFormattedStatus
};
