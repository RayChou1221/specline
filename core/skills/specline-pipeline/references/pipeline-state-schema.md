# Pipeline 状态文件 Schema 参考

## Purpose

本文档定义 `.pipeline-state.json` 的完整 JSON Schema 和关键字段说明。编排者在初始化流水线或需要理解状态文件结构时查阅。

## 完整 JSON Schema

```json
{
  "version": 1,
  "change_name": "<name>",
  "created_at": "<ISO8601>",
  "updated_at": "<ISO8601>",
  "current_phase": "spec",
  "current_step": "specline-spec-creator",
  "phases": {
    "spec": {
      "status": "in_progress",
      "retry_count": 0,
      "sub_phases": {},
      "gates": {
        "spec_gate": { "passed": null },
        "human_gate_1": { "passed": null }
      }
    },
    "coding": {
      "status": "pending",
      "tasks": [],
      "sub_phases": {},
      "gates": {
        "build_gate": { "passed": null }
      }
    },
    "code_review": {
      "status": "pending",
      "retry_count": 0,
      "gates": {
        "lint_gate": { "passed": null },
        "human_gate_2": { "passed": null }
      }
    },
    "test": {
      "status": "pending",
      "framework": null,
      "sub_phases": {
        "unit": {
          "status": "pending",
          "gates": { "test_unit_gate": { "passed": null } }
        },
        "integration": {
          "status": "pending",
          "gates": { "test_integration_gate": { "passed": null } }
        },
        "e2e": {
          "status": "pending",
          "gates": { "test_e2e_gate": { "passed": null } }
        }
      }
    },
    "archive": {
      "status": "pending",
      "gates": {
        "human_gate_3": { "passed": null },
        "archive_gate": { "passed": null }
      }
    }
  }
}
```

## 关键字段说明

| 字段 | 说明 |
|------|------|
| `version` | Schema 版本号，当前为 1 |
| `change_name` | 变更名称，与 `specline/changes/<name>/` 目录名一致 |
| `created_at` | 流水线创建时间（ISO 8601 格式） |
| `updated_at` | 流水线最后更新时间（ISO 8601 格式） |
| `current_phase` | 当前阶段（spec / coding / code_review / test / archive） |
| `current_step` | 当前正在执行的步骤名称（如 `specline-spec-creator`） |
| `phases.<phase>.status` | 阶段状态（pending / in_progress / completed） |
| `phases.<phase>.retry_count` | 该阶段重试次数 |
| `phases.<phase>.gates.<gate_name>.passed` | 门禁通过状态（null / true / false） |
| `phases.coding.tasks[]` | 编码任务列表（含 id / type / deps / batch / status / files） |
| `phases.test.framework` | 测试框架名称，由 test-writer 确认后填入 |
| `phases.test.sub_phases.<type>.status` | 测试子阶段状态（unit / integration / e2e） |
