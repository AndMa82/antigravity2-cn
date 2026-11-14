#!/usr/bin/env node
"use strict";

/**
 * scripts/sync_repos.js
 * 五阶段多源汉化仓库增量同步、防污染审计 (Rule G)、台湾正体转换与自动重汉化联动引擎
 * 支持源：qqxpee / yiheng8023 / liominsb / yuexps 及 config/sync_sources.json 中任意扩展源
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const net = require("net");
const child_process = require("child_process");
const {
    convertScToTw,
    sanitizeTwTerms,
    hasSimplifiedLeak
} = require("./sc_to_tw_converter");

const ROOT_DIR = path.resolve(__dirname, "..");
const DEFAULT_CONFIG_PATH = path.join(ROOT_DIR, "config", "sync_sources.json");
const DICTS_SC_DIR = path.join(ROOT_DIR, "dicts");
const DICTS_TW_DIR = path.join(ROOT_DIR, "dicts_tw");
const SYNC_CACHE_DIR = path.join(ROOT_DIR, ".sync_cache");
const THEME_PATCH_DIR = path.join(ROOT_DIR, "theme_patch");

const METADATA_JSON_NAMES = new Set([
    "package.json",
    "package-lock.json",
    "tsconfig.json",
    "jsconfig.json",
    "composer.json",
    "manifest.json",
    "sync_sources.json",
    "config.json",
    "state.json",
    "conflicts.json",
    "quarantine_short_words.json",
    "mcp_catalog_baseline.json",
    "ui_strings_baseline.json"
]);

const MONACO_DEAD_SCHEMA_RE = /\b(background color|foreground color|border color|activity bar|minimap|overview ruler|editor gutter|peek view|status bar background|title bar background|scrollbar slider|breadcrumb|editorGroupHeader|tab\.activeBackground|workbench\.colorCustomizations)\b/i;

function normalizeText(text) {
    if (!text || typeof text !== "string") return "";
    return text
        .replace(/\s+/g, " ")
        .trim()
        .replace(/’/g, "'")
        .replace(/‘/g, "'")
        .replace(/“/g, '"')
        .replace(/”/g, '"')
        .replace(/…/g, "...");
}

function parseCliArgs(argv) {
    const opts = {
        dryRun: false,
        force: false,
        noRelocalize: false,
        preferRemote: "",
        onlySources: null,
        configPath: DEFAULT_CONFIG_PATH,
        cacheDir: SYNC_CACHE_DIR
    };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === "--help" || a === "-h") {
            console.log("用法: node scripts/sync_repos.js [--dry-run] [--force] [--no-relocalize] [--sources id1,id2] [--prefer-remote id] [--config path]");
            process.exit(0);
        } else if (a === "--dry-run") {
            opts.dryRun = true;
        } else if (a === "--force") {
            opts.force = true;
        } else if (a === "--no-relocalize" || a === "--no-reinstall") {
            opts.noRelocalize = true;
        } else if (a === "--prefer-remote") {
            opts.preferRemote = String(argv[++i] || "").trim();
        } else if (a.startsWith("--prefer-remote=")) {
            opts.preferRemote = a.slice("--prefer-remote=".length).trim();
        } else if (a === "--source" || a === "--sources" || a === "--only") {
            const raw = String(argv[++i] || "").trim();
            if (raw) opts.onlySources = new Set(raw.split(",").map(s => s.trim()).filter(Boolean));
        } else if (a.startsWith("--source=") || a.startsWith("--sources=") || a.startsWith("--only=")) {
            const raw = a.split("=")[1] || "";
            if (raw) opts.onlySources = new Set(raw.split(",").map(s => s.trim()).filter(Boolean));
        } else if (a === "--config") {
            opts.configPath = path.resolve(argv[++i] || DEFAULT_CONFIG_PATH);
        } else if (a.startsWith("--config=")) {
            opts.configPath = path.resolve(a.slice("--config=".length));
        } else if (a === "--cache-dir") {
            opts.cacheDir = path.resolve(argv[++i] || SYNC_CACHE_DIR);
        } else if (a.startsWith("--cache-dir=")) {
            opts.cacheDir = path.resolve(a.slice("--cache-dir=".length));
        }
    }
    return opts;
}

function checkLocalPortOpen(port, timeoutMs = 300) {
    return new Promise(resolve => {
        const socket = new net.Socket();
        let settled = false;
        const done = (ok) => {
            if (settled) return;
            settled = true;
            try { socket.destroy(); } catch (_) {}
            resolve(ok);
        };
        socket.setTimeout(timeoutMs);
        socket.once("connect", () => done(true));
        socket.once("timeout", () => done(false));
        socket.once("error", () => done(false));
        socket.connect(port, "127.0.0.1");
    });
}

async function resolveGitProxy(proxySetting) {
    if (!proxySetting || proxySetting === "none" || proxySetting === "direct") {
        return "";
    }
    if (proxySetting !== "auto") {
        return String(proxySetting);
    }
    const envProxy =
        process.env.AG_GIT_PROXY ||
        process.env.HTTPS_PROXY ||
        process.env.https_proxy ||
        process.env.HTTP_PROXY ||
        process.env.http_proxy ||
        "";
    if (envProxy) return envProxy;

    // 优先探测常用本地代理端口 7890，其次 7897 及 .cursorrules 端口 18080 等
    const candidatePorts = [7890, 7897, 18080, 10808, 10809, 6152];
    for (const port of candidatePorts) {
        if (await checkLocalPortOpen(port, 300)) {
            return `http://127.0.0.1:${port}`;
        }
    }

    if (process.platform === "darwin") {
        try {
            const scOut = child_process.execSync("/usr/sbin/scutil --proxy", { encoding: "utf8", timeout: 1200 });
            const getVal = (k) => {
                const m = scOut.match(new RegExp("^\\s*" + k + "\\s*:\\s*(.+)$", "m"));
                return m ? m[1].trim() : "";
            };
            if (getVal("HTTPSEnable") === "1" && getVal("HTTPSProxy") && getVal("HTTPSPort")) {
                return `http://${getVal("HTTPSProxy")}:${getVal("HTTPSPort")}`;
            }
            if (getVal("HTTPEnable") === "1" && getVal("HTTPProxy") && getVal("HTTPPort")) {
                return `http://${getVal("HTTPProxy")}:${getVal("HTTPPort")}`;
            }
        } catch (_) {}
    }
    return "";
}

function runGit(args, cwd, proxyUrl, isRemoteHttp) {
    const finalArgs = [];
    if (proxyUrl && isRemoteHttp) {
        finalArgs.push("-c", `http.proxy=${proxyUrl}`, "-c", `https.proxy=${proxyUrl}`);
    }
    finalArgs.push(...args);
    const res = child_process.spawnSync("git", finalArgs, {
        cwd,
        encoding: "utf8",
        timeout: 60000,
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0" }
    });
    return {
        ok: res.status === 0,
        stdout: (res.stdout || "").trim(),
        stderr: (res.stderr || "").trim()
    };
}

// ==========================================
// Stage 1: 浅层拉取与 Commit SHA 短路检测
// ==========================================
function fetchSourceRepo(src, reposBaseDir, proxyUrl, prevState, force) {
    const repoUrl = String(src.repo || src.url || "").trim();
    const branch = String(src.branch || "main").trim();
    const isRemoteHttp = /^https?:\/\//i.test(repoUrl);

    // 支持本地目录直接挂载（用于本地开发或沙盒测试）
    if (!isRemoteHttp && fs.existsSync(repoUrl) && fs.statSync(repoUrl).isDirectory()) {
        const gitRes = runGit(["rev-parse", "HEAD"], repoUrl, "", false);
        const sha = gitRes.ok ? gitRes.stdout : `local-mtime-${fs.statSync(repoUrl).mtimeMs}`;
        const unchanged = !force && prevState && prevState.lastSha === sha;
        return {
            ok: true,
            unchanged,
            sha,
            repoDir: path.resolve(repoUrl)
        };
    }

    const repoDir = path.join(reposBaseDir, src.id);
    fs.mkdirSync(repoDir, { recursive: true });

    if (!fs.existsSync(path.join(repoDir, ".git"))) {
        const initRes = runGit(["init"], repoDir, proxyUrl, false);
        if (!initRes.ok) {
            return { ok: false, error: `git init failed: ${initRes.stderr}` };
        }
    }

    const remoteCheck = runGit(["remote", "get-url", "origin"], repoDir, proxyUrl, false);
    if (remoteCheck.ok) {
        if (remoteCheck.stdout !== repoUrl) {
            runGit(["remote", "set-url", "origin", repoUrl], repoDir, proxyUrl, false);
        }
    } else {
        runGit(["remote", "add", "origin", repoUrl], repoDir, proxyUrl, false);
    }

    // 先用 ls-remote 极速检测远端最新 SHA（若未变则连 pack 都不下载，<100ms 返回）
    if (!force && prevState && prevState.lastSha && fs.existsSync(path.join(repoDir, ".git", "HEAD"))) {
        const lsRes = runGit(["ls-remote", "origin", `refs/heads/${branch}`], repoDir, proxyUrl, isRemoteHttp);
        if (lsRes.ok && lsRes.stdout) {
            const remoteSha = lsRes.stdout.split(/\s+/)[0];
            if (remoteSha && remoteSha === prevState.lastSha) {
                return { ok: true, unchanged: true, sha: remoteSha, repoDir };
            }
        }
    }

    let fetchRes = runGit(["fetch", "--depth=1", "origin", branch], repoDir, proxyUrl, isRemoteHttp);
    if (!fetchRes.ok && branch === "main") {
        fetchRes = runGit(["fetch", "--depth=1", "origin", "master"], repoDir, proxyUrl, isRemoteHttp);
    }
    if (!fetchRes.ok) {
        return { ok: false, error: fetchRes.stderr || "git fetch failed" };
    }

    const checkoutRes = runGit(["checkout", "-f", "FETCH_HEAD"], repoDir, proxyUrl, false);
    if (!checkoutRes.ok) {
        return { ok: false, error: checkoutRes.stderr || "git checkout FETCH_HEAD failed" };
    }

    const headRes = runGit(["rev-parse", "HEAD"], repoDir, proxyUrl, false);
    const sha = headRes.ok ? headRes.stdout : "";
    const unchanged = !force && Boolean(sha && prevState && prevState.lastSha === sha);
    return { ok: true, unchanged, sha, repoDir };
}

// ==========================================
// Stage 2: 四源专属 Adapter 解析器
// ==========================================
function walkRepoFiles(dir, maxDepth = 5, curDepth = 0, out = []) {
    if (curDepth > maxDepth || !fs.existsSync(dir)) return out;
    const skipDirs = new Set([
        ".git",
        ".github",
        ".idea",
        ".vscode",
        "node_modules",
        "extracted",
        "dist",
        "build",
        "docs",
        "test",
        "tests",
        "tools",
        ".sync_cache",
        "showimg",
        "proxy_config"
    ]);
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const ent of entries) {
        const full = path.join(dir, ent.name);
        if (ent.isDirectory()) {
            if (!skipDirs.has(ent.name)) {
                walkRepoFiles(full, maxDepth, curDepth + 1, out);
            }
        } else if (ent.isFile()) {
            out.push(full);
        }
    }
    return out;
}

function classifyTargetDictFile(rawKey, hintFileName = "") {
    const base = path.basename(hintFileName).toLowerCase();
    if (base.includes("nls") || base.includes("vscode") || base.includes("extension")) {
        return "ext_vscode_nls.json";
    }
    if (base.startsWith("page_") || base === "common.json" || base === "menu_nav.json") {
        return path.basename(hintFileName);
    }
    if (
        /\b(Antigravity Settings|Inline Diff|CodeLens|agy --hub|healthz|Workspace Settings)\b/i.test(rawKey) ||
        /^(Accept|Reject) (All|Focused) Change/i.test(rawKey)
    ) {
        return "ext_vscode_nls.json";
    }
    if (/\b(Settings|Policy|Permission|Sandbox|Quota|Credits|Telemetry|Browser|Autocomplete)\b/i.test(rawKey)) {
        return "page_settings.json";
    }
    return "common.json";
}

function generateUpstreamEngineAudit(upstreamRepoDir, auditOutPath) {
    const upstreamEnginePath = path.join(upstreamRepoDir, "localization_engine.js");
    const localEnginePath = path.join(ROOT_DIR, "localization_engine.js");
    if (!fs.existsSync(upstreamEnginePath) || !fs.existsSync(localEnginePath)) return;

    try {
        const upCode = fs.readFileSync(upstreamEnginePath, "utf8");
        const locCode = fs.readFileSync(localEnginePath, "utf8");

        const extractRegexLiterals = (src) => {
            const set = new Set();
            const matches = src.match(/\/\^[A-Za-z0-9\\(\[\s\S]{6,120}\/[gimsuy]*/g) || [];
            for (const m of matches) {
                if (!m.includes("\n")) set.add(m.trim());
            }
            return set;
        };

        const upRegexes = extractRegexLiterals(upCode);
        const locRegexes = extractRegexLiterals(locCode);
        const newInUpstream = Array.from(upRegexes).filter(r => !locRegexes.has(r));

        const lines = [
            "# Upstream `localization_engine.js` Audit Report (`qqxpee/antigravity2-cn`)",
            "",
            `- Generated At: ${new Date().toISOString()}`,
            `- Upstream Engine Size: ${(Buffer.byteLength(upCode, "utf8") / 1024).toFixed(1)} KB`,
            `- Local Engine Size: ${(Buffer.byteLength(locCode, "utf8") / 1024).toFixed(1)} KB`,
            `- Theme Patch \`core/\` & \`user/\` Layers Protected: YES`,
            "",
            `## Anchor / Dynamic Regex Patterns Present Only in Upstream (${newInUpstream.length})`,
            ""
        ];
        if (newInUpstream.length === 0) {
            lines.push("No new regex anchors detected in upstream `localization_engine.js`.");
        } else {
            for (const r of newInUpstream.slice(0, 50)) {
                lines.push(`- \`${r}\``);
            }
        }
        fs.mkdirSync(path.dirname(auditOutPath), { recursive: true });
        fs.writeFileSync(auditOutPath, lines.join("\n") + "\n", "utf8");
    } catch (_) {}
}

