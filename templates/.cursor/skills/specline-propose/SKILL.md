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
| 3 | design.md | `specline/changes/<name>/design.md` | Architecture/Decisions/DataFlow/Contract |
| 4 | tasks.md | `specline/changes/<name>/tasks.md` | Type/Depends/Covers/Files 标注 |

**每个 Artifact 的创建规则**：

- **proposal.md**：描述 What（做什么）/ Why（为什么做）以及以下两段（必须显式分开）：

  **## In Scope**（做什么）：明确功能范围、涉及的系统/模块、目标用户
  
  **## Out of Scope**（不做什么）：明确排除哪些功能/场景以及排除理由。**这是提案中最有价值的部分之一**——一半的返工源于对"不做什么"的沉默分歧。明确 Out of Scope 防止需求蔓延，也保护了 In Scope 的交付承诺。

  还包括：Impact（影响哪些系统）

- **spec.md**：H1 标题含 "Specification"，包含 `## Purpose` 和 `## Requirements`，每个 Requirement 至少 1 个 Scenario，每个 Scenario 含 `**WHEN**`/`**THEN**` 配对，至少覆盖 Happy Path 和 1 个异常场景

- **design.md**：包含 Architecture Overview、Key Design Decisions（每项说明选择理由和替代方案）、Data Flow、Component Interaction、**Architecture Impact Analysis**（侵入点/模块边界/依赖方向/数据影响/接口兼容性分析，每项标注置信度 ✅/⚠️）、**对外接口契约**（如有 specline-test-writer 负责的集成/E2E 测试；CLI 命令/HTTP 端点/模块导出签名）

- **tasks.md**：每个任务必须标注：
  - **Type**: frontend | backend | infra | db | config | docs
  - **Depends**: (none) | 依赖的任务编号
  - **Covers**: Requirement: xxx, Scenario: xxx
  - **Testable**: true | false
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
- Covers: Requirement: 用户数据模型
- Testable: true
- Files: server/models/user.py
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
| Testable 标注 | 无依赖 + 有可测代码 + 非 config/docs → Testable: true |

### 测试文件归属

specline-spec-creator 生成的 tasks.md 末尾会包含「测试文件归属」表格节，按 capability 分组列出：

| 测试文件（目录） | 测试类型 | 负责者 |
|-----------------|---------|-------|
| tests/unit/<module>/ | 单元测试 | Coding Agent (Task N) |
| tests/integration/test_<capability>.py | 集成测试 | specline-test-writer |
| tests/e2e/test_<capability>_flow.py | E2E 测试 | specline-test-writer |

> - 单元测试（`tests/unit/` 或 `tests/models/`）归属 coding agent
> - 集成测试（`tests/integration/`）和 E2E 测试（`tests/e2e/`）归属 specline-test-writer
> - coding agent 和 test-writer 应只在自己的边界内编写测试文件

---

### Guardrails

- 所有文件直接写入 `specline/changes/<name>/`，不调用外部 CLI
- 先读已有 dependency 再生成后续文件
- 需求不明确时用结构化提问（AskUserQuestion）澄清
- 优先做出合理判断保持节奏，只在关键不清时询问
- **Hook 阻断不降级**：如果本 Skill 因 `specline-spec-creator` 子 Agent 被 hook 阻止而作为降级方案被调用，必须首先通知用户阻断原因，并尝试诊断修复（参考 specline-pipeline SKILL 中的 Hook 阻断处理规范）。不得在 hook 问题未解决时静默直接执行

---

## Anti-Rationalization 表格

生成 Spec 规划文件时，Agent 容易找借口跳过关键步骤：

| 借口 | 现实 |
|------|------|
| "需求很明确，不需要 proposal.md" | 明确的只是你脑子里的假设。Proposal 的作用是让这些假设显式化，供他人审视。 |
| "Scope 就是隐含的，不用写那么细" | 一半的返工源于对"不做什么"的沉默分歧。Out of Scope 是提案中最有价值的部分。 |
| "任务拆解是多余的，我能直接做" | 不拆解就无法并行、无法断点续跑、无法追溯。10 分钟的拆解省下 2 小时的重做。 |
| "并行度 50% 够了，不用追求 60%" | 60% 不是硬指标，但 <50% 意味着功能边界划分不合理——大概率任务之间耦合太紧。 |
| "测试文件归属表格我后面补" | 补的从来不会补。没有归属表格，coding agent 和 test-writer 会踩到对方的文件。 |

## Verification Checklist

生成 Spec 规划文件后，自查：

- [ ] proposal.md 包含：What / Why / In Scope / Out of Scope（两段显式分开）/ Impact
- [ ] spec.md 包含：Purpose + Requirements，每个 Requirement ≥1 Scenario（含 WHEN/THEN），Happy Path + 至少 1 个异常场景
- [ ] design.md 包含：Architecture Overview、Key Design Decisions（理由+替代方案）、Data Flow、Component Interaction、**Architecture Impact Analysis**（侵入点/模块边界/依赖方向/数据影响/接口兼容性，每项带置信度 ✅/⚠️）、**对外接口契约**（如有 test-writer 测试任务；CLI/HTTP/模块导出表格）
- [ ] tasks.md 每个任务标注完整（Type/Depends/Covers/Testable/Files），Depends: (none) 占比 ≥ 60%，第 1 批次 Files 无重叠
- [ ] 测试文件归属表格存在：单元测试归属 coding agent，集成/E2E 归属 test-writer
- [ ] `specline-pipeline-gate.sh artifacts --json` 确认 4 个文件齐全
