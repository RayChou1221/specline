---
name: specline-propose
description: >-
  生成 Spec 规划文件（proposal/design/tasks/spec）。根据自然语言需求，
  直接按内联模板创建全部 Artifact，不依赖外部 CLI。
---

根据用户自然语言需求，在 `specline/changes/<change-name>/` 下生成完整规划文件。

**Input**: 用户需求描述（自然语言），由编排者传入 change-name。

**Steps**

1. **理解需求并推导 change name**

   如果编排者没有传入明确的 change name，从需求描述推导 kebab-case 名称（如 "添加用户登录功能" → `add-user-login`）。

2. **创建 Change 目录**

   ```bash
   specline-pipeline-gate.sh new --change "<name>"
   ```

   创建 `specline/changes/<name>/` 目录及必要的元数据文件。

3. **按顺序生成 4 个 Artifact**

   | 顺序 | Artifact | 路径 | 内容要点 |
   |------|----------|------|---------|
   | 1 | proposal.md | `specline/changes/<name>/proposal.md` | What/Why/Scope/Non-goals |
   | 2 | spec.md | `specline/changes/<name>/specs/<capability>/spec.md` | Purpose/Requirements/Scenarios（WHEN/THEN） |
   | 3 | design.md | `specline/changes/<name>/design.md` | Architecture/Decisions/DataFlow |
   | 4 | tasks.md | `specline/changes/<name>/tasks.md` | Type/Depends/Covers/Files 标注 |

   **每个 Artifact 的创建规则**：

   - **proposal.md**：描述 What（做什么）/ Why（为什么做）/ Scope（包含和不包含的范围）/ Impact（影响哪些系统）

   - **spec.md**：H1 标题含 "Specification"，包含 `## Purpose` 和 `## Requirements`，每个 Requirement 至少 1 个 Scenario，每个 Scenario 含 `**WHEN**`/`**THEN**` 配对，至少覆盖 Happy Path 和 1 个异常场景

   - **design.md**：包含 Architecture、Key Design Decisions（每项说明选择理由和替代方案）、Data Flow、组件/模块交互

   - **tasks.md**：每个任务必须标注：
     - **Type**: frontend | backend | infra | db | config | docs
     - **Depends**: (none) | 依赖的任务编号
     - **Covers**: Requirement: xxx, Scenario: xxx
     - **Files**: 任务涉及的文件路径列表

     任务拆分原则：
     - 按功能领域垂直拆分（前/后端分开）
     - `Depends: (none)` 占比 ≥ 60%
     - 第 1 批次（无依赖任务）的 Files 集合互不重叠

4. **验证完整性**

   ```bash
   specline-pipeline-gate.sh artifacts --change "<name>" --json
   ```

   确保 proposal/design/tasks/specs 四个文件都已存在。

5. **并行度自检**

   统计 tasks.md 中 `Depends: (none)` 的任务占比：
   - ≥ 60% → 通过
   - < 60% → 重新拆解（最多 2 次），仍不达标则记录警告

**Output**

完成摘要：
- Change 名称和位置
- 4 个文件生成确认
- 任务统计（总数 N、独立任务 M、并行度 M/N）

**Guardrails**
- 所有文件直接写入 `specline/changes/<name>/`，不调用外部 CLI
- 先读已有 dependency 再生成后续文件
- 需求不明确时用结构化提问（AskUserQuestion）澄清
- 优先做出合理判断保持节奏，只在关键不清时询问
- **Hook 阻断不降级**：如果本 Skill 因 `specline-spec-creator` 子 Agent 被 hook 阻止而作为降级方案被调用，必须首先通知用户阻断原因，并尝试诊断修复（参考 specline-pipeline SKILL 中的 Hook 阻断处理规范）。不得在 hook 问题未解决时静默直接执行
