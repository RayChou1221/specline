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
