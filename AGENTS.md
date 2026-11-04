# AGENTS.md — 仓库维护与智能协作指南

本指南供所有在此仓库中工作的 AI 智能体（Agent）及开发者参考，详细说明了本仓库的架构定位、常用运维任务及自动化标准流程。

---

## 📌 仓库定位与架构

- **当前仓库 (Origin)**: `https://github.com/AndMa82/antigravity2-cn.git`（个人维护版本）
- **上游仓库 (Upstream)**: `https://github.com/qqxpee/antigravity2-cn.git`（汉化官方源项目）
- **核心增强特性**:
  - 预集成 Windows 免 TUN 透明代理模块 (`proxy_config/`)，基于开源项目 [yuaotian/antigravity-proxy](https://github.com/yuaotian/antigravity-proxy)。
  - 包含 `proxy_config/version.dll` 与 `proxy_config/config.json`。
  - Windows 环境下双击安装脚本时，汉化引擎 [`localization_engine.js`](localization_engine.js) 会自动识别并连同汉化补丁一并注入到 Antigravity 安装目录。
  - macOS 环境下保持 100% 纯净汉化安装（macOS 直接使用系统代理/TUN，不加载 Windows DLL）。

---

## 🛠️ Agent 常见操作流程（任务清单）

### 任务 1：同步上游汉化更新 (Sync with Upstream)

当上游汉化项目（`qqxpee`）发布新词典或修复汉化问题时，Agent 执行以下标准流程：

```powershell
# 1. 检查 remote 是否包含 upstream，如无则添加
git remote get-url upstream 2>$null || git remote add upstream https://github.com/qqxpee/antigravity2-cn.git

# 2. 获取并合并上游更新
git fetch upstream
git merge upstream/main -m "chore: 同步上游汉化最新代码"

# 3. 推送更新到个人仓库
git push origin main
```
> **注意**：由于上游仓库不存在 `proxy_config/` 目录，合并过程通常完全自动平滑，不会产生冲突。

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

在当前环境安装汉化与代理时：

* **若当前正在 Antigravity IDE 会话内运行**：必须附加 `--no-kill` 参数，避免杀死当前正在使用的 IDE 进程：
  ```powershell
  node localization_engine.js --no-kill --brand-title english
  ```
* **若用户在外部终端运行**：直接双击运行 `双击安装中文汉化.bat` 即可。

---

## 🔒 约束与规范

1. 严禁将修改推送到 `upstream`；所有提交必须推送到 `origin/main`。
2. Windows 端通过 DLL 注入代理，macOS 端保持纯净汉化，不得在 macOS 端注入任何 Windows 二进制。
3. 任何对 `localization_engine.js` 的修改，需保持与原作者汉化结构的兼容性。
