---
name: /specline-pipeline
id: specline-pipeline
category: Workflow
description: 开发流水线元 Skill —— 编排 Spec → Coding → Review → Test → Archive 全流程
---

开发流水线，自动编排从需求到归档的全流程。

**用法：**
- `/specline-pipeline <自然语言需求>` — 新建流水线
- `/specline-pipeline --change <change-name>` — 恢复指定流水线
- `/specline-pipeline` — 列出所有未完成流水线，选择继续

**阶段：**
1. Spec 编写与审核（specline-spec-creator 生成 → specline-spec-reviewer 审核）
2. Coding 编码（基于 tasks.md 任务依赖分批并发）
3. Code Review 审查（specline-code-reviewer）
4. Test 测试链（单元 → 集成 → E2E，测试 Agent 为黑盒）
5. Archive 归档

每个阶段有确定性门禁（exit code 判定，零 LLM 参与），3 个人工检查点（Spec 确认、Review 复核、归档确认）。支持断点续跑。
