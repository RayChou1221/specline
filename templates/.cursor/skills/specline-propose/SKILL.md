---
name: specline-propose
description: >-
  生成 Spec 规划文件（proposal/design/tasks/spec）。根据自然语言需求，
  直接按内联模板创建全部 Artifact，不依赖外部 CLI。
---

## Layer 1: TL;DR

> **一句话**：根据自然语言需求生成完整的 Spec 规划文件。
> **入口**：`/specline-pipeline <需求>` 或由编排者通过 Task 工具派发
> **产出**：proposal.md / design.md / tasks.md / spec.md
> **耗时**：约 30 秒 - 2 分钟

**核心流程**：`需求 → 推导 change-name → 创建目录 → 生成 4 Artifact → 自检`

**最终生成的文件结构**：

```
specline/changes/<change-name>/
├── proposal.md          ← What & Why & Scope
├── design.md            ← Architecture & Decisions
├── tasks.md             ← 实现清单（含依赖 DAG）
└── specs/
    └── <capability>/
        └── spec.md      ← Requirements & Scenarios
```

---

## Layer 2: Happy Path

**Input**: 用户需求描述（自然语言），由编排者传入 change-name。

### Step 1: 理解需求并推导 change name

如果编排者没有传入明确的 change name，从需求描述推导 kebab-case 名称（如 "添加用户登录功能" → `add-user-login`）。

### Step 2: 创建 Change 目录

```bash
specline-pipeline-gate.sh new --change "<name>"
```

创建 `specline/changes/<name>/` 目录及必要的元数据文件。

### Step 3: 按顺序生成 4 个 Artifact

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

  > 💡 **并行度自检**：统计 tasks.md 中 `Depends: (none)` 的任务占比 — ≥ 60% 通过，< 60% 则重新拆解（最多 2 次），仍不达标则记录警告。

### Step 4: 验证完整性

```bash
specline-pipeline-gate.sh artifacts --change "<name>" --json
```

确保 proposal/design/tasks/specs 四个文件都已存在。

### Step 5: 输出完成摘要

- Change 名称和位置
- 4 个文件生成确认
- 任务统计（总数 N、独立任务 M、并行度 M/N）

---

## Layer 3: 规范详解

### tasks.md 拆分规范

✅ **好的任务拆分**：

```markdown
## 1. 数据模型 [x]
- Type: backend
- Depends: (none)
- Files: server/models/user.py
- Covers: Requirement: 用户数据模型
```

> 任务粒度适中，Files 范围明确，Covers 可追溯到具体 Requirement。

❌ **不好的任务拆分**：

```markdown
## 1. 实现后端 [ ]
- Type: backend
- Files: server/*.py
```

> 太粗：Files 范围太大，没有 Covers 追溯链，Depends 缺失导致无法判断批次。

---

### 关键原则速查

| 原则 | 说明 |
|------|------|
| 垂直拆分 | 按功能领域分（前/后端分开），不按技术层分 |
| 独立可测 | 每个任务可独立验证完成状态 |
| 文件不交叠 | 第 1 批次（Depends: none）任务的文件集合无交集 |
| 可追溯 | 每个任务必须通过 Covers 追溯到具体 Requirement/Scenario |

---

### Guardrails

- 所有文件直接写入 `specline/changes/<name>/`，不调用外部 CLI
- 先读已有 dependency 再生成后续文件
- 需求不明确时用结构化提问（AskUserQuestion）澄清
- 优先做出合理判断保持节奏，只在关键不清时询问
- **Hook 阻断不降级**：如果本 Skill 因 `specline-spec-creator` 子 Agent 被 hook 阻止而作为降级方案被调用，必须首先通知用户阻断原因，并尝试诊断修复（参考 specline-pipeline SKILL 中的 Hook 阻断处理规范）。不得在 hook 问题未解决时静默直接执行
