---
name: specline-archive-change
description: Archive a completed change in the experimental workflow. Use when the user wants to finalize and archive a change after implementation is complete.
license: MIT
compatibility: Compatible with specline.
metadata:
  author: specline
  version: "1.0"
  generatedBy: "1.3.1"
---

## TL;DR (Layer 1)

> **一句话**：归档已完成的 Specline change。
> **入口**：`/specline-archive-change [change-name]`
> **流程**：选 change → 检查完成度 → Delta spec sync 决策 → 移动目录 → 完成

### 归档前后目录结构变化

```
归档前 (活跃、可修改)              归档后 (只读、可追溯)

specline/changes/                  specline/changes/
├── my-change/          ──▶       ├── archive/
│   ├── proposal.md               │   └── 2026-06-01-my-change/
│   ├── design.md                 │       ├── proposal.md
│   ├── tasks.md                  │       ├── design.md
│   └── specs/                    │       ├── tasks.md
                                  │       └── specs/
```

**Input**: Optionally specify a change name. If omitted, check if it can be inferred from conversation context. If vague or ambiguous you MUST prompt for available changes.

---

## Steps (Layer 2 — Happy Path)

1. **If no change name provided, prompt for selection**

   Run `specline gate list --json` to get available changes. Use {{CONFIRM}} to let the user select.

   Show only active changes (not already archived).
   Include the schema used for each change if available.

   **IMPORTANT**: Do NOT guess or auto-select a change. Always let the user choose.

2. **Check artifact completion status**

   Run `specline gate artifacts --change "<name>" --json` to check artifact completion.

   Parse the JSON to understand:
   - `schemaName`: The workflow being used
   - `artifacts`: List of artifacts with their status (`done` or other)

   **If any artifacts are not `done`:**
   - Display warning listing incomplete artifacts
   - Use {{CONFIRM}} to confirm user wants to proceed
   - Proceed if user confirms

3. **Check task completion status**

   Read the tasks file (typically `tasks.md`) to check for incomplete tasks.

   Count tasks marked with `- [ ]` (incomplete) vs `- [x]` (complete).

   **If incomplete tasks found:**
   - Display warning showing count of incomplete tasks
   - Use {{CONFIRM}} to confirm user wants to proceed
   - Proceed if user confirms

   **If no tasks file exists:** Proceed without task-related warning.

4. **Assess delta spec sync state**

   **决策流程：**

   ```
   Delta specs 存在？
   ├── 否 → 直接归档
   └── 是 → 比较 delta spec 与 main spec
              ├── 无差异 → 「已同步」→ 直接归档
              └── 有差异 → 展示变更摘要 → 询问用户
                            ├── 同步 → 执行 sync → 归档
                            └── 跳过 → 归档
   ```

   Check for delta specs at `specline/changes/<name>/specs/`. If none exist, proceed without sync prompt.

   **If delta specs exist:**
   - Compare each delta spec with its corresponding main spec at `specline/specs/<capability>/spec.md`
   - Determine what changes would be applied (adds, modifications, removals, renames)
   - Show a combined summary before prompting

   **Prompt options:**
   - If changes needed: "Sync now (recommended)", "Archive without syncing"
   - If already synced: "Archive now", "Sync anyway", "Cancel"

   If user chooses sync, {{DISPATCH}}，role="general-purpose"，prompt: "Use Skill tool to invoke specline-sync-specs for change '<name>'. Delta spec analysis: <include the analyzed delta spec summary>". Proceed to archive regardless of choice.

5. **Perform the archive**

   Create the archive directory if it doesn't exist:
   ```bash
   mkdir -p specline/changes/archive
   ```

   Generate target name using current date: `YYYY-MM-DD-<change-name>`

   **Check if target already exists:**
   - If yes: Fail with error, suggest renaming existing archive or using different date
   - If no: Move the change directory to archive

   ```bash
   specline gate archive --execute --change <name>
   ```

6. **Display summary**

   Show archive completion summary including:
   - Change name
   - Schema that was used
   - Archive location
   - Whether specs were synced (if applicable)
   - Note about any warnings (incomplete artifacts/tasks)

### Output On Success

```
## Archive Complete

**Change:** <change-name>
**Schema:** <schema-name>
**Archived to:** specline/changes/archive/YYYY-MM-DD-<name>/
**Specs:** ✓ Synced to main specs (or "No delta specs" or "Sync skipped")

All artifacts complete. All tasks complete.
```

---

## Guardrails (Layer 3 — 高级话题)

- Always prompt for change selection if not provided
- Use artifact graph (specline gate artifacts --json) for completion checking
- Don't block archive on warnings - just inform and confirm
- Preserve .specline.yaml when moving to archive (it moves with the directory)
- Show clear summary of what happened
- If sync is requested, use specline-sync-specs approach (agent-driven)
- If delta specs exist, always run the sync assessment and show the combined summary before prompting

---

## Anti-Rationalization 表格

归档是流水线的最后一步，松懈的代价是污染长期记录：

| 借口 | 现实 |
|------|------|
| "不用检查完成度，反正用户说可以归档了" | 用户说可以不代表真的可以。Artifact 和 task 完成度检查是归档前的最后防线。 |
| "Delta spec 不用同步，下次再说" | 未同步的 Delta spec 意味着 spec 与代码脱节。归档后几乎不会再有人回来补。 |
| "归档就是移动目录，不需要通知用户" | 归档改变了 change 的可见性和可修改性。用户需要知道发生了什么。 |
| "警告不用管，自动继续就行" | 警告（artifact 不完整、task 未完成）是信号。归档时应确认而非忽略。 |

## Verification Checklist

归档前自查：

- [ ] Artifact 完成度已检查（`specline gate artifacts --json`）
- [ ] Task 完成度已检查（tasks.md checkbox 状态）
- [ ] 任何警告/不完整项已向用户确认
- [ ] Delta spec sync 决策已完成（存在则展示摘要→询问；不存在则跳过）
- [ ] 归档目录已创建（`specline/changes/archive/YYYY-MM-DD-<name>/`）
- [ ] 归档摘要已展示给用户
