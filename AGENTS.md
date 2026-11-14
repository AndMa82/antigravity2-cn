# AGENTS.md — 仓库维护与智能协作指南

本指南供所有在此仓库中工作的 AI 智能体（Agent）及开发者参考，详细说明了本仓库的架构定位、常用运维任务及自动化标准流程。

---

## 📌 仓库定位与架构

- **当前仓库 (Origin)**: `https://github.com/AndMa82/antigravity2-cn.git`（个人维护版本）
- **上游仓库 (Upstream)**: `https://github.com/qqxpee/antigravity2-cn.git`（汉化官方源项目）
- **核心增强特性**:
  - 默认采用 **纯 CDP 零文件修改汉化 + 船板昼夜双模主题、字体与 SQLite 实时遥测 (`theme_patch/`)** 架构（基于开源项目 [Anarcadia/chuanban-antigravity-theme-patch](https://github.com/Anarcadia/chuanban-antigravity-theme-patch) 与上游多源全量词库）：
    - 采用「`theme_patch/core/` 只读黄金内核 + `theme_patch/user/` 无损改装层」架构，通过本地 `127.0.0.1` CDP 调试协议无侵入注入白天暖纸/黑夜原生碳黑主题、四层排版、`tok/s · TTFT · Ctx 256k` 实时指标胶囊与全量中文界面翻译。
    - 默认模式入口为 `node localization_engine.js --cdp-only`（`theme_patch/user/config.json` 中设置 `"i18n": true`，并通过 [`localization_engine.js`](localization_engine.js) 的 `syncThemePatchOverrideDict()` 将 [`dicts/`](dicts) / [`dicts_tw/`](dicts_tw) 增量词条同步至 `theme_patch/user/i18n.override.json`）。
    - **零篡改原版客户端**：Windows 与 macOS 均不修改 `app.asar` 与官方代码签名，客户端自动更新全程无缝存活且 2.5 秒免重启热生效；已移除原 Windows 免 TUN DLL 代理注入模块。
    - 已接入 [`scripts/sync_repos.js`](scripts/sync_repos.js)（`config/sync_sources.json` 中的 `chuanban` 源），执行 `--sync` 时自动同步更新 `theme_patch/core` 内核、归并新增词条并热刷新 `user/i18n.override.json`。
    - 若需传统 ASAR 全量文件级汉化（覆盖系统原生菜单栏、`Antigravity IDE` 与外部扩展），仍可通过 `--asar` 参数手动触发（`installThemePatchIfNeeded` 会在传统 ASAR 模式下自动切换为 `"i18n": false` 避免双观察器冲突）。

---

## 🛠️ Agent 常见操作流程（任务清单）

### 任务 1：多源汉化与船板主题自动跟进 (Multi-Source Sync)

当上游汉化源（`qqxpee` / `yiheng8023` / `liominsb` / `yuexps`）或船板主题补丁（`Anarcadia/chuanban-antigravity-theme-patch`）发布更新时，优先通过多源同步引擎一键跟进：

```powershell
# 一键拉取五源增量词条 + 自动更新 theme_patch/core 内核与 CDP 补充词库
node localization_engine.js --sync --no-relocalize

# 仅单独同步船板主题内核与词条
node scripts/sync_repos.js --only chuanban --no-relocalize
```

如需合并上游 `qqxpee/antigravity2-cn` 的引擎架构提交，仍可按需 `git fetch upstream` 审阅合并。

---

### 任务 2：部署、巡检与卸载恢复 (Deploy, Verify & Restore)

* **默认部署纯 CDP 零修改汉化 + 船板主题**（无需关闭客户端，2.5 秒自动热生效）：
  ```powershell
  node localization_engine.js --cdp-only --brand-title english
  ```
* **单独管理或巡检船板主题与实时遥测服务**（不重打 ASAR、不关窗）：
  ```powershell
  node localization_engine.js --theme-install   # 单独安装/热升级船板主题与 CDP 汉化服务
  node localization_engine.js --theme-verify    # CDP 实机注入状态验收（校验 dictCount 与胶囊挂载）
  node localization_engine.js --theme-doctor    # 环境、字体与 core SHA-256 完整性诊断
  node localization_engine.js --theme-uninstall # 单独停用并卸载船板主题守护服务
  ```
  *(注：个性化调整配色预设、字号或 CSS 请编辑部署后的 `~/.gemini/antigravity/theme-patch/user/` 目录，2.5 秒自动热生效)*。
* **完整还原所有本地补丁与守护服务**：
  ```powershell
  node localization_engine.js --huifu --no-kill
  ```
* **若需使用传统 ASAR / IDE 文件级补丁**（会在客户端会话内跳过关窗时附加 `--no-kill`）：
  ```powershell
  node localization_engine.js --no-kill --brand-title english
  ```
* **若用户在外部终端运行**：直接双击运行 `双击安装中文汉化.bat`（或 macOS 下 `双击安装中文汉化.command`）即可默认以 `--cdp-only` 模式完成部署；附加 `--asar` 参数可切回传统 ASAR 模式。

---

## 🔒 约束与规范

1. 严禁将修改推送到 `upstream`；所有提交必须推送到 `origin/main`。
2. 严禁修改 `theme_patch/core/` 只读内核文件（破坏 SHA-256 完整性校验），一切本地个性化调优均在 `theme_patch/user/` 完成。
3. 任何对 `localization_engine.js` 的修改，需保持与上游汉化结构及 `--cdp-only` / `--asar` 双模式的兼容性。
