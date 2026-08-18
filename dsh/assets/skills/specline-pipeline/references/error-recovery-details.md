# Hook 约束与速查表参考

## Purpose

本文档提供 Specline Pipeline 的 Hook 约束体系说明和关键约束速查表，供编排者在遇到 Hook 阻断、阶段不匹配等场景时查阅。内容对应原 SKILL.md 的附录 D（Hook 约束体系）和附录 E（关键约束速查表）。

## Hook 约束体系

Specline 通过 Cursor Hooks 提供了三层自动约束，确保在长对话中 Agent 不偏离流水线逻辑：

```
sessionStart   → specline-session-start.sh
                 新会话启动时检测活跃 pipeline，自动注入阶段上下文到 Agent 系统提示

preToolUse     → specline-phase-guard.sh
                 操作前检查：SPEC 阶段拦截代码编辑、阶段不匹配的子Agent 启动

postToolUse    → specline-reminder.sh
                 关键操作后注入提醒：更新 tasks.md checkbox、运行 Gate 脚本
```

### 对编排者的影响

1. **总是先检查** - preToolUse 会阻止不匹配当前阶段的操作，所以你在行动前自然会考虑阶段
2. **被提醒下一步** - postToolUse 在子Agent完成后提醒你更新 checkbox 和运行 Gate
3. **非流水线会话无影响** - 所有 Hook 的第一步检查「是否有活跃 pipeline」，无则透明放行

### 约束策略表

| 场景 | 策略 | 原因 |
|------|------|------|
| SPEC 阶段编辑代码文件 | **硬拦截 (deny)** | 明确违规 |
| SPEC 阶段启动编码 Agent | **硬拦截 (deny)** | 阶段不匹配 |
| CODING 阶段直接编辑代码 | **软提醒 (postToolUse)** | Hook 无法区分编排者和子Agent的 Write |
| 子Agent完成后忘记 Gate | **软提醒 (postToolUse)** | 操作后注入下一步提醒 |

> 注意：CODING 阶段 Orchestrator 直接编辑代码文件不会被 Hook 硬拦截（因为子Agent 也需要 Write 权限），但 SKILL 指令和 sessionStart 注入的上下文会持续提醒你「编码应通过子 Agent」。如果你发现自己想直接编辑代码，停一下，改用 Task 工具。

## 关键约束速查表

| # | 约束 | 说明 |
|---|------|------|
| 1 | **不做判断，只做编排** | 不评估代码质量、需求好坏、测试覆盖——这些由子 Agent 和 Gate 脚本负责 |
| 2 | **所有门禁通过 Gate 脚本** | 调用 `specline gate`，不要自己写 grep/检查逻辑 |
| 3 | **状态文件是唯一真相源** | 所有决策基于 `.pipeline-state.json` 的当前值 |
| 4 | **人工确认点必须尊重策略** | 根据 `pipeline.human_gate_policy` 配置决定是否暂停，不要无条件跳过或强制暂停 human_gate |
| 5 | **测试 Agent 必须黑盒** | 不给 specline-test-writer 传递源代码文件路径 |
| 6 | **Hook 阻断绝不静默降级** | 子 Agent 被 hook 阻止时，必须先诊断、沟通、修复后重试 |
| 7 | **接受 Hook 约束** | preToolUse/postToolUse/sessionStart Hook 会自动校验和提醒，不要试图绕过 |
