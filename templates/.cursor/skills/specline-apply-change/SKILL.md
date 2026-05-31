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

6. **Implement tasks (loop until done or blocked)**

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

7. **On completion or pause, show status**

   Display:
   - Tasks completed this session
   - Overall progress: "N/M tasks complete"
   - If all done: suggest archive
   - If paused: explain why and wait for guidance

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

**Guardrails**
- Keep going through tasks until done or blocked
- Always read context files before starting (from the apply instructions output)
- If task is ambiguous, pause and ask before implementing
- If implementation reveals issues, pause and suggest artifact updates
- Keep code changes minimal and scoped to each task
- Update task checkbox immediately after completing each task
- Pause on errors, blockers, or unclear requirements - don't guess
- Use contextFiles from CLI output, don't assume specific file names
- **Hook blocked → no silent fallback**: If this skill is invoked because a coding subagent (specline-frontend-dev / specline-backend-dev) was blocked by a hook, you MUST first notify the user of the blocking cause and attempt diagnosis. Do not silently execute tasks that should have been handled by the blocked subagent. Reference the Hook Blocking Resolution Protocol in the specline-pipeline skill.

**Fluid Workflow Integration**

This skill supports the "actions on a change" model:

- **Can be invoked anytime**: Before all artifacts are done (if tasks exist), after partial implementation, interleaved with other actions
- **Allows artifact updates**: If implementation reveals design issues, suggest updating artifacts - not phase-locked, work fluidly
