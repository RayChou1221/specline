---
name: using-specline
description: >-
  Specline 入口与自然语言路由。根据用户当前状态选择对应 Skill：空项目 Web 初始化→specline-init-web，
  大功能→pipeline，小改动→quickfix，探索→explore，原型可视化→visualize，知识库→knowledge。
---

# Using Specline

1. Gate 脚本 exit code 是硬决策，不可 override
2. 可安全初始化的空项目 Web 骨架、SaaS SPA、Vite + Gin 初始化 → specline-init-web
3. 大功能/跨模块 → specline-pipeline
4. 1-3 文件小改 → specline-quickfix
5. 思考探索 → specline-explore
6. Explore 后确认/交流想法、原型图、HTML 原型、可视化、修改原型 → specline-visualize
7. 读 specline/config.yaml 了解 human_gate_policy

## Skill 语言风格

1. Skill 面向 Agent/用户的说明采用中文主导；系统契约、CLI、配置字段、文件字段和固定术语保留英文原文。
2. 标题骨架使用中文，如 `第 1 层：速览与定位`、`主流程`、`步骤 1：创建 Change`、`约束`、`验证清单`。
3. 不使用 `Layer`、`Happy Path`、`Steps`、`Guardrails`、`Verification Checklist` 等说明性英文作为主标题。
4. `Pipeline`、`Quickfix`、`Gate`、`Human Gate`、`Artifact`、`Spec`、`Change`、`Agent`、`Hook`、`Type`、`Depends`、`Covers`、`Files`、`WHEN`、`THEN`、CLI 命令、路径和配置键保持英文。
5. 首次出现的核心术语可使用“中文说明（English Term）”，同一文件内保持一致。
