const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const child_process = require('child_process');
const { pathToFileURL } = require('url');

// macOS 环境下自动补全 PATH，确保 npx、codesign 等工具能被顺利找到
if (process.platform === 'darwin') {
    let realHome = os.homedir();
    if (process.env.SUDO_USER && process.env.SUDO_USER !== 'root') {
        const sudoHome = path.join('/Users', process.env.SUDO_USER);
        if (fs.existsSync(sudoHome)) realHome = sudoHome;
    }
    const extraPaths = [
        '/usr/local/bin',
        '/opt/homebrew/bin',
        '/opt/homebrew/sbin',
        '/opt/local/bin',
        path.join(realHome, '.volta', 'bin'),
        path.join(realHome, '.asdf', 'shims'),
        path.join(realHome, '.local', 'share', 'mise', 'shims'),
        path.join(realHome, '.local', 'bin'),
        path.join(realHome, '.fnm', 'current', 'bin'),
        path.join(realHome, '.local', 'share', 'fnm', 'aliases', 'default', 'bin'),
        path.join(realHome, 'Library', 'Application Support', 'fnm', 'aliases', 'default', 'bin')
    ];
    const nvmVersionsDir = path.join(realHome, '.nvm', 'versions', 'node');
    if (fs.existsSync(nvmVersionsDir)) {
        try {
            const versions = fs.readdirSync(nvmVersionsDir).sort();
            for (const v of versions) {
                extraPaths.push(path.join(nvmVersionsDir, v, 'bin'));
            }
        } catch (e) {}
    }
    const currentPaths = (process.env.PATH || '').split(':');
    for (const p of extraPaths) {
        if (!currentPaths.includes(p) && fs.existsSync(p)) {
            currentPaths.unshift(p);
        }
    }
    const nodeBinDir = path.dirname(process.execPath);
    if (!currentPaths.includes(nodeBinDir)) {
        currentPaths.unshift(nodeBinDir);
    }
    process.env.PATH = currentPaths.join(':');
}

// --tw 參數：使用繁體中文字典 (dicts_tw/)，否則使用預設簡體字典 (dicts/)
const USE_TW = process.argv.includes('--tw');
const EMBED_DUAL_ZH = process.argv.includes('--embed-dual-zh');
const KEEP_OPTION_NAMES_EN = process.argv.includes('--keep-option-en');
const HIDE_FLOAT_BTN = process.argv.includes('--hide-float-btn');
const DICTS_FOLDER = USE_TW ? 'dicts_tw' : 'dicts';
const BRAND_TITLE_ALIASES = {
    english: 'english',
    en: 'english',
    default: 'english',
    hidden: 'hidden',
    hide: 'hidden',
    none: 'hidden',
    translated: 'translated',
    chinese: 'translated',
    cn: 'translated',
    zh: 'translated'
};

function getOptionValue(name, defaultValue) {
    const args = process.argv.slice(2);
    for (let i = 0; i < args.length; i++) {
        if (args[i] === name) {
            return args[i + 1] || defaultValue;
        }
        if (args[i].startsWith(name + '=')) {
            return args[i].slice(name.length + 1);
        }
    }
    return defaultValue;
}

function getOptionValues(name) {
    const values = [];
    const args = process.argv.slice(2);
    for (let i = 0; i < args.length; i++) {
        if (args[i] === name && args[i + 1]) {
            values.push(args[i + 1]);
            i++;
        } else if (args[i].startsWith(name + '=')) {
            values.push(args[i].slice(name.length + 1));
        }
    }
    return values;
}

const BRAND_TITLE_MODE = BRAND_TITLE_ALIASES[String(getOptionValue('--brand-title', 'english')).toLowerCase()] || 'english';

if (USE_TW) {
    const logTranslations = {
        "====== 正在安装 Antigravity 中文汉化 ======": "====== 正在安裝 Antigravity 繁體中文漢化 ======",
        "====== 正在卸载中文汉化，恢复官方原版 ======": "====== 正在卸載中文漢化，恢復官方原版 ======",
        "====== 检测到 Antigravity 1.0 架构，正在使用 HTML 注入引擎 ======": "====== 偵測到 Antigravity 1.0 架構，正在使用 HTML 注入引擎 ======",
        "====== 检测到 Antigravity IDE / 1.0 架构，正在使用 HTML 注入引擎 ======": "====== 偵測到 Antigravity IDE / 1.0 架構，正在使用 HTML 注入引擎 ======",
        "====== 正在恢复 Antigravity 1.0 官方原版 ======": "====== 正在恢復 Antigravity 1.0 官方原版 ======",
        "====== 正在恢复 Antigravity IDE / 1.0 官方原版 ======": "====== 正在恢復 Antigravity IDE / 1.0 官方原版 ======",
        "====== 正在安装 VS Code / 外部编辑器扩展汉化 ======": "====== 正在安裝 VS Code / 外部編輯器擴充功能繁體漢化 ======",
        "====== 正在恢复 VS Code / 外部编辑器扩展官方原版 ======": "====== 正在恢復 VS Code / 外部編輯器擴充功能官方原版 ======",
        "[1] 检测到 Antigravity 客户端正在运行，正在关闭以解除文件锁...": "[1] 偵測到 Antigravity 用戶端正在執行，正在關閉以解除檔案鎖...",
        "[1] 检测到 Antigravity 相关进程正在运行，正在关闭以解除文件锁...": "[1] 偵測到 Antigravity 相關進程正在執行，正在關閉以解除檔案鎖...",
        "[1] 正在关闭 Antigravity 运行进程以解除文件锁...": "[1] 正在關閉 Antigravity 執行進程以解除檔案鎖...",
        "[备份] 检测到全新官方英文版本，正在同步创建/更新官方备份包: ": "[備份] 偵測到全新官方英文版本，正在同步建立/更新官方備份包: ",
        "[备份] 正在创建官方原始包备份: app.asar.bak ...": "[備份] 正在建立官方原始包備份: app.asar.bak ...",
        "[缓存] 已自动清理 ": "[快取] 已自動清理 ",
        " 个应用缓存目录，避免新旧版本字节码冲突。": " 個應用程式快取目錄，避免新舊版本位元組碼衝突。",
        "[签名] 已同步更新 macOS Info.plist 中的 ElectronAsarIntegrity 校验值。": "[簽名] 已同步更新 macOS Info.plist 中的 ElectronAsarIntegrity 校驗值。",
        "[备份] 备份成功！": "[備份] 備份成功！",
        "[备份] 已创建旧版 HTML 备份: ": "[備份] 已建立舊版 HTML 備份: ",
        "[备份] 已创建旧版/IDE HTML 备份: ": "[備份] 已建立舊版/IDE HTML 備份: ",
        "[解包] 正在使用 npx 提取 app.asar...": "[解包] 正在使用 npx 提取 app.asar...",
        "[极速补丁] 正在执行内存级 ASAR 外科手术注入...": "[極速修補] 正在執行記憶體級 ASAR 外科手術注入...",
        "[极速补丁] ASAR 外科手术注入完成，耗时 ": "[極速修補] ASAR 外科手術注入完成，耗時 ",
        "[修改] 正在向 preload.js 注入汉化代码...": "[修改] 正在向 preload.js 注入漢化程式碼...",
        "[修改] 注入成功！": "[修改] 注入成功！",
        "[修改] 正在向 menu.js 注入菜单汉化代码...": "[修改] 正在向 menu.js 注入選單漢化程式碼...",
        "[修改] 菜单汉化注入成功！": "[修改] 選單漢化注入成功！",
        "[修改] 正在向 tray.js 注入任务栏菜单汉化...": "[修改] 正在向 tray.js 注入系統匣選單漢化...",
        "[修改] 任务栏菜单汉化注入成功！": "[修改] 系統匣選單漢化注入成功！",
        "[修改] 正在向 loadingOverlay.js 注入加载页汉化...": "[修改] 正在向 loadingOverlay.js 注入載入頁漢化...",
        "[修改] 加载页汉化注入成功！": "[修改] 載入頁漢化注入成功！",
        "[修改] 正在向 updater.js 注入更新弹窗汉化...": "[修改] 正在向 updater.js 注入更新彈出視窗漢化...",
        "[修改] 更新弹窗汉化注入成功！": "[修改] 更新彈出視窗漢化注入成功！",
        "[打包] 正在将修改后的内容打包回 app.asar...": "[打包] 正在將修改後的內容打包回 app.asar...",
        "[√] Antigravity 2.0 汉化部署完成！": "[√] Antigravity 2.0 繁體中文化套用完成！",
        "[√] Antigravity 1.0 汉化部署完成！": "[√] Antigravity 1.0 繁體中文化套用完成！",
        "[√] Antigravity IDE / 1.0 汉化部署完成！": "[√] Antigravity IDE / 1.0 繁體中文化套用完成！",
        "[√] 扩展汉化部署完成: ": "[√] 擴充功能繁體中文化套用完成: ",
        "[√] 扩展已恢复官方英文原版: ": "[√] 擴充功能已還原官方英文原版: ",
        "[!] 未找到备份文件 app.asar.bak，可能尚未安装过汉化或备份被删除。": "[!] 未找到備份檔案 app.asar.bak，可能尚未安裝過繁中化或備份已被刪除。",
        "[还原] 正在用官方备份文件恢复...": "[還原] 正在使用官方備份檔案還原...",
        "[还原] 已重置当前 app.asar 为官方原始备份包，以进行全新注入...": "[還原] 已重設目前 app.asar 為官方原始備份包，以進行全新注入...",
        "[权限] 检测到当前用户对 macOS 应用目录缺少写入权限，正在尝试请求管理员权限 (sudo) 重新运行...": "[權限] 偵測到目前使用者對 macOS 應用程式目錄缺少寫入權限，正在嘗試請求管理員權限 (sudo) 重新執行...",
        "[提示] 当前 app.asar 被锁定（可能是客户端正在运行），将使用当前包进行增量注入。": "[提示] 目前 app.asar 被鎖定（可能是應用程式正在執行），將使用目前包進行增量注入。",
        "[还原] 已恢复 HTML: ": "[還原] 已還原 HTML: ",
        "[还原] 已删除汉化脚本": "[還原] 已刪除中文化腳本",
        "[√] 官方 app.asar 已成功恢复！": "[√] 官方 app.asar 已成功還原！",
        "[√] 校验值已同步，1.0 软件恢复至原始状态。": "[√] 校驗值已同步，1.0 軟體已還原至原始狀態。",
        "[√] 校验值已同步，IDE / 1.0 软件恢复至原始状态。": "[√] 校驗值已同步，IDE / 1.0 軟體已還原至原始狀態。",
        "[错误] 手动指定的路径不存在:": "[錯誤] 手動指定的路徑不存在:",
        "[错误] 未在资源目录中找到 app.asar:": "[錯誤] 未在資源目錄中找到 app.asar:",
        "[错误] 解压后未能在指定路径找到 preload.js:": "[錯誤] 解壓後未能在指定路徑找到 preload.js:",
        "[错误] 无法定位有效的资源(resources)目录:": "[錯誤] 無法定位有效的資源(resources)目錄:",
        "[错误] 无法定位有效的资源(resources)目录: ": "[錯誤] 無法定位有效的資源(resources)目錄: ",
        "[错误] 解包失败，可能是由于系统未安装 Node.js/npm 或者网络限制。": "[錯誤] 解包失敗，可能是由於系統未安裝 Node.js/npm 或者網路限制。",
        "[错误] 打包失败。": "[錯誤] 打包失敗。",
        "[警告] 未能在 menu.js 中找到设定的插入点。": "[警告] 未能在 menu.js 中找到設定的插入點。",
        "[签名] 检测到 macOS 平台，正在对应用包进行本地 ad-hoc 深度重签名: ": "[簽名] 偵測到 macOS 平台，正在對應用程式包進行本機 ad-hoc 深度重新簽名: ",
        "[签名] 重新签名成功！": "[簽名] 重新簽名成功！",
        "[警告] 重新签名失败。可能会导致应用无法打开。": "[警告] 重新簽名失敗。可能會導致應用程式無法開啟。",
        "[警告] 未能从路径 ": "[警告] 未能從路徑 ",
        " 识别到有效的 .app 路径，跳过重新签名。": " 識別到有效的 .app 路徑，跳過重新簽名。",
        "[探测] 成功自动识别到 Antigravity 安装目录: ": "[偵測] 成功自動識別到 Antigravity 安裝目錄: ",
        "[错误] 未找到默认安装目录，请使用 --install-dir 手动指定您的安装路径！": "[錯誤] 未找到預設安裝目錄，請使用 --install-dir 手動指定您的安裝路徑！",
        "[!] 未找到 1.0 备份文件。": "[!] 未找到 1.0 備份檔案。",
        "详情: ": "詳情: ",
        "[√] 注入成功: ": "[√] 注入成功: ",
        "[跳过] 检测到 --no-kill 参数，跳过关闭 Antigravity 运行进程。": "[跳過] 偵測到 --no-kill 參數，跳過關閉 Antigravity 執行進程。",
        "[启动] 检测到安装前反重力客户端处于开启状态，正在重新启动客户端...": "[啟動] 偵測到安裝前反重力用戶端處於開啟狀態，正在重新啟動用戶端...",
        "[启动] 客户端启动成功！": "[啟動] 用戶端啟動成功！",
        "[警告] 未找到客户端主程序: ": "[警告] 未找到用戶端主程式: ",
        "[警告] 客户端启动失败: ": "[警告] 用戶端啟動失敗: ",
        "[代理] 检测到 proxy_config 配置目录，正在注入代理模块...": "[代理] 偵測到 proxy_config 設定目錄，正在注入代理模組...",
        "[代理] 代理模块注入成功: ": "[代理] 代理模組注入成功: ",
        "[代理] 已清理代理注入文件: ": "[代理] 已清理代理注入檔案: ",
        "[代理警告] 注入文件 ": "[代理警告] 注入檔案 ",
        "[代理警告] 移除代理文件 ": "[代理警告] 移除代理檔案 ",
        "[主题] 检测到 theme_patch 目录，正在同步部署船板主题与实时遥测守护服务...": "[主題] 偵測到 theme_patch 目錄，正在同步部署船板主題與即時遙測守護服務...",
        "[主题] 船板主题与实时遥测守护服务部署完成！": "[主題] 船板主題與即時遙測守護服務部署完成！",
        "[主题] 已清理旧版 ~/.antigravity-patch 遗留守护进程与目录。": "[主題] 已清理舊版 ~/.antigravity-patch 遺留守護進程與目錄。",
        "[主题] 正在卸载船板主题与实时遥测守护服务...": "[主題] 正在卸載船板主題與即時遙測守護服務...",
        "[主题跳过] 当前 Node.js 版本低于 22.0.0，跳过船板主题服务部署: ": "[主題跳過] 目前 Node.js 版本低於 22.0.0，跳過船板主題服務部署: ",
        "[主题警告] 船板主题服务执行异常: ": "[主題警告] 船板主題服務執行異常: "
    };
    const translateMsg = (args) => {
        return args.map(arg => {
            if (typeof arg === 'string') {
                let res = arg;
                for (const [k, v] of Object.entries(logTranslations)) {
                    if (res.includes(k)) {
                        res = res.split(k).join(v);
                    }
                }
                return res;
            }
            return arg;
        });
    };
    const origLog = console.log;
    const origError = console.error;
    const origWarn = console.warn;
    console.log = (...args) => origLog(...translateMsg(args));
    console.error = (...args) => origError(...translateMsg(args));
    console.warn = (...args) => origWarn(...translateMsg(args));
}

const SIGNATURE_START = "/* --- ANTIGRAVITY CHINESE LOCALIZATION START --- */";
const SIGNATURE_END = "/* --- ANTIGRAVITY CHINESE LOCALIZATION END --- */";

function normalizeText(text) {
    if (!text) return "";
    return text.replace(/\s+/g, ' ')
               .trim()
               .replace(/’/g, "'")
               .replace(/‘/g, "'")
               .replace(/“/g, '"')
               .replace(/”/g, '"')
               .replace(/…/g, '...');
}

function loadDictionary(folderOverride) {
    const totalMap = {};
    const targetFolder = folderOverride || DICTS_FOLDER;
    const dictsDir = path.join(__dirname, targetFolder);
    if (fs.existsSync(dictsDir)) {
        const files = fs.readdirSync(dictsDir).sort();
        for (const file of files) {
            if (file.endsWith('.json')) {
                try {
                    const filePath = path.join(dictsDir, file);
                    const fileContent = fs.readFileSync(filePath, 'utf-8');
                    const data = JSON.parse(fileContent);
                    for (const [k, v] of Object.entries(data)) {
                        const normK = normalizeText(k);
                        if (normK) totalMap[normK] = v;
                    }
                } catch (e) {
                    // ignore
                }
            }
        }
    }
    if (BRAND_TITLE_MODE === 'english') {
        delete totalMap[normalizeText('Antigravity')];
    } else if (BRAND_TITLE_MODE === 'hidden') {
        totalMap[normalizeText('Antigravity')] = '';
    }
    return totalMap;
}

