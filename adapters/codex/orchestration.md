# Codex Orchestration Reference

## Tool Mapping

| Specline 抽象 | Codex 工具 |
|--------------|-----------|
| 派发子 Agent | spawn named agent / subagent |
| 用户确认 | 对话 / CLI prompt |
| Lint 检查 | bash 命令执行 linter |
| 文件读取 | read |
| 文件编辑 | apply_patch |
| Shell 执行 | bash |
| 搜索 | grep / glob |

## Notes
- Codex 支持 named agents（.agents/agents/*.toml）
- Skills 自动扫描 .agents/skills/ 目录
- SubagentStart 不能 deny，阶段约束靠 Skill + Gate
