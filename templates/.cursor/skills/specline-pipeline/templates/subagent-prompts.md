# 子 Agent Prompt 模板

## Purpose

3 套子 Agent prompt 模板，供 SKILL.md Step 7 的编排者按需读取。编排者根据 `task.type` 和 `task.testable` 选择对应模板，填充 `${变量}` 后作为子 Agent 的 prompt。

## 使用说明

编排者在 Step 7 中执行以下逻辑：

1. 读取本文件（`templates/subagent-prompts.md`）
2. 根据 `task.type` 和 `task.testable` 选择模板：

| 条件 | 模板 |
|------|------|
| `task.testable === true`（type 为 frontend/backend/infra/db） | Template 1: TDD Prompt |
| `task.testable === false` 且 type 为 frontend/backend/infra/db | Template 2: Standard Coding Prompt |
| type 为 config 或 docs | Template 3: Config/Docs Prompt |

3. 用任务数据填充模板中的 `${变量}` 占位符（见各模板头部的变量列表）
4. 将填充后的内容作为子 Agent 的 system prompt 传入

**注意**：如果模板中使用了 `${变量}` 但任务数据中无对应字段，编排者应报 WARNING 事件日志并使用空字符串兜底。

---

## Template 1: TDD Prompt（Testable: true）

**适用条件**：`task.testable === true`，type 为 `frontend`/`backend`/`infra`/`db`

**所需变量**：

| 变量 | 来源 | 说明 |
|------|------|------|
| `${changeName}` | 流水线上下文 | 当前 change 名称 |
| `${capability}` | 流水线上下文 | 当前 capability 名称 |
| `${task.id}` | `task.id` | 任务 ID |
| `${task.type}` | `task.type` | 任务类型（frontend/backend/infra/db） |
| `${task.covers}` | `task.covers` | 覆盖的需求声明 |
| `${task.files}` | `task.files` | 预期产出文件 |
| `${task.content}` | `task.content` | 从 tasks.md 提取的任务完整描述 |

### Prompt 模板

```
你收到一个编码任务（Type: ${task.type}, Testable: true），请按 TDD（测试驱动开发）方式实现本任务范围内的代码。

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

## TDD 约束（RED-GREEN-REFACTOR）

你必须按以下 TDD 循环编写代码：

### RED 阶段
1. 分析 Spec 中本任务覆盖的 Scenario，提取需要测试的逻辑单元
2. 在 tests/unit/<module>/test_<feature>.{ext} 下编写测试文件
3. 每个 Scenario 至少 1 个测试函数/方法
4. 覆盖：Happy Path + 边界条件（空值、极值、边界值）+ 异常路径（错误输入、异常状态）
5. 运行测试，确认全部 FAIL（RED）

### GREEN 阶段
6. 编写最小实现代码，只使当前测试通过
7. 不编写测试未覆盖的逻辑
8. 运行测试，确认全部 PASS（GREEN）

### REFACTOR 阶段
9. 重构实现代码改善结构（提取方法、消除重复、优化命名）
10. 运行测试，确保持续 PASS
11. 如果需要，补充缺失的边界条件测试

## 关键约束
1. 只修改本任务 Files 范围内的文件
2. 不修改其他任务负责的文件
3. 与已完成任务的接口约定必须遵守（参考已生成的接口/类型定义文件）
4. 确认过 design.md 中的技术决策后再动手
5. 测试文件只能写入 tests/unit/ 或 tests/models/ 目录
6. 不得修改 tests/integration/ 或 tests/e2e/ 目录下的文件（属于 test-writer）
7. **完成后必须将 tasks.md 中本任务的 `[ ]` 改为 `[x]`**（方便断点续跑识别进度）

## 产出报告
完成后在 specline/changes/${changeName}/.tmp/task-${task.id}-result.json 写入：
{
  "task_id": "${task.id}",
  "type": "${task.type}",
  "testable": true,
  "covers": "${task.covers}",
  "status": "completed",
  "files_changed": [...],
  "test_files": ["tests/unit/...", ...],
  "tests_passed": true,
  "summary": "..."
}
```

---

## Template 2: Standard Coding Prompt（Testable: false，有代码逻辑）

**适用条件**：`task.testable === false`，type 为 `frontend`/`backend`/`infra`/`db`

**所需变量**：

| 变量 | 来源 | 说明 |
|------|------|------|
| `${changeName}` | 流水线上下文 | 当前 change 名称 |
| `${capability}` | 流水线上下文 | 当前 capability 名称 |
| `${task.id}` | `task.id` | 任务 ID |
| `${task.type}` | `task.type` | 任务类型（frontend/backend/infra/db） |
| `${task.covers}` | `task.covers` | 覆盖的需求声明 |
| `${task.files}` | `task.files` | 预期产出文件 |
| `${task.content}` | `task.content` | 从 tasks.md 提取的任务完整描述 |

### Prompt 模板

```
你收到一个编码任务（Type: ${task.type}, Testable: false），请只实现本任务范围内的代码。

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
5. **完成后必须将 tasks.md 中本任务的 `[ ]` 改为 `[x]`**（方便断点续跑识别进度）

## 产出报告
完成后在 specline/changes/${changeName}/.tmp/task-${task.id}-result.json 写入：
{
  "task_id": "${task.id}",
  "type": "${task.type}",
  "testable": false,
  "covers": "${task.covers}",
  "status": "completed",
  "files_changed": [...],
  "summary": "..."
}
```

---

## Template 3: Config/Docs Prompt（config/docs 类型）

**适用条件**：type 为 `config` 或 `docs`

**所需变量**：

| 变量 | 来源 | 说明 |
|------|------|------|
| `${changeName}` | 流水线上下文 | 当前 change 名称 |
| `${capability}` | 流水线上下文 | 当前 capability 名称 |
| `${task.id}` | `task.id` | 任务 ID |
| `${task.type}` | `task.type` | 任务类型（config/docs） |
| `${task.covers}` | `task.covers` | 覆盖的需求声明 |
| `${task.files}` | `task.files` | 预期产出文件 |
| `${task.content}` | `task.content` | 从 tasks.md 提取的任务完整描述 |

### Prompt 模板

```
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
5. **完成后必须将 tasks.md 中本任务的 `[ ]` 改为 `[x]`**（方便断点续跑识别进度）

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
```