function generateJs() {
    const fullDict = loadDictionary();
    const dictJson = JSON.stringify(fullDict, null, 4);
    const altDictJson = EMBED_DUAL_ZH
        ? JSON.stringify(loadDictionary(USE_TW ? 'dicts' : 'dicts_tw'), null, 4)
        : "null";
    const initConfigJson = JSON.stringify({
        defaultLang: USE_TW ? 'zh-tw' : 'zh-cn',
        altLang: USE_TW ? 'zh-cn' : 'zh-tw',
        embedDualZh: Boolean(EMBED_DUAL_ZH),
        keepOptionNamesEn: Boolean(KEEP_OPTION_NAMES_EN),
        hideFloatBtn: Boolean(HIDE_FLOAT_BTN)
    });

    const jsSource = `(() => {
    // V13.0 免重启热切换增强版：基于容器回溯物理隔离 + WeakMap 原文快照无损还原引擎
    const CURRENT_SCRIPT_EL = (typeof document !== 'undefined' && document.currentScript) ? document.currentScript : null;
    const SCRIPT_SRC_URL = (CURRENT_SCRIPT_EL && CURRENT_SCRIPT_EL.src) ? String(CURRENT_SCRIPT_EL.src) : '';
    const INIT_CONFIG = INIT_CONFIG_PLACEHOLDER;
    let langMode = INIT_CONFIG.defaultLang;
    let lastZhLang = INIT_CONFIG.defaultLang;
    let USE_TW = (langMode === 'zh-tw');
    let keepOptionNamesEn = Boolean(INIT_CONFIG.keepOptionNamesEn);
    let floatBtnHidden = Boolean(INIT_CONFIG.hideFloatBtn);
    let currentModeKey = langMode + ':' + (keepOptionNamesEn ? '1' : '0');

    const MAIN_DICT_RAW = DICT_MAIN_PLACEHOLDER;
    const ALT_DICT_RAW = DICT_ALT_PLACEHOLDER;
    const dictCache = {
        'zh-cn': INIT_CONFIG.defaultLang === 'zh-cn' ? MAIN_DICT_RAW : ALT_DICT_RAW,
        'zh-tw': INIT_CONFIG.defaultLang === 'zh-tw' ? MAIN_DICT_RAW : ALT_DICT_RAW
    };
    const LOWER_WORDS_EXCLUDE = new Set(['on', 'in', 'to', 'at', 'by', 'for', 'with', 'as', 'system', 'review', 'active', 'browser', 'global', 'including', 'and', 'or', 'file', 'files', 'help', 'app', 'plan', 'search']);

    let map = new Map();
    let lowerMap = new Map();
    let longEntries = [];

    function rebuildActiveMaps(targetLang) {
        const activeObj = dictCache[targetLang] || dictCache[INIT_CONFIG.defaultLang] || {};
        map = new Map(Object.entries(activeObj));
        lowerMap = new Map();
        for (const [k, v] of map.entries()) {
            const lowerK = k.toLowerCase();
            if (LOWER_WORDS_EXCLUDE.has(lowerK) && k !== lowerK) {
                continue;
            }
            lowerMap.set(lowerK, v);
        }
        longEntries = Array.from(map.entries())
            .filter(([k]) => k.length > 15 && k.includes(' '))
            .sort((a, b) => b[0].length - a[0].length);
    }

    rebuildActiveMaps(langMode);

    const originalTextMap = new WeakMap();
    const translatedValues = new WeakMap();
    const elementAttrMap = new WeakMap();
    const shadowRoots = new Set();

    // 轻量级安全隔离：跳过脚本、样式、代码块(pre/code)
    const SKIP_TAGS = ['SCRIPT', 'STYLE', 'PRE', 'CODE'];

    // 代码、富文本输入框及对话内容隔离选择器：排除 Lexical 输入框、用户消息、AI 响应正文、思考内容、代码块、终端及文件路径
    const CODE_ISOLATION_SELECTOR = 'pre, code, .monaco-editor, .cm-editor, .cm-line, [contenteditable="true"], [contenteditable="plaintext-only"], [contenteditable=""], [data-lexical-editor], .terminal, .xterm, .code-line, .code-block, .line-content, [aria-label="File Viewer"], [data-file-uri], [data-uri], [class*="diffEditor"], .token, .hljs, [class*="mtk"], .font-mono, [data-quotable-inline="true"], .context-scope-mention, [data-testid="file-title-name"], [data-testid="entity-pill"], [data-project-card="true"], [data-testid="conversation-row-sidebar"] span.truncate, [translate="no"], .notranslate, .md-divider-spacing, .cursor-edit, [data-testid="user-input-step"] [data-quotable="true"], [data-testid="user-input-step"] .whitespace-pre-wrap, [data-testid="planner-response-text"], [data-testid="thinking-collapsible-trigger"] + div, [data-testid="thinking-collapsible-trigger"] ~ div';

    function isCodeOrEditor(node) {
        try {
            if (!node) return false;
            let el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
            if (!el) return false;
            if (el.isContentEditable) return true;
            const active = document.activeElement;
            if (active && (active.isContentEditable || active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || (active.getAttribute && active.getAttribute('data-lexical-editor') === 'true')) && (active === el || active.contains(el))) {
                return true;
            }
            while (el) {
                if (el.isContentEditable) return true;
                if (typeof el.closest === 'function' && el.closest(CODE_ISOLATION_SELECTOR)) {
                    return true;
                }
                const root = typeof el.getRootNode === 'function' ? el.getRootNode() : null;
                el = (root && root.host) ? root.host : null;
            }
            return false;
        } catch (e) {
            return false;
        }
    }

    function norm(s) {
        if (!s) return '';
        return s.replace(/\\s+/g, ' ').replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/…/g, '...').trim();
    }

    function translateWithShortcut(val) {
        if (!val) return null;
        const match = val.match(/^(.+?)\\s*\\(((?:Ctrl|Cmd|Alt|Shift|⌘|⌥|⇧|⌃)\\+?[^)]*|Enter|Escape|Esc|Space|Tab|Backspace|Delete|⏎|Aa|ab|\\.\\*|-|0|[a-zA-Z0-9])\\)$/i);
        if (match) {
            const prefix = match[1].trim();
            const normPref = norm(prefix);
            const lowerPref = normPref.toLowerCase();
            let transPref = null;
            if (map.has(normPref)) {
                transPref = map.get(normPref);
            } else if (lowerMap.has(lowerPref)) {
                transPref = lowerMap.get(lowerPref);
            }
            if (transPref) {
                return transPref + " (" + match[2] + ")";
            }
        }
        return null;
    }

    // ==========================================
    // 原生系统右键菜单 (Native Context Menu) 汉化拦截
    // ==========================================
    function translateContextMenuLabel(label) {
        if (!label || typeof label !== 'string') return label;
        let trimmed = norm(label);
        if (!trimmed) return label;

        let isDefault = false;
        if (/\\s*\\((?:Default|預設|默认)\\)$/i.test(trimmed)) {
            trimmed = trimmed.replace(/\\s*\\((?:Default|預設|默认)\\)$/i, '').trim();
            isDefault = true;
        }

        let translated = null;
        const shortcutTrans = translateWithShortcut(trimmed);
        if (shortcutTrans) {
            translated = shortcutTrans;
        } else if (map.has(trimmed)) {
            translated = map.get(trimmed);
        } else if (lowerMap.has(trimmed.toLowerCase())) {
            translated = lowerMap.get(trimmed.toLowerCase());
        }

        if (translated) {
            return isDefault ? (translated + (USE_TW ? " (預設)" : " (默认)")) : translated;
        } else if (isDefault) {
            return trimmed + (USE_TW ? " (預設)" : " (默认)");
        }
        return label;
    }

    function translateContextMenuItems(items) {
        if (langMode === 'en' || !Array.isArray(items)) return items;
        return items.map(item => {
            if (!item || typeof item !== 'object') return item;
            const newItem = Object.assign({}, item);
            if (newItem.label) {
                newItem.label = translateContextMenuLabel(newItem.label);
            }
            if (Array.isArray(newItem.submenu)) {
                newItem.submenu = translateContextMenuItems(newItem.submenu);
            }
            if (Array.isArray(newItem.items)) {
                newItem.items = translateContextMenuItems(newItem.items);
            }
            return newItem;
        });
    }

    function hookNativeContextMenu() {
        try {
            const electronModule = typeof electron_1 !== 'undefined' ? electron_1 : (typeof require === 'function' ? require('electron') : null);
            if (electronModule && electronModule.ipcRenderer && !electronModule.ipcRenderer._cnContextMenuHooked) {
                electronModule.ipcRenderer._cnContextMenuHooked = true;
                const origInvoke = electronModule.ipcRenderer.invoke.bind(electronModule.ipcRenderer);
                electronModule.ipcRenderer.invoke = function(channel, ...args) {
                    if (langMode !== 'en' && channel === 'window:show-context-menu' && Array.isArray(args[0])) {
                        try {
                            args[0] = translateContextMenuItems(args[0]);
                        } catch (e) {}
                    }
                    return origInvoke(channel, ...args);
                };
            }
        } catch (e) {}

        try {
            if (typeof window !== 'undefined' && window.electronNative && !window.electronNative._cnContextMenuHooked) {
                const origShow = window.electronNative.showContextMenu;
                if (typeof origShow === 'function') {
                    window.electronNative._cnContextMenuHooked = true;
                    window.electronNative.showContextMenu = function(items) {
                        if (langMode !== 'en') {
                            try {
                                items = translateContextMenuItems(items);
                            } catch (e) {}
                        }
                        return origShow.call(this, items);
                    };
                }
            }
        } catch (e) {}
    }

    hookNativeContextMenu();

    function isFilePathOrUri(s) {
        if (!s) return false;
        return /^[a-zA-Z]:[\\\\/]/.test(s) || /^[\\\\/~].*[\\\\/]/.test(s) || /[\\\\/]SKILL\\.md/i.test(s) || /[\\\\/]\\.gemini[\\\\/]/i.test(s) || /^file:\\/\\//i.test(s);
    }

    function peekOriginalText(tn) {
        if (!tn) return '';
        const cur = tn.nodeValue || '';
        const lastT = translatedValues.get(tn);
        if (lastT !== undefined && cur === lastT) {
            const orig = originalTextMap.get(tn);
            return orig !== undefined ? orig : cur;
        }
        return cur;
    }

    function getElementOriginalText(el) {
        if (!el) return '';
        if (!el.childNodes || el.childNodes.length === 0) return el.textContent || '';
        let out = '';
        for (const c of el.childNodes) {
            if (c.nodeType === Node.TEXT_NODE) {
                out += peekOriginalText(c);
            } else if (c.nodeType === Node.ELEMENT_NODE) {
                out += getElementOriginalText(c);
            }
        }
        return out;
    }

    function applyNodeTranslation(tn, newVal) {
        const cur = tn.nodeValue;
        const lastT = translatedValues.get(tn);
        if (lastT === undefined || cur !== lastT) {
            originalTextMap.set(tn, cur);
        }
        translatedValues.set(tn, newVal);
        tn._agModeKey = currentModeKey;
        if (cur !== newVal) {
            tn.nodeValue = newVal;
        }
    }

    function isSettingOptionTitleNode(textNode) {
        if (!keepOptionNamesEn || !textNode || !textNode.parentElement) return false;
        const el = textNode.parentElement;
        if (typeof el.closest !== 'function') return false;
        // 绝不拦截页面主标题(h1/h2)、分节标题(h3)、导航标签、按钮、下拉项、徽章或右侧控件区
        if (el.closest('h1, h2, h3, nav, button, a, select, option, input, textarea, code, pre, kbd, [role="tablist"], [role="tab"], [role="navigation"], [role="menu"], [role="menuitem"], [data-testid="settings-row-badge"], .shrink-0, .setting-item-description, [class*="description"], [class*="subtitle"]')) {
            return false;
        }
        if (el.closest('.setting-item-label, .setting-item-category, .setting-item-title')) {
            return true;
        }
        const tag = (el.tagName || '').toUpperCase();
        const cls = typeof el.className === 'string' ? el.className : '';
        if (/\\bmuted-foreground\\b/.test(cls)) {
            if (/\\btext-(?:xs|sm)\\b/.test(cls) || !el.closest('[data-disabled="true"]')) {
                return false;
            }
        }
        if (el.hasAttribute && el.hasAttribute('data-setting-title')) {
            return true;
        }
        // 精确匹配 Antigravity v2.31+ UP 设置行标题：通过 aria-labelledby 关联或左侧主列首行标题容器
        if (el.id) {
            const rowScope = el.closest('.agy-card > div, [data-testid$="-setting-row"], .justify-between');
            if (rowScope && rowScope.querySelector) {
                const safeId = String(el.id).replace(/"/g, '');
                if (safeId && rowScope.querySelector('[aria-labelledby="' + safeId + '"]')) {
                    return true;
                }
            }
        }
        const titleLine = el.closest('.flex.items-center');
        const leftCol = titleLine ? titleLine.parentElement : el.parentElement;
        const rowContainer = leftCol ? leftCol.parentElement : null;
        if (leftCol && rowContainer && typeof leftCol.className === 'string' && /\\bflex-col\\b/.test(leftCol.className)) {
            const rowCls = typeof rowContainer.className === 'string' ? rowContainer.className : '';
            const inCardOrSettingRow = Boolean(rowContainer.closest('.agy-card')) || /\\bjustify-between\\b/.test(rowCls);
            const isFirstHeaderChild = (titleLine && leftCol.firstElementChild === titleLine) || leftCol.firstElementChild === el;
            if (inCardOrSettingRow && isFirstHeaderChild && !/\\btext-(?:xs|sm)\\b/.test(cls)) {
                const hasDescInCol = Boolean(leftCol.querySelector && leftCol.querySelector('[class*="muted-foreground"], p, .text-xs, .text-sm'));
                const hasRightCtrl = Boolean(rowContainer.querySelector && rowContainer.querySelector('.shrink-0, [role="switch"], [role="combobox"], input, select, textarea, button'));
                if (hasDescInCol || hasRightCtrl) {
                    return true;
                }
            }
        }
        // 兼容表单型 <label> 或粗体设置项标题
        if (tag === 'LABEL' && !(el.querySelector && el.querySelector('input'))) {
            const fieldWrap = el.parentElement;
            if (fieldWrap && fieldWrap.querySelector && fieldWrap.querySelector('input, select, textarea, [role="switch"], [role="combobox"], [class*="muted-foreground"]')) {
                return true;
            }
        }
        if (/\\bfont-(?:medium|semibold)\\b/.test(cls) && !/\\btext-xs\\b/.test(cls)) {
            const parent = el.parentElement;
            if (!parent) return false;
            const row = parent.parentElement || parent;
            const hasDescSibling = Boolean(parent.querySelector && parent.querySelector('p, .text-xs, [class*="muted-foreground"], [class*="description"]'));
            const hasControlInRow = Boolean(row.querySelector && row.querySelector('[role="switch"], [role="combobox"], input, select, textarea'));
            return hasDescSibling && hasControlInRow;
        }
        return false;
    }

    function restoreSubtreeToEnglish(node) {
        try {
            if (!node) return;
            if (node.nodeType === Node.ELEMENT_NODE) {
                if (node.id === '__ag_hanhua_float_host__' || (node.hasAttribute && node.hasAttribute('data-ag-ui'))) return;
                const attrRecMap = elementAttrMap.get(node);
                if (attrRecMap) {
                    for (const attr of ['placeholder', 'title', 'aria-label']) {
                        const rec = attrRecMap[attr];
                        if (rec) {
                            if (node.getAttribute(attr) === rec.trans) {
                                node.setAttribute(attr, rec.orig);
                            }
                            node.removeAttribute('data-ag-orig-' + attr);
                        }
                    }
                    elementAttrMap.delete(node);
                }
                if (node.shadowRoot) {
                    shadowRoots.add(node.shadowRoot);
                    restoreSubtreeToEnglish(node.shadowRoot);
                }
                for (const child of node.childNodes) {
                    restoreSubtreeToEnglish(child);
                }
            } else if (node.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
                for (const child of node.childNodes) {
                    restoreSubtreeToEnglish(child);
                }
            } else if (node.nodeType === Node.TEXT_NODE) {
                if (translatedValues.has(node)) {
                    const lastTrans = translatedValues.get(node);
                    const orig = originalTextMap.get(node);
                    if (orig !== undefined && node.nodeValue === lastTrans) {
                        node.nodeValue = orig;
                    }
                    translatedValues.delete(node);
                    node._agModeKey = '';
                }
            }
        } catch (e) {}
    }

    function translateNode(node) {
        try {
            if (!node || langMode === 'en') return;
            
            if (node.nodeType === Node.DOCUMENT_FRAGMENT_NODE) {
                for (const child of node.childNodes) translateNode(child);
                return;
            }

            if (node.nodeType === Node.ELEMENT_NODE) {
                if (node.id === '__ag_hanhua_float_host__' || (node.hasAttribute && node.hasAttribute('data-ag-ui'))) return;
                const tag = node.tagName.toUpperCase();
                if (SKIP_TAGS.includes(tag)) return;

                // 翻译属性：placeholder, title, aria-label（带无损快照）
                for (const attr of ['placeholder', 'title', 'aria-label']) {
                    const curAttr = node.getAttribute(attr);
                    if (curAttr) {
                        let attrRecMap = elementAttrMap.get(node);
                        let v = curAttr;
                        if (attrRecMap && attrRecMap[attr]) {
                            const rec = attrRecMap[attr];
                            if (curAttr === rec.trans) {
                                if (rec.modeKey === currentModeKey) continue;
                                v = rec.orig;
                            } else {
                                rec.orig = curAttr;
                                v = curAttr;
                            }
                        }
                        if (!/[A-Za-z]/.test(v)) continue;
                        const t = norm(v);
                        if (isFilePathOrUri(t)) continue;
                        let newAttr = null;
                        const shortcutTrans = translateWithShortcut(t);
                        if (shortcutTrans) newAttr = shortcutTrans;
                        else if (map.has(t)) newAttr = map.get(t);
                        else if (lowerMap.has(t.toLowerCase())) newAttr = lowerMap.get(t.toLowerCase());
                        else if (/^Show\\s+(\\d+)\\s+more/i.test(t)) {
                            newAttr = t.replace(/^Show\\s+(\\d+)\\s+more(\\s+(results?|items?|commands?|options?))?(\\.\\.\\.|…)?$/i, (m, num, p2, type) => {
                                if (type) {
                                    if (/result/i.test(type)) return USE_TW ? ("顯示另外 " + num + " 個結果...") : ("显示另外 " + num + " 个结果...");
                                    if (/command/i.test(type)) return USE_TW ? ("顯示另外 " + num + " 個命令...") : ("显示另外 " + num + " 个命令...");
                                    if (/item/i.test(type)) return USE_TW ? ("顯示另外 " + num + " 個項目...") : ("显示另外 " + num + " 个项目...");
                                    if (/option/i.test(type)) return USE_TW ? ("顯示另外 " + num + " 個選項...") : ("显示另外 " + num + " 个选项...");
                                }
                                return USE_TW ? ("顯示另外 " + num + " 個...") : ("显示另外 " + num + " 个...");
                            });
                        } else if (/^Show\\s+(\\d+)\\s+breakdown(s)?$/i.test(t)) {
                            newAttr = t.replace(/^Show\\s+(\\d+)\\s+breakdown(s)?$/i, (m, num) => {
                                return USE_TW ? ("顯示 " + num + " 項明細") : ("显示 " + num + " 项细目");
                            });
                        } else if (/^Hide\\s+breakdown(s)?$/i.test(t)) {
                            newAttr = USE_TW ? "收起明細" : "收起细目";
                        } else if (/^See\\s+(\\d+)\\s+more(?:\\s+(.+))?$/i.test(t)) {
                            newAttr = t.replace(/^See\\s+(\\d+)\\s+more(?:\\s+(.+))?$/i, (m, num) => {
                                return USE_TW ? ("展開另外 " + num + " 項") : ("展开另外 " + num + " 项");
                            });
                        } else if (/^See\\s+more\\s+in\\s+(.+)$/i.test(t)) {
                            newAttr = t.replace(/^See\\s+more\\s+in\\s+(.+)$/i, (m, name) => {
                                return USE_TW ? ("在 " + name + " 中展開更多") : ("在 " + name + " 中展开更多");
                            });
                        } else if (/^(?:(Permanently delete)\\s+)?(.+?)\\s+including\\s+(\\d+)\\s+active conversations?([.。])?$/i.test(t)) {
                            newAttr = t.replace(/^(?:(Permanently delete)\\s+)?(.+?)\\s+including\\s+(\\d+)\\s+active conversations?([.。])?$/i, (match, del, name, count, dot) => {
                                const delPrefix = del ? (USE_TW ? "永久刪除 " : "永久删除 ") : "";
                                const suffix = dot ? "。" : "";
                                return delPrefix + name + (USE_TW ? ("（包含 " + count + " 個活躍對話）") : ("（包含 " + count + " 个活跃会话）")) + suffix;
                            });
                        }
                        if (newAttr && newAttr !== v) {
                            if (!attrRecMap) {
                                attrRecMap = {};
                                elementAttrMap.set(node, attrRecMap);
                            }
                            attrRecMap[attr] = { orig: v, trans: newAttr, modeKey: currentModeKey };
                            if (!node.hasAttribute('data-ag-orig-' + attr)) {
                                node.setAttribute('data-ag-orig-' + attr, v);
                            }
                            if (curAttr !== newAttr) {
                                node.setAttribute(attr, newAttr);
                            }
                        }
                    }
                }

                if (isCodeOrEditor(node)) return;
                if (node.isContentEditable) return;
                if (node.classList && (node.classList.contains('monaco-editor') || node.classList.contains('terminal') || node.classList.contains('xterm'))) return;

                // 处理 FastPick / 列表底部的 "Show <N> more..." 复合节点
                const elText = getElementOriginalText(node).trim();
                if (/^Show\\s+\\d+\\s+more(?:\\.\\.\\.|…)?$/i.test(elText)) {
                    const textChildren = Array.from(node.childNodes).filter(c => c.nodeType === Node.TEXT_NODE);
                    if (textChildren.length >= 2) {
                        for (const tc of textChildren) {
                            const v = peekOriginalText(tc);
                            if (v === 'Show ' || norm(v) === 'Show') {
                                applyNodeTranslation(tc, USE_TW ? '顯示另外 ' : '显示另外 ');
                            } else if (v === ' more...' || v === ' more…' || norm(v) === 'more...') {
                                applyNodeTranslation(tc, USE_TW ? ' 個...' : ' 个...');
                            }
                        }
                    } else if (textChildren.length === 1) {
                        const m = elText.match(/^Show\\s+(\\d+)\\s+more(?:\\.\\.\\.|…)?$/i);
                        if (m) {
                            applyNodeTranslation(textChildren[0], USE_TW ? ('顯示另外 ' + m[1] + ' 個...') : ('显示另外 ' + m[1] + ' 个...'));
                        }
                    }
                }

                if (node.shadowRoot) {
                    shadowRoots.add(node.shadowRoot);
                    translateNode(node.shadowRoot);
                }
                for (const child of node.childNodes) translateNode(child);

            } else if (node.nodeType === Node.TEXT_NODE) {
                if (isCodeOrEditor(node)) return;
                if (node.parentElement && typeof node.parentElement.closest === 'function' && node.parentElement.closest('#__ag_hanhua_float_host__, [data-ag-ui]')) return;

                const curRawVal = node.nodeValue;
                const prevTrans = translatedValues.get(node);
                if (prevTrans !== undefined && curRawVal === prevTrans && node._agModeKey === currentModeKey) {
                    return;
                }

                let originalVal = curRawVal;
                if (prevTrans !== undefined) {
                    if (curRawVal === prevTrans) {
                        const savedOrig = originalTextMap.get(node);
                        if (savedOrig !== undefined) originalVal = savedOrig;
                    } else {
                        originalTextMap.set(node, curRawVal);
                        translatedValues.delete(node);
                    }
                }

                if (!originalVal || originalVal.trim().length < 1) return;
                if (!/[A-Za-z]/.test(originalVal)) return;

                if (keepOptionNamesEn && isSettingOptionTitleNode(node)) {
                    if (prevTrans !== undefined && curRawVal === prevTrans) {
                        node.nodeValue = originalVal;
                        translatedValues.delete(node);
                        node._agModeKey = '';
                    }
                    return;
                }

                // 处理 FastPick / 列表底部由于 React 节点拆分导致的 "Show ", num, " more..." 分段文本
                const parentText = node.parentElement ? getElementOriginalText(node.parentElement).trim() : '';
                if (isFilePathOrUri(originalVal.trim()) || isFilePathOrUri(parentText)) return;
                if (parentText && (
                    /^(?:Show|显示另外|顯示另外)\\s+\\d+\\s+(?:more|个|個)(?:\\.\\.\\.|…)?$/i.test(parentText) ||
                    (node.parentElement.getAttribute && node.parentElement.getAttribute('value')?.startsWith('fastpick-show-more:'))
                )) {
                    if (originalVal === 'Show ' || norm(originalVal) === 'Show') {
                        applyNodeTranslation(node, USE_TW ? '顯示另外 ' : '显示另外 ');
                        return;
                    }
                    if (originalVal === ' more...' || originalVal === ' more…' || norm(originalVal) === 'more...') {
                        applyNodeTranslation(node, USE_TW ? ' 個...' : ' 个...');
                        return;
                    }
                }

                // 核心：如果是 skeleton 骨架占位文本，强制打上不翻译标记，防止自动翻译（例如 Google Translate 网页翻译）将其翻译为“装。资料。包装。资料。”
                if (originalVal.toLowerCase().includes('pack.info')) {
                    const parent = node.parentElement;
                    if (parent) {
                        if (parent.getAttribute('translate') !== 'no') {
                            parent.setAttribute('translate', 'no');
                        }
                        try {
                            if (!parent.classList.contains('notranslate')) {
                                parent.classList.add('notranslate');
                            }
                        } catch (e) {}
                    }
                    return;
                }

                let newVal = originalVal;
                const valNorm = norm(originalVal);
                const valLower = valNorm.toLowerCase();
                
                // 1. 精确匹配（含大小写自动纠正与快捷键检测）
                const shortcutTrans = translateWithShortcut(valNorm);
                if (shortcutTrans) {
                    newVal = shortcutTrans;
                } else if (map.has(valNorm)) {
                    newVal = map.get(valNorm);
                } else if (lowerMap.has(valLower)) {
                    newVal = lowerMap.get(valLower);
                } else if (/^Send message\\s+(Enter|⏎|\\u23ce)$/i.test(valNorm)) {
                    newVal = (USE_TW ? "發送消息 " : "发送消息 ") + valNorm.replace(/^Send message\\s+/i, '');
                } else if (/^Queue message\\s+(Enter|⏎|\\u23ce)$/i.test(valNorm)) {
                    newVal = (USE_TW ? "排隊發送消息 " : "排队发送消息 ") + valNorm.replace(/^Queue message\\s+/i, '');
                } else if (/^to have the agent generate a plan\\.?$/i.test(valNorm)) {
                    newVal = USE_TW ? "讓代理生成計劃。" : "让智能体生成计划。";
                } else if ((valNorm === 'Type' || valNorm === 'and select') && node.parentElement && (
                    (typeof node.parentElement.closest === 'function' && node.parentElement.closest('[data-testid="plan-command-fyi-alert"]')) ||
                    parentText.includes('generate a plan')
                )) {
                    if (valNorm === 'Type') newVal = USE_TW ? "輸入" : "输入";
                    else if (valNorm === 'and select') newVal = USE_TW ? "並選取" : "并选择";
                } else if (valNorm === 'and' && node.parentElement && (
                    parentText.includes('Privacy Policy') ||
                    parentText.includes('Terms of Service') ||
                    parentText.includes('隐私政策') ||
                    parentText.includes('隱私權政策')
                )) {
                    newVal = USE_TW ? "以及" : "以及";
                } else if ((valNorm === 'Search conversations with' || valNorm === 'in the top left.') && node.parentElement && (
                    parentText.includes('in the top left')
                )) {
                    newVal = (valNorm === 'Search conversations with')
                        ? (USE_TW ? "使用左上角的" : "可通过左上角的")
                        : (USE_TW ? "搜尋對話。" : "搜索对话。");
                } else if ((valNorm === 'View archived in the sidebar' || valNorm === 'menu)') && node.parentElement && (
                    parentText.includes('View archived in the sidebar')
                )) {
                    newVal = (valNorm === 'View archived in the sidebar')
                        ? (USE_TW ? "已歸檔對話可在側邊欄" : "已归档对话可在侧边栏")
                        : (USE_TW ? "選單中查看。" : "菜单中查看。");
                } else if ((valNorm === 'For help, visit' || valNorm === 'or join the' || valNorm === 'chat space') && node.parentElement && (
                    parentText.includes('chat space')
                )) {
                    if (valNorm === 'For help, visit') newVal = USE_TW ? "如需協助，請造訪" : "如需帮助，请访问";
                    else if (valNorm === 'or join the') newVal = USE_TW ? "或加入" : "或加入";
                    else if (valNorm === 'chat space') newVal = USE_TW ? "聊天空間" : "聊天空间";
                } else if ((valNorm === 'when working' || valNorm === 'in this project' || valNorm === 'in these conversations') && node.parentElement && (
                    parentText.includes('when working') ||
                    parentText.includes('Global Permissions') ||
                    parentText.includes('全局权限') ||
                    parentText.includes('全域權限') ||
                    parentText.includes('Global Settings') ||
                    parentText.includes('全局设置') ||
                    parentText.includes('全域設定')
                )) {
                    if (valNorm === 'when working') {
                        const isProj = parentText.includes('in this project');
                        if (isProj) {
                            newVal = USE_TW ? "（在此專案中工作時）" : "（在此项目中工作时）";
                        } else {
                            newVal = USE_TW ? "（在這些對話中工作時）" : "（在这些会话中工作时）";
                        }
                    } else {
                        newVal = "";
                    }
                } else if (/^The AlloyDB for PostgreSQL remote/i.test(valNorm)) {
                    newVal = USE_TW ? "AlloyDB for PostgreSQL 遠端 MCP 伺服器可讓您存取並執行 AlloyDB 工具，用於管理 AlloyDB 叢集及執行個體、管理使用者，以及建立和復原資料備份。" : "AlloyDB for PostgreSQL 远程 MCP 服务器可让您访问并运行 AlloyDB 工具，用于管理 AlloyDB 集群及实例、管理用户，以及创建和恢复数据备份。";
                } else if (/^The Cloud SQL remote/i.test(valNorm)) {
                    newVal = USE_TW ? "Cloud SQL 遠端 MCP 伺服器可讓您存取並執行 Cloud SQL 工具，用於管理 Cloud SQL 執行個體、管理使用者、建立和復原資料備份及資料庫維運。" : "Cloud SQL 远程 MCP 服务器可让您访问并运行 Cloud SQL 工具，用于管理 Cloud SQL 实例、管理用户、创建和恢复数据备份及数据库运维。";
                } else if (/^The Spanner remote/i.test(valNorm)) {
                    newVal = USE_TW ? "Spanner 遠端 MCP 伺服器可讓您從 AI 開發環境中存取並執行 Spanner 工具，以建立、管理和查詢分散式資料庫資源。" : "Spanner 远程 MCP 服务器可让您从 AI 开发环境中访问并运行 Spanner 工具，以创建、管理和查询分布式数据库资源。";
                } else if (/^Ask questions\\.\\s*Get answers\\.\\s*This MCP is a server/i.test(valNorm)) {
                    newVal = USE_TW ? "提問，即得答案。該 MCP 是供您的程式設計代理呼叫的伺服器。用英語提出問題，它會針對您的 PostHog 資料執行查詢，結果將直接呈現在您的編輯器中。" : "提问，即得答案。该 MCP 是供您的编程智能体调用的服务器。用英语提出问题，它会针对您的 PostHog 数据运行查询，结果将直接呈现在您的编辑器中。";
                } else if (/^The GKE remote MCP server/i.test(valNorm)) {
                    newVal = USE_TW ? "GKE 遠端 MCP 伺服器提供對 GKE Kubernetes 資源的讀寫存取權限。允許 AI 代理檢查並監控您的執行環境。" : "GKE 远程 MCP 服务器提供对 GKE Kubernetes 资源的读写权限。允许 AI 智能体检查并监控您的运行环境。";
                } else if (/^Cloud CLI MCP Server/i.test(valNorm)) {
                    newVal = USE_TW ? "Cloud CLI MCP 伺服器提供在遠端沙箱環境中執行 gcloud 與 bq CLI 指令的工具集。" : "Cloud CLI MCP 服务器提供在远程沙箱环境中运行 gcloud 与 bq CLI 命令的工具集。";
                } else if (/^The Apigee API hub remote MCP server/i.test(valNorm)) {
                    newVal = USE_TW ? "Apigee API hub 遠端 MCP 伺服器可讓您管理註冊在 Apigee API hub 中的 API、版本、規格、操作、部署、屬性、外部 API 以及相依性。" : "Apigee API hub 远程 MCP 服务器可让您管理注册在 Apigee API hub 中的 API、版本、规范、操作、部署、属性、外部 API 以及依赖项。";
                } else if (/^The Google Home Developer MCP server/i.test(valNorm)) {
                    newVal = USE_TW ? "Google Home Developer MCP 伺服器支援檢索 Google Home 文件、OpenThread 與 Matter 規格文件。" : "Google Home Developer MCP 服务器支持检索 Google Home 文档、OpenThread 与 Matter 规范文档。";
                } else if (/^The Cloud Quotas MCP server/i.test(valNorm)) {
                    newVal = USE_TW ? "Cloud Quotas MCP 伺服器支援檢視配額分配、申請提升配額以及管理 Quota Adjuster 自動調整設定。" : "Cloud Quotas MCP 服务器支持查看配额分配、申请提升配额以及管理 Quota Adjuster 自动调整配置。";
                } else if (/^Build, edit, deploy, and manage full-stack web apps with Lovable/i.test(valNorm)) {
                    newVal = USE_TW ? "使用自然語言，藉助 AI 應用程式建構工具 Lovable 建構、編輯、部署和管理全端 Web 應用程式。該 MCP 伺服器將您的 AI 用戶端連接至 Lovable，允許您的 AI 代理直接在偏好的編輯器或助手內互動、建立和管理 Lovable 專案。" : "使用自然语言，借助 AI 应用构建工具 Lovable 构建、编辑、部署和管理全栈 Web 应用。该 MCP 服务器将您的 AI 客户端连接至 Lovable，允许您的 AI 智能体直接在偏好的编辑器或助手中交互、创建和管理 Lovable 项目。";
                } else if (/^Build applications with the Gemini Interactions API and Live API/i.test(valNorm)) {
                    newVal = USE_TW ? "使用 Gemini Interactions API 與 Live API 建構應用程式，涵蓋文字生成、多輪對話、串流、函式呼叫、託管代理及即時音訊與視訊互動。" : "使用 Gemini Interactions API 和 Live API 构建应用，涵盖文本生成、多轮对话、流式传输、函数调用、托管智能体以及实时音视频交互。";
                } else if (/^(?:Refreshes|You have (?:used (?:some|all) of|reached) your (?:weekly|5-hour) limit, it will fully refresh) in (\\d+) days?, (\\d+) hours?\\.?$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^(?:Refreshes|You have (?:used (?:some|all) of|reached) your (?:weekly|5-hour) limit, it will fully refresh) in (\\d+) days?, (\\d+) hours?\\.?$/i, (match, d, h) => {
                        return USE_TW ? (d + " 天 " + h + " 小時後更新") : (d + " 天 " + h + " 小时后刷新");
                    });
                } else if (/^(?:Refreshes|You have (?:used (?:some|all) of|reached) your (?:weekly|5-hour) limit, it will fully refresh) in (\\d+) hours?, (\\d+) minutes?\\.?$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^(?:Refreshes|You have (?:used (?:some|all) of|reached) your (?:weekly|5-hour) limit, it will fully refresh) in (\\d+) hours?, (\\d+) minutes?\\.?$/i, (match, h, m) => {
                        return USE_TW ? (h + " 小時 " + m + " 分鐘後更新") : (h + " 小时 " + m + " 分钟后刷新");
                    });
                } else if (/^(?:Refreshes|You have (?:used (?:some|all) of|reached) your (?:weekly|5-hour) limit, it will fully refresh) in (\\d+) days?\\.?$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^(?:Refreshes|You have (?:used (?:some|all) of|reached) your (?:weekly|5-hour) limit, it will fully refresh) in (\\d+) days?\\.?$/i, (match, d) => {
                        return USE_TW ? (d + " 天後更新") : (d + " 天后刷新");
                    });
                } else if (/^(?:Refreshes|You have (?:used (?:some|all) of|reached) your (?:weekly|5-hour) limit, it will fully refresh) in (\\d+) hours?\\.?$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^(?:Refreshes|You have (?:used (?:some|all) of|reached) your (?:weekly|5-hour) limit, it will fully refresh) in (\\d+) hours?\\.?$/i, (match, h) => {
                        return USE_TW ? (h + " 小時後更新") : (h + " 小时后刷新");
                    });
                } else if (/^(?:Refreshes|You have (?:used (?:some|all) of|reached) your (?:weekly|5-hour) limit, it will fully refresh) in (\\d+) minutes?\\.?$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^(?:Refreshes|You have (?:used (?:some|all) of|reached) your (?:weekly|5-hour) limit, it will fully refresh) in (\\d+) minutes?\\.?$/i, (match, m) => {
                        return USE_TW ? (m + " 分鐘後更新") : (m + " 分钟后刷新");
                    });
                } else if (/^(?:Refreshes|You have (?:used (?:some|all) of|reached) your (?:weekly|5-hour) limit, it will fully refresh) in less than a minute\\.?$/i.test(valNorm)) {
                    newVal = USE_TW ? "不到 1 分鐘後更新" : "不到 1 分钟后刷新";
                } else if (/^(?:Refreshes|You have (?:used (?:some|all) of|reached) your (?:weekly|5-hour) limit, it will fully refresh) in a few seconds\\.?$/i.test(valNorm)) {
                    newVal = USE_TW ? "幾秒後更新" : "几秒后刷新";
                } else if (/^Learn more about$/i.test(valNorm)) {
                    newVal = USE_TW ? "瞭解更多關於" : "了解更多关于";
                } else if (/^Learn more about (.+)$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^Learn more about (.+)$/i, (match, p) => {
                        let translatedPreset = p;
                        const pLow = p.toLowerCase();
                        if (pLow === 'default' || pLow.includes('默认') || pLow.includes('預設')) translatedPreset = USE_TW ? "預設 (Default)" : "默认 (Default)";
                        else if (pLow === 'inherit global' || pLow.includes('继承全局') || pLow.includes('繼承全域')) translatedPreset = USE_TW ? "繼承全域 (Inherit Global)" : "继承全局 (Inherit Global)";
                        else if (pLow === 'full machine' || pLow.includes('全机') || pLow.includes('全機')) translatedPreset = USE_TW ? "全機存取 (Full Machine)" : "全机访问 (Full Machine)";
                        else if (pLow === 'turbo mode' || pLow.includes('极速') || pLow.includes('極速')) translatedPreset = USE_TW ? "極速模式 (Turbo Mode)" : "极速模式 (Turbo Mode)";
                        else if (pLow === 'custom' || pLow.includes('自定义') || pLow.includes('自訂')) translatedPreset = USE_TW ? "自訂 (Custom)" : "自定义 (Custom)";
                        return USE_TW ? ("瞭解更多關於 " + translatedPreset + " 的詳細資訊") : ("了解更多关于 " + translatedPreset + " 的信息");
                    });
                } else if (/^Yes, and always allow '(.+)' in this project$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^Yes, and always allow '(.+)' in this project$/i, (match, cmd) => {
                        return USE_TW ? ("是，且在此專案中一律允許執行 '" + cmd + "'") : ("是，且在此项目中始终允许运行 '" + cmd + "'");
                    });
                } else if (/^Yes, and always allow '(.+)'$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^Yes, and always allow '(.+)'$/i, (match, cmd) => {
                        return USE_TW ? ("是，且一律允許執行 '" + cmd + "'") : ("是，且始终允许运行 '" + cmd + "'");
                    });
                } else if (/^(\\d+) tools? enabled$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^(\\d+) tools? enabled$/i, (match, num) => {
                        return USE_TW ? (num + " 個工具已啟用") : (num + " 个工具已启用");
                    });
                } else if (/^Show\\s+(\\d+)\\s+more(\\s+(results?|items?|commands?|options?))?(\\.\\.\\.|…)?$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^Show\\s+(\\d+)\\s+more(\\s+(results?|items?|commands?|options?))?(\\.\\.\\.|…)?$/i, (match, num, p2, type) => {
                        if (type) {
                            if (/result/i.test(type)) return USE_TW ? ("顯示另外 " + num + " 個結果...") : ("显示另外 " + num + " 个结果...");
                            if (/command/i.test(type)) return USE_TW ? ("顯示另外 " + num + " 個指令...") : ("显示另外 " + num + " 个命令...");
                            if (/item/i.test(type)) return USE_TW ? ("顯示另外 " + num + " 個項目...") : ("显示另外 " + num + " 个项目...");
                            if (/option/i.test(type)) return USE_TW ? ("顯示另外 " + num + " 個選項...") : ("显示另外 " + num + " 个选项...");
                        }
                        return USE_TW ? ("顯示另外 " + num + " 個...") : ("显示另外 " + num + " 个...");
                    });
                } else if (/^Show\\s+(\\d+)\\s+breakdown(s)?$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^Show\\s+(\\d+)\\s+breakdown(s)?$/i, (match, num) => {
                        return USE_TW ? ("顯示 " + num + " 項明細") : ("显示 " + num + " 项细目");
                    });
                } else if (/^Hide\\s+breakdown(s)?$/i.test(valNorm)) {
                    newVal = USE_TW ? "收起明細" : "收起细目";
                } else if (/^Show\\s+breakdown(s)?$/i.test(valNorm)) {
                    newVal = USE_TW ? "顯示明細" : "显示细目";
                } else if (/^Hide\\s+tools$/i.test(valNorm)) {
                    newVal = USE_TW ? "收起工具" : "收起工具";
                } else if (/^(\\d+)\\s+tools$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^(\\d+)\\s+tools$/i, (match, num) => {
                        return num + (USE_TW ? " 個工具" : " 个工具");
                    });
                } else if (/^(\\d+)\\s+tools?\\s+excluded$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^(\\d+)\\s+tools?\\s+excluded$/i, (match, num) => {
                        return num + (USE_TW ? " 個工具已排除" : " 个工具已排除");
                    });
                } else if (/^Exceeded the rules token budget\\.\\s+Full rule content\\s+\\(([\\d,]+)\\s+tokens?\\)\\s+was replaced with a lightweight file-path pointer in context\\.$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^Exceeded the rules token budget\\.\\s+Full rule content\\s+\\(([\\d,]+)\\s+tokens?\\)\\s+was replaced with a lightweight file-path pointer in context\\.$/i, (match, num) => {
                        return USE_TW ? ("已超出規則 Token 預算。完整規則內容 (" + num + " 個 Token) 已在上下文中替換為輕量級檔案路徑指標。") : ("已超出规则 Token 预算。完整规则内容 (" + num + " 个 Token) 已在上下文中替换为轻量级文件路径指针。");
                    });
                } else if (/^All tools in this MCP server\\s+\\(([\\d,]+)\\s+tokens?\\)\\s+exceeded the customization budget and were excluded from context\\.$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^All tools in this MCP server\\s+\\(([\\d,]+)\\s+tokens?\\)\\s+exceeded the customization budget and were excluded from context\\.$/i, (match, num) => {
                        return USE_TW ? ("此 MCP 伺服器中的所有工具 (" + num + " 個 Token) 均已超出自訂項預算，並已從上下文中排除。") : ("此 MCP 服务器中的所有工具 (" + num + " 个 Token) 均已超出自定义项预算，并已从上下文中排除。");
                    });
                } else if (/^(\\d+)\\s+tools?\\s+in this MCP server\\s+\\(([\\d,]+)\\s+tokens?\\)\\s+exceeded the customization budget and were excluded from context\\.$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^(\\d+)\\s+tools?\\s+in this MCP server\\s+\\(([\\d,]+)\\s+tokens?\\)\\s+exceeded the customization budget and were excluded from context\\.$/i, (match, tCount, num) => {
                        return USE_TW ? ("此 MCP 伺服器中有 " + tCount + " 個工具 (" + num + " 個 Token) 超出自訂項預算，並已從上下文中排除。") : ("此 MCP 服务器中有 " + tCount + " 个工具 (" + num + " 个 Token) 超出自定义项预算，并已从上下文中排除。");
                    });
                } else if (/^Exceeded the customization token budget\\s+\\(([\\d,]+)\\s+tokens?\\)\\s+and was excluded from context\\.$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^Exceeded the customization token budget\\s+\\(([\\d,]+)\\s+tokens?\\)\\s+and was excluded from context\\.$/i, (match, num) => {
                        return USE_TW ? ("超出自訂項 Token 預算 (" + num + " 個 Token)，已從上下文中排除。") : ("超出自定义项 Token 预算 (" + num + " 个 Token)，已从上下文中排除。");
                    });
                } else if (/^See all\\s*\\((\\d+)\\)$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^See all\\s*\\((\\d+)\\)$/i, (match, num) => {
                        return USE_TW ? ("顯示全部 (" + num + ")") : ("显示全部 (" + num + ")");
                    });
                } else if (/^(?:\\+\\s*)?See\\s+(\\d+)\\s+more(?:\\s+(.+))?$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^(?:\\+\\s*)?See\\s+(\\d+)\\s+more(?:\\s+(.+))?$/i, (match, num) => {
                        const hasPlus = /^\\+/.test(valNorm);
                        return (hasPlus ? "+ " : "") + (USE_TW ? ("展開另外 " + num + " 項") : ("展开另外 " + num + " 项"));
                    });
                } else if (/^Available AI Credits: (\\d+)$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^Available AI Credits: (\\d+)$/i, (match, num) => {
                        return USE_TW ? ("可用 AI 額度: " + num) : ("可用 AI 额度: " + num);
                    });
                } else if (/^Version\\s+([\\d\\.]+)$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^Version\\s+([\\d\\.]+)$/i, (match, v) => {
                        return "版本 " + v;
                    });
                } else if (/^(\\d+)(s|m|h|d|w|mo|yr)$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^(\\d+)(s|m|h|d|w|mo|yr)$/i, (match, num, unit) => {
                        const unitLower = unit.toLowerCase();
                        let unitStr = "";
                        if (unitLower === "s") unitStr = USE_TW ? "秒前" : "秒前";
                        else if (unitLower === "m") unitStr = USE_TW ? "分鐘前" : "分钟前";
                        else if (unitLower === "h") unitStr = USE_TW ? "小時前" : "小时前";
                        else if (unitLower === "d") unitStr = USE_TW ? "天前" : "天前";
                        else if (unitLower === "w") unitStr = USE_TW ? "週前" : "周前";
                        else if (unitLower === "mo") unitStr = USE_TW ? "個月前" : "个月前";
                        else if (unitLower === "yr") unitStr = USE_TW ? "年前" : "年前";
                        return num + unitStr;
                    });
                } else if (/^just now$/i.test(valNorm)) {
                    newVal = USE_TW ? "剛剛" : "刚刚";
                } else if (/^(\\d+)(s|m|h|d|w|mo|yr)\\s+ago$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^(\\d+)(s|m|h|d|w|mo|yr)\\s+ago$/i, (match, num, unit) => {
                        const unitLower = unit.toLowerCase();
                        let unitStr = "";
                        if (unitLower === "s") unitStr = USE_TW ? "秒前" : "秒前";
                        else if (unitLower === "m") unitStr = USE_TW ? "分鐘前" : "分钟前";
                        else if (unitLower === "h") unitStr = USE_TW ? "小時前" : "小时前";
                        else if (unitLower === "d") unitStr = USE_TW ? "天前" : "天前";
                        else if (unitLower === "w") unitStr = USE_TW ? "週前" : "周前";
                        else if (unitLower === "mo") unitStr = USE_TW ? "個月前" : "个月前";
                        else if (unitLower === "yr") unitStr = USE_TW ? "年前" : "年前";
                        return num + unitStr;
                    });
                } else if (/^(.+?): context deadline exceeded$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^(.+?): context deadline exceeded$/i, (match, prefix) => {
                        return prefix + (USE_TW ? ": 要求逾時 (context deadline exceeded)" : ": 请求超时 (context deadline exceeded)");
                    });
                } else if (/^(.+?): i\\/o timeout$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^(.+?): i\\/o timeout$/i, (match, prefix) => {
                        return prefix + (USE_TW ? ": I/O 逾時 (i/o timeout)" : ": I/O 超时 (i/o timeout)");
                    });
                } else if (/^Your plan's baseline quota will refresh on (.+?)\\.?\\s*To continue using this model now, enable AI Credit overages\\.?$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^Your plan's baseline quota will refresh on (.+?)\\.?\\s*To continue using this model now, enable AI Credit overages\\.?$/i, (match, when) => {
                        return USE_TW ? ("您方案的基準配額將於 " + when + " 刷新。如需立即繼續使用此模型，請啟用 AI 點數超額使用。") : ("您方案的基础配额将于 " + when + " 刷新。如需立即继续使用此模型，请启用 AI 额度超量使用。");
                    });
                } else if (/^You have hit your weekly limit, it refreshes in (.+?)\\. If on a supported paid plan, you can use AI credits in the interim or upgrade to a higher tier\\.$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^You have hit your weekly limit, it refreshes in (.+?)\\. If on a supported paid plan, you can use AI credits in the interim or upgrade to a higher tier\\.$/i, (match, when) => {
                        return USE_TW ? ("您已達到每週額度限制，將於 " + when + " 刷新。若您使用受支援的付費方案，可在此期間使用 AI 點數，或升級至更高層級。") : ("您已达到每周额度限制，将于 " + when + " 刷新。若您使用受支持的付费计划，可在此期间使用 AI 额度，或升级至更高层级。");
                    });
                } else if (/^You have hit your weekly limit, the (\\d+)-hour limit does not currently apply\\. Your weekly limit will fully refresh in (.+?)\\.$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^You have hit your weekly limit, the (\\d+)-hour limit does not currently apply\\. Your weekly limit will fully refresh in (.+?)\\.$/i, (match, h, when) => {
                        return USE_TW ? ("您已達到每週額度限制，" + h + " 小時限制目前不適用。您的每週額度限制將於 " + when + " 完全更新。") : ("您已达到每周额度限制，" + h + " 小时限制目前不适用。您的每周额度限制将于 " + when + " 完全刷新。");
                    });
                } else if (/^(Rules|Skills|Mcp Tools): ([\\d,]+) tokens$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^(Rules|Skills|Mcp Tools): ([\\d,]+) tokens$/i, (match, kind, num) => {
                        const kindMap = { "Rules": USE_TW ? "規則" : "规则", "Skills": "技能", "Mcp Tools": "MCP 工具" };
                        return (kindMap[kind] || kind) + "：" + num + " Token";
                    });
                } else if (/^Are you sure you want to delete (the |this )?project (.+?)\\??$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^Are you sure you want to delete (the |this )?project (.+?)\\??$/i, (match, article, name) => {
                        return USE_TW ? ("您確定要刪除專案 " + name + " 嗎？") : ("您确定要删除项目 " + name + " 吗？");
                    });
                } else if (/^(?:(Permanently delete)\\s+)?(.+?)\\s+including\\s+(\\d+)\\s+active conversations?([.。])?$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^(?:(Permanently delete)\\s+)?(.+?)\\s+including\\s+(\\d+)\\s+active conversations?([.。])?$/i, (match, del, name, count, dot) => {
                        const delPrefix = del ? (USE_TW ? "永久刪除 " : "永久删除 ") : "";
                        const suffix = dot ? "。" : "";
                        return delPrefix + name + (USE_TW ? ("（包含 " + count + " 個活躍對話）") : ("（包含 " + count + " 个活跃会话）")) + suffix;
                    });
                } else if (/^including\\s+(\\d+)\\s+active conversations?([.。])?$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^including\\s+(\\d+)\\s+active conversations?([.。])?$/i, (match, count, dot) => {
                        const suffix = dot ? "。" : "";
                        return (USE_TW ? ("包含 " + count + " 個活躍對話") : ("包含 " + count + " 个活跃会话")) + suffix;
                    });
                } else if (/^(\\d+)\\s+active conversations?([.。])?$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^(\\d+)\\s+active conversations?([.。])?$/i, (match, count, dot) => {
                        const suffix = dot ? "。" : "";
                        return (USE_TW ? (count + " 個活躍對話") : (count + " 个活跃会话")) + suffix;
                    });
                } else if (/^The (.+?) remote MCP server lets you access and run (.+?) tools to (.+)$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^The (.+?) remote MCP server lets you access and run (.+?) tools to (.+)$/i, (match, name, tools, action) => {
                        return name + (USE_TW ? " 遠端 MCP 伺服器可讓您存取並執行 " : " 远程 MCP 服务器可让您访问并运行 ") + tools + (USE_TW ? " 工具以進行管理與操作。" : " 工具以进行管理与操作。");
                    });
                } else if (/^The (.+?) remote MCP server lets you manage (.+) resources\\.?$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^The (.+?) remote MCP server lets you manage (.+) resources\\.?$/i, (match, name, res) => {
                        return name + (USE_TW ? " 遠端 MCP 伺服器可讓您管理 " : " 远程 MCP 服务器可让您管理 ") + res + (USE_TW ? " 資源。" : " 资源。");
                    });
                } else if (/^The (.+?) remote MCP server (allows you to|lets you) (.+)$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^The (.+?) remote MCP server (allows you to|lets you) (.+)$/i, (match, name, verb, rest) => {
                        let text = rest;
                        text = text.replace(/enroll projects/gi, USE_TW ? "註冊專案" : "注册项目")
                                   .replace(/generate audit and scope reports/gi, USE_TW ? "產生稽核與範圍報告" : "生成审计与范围报告")
                                   .replace(/check resource enrollment statuses/gi, USE_TW ? "檢查資源註冊狀態" : "检查资源注册状态")
                                   .replace(/in the (.+?) region/gi, (m, r) => (USE_TW ? "在 " + r + " 區域" : "在 " + r + " 区域"));
                        return name + (USE_TW ? " 遠端 MCP 伺服器允許您 " : " 远程 MCP 服务器允许您 ") + text;
                    });
                } else if (/^Send feedback as(\\s+(.+))?$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^Send feedback as(\\s+(.+))?$/i, (match, p1, email) => {
                        if (email) {
                            return "以 " + email + (USE_TW ? " 身分傳送意見回饋" : " 身份发送反馈");
                        }
                        return USE_TW ? "以此身分傳送意見回饋：" : "以如下身份发送反馈：";
                    });
                } else if (/^(Thought|Thinking|Worked) for\\s+(.+)$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^(Thought|Thinking|Worked) for\\s+(.+)$/i, (match, verb, dur) => {
                        const vZh = /^Thought/i.test(verb) ? "已思考 " : (/^Thinking/i.test(verb) ? "正在思考 " : "已工作 ");
                        const dZh = dur.trim().replace(/(\\d+)\\s*h(?:ours?|r)?/gi, USE_TW ? "$1 小時" : "$1 小时").replace(/(\\d+)\\s*m(?:inutes?|in)?/gi, USE_TW ? "$1 分鐘" : "$1 分钟").replace(/(\\d+)\\s*s(?:econds?|ec)?/gi, "$1 秒");
                        return vZh + dZh;
                    });
                } else if (/^No more older messages,\\s*showing\\s+(\\d+)\\s+of\\s+(\\d+)$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^No more older messages,\\s*showing\\s+(\\d+)\\s+of\\s+(\\d+)$/i, (match, a, b) => {
                        return USE_TW ? ("沒有更多歷史訊息，目前顯示 " + a + " / " + b + " 則") : ("没有更多历史消息，当前显示 " + a + " / " + b + " 条");
                    });
                } else if (/^Low contrast ratio \\(([^)]+)\\)\\.\\s*Text may be hard to read\\.?$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^Low contrast ratio \\(([^)]+)\\)\\.\\s*Text may be hard to read\\.?$/i, (match, ratio) => {
                        return USE_TW ? ("對比度過低 (" + ratio + ")，文字可能難以閱讀。") : ("对比度过低 (" + ratio + ")，文字可能难以阅读。");
                    });
                } else if (/^Marked\\s+(\\d+)\\s+conversations?\\s+as\\s+read$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^Marked\\s+(\\d+)\\s+conversations?\\s+as\\s+read$/i, (match, count) => {
                        return USE_TW ? ("已將 " + count + " 個對話標記為已讀") : ("已将 " + count + " 个会话标记为已读");
                    });
                } else if (/^Preview unavailable\\s*[—–-]\\s*(.+)$/i.test(valNorm)) {
                    newVal = valNorm.replace(/^Preview unavailable\\s*[—–-]\\s*(.+)$/i, (match, reason) => {
                        return (USE_TW ? "預覽不可用 — " : "预览不可用 — ") + reason;
                    });
                } else if (/^(?:(Exploring|Explored|Editing|Edited|Running|Ran)\\s+)?(\\d+)\\s+(files?|folders?|searches?|commands?|tasks?|pages?|browsers?|images?|actions?|artifacts?)(?:,\\s*(?:(Exploring|Explored|Editing|Edited|Running|Ran)\\s+)?(\\d+)\\s+(files?|folders?|searches?|commands?|tasks?|pages?|browsers?|images?|actions?|artifacts?))*$/i.test(valNorm)) {
                    const verbMap = USE_TW
                        ? { exploring: '正在探索', explored: '已探索', editing: '正在編輯', edited: '已編輯', running: '正在執行', ran: '已執行' }
                        : { exploring: '正在探索', explored: '已探索', editing: '正在编辑', edited: '已编辑', running: '正在运行', ran: '已运行' };
                    const nounMap = USE_TW
                        ? { file: '個檔案', files: '個檔案', folder: '個資料夾', folders: '個資料夾', search: '次搜尋', searches: '次搜尋', command: '個指令', commands: '個指令', task: '個任務', tasks: '個任務', page: '個網頁', pages: '個網頁', browser: '次瀏覽器操作', browsers: '次瀏覽器操作', image: '張圖片', images: '張圖片', action: '項操作', actions: '項操作', artifact: '個產物', artifacts: '個產物' }
                        : { file: '个文件', files: '个文件', folder: '个文件夹', folders: '个文件夹', search: '次搜索', searches: '次搜索', command: '个命令', commands: '个命令', task: '个任务', tasks: '个任务', page: '个网页', pages: '个网页', browser: '次浏览器操作', browsers: '次浏览器操作', image: '张图片', images: '张图片', action: '项操作', actions: '项操作', artifact: '个工件', artifacts: '个工件' };
                    newVal = valNorm.split(/\\s*,\\s*/).map(part => {
                        const pm = part.match(/^(?:(Exploring|Explored|Editing|Edited|Running|Ran)\\s+)?(\\d+)\\s+(files?|folders?|searches?|commands?|tasks?|pages?|browsers?|images?|actions?|artifacts?)$/i);
                        if (!pm) return part;
                        const v = pm[1] ? (verbMap[pm[1].toLowerCase()] || pm[1]) + ' ' : '';
                        const n = nounMap[pm[3].toLowerCase()] || pm[3];
                        return v + pm[2] + ' ' + n;
                    }).join('，');
                } else if (valNorm.length > 15 && valNorm.includes(' ')) {
                    // 2. 长句子串滑动替换与末尾截断智能匹配 (仅当原句带有省略号截断时，才允许基于长前缀匹配；不含空格的标识符不进行子串替换)
                    const isTruncated = (valNorm.endsWith('...') || valNorm.endsWith('…')) && valNorm.length >= 35;
                    const cleanVal = isTruncated ? valNorm.replace(/(\\.\\.\\.|…)$/, '').trim().toLowerCase() : '';
                    for (const [key, translated] of longEntries) {
                        if (key.length <= valNorm.length && valNorm.includes(key)) {
                            newVal = newVal.split(key).join(translated);
                            break;
                        } else if (isTruncated && cleanVal.length >= 30 && key.toLowerCase().startsWith(cleanVal)) {
                            newVal = translated;
                            break;
                        }
                    }
                }

                if (newVal !== originalVal) {
                    applyNodeTranslation(node, newVal);
                } else if (prevTrans !== undefined && curRawVal === prevTrans && curRawVal !== originalVal) {
                    node.nodeValue = originalVal;
                    translatedValues.delete(node);
                    node._agModeKey = '';
                }
            }
        } catch (e) {}
    }

    let mcpSnifferTimer = null;
    let lastCapturedCount = 0;
    function scheduleMcpSniffer() {
        if (mcpSnifferTimer) clearTimeout(mcpSnifferTimer);
        mcpSnifferTimer = setTimeout(runMcpSniffer, 600);
    }

    function extractMcpCatalog(screen) {
        if (!screen) return null;
        let templates = null;
        try {
            const findFiber = (dom) => {
                if (!dom) return null;
                const k = Object.keys(dom).find(key => key.startsWith('__reactFiber$') || key.startsWith('__reactInternalInstance$'));
                return k ? dom[k] : null;
            };

            const candidates = [
                screen,
                screen.querySelector('.divide-y'),
                screen.querySelector('.divide-y > div')
            ].filter(Boolean);

            for (const dom of candidates) {
                let fiber = findFiber(dom);
                let queue = [fiber];
                let visited = new Set();
                let depth = 0;
                while (queue.length > 0 && depth < 300) {
                    depth++;
                    const cur = queue.shift();
                    if (!cur || visited.has(cur)) continue;
                    visited.add(cur);

                    if (cur.memoizedProps && Array.isArray(cur.memoizedProps.mcpTemplates) && cur.memoizedProps.mcpTemplates.length > 0) {
                        templates = cur.memoizedProps.mcpTemplates;
                        break;
                    }
                    if (cur.child) queue.push(cur.child);
                    if (cur.sibling) queue.push(cur.sibling);
                    if (cur.return) queue.push(cur.return);
                }
                if (templates) break;
            }
        } catch (e) {}

        if (!templates || templates.length === 0) {
            try {
                const rows = screen.querySelectorAll('.divide-y > div');
                if (rows && rows.length > 0) {
                    const domItems = [];
                    for (const row of rows) {
                        const titleEl = row.querySelector('a, span.font-medium, .text-sm.font-medium');
                        const descEl = row.querySelector('.line-clamp-2, .text-xs.text-muted-foreground.mt-1');
                        const title = titleEl ? (titleEl.childNodes[0]?.textContent || titleEl.textContent || '').trim() : '';
                        const desc = descEl ? (descEl.textContent || '').trim() : '';
                        if (title || desc) {
                            domItems.push({
                                id: title.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
                                title: title,
                                description: desc
                            });
                        }
                    }
                    if (domItems.length > 0) {
                        templates = domItems;
                    }
                }
            } catch (e) {}
        }

        return templates;
    }

    function renderBadge(screen, catalog) {
        try {
            if (!screen) return;
            let badge = document.getElementById('__antigravity_mcp_badge__');
            const searchRow = screen.querySelector('.relative.flex.items-center');
            if (!badge && searchRow && searchRow.parentNode) {
                badge = document.createElement('div');
                badge.id = '__antigravity_mcp_badge__';
                badge.className = 'text-xs text-emerald-500 bg-emerald-500/10 border border-emerald-500/30 px-3 py-1.5 rounded flex items-center justify-between cursor-pointer select-none transition-all';
                badge.style.marginTop = '6px';
                badge.style.marginBottom = '2px';
                searchRow.parentNode.insertBefore(badge, searchRow.nextSibling);
            }
            if (badge) {
                const scText = '✓ 已自动捕获 ' + catalog.length + ' 个 MCP 服务器（点击复制 JSON）';
                const tcText = '✓ 已自動捕獲 ' + catalog.length + ' 個 MCP 伺服器（點擊複製 JSON）';
                badge.innerHTML = '<span>' + (USE_TW ? tcText : scText) + '</span><span style="opacity:0.75; font-size:11px;">' + (USE_TW ? '點擊複製' : '点击复制') + '</span>';
                badge.onclick = () => {
                    try {
                        navigator.clipboard.writeText(JSON.stringify(catalog, null, 2));
                        badge.innerHTML = '<span>' + (USE_TW ? '✓ 已複製 JSON 到剪貼簿！' : '✓ 已复制 JSON 到剪贴板！') + '</span>';
                        setTimeout(() => {
                            if (badge) badge.innerHTML = '<span>' + (USE_TW ? tcText : scText) + '</span><span style="opacity:0.75; font-size:11px;">' + (USE_TW ? '點擊複製' : '点击复制') + '</span>';
                        }, 2000);
                    } catch (err) {}
                };
            }
        } catch (e) {}
    }

    function runMcpSniffer(retryCount = 0) {
        try {
            const screen = document.querySelector('[data-testid="add-mcp-screen"]');
            if (!screen) return;
            const items = extractMcpCatalog(screen);
            if (!items || items.length === 0) {
                if (retryCount < 12) {
                    setTimeout(() => runMcpSniffer(retryCount + 1), 500);
                }
                return;
            }

            const catalog = items.map(item => ({
                id: item.id || '',
                title: item.title || '',
                description: item.description || '',
                link: item.link || '',
                trustLevel: item.trustLevel || ''
            }));

            if (catalog.length === lastCapturedCount) {
                renderBadge(screen, catalog);
                return;
            }
            lastCapturedCount = catalog.length;

            const dumpStr = JSON.stringify(catalog, null, 2);

            try {
                localStorage.setItem('__antigravity_mcp_dump__', dumpStr);
            } catch (e) {}

            window.__antigravity_mcp_dump__ = catalog;
            window.__exportMcpCatalog = function() {
                console.log(dumpStr);
                return catalog;
            };

            try {
                const req = typeof require === 'function' ? require : null;
                if (req) {
                    const fs = req('fs');
                    const path = req('path');
                    const os = req('os');
                    if (fs && path) {
                        const filePaths = [
                            os ? path.join(os.homedir(), '.gemini', 'antigravity', 'mcp_catalog_dump.json') : null
                        ].filter(Boolean);
                        for (const fp of filePaths) {
                            try {
                                const dir = path.dirname(fp);
                                if (fs.existsSync(dir)) {
                                    fs.writeFileSync(fp, dumpStr, 'utf-8');
                                    console.log('[Antigravity CN] MCP Catalog saved to: ' + fp);
                                }
                            } catch (err) {}
                        }
                    }
                }
            } catch (e) {}

            console.log('%c[Antigravity CN] 已自动捕获 ' + catalog.length + ' 个 MCP 服务器！', 'color: #10b981; font-weight: bold;', catalog);
            console.log('[Antigravity CN] 如需查看/导出 JSON，可在控制台执行: copy(window.__exportMcpCatalog())');

            renderBadge(screen, catalog);
        } catch (e) {}
    }

    const pendingNodes = new Set();
    let flushScheduled = false;

    function flushPendingNodes() {
        flushScheduled = false;
        if (langMode === 'en') {
            pendingNodes.clear();
            return;
        }
        const batch = Array.from(pendingNodes);
        pendingNodes.clear();
        for (const n of batch) {
            translateNode(n);
        }
    }

    function enqueueTranslateNode(n) {
        if (!n || langMode === 'en') return;
        pendingNodes.add(n);
        if (!flushScheduled) {
            flushScheduled = true;
            if (typeof queueMicrotask === 'function') {
                queueMicrotask(flushPendingNodes);
            } else {
                Promise.resolve().then(flushPendingNodes);
            }
        }
    }

    const observer = new MutationObserver(mutations => {
        let hasMcpModal = false;
        for (const m of mutations) {
            if (m.type === 'childList') {
                for (const n of m.addedNodes) {
                    if (langMode !== 'en') enqueueTranslateNode(n);
                    if (!hasMcpModal && n.nodeType === 1) {
                        if (n.getAttribute && n.getAttribute('data-testid') === 'add-mcp-screen') {
                            hasMcpModal = true;
                        } else if (n.querySelector && n.querySelector('[data-testid="add-mcp-screen"]')) {
                            hasMcpModal = true;
                        }
                    }
                }
            } else if (m.type === 'characterData') {
                if (langMode !== 'en') enqueueTranslateNode(m.target);
            } else if (m.type === 'attributes') {
                if (langMode !== 'en') enqueueTranslateNode(m.target);
            }
        }
        if (hasMcpModal) scheduleMcpSniffer();
    });

    const obsOpts = { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['placeholder', 'title', 'aria-label'] };
    const origAttachShadow = (typeof Element !== 'undefined' && Element.prototype && Element.prototype.attachShadow)
        ? Element.prototype.attachShadow
        : null;
    if (origAttachShadow) {
        Element.prototype.attachShadow = function() {
            const sr = origAttachShadow.apply(this, arguments);
            if (this && this.id !== '__ag_hanhua_float_host__') {
                shadowRoots.add(sr);
                try {
                    observer.observe(sr, obsOpts);
                    if (langMode !== 'en') translateNode(sr);
                } catch (e) {}
            }
            return sr;
        };
    }

    function refreshAllDom() {
        const root = (typeof document !== 'undefined') ? (document.body || document.documentElement) : null;
        if (!root) return;
        if (langMode === 'en') {
            pendingNodes.clear();
            restoreSubtreeToEnglish(document.documentElement || root);
            for (const sr of Array.from(shadowRoots)) {
                if (!sr || (sr.host && !sr.host.isConnected)) {
                    shadowRoots.delete(sr);
                    continue;
                }
                restoreSubtreeToEnglish(sr);
            }
        } else {
            try { observer.observe(root, obsOpts); } catch (e) {}
            translateNode(root);
            for (const sr of Array.from(shadowRoots)) {
                if (!sr || (sr.host && !sr.host.isConnected)) {
                    shadowRoots.delete(sr);
                    continue;
                }
                try { observer.observe(sr, obsOpts); } catch (e) {}
                translateNode(sr);
            }
        }
    }

    // ==========================================
    // 免重启中英/简繁热切换状态同步与悬浮球控制器
    // ==========================================
    const isExtHttpProxy = Boolean(
        typeof location !== 'undefined' &&
        location.protocol === 'http:' &&
        (location.hostname === '127.0.0.1' || location.hostname === 'localhost')
    );

    function getElectronIpc() {
        try {
            const em = typeof electron_1 !== 'undefined' ? electron_1 : (typeof require === 'function' ? require('electron') : null);
            return (em && em.ipcRenderer) ? em.ipcRenderer : null;
        } catch (e) {
            return null;
        }
    }

    let bcChannel = null;
    try {
        if (typeof BroadcastChannel === 'function') {
            bcChannel = new BroadcastChannel('ag_hanhua_sync');
        }
    } catch (e) {}

    let dictLoadingInFlight = {};
    function ensureDictLoaded(targetLang, done) {
        if (targetLang === 'en' || dictCache[targetLang]) {
            done();
            return;
        }
        if (typeof fetch !== 'function' || (!isExtHttpProxy && !SCRIPT_SRC_URL)) {
            done();
            return;
        }
        if (dictLoadingInFlight[targetLang]) {
            dictLoadingInFlight[targetLang].push(done);
            return;
        }
        dictLoadingInFlight[targetLang] = [done];
        const dictFileName = targetLang === 'zh-tw' ? 'ag_dict_tw.json' : 'ag_dict_sc.json';
        let url = '/' + dictFileName;
        if (!isExtHttpProxy && SCRIPT_SRC_URL) {
            try {
                url = new URL(dictFileName, SCRIPT_SRC_URL).href;
            } catch (e) {}
        }
        fetch(url, { cache: 'no-store' })
            .then(r => r.ok ? r.json() : null)
            .then(data => {
                if (data && typeof data === 'object') {
                    dictCache[targetLang] = data;
                }
            })
            .catch(() => {})
            .finally(() => {
                const waiters = dictLoadingInFlight[targetLang] || [];
                delete dictLoadingInFlight[targetLang];
                for (const fn of waiters) {
                    try { fn(); } catch (e) {}
                }
            });
    }

    let updateFloatUiFn = null;

    function applyStateInternal(next, opts) {
        const options = opts || {};
        let changed = false;
        if (next && typeof next.keepOptionNamesEn === 'boolean' && next.keepOptionNamesEn !== keepOptionNamesEn) {
            keepOptionNamesEn = next.keepOptionNamesEn;
            changed = true;
        }
        if (next && typeof next.hideFloatBtn === 'boolean' && next.hideFloatBtn !== floatBtnHidden) {
            floatBtnHidden = next.hideFloatBtn;
            if (updateFloatUiFn) updateFloatUiFn();
        }
        const reqLang = next && next.langMode ? String(next.langMode).toLowerCase() : langMode;
        const validLang = (reqLang === 'en' || reqLang === 'zh-cn' || reqLang === 'zh-tw') ? reqLang : langMode;
        if (validLang !== langMode) {
            changed = true;
        }
        if (validLang === 'zh-cn' || validLang === 'zh-tw') {
            lastZhLang = validLang;
        }

        const finalizeApply = () => {
            langMode = validLang;
            USE_TW = (langMode === 'zh-tw');
            currentModeKey = langMode + ':' + (keepOptionNamesEn ? '1' : '0');
            if (langMode !== 'en') {
                rebuildActiveMaps(langMode);
            }
            if (changed || options.forceRefresh) {
                refreshAllDom();
            }
            if (updateFloatUiFn) updateFloatUiFn();
            if (options.persist) {
                persistAndBroadcast(options.source || 'local');
            }
        };

        if (validLang !== 'en' && !dictCache[validLang]) {
            ensureDictLoaded(validLang, finalizeApply);
        } else {
            finalizeApply();
        }
    }

    function persistAndBroadcast(source) {
        const statePayload = {
            langMode: langMode,
            lastZhLang: lastZhLang,
            keepOptionNamesEn: keepOptionNamesEn,
            hideFloatBtn: floatBtnHidden
        };
        try {
            if (typeof localStorage !== 'undefined') {
                localStorage.setItem('__ag_hanhua_state__', JSON.stringify(statePayload));
            }
        } catch (e) {}

        const ipc = getElectronIpc();
        if (ipc) {
            try {
                if (typeof ipc.invoke === 'function') {
                    ipc.invoke('storage:update-items', {
                        'ag.hanhua.langMode': String(langMode),
                        'ag.hanhua.lastZhLang': String(lastZhLang),
                        'ag.hanhua.keepOptionEn': keepOptionNamesEn ? 'true' : 'false',
                        'ag.hanhua.hideFloatBtn': floatBtnHidden ? 'true' : 'false'
                    }).catch(() => {});
                }
                if (typeof ipc.send === 'function') {
                    ipc.send('ag-hanhua:set-lang-mode', {
                        langMode: langMode,
                        keepOptionNamesEn: keepOptionNamesEn
                    });
                }
            } catch (e) {}
        }

        if (bcChannel && source !== 'bc') {
            try {
                bcChannel.postMessage(statePayload);
            } catch (e) {}
        }

        if (isExtHttpProxy && source !== 'sse' && typeof fetch === 'function') {
            try {
                fetch('/__ag_hanhua_state__', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(statePayload)
                }).catch(() => {});
            } catch (e) {}
        }
    }

    function parseStoredBool(val) {
        if (typeof val === 'boolean') return val;
        if (val === 'true' || val === '1') return true;
        if (val === 'false' || val === '0') return false;
        return undefined;
    }

    function applyInitialStateSnapshot(parsed) {
        if (!parsed || typeof parsed !== 'object') return;
        if (parsed.lastZhLang === 'zh-cn' || parsed.lastZhLang === 'zh-tw') lastZhLang = parsed.lastZhLang;
        if (parsed.langMode === 'en' || parsed.langMode === 'zh-cn' || parsed.langMode === 'zh-tw') langMode = parsed.langMode;
        const keepOpt = parseStoredBool(parsed.keepOptionNamesEn);
        if (keepOpt !== undefined) keepOptionNamesEn = keepOpt;
        const hideBtn = parseStoredBool(parsed.hideFloatBtn);
        if (hideBtn !== undefined) floatBtnHidden = hideBtn;
    }

    function loadInitialPersistedState() {
        try {
            if (typeof localStorage !== 'undefined') {
                const raw = localStorage.getItem('__ag_hanhua_state__');
                if (raw) {
                    applyInitialStateSnapshot(JSON.parse(raw));
                }
            }
        } catch (e) {}

        // 从扩展注入的 <script data-ag-state="..."> 属性零闪烁同步恢复持久化状态（完全兼容严格 CSP，无需内联脚本）
        try {
            const scriptEl = CURRENT_SCRIPT_EL || (typeof document !== 'undefined' && document.getElementById ? document.getElementById('__ag_hanhua_ext_script__') : null);
            const encodedState = scriptEl && scriptEl.getAttribute ? scriptEl.getAttribute('data-ag-state') : '';
            if (encodedState) {
                applyInitialStateSnapshot(JSON.parse(decodeURIComponent(encodedState)));
            }
        } catch (e) {}

        const ipc = getElectronIpc();
        if (ipc) {
            try {
                if (typeof ipc.sendSync === 'function') {
                    const items = ipc.sendSync('storage:get-items-sync');
                    if (items && typeof items === 'object') {
                        if (items['ag.hanhua.lastZhLang'] === 'zh-cn' || items['ag.hanhua.lastZhLang'] === 'zh-tw') {
                            lastZhLang = items['ag.hanhua.lastZhLang'];
                        }
                        if (items['ag.hanhua.langMode'] === 'en' || items['ag.hanhua.langMode'] === 'zh-cn' || items['ag.hanhua.langMode'] === 'zh-tw') {
                            langMode = items['ag.hanhua.langMode'];
                        }
                        const keepOpt = parseStoredBool(items['ag.hanhua.keepOptionEn']);
                        if (keepOpt !== undefined) {
                            keepOptionNamesEn = keepOpt;
                        }
                        const hideBtn = parseStoredBool(items['ag.hanhua.hideFloatBtn']);
                        if (hideBtn !== undefined) {
                            floatBtnHidden = hideBtn;
                        }
                    }
                }
                if (typeof ipc.on === 'function' && !ipc._agStorageSubscribed) {
                    ipc._agStorageSubscribed = true;
                    ipc.on('storage:changed', (_evt, changes) => {
                        if (!changes || typeof changes !== 'object') return;
                        const patch = {};
                        if (typeof changes['ag.hanhua.langMode'] === 'string') patch.langMode = changes['ag.hanhua.langMode'];
                        const keepOpt = parseStoredBool(changes['ag.hanhua.keepOptionEn']);
                        if (keepOpt !== undefined) patch.keepOptionNamesEn = keepOpt;
                        const hideBtn = parseStoredBool(changes['ag.hanhua.hideFloatBtn']);
                        if (hideBtn !== undefined) patch.hideFloatBtn = hideBtn;
                        if (Object.keys(patch).length > 0) {
                            applyStateInternal(patch, { persist: false, source: 'ipc' });
                        }
                    });
                }
                if (typeof ipc.send === 'function') {
                    ipc.send('ag-hanhua:set-lang-mode', { langMode: langMode, keepOptionNamesEn: keepOptionNamesEn });
                }
            } catch (e) {}
        }

        USE_TW = (langMode === 'zh-tw');
        currentModeKey = langMode + ':' + (keepOptionNamesEn ? '1' : '0');
        if (langMode !== 'en') {
            if (dictCache[langMode]) {
                rebuildActiveMaps(langMode);
            } else {
                ensureDictLoaded(langMode, () => {
                    rebuildActiveMaps(langMode);
                    refreshAllDom();
                });
            }
        }

        if (bcChannel) {
            bcChannel.onmessage = (ev) => {
                if (ev && ev.data && typeof ev.data === 'object') {
                    applyStateInternal(ev.data, { persist: false, source: 'bc' });
                }
            };
        }

        if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
            window.addEventListener('storage', (ev) => {
                if (ev && ev.key === '__ag_hanhua_state__' && ev.newValue) {
                    try {
                        applyStateInternal(JSON.parse(ev.newValue), { persist: false, source: 'storage' });
                    } catch (e) {}
                }
            });
            // 捕获阶段拦截扩展宿主发往外层 vscode-webview 的状态广播，防止触发 loading_bridge.js 未知消息异常
            window.addEventListener('message', (ev) => {
                if (ev && ev.data && typeof ev.data === 'object' && ev.data.__agHanhuaSync === 1 && ev.data.state) {
                    if (typeof ev.stopImmediatePropagation === 'function') ev.stopImmediatePropagation();
                    applyStateInternal(ev.data.state, { persist: false, source: 'ext-msg' });
                }
            }, true);
        }

        if (isExtHttpProxy) {
            try {
                if (typeof fetch === 'function') {
                    fetch('/__ag_hanhua_state__', { cache: 'no-store' })
                        .then(r => r.ok ? r.json() : null)
                        .then(st => {
                            if (st && typeof st === 'object') {
                                applyStateInternal(st, { persist: false, source: 'sse' });
                            }
                        })
                        .catch(() => {});
                }
                if (typeof EventSource === 'function') {
                    const es = new EventSource('/__ag_hanhua_events__');
                    es.onmessage = (ev) => {
                        try {
                            const st = JSON.parse(ev.data);
                            if (st && typeof st === 'object') {
                                applyStateInternal(st, { persist: false, source: 'sse' });
                            }
                        } catch (e) {}
                    };
                }
            } catch (e) {}
        }
    }

    loadInitialPersistedState();

    function toggleLanguageQuick() {
        const nextMode = (langMode === 'en') ? (lastZhLang || INIT_CONFIG.defaultLang) : 'en';
        applyStateInternal({ langMode: nextMode }, { persist: true, source: 'toggle' });
        return nextMode;
    }

    function mountFloatingToggle() {
        try {
            if (typeof document === 'undefined' || !document.body || !origAttachShadow) return;
            if (document.getElementById('__ag_hanhua_float_host__')) {
                if (updateFloatUiFn) updateFloatUiFn();
                return;
            }
            // VS Code / Antigravity IDE 外层主框架与外层 iframe 壳层使用原生状态栏或内层单悬浮球，避免双悬浮球重叠
            if (document.querySelector('.monaco-workbench')) return;
            if (document.getElementById('jetski-frame') || document.getElementById('jetski-frame-template')) return;
            if (typeof location !== 'undefined' && location.protocol === 'vscode-webview:' && document.getElementById('loading-indicator')) return;
            if (typeof window !== 'undefined' && window.innerWidth > 0 && window.innerHeight > 0) {
                if (window.innerWidth < 200 || window.innerHeight < 140) return;
            }

            const host = document.createElement('div');
            host.id = '__ag_hanhua_float_host__';
            host.setAttribute('data-ag-ui', '1');
            host.setAttribute('translate', 'no');
            host.className = 'notranslate';
            host.style.cssText = 'position:fixed;z-index:2147483646;pointer-events:none;top:0;left:0;width:0;height:0;';

            const sr = origAttachShadow.call(host, { mode: 'open' });
            const style = document.createElement('style');
            style.textContent = [
                '.ag-wrap{position:fixed;right:14px;bottom:42px;pointer-events:auto;user-select:none;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;z-index:2147483646;}',
                '.ag-wrap.hidden{display:none;}',
                '.ag-pill{height:26px;min-width:44px;padding:0 9px;border-radius:13px;display:inline-flex;align-items:center;justify-content:center;gap:4px;font-size:11.5px;font-weight:600;letter-spacing:0.2px;cursor:pointer;color:#f8fafc;background:rgba(15,23,42,0.72);border:1px solid rgba(148,163,184,0.28);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);box-shadow:0 2px 8px rgba(0,0,0,0.22);opacity:0.42;transition:opacity 0.18s ease,transform 0.15s ease,background 0.18s ease;}',
                '.ag-pill:hover,.ag-wrap.menu-open .ag-pill{opacity:0.98;background:rgba(15,23,42,0.92);transform:translateY(-1px);}',
                '.ag-dot{width:6px;height:6px;border-radius:50%;background:#10b981;flex-shrink:0;}',
                '.ag-dot.en{background:#94a3b8;}',
                '.ag-menu{position:absolute;right:0;bottom:32px;min-width:176px;padding:5px;border-radius:9px;background:rgba(15,23,42,0.95);border:1px solid rgba(148,163,184,0.28);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);box-shadow:0 8px 24px rgba(0,0,0,0.38);color:#e2e8f0;font-size:12px;display:none;flex-direction:column;gap:2px;}',
                '.ag-wrap.menu-open .ag-menu{display:flex;}',
                '.ag-item{padding:5px 8px;border-radius:6px;cursor:pointer;display:flex;align-items:center;justify-content:space-between;gap:8px;white-space:nowrap;}',
                '.ag-item:hover{background:rgba(255,255,255,0.1);}',
                '.ag-item.active{color:#34d399;font-weight:600;}',
                '.ag-sep{height:1px;margin:3px 2px;background:rgba(148,163,184,0.2);}',
                '.ag-hint{font-size:10px;color:#94a3b8;padding:3px 8px 2px;}'
            ].join('');

            const wrap = document.createElement('div');
            wrap.className = 'ag-wrap';
            const pill = document.createElement('div');
            pill.className = 'ag-pill';
            const dot = document.createElement('span');
            dot.className = 'ag-dot';
            const labelSpan = document.createElement('span');
            pill.appendChild(dot);
            pill.appendChild(labelSpan);

            const menu = document.createElement('div');
            menu.className = 'ag-menu';
            wrap.appendChild(menu);
            wrap.appendChild(pill);
            sr.appendChild(style);
            sr.appendChild(wrap);

            try {
                const savedPos = typeof localStorage !== 'undefined' ? JSON.parse(localStorage.getItem('__ag_hanhua_pos__') || 'null') : null;
                if (savedPos && typeof savedPos.bottom === 'number') {
                    wrap.style.bottom = Math.max(8, Math.min(window.innerHeight - 36, savedPos.bottom)) + 'px';
                    if (savedPos.side === 'left') {
                        wrap.style.left = '12px';
                        wrap.style.right = 'auto';
                        menu.style.left = '0';
                        menu.style.right = 'auto';
                    }
                }
            } catch (e) {}

            const canDualZh = Boolean(INIT_CONFIG.embedDualZh || isExtHttpProxy || (dictCache['zh-cn'] && dictCache['zh-tw']));

            const rebuildMenu = () => {
                menu.innerHTML = '';
                const addLangItem = (code, title) => {
                    const it = document.createElement('div');
                    it.className = 'ag-item' + (langMode === code ? ' active' : '');
                    it.innerHTML = '<span>' + title + '</span><span>' + (langMode === code ? '✓' : '') + '</span>';
                    it.onclick = (ev) => {
                        ev.stopPropagation();
                        wrap.classList.remove('menu-open');
                        applyStateInternal({ langMode: code }, { persist: true, source: 'menu' });
                    };
                    menu.appendChild(it);
                };

                if (canDualZh) {
                    addLangItem('zh-cn', '简体中文');
                    addLangItem('zh-tw', '繁體中文');
                } else {
                    addLangItem(INIT_CONFIG.defaultLang, INIT_CONFIG.defaultLang === 'zh-tw' ? '繁體中文' : '简体中文');
                }
                addLangItem('en', 'English (原文)');

                const sep1 = document.createElement('div');
                sep1.className = 'ag-sep';
                menu.appendChild(sep1);

                const optItem = document.createElement('div');
                optItem.className = 'ag-item' + (keepOptionNamesEn ? ' active' : '');
                const optTitle = USE_TW ? '設定項名稱保留英文' : '设置项名称保留英文';
                optItem.innerHTML = '<span>' + optTitle + '</span><span>' + (keepOptionNamesEn ? '☑' : '☐') + '</span>';
                optItem.onclick = (ev) => {
                    ev.stopPropagation();
                    applyStateInternal({ keepOptionNamesEn: !keepOptionNamesEn }, { persist: true, forceRefresh: true, source: 'menu' });
                };
                menu.appendChild(optItem);

                const hideItem = document.createElement('div');
                hideItem.className = 'ag-item';
                hideItem.innerHTML = '<span>' + (USE_TW ? '隱藏懸浮球' : '隐藏悬浮球') + '</span>';
                hideItem.onclick = (ev) => {
                    ev.stopPropagation();
                    wrap.classList.remove('menu-open');
                    applyStateInternal({ hideFloatBtn: true }, { persist: true, source: 'menu' });
                };
                menu.appendChild(hideItem);

                const hint = document.createElement('div');
                hint.className = 'ag-hint';
                const isMac = typeof navigator !== 'undefined' && /Mac/i.test(navigator.platform || '');
                hint.textContent = (isMac ? '快捷键: Opt+Shift+L' : '快捷键: Alt+Shift+L');
                menu.appendChild(hint);
            };

            updateFloatUiFn = () => {
                wrap.classList.toggle('hidden', Boolean(floatBtnHidden));
                dot.classList.toggle('en', langMode === 'en');
                if (langMode === 'en') {
                    labelSpan.textContent = 'EN';
                    pill.title = 'Click to switch to Chinese / 右键更多选项 (Alt+Shift+L)';
                } else if (langMode === 'zh-tw') {
                    labelSpan.textContent = canDualZh ? '繁' : '中';
                    pill.title = '點擊切換英文原文 / 右鍵開啟選單 (Opt/Alt+Shift+L)';
                } else {
                    labelSpan.textContent = '中';
                    pill.title = '点击切换英文原文 / 右键打开菜单 (Alt+Shift+L)';
                }
                if (wrap.classList.contains('menu-open')) {
                    rebuildMenu();
                }
            };

            let dragStartX = 0;
            let dragStartY = 0;
            let dragged = false;
            let pointerActive = false;

            pill.addEventListener('pointerdown', (ev) => {
                if (ev.button !== 0) return;
                pointerActive = true;
                dragged = false;
                dragStartX = ev.clientX;
                dragStartY = ev.clientY;
                try { pill.setPointerCapture(ev.pointerId); } catch (e) {}
            });

            pill.addEventListener('pointermove', (ev) => {
                if (!pointerActive) return;
                const dx = ev.clientX - dragStartX;
                const dy = ev.clientY - dragStartY;
                if (!dragged && Math.hypot(dx, dy) > 5) {
                    dragged = true;
                    wrap.classList.remove('menu-open');
                }
                if (dragged) {
                    const newBottom = Math.max(8, Math.min(window.innerHeight - 36, window.innerHeight - ev.clientY - 13));
                    wrap.style.bottom = newBottom + 'px';
                    if (ev.clientX < window.innerWidth / 2) {
                        wrap.style.left = '12px';
                        wrap.style.right = 'auto';
                        menu.style.left = '0';
                        menu.style.right = 'auto';
                    } else {
                        wrap.style.right = '14px';
                        wrap.style.left = 'auto';
                        menu.style.right = '0';
                        menu.style.left = 'auto';
                    }
                }
            });

            pill.addEventListener('pointerup', (ev) => {
                if (!pointerActive) return;
                pointerActive = false;
                try { pill.releasePointerCapture(ev.pointerId); } catch (e) {}
                if (dragged) {
                    try {
                        const side = wrap.style.left === '12px' ? 'left' : 'right';
                        const bottom = parseInt(wrap.style.bottom, 10) || 42;
                        if (typeof localStorage !== 'undefined') {
                            localStorage.setItem('__ag_hanhua_pos__', JSON.stringify({ side: side, bottom: bottom }));
                        }
                    } catch (e) {}
                    return;
                }
                wrap.classList.remove('menu-open');
                toggleLanguageQuick();
            });

            pill.addEventListener('contextmenu', (ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                rebuildMenu();
                wrap.classList.toggle('menu-open');
            });

            document.addEventListener('pointerdown', (ev) => {
                if (ev.target !== host && wrap.classList.contains('menu-open')) {
                    wrap.classList.remove('menu-open');
                }
            });

            document.body.appendChild(host);
            updateFloatUiFn();
        } catch (e) {}
    }

    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function' && !window._agShortcutBound) {
        window._agShortcutBound = true;
        window.addEventListener('keydown', (ev) => {
            if (ev && ev.altKey && ev.shiftKey && !ev.ctrlKey && !ev.metaKey && ev.code === 'KeyL') {
                ev.preventDefault();
                ev.stopPropagation();
                toggleLanguageQuick();
            }
        }, true);

        const hanhuaControllerApi = {
            getState: () => ({
                langMode: langMode,
                lastZhLang: lastZhLang,
                keepOptionNamesEn: keepOptionNamesEn,
                hideFloatBtn: floatBtnHidden
            }),
            setState: (patch, persist) => applyStateInternal(patch, {
                persist: persist !== false,
                forceRefresh: true,
                source: 'api'
            }),
            setLang: (mode, persist) => applyStateInternal({ langMode: mode }, {
                persist: persist !== false,
                forceRefresh: true,
                source: 'api'
            }),
            setKeepOptionNamesEn: (flag, persist) => applyStateInternal({ keepOptionNamesEn: Boolean(flag) }, {
                persist: persist !== false,
                forceRefresh: true,
                source: 'api'
            }),
            toggle: toggleLanguageQuick,
            toggleLanguage: toggleLanguageQuick,
            flushPendingNodes: flushPendingNodes
        };
        window.__agHanhua = hanhuaControllerApi;
        try {
            const em = typeof electron_1 !== 'undefined' ? electron_1 : (typeof require === 'function' ? require('electron') : null);
            if (em && em.contextBridge && typeof em.contextBridge.exposeInMainWorld === 'function') {
                em.contextBridge.exposeInMainWorld('__agHanhua', hanhuaControllerApi);
            }
        } catch (e) {}
    }

    const startEngine = () => {
        const target = (typeof document !== 'undefined') ? (document.body || document.documentElement) : null;
        if (target) {
            try {
                observer.observe(target, obsOpts);
                if (langMode !== 'en') {
                    translateNode(target);
                }
                if (document.body) {
                    mountFloatingToggle();
                }
                if (document.querySelector && document.querySelector('[data-testid="add-mcp-screen"]')) {
                    scheduleMcpSniffer();
                }
            } catch (e) {}
        }
    };

    // 强力多阶段触发绑定
    if (typeof document !== 'undefined' && document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', startEngine);
    } else {
        startEngine();
    }
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
        window.addEventListener('load', startEngine);
    }
    setTimeout(startEngine, 100);
    setTimeout(startEngine, 300);
    setTimeout(startEngine, 1000);
    setTimeout(startEngine, 3000);
    setTimeout(startEngine, 6000);
})();`;

    const renderedBody = jsSource
        .replace("INIT_CONFIG_PLACEHOLDER", () => initConfigJson)
        .replace("DICT_MAIN_PLACEHOLDER", () => dictJson)
        .replace("DICT_ALT_PLACEHOLDER", () => altDictJson);

    return SIGNATURE_START + "\n" + renderedBody + "\n" + SIGNATURE_END;
}

