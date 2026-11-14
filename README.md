# Antigravity 2.0 智能编程中文语言包 & 汉化引擎

👉 **[繁體中文版說明文件 (Traditional Chinese README)](README_TW.md)**

> **支持系统**：Windows & macOS (均已内置一键脚本)  
> **匹配版本**：Antigravity v2.28.2+  

> **核心引擎**：Node.js (>= 22，零第三方二进制入侵)  
> **汉化范围**：默认采用 **纯 CDP 零文件修改热注入模式**，完整覆盖 Antigravity 2.x 聊天区、侧边栏、设置面板、弹窗、新手引导，并集成船板昼夜主题排版与实时遥测胶囊；如需兼顾系统原生顶栏/托盘菜单与 `Antigravity IDE`，可附加 `--asar` 启用传统包注入模式。  
> **注入原理**：默认通过本机 `127.0.0.1` CDP 调试端口在渲染内存中实时汉化，**完全不修改 `app.asar` 或软件任何原版文件**，100% 保留官方数字签名并无缝兼容客户端自动更新。

> [!WARNING]
> **关于聊天历史记录/对话框内容被汉化的已知问题及匹配机制说明（开发者必读）**：
> - **现象**：当你在聊天或对话框中发送了某些与软件界面 UI 完全相同的英文关键词或句子时，该对话气泡在界面上可能会被翻译引擎汉化显示。
> - **核心匹配机制**：
>   - **短词（长度 <= 15 字符，如 `Knowledge`）**：翻译仅在词条 **完全精准匹配（且单独占一行）** 时触发。如果该词前后有其他任何字符、空格或标点符号（如 `Knowledge是什么`、`哈哈 Knowledge`），则 **绝对不会** 被翻译。如果需要强行阻止其翻译，可使用中文双引号将其包裹（如 `“Knowledge”`）即可完美规避。
>   - **长句（长度 > 15 字符，如 `Enable Antigravity to deploy apps...`）**：由于需要兼容界面动态渲染，长句采用 **“子串滑动替换”** 算法。这意味着只要输入的文本中包含了这一长串完整英文字句，该段子串就会被自动翻译成中文（即使加了引号或前后带有文字）。但由于长句匹配极其苛刻，必须一字不差（包括大小写、标点和空格），因此实际聊天中几乎不可能误触发。
> - **说明**：这**不影响 AI 接收到的原文**。大模型获取到的依旧是你发送的纯正英文原始指令，仅在软件的视觉渲染层面发生了汉化，纯属视觉影响，无需担心影响大模型的效果。
> - **欢迎提 PR**：由于 Electron 沙箱及 iframe webview DOM 树隔离问题，此处难以直接利用主窗口类名隔离，期待有缘人提交 PR 完美解决该问题！

## 📸 汉化效果展示

以下是部分功能板块的实际汉化效果展示，涵盖登录引导页、主编辑器界面与详细设置面板：

### 1. 欢迎页与登录新手引导
![欢迎页与登录新手引导](./showimg/showlogin.png)

### 2. 主编辑器界面与菜单
![主编辑器界面与菜单](./showimg/showmain.png)

### 3. 详细参数设置面板
![详细参数设置面板](./showimg/showmenu.png)

---

