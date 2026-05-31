# Specline 独立 CLI 工具 Specification

## Purpose

将 `/dev-pipeline` 开发流水线打包为独立的 `specline` CLI 命令行工具，用户通过 `npm install -g specline` 安装后在项目中执行 `specline init` 即可一键初始化全部流水线基础设施，运行时目录使用 `specline/` 独立标识，且不依赖 OpenSpec CLI（`@fission-ai/openspec` 包）。

## Requirements

### Requirement: CLI 安装与初始化

用户通过 npm 全局安装 specline 后，在任意项目目录中执行 `specline init` 将完整的流水线基础设施初始化到项目中。

#### Scenario: 用户首次安装并初始化

- **WHEN** 用户执行 `npm install -g specline`
- **AND** 在项目根目录执行 `specline init`
- **THEN** 项目获得以下文件结构：
  - `.cursor/agents/specline-*.md`（7 个 Agent 定义）
  - `.cursor/commands/specline-pipeline.md` + `specline-explore.md`（2 个入口命令）
  - `.cursor/skills/specline-*/SKILL.md`（5 个 Skill 指令）
  - `.cursor/hooks/specline-*.sh`（4 个 Gate/Hook 脚本）
  - `.cursor/hooks.json`（Cursor Hook 配置）
  - `specline/config.yaml`（Specline 项目配置）
  - `specline/changes/`（变更目录，含 archive/）
  - `specline/specs/`（主 specs 目录）
  - `.specline-config.yaml`（初始化标记文件）

#### Scenario: 用户指定目标路径

- **WHEN** 用户执行 `specline init ./my-subproject`
- **THEN** 文件初始化到 `./my-subproject/` 目录下
- **AND** 如果路径不存在，返回错误提示

#### Scenario: 项目已初始化

- **WHEN** 目标路径下已存在 `.specline-config.yaml`
- **THEN** 提示 "Specline 已在此项目中初始化"
- **AND** 如用户提供 `--force` 参数，覆盖已有文件

#### Scenario: hooks.json 冲突

- **WHEN** 目标路径下已存在 `.cursor/hooks.json`
- **THEN** 备份原文件为 `.cursor/hooks.json.bak`
- **AND** 提示用户 "已备份原有 hooks.json"

---

### Requirement: 文件命名规范（specline- 前缀）

所有 Specline 生成到用户项目中的文件统一使用 `specline-` 前缀命名，避免与用户已有文件或 OpenSpec 文件冲突。

#### Scenario: Agent 文件带前缀

- **WHEN** `specline init` 完成后
- **THEN** `.cursor/agents/` 下所有文件以 `specline-` 开头（如 `specline-spec-creator.md`）

#### Scenario: Skill 目录带前缀

- **WHEN** `specline init` 完成后
- **THEN** `.cursor/skills/` 下所有 Skill 目录以 `specline-` 开头（如 `specline-pipeline/`）

#### Scenario: Hook 脚本带前缀

- **WHEN** `specline init` 完成后
- **THEN** `.cursor/hooks/` 下所有脚本文件以 `specline-` 开头（如 `specline-pipeline-gate.sh`）

#### Scenario: hooks.json 不加前缀

- **WHEN** `specline init` 完成后
- **THEN** `.cursor/hooks.json` 保持原始名称（Cursor IDE 标准文件名，不可修改）

#### Scenario: 运行时目录使用 specline/

- **WHEN** `specline init` 完成后
- **THEN** 项目根目录下创建 `specline/`（而非 `openspec/`）
- **AND** `specline/config.yaml`、`specline/changes/`、`specline/specs/` 均使用 specline 命名空间

---

### Requirement: openspec CLI 替代

流水线运行过程中所有原本依赖 OpenSpec CLI 的功能，全部由内部的 `specline-pipeline-gate.sh` 脚本提供，用户无需安装 `@fission-ai/openspec`。所有运行时路径使用 `specline/` 目录。

#### Scenario: 替代 openspec new change

