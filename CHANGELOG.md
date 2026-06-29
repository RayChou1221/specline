# Changelog

## 2.0.0 (unreleased)

### Breaking Changes
- Hook 硬拦截移除：preToolUse/postToolUse/subagentStart/afterFileEdit hooks 不再部署
- Gate 路径变更：`.cursor/hooks/specline-pipeline-gate.sh` → `specline gate` CLI
- Lock file schema 升级：v1 → v2（含 platforms 字段）

### Features
- 跨平台支持：Cursor / Claude Code / Codex / OpenCode
- `specline init --platform <list>` 多平台初始化
- `specline gate <subcommand>` Gate CLI 包装
- `specline hook session-start --platform <p>` 跨平台 SessionStart
- `specline platforms` 查看已部署平台
- TTY 交互式平台选择
- Lock file v2 多平台文件追踪

### Migration
- 现有 Cursor 用户：`npm update -g specline && specline sync`
- 详见 docs/migration/v1-to-v2.md