## 📂 项目文件结构
- **`双击安装中文汉化.bat`** / **`.command`**：Windows / macOS 一键汉化执行入口。
- **`双击卸载还原官方英文.bat`** / **`.command`**：Windows / macOS 一键完美恢复原版入口。
- **`localization_engine.js`**：核心汉化逻辑，负责 app.asar 的解包、代码注入、重新打包以及 macOS 下的自动深度重签名。
- **`dicts/`**：汉化字典文件夹，内含按模块分类的 JSON 对照翻译字典。
- **`scripts/`**：工程与自动化工具集，包含简繁词典对齐校验器 (`compare_dicts.js`)、版本升级全量界面/悬浮词条自动 Diff 扫描器 (`dev_tool.js scan-ui`) 及 MCP 基准清册 (`dev_tool.js dump-mcp`)。
- **`tools/token_monitor/`**：集成开源项目 [STARKTANG108/antigravity-token-monitor](https://github.com/STARKTANG108/antigravity-token-monitor)，提供零外部依赖 Node.js (`node:sqlite` + `node:http`) 与 Python 双引擎实时 Token 与 API 价值分析后端 (`127.0.0.1:18923`)，支持自适应移动端/侧栏窄屏布局。

---

## 📊 内置 Token 实时监控看板（应用内内置浏览器直达）

部署 `--cdp-only` 或 `--theme-install` 后，本工具会在后台守护进程中自动伴随启动本地只读遥测服务 **`http://127.0.0.1:18923`**，并在 Antigravity 客户端内无缝注入一键入口：

- **右上角顶栏「`Token 监控`」按钮** & **底部输入框旁实时指标胶囊（`tok/s · TTFT · Ctx`）**：
  - **直接点击**：自动调起 Antigravity **内置浏览器侧边栏**直接浏览实时监控看板（零弹窗、不跳出客户端）。
  - **`Shift + 点击`**：在当前窗口内以大尺寸应用内浮层预览完整宽屏图表。
  - **`Ctrl / Cmd + 点击`**：在系统默认外部浏览器中打开 `http://127.0.0.1:18923/`。
- **零侵入只读采集**：直接以 SQLite Read-Only 模式读取本地 `~/.gemini/antigravity/conversations/*.db`（含实时 `-wal` 页）与 `conversation_summaries.db`，支持 4 种 API 计费口径切换、USD/CNY 汇率切换、趋势分桶、窗口排行、最新 30 条实时调用流、CSV 导出与桌面 PNG 快照；零外部 npm/pip 依赖（基于 Node.js `>= 22.13` 内置 `node:sqlite`，低版本自动回退 Python `monitor_server.py`）。

---

## 🚀 极速使用指南

### 1. 获取汉化包代码（二选一）

* **方法 A：直接下载 ZIP 压缩包（最便捷 📦）**
  1. 点击页面右上角绿色的 **`Code`** 按钮。
  2. 在下拉菜单中选择 **`Download ZIP`** 并下载。
  3. 将下载好的压缩包**解压到您电脑本地的任意目录**（例如您的 `Downloads` 文件夹）。

* **方法 B：通过 Git 命令行克隆（开发者推荐 💻）**
  如果您本地安装了 Git，可以直接在终端运行克隆命令：
  ```bash
  # 如果您在国内，推荐使用下方代理加速克隆地址：
  git clone https://mirror.ghproxy.com/https://github.com/qqxpee/antigravity2-cn.git
  
  # 如果您配置了全局代理，可直接使用官方地址：
  git clone https://github.com/qqxpee/antigravity2-cn.git
  ```

---

### 2. 一键安装汉化（默认纯 CDP 零修改模式）
1. 进入您解压或克隆出来的 `antigravity2-cn` 文件夹：
   - **Windows**：双击运行 **`双击安装中文汉化.bat`**（支持软件开启状态下直接运行，无需退客户端）。
   - **macOS**：双击运行 **`双击安装中文汉化.command`**（无需管理员 `sudo` 权限，不破坏 `.app` 签名）。
2. 按提示选择左上角品牌显示方式：
   - **显示英文 Antigravity（默认推荐）**：保留官方品牌名，避免左上角显示过长。
   - **不显示品牌名**：隐藏左上角的品牌文字。
   - **显示中文品牌名**：保持原汉化效果，显示“反重力智能编程”。
3. 部署完成后，已打开的 Antigravity 窗口会在 **2.5 秒内自动热生效**，官方自动更新后仍持续生效！

### 命令行参数说明

如果您通过命令行运行 `localization_engine.js`，常用参数如下：

```bash
# 默认推荐（方案 A）：纯 CDP 零文件修改汉化 + 船板主题（保留英文品牌名）
node localization_engine.js --cdp-only --brand-title english

# 隐藏 / 翻译左上角品牌名
node localization_engine.js --cdp-only --brand-title hidden
node localization_engine.js --cdp-only --brand-title translated

# 巡检 CDP 实机注入状态与环境完整性诊断
node localization_engine.js --theme-verify
node localization_engine.js --theme-doctor

# 可选（传统全量模式）：修改 app.asar 与 Antigravity IDE（支持原生菜单/托盘汉化）
node localization_engine.js --asar --brand-title english
```

---

### 3. 一键卸载还原
1. **完全退出** Antigravity 编程软件。
2. 在当前文件夹下：
   - **Windows**：双击运行 **`双击卸载还原官方英文.bat`**。
   - **macOS**：双击运行 **`双击卸载还原官方英文.command`**。
3. 运行完成后，软件将自动清除所有汉化注入，无痕恢复至官方原版英文状态。

---

## 🔄 个人 Fork 维护与更新指南（含 Agent 自动化协作）

本仓库作为个人维护的增强分支，保持与官方上游汉化及船板主题的双向可维护性：

### 1. 同步上游汉化、船板主题与 Token 监控更新
通过内置多源同步引擎一键拉取 `qqxpee` / `yiheng8023` / `liominsb` / `yuexps` / `chuanban` / `token_monitor` 六源增量词条、`theme_patch/core/` 内核与 `tools/token_monitor/` 面板：
```bash
node localization_engine.js --sync --no-relocalize
```

如需合并上游 `qqxpee/antigravity2-cn` 的引擎架构提交，仍可按需使用 `git fetch upstream` 审阅合并：
```bash
git remote add upstream https://github.com/qqxpee/antigravity2-cn.git
git fetch upstream
git merge upstream/main
git push origin main
```

### 2. AI 智能体（Agent）自动化操作说明
本仓库内置了标准的 **[`AGENTS.md`](AGENTS.md)** 指南。后续您可以随时召唤 AI 助手帮您完成维护，例如：
* **“帮我同步上游最新的汉化代码与词典”** —— Agent 会自动执行 `--sync` 并热更新补充词库；
* **“巡检或修复 CDP 主题与汉化注入状态”** —— Agent 会运行 `--theme-doctor` / `--theme-verify` 诊断；
* **“将漏译词条补充到词典并生效”** —— Agent 更新 `dicts/` 后同步至 `user/i18n.override.json`（2.5 秒热生效）。

---

## 🛠️ 汉化原理说明

本引擎采用 **ASAR 包注入模式**，专为 **Antigravity 2.0+** 的 Electron 架构量身定制：
1. **自动释放锁**：脚本运行前会自动探测并安全关闭 Antigravity 进程，防止文件占用锁定。
2. **安全备份**：首次运行时，会在软件目录自动创建原始 `app.asar.bak` 文件，确保随时可无损还原。
3. **精准注入**：
   - 注入 `preload.js`：采用 WeakSet 记录与 Shadow DOM 穿透，启动高效的 `MutationObserver` 引擎，动态监测并将渲染层文本翻译为中文。
   - 注入 `menu.js`：深度补丁系统级标题栏菜单。
   - 注入 `tray.js`：汉化托盘与右键通知状态菜单。
   - 注入 `loadingOverlay.js`：注入极具极客风格的趣味加载语：“反重力引擎已启动，正在摆脱地心引力...”。

---

## 💡 如何通过 AI 助手自动补充或修改汉化？

如果在使用过程中，您发现了漏译的英文，或者觉得某些中文翻译不够接地气，**您可以直接在聊天窗口中命令您的 AI 编码助手（即 Antigravity）来帮您更新词库**！无论是直接发截图还是描述文字，AI 都会自动帮您把对照词条写进词典。

> [!IMPORTANT]
> **⚠️ AI 助手如何定位您的汉化词库文件？**
> 
> 1. **推荐做法（最省心）**：
>    在 Antigravity 软件中，点击 **“打开文件夹 (Open Folder)”**，直接将本汉化包目录（即包含当前 `README.md` 的文件夹）作为**项目/工作区**打开，然后在此工作区下与 AI 对话。此时 AI 能够直接感知并读写当前项目，您不需要提供任何路径，直接发送翻译要求，AI 就能在后台自动帮您改好词典！
> 
> 2. **免开项目做法（提示词中需指定汉化目录）**：
>    如果您当前正在开发别的项目，没有把汉化目录作为项目打开，那么您在对 AI 发起汉化命令时，**必须在提示词里明确告诉 AI 您的汉化包所在路径**，否则 AI 无法得知要修改您电脑上的哪个文件夹。
>    * **提示词示例**：
>      > **“我的汉化包目录在 `C:\Users\您的电脑用户名\Downloads\antigravity_chinese`（请替换为您本地的实际路径），请帮我把下面这张截图里漏译的内容补全到词典里。”**

### 📋 常用提示词（Prompt）模板

#### 1. 方式一：直接在聊天中发送截图（推荐 📸）
如果您不方便打字，可以直接将未汉化干净的界面截图粘贴发送给 AI，并附带以下指令：
> **“帮我把这张截图里所有未汉化的英文选项和面板内容补全到中文词典中。”**
*(AI 会自动通过视觉识别截图中的全部英文，并精准写入字典。)*

#### 2. 方式二：直接在聊天中发送文字描述（极速 ✍️）
如果您只想修改或增加某一个特定词汇，可以直接发送文字描述给 AI：
> **“帮我把漏译的英文 'Allow agent to view and edit files outside of the current workspace automatically' 汉化为 '允许智能体自动查看并编辑当前工作区之外的文件'。”**
*(AI 会立即找到对应的词典并精准修改或追加该词条。)*

---

### 🔄 更新生效流程
1. **命令 AI 更新**：在对话中通过截图或文字告诉 AI 您的汉化需求，AI 会自动更新 `dicts/` 下的字典文件。
2. **退出软件**：**完全退出**您的 Antigravity 软件。
3. **重新注入**：在当前文件夹中**再次双击运行 `双击安装中文汉化.bat` / `.command`** 重新部署汉化。
4. **重启软件**：重新打开 Antigravity，您的改动即可完美生效！

---

## 🧩 MCP 官方服务器汉化与自助更新指南 (欢迎社区共建)

Antigravity 2.x 的“**添加 MCP 服务器 (Add MCP Server)**”市场目录是由 Google 云端通过 RPC 动态实时下发的。官方经常在各个小版本更新中新增、下线或变更 MCP 服务器描述。

由于项目维护者平时主要关注核心界面交互，不一定会时刻盯盘官方云端 MCP 市场的变动，**任何关心 MCP 汉化的用户或开发者，均可通过内置的自动化探针随时自助抓取并提交 PR，无需等待作者手动同步！**

### 📌 极简更新流程（小白/普通用户首选 🖱️）
1. 在 Antigravity 中点击打开 **“添加 MCP 服务器 (Add MCP Server)”** 弹窗。
2. 汉化引擎已内置**自动化探针**，待数据加载完成后，搜索框下方会自动弹出绿色徽标：
   > `✓ 已自动捕获 XX 个 MCP 服务器（点击复制 JSON）`
3. 鼠标点击该徽标，即可将官方全量未截断的 MCP 元数据 JSON 复制到剪贴板。
4. 将复制出的 JSON 发送给您的 AI 助手（Antigravity），附带以下指令：
   > **“这是从最新版 Antigravity 导出的官方 MCP 清单，请帮我检查并把所有新增或未汉化的描述补全到 `dicts/page_mcp_knowledge.json` 和 `dicts_tw/page_mcp_knowledge.json` 中。”**
5. AI 完成翻译后，在终端执行 `node scripts/compare_dicts.js` 确保简繁 100% 对齐。
6. 重新运行安装脚本即可立即生效；欢迎将更新提交 Pull Request，共同维护最新的中文 MCP 词库！

> 💡 **提示**：高级开发者如需通过命令行直接与客户端 RPC 交互或执行基准 Diff 诊断，可直接查阅 [`scripts/dev_tool.js`](scripts/dev_tool.js) 顶部的命令说明。

---

## 📝 词典自定义指南 (供极客手动使用)

如果您想手动修改翻译，可以直接打开 `dicts/` 目录下的 JSON 文件：
- **`common.json`**：公共基础词汇、侧边栏概览、登录页、常用按钮等。
- **`page_settings.json`**：包含极其丰富的详细设置面板、权限二级菜单对照。
- **`menu_nav.json`**：系统及菜单栏翻译。

在 JSON 中新增一行，格式如下即可（注意英文逗号）：
```json
"Original English Text": "您的中文翻译"
```
保存后，双击运行 **`双击安装中文汉化.bat` / `.command`** 重新部署汉化即可。

---

## 常见问题解答 (FAQ)

### 1）提示“解包失败”或缺少 npm 环境
* **原因**：汉化引擎依赖 Node.js 进行 ASAR 包的解析。
* **解决**：由于 Antigravity 本身就是一个基于 Node.js/Electron 的程序，您的电脑一般都已自带环境。如果极少数情况下报错，只需在电脑安装 [Node.js](https://nodejs.org/)（LTS 版本即可）并重启脚本。

### 2）提示“权限不足”或 macOS 提示“无法打开”
* **解决**：
  - **Windows**：请右键点击 `双击安装中文汉化.bat`，选择 **“以管理员身份运行”**。
  - **macOS**：若双击运行 `.command` 提示无法打开或没有执行权限，可在终端中执行 `chmod +x *.command` 来授权。如果是系统安全拦截，请在“系统设置 -> 隐私与安全性”中点击“仍要打开”。本汉化包已内置自动重签名机制，修改后会重新进行 Ad-hoc 签名以防止 macOS 提示应用损坏。

### 3）软件官方更新后，汉化失效了怎么办？
* 默认使用的 **纯 CDP 零修改模式** 不改动 `app.asar` 与应用签名，官方自动升级后守护服务仍会自动对新版窗口注入中文，通常**无需任何人工操作**（若希望同步上游最新词条，运行一次 `node localization_engine.js --sync` 或重新双击安装脚本即可）。
* 若您手动选择了传统 `--asar` 模式，则软件升级覆盖 `app.asar` 后重新双击运行安装脚本或等待自愈守护恢复即可。

---

## 🤝 致谢
- 感谢所有参与测试与反馈的贡献者！
- 特别鸣谢 **[Anarcadia/chuanban-antigravity-theme-patch](https://github.com/Anarcadia/chuanban-antigravity-theme-patch)** 提供优秀的纯 CDP 昼夜主题、实时遥测与无侵入内存注入架构。
- 特别鸣谢 **[yiheng8023/antigravity-chinese](https://github.com/yiheng8023/antigravity-chinese)** 开放的词典成果（MIT 协议），为本次 v2.26.0+ 新增特性词条整合提供了重要基础。
