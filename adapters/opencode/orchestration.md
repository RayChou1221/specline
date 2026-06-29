# OpenCode Orchestration Reference

## Tool Mapping

| Specline 抽象 | OpenCode 工具 |
|--------------|--------------|
| 派发子 Agent | task(subagent_type="general") + prompt 内嵌 |
| 用户确认 | 对话中提问 |
| Lint 检查 | bash 命令执行 linter |
| 文件读取 | read |
| 文件编辑 | apply_patch |
| Shell 执行 | bash |
| 搜索 | grep / glob |

## Notes
- OpenCode 无命名 subagent 类型，role instructions 内嵌在 prompt 中
- Skills 通过 plugin.js 注册 .opencode/skills/ 路径
- Bootstrap 通过 experimental.chat.messages.transform hook 注入
