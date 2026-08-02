# 使用本地 Draw.io Diagram

本功能用于需要 GUI 手工编辑、再由 Agent 读取和增量修改的复杂关系图。
简单、即时的关系优先使用 ASCII；单文件 HTML 原型仍使用 Visualize。
Diagram 是沟通 artifact，不会自动回写 proposal、design 或 spec。

Specline 只做便利入口：画图由上游 `@next-ai-drawio/mcp-server` 完成。
不再使用受管 runtime、`specline diagram` CLI，或 plan/install/doctor/releaseGate 流程。

## 何时用 Diagram

| 目标 | 使用方式 |
| --- | --- |
| 简单、瞬时、无需 GUI 编辑的关系 | Explore 中直接画 ASCII |
| 页面 mockup、交互原型或可携带演示 | `/specline-visualize` |
| 复杂架构、流程、状态或依赖，且需要 GUI 手工编辑 | `/specline-diagram` |

## 日常画图（MCP 已可用）

1. 在 Agent 中调用 `/specline-diagram`，或自然语言说明要画可编辑关系图。
2. Skill 确认不是 Visualize / 纯 ASCII 场景后，直接调用上游 MCP 工具：
   - `start_session`
   - `create_new_diagram` 或 `load_diagram`
   - `edit_diagram`
   - 浏览器本地预览
   - 需要时 `export_diagram`
3. 推荐把产物放在约定目录（不强制伴随 Markdown 元数据）：

```text
specline/diagrams/<slug>/<slug>.drawio
```

仅当明确关联已有 change 时，才使用 `specline/changes/<change>/diagrams/<slug>/`。

4. 若 MCP 调用失败，继续当前任务并用 ASCII；不要尝试 `specline diagram ...`（该命令已删除）。

## 首次 setup（会话中没有 drawio MCP）

1. Skill 检测当前会话缺少上游 drawio MCP 工具。
2. 向你说明将配置：

```text
npx @next-ai-drawio/mcp-server@latest
```

3. **询问落点**（必须二选一；默认推荐用户级）：
   - **用户级（推荐）**：例如 Cursor 的 `~/.cursor/mcp.json`，一次配置可跨项目复用。
   - **项目级（可选）**：例如 `.cursor/mcp.json`，仅当前仓库生效，便于团队共享配置。
4. 你确认后，Skill（或极薄 helper）**只写入当前平台**的 MCP 配置，并：
   - upsert 上游 `drawio`（或平台允许的等价键）条目；
   - 移除旧受管 `specline-diagram` 条目（例如 command 指向 `specline diagram mcp`），避免双 MCP。
5. **重载 Agent 一次**。不承诺热重载；重载前工具通常仍不可见。
6. 重载后重新调用 `/specline-diagram`，走日常路径。

### 落点示例（Cursor）

用户级推荐写入类似：

```json
{
  "mcpServers": {
    "drawio": {
      "command": "npx",
      "args": ["@next-ai-drawio/mcp-server@latest"]
    }
  }
}
```

Claude Code / Codex / OpenCode 的配置文件路径与键名按各平台约定；首次在该平台调用 diagram 时各自走一遍 setup。`specline init` / `specline sync` **不会**静默写入任何平台的 drawio MCP。

### 拒绝写入时

若不希望修改 MCP 配置，直接拒绝即可。配置文件不会被改动；可改用 ASCII，或稍后再做 setup。

## 可选清理旧受管 runtime

删除受管控制面后，本机可能仍残留：

```text
~/.specline/runtimes/drawio/
```

这与画图能力无关。若要释放磁盘，可手动删除该目录。  
**不要**删除 `specline/diagrams/` 或 change 下的 diagram 产物；那些文件会保留，也不会被 Specline 强制清理。

## 与 Explore / Visualize 的边界

- Explore 可建议 Diagram；同意后交给 `/specline-diagram`（缺 MCP 时由其内含 setup 处理）。Explore 不再要求交接 YAML、planDigest 或 releaseGate 念经。
- Visualize 仍只产出自包含单文件 HTML；不要用 Diagram 代替。
- 图完成后不会自动改写 proposal / design / spec。

## 相关文档

- 简要合同与边界：[docs/diagram-runtime.md](../../diagram-runtime.md)
- 决策记录：[Diagram 改为上游 MCP 便利入口](../decisions/2026-08-03-diagram-upstream-mcp-convenience.md)
- 已 supersede：[本地 Draw.io Diagram Skill 与 fail-closed release gate](../decisions/2026-08-02-local-drawio-diagram-skill.md)
