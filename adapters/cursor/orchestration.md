# Cursor Orchestration Reference

## Tool Mapping

| Specline 抽象 | Cursor 工具 |
|--------------|------------|
| 派发子 Agent | `Task(subagent_type="<role>")` |
| 用户确认 | `AskUserQuestion` |
| Lint 检查 | `ReadLints` |
| 文件读取 | `Read` |
| 文件编辑 | `Write` / `StrReplace` |
| Shell 执行 | `Shell` |
| 搜索 | `Grep` / `Glob` |

## Notes
- Cursor 支持命名 subagent 类型，直接映射到 .cursor/agents/*.md
- SessionStart hook 通过 .cursor/hooks.json 配置
