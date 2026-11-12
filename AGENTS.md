# AGENTS.md — 仓库维护与智能协作指南

本指南供所有在此仓库中工作的 AI 智能体（Agent）及开发者参考，详细说明了本仓库的架构定位、常用运维任务及自动化标准流程。

---

## 📌 仓库定位与架构

- **当前仓库 (Origin)**: `https://github.com/AndMa82/antigravity2-cn.git`（个人维护版本）
- **上游仓库 (Upstream)**: `https://github.com/qqxpee/antigravity2-cn.git`（汉化官方源项目）
- **核心增强特性**:
  - 预集成 Windows 免 TUN 透明代理模块 (`proxy_config/`)，基于开源项目 [yuaotian/antigravity-proxy](https://github.com/yuaotian/antigravity-proxy)。
    - 包含 `proxy_config/version.dll` 与 `proxy_config/config.json`。
    - Windows 环境下双击安装脚本时，汉化引擎 [`localization_engine.js`](localization_engine.js) 会自动识别并连同汉化补丁一并注入到 Antigravity 安装目录；macOS 环境不加载 Windows DLL。
  - 预集成船板昼夜双模主题、字体与 SQLite 实时遥测补丁 (`theme_patch/`)，基于开源项目 [Anarcadia/chuanban-antigravity-theme-patch](https://github.com/Anarcadia/chuanban-antigravity-theme-patch)。
    - 采用「`theme_patch/core/` 只读黄金内核 + `theme_patch/user/` 无损改装层」架构，通过本地 CDP 无侵入注入白天暖纸/黑夜原生碳黑主题、四层排版及输入框底部 `tok/s · TTFT · Ctx 256k` 实时指标胶囊。
    - 默认在 `theme_patch/user/config.json` 中设置 `"i18n": false`，由 [`localization_engine.js`](localization_engine.js) 统一接管简/繁汉化与免重启语言切换，避免双 DOM 观察器抢占冲突。
    - 已接入 [`scripts/sync_repos.js`](scripts/sync_repos.js)（`config/sync_sources.json` 中的 `chuanban` 源），执行 `--sync` 时自动同步更新 `theme_patch/core` 内核并将船板新增词条归并至 `dicts/` 与 `dicts_tw/`。

---

## 🛠️ Agent 常见操作流程（任务清单）

### 任务 1：多源汉化与船板主题自动跟进 (Multi-Source Sync)

当上游汉化源（`qqxpee` / `yiheng8023` / `liominsb` / `yuexps`）或船板主题补丁（`Anarcadia/chuanban-antigravity-theme-patch`）发布更新时，优先通过多源同步引擎一键跟进：

```powershell
# 一键拉取五源增量词条 + 自动更新 theme_patch/core 内核（在 IDE 会话内附加 --no-relocalize 避免关窗）
node localization_engine.js --sync --no-relocalize

# 仅单独同步船板主题内核与词条
node scripts/sync_repos.js --only chuanban --no-relocalize
```

如需合并上游 `qqxpee/antigravity2-cn` 的引擎架构提交，仍可按需 `git fetch upstream` 审阅合并。

---

### 任务 2：更新 Windows 代理模块 (Update Proxy DLL)

当 `yuaotian/antigravity-proxy` 发布新版本修复 Bug 或协议时，Agent 执行以下流程：

1. 通过 GitHub API 获取最新版本下载地址：
   ```powershell
   $release = Invoke-RestMethod -Uri "https://api.github.com/repos/yuaotian/antigravity-proxy/releases/latest"
   $asset = $release.assets | Where-Object { $_.name -like "*ide-win-x64.zip" } | Select-Object -First 1
   ```
2. 下载并解压，仅提取 `ide/version.dll` 覆盖到 `proxy_config/version.dll`。
   *(注：桌面端仅需 `version.dll`，无需混合 CLI 专用的 `dbghelp.dll`)*。
3. 确保保留 `proxy_config/config.json` 中用户的代理端口（默认 `7897` 或按需配置）。
4. 提交并推送：
   ```powershell
   git add proxy_config/version.dll
   git commit -m "chore: 更新 antigravity-proxy 模块至最新版 ($($release.tag_name))"
   git push origin main
   ```

---

### 任务 3：检测与更新本地代理端口 (Check & Configure Proxy Port)

如果用户更换了代理工具（如从 Clash Verge 的 `7897` 切换到 Clash 的 `7890` 或 V2Ray 的 `10808`），Agent 执行：

1. 自动检测本机活跃代理监听端口：
   ```powershell
   Get-NetTCPConnection -State Listen | Where-Object { $_.LocalPort -in 7897, 7890, 10808, 10809, 18080 }
   ```
2. 读取并修改 `proxy_config/config.json`：
   ```powershell
   $cfg = Get-Content -Path "proxy_config/config.json" -Raw | ConvertFrom-Json
   $cfg.proxy.port = <目标端口>
   $cfg.proxy.type = "socks5" # 或 "http"
   $cfg | ConvertTo-Json -Depth 10 | Set-Content -Path "proxy_config/config.json" -Encoding UTF8
   ```

---

### 任务 4：执行安装与测试 (Install & Verify)

在当前环境安装汉化、代理与船板主题服务时：

* **若当前正在 Antigravity 会话内运行**：必须附加 `--no-kill` 参数，避免杀死当前正在使用的客户端进程：
  ```powershell
  node localization_engine.js --no-kill --brand-title english
  ```
* **单独管理或巡检船板主题与实时遥测服务**（不重打 ASAR、不关窗）：
  ```powershell
  node localization_engine.js --theme-install   # 单独安装/热升级船板主题守护服务
  node localization_engine.js --theme-verify    # CDP 实机注入状态验收
  node localization_engine.js --theme-doctor    # 环境、字体与 core SHA-256 完整性诊断
  node localization_engine.js --theme-uninstall # 单独停用并卸载船板主题守护服务
  ```
  *(注：若安装汉化时希望跳过船板主题，可附加 `--no-theme-patch`；个性化调整配色预设、字号或 CSS 请编辑部署后的 `~/.gemini/antigravity/theme-patch/user/` 目录，2.5 秒自动热生效)*。
* **若用户在外部终端运行**：直接双击运行 `双击安装中文汉化.bat`（或 macOS 下 `双击安装中文汉化.command`）即可。

---

## 🔒 约束与规范

1. 严禁将修改推送到 `upstream`；所有提交必须推送到 `origin/main`。
2. Windows 端通过 DLL 注入代理，macOS 端保持纯净汉化，不得在 macOS 端注入任何 Windows 二进制。
3. 任何对 `localization_engine.js` 的修改，需保持与原作者汉化结构的兼容性。
