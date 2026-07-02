---
name: using-specline
description: >-
  Specline 入口。匹配到以下场景时必须 invoke 对应 skill：
  大功能→pipeline，小改动→quickfix，探索→explore，知识库→knowledge。
---

# Using Specline

1. Gate 脚本 exit code 是硬决策，不可 override
2. 大功能/跨模块 → specline-pipeline
3. 1-3 文件小改 → specline-quickfix
4. 思考探索 → specline-explore
5. 读 specline/config.yaml 了解 human_gate_policy

## Skill 语言风格

1. Skill 面向 Agent/用户的说明采用中文主导；系统契约、CLI、配置字段、文件字段和固定术语保留英文原文。
2. 标题骨架使用中文，如 `第 1 层：速览与定位`、`主流程`、`步骤 1：创建 Change`、`约束`、`验证清单`。
3. 不使用 `Layer`、`Happy Path`、`Steps`、`Guardrails`、`Verification Checklist` 等说明性英文作为主标题。
4. `Pipeline`、`Quickfix`、`Gate`、`Human Gate`、`Artifact`、`Spec`、`Change`、`Agent`、`Hook`、`Type`、`Depends`、`Covers`、`Files`、`WHEN`、`THEN`、CLI 命令、路径和配置键保持英文。
5. 首次出现的核心术语可使用“中文说明（English Term）”，同一文件内保持一致。
