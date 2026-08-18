---
name: specline-apply-change
description: 实现 Specline change 中的任务。用于用户想开始实现、继续实现或逐项推进 tasks。
license: MIT
compatibility: Compatible with specline.
metadata:
  author: specline
  version: "1.0"
  generatedBy: "1.3.1"
---

实现 Specline change 中的任务。

**输入**：可选传入 change name。若未传入，先判断能否从对话上下文推断；若模糊或有歧义，必须展示可用 change 让用户选择。

## 第 1 层：速览

> **一句话**：实现 Specline change 中的编码任务。
> **入口**：`/specline-apply-change [change-name]` 或直接说「继续实现」
> **流程**：选 change → 读上下文 → 逐任务实现 → 标记完成

> ⚠️ **人机门禁策略感知**：当调用方传递了 `HUMAN_GATE_POLICY=minimal` 或 `HUMAN_GATE_POLICY=none` 上下文时，本 Skill 内所有的 直接向用户提问 交互应自动采用默认安全选项：
> - change 选择 → 若上下文中已有 change name，直接使用；否则取第一个活跃 change
> - 其他 直接向用户提问 交互 → 自动采用默认安全选项继续，不暂停等待人工输入

**流动式工作流集成**

本 Skill 支持围绕单个 change 持续执行 action 的模型：
- **可随时调用**：Artifact 尚未全部完成但已有 tasks 时、部分实现后、或与其他 action 交错时都可调用
- **允许更新 Artifact**：如果实现暴露设计问题，建议更新 Artifact；不被阶段锁死，按实际情况流动推进

**开始前请确认：**
- [ ] Change 已选中（`/specline-pipeline --change <name>`）
- [ ] 已运行 `specline gate contract --change "<name>"` 判断合同状态
- [ ] 若存在 approved + fresh `execution-contract.md`，已优先读取它作为实现权威
- [ ] 已读取 proposal.md / spec.md / design.md / tasks.md 作为 reference artifacts

## 第 2 层：主流程

**步骤**

1. **选择 change**

   如果提供了 name，直接使用。否则：
   - 如果用户在对话中提到 change，则从上下文推断
   - 如果只有一个活跃 change，自动选择
   - 如果有歧义，运行 `specline gate list --json` 获取可用 change，并使用 直接向用户提问 让用户选择

   始终告知："Using change: <name>"，并说明如何覆盖选择（如 `/specline-pipeline --change <other>`）。

2. **检查状态以识别 schema**
   ```bash
   specline gate artifacts --change "<name>" --json
   ```
   解析 JSON，确认：
   - `schemaName`：当前使用的工作流（如 "spec-driven"）
   - 哪个 Artifact 包含 tasks（spec-driven 通常是 "tasks"，其他 schema 以状态为准）

3. **检查并读取 Execution Contract**

   先运行：
   ```bash
   specline gate contract --change "<name>"
   ```

   - 通过且存在 `execution-contract.md`：优先读取它，作为 primary implementation authority。
   - 旧 change 无合同且策略为 `legacy_policy: warn`：告知用户正在 legacy mode，继续读取原规划文件。
   - 合同 stale / missing / unapproved 且不是 legacy warn：暂停，不实现，建议回到 `/specline-pipeline --change <name>` 重建合同。

4. **读取上下文文件**

   读取 `specline/changes/<name>/` 下的规划文件作为 reference artifacts：
   - `proposal.md` — 做什么与为什么
   - `specs/<capability>/spec.md` — Requirements 与 Scenarios
   - `design.md` — 架构与决策
   - `tasks.md` — 实现清单

   检查 task 完成度：统计 `- [ ]`（未完成）与 `- [x]`（已完成）。

5. **展示当前进度**

   展示：
   - 进度："N/M tasks complete"
   - 剩余任务概览

6. **实现 tasks（循环直到完成或阻塞）**

   对每个待完成 task：
   - 展示当前正在处理的 task
   - 完成所需代码修改
   - 保持修改最小且聚焦
   - 在 tasks 文件中标记完成：`- [ ]` → `- [x]`
   - 继续下一个 task

   **出现以下情况时暂停：**
   - Task 不清晰 → 请求澄清
   - 实现暴露设计问题 → 建议更新 Artifact
   - 遇到错误或阻塞 → 报告并等待指引
   - 用户中断

7. **完成或暂停时展示状态**

   展示：
   - 本 session 完成的 tasks
   - 总体进度："N/M tasks complete"
   - 如果全部完成：建议归档
   - 如果暂停：解释原因并等待指引

## 第 3 层：输出模板与高级话题

### 输出模板

**实现过程输出**

```
## Implementing: <change-name> (schema: <schema-name>)

Working on task 3/7: <task description>
[...implementation happening...]
✓ Task complete

Working on task 4/7: <task description>
[...implementation happening...]
✓ Task complete
```

**完成时输出**

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

**暂停时输出（遇到问题）**

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

### 约束
- 持续推进 tasks，直到完成或阻塞
- 开始前始终读取上下文文件（来自 apply 指令输出）
- task 有歧义时，先暂停询问，再实现
- 实现暴露问题时，暂停并建议更新 Artifact
- 保持代码修改最小化，并限定在当前 task 范围内
- 每完成一个 task，立即更新 checkbox
- 遇到错误、阻塞或需求不清时暂停，不要猜测
- 使用 CLI 输出中的 contextFiles，不要假设固定文件名
- **Hook blocked → no silent fallback**：如果本 Skill 是因为 coding subagent（specline-frontend-dev / specline-backend-dev）被 hook 阻断而被调用，必须先告知用户阻断原因并尝试诊断。不要静默执行本应由被阻断 subagent 处理的任务。参考 specline-pipeline Skill 中的 Hook Blocking Resolution Protocol。

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

## 验证清单

每完成一个任务后自查，全部完成后终查：

- [ ] 开始前已运行 Contract Gate；如合同 approved + fresh，已优先读取 execution-contract.md
- [ ] 每个任务的实现范围未超出 Files 声明
- [ ] 每个 `Testable: true` 的任务产出的测试文件必须是该任务 `Files:` 中命中共享模式的路径（多语言：`tests/(unit|models)/`、`*_test.go`、`*.test.ts`/`*.spec.ts`、`src/*/tests.rs`；以该任务 `Files:` 声明为准，不限于 `tests/unit/` 或 `tests/models/`）
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