function cleanJsContent(content) {
    const regex = new RegExp(escapeRegExp(SIGNATURE_START) + "[\\s\\S]*?" + escapeRegExp(SIGNATURE_END), "g");
    return content.replace(regex, "");
}

function cleanMenuJsContent(content) {
    content = content.replace(/\n?\s*\/\* --- MENU TRANSLATION START --- \*\/[\s\S]*?\/\* --- MENU TRANSLATION END --- \*\//g, '');
    const startMark = "// ==========================================\n    // Antigravity Native Menu Chinese Translation";
    const endMark = "translateMenu(menu.items);";
    const startIdx = content.indexOf(startMark);
    const endIdx = content.indexOf(endMark);
    if (startIdx !== -1 && endIdx !== -1 && startIdx < endIdx) {
        return content.substring(0, startIdx) + content.substring(endIdx + endMark.length);
    }
    return content;
}

function cleanTrayJsContent(content) {
    content = content.replace(/\n\s*\/\* --- TRAY TRANSLATION START --- \*\/[\s\S]*?\/\* --- TRAY TRANSLATION END --- \*\//g, '');
    content = content.replace(/\n\s*\/\* --- TRAY DOUBLE CLICK START --- \*\/[\s\S]*?\/\* --- TRAY DOUBLE CLICK END --- \*\//g, '');
    return content;
}

function escapeRegExp(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

let wasAppRunning = false;

function checkIfAppIsRunning() {
    try {
        if (process.platform === 'win32') {
            const stdout = child_process.execSync('tasklist /fi "imagename eq Antigravity.exe" /nh', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
            let isRunning = stdout.toLowerCase().includes('antigravity.exe');
            try {
                const stdoutIde = child_process.execSync('tasklist /fi "imagename eq Antigravity IDE.exe" /nh', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
                isRunning = isRunning || stdoutIde.toLowerCase().includes('antigravity ide.exe');
            } catch (e) {}
            return isRunning;
        } else if (process.platform === 'darwin') {
            const stdout = child_process.execSync('pgrep -x Antigravity || pgrep -f "/Contents/MacOS/Antigravity" || pgrep -f "Antigravity IDE"', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
            return stdout.trim().length > 0;
        }
    } catch (e) {
        // ignore
    }
    return false;
}

function closeAntigravityProcesses() {
    console.log("[1] 检测到 Antigravity 相关进程正在运行，正在关闭以解除文件锁...");
    try {
        if (process.platform === 'win32') {
            child_process.execSync('taskkill /f /im Antigravity.exe /t >nul 2>nul');
            child_process.execSync('taskkill /f /im "Antigravity IDE.exe" /t >nul 2>nul');
        } else {
            child_process.execSync('killall Antigravity >/dev/null 2>&1; killall "Antigravity Helper" >/dev/null 2>&1; pkill -x Antigravity >/dev/null 2>&1; pkill -f "/Contents/MacOS/Antigravity" >/dev/null 2>&1; pkill -f "Antigravity IDE" >/dev/null 2>&1');
        }
    } catch (e) {
        // ignore
    }
    const start = Date.now();
    while (Date.now() - start < 1500) {}
}

function hasAntigravityResources(candidate) {
    return fs.existsSync(path.join(candidate, "resources", "app.asar")) ||
        fs.existsSync(path.join(candidate, "app.asar")) ||
        fs.existsSync(path.join(candidate, "Contents", "Resources", "app.asar")) ||
        fs.existsSync(path.join(candidate, "resources", "app", "product.json")) ||
        fs.existsSync(path.join(candidate, "Contents", "Resources", "app", "product.json")) ||
        fs.existsSync(path.join(candidate, "app", "product.json"));
}

function detectInstallations(manualDir) {
    if (manualDir) {
        if (fs.existsSync(manualDir)) {
            let resolved = path.resolve(manualDir);
            if (fs.statSync(resolved).isFile() && resolved.endsWith('app.asar')) {
                resolved = path.dirname(resolved);
            }
            return [resolved];
        } else {
            console.error(`[错误] 手动指定的路径不存在: ${manualDir}`);
            process.exit(1);
        }
    }

    const found = [];
    const seen = new Set();
    const addFound = (candidate) => {
        if (!candidate) return;
        const normalized = path.resolve(candidate);
        const key = normalized.toLowerCase();
        if (!seen.has(key) && fs.existsSync(normalized) && hasAntigravityResources(normalized)) {
            found.push(normalized);
            seen.add(key);
        }
    };

    if (process.platform === 'win32') {
        addFound(process.env.ANTIGRAVITY_INSTALL_DIR);
        addFound(process.env.ANTIGRAVITY_HOME);

        const registryRoots = [
            'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
            'HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
            'HKLM\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall'
        ];
        for (const root of registryRoots) {
            try {
                const output = child_process.execSync(`reg query "${root}" /s /f Antigravity /d`, { encoding: 'utf-8', stdio: 'pipe' });
                for (const line of output.split(/\r?\n/)) {
                    const match = line.match(/^\s*(InstallLocation|DisplayIcon)\s+REG_\w+\s+(.+)$/i);
                    if (!match) continue;
                    let value = match[2].trim().replace(/^"|"$/g, '');
                    if (/Antigravity(?:\s*IDE)?\.exe/i.test(value)) {
                        value = path.dirname(value);
                    }
                    addFound(value);
                }
            } catch (e) {
                // Registry probing is best-effort; fall back to common locations below.
            }
        }

        const driveLetters = ['C', 'D', 'E', 'F'];
        for (const drive of driveLetters) {
            addFound(`${drive}:\\Programs\\Antigravity`);
            addFound(`${drive}:\\Antigravity`);
            addFound(`${drive}:\\Programs\\Antigravity IDE`);
            addFound(`${drive}:\\Antigravity IDE`);
        }
        addFound("C:\\Program Files\\Antigravity");
        addFound("C:\\Program Files\\Antigravity IDE");

        const localAppdata = process.env.LOCALAPPDATA;
        if (localAppdata) {
            addFound(path.join(localAppdata, 'Programs', 'antigravity'));
            addFound(path.join(localAppdata, 'Programs', 'Antigravity IDE'));
        }
    } else if (process.platform === 'darwin') {
        const userHome = (process.env.SUDO_USER && process.env.SUDO_USER !== 'root')
            ? path.join('/Users', process.env.SUDO_USER)
            : (process.env.HOME || '');

        // 1. Antigravity 2.0 桌面客户端
        addFound("/Applications/Antigravity.app");
        addFound(path.join(userHome, 'Applications', 'Antigravity.app'));

        // 2. Antigravity IDE 编辑器
        addFound("/Applications/Antigravity IDE.app");
        addFound(path.join(userHome, 'Applications', 'Antigravity IDE.app'));
    }

    return found;
}

function detectInstallationDir(manualDir) {
    const list = detectInstallations(manualDir);
    if (list.length > 0) {
        return list[0];
    }
    console.error("[错误] 未找到默认安装目录，请使用 --install-dir 手动指定您的安装路径！");
    process.exit(1);
}

function runCommandSync(cmd) {
    try {
        const execEnv = { ...process.env };
        if (process.platform === 'darwin' && process.getuid && process.getuid() === 0) {
            execEnv.npm_config_cache = path.join(os.tmpdir(), 'antigravity_npm_cache');
            execEnv.npm_config_yes = 'true';
        }
        const out = child_process.execSync(cmd, { encoding: 'utf-8', stdio: 'pipe', env: execEnv });
        return { success: true, stdout: out, stderr: '' };
    } catch (e) {
        return { success: false, stdout: e.stdout || '', stderr: e.stderr || e.message };
    }
}

function cleanElectronCache() {
    const appSupportDirs = [];
    if (process.platform === 'darwin') {
        let userHome = os.homedir();
        if (process.env.SUDO_USER && process.env.SUDO_USER !== 'root') {
            const sudoHome = path.join('/Users', process.env.SUDO_USER);
            if (fs.existsSync(sudoHome)) {
                userHome = sudoHome;
            }
        }
        appSupportDirs.push(path.join(userHome, 'Library', 'Application Support', 'Antigravity'));
        appSupportDirs.push(path.join(userHome, 'Library', 'Application Support', 'Antigravity IDE'));
    } else if (process.platform === 'win32') {
        const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
        appSupportDirs.push(path.join(appData, 'Antigravity'));
        appSupportDirs.push(path.join(appData, 'Antigravity IDE'));
    } else {
        appSupportDirs.push(path.join(os.homedir(), '.config', 'Antigravity'));
        appSupportDirs.push(path.join(os.homedir(), '.config', 'Antigravity IDE'));
    }

    const cacheDirs = ['Cache', 'Code Cache', 'GPUCache', 'DawnWebGPUCache', 'DawnGraphiteCache'];
    let cleanedCount = 0;
    for (const appSupportDir of appSupportDirs) {
        if (!fs.existsSync(appSupportDir)) continue;
        for (const c of cacheDirs) {
            const p = path.join(appSupportDir, c);
            if (fs.existsSync(p)) {
                try {
                    fs.rmSync(p, { recursive: true, force: true });
                    cleanedCount++;
                } catch (e) {}
            }
        }
    }
    if (cleanedCount > 0) {
        console.log(`[缓存] 已自动清理 ${cleanedCount} 个应用缓存目录，避免新旧版本字节码冲突。`);
    }
}

function resignAppOnMac(anyPath) {
    if (process.platform !== 'darwin') return;
    
    let targetApp = "";
    let current = path.resolve(anyPath);
    for (let i = 0; i < 10; i++) {
        if (current.endsWith(".app")) {
            targetApp = current;
            break;
        }
        const parent = path.dirname(current);
        if (parent === current) break;
        current = parent;
    }
    
    if (targetApp && fs.existsSync(targetApp)) {
        let bundleId = '';
        try {
            const plistPath = path.join(targetApp, 'Contents', 'Info.plist');
            const macAsarPath = path.join(targetApp, 'Contents', 'Resources', 'app.asar');
            if (fs.existsSync(plistPath)) {
                const plistContent = fs.readFileSync(plistPath, 'utf-8');
                const idMatch = plistContent.match(/<key>CFBundleIdentifier<\/key>\s*<string>([^<]+)<\/string>/);
                if (idMatch && idMatch[1]) {
                    bundleId = idMatch[1].trim();
                }
                if (fs.existsSync(macAsarPath) && plistContent.includes('ElectronAsarIntegrity')) {
                    const asarBuf = fs.readFileSync(macAsarPath);
                    const headerStrSize = asarBuf.readUInt32LE(12);
                    const headerHash = crypto.createHash('sha256').update(asarBuf.subarray(16, 16 + headerStrSize)).digest('hex');
                    const integrityRegex = /(<key>ElectronAsarIntegrity<\/key>[\s\S]*?<key>Resources\/app\.asar<\/key>[\s\S]*?<key>hash<\/key>\s*<string>)[a-fA-F0-9]{64}(<\/string>)/;
                    if (integrityRegex.test(plistContent)) {
                        const updatedPlist = plistContent.replace(integrityRegex, `$1${headerHash}$2`);
                        if (updatedPlist !== plistContent) {
                            fs.writeFileSync(plistPath, updatedPlist, 'utf-8');
                            console.log('[签名] 已同步更新 macOS Info.plist 中的 ElectronAsarIntegrity 校验值。');
                        }
                    }
                }
            }
        } catch (e) {}
        try {
            runCommandSync(`xattr -cr "${targetApp}"`);
        } catch (e) {}
        console.log(`[签名] 检测到 macOS 平台，正在对应用包进行本地 ad-hoc 深度重签名: ${targetApp} ...`);
        const reqArg = bundleId ? `-r='designated => identifier "${bundleId}"' ` : '';
        let signRes = runCommandSync(`codesign --force --deep --sign - ${reqArg}"${targetApp}"`);
        if (!signRes.success && reqArg) {
            signRes = runCommandSync(`codesign --force --deep --sign - "${targetApp}"`);
        }
        if (signRes.success) {
            console.log(`[签名] 重新签名成功！`);
        } else {
            console.warn(`[警告] 重新签名失败。可能会导致应用无法打开。详情:\n${signRes.stderr}\n${signRes.stdout}`);
        }
    } else {
        console.warn(`[警告] 未能从路径 ${anyPath} 识别到有效的 .app 路径，跳过重新签名。`);
    }
}

function getMacEnvSetupCode() {
    return `
/* --- MAC ENV & KEYCHAIN SETUP START --- */
function __applyMacProxyAndEnv(targetEnv, electronApp) {
    try {
        if (process.platform !== 'darwin') return;
        const env = targetEnv || process.env;
        if (electronApp && electronApp.commandLine) {
            try {
                electronApp.commandLine.appendSwitch('use-mock-keychain');
                electronApp.commandLine.appendSwitch('password-store', 'basic');
                electronApp.commandLine.appendSwitch('proxy-bypass-list', '<-loopback>,localhost,127.0.0.1,::1,.local');
            } catch (e) {}
        }
        let proxyUrl = env.HTTPS_PROXY || env.https_proxy || env.HTTP_PROXY || env.http_proxy || env.ALL_PROXY || env.all_proxy || '';
        if (!proxyUrl) {
            const cp = typeof process.getBuiltinModule === 'function' ? process.getBuiltinModule('child_process') : require('child_process');
            try {
                const scOut = cp.execSync('/usr/sbin/scutil --proxy', { encoding: 'utf8', timeout: 1500 });
                const getVal = (key) => {
                    const m = scOut.match(new RegExp('^\\\\s*' + key + '\\\\s*:\\\\s*(.+)$', 'm'));
                    return m ? m[1].trim() : '';
                };
                if (getVal('HTTPSEnable') === '1' && getVal('HTTPSProxy') && getVal('HTTPSPort')) {
                    proxyUrl = 'http://' + getVal('HTTPSProxy') + ':' + getVal('HTTPSPort');
                } else if (getVal('HTTPEnable') === '1' && getVal('HTTPProxy') && getVal('HTTPPort')) {
                    proxyUrl = 'http://' + getVal('HTTPProxy') + ':' + getVal('HTTPPort');
                } else if (getVal('SOCKSEnable') === '1' && getVal('SOCKSProxy') && getVal('SOCKSPort')) {
                    proxyUrl = 'socks5://' + getVal('SOCKSProxy') + ':' + getVal('SOCKSPort');
                }
            } catch (e) {}
            if (!proxyUrl) {
                const candidatePorts = [7890, 7897, 18080, 10808, 10809, 6152];
                for (const p of candidatePorts) {
                    try {
                        const r = cp.spawnSync('/usr/bin/nc', ['-z', '-G', '1', '127.0.0.1', String(p)], { timeout: 600 });
                        if (r && r.status === 0) {
                            proxyUrl = 'http://127.0.0.1:' + p;
                            break;
                        }
                    } catch (e) {}
                }
            }
        }
        if (proxyUrl) {
            env.HTTP_PROXY = env.HTTP_PROXY || proxyUrl;
            env.HTTPS_PROXY = env.HTTPS_PROXY || proxyUrl;
            env.http_proxy = env.http_proxy || proxyUrl;
            env.https_proxy = env.https_proxy || proxyUrl;
            env.ALL_PROXY = env.ALL_PROXY || proxyUrl;
            env.all_proxy = env.all_proxy || proxyUrl;
            const noProxy = 'localhost,127.0.0.1,::1,.local';
            env.NO_PROXY = env.NO_PROXY || noProxy;
            env.no_proxy = env.no_proxy || noProxy;
        }
    } catch (e) {}
}
/* --- MAC ENV & KEYCHAIN SETUP END --- */
`;
}

function ensureWritePermission(targetDir) {
    if (process.platform !== 'darwin') return true;
    const checkDir = fs.existsSync(path.join(targetDir, 'Contents', 'Resources'))
        ? path.join(targetDir, 'Contents', 'Resources')
        : targetDir;
    try {
        fs.accessSync(checkDir, fs.constants.W_OK);
        const testFile = path.join(checkDir, '.perm_test_' + Date.now());
        fs.writeFileSync(testFile, 'test');
        fs.unlinkSync(testFile);
        return true;
    } catch (err) {
        if (err && err.code === 'EACCES' && process.stdin.isTTY && process.getuid && process.getuid() !== 0) {
            console.log("[权限] 检测到当前环境缺少对应用目录的写入权限，正在尝试请求管理员权限 (sudo) 重新运行...");
            const args = process.argv.slice(1);
            const res = child_process.spawnSync('sudo', [process.execPath, ...args], {
                stdio: 'inherit'
            });
            if (res.status === 0) {
                process.exit(0);
            } else {
                console.error("\n[错误] 管理员提权执行失败或用户取消了密码输入。");
                process.exit(res.status || 1);
            }
        }
        return false;
    }
}

// ==========================================
// Antigravity 2.0 汉化引擎 (原生极速外科手术 ASAR 注入 + 兜底解包模式)
// ==========================================
function buildMenuTranslationSnippet() {
    return `
    /* --- MENU TRANSLATION START --- */
    // ==========================================
    // Antigravity Native Menu Chinese Translation (Hot-Switch Ready)
    // ==========================================
    let __agMenuLangMode = (typeof global !== 'undefined' && global.__agMenuLangMode)
        ? global.__agMenuLangMode
        : ${USE_TW ? "'zh-tw'" : "'zh-cn'"};
    try {
        const __sm = require('./storage');
        if (__sm && __sm.storageManager && typeof __sm.storageManager.getItem === 'function') {
            const __savedMode = __sm.storageManager.getItem('ag.hanhua.langMode');
            if (__savedMode === 'en' || __savedMode === 'zh-cn' || __savedMode === 'zh-tw') {
                __agMenuLangMode = __savedMode;
            }
        }
    } catch (_e) {}
    if (typeof global !== 'undefined') global.__agMenuLangMode = __agMenuLangMode;
    const translationsTw = {
        'File': '檔案',
        'Edit': '編輯',
        'View': '檢視',
        'Window': '視窗',
        'Help': '說明',
        'New Window': '開新視窗',
        'Create Project': '建立專案',
        'Command Palette': '命令選擇區',
        'Docs': '說明文件',
        'Check for Updates': '檢查更新',
        'Checking for Updates...': '正在檢查更新...',
        'Downloading Update...': '正在下載更新...',
        'Restart to Update': '重新啟動以更新',
        'Toggle Developer Tools': '切換開發人員工具',
        'Undo': '復原',
        'Redo': '重做',
        'Cut': '剪下',
        'Copy': '複製',
        'Paste': '貼上',
        'Select All': '全選',
        'Minimize': '最小化',
        'Maximize': '最大化',
        'Close': '關閉',
        'Zoom': '縮放',
        'Actual Size': '實際大小',
        'Reset Zoom': '重設縮放',
        'Zoom In': '放大',
        'Zoom Out': '縮小',
        'Toggle Full Screen': '切換全螢幕',
        'Toggle Between Light/Dark Themes': '切換淺色/深色佈景主題',
        'Split Terminal': '分割終端機',
        'Split Conversation Horizontally': '水平分割對話',
        'Split Conversation Vertically': '垂直分割對話',
        'Split': '分割',
        'Split Right': '向右分割',
        'Split Down': '向下分割',
        'Replace With New': '替換為新對話',
        'Show in File Explorer': '在檔案總管中顯示',
        'Reveal in Finder': '在 Finder 中顯示',
        'Find in conversation': '在對話中尋找',
        'Connect to WSL': '連線至 WSL',
        'Reopen Locally': '在本機重新開啟',
        'About Antigravity': '關於 Antigravity',
        'Settings...': '設定...',
        'Preferences...': '偏好設定...',
        'Services': '服務',
        'Hide Antigravity': '隱藏 Antigravity',
        'Hide Others': '隱藏其他',
        'Show All': '顯示全部',
        'Quit Antigravity': '結束 Antigravity',
        'Quit': '結束',
        'Paste and Match Style': '貼上並符合樣式',
        'Delete': '刪除',
        'Bring All to Front': '將此程式所有視窗移至最前',
        'Close Window': '關閉視窗',
        'Version': '版本'
    };
    const translationsSc = {
        'File': '文件',
        'Edit': '编辑',
        'View': '视图',
        'Window': '窗口',
        'Help': '帮助',
        'New Window': '新建窗口',
        'Create Project': '创建项目',
        'Command Palette': '命令面板',
        'Docs': '文档',
        'Check for Updates': '检查更新',
        'Checking for Updates...': '正在检查更新...',
        'Downloading Update...': '正在下载更新...',
        'Restart to Update': '重启以完成更新',
        'Toggle Developer Tools': '切换开发者工具',
        'Undo': '撤销',
        'Redo': '重做',
        'Cut': '剪切',
        'Copy': '复制',
        'Paste': '粘贴',
        'Select All': '全选',
        'Minimize': '最小化',
        'Maximize': '最大化',
        'Close': '关闭',
        'Zoom': '缩放',
        'Actual Size': '实际大小',
        'Reset Zoom': '重置缩放',
        'Zoom In': '放大',
        'Zoom Out': '缩小',
        'Toggle Full Screen': '切换全屏',
        'Toggle Between Light/Dark Themes': '切换浅色/深色主题',
        'Split Terminal': '拆分终端',
        'Split Conversation Horizontally': '水平拆分会话',
        'Split Conversation Vertically': '垂直拆分会话',
        'Split': '拆分',
        'Split Right': '向右拆分',
        'Split Down': '向下拆分',
        'Replace With New': '替换为新会话',
        'Show in File Explorer': '在文件资源管理器中显示',
        'Reveal in Finder': '在访达中显示',
        'Find in conversation': '在会话中查找',
        'Connect to WSL': '连接到 WSL',
        'Reopen Locally': '在本地重新打开',
        'About Antigravity': '关于 Antigravity',
        'Settings...': '设置...',
        'Preferences...': '首选项...',
        'Services': '服务',
        'Hide Antigravity': '隐藏 Antigravity',
        'Hide Others': '隐藏其他',
        'Show All': '全部显示',
        'Quit Antigravity': '退出 Antigravity',
        'Quit': '退出',
        'Paste and Match Style': '粘贴并匹配样式',
        'Delete': '删除',
        'Bring All to Front': '前置全部窗口',
        'Close Window': '关闭窗口',
        'Version': '版本'
    };
    function translateMenu(items) {
        if (!Array.isArray(items)) return;
        const activeTranslations = __agMenuLangMode === 'zh-tw' ? translationsTw : translationsSc;
        for (const item of items) {
            if (!item) continue;
            if (item._origRawLabel === undefined) {
                item._origRawLabel = item.label || '';
            }
            const rawLabel = item._origRawLabel;
            let mnemonic = '';
            let cleanLabel = rawLabel;
            const m = rawLabel.match(/&([a-zA-Z])/);
            if (m) {
                mnemonic = "(&" + m[1] + ")";
                cleanLabel = rawLabel.replace('&', '');
            }
            if (!item._origCleanLabel) item._origCleanLabel = cleanLabel;
            // 保护基于英文 menuItem.label 分发的点击回调（如 Check for Updates / Restart to Update）
            if (typeof item.click === 'function' && !item._cnClickWrapped && (item.id === 'check-for-updates' || rawLabel === 'Check for Updates' || rawLabel === 'Restart to Update')) {
                const origClick = item.click;
                item._cnClickWrapped = true;
                item.click = function(menuItem, browserWindow, event) {
                    const rawStepLabel = item._origRawLabel || (menuItem && menuItem._origRawLabel) || (menuItem && menuItem.label) || rawLabel;
                    const proxyItem = menuItem ? Object.assign(Object.create(Object.getPrototypeOf(menuItem)), menuItem, { label: rawStepLabel }) : { label: rawStepLabel };
                    return origClick.call(this, proxyItem, browserWindow, event);
                };
            }
            if (__agMenuLangMode === 'en') {
                item.label = rawLabel;
            } else if (activeTranslations[cleanLabel]) {
                item.label = activeTranslations[cleanLabel] + mnemonic;
            } else if (activeTranslations[rawLabel]) {
                item.label = activeTranslations[rawLabel];
            } else if (/^Version\\s*([\\d\\.]*)$/i.test(cleanLabel)) {
                item.label = cleanLabel.replace(/^Version\\s*([\\d\\.]*)$/i, (match, v) => v ? "版本 " + v : "版本");
            }
            if (item.submenu && item.submenu.items) {
                translateMenu(item.submenu.items);
            }
        }
    }
    if (menu && Array.isArray(menu.items) && !menu.items._cnFindHooked) {
        menu.items._cnFindHooked = true;
        const origFind = menu.items.find.bind(menu.items);
        menu.items.find = function(pred, thisArg) {
            return origFind((it, idx, arr) => {
                if (pred.call(thisArg, it, idx, arr)) return true;
                if (it && it._origCleanLabel && pred.call(thisArg, { ...it, label: it._origCleanLabel }, idx, arr)) return true;
                return false;
            });
        };
    }
    if (!electron_1.Menu._cnHooked) {
        electron_1.Menu._cnHooked = true;
        const origSetAppMenu = electron_1.Menu.setApplicationMenu.bind(electron_1.Menu);
        electron_1.Menu.setApplicationMenu = function(m) {
            if (m && m.items) translateMenu(m.items);
            return origSetAppMenu(m);
        };
        if (electron_1.ipcMain && !electron_1.ipcMain._cnMenuLangHooked) {
            electron_1.ipcMain._cnMenuLangHooked = true;
            electron_1.ipcMain.on('ag-hanhua:set-lang-mode', (_evt, payload) => {
                try {
                    const nextMode = payload && payload.langMode ? String(payload.langMode).toLowerCase() : '';
                    if (nextMode === 'en' || nextMode === 'zh-cn' || nextMode === 'zh-tw') {
                        __agMenuLangMode = nextMode;
                        if (typeof global !== 'undefined') global.__agMenuLangMode = nextMode;
                        const curMenu = electron_1.Menu.getApplicationMenu();
                        if (curMenu && curMenu.items) {
                            translateMenu(curMenu.items);
                            origSetAppMenu(curMenu);
                        }
                    }
                } catch (e) {}
            });
        }
    }
    translateMenu(menu.items);
    /* --- MENU TRANSLATION END --- */`;
}

function buildDesktop20Mutators() {
    const translationJs = generateJs();
    const menuTranslationJs = buildMenuTranslationSnippet();

    return {
        "dist/preload.js": (content) => {
            console.log(`[修改] 正在向 preload.js 注入汉化代码...`);
            const cleanedContent = cleanJsContent(content);
            console.log(`[修改] 注入成功！`);
            return cleanedContent + "\n" + translationJs;
        },
        "dist/menu.js": (menuContent) => {
            console.log(`[修改] 正在向 menu.js 注入菜单汉化代码...`);
            const menuCleaned = cleanMenuJsContent(menuContent);
            const targetStr = "electron_1.Menu.setApplicationMenu(menu);";
            const idx = menuCleaned.indexOf(targetStr);
            if (idx !== -1) {
                console.log(`[修改] 菜单汉化注入成功！`);
                return menuCleaned.substring(0, idx) + menuTranslationJs + "\n    " + menuCleaned.substring(idx);
            }
            console.warn(`[警告] 未能在 menu.js 中找到设定的插入点。`);
            return menuCleaned;
        },
        "dist/tray.js": (trayContent) => {
            console.log(`[修改] 正在向 tray.js 注入任务栏菜单汉化...`);
            const trayCleaned = cleanTrayJsContent(trayContent);
            const defaultMode = USE_TW ? 'zh-tw' : 'zh-cn';
            const targetCreate = /function\s+createTray\s*\(([^)]*)\)\s*\{/;
            const replacementCreate = (match, args) => `function createTray(${args}) {
    /* --- TRAY TRANSLATION START --- */
    const __applyTrayLabels = (targetItems) => {
        const __mode = (typeof global !== 'undefined' && global.__agMenuLangMode) || '${defaultMode}';
        const __sc = { 'No agents running': '无运行中的智能体', 'Open Antigravity': '打开 Antigravity', 'Quit': '退出' };
        const __tw = { 'No agents running': '無執行中的代理', 'Open Antigravity': '開啟 Antigravity', 'Quit': '結束' };
        for (const item of targetItems) {
            if (!item || (!item.label && !item._origTrayLabel)) continue;
            if (item._origTrayLabel === undefined) item._origTrayLabel = item.label;
            const raw = item._origTrayLabel;
            if (__mode === 'en') {
                item.label = raw;
            } else {
                const dict = __mode === 'zh-tw' ? __tw : __sc;
                if (dict[raw]) {
                    item.label = dict[raw];
                } else if (raw.startsWith('Open ')) {
                    item.label = (__mode === 'zh-tw' ? '開啟 ' : '打开 ') + raw.slice(5);
                } else if (raw === 'Quit') {
                    item.label = __mode === 'zh-tw' ? '結束' : '退出';
                }
            }
        }
    };
    __applyTrayLabels(actions);
    /* --- TRAY TRANSLATION END --- */`;

            let trayPatched = trayCleaned.replace(targetCreate, replacementCreate);
            if (trayPatched === trayCleaned) {
                console.warn(`[警告] 未能在 tray.js 中找到 createTray 函数插入点。`);
            }

            const dblClickTarget = /tray\.setContextMenu\(contextMenu\);/;
            const dblClickReplacement = `tray.setContextMenu(contextMenu);
    /* --- TRAY DOUBLE CLICK START --- */
    if (electron_1.ipcMain && !electron_1.ipcMain._cnTrayLangHooked) {
        electron_1.ipcMain._cnTrayLangHooked = true;
        electron_1.ipcMain.on('ag-hanhua:set-lang-mode', () => {
            try {
                if (tray && contextMenu && Array.isArray(contextMenu.items)) {
                    __applyTrayLabels(contextMenu.items);
                    if (typeof global !== 'undefined' && typeof global.__agLastTrayCount === 'number') {
                        updateTrayAgentCount(global.__agLastTrayCount);
                    } else {
                        tray.setContextMenu(contextMenu);
                    }
                }
            } catch (e) {}
        });
    }
    const openAction = actions.find(item => item && typeof item.click === 'function' && !['Quit', '退出', '結束'].includes(item.label));
    if (openAction) {
        tray.on('double-click', () => {
            const baseWins = (electron_1.BaseWindow && typeof electron_1.BaseWindow.getAllWindows === 'function') ? electron_1.BaseWindow.getAllWindows() : [];
            const browserWins = (electron_1.BrowserWindow && typeof electron_1.BrowserWindow.getAllWindows === 'function') ? electron_1.BrowserWindow.getAllWindows() : [];
            const wins = baseWins.concat(browserWins);
            if (wins.length > 0 && typeof wins[0].isMinimized === 'function' && wins[0].isMinimized()) {
                wins[0].restore();
            }
            openAction.click();
        });
    }
    /* --- TRAY DOUBLE CLICK END --- */`;
            trayPatched = trayPatched.replace(dblClickTarget, dblClickReplacement);

            const countRegex = /countItem\.label\s*=\s*(?:\([\s\S]*?' running'|count\s*>\s*0\s*\?[\s\S]*?);/g;
            const replacementCount = `if (typeof global !== 'undefined') global.__agLastTrayCount = count; const __tMode = (typeof global !== 'undefined' && global.__agMenuLangMode) || '${defaultMode}'; countItem.label = __tMode === 'en' ? (count > 0 ? \`\${count} agent\${count === 1 ? '' : 's'} running\` : 'No agents running') : (__tMode === 'zh-tw' ? (count > 0 ? \`\${count} 個代理執行中\` : '無執行中的代理') : (count > 0 ? \`\${count} 个智能体运行中\` : '无运行中的智能体'));`;
            trayPatched = trayPatched.replace(countRegex, replacementCount);
            console.log(`[修改] 任务栏菜单汉化注入成功！`);
            return trayPatched;
        },
        "dist/loadingOverlay.js": (loadingContent) => {
            if (!loadingContent.includes('<div class="text">')) {
                // v2.31.2+ 加载页已改为纯 SVG Logo，无文本节点，安全跳过
                return loadingContent;
            }
            console.log(`[修改] 正在向 loadingOverlay.js 注入加载页汉化...`);
            const replacementText = USE_TW
                ? '<div class="text">正在載入 Antigravity…</div>'
                : '<div class="text">正在加载 Antigravity…</div>';
            const out = loadingContent
                .replace('<div class="text">Loading Antigravity</div>', replacementText)
                .replace('<div class="text">反重力引擎已啟動，正在努力擺脫地心引力...</div>', replacementText)
                .replace('<div class="text">反重力引擎已启动，正在努力摆脱地心引力...</div>', replacementText);
            console.log(`[修改] 加载页汉化注入成功！`);
            return out;
        },
        "dist/updater.js": (updaterContent) => {
            console.log(`[修改] 正在向 updater.js 注入更新弹窗与动态菜单状态汉化...`);
            let cleaned = updaterContent.replace(/\n?\s*\/\* --- UPDATER TRANSLATION START --- \*\/[\s\S]*?\/\* --- UPDATER TRANSLATION END --- \*\//g, '');
            const defaultMode = USE_TW ? 'zh-tw' : 'zh-cn';
            const targetOptions = `                title: 'Check for Updates',
                message: 'No updates available',
                buttons: ['OK'],`;
            const replacementOptions = `                title: ((typeof global !== 'undefined' && global.__agMenuLangMode) || '${defaultMode}') === 'en' ? 'Check for Updates' : (((typeof global !== 'undefined' && global.__agMenuLangMode) || '${defaultMode}') === 'zh-tw' ? '檢查更新' : '检查更新'),
                message: ((typeof global !== 'undefined' && global.__agMenuLangMode) || '${defaultMode}') === 'en' ? 'No updates available' : (((typeof global !== 'undefined' && global.__agMenuLangMode) || '${defaultMode}') === 'zh-tw' ? '目前沒有可用的更新' : '暂无可用更新'),
                buttons: [((typeof global !== 'undefined' && global.__agMenuLangMode) || '${defaultMode}') === 'en' ? 'OK' : (((typeof global !== 'undefined' && global.__agMenuLangMode) || '${defaultMode}') === 'zh-tw' ? '好' : '确定')],`;
            let out = cleaned.replace(targetOptions, replacementOptions);
            const targetMenuState = `        if (item) {
            item.label = step;
            item.enabled = exports.updateActions[step] !== undefined;
        }`;
            const replacementMenuState = `        if (item) {
            /* --- UPDATER TRANSLATION START --- */
            item._origRawLabel = step;
            item._origCleanLabel = step;
            item.enabled = exports.updateActions[step] !== undefined;
            const __mode = (typeof global !== 'undefined' && global.__agMenuLangMode) || '${defaultMode}';
            const __stepMapSc = {
                'Check for Updates': '检查更新',
                'Checking for Updates...': '正在检查更新...',
                'Downloading Update...': '正在下载更新...',
                'Restart to Update': '重启以完成更新'
            };
            const __stepMapTw = {
                'Check for Updates': '檢查更新',
                'Checking for Updates...': '正在檢查更新...',
                'Downloading Update...': '正在下載更新...',
                'Restart to Update': '重新啟動以更新'
            };
            item.label = __mode === 'en' ? step : ((__mode === 'zh-tw' ? __stepMapTw[step] : __stepMapSc[step]) || step);
            /* --- UPDATER TRANSLATION END --- */
        }`;
            out = out.replace(targetMenuState, replacementMenuState);
            const targetActions = `[MenuUpdateStep.RestartToUpdate]: () => quitAndInstall(),`;
            const replacementActions = `[MenuUpdateStep.RestartToUpdate]: () => quitAndInstall(),
    /* --- UPDATER TRANSLATION START --- */
    '检查更新': () => checkForUpdates(true),
    '檢查更新': () => checkForUpdates(true),
    '重启以完成更新': () => quitAndInstall(),
    '重新啟動以更新': () => quitAndInstall(),
    /* --- UPDATER TRANSLATION END --- */`;
            out = out.replace(targetActions, replacementActions);
            console.log(`[修改] 更新弹窗汉化注入成功！`);
            return out;
        },
        "dist/main.js": (mainContent) => {
            let cleaned = mainContent.replace(/\/\* --- MAC ENV & KEYCHAIN SETUP START --- \*\/[\s\S]*?\/\* --- MAC ENV & KEYCHAIN SETUP END --- \*\/\s*__applyMacProxyAndEnv\(process\.env,\s*electron_1\.app\);\s*/g, '');
            const targetMain = 'const electron_1 = require("electron");';
            if (cleaned.includes(targetMain)) {
                cleaned = cleaned.replace(targetMain, () => `${targetMain}\n${getMacEnvSetupCode()}\n__applyMacProxyAndEnv(process.env, electron_1.app);`);
                console.log(`[修改] 已向 main.js 注入 macOS 代理透传与免钥匙串授权配置！`);
            }
            return cleaned;
        },
        "dist/languageServer.js": (lsContent) => {
            let cleaned = lsContent.replace(/\/\* --- MAC ENV & KEYCHAIN SETUP START --- \*\/[\s\S]*?\/\* --- MAC ENV & KEYCHAIN SETUP END --- \*\/\s*__applyMacProxyAndEnv\(env,\s*null\);\s*/g, '');
            const targetLs = 'const env = { ...process.env, ...loginShellEnv };';
            if (cleaned.includes(targetLs)) {
                cleaned = cleaned.replace(targetLs, () => `${targetLs}\n${getMacEnvSetupCode()}\n__applyMacProxyAndEnv(env, null);`);
                console.log(`[修改] 已向 languageServer.js 注入 macOS 系统代理自动识别！`);
            }
            return cleaned;
        }
    };
}

function install20(resourcesDir) {
    const asarPath = path.join(resourcesDir, "app.asar");
    const bakPath = path.join(resourcesDir, "app.asar.bak");

    if (!fs.existsSync(asarPath)) {
        console.error(`[错误] 未在资源目录中找到 app.asar: ${resourcesDir}`);
        return false;
    }

    const asarPatcher = require(path.join(__dirname, 'scripts', 'asar_patcher.js'));

    // 1. 极速签名探测 (<2ms) 与官方更新检测（确保每次官方升级都自动刷新 .bak）
    const isAlreadyLocalized = asarPatcher.isAsarLocalizedFast(asarPath, {
        signatureStart: SIGNATURE_START,
        signatureEnd: SIGNATURE_END
    });

    if (!isAlreadyLocalized) {
        console.log(`[备份] 检测到全新官方英文版本，正在同步创建/更新官方备份包: ${bakPath} ...`);
        try {
            fs.copyFileSync(asarPath, bakPath);
            console.log(`[备份] 备份成功！`);
        } catch (e) {
            console.error(`[错误] 创建备份失败: ${e.message}`);
            if (process.platform === 'darwin' && e.code === 'EPERM') {
                console.error(`[提示] macOS 写入受限，请使用管理员权限运行脚本。`);
            }
            return false;
        }
    } else if (!fs.existsSync(bakPath)) {
        console.log(`[备份] 正在创建官方原始包备份: app.asar.bak ...`);
        try {
            fs.copyFileSync(asarPath, bakPath);
            console.log(`[备份] 备份成功！`);
        } catch (e) {
            console.error(`[错误] 创建备份失败: ${e.message}`);
            return false;
        }
    }

    const cleanSourceAsar = (fs.existsSync(bakPath) && !asarPatcher.isAsarLocalizedFast(bakPath, {
        signatureStart: SIGNATURE_START,
        signatureEnd: SIGNATURE_END
    })) ? bakPath : asarPath;

    const mutators = buildDesktop20Mutators();

    // 2. 优先使用纯 Node 零依赖内存级 ASAR 外科手术补丁 (<120ms，无需 npx 或外网)
    try {
        console.log(`[极速补丁] 正在执行内存级 ASAR 外科手术注入...`);
        const patchRes = asarPatcher.patchAsarSurgical(asarPath, mutators, {
            sourceAsarPath: cleanSourceAsar
        });
        if (!patchRes.modifiedFiles.includes("dist/preload.js")) {
            // 若源包原本已含完全一致代码，验证 preload.js 是否存在
            asarPatcher.readFileFromAsar(asarPath, "dist/preload.js");
        }
        console.log(`[极速补丁] ASAR 外科手术注入完成，耗时 ${patchRes.elapsedMs}ms！`);
        cleanElectronCache();
        resignAppOnMac(resourcesDir);
        console.log(`[√] Antigravity 2.0 汉化部署完成！`);
        return true;
    } catch (surgicalErr) {
        console.warn(`[警告] 原生极速 ASAR 注入回退至全量解包模式: ${surgicalErr.message}`);
    }

    // 3. 兜底：优先使用内置零依赖离线 ASAR 解包重打包，失败时再回退 npx
    const tempDir = path.join(os.tmpdir(), `_ag_temp_asar_${process.pid}`);
    if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
    }

    let extractedOffline = false;
    try {
        console.log(`[解包] 正在使用内置离线引擎提取 app.asar...`);
        asarPatcher.extractAsarToDir(cleanSourceAsar, tempDir);
        extractedOffline = fs.existsSync(path.join(tempDir, "dist", "preload.js"));
    } catch (offlineExtErr) {
        console.warn(`[警告] 内置离线提取失败，尝试 npx 兜底: ${offlineExtErr.message}`);
    }

    if (!extractedOffline) {
        console.log(`[解包] 正在使用 npx 提取 app.asar...`);
        const extractRes = runCommandSync(`npx -y @electron/asar extract "${cleanSourceAsar}" "${tempDir}"`);
        if (!extractRes.success || !fs.existsSync(tempDir)) {
            console.error(`[错误] 解包失败，可能是由于系统未安装 Node.js/npm 或者网络限制。`);
            console.error(`详情: ${extractRes.stderr}\n${extractRes.stdout}`);
            return false;
        }
    }

    const preloadPath = path.join(tempDir, "dist", "preload.js");
    if (!fs.existsSync(preloadPath)) {
        console.error(`[错误] 解压后未能在指定路径找到 preload.js: ${preloadPath}`);
        fs.rmSync(tempDir, { recursive: true, force: true });
        return false;
    }

    for (const [relFile, fn] of Object.entries(mutators)) {
        const fullPath = path.join(tempDir, ...relFile.split('/'));
        if (fs.existsSync(fullPath)) {
            const raw = fs.readFileSync(fullPath, 'utf-8');
            const next = fn(raw);
            if (typeof next === 'string') {
                fs.writeFileSync(fullPath, next, 'utf-8');
            }
        }
    }

    console.log(`[打包] 正在将修改后的内容打包回 app.asar...`);
    const tempAsarPath = path.join(os.tmpdir(), `_ag_new_app_${process.pid}.asar`);
    if (fs.existsSync(tempAsarPath)) {
        try { fs.unlinkSync(tempAsarPath); } catch (e) {}
    }

    let packedOffline = false;
    try {
        asarPatcher.packDirToAsar(tempDir, tempAsarPath);
        packedOffline = fs.existsSync(tempAsarPath);
    } catch (offlinePackErr) {
        console.warn(`[警告] 内置离线打包失败，尝试 npx 兜底: ${offlinePackErr.message}`);
    }

    if (!packedOffline) {
        const packRes = runCommandSync(`npx -y @electron/asar pack "${tempDir}" "${tempAsarPath}"`);
        if (!packRes.success || !fs.existsSync(tempAsarPath)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
            console.error(`[错误] 打包失败。`);
            console.error(`详情: ${packRes.stderr}\n${packRes.stdout}`);
            return false;
        }
    }
    fs.rmSync(tempDir, { recursive: true, force: true });

    try {
        fs.copyFileSync(tempAsarPath, asarPath);
        fs.unlinkSync(tempAsarPath);
    } catch (e) {
        try {
            fs.renameSync(tempAsarPath, asarPath);
        } catch (renameErr) {
            console.error(`[错误] 替换 app.asar 失败: ${renameErr.message}`);
            return false;
        }
    }

    cleanElectronCache();
    resignAppOnMac(resourcesDir);
    console.log(`[√] Antigravity 2.0 汉化部署完成！`);
    return true;
}

function restore20(resourcesDir) {
    const asarPath = path.join(resourcesDir, "app.asar");
    const bakPath = path.join(resourcesDir, "app.asar.bak");
    const asarPatcher = require(path.join(__dirname, 'scripts', 'asar_patcher.js'));

    if (fs.existsSync(asarPath) && !asarPatcher.isAsarLocalizedFast(asarPath, {
        signatureStart: SIGNATURE_START,
        signatureEnd: SIGNATURE_END
    })) {
        if (fs.existsSync(bakPath)) {
            try { fs.unlinkSync(bakPath); } catch (e) {}
        }
        console.log("[√] 当前 app.asar 已是官方原版，无需覆盖还原。");
        return true;
    }

    if (!fs.existsSync(bakPath)) {
        console.log("[!] 未找到备份文件 app.asar.bak，可能尚未安装过汉化或备份被删除。");
        return false;
    }

    console.log("[还原] 正在用官方备份文件恢复...");
    try {
        fs.copyFileSync(bakPath, asarPath);
        fs.unlinkSync(bakPath);
    } catch (e) {
        console.error(`[错误] 恢复备份失败: ${e.message}`);
        if (process.platform === 'darwin' && e.code === 'EPERM') {
            console.error(`[提示] macOS 写入受限，请使用管理员权限运行脚本。`);
        }
        return false;
    }
    resignAppOnMac(resourcesDir);
    console.log("[√] 官方 app.asar 已成功恢复！");
    return true;
}

// ==========================================
// Antigravity IDE / 1.0 汉化引擎 (HTML 注入模式)
// ==========================================
function getAppDir(installDir) {
    if (fs.existsSync(path.join(installDir, "Contents", "Resources", "app"))) {
        return path.join(installDir, "Contents", "Resources", "app");
    }
    if (fs.existsSync(path.join(installDir, "resources", "app"))) {
        return path.join(installDir, "resources", "app");
    }
    if (fs.existsSync(path.join(installDir, "app"))) {
        return path.join(installDir, "app");
    }
    return path.join(installDir, "resources", "app");
}

function getOldTargetFiles(appDir) {
    return [
        path.join(appDir, "out", "vs", "code", "electron-browser", "workbench", "workbench-jetski-agent.html"),
        path.join(appDir, "out", "vs", "code", "electron-browser", "workbench", "workbench.html"),
        path.join(appDir, "out", "vs", "code", "electron-sandbox", "workbench", "workbench-jetski-agent.html"),
        path.join(appDir, "out", "vs", "code", "electron-sandbox", "workbench", "workbench.html")
    ];
}

function backupFiles10(appDir) {
    const targetFiles = getOldTargetFiles(appDir);
    for (const absPath of targetFiles) {
        if (!fs.existsSync(absPath)) continue;
        const bakPath = absPath + ".bak";
        let isLocalized = false;
        try {
            isLocalized = fs.readFileSync(absPath, 'utf-8').includes('ag_agent_hanhua.js');
        } catch (e) {}
        if (!isLocalized || !fs.existsSync(bakPath)) {
            try {
                fs.copyFileSync(absPath, bakPath);
                console.log(`[备份] 已创建旧版/IDE HTML 备份: ${path.basename(absPath)}.bak`);
            } catch (e) {
                console.error(`[错误] 创建备份失败: ${e.message}`);
                if (process.platform === 'darwin' && e.code === 'EPERM') {
                    console.error(`[提示] macOS 写入受限，请使用管理员权限运行脚本，或在“系统设置 -> 隐私与安全性 -> App 管理”中允许终端修改 App。`);
                }
                return false;
            }
        }
    }

    const mainJsPath = path.join(appDir, "out", "main.js");
    if (fs.existsSync(mainJsPath)) {
        const mainBakPath = mainJsPath + ".bak";
        let isMainLocalized = false;
        try {
            isMainLocalized = fs.readFileSync(mainJsPath, 'utf-8').includes('/* --- MAC ENV & KEYCHAIN SETUP START --- */');
        } catch (e) {}
        if (!isMainLocalized || !fs.existsSync(mainBakPath)) {
            try {
                fs.copyFileSync(mainJsPath, mainBakPath);
                console.log(`[备份] 已创建 out/main.js 备份: main.js.bak`);
            } catch (e) {
                console.error(`[错误] 创建 out/main.js 备份失败: ${e.message}`);
                if (process.platform === 'darwin' && e.code === 'EPERM') {
                    console.error(`[提示] macOS 写入受限，请使用管理员权限运行脚本，或在“系统设置 -> 隐私与安全性 -> App 管理”中允许终端修改 App。`);
                }
                return false;
            }
        }
    }

    const extJsPath = path.join(appDir, "extensions", "agy", "vscode", "extension.js");
    if (fs.existsSync(extJsPath)) {
        const extBakPath = extJsPath + ".bak";
        let isExtLocalized = false;
        try {
            isExtLocalized = fs.readFileSync(extJsPath, 'utf-8').includes(EXT_HOOK_START);
        } catch (e) {}
        if (!isExtLocalized || !fs.existsSync(extBakPath)) {
            try {
                fs.copyFileSync(extJsPath, extBakPath);
                console.log(`[备份] 已创建 extension.js 备份: extension.js.bak`);
            } catch (e) {
                console.error(`[错误] 创建 extension.js 备份失败: ${e.message}`);
                if (process.platform === 'darwin' && e.code === 'EPERM') {
                    console.error(`[提示] macOS 写入受限，请使用管理员权限运行脚本，或在“系统设置 -> 隐私与安全性 -> App 管理”中允许终端修改 App。`);
                }
                return false;
            }
        }
    }
    return true;
}

function injectMainJs10(appDir) {
    const mainJsPath = path.join(appDir, "out", "main.js");
    if (!fs.existsSync(mainJsPath)) return true;

    try {
        if (fs.existsSync(mainJsPath + ".bak")) {
            fs.copyFileSync(mainJsPath + ".bak", mainJsPath);
        }
        let content = fs.readFileSync(mainJsPath, 'utf-8');
        const switchRegex = /([A-Za-z0-9_$]+)\.commandLine\.appendSwitch\("xdg-portal-required-version","4"\)/;
        if (switchRegex.test(content)) {
            content = content.replace(switchRegex, (full, appId) => {
                return `${getMacEnvSetupCode()}\n__applyMacProxyAndEnv(process.env, ${appId});\n${appId}.commandLine.appendSwitch("xdg-portal-required-version","4")`;
            });
            fs.writeFileSync(mainJsPath, content, 'utf-8');
            console.log(`[修改] 已向 IDE out/main.js 注入 macOS 代理透传与免钥匙串授权配置！`);
        }
        return true;
    } catch (e) {
        console.warn(`[警告] 注入 out/main.js 失败: ${e.message}`);
        return false;
    }
}

const EXT_HOOK_START = '/* --- ANTIGRAVITY HANHUA PROXY START --- */';
const EXT_HOOK_END = '/* --- ANTIGRAVITY HANHUA PROXY END --- */';

function loadExtNlsMaps() {
    const scMap = loadDictionary('dicts');
    const twMap = loadDictionary('dicts_tw');
    const scExtPath = path.join(__dirname, 'dicts', 'ext_vscode_nls.json');
    const twExtPath = path.join(__dirname, 'dicts_tw', 'ext_vscode_nls.json');
    if (fs.existsSync(scExtPath)) {
        try {
            const d = JSON.parse(fs.readFileSync(scExtPath, 'utf-8'));
            for (const [k, v] of Object.entries(d)) {
                scMap[normalizeText(k)] = v;
            }
        } catch (e) {}
    }
    if (fs.existsSync(twExtPath)) {
        try {
            const d = JSON.parse(fs.readFileSync(twExtPath, 'utf-8'));
            for (const [k, v] of Object.entries(d)) {
                twMap[normalizeText(k)] = v;
            }
        } catch (e) {}
    }
    return { scMap, twMap };
}

function patchExtensionPackageNls(extDir) {
    const pkgPath = path.join(extDir, 'package.json');
    if (!fs.existsSync(pkgPath)) return true;

    const pkgBakPath = pkgPath + '.bak';
    const curRaw = fs.readFileSync(pkgPath, 'utf-8');
    const isAlreadyPatched = curRaw.includes('%ag.nls.');

    if (!isAlreadyPatched || !fs.existsSync(pkgBakPath)) {
        fs.copyFileSync(pkgPath, pkgBakPath);
    }

    const baseRaw = (!fs.readFileSync(pkgBakPath, 'utf-8').includes('%ag.nls.'))
        ? fs.readFileSync(pkgBakPath, 'utf-8')
        : curRaw;

    const pkg = JSON.parse(baseRaw);
    const { scMap, twMap } = loadExtNlsMaps();
    const nlsSc = { "__ag_hanhua_generated": "1" };
    const nlsTw = { "__ag_hanhua_generated": "1" };

    const registerNlsKey = (nlsKey, rawEnText) => {
        if (!rawEnText || typeof rawEnText !== 'string' || /^%.*%$/.test(rawEnText)) return rawEnText;
        const normEn = normalizeText(rawEnText);
        const scVal = scMap[normEn];
        const twVal = twMap[normEn];
        if (!scVal && !twVal) return rawEnText;
        nlsSc[nlsKey] = scVal || rawEnText;
        nlsTw[nlsKey] = twVal || scVal || rawEnText;
        return `%${nlsKey}%`;
    };

    const contributes = pkg.contributes || {};
    if (Array.isArray(contributes.customEditors)) {
        contributes.customEditors.forEach((ed, idx) => {
            if (ed && typeof ed.displayName === 'string') {
                const safeType = String(ed.viewType || idx).replace(/[^a-zA-Z0-9_.-]/g, '_');
                ed.displayName = registerNlsKey(`ag.nls.editor.${safeType}`, ed.displayName);
            }
        });
    }

    if (Array.isArray(contributes.commands)) {
        contributes.commands.forEach((cmdObj, idx) => {
            if (cmdObj && typeof cmdObj.title === 'string') {
                const safeCmd = String(cmdObj.command || idx).replace(/[^a-zA-Z0-9_.-]/g, '_');
                cmdObj.title = registerNlsKey(`ag.nls.cmd.${safeCmd}`, cmdObj.title);
            }
        });
    }

    if (Array.isArray(contributes.submenus)) {
        contributes.submenus.forEach((sub, idx) => {
            if (sub && typeof sub.label === 'string') {
                const safeId = String(sub.id || idx).replace(/[^a-zA-Z0-9_.-]/g, '_');
                sub.label = registerNlsKey(`ag.nls.submenu.${safeId}`, sub.label);
            }
        });
    }

    if (contributes.views && typeof contributes.views === 'object') {
        for (const [containerId, viewList] of Object.entries(contributes.views)) {
            if (!Array.isArray(viewList)) continue;
            const safeContainer = String(containerId).replace(/[^a-zA-Z0-9_.-]/g, '_');
            viewList.forEach((viewObj, idx) => {
                if (!viewObj || typeof viewObj.name !== 'string') return;
                if (normalizeText(viewObj.name) === 'Antigravity' && BRAND_TITLE_MODE !== 'translated') return;
                const safeView = String(viewObj.id || idx).replace(/[^a-zA-Z0-9_.-]/g, '_');
                viewObj.name = registerNlsKey(`ag.nls.view.${safeContainer}.${safeView}`, viewObj.name);
            });
        }
    }

    if (contributes.viewsContainers && typeof contributes.viewsContainers === 'object') {
        for (const [locKey, containerList] of Object.entries(contributes.viewsContainers)) {
            if (!Array.isArray(containerList)) continue;
            const safeLoc = String(locKey).replace(/[^a-zA-Z0-9_.-]/g, '_');
            containerList.forEach((cObj, idx) => {
                if (!cObj || typeof cObj.title !== 'string') return;
                if (normalizeText(cObj.title) === 'Antigravity' && BRAND_TITLE_MODE !== 'translated') return;
                const safeCid = String(cObj.id || idx).replace(/[^a-zA-Z0-9_.-]/g, '_');
                cObj.title = registerNlsKey(`ag.nls.viewContainer.${safeLoc}.${safeCid}`, cObj.title);
            });
        }
    }

    if (Array.isArray(contributes.viewsWelcome)) {
        contributes.viewsWelcome.forEach((wObj, idx) => {
            if (wObj && typeof wObj.contents === 'string') {
                const safeView = String(wObj.view || idx).replace(/[^a-zA-Z0-9_.-]/g, '_');
                wObj.contents = registerNlsKey(`ag.nls.viewsWelcome.${safeView}.${idx}`, wObj.contents);
            }
        });
    }

    if (Array.isArray(contributes.walkthroughs)) {
        contributes.walkthroughs.forEach((wt, idx) => {
            if (!wt || typeof wt !== 'object') return;
            const safeWt = String(wt.id || idx).replace(/[^a-zA-Z0-9_.-]/g, '_');
            if (typeof wt.title === 'string') {
                wt.title = registerNlsKey(`ag.nls.walkthrough.${safeWt}.title`, wt.title);
            }
            if (typeof wt.description === 'string') {
                wt.description = registerNlsKey(`ag.nls.walkthrough.${safeWt}.description`, wt.description);
            }
            if (Array.isArray(wt.steps)) {
                wt.steps.forEach((step, sIdx) => {
                    if (!step || typeof step !== 'object') return;
                    const safeStep = String(step.id || sIdx).replace(/[^a-zA-Z0-9_.-]/g, '_');
                    if (typeof step.title === 'string') {
                        step.title = registerNlsKey(`ag.nls.walkthrough.${safeWt}.step.${safeStep}.title`, step.title);
                    }
                    if (typeof step.description === 'string') {
                        step.description = registerNlsKey(`ag.nls.walkthrough.${safeWt}.step.${safeStep}.description`, step.description);
                    }
                });
            }
        });
    }

    const patchConfigBlock = (cfgBlock, blockIdx) => {
        if (!cfgBlock || typeof cfgBlock !== 'object') return;
        if (typeof cfgBlock.title === 'string' && BRAND_TITLE_MODE === 'translated') {
            cfgBlock.title = registerNlsKey(`ag.nls.cfgTitle.${blockIdx}`, cfgBlock.title);
        }
        const props = cfgBlock.properties;
        if (props && typeof props === 'object') {
            for (const [propName, schema] of Object.entries(props)) {
                if (!schema || typeof schema !== 'object') continue;
                const safeProp = propName.replace(/[^a-zA-Z0-9_.-]/g, '_');
                for (const field of ['description', 'markdownDescription', 'deprecationMessage', 'markdownDeprecationMessage']) {
                    if (typeof schema[field] === 'string') {
                        schema[field] = registerNlsKey(`ag.nls.cfg.${safeProp}.${field}`, schema[field]);
                    }
                }
            }
        }
    };

    if (Array.isArray(contributes.configuration)) {
        contributes.configuration.forEach((b, i) => patchConfigBlock(b, i));
    } else if (contributes.configuration) {
        patchConfigBlock(contributes.configuration, 0);
    }

    const defaultNls = USE_TW ? nlsTw : nlsSc;
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf-8');
    fs.writeFileSync(path.join(extDir, 'package.nls.json'), JSON.stringify(defaultNls, null, 2) + '\n', 'utf-8');
    fs.writeFileSync(path.join(extDir, 'package.nls.zh-cn.json'), JSON.stringify(nlsSc, null, 2) + '\n', 'utf-8');
    fs.writeFileSync(path.join(extDir, 'package.nls.zh-tw.json'), JSON.stringify(nlsTw, null, 2) + '\n', 'utf-8');
    return true;
}

function restoreExtensionPackageNls(extDir) {
    let changed = false;
    const pkgPath = path.join(extDir, 'package.json');
    const pkgBakPath = pkgPath + '.bak';
    if (fs.existsSync(pkgBakPath)) {
        fs.copyFileSync(pkgBakPath, pkgPath);
        fs.unlinkSync(pkgBakPath);
        changed = true;
    }
    for (const nlsName of ['package.nls.json', 'package.nls.zh-cn.json', 'package.nls.zh-tw.json']) {
        const p = path.join(extDir, nlsName);
        if (fs.existsSync(p)) {
            try {
                const txt = fs.readFileSync(p, 'utf-8');
                if (txt.includes('"__ag_hanhua_generated"')) {
                    fs.unlinkSync(p);
                    changed = true;
                }
            } catch (e) {}
        }
    }
    return changed;
}

function buildExtensionProxyFooter() {
    const defaultLang = USE_TW ? 'zh-tw' : 'zh-cn';
    return `
${EXT_HOOK_START}
${getMacEnvSetupCode()}
__applyMacProxyAndEnv(process.env, null);
let __hanhuaProxyMap = new Map();
let __hanhuaProxyPorts = new Set();
let __hanhuaSseClients = new Set();
let __hanhuaCodeLensProviders = new Set();
let __hanhuaWebviews = new Set();
let __hanhuaSettingsPanels = new Map();
let __hanhuaSettingsBarItem = null;
let __hanhuaToggleBarItem = null;

function __getHanhuaUiStatePath() {
    const fs = require('fs');
    const path = require('path');
    const os = require('os');
    const stateDir = process.env.AG_STATE_DIR_OVERRIDE
        ? path.resolve(process.env.AG_STATE_DIR_OVERRIDE)
        : path.join(os.homedir(), '.antigravity-hanhua');
    try { fs.mkdirSync(stateDir, { recursive: true }); } catch (e) {}
    return path.join(stateDir, 'ui_state.json');
}

let __hanhuaLangState = {
    langMode: '${defaultLang}',
    lastZhLang: '${defaultLang}',
    keepOptionNamesEn: ${KEEP_OPTION_NAMES_EN ? 'true' : 'false'},
    hideFloatBtn: ${HIDE_FLOAT_BTN ? 'true' : 'false'}
};

(function __loadInitialHanhuaState() {
    try {
        const fs = require('fs');
        const p = __getHanhuaUiStatePath();
        if (fs.existsSync(p)) {
            const d = JSON.parse(fs.readFileSync(p, 'utf8'));
            if (d && typeof d === 'object') {
                if (d.lastZhLang === 'zh-cn' || d.lastZhLang === 'zh-tw') __hanhuaLangState.lastZhLang = d.lastZhLang;
                if (d.langMode === 'en' || d.langMode === 'zh-cn' || d.langMode === 'zh-tw') __hanhuaLangState.langMode = d.langMode;
                if (typeof d.keepOptionNamesEn === 'boolean') __hanhuaLangState.keepOptionNamesEn = d.keepOptionNamesEn;
                if (typeof d.hideFloatBtn === 'boolean') __hanhuaLangState.hideFloatBtn = d.hideFloatBtn;
            }
        }
    } catch (e) {}
})();

function __saveAndBroadcastHanhuaState(patch) {
    if (patch && typeof patch === 'object') {
        if (patch.langMode === 'en' || patch.langMode === 'zh-cn' || patch.langMode === 'zh-tw') {
            __hanhuaLangState.langMode = patch.langMode;
            if (patch.langMode !== 'en') __hanhuaLangState.lastZhLang = patch.langMode;
        }
        if (patch.lastZhLang === 'zh-cn' || patch.lastZhLang === 'zh-tw') {
            __hanhuaLangState.lastZhLang = patch.lastZhLang;
        }
        if (typeof patch.keepOptionNamesEn === 'boolean') {
            __hanhuaLangState.keepOptionNamesEn = patch.keepOptionNamesEn;
        }
        if (typeof patch.hideFloatBtn === 'boolean') {
            __hanhuaLangState.hideFloatBtn = patch.hideFloatBtn;
        }
    }
    try {
        const fs = require('fs');
        fs.writeFileSync(__getHanhuaUiStatePath(), JSON.stringify(__hanhuaLangState, null, 2), 'utf8');
    } catch (e) {}

    __refreshHanhuaExtensionUi();
    const msg = 'data: ' + JSON.stringify(__hanhuaLangState) + '\\n\\n';
    for (const res of Array.from(__hanhuaSseClients)) {
        try {
            res.write(msg);
        } catch (e) {
            __hanhuaSseClients.delete(res);
        }
    }
    for (const wv of Array.from(__hanhuaWebviews)) {
        try {
            if (wv && typeof wv.postMessage === 'function') {
                wv.postMessage({ __agHanhuaSync: 1, state: __hanhuaLangState });
            } else {
                __hanhuaWebviews.delete(wv);
            }
        } catch (e) {
            __hanhuaWebviews.delete(wv);
        }
    }
}

function __agGetEncodedStateAttr() {
    try {
        return encodeURIComponent(JSON.stringify(__hanhuaLangState));
    } catch (e) {
        return '';
    }
}

function __agTrackWebview(webview) {
    if (webview && typeof webview.postMessage === 'function') {
        __hanhuaWebviews.add(webview);
    }
    return webview;
}

function __agTrackSettingsPanel(panel, brand) {
    if (panel && typeof panel === 'object') {
        __hanhuaSettingsPanels.set(panel, brand || 'Antigravity');
        try {
            if (typeof panel.onDidDispose === 'function') {
                panel.onDidDispose(() => {
                    __hanhuaSettingsPanels.delete(panel);
                });
            }
        } catch (e) {}
    }
    return panel;
}

function __agFormatSettingsTitle(brand) {
    const b = brand || 'Antigravity';
    if (__hanhuaLangState.langMode === 'en') return b + ' Settings';
    if (__hanhuaLangState.langMode === 'zh-tw') return b + ' 設定';
    return b + ' 设置';
}

function __agCodeLensText(kind) {
    const mode = __hanhuaLangState.langMode;
    if (mode === 'en') {
        if (kind === 'acceptTitle') return '$(check) Accept';
        if (kind === 'acceptTooltip') return 'Accept this suggestion block';
        if (kind === 'rejectTitle') return '$(chrome-close) Reject';
        if (kind === 'rejectTooltip') return 'Reject this suggestion block';
        if (kind === 'tabToJump') return 'Tab to Jump';
    } else if (mode === 'zh-tw') {
        if (kind === 'acceptTitle') return '$(check) 接受';
        if (kind === 'acceptTooltip') return '接受此建議程式碼區塊';
        if (kind === 'rejectTitle') return '$(chrome-close) 拒絕';
        if (kind === 'rejectTooltip') return '拒絕此建議程式碼區塊';
        if (kind === 'tabToJump') return '按 Tab 跳轉';
    } else {
        if (kind === 'acceptTitle') return '$(check) 接受';
        if (kind === 'acceptTooltip') return '接受此建议代码块';
        if (kind === 'rejectTitle') return '$(chrome-close) 拒绝';
        if (kind === 'rejectTooltip') return '拒绝此建议代码块';
        if (kind === 'tabToJump') return '按 Tab 跳转';
    }
    return '';
}
try { globalThis.__agCodeLensText = __agCodeLensText; } catch (e) {}

function __agTrackCodeLensProvider(provider) {
    if (provider) __hanhuaCodeLensProviders.add(provider);
    return provider;
}

function __refreshHanhuaExtensionUi() {
    try {
        const mode = __hanhuaLangState.langMode;
        if (__hanhuaSettingsBarItem) {
            if (mode === 'en') {
                __hanhuaSettingsBarItem.text = 'Antigravity - Settings';
                __hanhuaSettingsBarItem.tooltip = 'Open Antigravity Settings';
            } else if (mode === 'zh-tw') {
                __hanhuaSettingsBarItem.text = 'Antigravity - 設定';
                __hanhuaSettingsBarItem.tooltip = '開啟 Antigravity 設定';
            } else {
                __hanhuaSettingsBarItem.text = 'Antigravity - 设置';
                __hanhuaSettingsBarItem.tooltip = '打开 Antigravity 设置';
            }
        }
        if (__hanhuaToggleBarItem) {
            if (mode === 'en') {
                __hanhuaToggleBarItem.text = '$(globe) AG: EN';
                __hanhuaToggleBarItem.tooltip = '点击切换 Antigravity 为中文界面 (免重启实时生效)';
            } else if (mode === 'zh-tw') {
                __hanhuaToggleBarItem.text = '$(globe) AG: 繁中';
                __hanhuaToggleBarItem.tooltip = '點擊切換 Antigravity 為英文介面 (免重啟即時生效)';
            } else {
                __hanhuaToggleBarItem.text = '$(globe) AG: 中文';
                __hanhuaToggleBarItem.tooltip = '点击切换 Antigravity 为英文界面 (免重启实时生效)';
            }
        }
        for (const [panel, brand] of Array.from(__hanhuaSettingsPanels.entries())) {
            try {
                if (panel) panel.title = __agFormatSettingsTitle(brand);
            } catch (e) {
                __hanhuaSettingsPanels.delete(panel);
            }
        }
        for (const p of __hanhuaCodeLensProviders) {
            try {
                if (p && typeof p.refresh === 'function') p.refresh();
                else if (p && p._onDidChangeCodeLenses && typeof p._onDidChangeCodeLenses.fire === 'function') p._onDidChangeCodeLenses.fire();
            } catch (e) {}
        }
    } catch (e) {}
}

function __agRegisterStatusBarAndCommands(vscodeApi, extContext, settingsBarItem) {
    __hanhuaSettingsBarItem = settingsBarItem;
    try {
        const toggleCmd = 'antigravity.hanhua.toggleLanguage';
        const menuCmd = 'antigravity.hanhua.languageMenu';
        const bar = vscodeApi.window.createStatusBarItem('ag.hanhua.lang', vscodeApi.StatusBarAlignment.Right, 99);
        bar.name = 'Antigravity Language Toggle';
        bar.command = toggleCmd;
        __hanhuaToggleBarItem = bar;
        __refreshHanhuaExtensionUi();
        bar.show();
        if (extContext && Array.isArray(extContext.subscriptions)) {
            extContext.subscriptions.push(bar);
            extContext.subscriptions.push(vscodeApi.commands.registerCommand(toggleCmd, () => {
                const nextMode = __hanhuaLangState.langMode === 'en'
                    ? (__hanhuaLangState.lastZhLang || '${defaultLang}')
                    : 'en';
                __saveAndBroadcastHanhuaState({ langMode: nextMode });
            }));
            extContext.subscriptions.push(vscodeApi.commands.registerCommand(menuCmd, async () => {
                const picked = await vscodeApi.window.showQuickPick([
                    { label: '简体中文', mode: 'zh-cn' },
                    { label: '繁體中文', mode: 'zh-tw' },
                    { label: 'English (原文)', mode: 'en' },
                    {
                        label: (__hanhuaLangState.keepOptionNamesEn ? '✓ ' : '') + '设置项名称保留英文 (仅翻译说明)',
                        toggleOpt: true
                    }
                ], { placeHolder: '选择 Antigravity 界面语言 (免重启实时生效)' });
                if (!picked) return;
                if (picked.toggleOpt) {
                    __saveAndBroadcastHanhuaState({ keepOptionNamesEn: !__hanhuaLangState.keepOptionNamesEn });
                } else if (picked.mode) {
                    __saveAndBroadcastHanhuaState({ langMode: picked.mode });
                }
            }));
        }
    } catch (e) {}
}

async function __getHanhuaProxyUrl(targetUrl) {
    try {
        if (!targetUrl || typeof targetUrl !== 'string') return targetUrl;
        const u = new URL(targetUrl);
        const targetPort = parseInt(u.port, 10);
        if (!targetPort || (u.hostname !== '127.0.0.1' && u.hostname !== 'localhost')) {
            return targetUrl;
        }
        const rewriteWithPort = (proxyBase) => {
            const pu = new URL(proxyBase);
            u.protocol = pu.protocol;
            u.hostname = pu.hostname;
            u.port = pu.port;
            return u.toString();
        };
        if (__hanhuaProxyPorts.has(targetPort)) {
            return targetUrl;
        }
        if (__hanhuaProxyMap.has(targetPort)) {
            return rewriteWithPort(__hanhuaProxyMap.get(targetPort));
        }
        const http = require('http');
        const net = require('net');
        const fs = require('fs');
        const path = require('path');

        const possiblePaths = [
            path.join(__dirname, 'ag_agent_hanhua.js'),
            path.join(__dirname, '..', '..', '..', 'out', 'ag_agent_hanhua.js'),
            path.join(__dirname, '..', 'out', 'ag_agent_hanhua.js')
        ];
        const dictScPath = path.join(__dirname, 'ag_dict_sc.json');
        const dictTwPath = path.join(__dirname, 'ag_dict_tw.json');

        const corsHeaders = {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
            'Cache-Control': 'no-store'
        };

        const proxyServer = http.createServer((req, res) => {
            const reqPath = (req.url || '').split('?')[0];

            if (req.method === 'OPTIONS' && reqPath.startsWith('/__ag_hanhua_')) {
                res.writeHead(204, corsHeaders);
                res.end();
                return;
            }

            if (reqPath === '/ag_agent_hanhua.js') {
                const hanhuaPath = possiblePaths.find(p => fs.existsSync(p)) || possiblePaths[0];
                if (fs.existsSync(hanhuaPath)) {
                    res.writeHead(200, {
                        ...corsHeaders,
                        'Content-Type': 'application/javascript; charset=utf-8'
                    });
                    fs.createReadStream(hanhuaPath).pipe(res);
                    return;
                }
                res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/javascript; charset=utf-8' });
                res.end('');
                return;
            }

            if (reqPath === '/ag_dict_sc.json' || reqPath === '/ag_dict_tw.json') {
                const dp = reqPath === '/ag_dict_tw.json' ? dictTwPath : dictScPath;
                if (fs.existsSync(dp)) {
                    res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' });
                    fs.createReadStream(dp).pipe(res);
                    return;
                }
                res.writeHead(404, corsHeaders);
                res.end('{}');
                return;
            }

            if (reqPath === '/__ag_hanhua_state__') {
                if (req.method === 'POST') {
                    const chunks = [];
                    req.on('data', c => chunks.push(c));
                    req.on('end', () => {
                        try {
                            const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
                            __saveAndBroadcastHanhuaState(body);
                        } catch (e) {}
                        res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' });
                        res.end(JSON.stringify(__hanhuaLangState));
                    });
                    return;
                }
                res.writeHead(200, { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' });
                res.end(JSON.stringify(__hanhuaLangState));
                return;
            }

            if (reqPath === '/__ag_hanhua_events__') {
                res.writeHead(200, {
                    ...corsHeaders,
                    'Content-Type': 'text/event-stream; charset=utf-8',
                    'Connection': 'keep-alive'
                });
                res.write('data: ' + JSON.stringify(__hanhuaLangState) + '\\n\\n');
                __hanhuaSseClients.add(res);
                req.on('close', () => {
                    __hanhuaSseClients.delete(res);
                });
                return;
            }

            const proxyPort = proxyServer.address() ? proxyServer.address().port : 0;
            const headers = { ...req.headers, host: '127.0.0.1:' + targetPort };
            if (headers.origin) {
                headers.origin = 'http://127.0.0.1:' + targetPort;
            }
            if (headers.referer && proxyPort) {
                headers.referer = headers.referer.replace('127.0.0.1:' + proxyPort, '127.0.0.1:' + targetPort);
            }

            if (!/\\.(js|css|png|jpg|jpeg|gif|svg|woff2?|ttf|ico)(\\?|$)/i.test(req.url || '')) {
                delete headers['accept-encoding'];
            }

            const proxyReq = http.request({
                hostname: '127.0.0.1',
                port: targetPort,
                path: req.url,
                method: req.method,
                headers: headers
            }, (proxyRes) => {
                const cType = proxyRes.headers['content-type'] || '';
                if (cType.includes('text/html')) {
                    const chunks = [];
                    proxyRes.on('data', chunk => chunks.push(chunk));
                    proxyRes.on('end', () => {
                        let html = Buffer.concat(chunks).toString('utf8');
                        const scriptTag = '<script id="__ag_hanhua_ext_script__" data-ag-state="' + __agGetEncodedStateAttr() + '" src="/ag_agent_hanhua.js"></script>';
                        if (!html.includes('/ag_agent_hanhua.js')) {
                            if (html.includes('</body>')) {
                                html = html.replace('</body>', scriptTag + '</body>');
                            } else if (html.includes('</head>')) {
                                html = html.replace('</head>', scriptTag + '</head>');
                            } else {
                                html += scriptTag;
                            }
                        }
                        const newBuf = Buffer.from(html, 'utf8');
                        const newHeaders = { ...proxyRes.headers };
                        newHeaders['content-length'] = newBuf.length;
                        delete newHeaders['transfer-encoding'];
                        delete newHeaders['content-security-policy'];
                        res.writeHead(proxyRes.statusCode, newHeaders);
                        res.end(newBuf);
                    });
                } else {
                    res.writeHead(proxyRes.statusCode, proxyRes.headers);
                    proxyRes.pipe(res);
                }
            });

            proxyReq.on('error', (err) => {
                res.writeHead(502, { 'Content-Type': 'text/plain' });
                res.end('Hanhua Proxy error: ' + err.message);
            });

            req.pipe(proxyReq);
        });

        proxyServer.on('upgrade', (req, clientSocket, head) => {
            const upstreamSocket = net.connect(targetPort, '127.0.0.1', () => {
                let reqLine = req.method + ' ' + req.url + ' HTTP/' + req.httpVersion + '\\r\\n';
                let headersStr = '';
                for (let i = 0; i < req.rawHeaders.length; i += 2) {
                    const key = req.rawHeaders[i];
                    let val = req.rawHeaders[i + 1];
                    const lowerKey = key.toLowerCase();
                    if (lowerKey === 'host') {
                        val = '127.0.0.1:' + targetPort;
                    } else if (lowerKey === 'origin') {
                        val = 'http://127.0.0.1:' + targetPort;
                    }
                    headersStr += key + ': ' + val + '\\r\\n';
                }
                upstreamSocket.write(reqLine + headersStr + '\\r\\n');
                if (head && head.length) upstreamSocket.write(head);
                upstreamSocket.pipe(clientSocket);
                clientSocket.pipe(upstreamSocket);
            });
            upstreamSocket.on('error', () => clientSocket.destroy());
            clientSocket.on('error', () => upstreamSocket.destroy());
        });

        await new Promise((resolve, reject) => {
            proxyServer.listen(0, '127.0.0.1', () => resolve());
            proxyServer.on('error', reject);
        });
        const proxyPort = proxyServer.address().port;
        const proxyBase = 'http://127.0.0.1:' + proxyPort;
        __hanhuaProxyPorts.add(proxyPort);
        __hanhuaProxyMap.set(targetPort, proxyBase);
        return rewriteWithPort(proxyBase);
    } catch (e) {
        console.error('[Hanhua Proxy] Setup error:', e);
        return targetUrl;
    }
}
${EXT_HOOK_END}
`;
}

function injectExtensionJsDir(extDir, prebuiltHanhuaJs) {
    const extJsPath = path.join(extDir, "vscode", "extension.js");
    if (!fs.existsSync(extJsPath)) {
        return true;
    }

    try {
        console.log(`[修改] 正在向 extension.js 注入设置页/内嵌视图汉化代理: ${extDir}`);
        const extBakPath = extJsPath + ".bak";
        const curRaw = fs.readFileSync(extJsPath, 'utf-8');
        const hasHook = curRaw.includes(EXT_HOOK_START);

        if (!hasHook || !fs.existsSync(extBakPath)) {
            fs.copyFileSync(extJsPath, extBakPath);
        }

        let content = (!fs.readFileSync(extBakPath, 'utf-8').includes(EXT_HOOK_START))
            ? fs.readFileSync(extBakPath, 'utf-8')
            : curRaw;

        if (content.includes(EXT_HOOK_START)) {
            const startIdx = content.indexOf(EXT_HOOK_START);
            const endIdx = content.indexOf(EXT_HOOK_END) + EXT_HOOK_END.length;
            content = content.slice(0, startIdx) + content.slice(endIdx);
        }

        let matchedRenderHook = false;

        // Hook 1: BaseVsCodeWebviewDelegate.renderIframe (抗混淆标识符适配)
        const baseRenderRegex = /(?:async\s+)?renderIframe\(([A-Za-z0-9_$]+),([A-Za-z0-9_$]+),([A-Za-z0-9_$]+)\)\{(\s*(?:var|let|const)\s+[A-Za-z0-9_$]+\s*=\s*this\.buildIframeUrl\(\2,\3\);)/g;
        if (baseRenderRegex.test(content)) {
            matchedRenderHook = true;
            content = content.replace(
                baseRenderRegex,
                'async renderIframe($1,$2,$3){try{$2=await __getHanhuaProxyUrl($2)}catch(__e){}$4'
            );
        }

        // Hook 2: WebUiWebviewDelegate.renderIframe (覆盖 jetski.settingsEditor 等 WebUI 通道)
        const webUiRenderRegex = /((?:let|var|const)\s+([A-Za-z0-9_$]+)\s*=\s*[^;{}]{0,160}?this\.resolveWebIframeUrl\([^;]+;)/g;
        if (webUiRenderRegex.test(content)) {
            matchedRenderHook = true;
            content = content.replace(
                webUiRenderRegex,
                '$1try{$2=await __getHanhuaProxyUrl($2)}catch(__e){}'
            );
        }

        if (!matchedRenderHook) {
            console.warn(`[警告] 未在 extension.js 中匹配到 renderIframe 函数，跳过代理注入。`);
            return true;
        }

        // Hook 3: effectiveUrl (WebSocket 重连、端口转发与设置页连接地址)
        const effUrlObjRegex = /return\{effectiveUrl:([\s\S]{1,260}?),humanReadable:([A-Za-z0-9_$]+)\}/g;
        if (effUrlObjRegex.test(content)) {
            content = content.replace(
                effUrlObjRegex,
                'return{effectiveUrl:await __getHanhuaProxyUrl($1),humanReadable:$2}'
            );
        } else {
            content = content.replace(
                /async function pR\(a,b\)\{var c=Number\(\(a\.match\(:?\(\\\d\+\)\)\|\|\[\]\)\[1\]\);return!Number\.isFinite\(c\)\|\|c<=0\?a:b\?await b\.forwardPort\(c\):a\}/,
                'async function pR(a,b){var c=Number((a.match(/:(\\d+)/)||[])[1]);var __u=!Number.isFinite(c)||c<=0?a:b?await b.forwardPort(c):a;try{return await __getHanhuaProxyUrl(__u)}catch(e){return __u}}'
            );
        }

        // Hook 4: buildServerEnvironment / fd 子进程 macOS 代理透传
        const buildEnvExportRegex = /return ([A-Za-z0-9_$]+)\}(\r?\n[A-Za-z0-9_$]+\.buildServerEnvironment\s*=\s*[A-Za-z0-9_$]+)/g;
        if (buildEnvExportRegex.test(content)) {
            content = content.replace(
                buildEnvExportRegex,
                'try{__applyMacProxyAndEnv($1,null)}catch(__e){}return $1}$2'
            );
        } else {
            content = content.replace(
                /function fd\(a\)\{var b=Object\.assign\(\{\},process\.env\);/,
                'function fd(a){var b=Object.assign({},process.env);try{__applyMacProxyAndEnv(b,null)}catch(e){}'
            );
        }

        // Hook 5: 外层 vscode-webview 壳层 (renderLoading / renderWebviewHtml) 注入 CSP 安全汉化脚本与实时状态同步
        const renderLoadingRegex = /renderLoading\(([A-Za-z0-9_$]+)(,[^)]*)?\)\{(\s*[A-Za-z0-9_$]+\(\1\);\s*(?:var|let|const)\s+([A-Za-z0-9_$]+)\s*=\s*\1\.asWebviewUri\(([A-Za-z0-9_$]+)\.Uri\.joinPath\(this\.context\.extensionUri,"loading_bridge\.js"\)\);)([\s\S]{100,15000}?)(<script src="\$\{\4\}">(?:\\x3c|<)\/script>)/g;
        content = content.replace(
            renderLoadingRegex,
            'renderLoading($1$2){try{__agTrackWebview($1)}catch(__e){}var __agHu=$1.asWebviewUri($5.Uri.joinPath(this.context.extensionUri,"vscode","ag_agent_hanhua.js"));$3$6<script id="__ag_hanhua_ext_script__" data-ag-state="${__agGetEncodedStateAttr()}" src="${__agHu}">\\x3c/script>$7'
        );

        const renderWebviewHtmlRegex = /renderWebviewHtml\(([A-Za-z0-9_$]+),([A-Za-z0-9_$]+),([A-Za-z0-9_$]+),([A-Za-z0-9_$]+)\)\{(\s*[A-Za-z0-9_$]+\(\1\);\s*(?:var|let|const)\s+([A-Za-z0-9_$]+)\s*=\s*\1\.asWebviewUri\(([A-Za-z0-9_$]+)\.Uri\.joinPath\(this\.context\.extensionUri,"bridge\.js"\)\))([\s\S]{100,25000}?)(<script src="\$\{\6\}">(?:\\x3c|<)\/script>)/g;
        content = content.replace(
            renderWebviewHtmlRegex,
            'renderWebviewHtml($1,$2,$3,$4){try{__agTrackWebview($1)}catch(__e){}var __agHu=$1.asWebviewUri($7.Uri.joinPath(this.context.extensionUri,"vscode","ag_agent_hanhua.js"));$5$8<script id="__ag_hanhua_ext_script__" data-ag-state="${__agGetEncodedStateAttr()}" src="${__agHu}">\\x3c/script>$9'
        );

        // Hook 6: Settings 标题、底部状态栏语言切换按钮与行内 Diff CodeLens 动态联动
        content = content.replace(
            /([A-Za-z0-9_$]+)\.title=`\$\{([A-Za-z0-9_$]+)\} Settings`/g,
            '($1.title=__agFormatSettingsTitle($2),__agTrackSettingsPanel($1,$2))'
        );

        const statusBarBlockRegex = /([A-Za-z0-9_$]+)=([A-Za-z0-9_$]+)\.window\.createStatusBarItem\("settings",\2\.StatusBarAlignment\.Right,100\);([\s\S]{0,280}?)([A-Za-z0-9_$]+)\.subscriptions\.push\(\1\);/g;
        if (statusBarBlockRegex.test(content)) {
            content = content.replace(
                statusBarBlockRegex,
                '$1=$2.window.createStatusBarItem("settings",$2.StatusBarAlignment.Right,100);$3$4.subscriptions.push($1);try{__agRegisterStatusBarAndCommands($2,$4,$1)}catch(__e){}'
            );
        } else {
            const settingsTitleZh = USE_TW ? '設定' : '设置';
            const openSettingsTooltipZh = USE_TW ? '開啟 Antigravity 設定' : '打开 Antigravity 设置';
            content = content.replace(
                /b\.text="Antigravity - Settings";b\.tooltip="Open Antigravity Settings"/g,
                `b.text="Antigravity - ${settingsTitleZh}";b.tooltip="${openSettingsTooltipZh}"`
            );
        }

        content = content.replace(
            /this\.codeLensProvider\s*=\s*new\s+([A-Za-z0-9_$]+)\(this\)/g,
            'this.codeLensProvider=__agTrackCodeLensProvider(new $1(this))'
        );
        content = content.replace(
            /title:"\$\(check\)\s*Accept",tooltip:"Accept this suggestion block",command:"antigravity\.inlineDiff\.accept"/g,
            'title:__agCodeLensText("acceptTitle"),tooltip:__agCodeLensText("acceptTooltip"),command:"antigravity.inlineDiff.accept"'
        );
        content = content.replace(
            /title:"\$\(chrome-close\)\s*Reject",tooltip:"Reject this suggestion block",command:"antigravity\.inlineDiff\.reject"/g,
            'title:__agCodeLensText("rejectTitle"),tooltip:__agCodeLensText("rejectTooltip"),command:"antigravity.inlineDiff.reject"'
        );
        content = content.replace(
            /(contentText|text|label):"Tab to Jump"/g,
            '$1:__agCodeLensText("tabToJump")'
        );

        content = content + buildExtensionProxyFooter();
        fs.writeFileSync(extJsPath, content, 'utf-8');

        // 注入 dist/extension.js 中的行内补全提示 (showTabToJumpWidget("Tab to Jump"))
        const distExtPath = path.join(extDir, "dist", "extension.js");
        if (fs.existsSync(distExtPath)) {
            const distMarker = '/* Antigravity Dist Hanhua */';
            const distBakPath = distExtPath + ".bak";
            const distCur = fs.readFileSync(distExtPath, 'utf-8');
            if (!distCur.includes(distMarker) || !fs.existsSync(distBakPath)) {
                fs.copyFileSync(distExtPath, distBakPath);
            }
            const distBase = (!fs.readFileSync(distBakPath, 'utf-8').includes(distMarker))
                ? fs.readFileSync(distBakPath, 'utf-8')
                : distCur.replace(distMarker, '');
            const defaultTabJump = USE_TW ? '按 Tab 跳轉' : '按 Tab 跳转';
            const patchedDist = distBase.replace(
                /showTabToJumpWidget\(([^,]+),"Tab to Jump"\)/g,
                `showTabToJumpWidget($1,typeof globalThis.__agCodeLensText==="function"?globalThis.__agCodeLensText("tabToJump"):"${defaultTabJump}")`
            ) + '\n' + distMarker;
            fs.writeFileSync(distExtPath, patchedDist, 'utf-8');
        }

        // 写入汉化前端脚本与按需简繁双语词典（供 /ag_dict_sc.json、/ag_dict_tw.json 与外层 vscode-webview 零开销切换加载）
        const vscodeSubDir = path.join(extDir, "vscode");
        const extHanhuaPath = path.join(vscodeSubDir, "ag_agent_hanhua.js");
        let extJsPayload = prebuiltHanhuaJs;
        if (!extJsPayload) {
            const prevDual = EMBED_DUAL_ZH;
            EMBED_DUAL_ZH = true;
            try {
                extJsPayload = generateJs();
            } finally {
                EMBED_DUAL_ZH = prevDual;
            }
        }
        fs.writeFileSync(extHanhuaPath, extJsPayload, 'utf-8');
        fs.writeFileSync(path.join(vscodeSubDir, "ag_dict_sc.json"), JSON.stringify(loadDictionary('dicts')), 'utf-8');
        fs.writeFileSync(path.join(vscodeSubDir, "ag_dict_tw.json"), JSON.stringify(loadDictionary('dicts_tw')), 'utf-8');

        console.log(`[修改] extension.js 注入成功！`);
        return true;
    } catch (e) {
        console.error(`[错误] 注入 extension.js 失败: ${e.message}`);
        if (process.platform === 'darwin' && e.code === 'EPERM') {
            console.error(`[提示] macOS 写入受限，请使用管理员权限运行脚本，或在“系统设置 -> 隐私与安全性 -> App 管理”中允许终端修改 App。`);
        }
        return false;
    }
}

function injectExtensionJs(appDir, prebuiltHanhuaJs) {
    const agyDir = path.join(appDir, "extensions", "agy");
    if (!fs.existsSync(path.join(agyDir, "vscode", "extension.js"))) {
        return true;
    }
    patchExtensionPackageNls(agyDir);
    return injectExtensionJsDir(agyDir, prebuiltHanhuaJs);
}

function discoverExtensionTargets(manualExtDirs = []) {
    const autoHeal = require(path.join(__dirname, 'scripts', 'auto_heal.js'));
    return autoHeal.discoverExternalExtensionDirs(manualExtDirs);
}

function installExtensionTarget(extDir) {
    console.log("====== 正在安装 VS Code / 外部编辑器扩展汉化 ======");
    const resolved = path.resolve(extDir);
    if (!fs.existsSync(path.join(resolved, "vscode", "extension.js"))) {
        console.error(`[错误] 未在扩展目录中找到 vscode/extension.js: ${resolved}`);
        return false;
    }
    try {
        patchExtensionPackageNls(resolved);
        const prevDual = EMBED_DUAL_ZH;
        EMBED_DUAL_ZH = true;
        let extJsPayload;
        try {
            extJsPayload = generateJs();
        } finally {
            EMBED_DUAL_ZH = prevDual;
        }
        const ok = injectExtensionJsDir(resolved, extJsPayload);
        if (ok) {
            console.log(`[√] 扩展汉化部署完成: ${resolved}`);
        }
        return ok;
    } catch (e) {
        console.error(`[错误] 扩展汉化失败 (${resolved}): ${e.message}`);
        return false;
    }
}

function restoreExtensionTarget(extDir) {
    console.log("====== 正在恢复 VS Code / 外部编辑器扩展官方原版 ======");
    const resolved = path.resolve(extDir);
    let changed = false;

    if (restoreExtensionPackageNls(resolved)) {
        changed = true;
    }

    const extJsPath = path.join(resolved, "vscode", "extension.js");
    const extBakPath = extJsPath + ".bak";
    if (fs.existsSync(extBakPath)) {
        try {
            fs.copyFileSync(extBakPath, extJsPath);
            fs.unlinkSync(extBakPath);
            changed = true;
        } catch (e) {
            console.error(`[错误] 恢复扩展 extension.js 失败: ${e.message}`);
            return false;
        }
    }

    const distExtPath = path.join(resolved, "dist", "extension.js");
    const distBakPath = distExtPath + ".bak";
    if (fs.existsSync(distBakPath)) {
        try {
            fs.copyFileSync(distBakPath, distExtPath);
            fs.unlinkSync(distBakPath);
            changed = true;
        } catch (e) {
            console.error(`[错误] 恢复扩展 dist/extension.js 失败: ${e.message}`);
            return false;
        }
    }

    for (const extra of ['ag_agent_hanhua.js', 'ag_dict_sc.json', 'ag_dict_tw.json']) {
        const p = path.join(resolved, "vscode", extra);
        if (fs.existsSync(p)) {
            try {
                fs.unlinkSync(p);
                changed = true;
            } catch (e) {}
        }
    }

    if (changed) {
        console.log(`[√] 扩展已恢复官方英文原版: ${resolved}`);
    } else {
        console.log(`[!] 扩展未发现汉化备份，无需还原: ${resolved}`);
    }
    return true;
}

function injectHtml10(absPath) {
    if (!fs.existsSync(absPath)) return false;
    
    try {
        let content = fs.readFileSync(absPath, 'utf-8');
        
        const injectStr = '<script src="../../../../ag_agent_hanhua.js"></script>';
        content = content.replace(/<script.*ag_agent_hanhua\.js.*><\/script>/g, '');
        
        if (content.includes('</body>')) {
            content = content.replace('</body>', `${injectStr}</body>`);
        } else {
            content += injectStr;
        }
            
        fs.writeFileSync(absPath, content, 'utf-8');
        return true;
    } catch (e) {
        console.error(`[错误] 注入失败 ${absPath}: ${e.message}`);
        return false;
    }
}

function updateChecksums10(installDir) {
    try {
        const appDir = getAppDir(installDir);
        const productJsonPath = path.join(appDir, "product.json");
        if (!fs.existsSync(productJsonPath)) return;
        
        const data = JSON.parse(fs.readFileSync(productJsonPath, 'utf-8'));
        if (!data.checksums) data.checksums = {};

        const targetFiles = getOldTargetFiles(appDir);
        const outDir = path.join(appDir, "out");
        for (const absPath of targetFiles) {
            if (fs.existsSync(absPath)) {
                const relKey = path.relative(outDir, absPath).replace(/\\/g, "/");
                const fileBuffer = fs.readFileSync(absPath);
                const hash = crypto.createHash('sha256').update(fileBuffer).digest();
                data.checksums[relKey] = hash.toString('base64').replace(/=/g, '');
            }
        }
        
        fs.writeFileSync(productJsonPath, JSON.stringify(data, null, '\t'), 'utf-8');
    } catch (e) {
        console.warn(`[警告] 更新 checksums 失败: ${e.message}`);
    }
}

function install10(installDir) {
    console.log("====== 检测到 Antigravity IDE / 1.0 架构，正在使用 HTML 注入引擎 ======");
    const appDir = getAppDir(installDir);
    if (!backupFiles10(appDir)) {
        return false;
    }
    
    // 生成单独的 js 汉化文件
    const hanhuaJsPath = path.join(appDir, "out", "ag_agent_hanhua.js");
    let jsContent = "";
    try {
        fs.mkdirSync(path.dirname(hanhuaJsPath), { recursive: true });
        jsContent = generateJs();
        fs.writeFileSync(hanhuaJsPath, jsContent, 'utf-8');
    } catch (e) {
        console.error(`[错误] 写入汉化文件失败: ${e.message}`);
        if (process.platform === 'darwin' && e.code === 'EPERM') {
            console.error(`[提示] macOS 写入受限，请使用管理员权限运行脚本，或在“系统设置 -> 隐私与安全性 -> App 管理”中允许终端修改 App。`);
        }
        return false;
    }
        
    const targetFiles = getOldTargetFiles(appDir);
    for (const html of targetFiles) {
        if (!fs.existsSync(html)) continue;
        if (injectHtml10(html)) {
            console.log(`[√] 注入成功: ${path.basename(html)}`);
        } else {
            return false;
        }
    }

    if (!injectMainJs10(appDir)) {
        return false;
    }

    if (!injectExtensionJs(appDir, jsContent)) {
        return false;
    }
            
    cleanElectronCache();
    updateChecksums10(installDir);
    resignAppOnMac(installDir);
    console.log("[√] Antigravity IDE / 1.0 汉化部署完成！");
    return true;
}

function restore10(installDir) {
    console.log("====== 正在恢复 Antigravity IDE / 1.0 官方原版 ======");
    let changed = false;
    const appDir = getAppDir(installDir);
    const targetFiles = getOldTargetFiles(appDir);
    for (const absPath of targetFiles) {
        const bakPath = absPath + ".bak";
        if (fs.existsSync(bakPath)) {
            fs.copyFileSync(bakPath, absPath);
            fs.unlinkSync(bakPath);
            console.log(`[还原] 已恢复 HTML: ${path.basename(absPath)}`);
            changed = true;
        }
    }

    const mainJsPath = path.join(appDir, "out", "main.js");
    const mainBakPath = mainJsPath + ".bak";
    if (fs.existsSync(mainBakPath)) {
        try {
            fs.copyFileSync(mainBakPath, mainJsPath);
            fs.unlinkSync(mainBakPath);
            console.log(`[还原] 已恢复 out/main.js 官方版本。`);
            changed = true;
        } catch (e) {
            console.error(`[错误] 恢复 out/main.js 失败: ${e.message}`);
        }
    }
    
    const agyDir = path.join(appDir, "extensions", "agy");
    if (restoreExtensionPackageNls(agyDir)) {
        changed = true;
    }

    const extJsPath = path.join(agyDir, "vscode", "extension.js");
    const extBakPath = extJsPath + ".bak";
    if (fs.existsSync(extBakPath)) {
        try {
            fs.copyFileSync(extBakPath, extJsPath);
            fs.unlinkSync(extBakPath);
            console.log(`[还原] 已恢复 extension.js 官方版本。`);
            changed = true;
        } catch (e) {
            console.error(`[错误] 恢复 extension.js 失败: ${e.message}`);
        }
    }
    const distExtPath = path.join(agyDir, "dist", "extension.js");
    const distBakPath = distExtPath + ".bak";
    if (fs.existsSync(distBakPath)) {
        try {
            fs.copyFileSync(distBakPath, distExtPath);
            fs.unlinkSync(distBakPath);
            console.log(`[还原] 已恢复 dist/extension.js 官方版本。`);
            changed = true;
        } catch (e) {
            console.error(`[错误] 恢复 dist/extension.js 失败: ${e.message}`);
        }
    }
    for (const extra of ["ag_agent_hanhua.js", "ag_dict_sc.json", "ag_dict_tw.json"]) {
        const p = path.join(agyDir, "vscode", extra);
        if (fs.existsSync(p)) {
            try {
                fs.unlinkSync(p);
                changed = true;
            } catch (e) {}
        }
    }

    const hanhuaJsPath = path.join(appDir, "out", "ag_agent_hanhua.js");
    if (fs.existsSync(hanhuaJsPath)) {
        fs.unlinkSync(hanhuaJsPath);
        console.log(`[还原] 已删除汉化脚本`);
        changed = true;
    }
        
    if (changed) {
        cleanElectronCache();
        updateChecksums10(installDir);
        resignAppOnMac(installDir);
        console.log("[√] 校验值已同步，IDE / 1.0 软件恢复至原始状态。");
    } else {
        console.log("[!] 未找到备份文件，可能尚未安装过汉化或备份被删除。");
    }
    return changed;
}

// ==========================================
// 代理模块管理 (仅限 Windows 平台 Desktop/IDE 主程序目录注入)
// ==========================================
function restoreProxyIfNeeded(installDir) {
    if (process.platform !== 'win32') return;
    if (!hasAntigravityResources(installDir)) return;
    const proxyFiles = ['version.dll', 'dbghelp.dll', 'config.json'];

    const removedFiles = [];
    for (const file of proxyFiles) {
        const dest = path.join(installDir, file);
        if (fs.existsSync(dest)) {
            try {
                fs.unlinkSync(dest);
                removedFiles.push(file);
            } catch (e) {
                console.warn(`[代理警告] 移除代理文件 ${file} 失败: ${e.message}`);
            }
        }
    }

    if (removedFiles.length > 0) {
        console.log(`[代理] 已清理代理注入文件: ${removedFiles.join(', ')}`);
    }
}

// ==========================================
// 船板主题与实时遥测守护服务管理 (theme_patch/ · CDP 无侵入注入)
// ==========================================
function resolveThemeUserHome() {
    if (process.platform === 'darwin' && process.env.SUDO_USER && process.env.SUDO_USER !== 'root') {
        const sudoHome = path.join('/Users', process.env.SUDO_USER);
        if (fs.existsSync(sudoHome)) {
            return { sudoUser: process.env.SUDO_USER, home: sudoHome };
        }
    }
    return { sudoUser: null, home: os.homedir() };
}

function cleanupLegacyAntigravityPatch(homeDir) {
    const legacyDir = path.join(homeDir, '.antigravity-patch');
    const startupVbs =
        process.platform === 'win32'
            ? path.join(process.env.APPDATA || path.join(homeDir, 'AppData', 'Roaming'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Startup', 'AntigravityThemePatch.vbs')
            : '';

    const hasLegacyDir = fs.existsSync(legacyDir);
    const hasStartupVbs = Boolean(startupVbs && fs.existsSync(startupVbs));
    if (!hasLegacyDir && !hasStartupVbs) return false;

    if (process.platform === 'win32') {
        try {
            child_process.spawnSync(
                'powershell.exe',
                [
                    '-NoProfile',
                    '-ExecutionPolicy',
                    'Bypass',
                    '-Command',
                    "Get-CimInstance Win32_Process -Filter \"Name = 'node.exe'\" | Where-Object { $_.CommandLine -like '*daemon.mjs*' -and $_.CommandLine -notlike '*theme-patch*' -and $_.CommandLine -notlike '*antigravity-font-daemon*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"
                ],
                { windowsHide: true, stdio: 'ignore', timeout: 5000 }
            );
        } catch (e) {}
        if (hasStartupVbs) {
            try { fs.unlinkSync(startupVbs); } catch (e) {}
        }
    }

    if (hasLegacyDir) {
        try {
            fs.rmSync(legacyDir, { recursive: true, force: true });
        } catch (e) {}
    }

    console.log(`[主题] 已清理旧版 ~/.antigravity-patch 遗留守护进程与目录。`);
    return true;
}

function runThemePatchCli(subArgs, options = {}) {
    const themePatchDir = path.join(__dirname, 'theme_patch');
    const installerPath = path.join(themePatchDir, 'install.mjs');
    if (!fs.existsSync(installerPath)) return { skipped: true, status: 0 };

    const majorVer = parseInt((process.versions.node || '0').split('.')[0], 10);
    if (majorVer < 22) {
        console.warn(`[主题跳过] 当前 Node.js 版本低于 22.0.0，跳过船板主题服务部署: v${process.versions.node}`);
        return { skipped: true, status: 0 };
    }

    const { sudoUser, home } = resolveThemeUserHome();
    const stdioMode = options.stdio || 'inherit';

    if (sudoUser) {
        return child_process.spawnSync(
            'sudo',
            ['-u', sudoUser, 'env', `HOME=${home}`, `PATH=${process.env.PATH || ''}`, process.execPath, '--disable-warning=ExperimentalWarning', installerPath, ...subArgs],
            { cwd: themePatchDir, stdio: stdioMode }
        );
    }

    return child_process.spawnSync(
        process.execPath,
        ['--disable-warning=ExperimentalWarning', installerPath, ...subArgs],
        { cwd: themePatchDir, stdio: stdioMode, windowsHide: true }
    );
}

function buildThemeOverrideDict(options = {}) {
    const useTw = typeof options.useTw === 'boolean' ? options.useTw : USE_TW;
    const brandTitle = options.brandTitle || BRAND_TITLE_MODE;

    const coreDictPath = path.join(__dirname, 'theme_patch', 'core', 'i18n.json');
    let coreDict = {};
    if (fs.existsSync(coreDictPath)) {
        try {
            coreDict = JSON.parse(fs.readFileSync(coreDictPath, 'utf8'));
        } catch (e) {}
    }

    const dictsFolder = useTw ? 'dicts_tw' : 'dicts';
    const dictsDir = path.join(__dirname, dictsFolder);
    const override = {};

    if (fs.existsSync(dictsDir)) {
        const files = fs.readdirSync(dictsDir).filter(f => f.endsWith('.json')).sort();
        for (const file of files) {
            try {
                const data = JSON.parse(fs.readFileSync(path.join(dictsDir, file), 'utf8'));
                for (const [rawK, rawV] of Object.entries(data)) {
                    if (rawK.startsWith('_') || typeof rawV !== 'string') continue;
                    const k = rawK.trim();
                    const v = rawV.trim();
                    if (!k || !v || k === v) continue;

                    if (k === 'Antigravity') {
                        if (brandTitle === 'english') continue;
                        if (brandTitle === 'hidden') {
                            override[k] = '';
                            continue;
                        }
                        override[k] = v;
                        continue;
                    }

                    if (!useTw && Object.prototype.hasOwnProperty.call(coreDict, k)) continue;
                    if (!/[A-Za-z]{2,}/.test(k) || /[\u4e00-\u9fff]/.test(k) || !/[\u4e00-\u9fff]/.test(v)) continue;
                    if (/^[a-z][a-z0-9_./:-]*$/.test(k)) continue;
                    if (/[{}]|\$\/|=>|<\/?[a-z]+/i.test(k)) continue;

                    override[k] = v;
                }
            } catch (e) {}
        }
    }

    return {
        _comment: '由 localization_engine.js 自动合并生成的补充词库（不覆盖 core/i18n.json 原生词条）；支持直接增改，保存后 2.5 秒热生效。',
        exact: override
    };
}

function syncThemePatchOverrideDict(options = {}) {
    const payload = buildThemeOverrideDict(options);
    const jsonText = JSON.stringify(payload, null, 2) + '\n';
    const count = Object.keys(payload.exact || {}).length;

    const repoOverridePath = path.join(__dirname, 'theme_patch', 'user', 'i18n.override.json');
    try {
        fs.mkdirSync(path.dirname(repoOverridePath), { recursive: true });
        fs.writeFileSync(repoOverridePath, jsonText, 'utf8');
    } catch (e) {
        console.warn(`[主题警告] 写入仓库补充词库失败: ${e.message}`);
    }

    const { home } = resolveThemeUserHome();
    const deployedUserDir = path.join(home, '.gemini', 'antigravity', 'theme-patch', 'user');
    if (fs.existsSync(deployedUserDir)) {
        const deployedOverridePath = path.join(deployedUserDir, 'i18n.override.json');
        try {
            fs.writeFileSync(deployedOverridePath, jsonText, 'utf8');
        } catch (e) {
            console.warn(`[主题警告] 写入部署目录补充词库失败: ${e.message}`);
        }
    }

    console.log(`[主题] 已同步补充汉化词库至 user/i18n.override.json (${count} 条，${(options.useTw ?? USE_TW) ? '繁体中文' : '简体中文'})。`);
    return { count, repoOverridePath };
}

function extractMarkedBlock(text, startMarker, endMarker) {
    const startIdx = text.indexOf(startMarker);
    const endIdx = startIdx >= 0 ? text.indexOf(endMarker, startIdx + startMarker.length) : -1;
    if (startIdx >= 0 && endIdx > startIdx) {
        return {
            startIdx,
            endIdx: endIdx + endMarker.length,
            block: text.slice(startIdx, endIdx + endMarker.length)
        };
    }
    return null;
}

function syncUserCustomExtensionFile(srcFile, dstFile, markerKind) {
    if (!fs.existsSync(srcFile)) return false;
    const srcText = fs.readFileSync(srcFile, 'utf8');
    const startMarker = markerKind === 'css' ? '/* === AG_TOKEN_MONITOR_START === */' : '// === AG_TOKEN_MONITOR_START ===';
    const endMarker = markerKind === 'css' ? '/* === AG_TOKEN_MONITOR_END === */' : '// === AG_TOKEN_MONITOR_END ===';
    const srcExtracted = extractMarkedBlock(srcText, startMarker, endMarker);

    fs.mkdirSync(path.dirname(dstFile), { recursive: true });
    if (!fs.existsSync(dstFile)) {
        fs.writeFileSync(dstFile, srcText, 'utf8');
        return true;
    }

    const dstText = fs.readFileSync(dstFile, 'utf8');
    if (dstText === srcText) return false;

    if (!srcExtracted) {
        if (!dstText.includes('ag-token-monitor-btn')) {
            fs.writeFileSync(dstFile, srcText, 'utf8');
            return true;
        }
        return false;
    }

    const dstExtracted = extractMarkedBlock(dstText, startMarker, endMarker);
    if (dstExtracted) {
        if (dstExtracted.block === srcExtracted.block) return false;
        const merged = dstText.slice(0, dstExtracted.startIdx) + srcExtracted.block + dstText.slice(dstExtracted.endIdx);
        fs.writeFileSync(dstFile, merged, 'utf8');
        return true;
    }

    if (!dstText.includes('ag-token-monitor-btn')) {
        const sep = dstText.endsWith('\n') ? '\n' : '\n\n';
        fs.writeFileSync(dstFile, dstText + sep + srcExtracted.block + '\n', 'utf8');
        return true;
    }

    return false;
}

function checkTokenMonitorHealthSync(host = '127.0.0.1', port = 18923) {
    try {
        const probeCode = `require('http').get('http://${host}:${port}/api/health',{timeout:700},r=>{let b='';r.on('data',c=>b+=c);r.on('end',()=>process.exit(r.statusCode===200&&b.includes('"ok":true')?0:1))}).on('error',()=>process.exit(1)).on('timeout',function(){this.destroy();process.exit(1)})`;
        const res = child_process.spawnSync(process.execPath, ['-e', probeCode], {
            stdio: 'ignore',
            windowsHide: true,
            timeout: 2000
        });
        return res.status === 0;
    } catch (e) {
        return false;
    }
}

function stopStandaloneTokenMonitor(home) {
    const pidFile = path.join(home, '.gemini', 'antigravity', 'token-monitor', 'server.pid');
    try {
        if (fs.existsSync(pidFile)) {
            const pid = parseInt(fs.readFileSync(pidFile, 'utf8').trim(), 10);
            if (pid > 0 && pid !== process.pid) {
                try { process.kill(pid, 'SIGTERM'); } catch (e) {}
            }
            try { fs.unlinkSync(pidFile); } catch (e) {}
        }
    } catch (e) {}

    if (process.platform === 'win32') {
        try {
            child_process.spawnSync(
                'powershell.exe',
                [
                    '-NoProfile',
                    '-ExecutionPolicy',
                    'Bypass',
                    '-Command',
                    "Get-CimInstance Win32_Process -Filter \"Name = 'node.exe'\" | Where-Object { $_.CommandLine -like '*token-monitor*monitor_server*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"
                ],
                { windowsHide: true, stdio: 'ignore', timeout: 4000 }
            );
        } catch (e) {}
    } else {
        try {
            child_process.spawnSync('pkill', ['-f', 'token-monitor/monitor_server'], { stdio: 'ignore', timeout: 2500 });
        } catch (e) {}
    }
}

function deployTokenMonitorService(home) {
    const srcTmDir = path.join(__dirname, 'tools', 'token_monitor');
    if (!fs.existsSync(srcTmDir)) return null;

    const dstTmDir = path.join(home, '.gemini', 'antigravity', 'token-monitor');
    fs.mkdirSync(dstTmDir, { recursive: true });
    for (const fileName of ['index.html', 'monitor_server.mjs', 'monitor_server.py', 'README.md']) {
        const s = path.join(srcTmDir, fileName);
        const d = path.join(dstTmDir, fileName);
        if (fs.existsSync(s)) {
            fs.copyFileSync(s, d);
        }
    }

    const deployedDaemon = path.join(home, '.gemini', 'antigravity', 'theme-patch', 'core', 'daemon.mjs');
    const wrapperDaemon = path.join(home, '.gemini', 'antigravity', 'scripts', 'antigravity-font-daemon.mjs');
    if (fs.existsSync(deployedDaemon)) {
        fs.mkdirSync(path.dirname(wrapperDaemon), { recursive: true });
        const realDaemonUrl = pathToFileURL(deployedDaemon).href;
        const monitorServerUrl = pathToFileURL(path.join(dstTmDir, 'monitor_server.mjs')).href;
        const wrapperCode = `#!/usr/bin/env node
// Auto-generated wrapper -> ${deployedDaemon}
await import(${JSON.stringify(realDaemonUrl)});
if (!process.argv.includes('--once')) {
  try {
    const { startTokenMonitorServer } = await import(${JSON.stringify(monitorServerUrl)});
    await startTokenMonitorServer({ host: '127.0.0.1', port: 18923 });
  } catch (e) {
    console.warn('[Token Monitor] 随守护启动失败:', e?.message || e);
  }
}
`;
        fs.writeFileSync(wrapperDaemon, wrapperCode, { encoding: 'utf8', mode: 0o755 });
    }

    return { dstTmDir, wrapperDaemon };
}

function restartDaemonWithMonitorIfNeeded(home, deployedInfo) {
    if (!deployedInfo) return false;

    if (process.platform === 'darwin') {
        try {
            const uid = typeof process.getuid === 'function' ? process.getuid() : 501;
            const launchAgentsDir = path.join(home, 'Library', 'LaunchAgents');
            for (const label of ['com.antigravity.customfont', 'com.antigravity.theme']) {
                const plist = path.join(launchAgentsDir, `${label}.plist`);
                if (fs.existsSync(plist)) {
                    child_process.spawnSync('launchctl', ['kickstart', '-k', `gui/${uid}/${label}`], {
                        stdio: 'ignore',
                        timeout: 4000
                    });
                }
            }
        } catch (e) {}
    } else if (process.platform === 'linux') {
        try {
            child_process.spawnSync('systemctl', ['--user', 'restart', 'antigravity-theme.service'], {
                stdio: 'ignore',
                timeout: 4000
            });
        } catch (e) {}
    }

    for (let i = 0; i < 4; i += 1) {
        if (checkTokenMonitorHealthSync()) return true;
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 300);
    }

    // 兜底：若系统服务未能及时拉起，直接独立后台启动 monitor_server.mjs
    const serverEntry = path.join(deployedInfo.dstTmDir, 'monitor_server.mjs');
    if (fs.existsSync(serverEntry)) {
        try {
            const child = child_process.spawn(process.execPath, [serverEntry, '--daemon', '--host', '127.0.0.1', '--port', '18923'], {
                detached: true,
                stdio: 'ignore',
                windowsHide: true
            });
            child.unref();
            for (let i = 0; i < 6; i += 1) {
                Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
                if (checkTokenMonitorHealthSync()) return true;
            }
        } catch (e) {}
    }
    return checkTokenMonitorHealthSync();
}

function installThemePatchIfNeeded(options = {}) {
    const themePatchDir = path.join(__dirname, 'theme_patch');
    if (!fs.existsSync(path.join(themePatchDir, 'install.mjs'))) return;

    const { home } = resolveThemeUserHome();
    console.log(`\n[主题] 检测到 theme_patch 目录，正在同步部署船板主题与实时遥测守护服务...`);
    cleanupLegacyAntigravityPatch(home);

    let customChanged = false;
    try {
        const deployedUserDir = path.join(home, '.gemini', 'antigravity', 'theme-patch', 'user');
        const repoCss = path.join(themePatchDir, 'user', 'custom.css');
        const repoJs = path.join(themePatchDir, 'user', 'custom.js');
        if (syncUserCustomExtensionFile(repoCss, path.join(deployedUserDir, 'custom.css'), 'css')) {
            customChanged = true;
        }
        if (syncUserCustomExtensionFile(repoJs, path.join(deployedUserDir, 'custom.js'), 'js')) {
            customChanged = true;
        }
    } catch (e) {
        console.warn(`[主题警告] 同步 user/custom.* 扩展层异常: ${e.message}`);
    }

    const res = runThemePatchCli(['install']);
    if (res.skipped) return;
    if (res.status !== 0) {
        console.warn(`[主题警告] 船板主题服务执行异常: exit=${res.status}`);
        return;
    }

    let tmDeployed = null;
    try {
        stopStandaloneTokenMonitor(home);
        tmDeployed = deployTokenMonitorService(home);
    } catch (e) {
        console.warn(`[监控警告] 部署 Token Monitor 服务异常: ${e.message}`);
    }

    const enableThemeI18n = typeof options.enableThemeI18n === 'boolean'
        ? options.enableThemeI18n
        : Boolean(options.keepThemeI18n);

    try {
        const deployedUserCfgPath = path.join(home, '.gemini', 'antigravity', 'theme-patch', 'user', 'config.json');
        let needHotReload = customChanged;
        if (fs.existsSync(deployedUserCfgPath)) {
            const cfg = JSON.parse(fs.readFileSync(deployedUserCfgPath, 'utf8'));
            if (!cfg.modules || typeof cfg.modules !== 'object') cfg.modules = {};
            if (cfg.modules.i18n !== enableThemeI18n) {
                cfg.modules.i18n = enableThemeI18n;
                fs.writeFileSync(deployedUserCfgPath, JSON.stringify(cfg, null, 2) + '\n', 'utf8');
                needHotReload = true;
            }
        }
        if (enableThemeI18n) {
            syncThemePatchOverrideDict(options);
            needHotReload = true;
        }
        if (needHotReload) {
            const deployedDaemon = path.join(home, '.gemini', 'antigravity', 'theme-patch', 'core', 'daemon.mjs');
            if (fs.existsSync(deployedDaemon)) {
                child_process.spawnSync(process.execPath, ['--disable-warning=ExperimentalWarning', deployedDaemon, '--once'], {
                    stdio: 'ignore',
                    windowsHide: true
                });
            }
        }
    } catch (e) {
        console.warn(`[主题警告] 同步 CDP 汉化配置异常: ${e.message}`);
    }

    // Windows 非管理员权限下 schtasks ONLOGON 会被拒绝而回退为当前进程树子进程；
    // 通过普通用户允许的 /SC MINUTE 临时计划任务跳板由系统 Schedule 服务重新拉起，彻底脱离客户端 Job Object 防止重启被连带强杀
    if (process.platform === 'win32') {
        try {
            const localVbs = path.join(home, '.gemini', 'antigravity', 'theme-patch', 'AntigravityThemeDaemon.vbs');
            if (fs.existsSync(localVbs)) {
                const tempTask = 'AntigravityThemeBreakaway';
                const tr = `wscript.exe //B //NoLogo "${localVbs}"`;
                const cr = child_process.spawnSync(
                    'schtasks',
                    ['/Create', '/TN', tempTask, '/TR', tr, '/SC', 'MINUTE', '/MO', '30', '/F'],
                    { stdio: 'ignore', windowsHide: true }
                );
                if (cr.status === 0) {
                    child_process.spawnSync('schtasks', ['/Run', '/TN', tempTask], { stdio: 'ignore', windowsHide: true });
                    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 800);
                    child_process.spawnSync('schtasks', ['/Delete', '/TN', tempTask, '/F'], { stdio: 'ignore', windowsHide: true });
                }
            }
        } catch (e) {}
    }

    if (tmDeployed) {
        const monitorReady = restartDaemonWithMonitorIfNeeded(home, tmDeployed);
        if (monitorReady) {
            console.log(`[监控] Antigravity Token Monitor 已就绪: http://127.0.0.1:18923 （可在客户端右上角点击「Token 监控」或点击底部指标胶囊在内置浏览器打开）`);
        } else {
            console.warn(`[监控警告] Token Monitor 服务未能自动监听 18923 端口，可手动执行: node "${path.join(tmDeployed.dstTmDir, 'monitor_server.mjs')}"`);
        }
    }

    console.log(`[主题] 船板主题与实时遥测守护服务部署完成！`);
}

function uninstallThemePatchIfNeeded() {
    const { home } = resolveThemeUserHome();
    cleanupLegacyAntigravityPatch(home);
    stopStandaloneTokenMonitor(home);

    const deployedDir = path.join(home, '.gemini', 'antigravity', 'theme-patch');
    const themePatchDir = path.join(__dirname, 'theme_patch');
    if (!fs.existsSync(deployedDir) && !fs.existsSync(path.join(themePatchDir, 'install.mjs'))) return;

    console.log(`\n[主题] 正在卸载船板主题与实时遥测守护服务...`);
    const res = runThemePatchCli(['uninstall']);
    if (!res.skipped && res.status !== 0) {
        console.warn(`[主题警告] 船板主题服务执行异常: exit=${res.status}`);
    }
}

// ==========================================
// 入口
// ==========================================
function main() {
    let huifu = false;
    let manualDir = "";
    let noKill = false;
    let targetMode = "all";
    const manualExtDirs = getOptionValues('--ext-dir');

    const args = process.argv.slice(2);
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--huifu') {
            huifu = true;
        } else if (args[i] === '--install-dir') {
            manualDir = args[i + 1] || "";
            i++;
        } else if (args[i].startsWith('--install-dir=')) {
            manualDir = args[i].slice('--install-dir='.length);
        } else if (args[i] === '--no-kill') {
            noKill = true;
        } else if (args[i] === '--brand-title' || args[i] === '--ext-dir') {
            i++;
        } else if (args[i] === '--target') {
            targetMode = (args[i + 1] || "all").toLowerCase();
            i++;
        } else if (args[i].startsWith('--target=')) {
            targetMode = args[i].slice('--target='.length).toLowerCase();
        }
    }

    const autoHeal = require(path.join(__dirname, 'scripts', 'auto_heal.js'));

    // 独立只读/运维子命令入口（绝不杀死运行中的客户端，绝不写入安装目录）
    if (args.includes('--status') || args.includes('--guard-status')) {
        autoHeal.printFormattedStatus({
            installDirs: manualDir ? [manualDir] : undefined,
            extDirs: manualExtDirs
        });
        return;
    }

    if (args.includes('--sync')) {
        const syncScript = path.join(__dirname, 'scripts', 'sync_repos.js');
        const forwardArgs = args.filter(a => a !== '--sync');
        const res = child_process.spawnSync(process.execPath, [syncScript, ...forwardArgs], {
            cwd: __dirname,
            stdio: 'inherit'
        });
        if (res.status !== 0) process.exit(res.status || 1);
        return;
    }

    const themeSubcmdMap = {
        '--theme-doctor': 'doctor',
        '--theme-verify': 'verify',
        '--theme-rollback': 'rollback',
        '--theme-uninstall': 'uninstall',
        '--theme-install': 'install'
    };
    for (const [flag, subcmd] of Object.entries(themeSubcmdMap)) {
        if (args.includes(flag)) {
            if (subcmd === 'install') {
                installThemePatchIfNeeded({
                    enableThemeI18n: !args.includes('--no-theme-i18n'),
                    useTw: USE_TW,
                    brandTitle: BRAND_TITLE_MODE
                });
                return;
            }
            if (subcmd === 'uninstall') {
                uninstallThemePatchIfNeeded();
                return;
            }
            const extra = args.filter(a => a !== flag);
            const res = runThemePatchCli([subcmd, ...extra]);
            if (res.status !== 0) process.exit(res.status || 1);
            return;
        }
    }

    if (args.includes('--cdp-only') && !args.includes('--asar') && !huifu) {
        console.log("====== 正在切换并部署 Antigravity 纯 CDP 零修改汉化模式 (方案 A) ======");
        try {
            autoHeal.removeLaunchers();
            autoHeal.uninstallGuard();
        } catch (e) {}

        let detectedTargets = [];
        try {
            if (manualDir) {
                detectedTargets = [detectInstallationDir(manualDir)];
            } else {
                detectedTargets = detectInstallations();
            }
        } catch (e) {}

        const asarPatcher = require(path.join(__dirname, 'scripts', 'asar_patcher.js'));
        for (const installDir of detectedTargets) {
            restoreProxyIfNeeded(installDir);

            let resourcesDir = "";
            if (fs.existsSync(path.join(installDir, "resources", "app.asar"))) {
                resourcesDir = path.join(installDir, "resources");
            } else if (fs.existsSync(path.join(installDir, "Contents", "Resources", "app.asar"))) {
                resourcesDir = path.join(installDir, "Contents", "Resources");
            } else if (fs.existsSync(path.join(installDir, "app.asar"))) {
                resourcesDir = installDir;
            }

            if (resourcesDir) {
                const asarPath = path.join(resourcesDir, "app.asar");
                const bakPath = path.join(resourcesDir, "app.asar.bak");
                const isAsarLocalized = asarPatcher.isAsarLocalizedFast(asarPath, {
                    signatureStart: SIGNATURE_START,
                    signatureEnd: SIGNATURE_END
                });
                if (isAsarLocalized || fs.existsSync(bakPath)) {
                    if (!autoHeal.isClientOrUpdaterRunning([installDir])) {
                        restore20(resourcesDir);
                    } else if (isAsarLocalized) {
                        console.log(`[提示] ${path.basename(installDir)} 当前正在运行且带旧版 ASAR 补丁，将在完全退出后通过 --huifu 还原，已先启用纯 CDP 汉化。`);
                    }
                }
            } else if (hasAntigravityResources(installDir)) {
                const appDir = getAppDir(installDir);
                const wbExists = getOldTargetFiles(appDir).some(f => fs.existsSync(f + ".bak"));
                const mainBak = fs.existsSync(path.join(appDir, "out", "main.js.bak"));
                const extBak = fs.existsSync(path.join(appDir, "extensions", "agy", "vscode", "extension.js.bak"));
                const probe = autoHeal.probeAppTargetStatus(installDir);
                if (probe.localized || wbExists || mainBak || extBak) {
                    if (!autoHeal.isClientOrUpdaterRunning([installDir])) {
                        restore10(installDir);
                    } else {
                        console.log(`[提示] ${path.basename(installDir)} 当前正在运行，请退出后运行 --huifu 完成原版文件还原。`);
                    }
                }
            }
        }

        installThemePatchIfNeeded({
            enableThemeI18n: true,
            useTw: USE_TW,
            brandTitle: BRAND_TITLE_MODE
        });
        return;
    }

    const hasCreateLauncher = args.includes('--create-launcher');
    const hasRemoveLauncher = args.includes('--remove-launcher');
    const hasInstallGuard = args.includes('--install-guard');
    const hasUninstallGuard = args.includes('--uninstall-guard');
    const isStandaloneGuardAction =
        (hasCreateLauncher || hasRemoveLauncher || hasInstallGuard || hasUninstallGuard) &&
        !huifu &&
        !manualDir &&
        manualExtDirs.length === 0 &&
        !args.includes('--target');

    if (hasRemoveLauncher) {
        autoHeal.removeLaunchers();
    }
    if (hasUninstallGuard) {
        autoHeal.uninstallGuard();
    }
    if (isStandaloneGuardAction) {
        if (hasCreateLauncher || hasInstallGuard) {
            autoHeal.saveInstallPreferences({
                useTw: USE_TW,
                brandTitle: BRAND_TITLE_MODE,
                keepOptionNamesEn: KEEP_OPTION_NAMES_EN,
                embedDualZh: EMBED_DUAL_ZH,
                hideFloatBtn: HIDE_FLOAT_BTN
            });
        }
        if (hasCreateLauncher) autoHeal.createLaunchers();
        if (hasInstallGuard) autoHeal.installGuard();
        return;
    }

    if (!huifu) {
        try {
            autoHeal.saveInstallPreferences({
                useTw: USE_TW,
                brandTitle: BRAND_TITLE_MODE,
                keepOptionNamesEn: KEEP_OPTION_NAMES_EN,
                embedDualZh: EMBED_DUAL_ZH,
                hideFloatBtn: HIDE_FLOAT_BTN
            });
        } catch (e) {}
    }

    // 1. 探测目标路径（桌面端 / IDE / 外部 VS Code 扩展）
    let installations = [];
    let extensionTargets = [];

    if (targetMode === 'vscode-ext') {
        if (manualDir && fs.existsSync(path.join(manualDir, 'vscode', 'extension.js'))) {
            manualExtDirs.push(manualDir);
        }
        extensionTargets = discoverExtensionTargets(manualExtDirs);
    } else if (manualDir) {
        if (fs.existsSync(path.join(manualDir, 'vscode', 'extension.js')) && !hasAntigravityResources(manualDir)) {
            extensionTargets = [path.resolve(manualDir)];
        } else {
            installations = [detectInstallationDir(manualDir)];
        }
        if (manualExtDirs.length > 0) {
            extensionTargets.push(...discoverExtensionTargets(manualExtDirs));
        }
    } else {
        const detected = detectInstallations();
        if (targetMode === 'client') {
            installations = detected.filter(p => !p.toLowerCase().includes('ide'));
        } else if (targetMode === 'ide') {
            installations = detected.filter(p => p.toLowerCase().includes('ide'));
        } else {
            installations = detected;
            extensionTargets = discoverExtensionTargets(manualExtDirs);
        }
    }

    if (installations.length === 0 && extensionTargets.length === 0) {
        console.error("[错误] 未找到默认安装目录或外部扩展目录，请使用 --install-dir 或 --ext-dir 手动指定路径！");
        process.exit(1);
    }
    
    // 2. 仅当需要处理 Desktop / IDE 主客户端时才检查/关闭进程（纯 VS Code 扩展模式绝不误杀客户端）
    if (installations.length > 0) {
        wasAppRunning = checkIfAppIsRunning();
        if (noKill) {
            console.log("[跳过] 检测到 --no-kill 参数，跳过关闭 Antigravity 运行进程。");
        } else {
            closeAntigravityProcesses();
        }
    }

    let overallSuccess = true;

    for (const installDir of installations) {
        console.log(`\n======================================================`);
        console.log(`[目标] 正在处理: ${path.basename(installDir)} (${installDir})`);
        console.log(`======================================================`);

        let resourcesDir = "";
        if (fs.existsSync(path.join(installDir, "resources", "app.asar"))) {
            resourcesDir = path.join(installDir, "resources");
        } else if (fs.existsSync(path.join(installDir, "Contents", "Resources", "app.asar"))) {
            resourcesDir = path.join(installDir, "Contents", "Resources");
        } else if (fs.existsSync(path.join(installDir, "app.asar"))) {
            resourcesDir = installDir;
        }

        const isV2 = !!resourcesDir;
        const targetPermDir = isV2 ? resourcesDir : getAppDir(installDir);

        if (!fs.existsSync(targetPermDir)) {
            console.error(`[错误] 无法定位有效的应用资源目录: ${targetPermDir}`);
            overallSuccess = false;
            continue;
        }

        ensureWritePermission(targetPermDir);

        let success = false;
        if (huifu) {
            console.log("====== 正在卸载中文汉化，恢复官方原版 ======");
            if (isV2) {
                success = restore20(resourcesDir);
            } else {
                success = restore10(installDir);
            }
            if (success) {
                restoreProxyIfNeeded(installDir);
            }
        } else {
            console.log("====== 正在安装 Antigravity 中文汉化 ======");
            if (isV2) {
                success = install20(resourcesDir);
            } else {
                success = install10(installDir);
            }
        }

        if (!success) {
            overallSuccess = false;
        }
    }

    // 4. 处理外部编辑器 (VS Code / Cursor / Windsurf 等) 扩展目标
    for (const extDir of extensionTargets) {
        console.log(`\n======================================================`);
        console.log(`[扩展目标] 正在处理: ${path.basename(extDir)} (${extDir})`);
        console.log(`======================================================`);
        const extOk = huifu ? restoreExtensionTarget(extDir) : installExtensionTarget(extDir);
        if (!extOk) {
            overallSuccess = false;
        }
    }

    // 卸载还原时若未限定单目录，同步清理自愈启动器、后台守护服务与船板主题服务
    if (huifu && !manualDir && manualExtDirs.length === 0 && targetMode === 'all') {
        try {
            autoHeal.removeLaunchers();
            autoHeal.uninstallGuard();
        } catch (e) {}
        if (!args.includes('--keep-theme-patch') && process.env.AG_SKIP_THEME_PATCH !== '1' && process.env.AG_SKIP_REAL_INSTALL !== '1') {
            try {
                uninstallThemePatchIfNeeded();
            } catch (e) {}
        }
    } else if (!huifu) {
        const defaultEnableAutoHeal =
            overallSuccess &&
            !manualDir &&
            manualExtDirs.length === 0 &&
            (targetMode === 'all' || targetMode === 'client') &&
            !args.includes('--no-auto-heal') &&
            process.env.AG_SKIP_AUTO_HEAL !== '1' &&
            process.env.AG_SKIP_REAL_INSTALL !== '1' &&
            process.env.ELECTRON_RUN_AS_NODE !== '1';

        if ((hasCreateLauncher || defaultEnableAutoHeal) && !hasRemoveLauncher) {
            autoHeal.createLaunchers({ installDirs: installations.length ? installations : undefined });
        }
        if ((hasInstallGuard || defaultEnableAutoHeal) && !hasUninstallGuard) {
            autoHeal.installGuard({ installDirs: installations.length ? installations : undefined, extDirs: extensionTargets });
        }

        const shouldDeployThemePatch =
            overallSuccess &&
            !manualDir &&
            manualExtDirs.length === 0 &&
            (targetMode === 'all' || targetMode === 'client') &&
            !args.includes('--no-theme-patch') &&
            process.env.AG_SKIP_THEME_PATCH !== '1' &&
            process.env.AG_SKIP_REAL_INSTALL !== '1' &&
            process.env.ELECTRON_RUN_AS_NODE !== '1';

        if (shouldDeployThemePatch) {
            try {
                installThemePatchIfNeeded({
                    enableThemeI18n: args.includes('--theme-i18n'),
                    useTw: USE_TW,
                    brandTitle: BRAND_TITLE_MODE
                });
            } catch (e) {
                console.warn(`[主题警告] 船板主题服务执行异常: ${e.message}`);
            }
        }
    }

    // 5. 校验通过且原来客户端在运行，则自动重新启动客户端
    if (overallSuccess && wasAppRunning && !noKill && installations.length > 0) {
        console.log("\n[启动] 检测到安装前反重力客户端处于开启状态，正在重新启动客户端...");
        for (const installDir of installations) {
            try {
                if (process.platform === 'win32') {
                    let exePath = path.join(installDir, 'Antigravity.exe');
                    if (!fs.existsSync(exePath)) {
                        exePath = path.join(installDir, 'Antigravity IDE.exe');
                    }
                    if (fs.existsSync(exePath)) {
                        const child = child_process.spawn(exePath, [], {
                            detached: true,
                            stdio: 'ignore'
                        });
                        child.unref();
                        console.log(`[启动] ${path.basename(exePath)} 启动成功！`);
                    }
                } else if (process.platform === 'darwin') {
                    if (process.env.SUDO_USER && process.env.SUDO_USER !== 'root') {
                        child_process.exec(`sudo -u "${process.env.SUDO_USER}" open "${installDir}"`);
                    } else {
                        child_process.exec(`open "${installDir}"`);
                    }
                    console.log(`[启动] ${path.basename(installDir)} 启动成功！`);
                }
            } catch (e) {
                console.warn(`[警告] 客户端启动失败: ${e.message}`);
            }
        }
    }

    if (!overallSuccess) {
        process.exit(1);
    }
}

module.exports = {
    generateJs,
    loadDictionary,
    normalizeText,
    install20,
    restore20,
    install10,
    restore10,
    installExtensionTarget,
    restoreExtensionTarget,
    discoverExtensionTargets,
    patchExtensionPackageNls,
    injectExtensionJsDir,
    buildThemeOverrideDict,
    syncThemePatchOverrideDict
};

if (require.main === module) {
    main();
}