function extractFlatStringMap(obj, outPairs, targetHint) {
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) return;
    for (const [k, v] of Object.entries(obj)) {
        if (typeof v === "string") {
            outPairs.push({ key: k, sc: v, tc: null, targetFile: classifyTargetDictFile(k, targetHint) });
        } else if (v && typeof v === "object" && !Array.isArray(v)) {
            if (typeof v.zh === "string" || typeof v.cn === "string") {
                outPairs.push({
                    key: k,
                    sc: v.zh || v.cn,
                    tc: typeof v.tw === "string" ? v.tw : null,
                    targetFile: classifyTargetDictFile(k, targetHint)
                });
            } else {
                extractFlatStringMap(v, outPairs, targetHint);
            }
        }
    }
}

function adapterQqxpee(repoDir, cacheDir) {
    const results = [];
    const scDir = path.join(repoDir, "dicts");
    const twDir = path.join(repoDir, "dicts_tw");
    if (fs.existsSync(scDir)) {
        const files = fs.readdirSync(scDir).filter(f => f.endsWith(".json"));
        for (const file of files) {
            try {
                const scData = JSON.parse(fs.readFileSync(path.join(scDir, file), "utf8"));
                let twData = {};
                const twPath = path.join(twDir, file);
                if (fs.existsSync(twPath)) {
                    try { twData = JSON.parse(fs.readFileSync(twPath, "utf8")); } catch (_) {}
                }
                for (const [k, scVal] of Object.entries(scData)) {
                    if (typeof scVal === "string") {
                        results.push({
                            key: k,
                            sc: scVal,
                            tc: typeof twData[k] === "string" ? twData[k] : null,
                            targetFile: file
                        });
                    }
                }
            } catch (_) {}
        }
    }
    generateUpstreamEngineAudit(repoDir, path.join(cacheDir, "upstream_engine_audit.md"));
    return results;
}

