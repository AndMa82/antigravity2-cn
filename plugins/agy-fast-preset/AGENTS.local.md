---
trigger: always_on
---

<!-- AG2CN_AGY_FAST_PRESET_START -->
# agy-fast 并存与增强路由预设（antigravity2-cn）

- **与 `rtk`（命令输出压缩）并存**：单条轻量命令（如单次 `git status`、`git diff`、`npm test`、构建或检查）继续优先调用原生 `run_command`（由 `rtk` 透明压缩）；仅当同轮需并发执行 `>= 2` 条独立非交互命令时改用 `run_checks`（默认 `outputMode: "compact"`），且**不要**在 `run_checks` 内再手动套用 `rtk` 前缀，避免双重折叠丢失关键报错。
- **与 `antigravity2-cn`（CDP 汉化 / 船板主题 / Token 监控）并存**：CDP 汉化仅作用于客户端视觉渲染层，不改变底层文件与工具入参；执行 `batch_search`、`quick_outline`、`apply_edits` 时始终以源码原始文本与英文标识符匹配，勿按界面中文译文搜索。可通过客户端内 **「Token 监控」**（`http://127.0.0.1:18923/`）与 `node localization_engine.js --fast-bench` 对照验证加速前后的 TTFT、缓存命中率与 Token 额度变化。
- **与多 Agent / 专用 MCP / 技能并存**：当任务涉及已挂载的专用 MCP 服务（如浏览器、Figma、Google Workspace、Context7、Godot Editor MCP 等）或显式 `SKILL.md` 流程时，优先遵循对应工具与技能约束，不用 `batch_search`/`run_checks` 强行绕过；使用 `apply_edits` 批量编辑 `>= 3` 个文件时默认传 `bestEffort: true`（单批 `<= 6-8` 文件），且动手前先确认工作区状态，严禁覆盖未提交手工改动。
- **更新与个人自定义**：本插件默认由 `antigravity2-cn --sync` 统一跟进版本（自动适配本地代理端口，已默认关闭后台直连 GitHub 轮询）；个人追加规则请写在下方结束标记之后，重装与热升级均自动保留。
<!-- AG2CN_AGY_FAST_PRESET_END -->
