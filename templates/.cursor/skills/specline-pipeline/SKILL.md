---
name: specline-pipeline
description: >-
  开发流水线元 Skill。编排 Spec → Coding → Review → Test → Archive 全流程，
  调度子 Agent 和 Gate 脚本，支持断点续跑。输入自然语言需求自动推进到归档。
---

# /specline-pipeline 开发流水线编排 Skill

---

## Layer 1: 速览与定位

你是**流水线编排者**，不是执行者。

**你做：**
- 读取 `.pipeline-state.json` 确定当前阶段和恢复点
- 启动子 Agent，按批次并发派发 coding Agent
- 显式调用 `specline-pipeline-gate.sh` 进行门禁校验
- 根据 exit code 决策：前进 / 回退修复 / 暂停等人工确认

**你不做：**
- 需求判断/Spec 编写、代码编写、代码审查、测试编写、门禁判断——这些都交给子 Agent 和 Gate 脚本

### Phase 流程图

```
    SPEC ──→ CODING ──→ CODE REVIEW ──→ TEST ──→ ARCHIVE
      │G        │G           │G           │G         │G
      🟡HG   (并行)       │G        (串行)     🟡HG
                        🟡HG

    G  = Gate（确定性门禁脚本，零 LLM 参与）
    🟡 = Human Gate（人工确认检查点）
```

### 入口模式

1. **新建流水线**: `/specline-pipeline <自然语言需求>`
2. **恢复流水线**: `/specline-pipeline --change <change-name>`
3. **自动发现**: `/specline-pipeline`（无参数，列出所有未完成流水线）

### 最终产出

归档到 `specline/changes/archive/YYYY-MM-DD-<name>/`

---

## Layer 2: Happy Path — 新建流水线

### Phase 1: SPEC

#### Step 1: 创建 Change

```bash
specline-pipeline-gate.sh new --change "<kebab-case-name>"
```

初始化 `.pipeline-state.json`，关键字段：

| 字段 | 说明 |
|------|------|
| `current_phase` | 当前阶段（spec / coding / code_review / test / archive） |
| `phases.<phase>.status` | 阶段状态（pending / in_progress / completed） |
| `phases.<phase>.gates.<gate_name>.passed` | 门禁通过状态（null / true / false） |
| `phases.coding.tasks[]` | 编码任务列表（含 id / type / deps / batch / status / files） |