function adapterYiheng(repoDir) {
    const results = [];
    const files = walkRepoFiles(repoDir, 4);

    // 优先关联成对的 package.nls.json (EN) 与 package.nls.zh-cn.json (ZH)
    const nlsEnMap = new Map();
    for (const f of files) {
        if (path.basename(f).toLowerCase() === "package.nls.json") {
            try {
                nlsEnMap.set(path.dirname(f), JSON.parse(fs.readFileSync(f, "utf8")));
            } catch (_) {}
        }
    }

    for (const f of files) {
        const base = path.basename(f);
        const lower = base.toLowerCase();
        if (METADATA_JSON_NAMES.has(lower)) continue;

        if (lower === "package.nls.zh-cn.json" && nlsEnMap.has(path.dirname(f))) {
            try {
                const enObj = nlsEnMap.get(path.dirname(f));
                const zhObj = JSON.parse(fs.readFileSync(f, "utf8"));
                for (const [nlsKey, zhVal] of Object.entries(zhObj)) {
                    const enKey = enObj[nlsKey];
                    if (typeof enKey === "string" && typeof zhVal === "string") {
                        results.push({
                            key: enKey,
                            sc: zhVal,
                            tc: null,
                            targetFile: "ext_vscode_nls.json"
                        });
                    }
                }
                continue;
            } catch (_) {}
        }

        if (lower.endsWith(".json")) {
            try {
                const data = JSON.parse(fs.readFileSync(f, "utf8"));
                extractFlatStringMap(data, results, base);
            } catch (_) {}
        }
    }
    return results;
}

