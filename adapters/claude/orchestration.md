# Claude Code Orchestration Reference

## Tool Mapping

| Specline 抽象 | Claude Code 工具 |
|--------------|-----------------|
| 派发子 Agent | Agent 工具 / plugin agents |
| 用户确认 | 对话中提问 |
| Lint 检查 | bash 命令执行 linter |
| 文件读取 | Read |
| 文件编辑 | Write / Edit |
| Shell 执行 | bash |
| 搜索 | grep / find |

## Notes
- Claude Code 支持项目级 agents（.claude/agents/*.md）
- Hook 通过 .claude/settings.json 的 hooks 段配置