- **WHEN** 流水线需要创建新的 change 目录
- **THEN** 调用 `specline-pipeline-gate.sh new --change "<name>"` 代替 `openspec new change "<name>"`
- **AND** 创建 `specline/changes/<name>/` 目录 + `.specline.yaml` + `.pipeline-state.json` + `specs/` 子目录

#### Scenario: 替代 openspec list

- **WHEN** 流水线需要列出所有活跃 change
- **THEN** 调用 `specline-pipeline-gate.sh list --json` 代替 `openspec list --json`
- **AND** 扫描 `specline/changes/*/` 目录，返回每个 change 的 name + current_phase

#### Scenario: 替代 openspec status（artifact 状态）

- **WHEN** 流水线需要检查 artifact 完成状态
- **THEN** 调用 `specline-pipeline-gate.sh artifacts --change "<name>" --json` 代替 `openspec status --change "<name>" --json`
- **AND** 返回 4 个 artifact 文件在 `specline/changes/<name>/` 下的存在状态（proposal/design/tasks/specs）

#### Scenario: 替代 openspec archive

- **WHEN** 流水线需要归档已完成的 change
- **THEN** 调用 `specline-pipeline-gate.sh archive --change "<name>" --execute` 代替 `openspec archive "<name>"`
- **AND** 执行 spec delta 合并 + 移动到 `specline/changes/archive/` + 状态更新

---

### Requirement: Spec 生成（propose 替代）

spec-creator Agent 不再调用外部 `openspec propose` 命令，而是直接基于内联模板生成 4 个规划文件到 `specline/changes/<name>/` 目录。

#### Scenario: spec-creator 生成 proposal.md

- **WHEN** spec-creator Agent 被调用
- **AND** 收到自然语言需求和 change name
- **THEN** 在 `specline/changes/<name>/proposal.md` 中生成包含 What/Why/Scope/Non-goals 的内容

#### Scenario: spec-creator 生成 specs

- **WHEN** proposal.md 生成完成
- **THEN** 在 `specline/changes/<name>/specs/<capability>/spec.md` 中生成 Specifications
- **AND** 包含 `## Purpose` + `## Requirements` 章节
- **AND** 每个 Requirement 至少 1 个 Scenario
- **AND** 每个 Scenario 含 **WHEN**/**THEN** 配对

#### Scenario: spec-creator 生成 design.md

- **WHEN** specs 生成完成
- **THEN** 在 `specline/changes/<name>/design.md` 中生成技术设计
- **AND** 包含 Architecture/DataFlow/Tradeoffs 章节

#### Scenario: spec-creator 生成 tasks.md

- **WHEN** design.md 生成完成
- **THEN** 在 `specline/changes/<name>/tasks.md` 中生成任务清单
- **AND** 每个任务含 **Type**/**Depends**/**Covers**/**Files** 标注
- **AND** `Depends: (none)` 的任务占比 ≥ 60%

#### Scenario: spec-creator 自检失败时重试

- **WHEN** tasks.md 中独立任务占比 < 60%
- **THEN** spec-creator 自动重试拆分任务，最多 2 次
- **AND** 重试后仍 < 60% 记录警告但不阻塞

---

### Requirement: npm 分发包

Specline 作为 npm 包发布，package.json 正确配置 bin 入口和发布文件列表。

#### Scenario: npm install 安装

- **WHEN** 用户执行 `npm install -g specline`
- **THEN** 系统中全局注册 `specline` 命令
- **AND** `specline --version` 输出版本号

#### Scenario: npx 运行（无需全局安装）

- **WHEN** 用户执行 `npx specline init`
- **THEN** 自动下载并执行 init 命令
- **AND** 效果与全局安装后运行 `specline init` 一致

#### Scenario: package.json 配置正确

- **WHEN** 维护者查看 package.json
- **THEN** `"bin": { "specline": "./cli.mjs" }` 已配置
- **AND** `"files": ["cli.mjs", "templates/"]` 已配置
- **AND** `"engines": { "node": ">=20.0.0" }` 已配置