function decodeJsStringLiteral(quoteChar, body) {
    if (quoteChar === '"') {
        return JSON.parse(`"${body}"`);
    }
    // Single-quoted JS literal -> convert safely to JSON string literal
    let out = "";
    for (let i = 0; i < body.length; i++) {
        const ch = body[i];
        if (ch === "\\" && i + 1 < body.length) {
            const nxt = body[i + 1];
            if (nxt === "'") {
                out += "'";
                i++;
                continue;
            }
            if (nxt === '"') {
                out += '\\"';
                i++;
                continue;
            }
            out += ch + nxt;
            i++;
            continue;
        }
        if (ch === '"') {
            out += '\\"';
        } else {
            out += ch;
        }
    }
    return JSON.parse(`"${out}"`);
}

function extractJsPairsFromSource(src, results, hintFileName) {
    // 1. Object literals: "en": "zh" or 'en': 'zh'
    const objPairRe = /(["'])((?:\\.|(?!\1)[^\\\r\n])+)\1\s*:\s*(["'])((?:\\.|(?!\3)[^\\\r\n])+)\3/g;
    let m;
    while ((m = objPairRe.exec(src)) !== null) {
        try {
            const k = decodeJsStringLiteral(m[1], m[2]);
            const v = decodeJsStringLiteral(m[3], m[4]);
            if (/[a-zA-Z]{2,}/.test(k) && /[\u4e00-\u9fff]/.test(v)) {
                results.push({
                    key: k,
                    sc: v,
                    tc: null,
                    targetFile: classifyTargetDictFile(k, hintFileName)
                });
            }
        } catch (_) {}
    }

    // 2. 2-element Map array tuples: ["en", "zh"] or ['en', 'zh'] (e.g. yuexps new Map([...]))
    const mapTupleRe = /\[\s*(["'])((?:\\.|(?!\1)[^\\\r\n])+)\1\s*,\s*(["'])((?:\\.|(?!\3)[^\\\r\n])+)\3\s*\]/g;
    while ((m = mapTupleRe.exec(src)) !== null) {
        try {
            const k = decodeJsStringLiteral(m[1], m[2]);
            const v = decodeJsStringLiteral(m[3], m[4]);
            if (/[a-zA-Z]{2,}/.test(k) && /[\u4e00-\u9fff]/.test(v)) {
                results.push({
                    key: k,
                    sc: v,
                    tc: null,
                    targetFile: classifyTargetDictFile(k, hintFileName)
                });
            }
        } catch (_) {}
    }
}

function adapterLiominsb(repoDir) {
    const results = [];
    const files = walkRepoFiles(repoDir, 4);
    for (const f of files) {
        const base = path.basename(f);
        const lower = base.toLowerCase();
        if (METADATA_JSON_NAMES.has(lower)) continue;
        if (lower.endsWith(".json")) {
            try {
                const data = JSON.parse(fs.readFileSync(f, "utf8"));
                extractFlatStringMap(data, results, base);
            } catch (_) {}
        } else if (lower === "localize.js" || lower.includes("dict") || lower.includes("i18n") || lower.includes("zh")) {
            try {
                const src = fs.readFileSync(f, "utf8");
                extractJsPairsFromSource(src, results, base);
            } catch (_) {}
        }
    }
    return results;
}

function extractPathSemverTuple(filePath) {
    const m = filePath.replace(/\\/g, "/").match(/(?:^|\/)v?(\d+)\.(\d+)(?:\.(\d+))?(?:\/|$)/i);
    if (!m) return [0, 0, 0];
    return [Number(m[1]) || 0, Number(m[2]) || 0, Number(m[3]) || 0];
}

function adapterYuexps(repoDir) {
    const results = [];
    const files = walkRepoFiles(repoDir, 5).sort((a, b) => {
        const va = extractPathSemverTuple(a);
        const vb = extractPathSemverTuple(b);
        for (let i = 0; i < 3; i++) {
            if (vb[i] !== va[i]) return vb[i] - va[i];
        }
        return a.localeCompare(b);
    });

    for (const f of files) {
        const base = path.basename(f);
        const lower = base.toLowerCase();
        if (METADATA_JSON_NAMES.has(lower) || lower.endsWith("_test.go") || lower.endsWith(".test.js") || lower.endsWith(".test.mjs")) {
            continue;
        }

        if (lower.endsWith(".json")) {
            try {
                const data = JSON.parse(fs.readFileSync(f, "utf8"));
                extractFlatStringMap(data, results, base);
            } catch (_) {}
        } else if (lower.endsWith(".go") || lower.endsWith(".ts") || lower.endsWith(".js") || lower.endsWith(".mjs")) {
            try {
                const src = fs.readFileSync(f, "utf8");
                extractJsPairsFromSource(src, results, base);
            } catch (_) {}
        }
    }
    return results;
}

function adapterChuanban(repoDir) {
    const results = [];
    const i18nPath = path.join(repoDir, "core", "i18n.json");
    if (!fs.existsSync(i18nPath)) return results;
    try {
        const raw = JSON.parse(fs.readFileSync(i18nPath, "utf8"));
        const mapObj = raw && typeof raw.exact === "object" && raw.exact !== null ? raw.exact : raw;
        if (mapObj && typeof mapObj === "object") {
            for (const [k, v] of Object.entries(mapObj)) {
                if (typeof v === "string") {
                    results.push({ key: k, sc: v, tc: null, targetFile: "common.json" });
                }
            }
        }
    } catch (_) {}
    return results;
}

function syncChuanbanThemeCore(repoDir, targetPatchDir = THEME_PATCH_DIR) {
    const srcCore = path.join(repoDir, "core");
    if (!fs.existsSync(srcCore)) return { updated: false, changedFiles: [], version: null };

    const dstCore = path.join(targetPatchDir, "core");
    fs.mkdirSync(dstCore, { recursive: true });

    const changedFiles = [];
    for (const item of fs.readdirSync(srcCore)) {
        const s = path.join(srcCore, item);
        const d = path.join(dstCore, item);
        if (!fs.statSync(s).isFile()) continue;
        const sBuf = fs.readFileSync(s);
        const dBuf = fs.existsSync(d) ? fs.readFileSync(d) : null;
        if (!dBuf || !sBuf.equals(dBuf)) {
            fs.writeFileSync(d, sBuf);
            changedFiles.push(`core/${item}`);
        }
    }

    for (const topFile of ["install.mjs", "SKILL.md", "README.md"]) {
        const s = path.join(repoDir, topFile);
        const d = path.join(targetPatchDir, topFile);
        if (!fs.existsSync(s) || !fs.statSync(s).isFile()) continue;
        const sBuf = fs.readFileSync(s);
        const dBuf = fs.existsSync(d) ? fs.readFileSync(d) : null;
        if (!dBuf || !sBuf.equals(dBuf)) {
            fs.writeFileSync(d, sBuf);
            changedFiles.push(topFile);
        }
    }

    let version = null;
    try {
        const manifestPath = path.join(dstCore, "manifest.json");
        if (fs.existsSync(manifestPath)) {
            version = JSON.parse(fs.readFileSync(manifestPath, "utf8")).version || null;
        }
    } catch (_) {}

    return { updated: changedFiles.length > 0, changedFiles, version };
}

function syncTokenMonitorFiles(repoDir, targetDir = path.join(ROOT_DIR, "tools", "token_monitor")) {
    if (!fs.existsSync(repoDir)) return { updated: false, changedFiles: [] };
    fs.mkdirSync(targetDir, { recursive: true });
    const changedFiles = [];

    for (const fileName of ["monitor_server.py", "README.md"]) {
        const s = path.join(repoDir, fileName);
        const d = path.join(targetDir, fileName);
        if (!fs.existsSync(s) || !fs.statSync(s).isFile()) continue;
        const sBuf = fs.readFileSync(s);
        const dBuf = fs.existsSync(d) ? fs.readFileSync(d) : null;
        if (!dBuf || !sBuf.equals(dBuf)) {
            fs.writeFileSync(d, sBuf);
            changedFiles.push(fileName);
        }
    }

    const srcHtmlPath = path.join(repoDir, "index.html");
    const dstHtmlPath = path.join(targetDir, "index.html");
    if (fs.existsSync(srcHtmlPath) && fs.statSync(srcHtmlPath).isFile()) {
        let html = fs.readFileSync(srcHtmlPath, "utf8");
        if (!html.includes("@media (max-width: 600px)") && html.includes("  </style>")) {
            const compactCss = `
    @media (max-width: 600px) {
      .app-shell { padding: 10px 10px 32px; gap: 10px; }
      .topbar { position: static; padding: 10px 12px; gap: 8px; }
      .brand-title { font-size: 14px; }
      .preset-strip { overflow-x: auto; flex-wrap: nowrap; max-width: 100%; padding-bottom: 2px; }
      .controls-right { gap: 5px; }
      .ctrl-select, .ctrl-input, .btn-action, .seg-btn { font-size: 11px; padding: 4px 7px; }
      .kpi-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
      .kpi-val { font-size: 20px; }
      .card { padding: 12px; border-radius: 12px; }
      .ladder-row { grid-template-columns: 96px 1fr 72px; gap: 6px; }
      .window-title-cell { max-width: 160px; }
    }
  </style>`;
            html = html.replace("  </style>", compactCss);
        }
        const sBuf = Buffer.from(html, "utf8");
        const dBuf = fs.existsSync(dstHtmlPath) ? fs.readFileSync(dstHtmlPath) : null;
        if (!dBuf || !sBuf.equals(dBuf)) {
            fs.writeFileSync(dstHtmlPath, sBuf);
            changedFiles.push("index.html");
        }
    }

    return { updated: changedFiles.length > 0, changedFiles };
}

function extractCandidatesByAdapter(src, repoDir, cacheDir) {
    const adapter = String(src.adapter || src.id || "").toLowerCase();
    if (adapter === "token_monitor") return [];
    if (adapter === "qqxpee") return adapterQqxpee(repoDir, cacheDir);
    if (adapter === "chuanban") return adapterChuanban(repoDir);
    if (adapter === "yiheng" || adapter === "yiheng8023") return adapterYiheng(repoDir);
    if (adapter === "liominsb") return adapterLiominsb(repoDir);
    if (adapter === "yuexps") return adapterYuexps(repoDir);
    return adapterLiominsb(repoDir);
}

// ==========================================
// Stage 3: Rule G 防污染守门员与简繁对齐
// ==========================================
function auditEntryRuleG(rawKey, scVal, sourceId) {
    if (!rawKey || typeof rawKey !== "string" || !scVal || typeof scVal !== "string") {
        return { pass: false, quarantine: false, reason: "empty_or_non_string" };
    }
    const trimmedKey = rawKey.trim();
    const trimmedVal = scVal.trim();
    if (!trimmedKey || !trimmedVal) {
        return { pass: false, quarantine: false, reason: "blank_string" };
    }
    // Key 必须包含英文且原则上不含中文，Value 必须包含中文（防止反相词表或未翻译占位符污染）
    if (!/[a-zA-Z]{2,}/.test(trimmedKey) || /[\u4e00-\u9fff]/.test(trimmedKey)) {
        return { pass: false, quarantine: false, reason: "invalid_english_key" };
    }
    if (!/[\u4e00-\u9fff]/.test(trimmedVal)) {
        return { pass: false, quarantine: false, reason: "untranslated_value" };
    }
    // 剔除代码特征、模板变量、URI/路径与 Monaco 废弃内部 schema
    if (
        /[{}]|\$\/|=>|function\s*\(|<\/?[a-z]+[^>]*>/i.test(trimmedKey) ||
        /^[a-zA-Z]:[\\/]/.test(trimmedKey) ||
        /^(\/|[a-z]+:\/\/)\S+$/i.test(trimmedKey) ||
        /^[a-z0-9_]+(\.[a-z0-9_-]+){2,}$/i.test(trimmedKey)
    ) {
        return { pass: false, quarantine: false, reason: "code_or_identifier_token" };
    }
    if (MONACO_DEAD_SCHEMA_RE.test(trimmedKey)) {
        return { pass: false, quarantine: false, reason: "monaco_dead_schema" };
    }
    // 剔除残缺 DOM 分片（首尾介词或悬空标点/括号）
    if (
        /^[?,.;:!)\]}\/]/.test(trimmedKey) ||
        /\(\s*$/.test(trimmedKey) ||
        (trimmedKey.length < 40 && /^(to|in|on|at|by|of|and|or)\s+[a-z]+$/i.test(trimmedKey))
    ) {
        return { pass: false, quarantine: true, reason: "dom_broken_fragment" };
    }
    // 非 qqxpee 源：<= 15 字符且不含空格的泛化短词一律隔离
    if (sourceId !== "qqxpee" && !trimmedKey.includes(" ") && trimmedKey.length <= 15) {
        return { pass: false, quarantine: true, reason: "short_single_word_rule_g" };
    }
    return { pass: true, quarantine: false, reason: "ok" };
}

function loadAllDictFiles(scDir, twDir) {
    const scFilesMap = new Map();
    const twFilesMap = new Map();
    const rawSnapshotSc = new Map();
    const rawSnapshotTw = new Map();
    const normIndex = new Map();

    const files = fs.existsSync(scDir) ? fs.readdirSync(scDir).filter(f => f.endsWith(".json")).sort() : [];
    for (const f of files) {
        const scPath = path.join(scDir, f);
        const twPath = path.join(twDir, f);
        const scRaw = fs.readFileSync(scPath, "utf8");
        const twRaw = fs.existsSync(twPath) ? fs.readFileSync(twPath, "utf8") : "{}";
        rawSnapshotSc.set(f, scRaw);
        rawSnapshotTw.set(f, twRaw);

        const scObj = JSON.parse(scRaw);
        const twObj = JSON.parse(twRaw);
        scFilesMap.set(f, scObj);
        twFilesMap.set(f, twObj);

        for (const [k, v] of Object.entries(scObj)) {
            const nk = normalizeText(k);
            if (nk && !normIndex.has(nk)) {
                normIndex.set(nk, { file: f, key: k });
            }
        }
    }
    return { scFilesMap, twFilesMap, rawSnapshotSc, rawSnapshotTw, normIndex };
}

// ==========================================
// Stage 4 & 5: 原子写入、校验回滚与重汉化联动
// ==========================================
function writeAndVerifyDicts(scFilesMap, twFilesMap, touchedFiles, rawSnapshotSc, rawSnapshotTw) {
    const createdFiles = [];
    for (const f of touchedFiles) {
        if (!rawSnapshotSc.has(f)) createdFiles.push(f);
        const scOut = JSON.stringify(scFilesMap.get(f), null, 4) + "\n";
        const twOut = JSON.stringify(twFilesMap.get(f), null, 4) + "\n";
        fs.writeFileSync(path.join(DICTS_SC_DIR, f), scOut, "utf8");
        fs.writeFileSync(path.join(DICTS_TW_DIR, f), twOut, "utf8");
    }

    const verifyRes = child_process.spawnSync(process.execPath, [path.join(__dirname, "compare_dicts.js")], {
        cwd: ROOT_DIR,
        encoding: "utf8"
    });

    if (verifyRes.status !== 0) {
        // 校验未通过：立即执行内存快照回滚
        for (const f of touchedFiles) {
            if (rawSnapshotSc.has(f)) {
                fs.writeFileSync(path.join(DICTS_SC_DIR, f), rawSnapshotSc.get(f), "utf8");
            } else if (fs.existsSync(path.join(DICTS_SC_DIR, f))) {
                fs.unlinkSync(path.join(DICTS_SC_DIR, f));
            }
            if (rawSnapshotTw.has(f)) {
                fs.writeFileSync(path.join(DICTS_TW_DIR, f), rawSnapshotTw.get(f), "utf8");
            } else if (fs.existsSync(path.join(DICTS_TW_DIR, f))) {
                fs.unlinkSync(path.join(DICTS_TW_DIR, f));
            }
        }
        throw new Error(
            `compare_dicts.js validation failed (rolled back all changes):\n${verifyRes.stderr || verifyRes.stdout}`
        );
    }
}

async function runSync(rawArgv = process.argv.slice(2)) {
    const opts = parseCliArgs(rawArgv);
    if (!fs.existsSync(opts.configPath)) {
        throw new Error(`Sync config not found: ${opts.configPath}`);
    }

    const config = JSON.parse(fs.readFileSync(opts.configPath, "utf8"));
    const cacheDir = opts.cacheDir;
    const reposBaseDir = path.join(cacheDir, "repos");
    const statePath = path.join(cacheDir, "state.json");
    const conflictsPath = path.join(cacheDir, "conflicts.json");
    const quarantinePath = path.join(cacheDir, "quarantine_short_words.json");

    fs.mkdirSync(reposBaseDir, { recursive: true });

    let state = { updatedAt: null, sources: {} };
    if (fs.existsSync(statePath)) {
        try { state = JSON.parse(fs.readFileSync(statePath, "utf8")); } catch (_) {}
        if (!state.sources) state.sources = {};
    }

    const proxyUrl = await resolveGitProxy(config.proxy);
    console.log(`[同步] 代理策略: ${proxyUrl || "直连 (未检测到活跃本地代理)"}`);

    const enabledSources = (config.sources || [])
        .filter(s => s && s.enabled !== false && (!opts.onlySources || opts.onlySources.has(s.id)))
        .sort((a, b) => (Number(b.priority) || 0) - (Number(a.priority) || 0));

    if (enabledSources.length === 0) {
        console.log("[同步] 没有匹配的启用同步源。");
        return { added: 0, updated: 0, quarantined: 0, conflicts: 0 };
    }

    const { scFilesMap, twFilesMap, rawSnapshotSc, rawSnapshotTw, normIndex } = loadAllDictFiles(
        DICTS_SC_DIR,
        DICTS_TW_DIR
    );

    const conflicts = [];
    const quarantined = [];
    const touchedFiles = new Set();
    const nextShas = {};
    let addedCount = 0;
    let updatedCount = 0;
    let themeCoreUpdated = false;
    let tokenMonitorUpdated = false;
    let processedAnySource = false;

    for (const src of enabledSources) {
        const t0 = Date.now();
        const fetchInfo = fetchSourceRepo(src, reposBaseDir, proxyUrl, state.sources[src.id], opts.force);
        const dt = Date.now() - t0;

        if (!fetchInfo.ok) {
            console.warn(`[同步警告] 源 ${src.id} 拉取失败 (${dt}ms): ${fetchInfo.error}`);
            continue;
        }

        nextShas[src.id] = fetchInfo.sha;
        if (fetchInfo.unchanged) {
            console.log(`[同步] 源 ${src.id} 无新提交 (${fetchInfo.sha.slice(0, 8)}, ${dt}ms)，跳过。`);
            continue;
        }

        processedAnySource = true;
        console.log(`[同步] 正在解析源 ${src.id} (${fetchInfo.sha.slice(0, 8)}, 拉取耗时 ${dt}ms)...`);

        if (src.syncThemeCore && !opts.dryRun) {
            const themeSync = syncChuanbanThemeCore(fetchInfo.repoDir, THEME_PATCH_DIR);
            if (themeSync.updated) {
                themeCoreUpdated = true;
                console.log(
                    `[同步] 已同步更新 theme_patch 内核 (${themeSync.version || "latest"}): ${themeSync.changedFiles.join(", ")}`
                );
            } else {
                console.log(`[同步] theme_patch 内核已是最新 (${themeSync.version || "latest"})。`);
            }
        }
        if (src.syncTokenMonitor && !opts.dryRun) {
            const tmSync = syncTokenMonitorFiles(fetchInfo.repoDir);
            if (tmSync.updated) {
                tokenMonitorUpdated = true;
                console.log(`[同步] 已同步更新 Token Monitor: ${tmSync.changedFiles.join(", ")}`);
            } else {
                console.log(`[同步] Token Monitor 已是最新。`);
            }
        }
        const rawCandidates = extractCandidatesByAdapter(src, fetchInfo.repoDir, cacheDir);
        let srcAdded = 0;
        let srcUpdated = 0;
        let srcQuarantined = 0;

        for (const item of rawCandidates) {
            const audit = auditEntryRuleG(item.key, item.sc, src.id);
            if (!audit.pass) {
                if (audit.quarantine) {
                    srcQuarantined++;
                    quarantined.push({
                        source: src.id,
                        key: item.key,
                        sc: item.sc,
                        reason: audit.reason
                    });
                }
                continue;
            }

            const normKey = normalizeText(item.key);
            if (!normKey) continue;

            // 生成并校验台湾正体译文
            let tcVal = item.tc ? sanitizeTwTerms(item.tc) : convertScToTw(item.sc);
            let leakCheck = hasSimplifiedLeak(tcVal);
            if (leakCheck.leaked) {
                tcVal = convertScToTw(item.sc);
                leakCheck = hasSimplifiedLeak(tcVal);
            }
            if (leakCheck.leaked) {
                srcQuarantined++;
                quarantined.push({
                    source: src.id,
                    key: item.key,
                    sc: item.sc,
                    tc: tcVal,
                    reason: `tw_simplified_leak:${leakCheck.char}`
                });
                continue;
            }

            if (normIndex.has(normKey)) {
                const existing = normIndex.get(normKey);
                const curScObj = scFilesMap.get(existing.file);
                const curTwObj = twFilesMap.get(existing.file);
                const curScVal = curScObj[existing.key];

                if (opts.preferRemote && opts.preferRemote === src.id) {
                    if (curScVal !== item.sc) {
                        curScObj[existing.key] = item.sc;
                        curTwObj[existing.key] = tcVal;
                        touchedFiles.add(existing.file);
                        updatedCount++;
                        srcUpdated++;
                    }
                } else if (curScVal !== item.sc) {
                    conflicts.push({
                        source: src.id,
                        file: existing.file,
                        key: existing.key,
                        local: curScVal,
                        remote: item.sc
                    });
                }
            } else {
                const targetFile = scFilesMap.has(item.targetFile) ? item.targetFile : (src.id === "qqxpee" ? item.targetFile : "common.json");
                if (!scFilesMap.has(targetFile)) {
                    scFilesMap.set(targetFile, {});
                    twFilesMap.set(targetFile, {});
                }
                scFilesMap.get(targetFile)[item.key] = item.sc;
                twFilesMap.get(targetFile)[item.key] = tcVal;
                normIndex.set(normKey, { file: targetFile, key: item.key });
                touchedFiles.add(targetFile);
                addedCount++;
                srcAdded++;
            }
        }

        console.log(
            `[同步] 源 ${src.id} 处理完成: 新增 ${srcAdded} 条, 更新 ${srcUpdated} 条, 规则G隔离 ${srcQuarantined} 条`
        );
    }

    if (processedAnySource || !fs.existsSync(conflictsPath)) {
        fs.writeFileSync(conflictsPath, JSON.stringify(conflicts, null, 2) + "\n", "utf8");
    }
    if (processedAnySource || !fs.existsSync(quarantinePath)) {
        fs.writeFileSync(quarantinePath, JSON.stringify(quarantined, null, 2) + "\n", "utf8");
    }

    if (opts.dryRun) {
        console.log(
            `[Dry-Run] 模拟同步完成: 预计新增 ${addedCount} 条, 更新 ${updatedCount} 条, 冲突记录 ${conflicts.length} 条, 隔离短词/残片 ${quarantined.length} 条（未修改 dicts/）。`
        );
        return { added: addedCount, updated: updatedCount, quarantined: quarantined.length, conflicts: conflicts.length };
    }

    if (touchedFiles.size > 0) {
        writeAndVerifyDicts(scFilesMap, twFilesMap, touchedFiles, rawSnapshotSc, rawSnapshotTw);
        console.log(`[同步] 已原子写入 ${touchedFiles.size} 个词典文件并通过 compare_dicts.js 100% 对齐校验！`);
    }

    for (const [id, sha] of Object.entries(nextShas)) {
        state.sources[id] = {
            lastSha: sha,
            syncedAt: new Date().toISOString()
        };
    }
    state.updatedAt = new Date().toISOString();
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2) + "\n", "utf8");

    // Stage 5: 自动重汉化与 CDP 补充词库同步联动
    if (addedCount > 0 || updatedCount > 0) {
        const deployedCfgPath = path.join(os.homedir(), ".gemini", "antigravity", "theme-patch", "user", "config.json");
        let cdpI18nEnabled = false;
        try {
            if (fs.existsSync(deployedCfgPath)) {
                const cfg = JSON.parse(fs.readFileSync(deployedCfgPath, "utf8"));
                cdpI18nEnabled = Boolean(cfg && cfg.modules && cfg.modules.i18n === true);
            }
        } catch (_) {}

        if (cdpI18nEnabled) {
            try {
                const { syncThemePatchOverrideDict } = require("../localization_engine");
                syncThemePatchOverrideDict();
            } catch (err) {
                console.warn(`[同步警告] CDP 补充词库更新异常: ${err.message}`);
            }
        }

        if (
            config.autoRelocalizeAfterSync &&
            !opts.noRelocalize &&
            process.env.AG_SKIP_REAL_INSTALL !== "1"
        ) {
            try {
                const autoHealPath = path.join(__dirname, "auto_heal.js");
                if (fs.existsSync(autoHealPath)) {
                    const { probeAllTargets, handlePostSyncRelocalize } = require("./auto_heal");
                    const targets = probeAllTargets();
                    const hasLocalizedFileTarget =
                        targets.apps.some(a => a.localized) || targets.extensions.some(e => e.localized);
                    if (!cdpI18nEnabled || hasLocalizedFileTarget) {
                        handlePostSyncRelocalize({ addedCount, updatedCount });
                    }
                }
            } catch (err) {
                console.warn(`[同步警告] 联动重汉化触发异常: ${err.message}`);
            }
        }
    }

    if (
        (themeCoreUpdated || tokenMonitorUpdated) &&
        config.autoRelocalizeAfterSync &&
        !opts.noRelocalize &&
        process.env.AG_SKIP_REAL_INSTALL !== "1"
    ) {
        try {
            const deployedManifest = path.join(os.homedir(), ".gemini", "antigravity", "theme-patch", "core", "manifest.json");
            const enginePath = path.join(ROOT_DIR, "localization_engine.js");
            if (fs.existsSync(deployedManifest) && fs.existsSync(enginePath)) {
                console.log("[同步] 检测到本机已部署主题与监控服务，正在联动热升级 theme-patch 与 Token Monitor...");
                child_process.spawnSync(process.execPath, [enginePath, "--theme-install"], {
                    cwd: ROOT_DIR,
                    stdio: "inherit"
                });
            }
        } catch (err) {
            console.warn(`[同步警告] 主题与监控服务热升级异常: ${err.message}`);
        }
    }

    return { added: addedCount, updated: updatedCount, quarantined: quarantined.length, conflicts: conflicts.length };
}

if (require.main === module) {
    runSync().catch(err => {
        console.error(`[同步错误] ${err.message}`);
        process.exit(1);
    });
}

module.exports = {
    runSync,
    auditEntryRuleG,
    resolveGitProxy,
    extractCandidatesByAdapter
};
