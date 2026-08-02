# Diagram：上游 MCP 便利用法

Specline 不再提供受管 Draw.io runtime、`specline diagram` CLI，或 plan/install/doctor 仪式。
画图引擎是上游 `@next-ai-drawio/mcp-server`；Specline 只提供薄 Skill 入口与首次 MCP 配置引导。

## 日常路径

当当前 Agent 会话已能发现 drawio / 上游 MCP 工具时：

1. 调用 `/specline-diagram`（或自然语言说明要画可 GUI 编辑的关系图）。
2. 由 Skill 直接走上游工具流：`start_session` → `create_new_diagram` / `load_diagram` → `edit_diagram` → 浏览器预览 → 可选 `export_diagram`。
3. 失败时继续原工作并用 ASCII，不启动任何 Specline 受管 install。

## 首次路径（MCP 不可用）

1. Skill 检测当前会话缺少上游 MCP。
2. 说明将写入 `npx @next-ai-drawio/mcp-server@latest`。
3. 询问配置落点：推荐用户级，可选项目级。
4. 用户确认后仅写入**当前平台**；若存在旧受管 `specline-diagram` 条目则移除或替换。
5. 引导重载 Agent **一次**（不承诺热重载），然后回到日常路径。

`specline init` / `specline sync` **不会**静默写入各平台 drawio MCP。

## 产物与旧目录

- 推荐约定目录仍可用：`specline/diagrams/<slug>/`（`.drawio` 等）。图不是 Spec source of truth，不会自动回写 proposal/design/spec。
- 若本机仍残留 `~/.specline/runtimes/drawio/`，可手动删除以释放磁盘；**不会**强制清理，也**不会**删除已有 diagram 产物。

## 边界

| 目标 | 工具 |
| --- | --- |
| 简单瞬时关系 | Explore ASCII |
| 单文件 HTML 原型 | `/specline-visualize` |
| 可 GUI 编辑的 `.drawio` | `/specline-diagram` → 上游 MCP |

完整操作步骤见 [使用本地 Draw.io Diagram](knowledge/howtos/local-drawio-diagrams.md)。
产品决策见 [Diagram 改为上游 MCP 便利入口](knowledge/decisions/2026-08-03-diagram-upstream-mcp-convenience.md)。