> 📋 完整 JSON Schema 见 [附录 A](#附录-a-pipeline-statejson-完整-schema)

#### Step 2: 启动 specline-spec-creator

specline-spec-creator 子 Agent 的职责是根据内联模板直接生成全部规划文件：
- `proposal.md` — 需求提案（What/Why/Scope）
- `design.md` — 技术设计（架构/决策/数据流）
- `tasks.md` — 任务拆解清单（含 Type/Depends/Covers/Files 标注）
- `specs/<capability>/spec.md` — 功能规格（Requirements/Scenarios）

使用 Task 工具，subagent_type="specline-spec-creator"，描述中传入 change name 和自然语言需求，让 specline-spec-creator 根据内联模板直接生成。

> **任务标注规范**：tasks.md 每个任务必须包含：
> - `Type`: frontend | backend | infra | db | config | docs
> - `Depends`: (none) | 任务编号
> - `Covers`: Requirement: xxx, Scenario: xxx（链接到 Spec，必填）
> - `Files`: 相对路径，列出本任务将修改/创建的所有文件（必填，用于冲突检测）

> **注意**：specline-spec-creator 直接按内联模板生成 4 个 Artifact 并自检输出完整性（含并行度 ≥ 60% 和 Files 无冲突自检）。

完成后写入状态：

```bash
NOW=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
jq --arg time "$NOW" '.updated_at = $time | .phases.spec.sub_phases["specline-spec-creator"] = {"status": "completed", "completed_at": $time}' "$STATE_FILE" > tmp && mv tmp "$STATE_FILE"
```

#### Step 3: 审核全部规划文件（specline-spec-reviewer）

specline-spec-reviewer 审核三份文件：
1. `specs/` 下所有 spec.md 的完整性和一致性
2. `design.md` 的技术决策合理性和覆盖完整性
3. `tasks.md` 的格式、独立性、覆盖度、文件冲突

产出 spec-review.json (`{ "status": "approved"|"rejected", "feedback": [...], "coverage": {...}, "task_stats": {...} }`)。

若 rejected：将 feedback 反馈给用户修改，或手动编辑相应文件后重新审核（最多 3 次循环）。

#### Step 4: Spec Gate

```bash
.cursor/hooks/specline-pipeline-gate.sh spec --change "<name>"
```

校验内容：
- ✓ `proposal.md` 存在
- ✓ `design.md` 存在
- ✓ `tasks.md` 存在，且每个任务含 `Type:`、`Depends:`、`Covers:`、`Files:` 标注
- ✓ 每个 Requirement 至少被 1 个 task 的 `Covers:` 引用（通过 spec-review.json 的 coverage 字段）
- ✓ 第 1 批次任务的 `Files` 集合互不重叠
- ✓ 至少 1 个任务 `Depends: (none)`

exit code 0 = 通过，写入 passed。exit code != 0 = 失败，读取 stderr 展示给用户。

#### Step 5: 人工确认 (Human Gate 1) 🟡

Spec Gate 通过后，使用 `AskUserQuestion` 工具请求确认。展示内容包括：需求提案摘要、功能需求列表、任务拆解概览（含并行组）。

> **用户交互规范**：所有需要用户做选择的交互，必须使用 `AskUserQuestion` 工具而非自由文本询问。结构化问题能让 Cursor 在单次请求中完成交互，避免额外轮次。

AskUserQuestion 使用模式：

```javascript
AskUserQuestion({
  title: "简洁标题",
  questions: [{
    id: "unique_id",
    prompt: "问题描述",
    options: [
      { id: "option_a", label: "选项 A 的描述" },
      { id: "option_b", label: "选项 B 的描述" }
    ],
    allow_multiple: false  // 单选；需要多选时设为 true
  }]
})
```

Human Gate 1 具体交互：

```javascript
AskUserQuestion({
  title: "确认 Spec 和任务规划",
  questions: [{
    id: "spec_confirm",
    prompt: "specline-spec-creator 已生成 spec / design / tasks 文件并通过格式校验。请确认：\n" +
      "1. 需求描述是否准确？\n" +
      "2. 任务拆解是否合理？独立任务是否足够？\n" +
      "3. 验收场景是否覆盖核心路径和异常路径？",
    options: [
      { id: "approve", label: "确认通过，继续编码阶段" },
      { id: "reject", label: "不通过，手动修改后重新审核" }
    ]
  }]
})
```

- `approve` → 写入 `human_gate_1.passed = true`，进入 Phase 2
- `reject` → 等待用户修改 spec/tasks 文件后，回到 Step 3 重新审核

### Phase 2: CODING

> **并行加速**：Human Gate 1 通过后，**同时**启动 coding 和 specline-test-writer。specline-test-writer 是黑盒的——只需要 Spec 文档，不需要实现代码。两者并行可节省 specline-test-writer 的编写时间。

#### Step 6: 并行启动（test-writer + DAG 构建）

时序图：

```
时间 ────────────────────────────────────────────────────────────────────→

Track A (test-writer):
  6a 启动 ───── specline-test-writer（黑盒，与 Coding 并行运行） ──────→ 等待 Step 12

Track B (coding):
  6b 解析 tasks.md ──→ 6c 冲突检测 ──→ 7a 派发批次1 ──→ 7b 更新状态 ──→ 7c 派发批次2...
                                                                                    ↓
                                                                            Step 8: Build Gate

Track A 和 Track B 同时启动，互不阻塞。test-writer 在 Coding 全部完成后、TEST 阶段前被检查（Step 12）。
```

**6a. 启动 specline-test-writer（与 Coding 阶段 Agent 同时启动）**：

```javascript
// 在派发 coding agent 的同时，启动 specline-test-writer
Task({
  subagent_type: "specline-test-writer",
  description: `编写测试: ${changeName}`,
  prompt: `
你收到一个测试编写任务。请基于 Spec 编写所有测试用例。

## 上下文文件（只读参考）
- Spec: specline/changes/${changeName}/specs/*/spec.md
- Tasks: specline/changes/${changeName}/tasks.md

## 关键约束
1. 你是黑盒测试工程师，不能读取实现源代码
2. 先检测项目的测试框架（读配置文件），按项目实际语言和框架编写测试
3. 每个 Scenario 至少生成 1 个对应的测试函数（命名遵循框架约定）
4. 基于 Covers 追溯链，确保每个 Scenario 都有测试

## 产出报告
完成后在 specline/changes/${changeName}/.tmp/test-code-result.json 写入状态（含 test_framework / language / test_dir / scenarios_covered 等字段）
`
})
```

**6b. 解析 tasks.md，构建任务 DAG**：

读取 `specline/changes/<name>/tasks.md`，解析每个任务的 `Type`、`Depends`、`Covers`、`Files` 标注，构建依赖关系图，划分为多个**并行批次**。

> **断点续跑时的任务状态恢复**：解析 tasks.md 时同时读取每个任务的 checkbox 状态（`[x]` 表示已完成，`[ ]` 表示未完成）。已完成的任务在 DAG 中标记为 `status: "completed"`，后续批次派发时自动跳过。

解析算法（jq + grep）：

```bash
TASKS_FILE="specline/changes/<name>/tasks.md"

# 提取每个任务的核心元数据
# 期望输出格式：TASK_NUM|TYPE|DEPS|COVERS|FILES
rg -N --no-line-number '^## \d+\.|^- \*\*Type\*\*:|^- \*\*Depends\*\*:|^- \*\*Covers\*\*:|^- \*\*Files\*\*:' "$TASKS_FILE" | while read -r line; do
  # 解析并按批次分组
  ...
done

# 构建任务列表写入状态文件（含 Files 用于冲突检测，Covers 用于追溯）
jq --argjson tasks '[
  {"id":"1","type":"backend","deps":[],"batch":1,"status":"pending","covers":"Requirement: 数据模型","files":["server/models.py"]},
  {"id":"2","type":"frontend","deps":[],"batch":1,"status":"pending","covers":"Requirement: 登录页面","files":["src/components/Login.tsx"]}
]' '.phases.coding.tasks = $tasks' "$STATE_FILE" > tmp && mv tmp "$STATE_FILE"
```

批次划分规则：
- 批次 1：所有 `Depends: (none)` 的任务
- 批次 N：所有依赖仅限于 1..N-1 批次内已完成任务的任务

**6c. 文件冲突检测（每批次派发前）**：

在派发每批任务之前，检查该批次中所有任务的 `Files` 集合是否有交集：

```bash
# 伪代码：检测当前批次任务的文件冲突
# 读取当前批次所有任务的 files 数组
# 如果有任意两个任务的 files 有交集 → 标记冲突任务对，暂停并报告用户
```

#### Step 7: 按批次并发派发 Coding Agent

对每个批次依次处理：

**7a. 同一批次内所有任务并发派发**，根据 Type 选择对应的 agent：

```
Type: frontend → subagent_type: "specline-frontend-dev"
Type: backend  → subagent_type: "specline-backend-dev"
Type: infra    → subagent_type: "specline-backend-dev"（基础设施类，用后端 agent 处理）
Type: db       → subagent_type: "specline-backend-dev"（数据库迁移，用后端 agent 处理）
Type: config   → subagent_type: "specline-config-dev"（shell 脚本、配置文件、JSON/YAML）
Type: docs     → subagent_type: "specline-config-dev"（Markdown 文档、Skill 定义）
```

每个任务启动一个独立的子 Agent：

```javascript
for (const task of currentBatchTasks) {
  // 根据 Type 选择对应的 agent 类型
  let agentType;
  switch (task.type) {
    case "frontend": agentType = "specline-frontend-dev"; break;
    case "backend": case "infra": case "db": agentType = "specline-backend-dev"; break;
    case "config": case "docs": agentType = "specline-config-dev"; break;
    default: agentType = "specline-backend-dev";
  }

  Task({
    subagent_type: agentType,
    description: `实现任务 ${task.id}: ${task.title} [${task.type}]`,
    prompt: `
你收到一个编码任务（Type: ${task.type}），请只实现本任务范围内的代码。

## 上下文文件（只读参考）
- Spec: specline/changes/${changeName}/specs/${capability}/spec.md
- Design: specline/changes/${changeName}/design.md
- Tasks: specline/changes/${changeName}/tasks.md

## 当前任务（只实现这个）
任务 ID: ${task.id}
覆盖需求: ${task.covers}
预期文件: ${task.files}

从 tasks.md 中提取的任务 ${task.id} 的完整描述：
---
${task.content}
---

## 约束
1. 只修改本任务 Files 范围内的文件
2. 不修改其他任务负责的文件
3. 与已完成任务的接口约定必须遵守（参考已生成的接口/类型定义文件）
4. 确认过 design.md 中的技术决策后再动手
5. **完成后必须将 tasks.md 中本任务的 \`[ ]\` 改为 \`[x]\`**（方便断点续跑识别进度）

## 产出报告
完成后在 specline/changes/${changeName}/.tmp/task-${task.id}-result.json 写入：
{
  "task_id": "${task.id}",
  "type": "${task.type}",
  "covers": "${task.covers}",
  "status": "completed",
  "files_changed": [...],
  "summary": "..."
}
`
  })
}
```

**7b. 等待当前批次所有 Agent 完成后**：
1. 验证每个 Agent 的产出报告（`specline/changes/<name>/.tmp/task-<id>-result.json`）
2. 更新状态文件中对应 task 的 `status` 和 `completed_at`
3. **验证 tasks.md 中对应任务的 checkbox 已从 `[ ]` 变为 `[x]`**（如果未标记，自动补标）

```bash
# 更新状态文件
jq --arg task_id "1" --arg time "$NOW" '
  .phases.coding.tasks |= map(
    if .id == $task_id then .status = "completed" | .completed_at = $time else . end
  )
' "$STATE_FILE" > tmp && mv tmp "$STATE_FILE"

# 如果 Agent 忘记标记 tasks.md，自动补标
# sed 将 "## <task_id>. [ ]" 替换为 "## <task_id>. [x]"
sed -i '' "s/^## ${task_id}\. \[ \]/## ${task_id}. [x]/" specline/changes/<name>/tasks.md
```

**7c. 检查是否有下一批次**。如有，回到 6c（冲突检测）→ 7a 继续派发。

#### Step 8: Build Gate

全部批次完成后，运行 Build Gate：

```bash
.cursor/hooks/specline-pipeline-gate.sh build --change "<name>"
```

exit code 0 = 通过，进入 Phase 3。失败处理见 [Layer 3: Build Gate 失败处理](#build-gate-失败处理)。

### Phase 3: CODE REVIEW

#### Step 9: 启动审查 Agent

根据 tasks.md 中任务类型决定审查方式：

**9a. specline-code-reviewer**（有 frontend/backend/infra/db 类型任务时）：

审查前端/后端代码变更。审查时利用 tasks.md 的 `Covers` 追溯链：每个 finding 应标注涉及的文件和对应的 Requirement/Scenario。

**9b. specline-config-reviewer**（有 config/docs 类型任务时）：

审查 config/docs 变更——shell 脚本安全性、配置文件语法和一致性、Markdown 文档结构完整性。

> 两种审查 Agent 可并发启动。产出均为 `specline/changes/<name>/.tmp/code-review.json`（`{ "findings": [{ "severity": "error"|"warning", "file": "...", "covers": "Requirement: xxx", "message": "..." }] }`）。

#### Step 10: Lint Gate

```bash
.cursor/hooks/specline-pipeline-gate.sh lint --change "<name>"
```

检查 eslint/ruff 退出码 + code-review.json 中 error 计数。

失败 → 根据 findings 的 `file` 和 `covers` 字段定位到具体任务，只回对应 coding agent 修复（最多 2 次）。

#### Step 11: 可选人工复核 (Human Gate 2) 🟡

仅当 code-review.json 中 warnings > 0 且 errors = 0 时，使用 `AskUserQuestion`：

```javascript
AskUserQuestion({
  title: "代码审查复核",
  questions: [{
    id: "review_check",
    prompt: "代码审查发现 " + warning_count + " 个警告，0 个错误。是否需要人工复核？",
    options: [
      { id: "skip", label: "无需复核，自动继续测试阶段" },
      { id: "review", label: "需要人工复核" }
    ]
  }]
})
```

- `skip`（默认）→ 自动继续
- `review` → 展示警告详情，等待人工处理

### Phase 4: TEST

> **config/docs 跳过测试**：如果 tasks.md 中所有任务均为 `Type: config` 或 `Type: docs`（无应用代码变更），TEST 阶段自动跳过——test-unit/integration/e2e Gate 在无测试目录时自动放行。流水线直接从 CODE REVIEW 进入 ARCHIVE。

#### Step 12: 确认 specline-test-writer 完成

specline-test-writer 已在 Phase 2（Step 6a）与 Coding 并行启动。进入 TEST 阶段时，检查 specline-test-writer 是否已完成：

- 已完成 → 读取 `specline/changes/<name>/.tmp/test-code-result.json` 获取 `test_framework`，写入 `.pipeline-state.json`：
  ```bash
  FRAMEWORK=$(jq -r '.test_framework' specline/changes/<name>/.tmp/test-code-result.json)
  jq --arg fw "$FRAMEWORK" '.phases.test.framework = $fw' "$STATE_FILE" > tmp && mv tmp "$STATE_FILE"
  ```
  然后直接进入测试执行
- 未完成 → 等待 specline-test-writer 完成（展示等待状态），完成后同上写入框架信息

> `test_framework` 写入状态文件后，后续 `specline-pipeline-gate.sh` 的 test gate 会自动读取并选择正确的测试命令（Jest/pytest/go test 等）。

> **黑盒约束回顾**：specline-test-writer 只能基于 Spec 文档编写测试，不能读取任何实现源代码。specline-test-writer 会自动检测项目测试框架（Jest/pytest/go test 等），按项目实际语言编写测试。

#### Step 13: 测试门禁链（串行）

```bash
# 单元测试
.cursor/hooks/specline-pipeline-gate.sh test-unit --change "<name>"
# 集成测试
.cursor/hooks/specline-pipeline-gate.sh test-integration --change "<name>"
# E2E 测试
.cursor/hooks/specline-pipeline-gate.sh test-e2e --change "<name>"
```

exit code 全 0 = 通过，进入 Phase 5。失败处理见 [Layer 3: 测试失败处理](#测试失败处理)。

### Phase 5: ARCHIVE

#### Step 14: 归档确认 (Human Gate 3) 🟡

全部测试通过后，使用 `AskUserQuestion` 请求归档确认：

```javascript
AskUserQuestion({
  title: "归档确认",
  questions: [{
    id: "archive_confirm",
    prompt: "全部测试通过。变更摘要：新增 " + new_files + " 个文件，修改 " + modified_files + " 个文件。是否归档此变更？",
    options: [
      { id: "archive", label: "确认归档" },
      { id: "cancel", label: "暂不归档" }
    ]
  }]
})
```

- `archive` → 执行归档
- `cancel` → 暂停流水线，保留状态文件待后续继续

#### Step 15: 归档

```bash
specline-pipeline-gate.sh archive --execute --change "<name>"
.cursor/hooks/specline-pipeline-gate.sh archive --change "<name>"
```

> 归档的详细逻辑（Delta spec sync 决策、目录移动、摘要展示）由 **specline-archive-change** Skill 负责。编排者只需确认 Human Gate 3 通过后调用上述归档命令。

---

## Layer 3: 异常与恢复

### Build Gate 失败处理

⚠️ Build Gate 失败时，分析失败原因并定位到具体任务：

**8a. 单个任务构建失败** → 回对应 coding agent 修复（最多 2 次循环）

**8b. 接口不兼容** → 计算影响范围，只重置受影响的下游任务：

```bash
# 影响范围分析：基于 tasks.md 的 Depends 关系，计算受影响的下游任务
# 例如：Task 1 的 API 签名改了 → Task 3 (Depends: 1)、Task 5 (Depends: 1,3) 需要重跑
# Task 2 无依赖关系 → 不受影响，保持 completed

AFFECTED_TASK_IDS=("3" "5")  # 从 DAG 计算得出

for tid in "${AFFECTED_TASK_IDS[@]}"; do
  jq --arg tid "$tid" '
    .phases.coding.tasks |= map(
      if .id == $tid then .status = "pending" | .completed_at = null else . end
    )
  ' "$STATE_FILE" > tmp && mv tmp "$STATE_FILE"
done
```

影响范围算法：
1. 找到被修改的任务 ID 集合 M
2. 遍历所有任务，如果某任务的 Depends 列表中包含 M 中任一 ID，则加入受影响集合
3. 递归执行第 2 步直到不再扩展

**8c. Build Gate 重置**：

```bash
jq '.phases.coding.gates.build_gate.passed = null' "$STATE_FILE" > tmp && mv tmp "$STATE_FILE"
```

修复后**只重跑受影响的任务**（按原批次顺序），未受影响的任务保持 completed 状态。

### 测试失败处理

⚠️ 任何测试失败 → specline-test-runner 分析原因：
- **测试代码问题** → specline-test-writer 自修（最多 2 次）
- **实现代码问题** → 利用 `Covers` 追溯链定位到具体任务，只回对应 coding agent 修复 → **使用影响范围算法精确重置受影响任务的 Gate**
- **`spec_ambiguity`**（Spec 模糊）→ **不自动循环修复**，暂停流水线并展示模糊点给用户，等待用户澄清 Spec 后继续
- 循环最多 2 次

代码修复后 Gate 重置：

```bash
jq '
  .phases.test.sub_phases.unit.gates.test_unit_gate.passed = null |
  .phases.test.sub_phases.integration.gates.test_integration_gate.passed = null |
  .phases.test.sub_phases.e2e.gates.test_e2e_gate.passed = null
' "$STATE_FILE" > tmp && mv tmp "$STATE_FILE"
```

### Hook 阻断处理规范

⚠️ 当任何子 Agent 被 `subagentStart` hook 阻止时，**编排者绝对不允许静默降级为自己直接执行**。必须按以下流程处理：

**Step 1: 识别阻断原因**

根据阻断信息判断原因类型，按优先级诊断：

| 原因类型 | 典型症状 | 诊断命令 |
|---------|---------|---------|
| 脚本缺少执行权限 | "Permission denied" 或脚本执行失败 | `ls -la .cursor/hooks/specline-agent-guard.sh` |
| `jq` 未安装 | jq 相关错误 | `which jq` |
| Agent 名称不在白名单 | "子Agent类型 'xxx' 不在允许列表中" | 检查 `specline-agent-guard.sh` 中 `ALLOWED_AGENTS` 变量 |
| hooks.json 缺失或不完整 | hook 未触发或配置错误 | 检查 `.cursor/hooks.json` 文件是否存在且内容完整 |

**Step 2: 与用户沟通**

```javascript
AskUserQuestion({
  title: "Hook 阻断 - 子 Agent 启动失败",
  questions: [{
    id: "hook_fix",
    prompt: `子 Agent **${agentName}** 被 hook 阻止，诊断结果：

**阻断原因**：${diagnosis}
**影响**：${impact_description}

**建议修复操作**：${fix_commands}

请选择处理方式：`,
    options: [
      { id: "auto_fix", label: "自动修复（执行上述修复命令）" },
      { id: "manual_fix", label: "我手动修复后通知你重试" },
      { id: "skip_agent", label: "跳过此 Agent，由编排者直接执行（不推荐）" }
    ]
  }]
})
```

**Step 3: 执行修复并重试**
- `auto_fix` → 执行修复命令（如 `chmod +x .cursor/hooks/*.sh`、安装 `jq` 等），修复完成后立即重试启动子 Agent
- `manual_fix` → 等待用户确认修复完成，然后重试启动子 Agent
- `skip_agent` → **仅当用户明确选择时才降级为编排者直接执行**，并必须在事件日志中记录降级原因

**Step 4: 验证修复结果** — 修复后重新启动子 Agent，如果仍然被阻止：重新诊断 → 再次沟通（最多循环 2 次）→ 暂停流水线并报告用户，不得自行降级

此规范适用于**所有 hook 阻断场景**（`subagentStart`、`beforeShellExecution` 等）。

### 断点续跑流程

#### 发现未完成流水线

扫描 `specline/changes/*/.pipeline-state.json`：

```bash
for f in specline/changes/*/.pipeline-state.json; do
  PHASE=$(jq -r '.current_phase' "$f")
  STATUS=$(jq -r '.phases."'"$PHASE"'".status' "$f")
  if [ "$STATUS" != "completed" ] && [ "$PHASE" != "archive" ]; then
    echo "$(basename $(dirname $f)): phase=$PHASE"
  fi
done
```

**使用 AskUserQuestion 让用户选择：**

- 只有 1 个未完成 → 直接展示进度摘要确认
- 有多个未完成 → 动态构建 options 列表：

```javascript
AskUserQuestion({
  title: "发现未完成流水线",
  questions: [{
    id: "pipeline_select",
    prompt: "发现以下未完成的流水线，请选择要继续的：",
    options: [
      { id: "change-a", label: "change-a (SPEC 阶段已完成)" },
      { id: "change-b", label: "change-b (CODING 阶段进行中)" }
      // ... 动态生成
    ],
    allow_multiple: false
  }]
})
```

#### 恢复算法

从后往前扫描 `phases` 中每个阶段的 `gates`，找到最后一个 `passed: true` 的门禁：

```bash
RESTORE_POINT="spec"  # 默认从 spec 开始

for phase in archive test code_review coding spec; do
  GATES=$(jq -r ".phases.${phase}.gates | keys[]" "$STATE_FILE" 2>/dev/null)
  for gate in $GATES; do
    PASSED=$(jq -r ".phases.${phase}.gates.${gate}.passed" "$STATE_FILE")
    if [ "$PASSED" = "true" ]; then
      # 找到最后通过的 gate，下一阶段为恢复点
      case "$phase" in
        spec)     RESTORE_POINT="coding";;
        coding)   RESTORE_POINT="code_review";;
        code_review) RESTORE_POINT="test";;
        test)     RESTORE_POINT="archive";;
      esac
    fi
  done
done
```

#### 重置不可信子阶段

```bash
# 将恢复阶段中 completed_at 为空的子阶段重置为 pending
jq --arg phase "$RESTORE_POINT" '
  if .phases[$phase].sub_phases then
    .phases[$phase].sub_phases |= with_entries(
      if .value.completed_at == null then
        .value.status = "pending"
      else . end
    )
  else . end
' "$STATE_FILE" > tmp && mv tmp "$STATE_FILE"
```

#### 从 tasks.md 恢复已完成任务状态

恢复到 CODING 阶段时，必须先读取 tasks.md 的 checkbox 状态，与 `.pipeline-state.json` 交叉校验：

```bash
# 从 tasks.md 提取 checkbox 状态
# "## 1. [x]" → task 1 已完成, "## 2. [ ]" → task 2 未完成
grep -n '^## \d\+\.' specline/changes/<name>/tasks.md | while read line; do
  task_id=$(echo "$line" | sed 's/.*## \([0-9]*\)\. .*/\1/')
  if echo "$line" | grep -q '\[x\]'; then
    # 同步到状态文件
    jq --arg tid "$task_id" '
      .phases.coding.tasks |= map(
        if .id == $tid then .status = "completed" else . end
      )' "$STATE_FILE" > tmp && mv tmp "$STATE_FILE"
  fi
done
```

这个交叉校验确保：即使 `.pipeline-state.json` 丢失或损坏，tasks.md 的 `[x]`/`[ ]` 标记仍可作为任务进度的可靠来源。

#### 展示恢复摘要

计算恢复点后，**直接开始恢复，不需要再次人工确认**（用户选择 pipeline 时已确认意图）。

如果只有一个未完成流水线，使用 `AskUserQuestion` 做一次快速确认：

```javascript
AskUserQuestion({
  title: "恢复流水线",
  questions: [{
    id: "resume_confirm",
    prompt: "变更: " + change_name + "\n已完成: SPEC 阶段\n未完成: CODING 阶段\n将从 CODING 阶段继续。",
    options: [
      { id: "continue", label: "继续执行" },
      { id: "cancel", label: "取消" }
    ]
  }]
})
```

---

## Layer 4: 附录

> ℹ️ 初次阅读可跳过 — 以下为完整参考信息，首次阅读可略过

### 附录 A: .pipeline-state.json 完整 Schema

```json
{
  "version": 1,
  "change_name": "<name>",
  "created_at": "<ISO8601>",
  "updated_at": "<ISO8601>",
  "current_phase": "spec",
  "current_step": "specline-spec-creator",
  "phases": {
    "spec": { "status": "in_progress", "retry_count": 0, "sub_phases": {}, "gates": { "spec_gate": { "passed": null }, "human_gate_1": { "passed": null } } },
    "coding": { "status": "pending", "tasks": [], "sub_phases": {}, "gates": { "build_gate": { "passed": null } } },
    "code_review": { "status": "pending", "retry_count": 0, "gates": { "lint_gate": { "passed": null }, "human_gate_2": { "passed": null } } },
    "test": { "status": "pending", "framework": null, "sub_phases": { "unit": { "status": "pending", "gates": { "test_unit_gate": { "passed": null } } }, "integration": { "status": "pending", "gates": { "test_integration_gate": { "passed": null } } }, "e2e": { "status": "pending", "gates": { "test_e2e_gate": { "passed": null } } } } },
    "archive": { "status": "pending", "gates": { "human_gate_3": { "passed": null }, "archive_gate": { "passed": null } } }
  }
}
```

### 附录 B: 状态写入规则

> ℹ️ 初次阅读可跳过

所有状态写入由 Gate 脚本或 Skill 编排逻辑完成，**不使用 LLM 写入状态**：

- Gate 脚本通过后自动写入 `gate.passed = true`
- 子 Agent 完成后 Skill 写入 `completed_at`
- 代码修复后 Skill 重置相关 gates 为 null

### 附录 C: 结构化事件日志

> ℹ️ 初次阅读可跳过

每个关键事件追加写入 `specline/changes/<name>/pipeline-events.jsonl`（JSON Lines 格式，每行一个事件）：

```json
{"ts":"...","event":"pipeline_start","change":"<name>"}
{"ts":"...","event":"phase_transition","from":"spec","to":"coding"}
{"ts":"...","event":"agent_start","agent":"specline-spec-creator","task":null}
{"ts":"...","event":"agent_done","agent":"specline-spec-creator","result":"completed"}
{"ts":"...","event":"agent_start","agent":"specline-frontend-dev","task":"1","type":"frontend"}
{"ts":"...","event":"agent_done","agent":"specline-frontend-dev","task":"1","result":"completed","files_changed":["..."],"duration_ms":45200}
{"ts":"...","event":"gate_run","phase":"build","exit_code":0,"passed":true}
{"ts":"...","event":"gate_run","phase":"lint","exit_code":1,"passed":false,"stderr":"..."}
{"ts":"...","event":"conflict_detected","tasks":["1","2"],"overlap_files":["src/utils/api.ts"]}
{"ts":"...","event":"retry","phase":"coding","task":"3","attempt":2,"reason":"build_failure"}
{"ts":"...","event":"pipeline_pause","reason":"human_gate_1"}
{"ts":"...","event":"pipeline_resume","from_phase":"coding"}
{"ts":"...","event":"pipeline_complete","change":"<name>"}
```

**写入原则**：
- 每个事件一行，JSON 对象结尾无逗号
- 任何编排动作（启动 agent、运行 gate、状态转换）都写入事件日志
- Gate 脚本不写事件日志（Gate 是无状态的），仅编排层写入
- 事件日志用于人工排查问题和统计分析，不影响流水线决策

### 附录 D: Hook 约束体系

> ℹ️ 初次阅读可跳过

Specline 通过 Cursor Hooks 提供了三层自动约束，确保在长对话中 Agent 不偏离流水线逻辑：

```
sessionStart   → specline-session-start.sh
                 新会话启动时检测活跃 pipeline，自动注入阶段上下文到 Agent 系统提示

preToolUse     → specline-phase-guard.sh
                 操作前检查：SPEC 阶段拦截代码编辑、阶段不匹配的子Agent 启动

postToolUse    → specline-reminder.sh
                 关键操作后注入提醒：更新 tasks.md checkbox、运行 Gate 脚本
```

#### 对你（编排者）的影响

1. **总是先检查** - preToolUse 会阻止不匹配当前阶段的操作，所以你在行动前自然会考虑阶段
2. **被提醒下一步** - postToolUse 在子Agent完成后提醒你更新 checkbox 和运行 Gate
3. **非流水线会话无影响** - 所有 Hook 的第一步检查「是否有活跃 pipeline」，无则透明放行

#### 约束策略

| 场景 | 策略 | 原因 |
|------|------|------|
| SPEC 阶段编辑代码文件 | **硬拦截 (deny)** | 明确违规 |
| SPEC 阶段启动编码 Agent | **硬拦截 (deny)** | 阶段不匹配 |
| CODING 阶段直接编辑代码 | **软提醒 (postToolUse)** | Hook 无法区分编排者和子Agent的 Write |
| 子Agent完成后忘记 Gate | **软提醒 (postToolUse)** | 操作后注入下一步提醒 |

> 注意：CODING 阶段 Orchestrator 直接编辑代码文件不会被 Hook 硬拦截（因为子Agent 也需要 Write 权限），但 SKILL 指令和 sessionStart 注入的上下文会持续提醒你「编码应通过子 Agent」。如果你发现自己想直接编辑代码，停一下，改用 Task 工具。

### 附录 E: 关键约束速查表

> ℹ️ 初次阅读可跳过

| # | 约束 | 说明 |
|---|------|------|
| 1 | **不做判断，只做编排** | 不评估代码质量、需求好坏、测试覆盖——这些由子 Agent 和 Gate 脚本负责 |
| 2 | **所有门禁通过 Gate 脚本** | 调用 `specline-pipeline-gate.sh`，不要自己写 grep/检查逻辑 |
| 3 | **状态文件是唯一真相源** | 所有决策基于 `.pipeline-state.json` 的当前值 |
| 4 | **人工确认点必须暂停** | 不要自动跳过 human_gate |
| 5 | **测试 Agent 必须黑盒** | 不给 specline-test-writer 传递源代码文件路径 |
| 6 | **Hook 阻断绝不静默降级** | 子 Agent 被 hook 阻止时，必须先诊断、沟通、修复后重试 |
| 7 | **接受 Hook 约束** | preToolUse/postToolUse/sessionStart Hook 会自动校验和提醒，不要试图绕过 |
