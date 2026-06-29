# 事件日志与状态写入规范

## Purpose

定义 Pipeline 编排者写入状态和事件日志的规范——谁在何时写入什么内容。这是编排者在 SPE 编码阶段（Step 7）和异常恢复阶段（Layer 3）写入 `.pipeline-state.json` 和 `pipeline-events.jsonl` 时必须遵循的规则。

## 状态写入规则

> 所有状态写入由 Gate 脚本或 Skill 编排逻辑完成，**不使用 LLM 写入状态**。

| 写入时机 | 写入方 | 写入内容 |
|---------|--------|---------|
| Gate 通过 | Gate 脚本 | `gate.passed = true` |
| 子 Agent 完成 | Skill 编排逻辑 | `completed_at`（时间戳） |
| 代码修复后 | Skill 编排逻辑 | 重置相关 gates 为 `null` |

## 结构化事件日志

每个关键事件追加写入 `specline/changes/<name>/pipeline-events.jsonl`（JSON Lines 格式，每行一个事件）。

### 事件格式

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

### 事件类型列表

| 事件类型 | 触发时机 |
|---------|---------|
| `pipeline_start` | 流水线开始 |
| `phase_transition` | 阶段切换（spec→coding→review→test→archive） |
| `agent_start` | 子 Agent 启动 |
| `agent_done` | 子 Agent 完成 |
| `gate_run` | Gate 脚本执行完毕 |
| `conflict_detected` | 检测到文件冲突 |
| `retry` | 任务重试 |
| `pipeline_pause` | 流水线暂停（人工检查点） |
| `pipeline_resume` | 流水线恢复 |
| `pipeline_complete` | 流水线完成 |

### 写入原则

- 每个事件一行，JSON 对象结尾无逗号
- 任何编排动作（启动 agent、运行 gate、状态转换）都写入事件日志
- Gate 脚本不写事件日志（Gate 是无状态的），仅编排层写入
- 事件日志用于人工排查问题和统计分析，不影响流水线决策
