# Specline 借鉴 Agent-Skills 改进

## What
将 [addyosmani/agent-skills](https://github.com/addyosmani/agent-skills) 项目中的 Anti-Rationalization、Verification Checklist、Core Operating Behaviors、上下文信任分级、敌对审查等设计模式融入 Specline 的 8 个模板源文件中。

## Why
Agent-Skills 在设计哲学上有多个值得 Specline 借鉴的优点：
- **Anti-Rationalization 表格**：预判 Agent 会找什么借口跳过步骤，提前反驳
- **Verification Checklist**：每个技能末尾的自检清单，确保过程质量
- **Core Operating Behaviors**：跨所有技能的共享行为守则
- **敌对审查姿态**：审查者找问题而非验证正确

这些模式可以显著提升 Specline 各技能的子 Agent 自律性和产出质量。

## Files Changed
- `templates/.cursor/skills/specline-pipeline/SKILL.md` — 新增 Core Operating Behaviors + Anti-Rationalization + Verification Checklist
- `templates/.cursor/skills/specline-explore/SKILL.md` — 新增 Anti-Rationalization + 想要vs应该想要探针 + 可选信心自检
- `templates/.cursor/skills/specline-propose/SKILL.md` — 新增 Anti-Rationalization + Verification Checklist + Scope 拆分为 In/Out 两段
- `templates/.cursor/skills/specline-quickfix/SKILL.md` — 新增 Anti-Rationalization + Verification Checklist
- `templates/.cursor/skills/specline-apply-change/SKILL.md` — 新增 Anti-Rationalization + Verification Checklist
- `templates/.cursor/skills/specline-archive-change/SKILL.md` — 新增 Anti-Rationalization + Verification Checklist
- `templates/.cursor/skills/specline-pipeline/templates/subagent-prompts.md` — 新增共享前置 Core Behaviors + 上下文信任分级
- `templates/.cursor/agents/specline-code-reviewer.md` — 新增第 7 审查维度（合同一致性）+ 敌对审查姿态

## Test Result
- 跳过（模板文件为 Markdown，无可运行的自动化测试）
- ReadLints 通过：221 个 warning 均为已有 markdown 格式风格，非本次改造引入

## Changed Count
8 files
