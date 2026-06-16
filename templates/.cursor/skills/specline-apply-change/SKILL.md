---
name: specline-apply-change
description: Implement tasks from a Specline change. Use when the user wants to start implementing, continue implementation, or work through tasks.
license: MIT
compatibility: Compatible with specline.
metadata:
  author: specline
  version: "1.0"
  generatedBy: "1.3.1"
---

Implement tasks from a Specline change.

**Input**: Optionally specify a change name. If omitted, check if it can be inferred from conversation context. If vague or ambiguous you MUST prompt for available changes.

## 速览 (Layer 1)

> **一句话**：实现 Specline change 中的编码任务。
> **入口**：`/specline-apply-change [change-name]` 或直接说「继续实现」
> **流程**：选 change → 读上下文 → 逐任务实现 → 标记完成

> ⚠️ **人机门禁策略感知**：当调用方传递了 `HUMAN_GATE_POLICY=minimal` 或 `HUMAN_GATE_POLICY=none` 上下文时，本 Skill 内所有的 `AskUserQuestion` 交互应自动采用默认安全选项：
> - change 选择 → 若上下文中已有 change name，直接使用；否则取第一个活跃 change
> - 其他确认交互 → 自动采用默认安全选项继续，不暂停等待人工输入

**Fluid Workflow Integration**

This skill supports the "actions on a change" model:
- **Can be invoked anytime**: Before all artifacts are done (if tasks exist), after partial implementation, interleaved with other actions
- **Allows artifact updates**: If implementation reveals design issues, suggest updating artifacts - not phase-locked, work fluidly

**开始前请确认：**
- [ ] Change 已选中（`/specline-pipeline --change <name>`）
- [ ] 已读取 proposal.md（知道做什么）
- [ ] 已读取 spec.md（知道需求和场景）
- [ ] 已读取 design.md（知道技术决策）
- [ ] 已读取 tasks.md（知道实现清单）

## 详细步骤 — Happy Path (Layer 2)

**Steps**

1. **Select the change**

   If a name is provided, use it. Otherwise:
   - Infer from conversation context if the user mentioned a change
   - Auto-select if only one active change exists
   - If ambiguous, run `specline-pipeline-gate.sh list --json` to get available changes and use the **AskUserQuestion tool** to let the user select

   Always announce: "Using change: <name>" and how to override (e.g., `/specline-pipeline --change <other>`).

2. **Check status to understand the schema**
   ```bash
   specline-pipeline-gate.sh artifacts --change "<name>" --json
   ```
   Parse the JSON to understand:
   - `schemaName`: The workflow being used (e.g., "spec-driven")
   - Which artifact contains the tasks (typically "tasks" for spec-driven, check status for others)

3. **Read context files**

   Read the planning files at `specline/changes/<name>/`:
   - `proposal.md` — what & why
   - `specs/<capability>/spec.md` — requirements & scenarios
   - `design.md` — architecture & decisions
   - `tasks.md` — implementation checklist

   Check task completion: count `- [ ]` (incomplete) vs `- [x]` (complete).

4. **Show current progress**

   Display:
   - Progress: "N/M tasks complete"
   - Remaining tasks overview

5. **Implement tasks (loop until done or blocked)**

   For each pending task:
   - Show which task is being worked on
   - Make the code changes required
   - Keep changes minimal and focused
   - Mark task complete in the tasks file: `- [ ]` → `- [x]`
   - Continue to next task

   **Pause if:**
   - Task is unclear → ask for clarification
   - Implementation reveals a design issue → suggest updating artifacts
   - Error or blocker encountered → report and wait for guidance
   - User interrupts

6. **On completion or pause, show status**

   Display:
   - Tasks completed this session
   - Overall progress: "N/M tasks complete"
   - If all done: suggest archive
   - If paused: explain why and wait for guidance

## 输出模板 & 高级话题 (Layer 3)

### 输出模板

**Output During Implementation**

```
## Implementing: <change-name> (schema: <schema-name>)

Working on task 3/7: <task description>
[...implementation happening...]
✓ Task complete

Working on task 4/7: <task description>
[...implementation happening...]
✓ Task complete
```

**Output On Completion**

```
## Implementation Complete

**Change:** <change-name>
**Schema:** <schema-name>
**Progress:** 7/7 tasks complete ✓

### Completed This Session
- [x] Task 1
- [x] Task 2
...

All tasks complete! Ready to archive this change.
```

**Output On Pause (Issue Encountered)**

```
## Implementation Paused

**Change:** <change-name>
**Schema:** <schema-name>
**Progress:** 4/7 tasks complete

### Issue Encountered
<description of the issue>

**Options:**
1. <option 1>
2. <option 2>
3. Other approach

What would you like to do?
```

### Guardrails
- Keep going through tasks until done or blocked
- Always read context files before starting (from the apply instructions output)
- If task is ambiguous, pause and ask before implementing
- If implementation reveals issues, pause and suggest artifact updates
- Keep code changes minimal and scoped to each task
- Update task checkbox immediately after completing each task
- Pause on errors, blockers, or unclear requirements - don't guess
- Use contextFiles from CLI output, don't assume specific file names
- **Hook blocked → no silent fallback**: If this skill is invoked because a coding subagent (specline-frontend-dev / specline-backend-dev) was blocked by a hook, you MUST first notify the user of the blocking cause and attempt diagnosis. Do not silently execute tasks that should have been handled by the blocked subagent. Reference the Hook Blocking Resolution Protocol in the specline-pipeline skill.

---

## Anti-Rationalization 表格

逐任务实现时，Agent 容易偏离规范：

| 借口 | 现实 |
|------|------|
| "不用读 Spec/Design/Tasks，我理解需求" | 记忆不可靠。实现前读上下文文件是防止方向偏离的最便宜保险。 |
| "顺便把这个相邻函数也重构了" | Scope Discipline 是 Core Behaviors。越界修改让 Code Review 和回溯都变困难。 |
| "checkbox 我最后一起标记" | Checkbox 是断点续跑的唯一信号源。不及时标记意味着下次恢复时状态丢失。 |
| "这个任务没有测试也没关系，下一个任务会补" | 每个 Testable=true 的任务必须产出测试。推迟 = 不写。 |
| "tasks.md 的 Covers 追溯链我不用管，代码写对就行" | Covers 链是 Spec → Code 的可追溯纽带。不维护它，Code Review 和测试失败定位都失去锚点。 |

## Verification Checklist

每完成一个任务后自查，全部完成后终查：

- [ ] 开始前已读 proposal.md / spec.md / design.md / tasks.md
- [ ] 每个任务的实现范围未超出 Files 声明
- [ ] 每个 Testable=true 的任务产出了测试文件（在 tests/unit/ 或 tests/models/）
- [ ] tasks.md 中每个已完成任务的 `[ ]` 已改为 `[x]`
- [ ] task-{id}-result.json 已写入 .tmp/ 目录
- [ ] 本 session 修改的文件与 tasks.md 的 Files 声明一致
- [ ] 未修改其他任务负责的文件

### 暂停场景处理

当实现过程中出现以下情况时，暂停并等待用户指引：
- 任务描述不清晰 → 请求用户澄清
- 实现中暴露出设计问题 → 建议更新 Artifact（proposal / spec / design / tasks）
- 遇到错误或阻塞 → 报告具体问题并等待指导
- 用户主动中断 → 记录当前进度，下次可从断点继续
