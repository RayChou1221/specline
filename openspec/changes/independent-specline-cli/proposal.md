# Proposal: Specline 独立 CLI 工具

## What

将 `/dev-pipeline` 开发流水线打包为独立的 `specline` CLI 命令行工具，用户通过 `npm install -g specline` 安装后，在项目中执行 `specline init` 即可一键初始化完整的开发流水线基础设施（Agent 定义、Skill 指令、Gate 脚本、Slash Command），且**不依赖 OpenSpec CLI**（`@fission-ai/openspec` 包），运行时目录使用 `specline/` 独立标识。

## Why

当前 `/dev-pipeline` 开发流水线存在两个关键问题：

1. **无标准分发机制**：用户需要手动复制 `.cursor/` 目录下的 20+ 个文件到自己的项目中，包括 agents、skills、commands、hooks 等。无法像 OpenSpec 的 `openspec init` 那样一键安装。

2. **依赖 OpenSpec CLI**：dev-pipeline SKILL 及其子 Agent（特别是 spec-creator）在多个关键节点调用了 OpenSpec 外部 CLI 命令（`openspec new change`、`openspec status`、`openspec list`、`openspec archive`、`openspec propose`），用户必须有 `@fission-ai/openspec` 全局安装才能运行流水线。

目标是让 Specline 成为**完全自包含的流水线产品**，用户只需 `specline init` 即可获得全部能力。

## Scope

### 包含

- **cli.mjs**：Node.js CLI 入口，实现 `specline init`、`specline --version`、`specline --help`
- **templates/ 目录**：所有需要复制到用户项目中的模板文件，全部带 `specline-` 前缀
- **运行时目录改为 `specline/`**：与 OpenSpec 生态完全解耦，`openspec/` → `specline/`
- **去 CLI 化改造**：所有 Skill 和 Agent 中移除对 `openspec` 外部命令的调用，替换为内部实现
- **pipeline-gate.sh 增强**：将原本 openspec CLI 提供的 `new`/`list`/`status`/`archive` 功能收进 gate 脚本
- **spec-creator.md 重写**：不再调用 `openspec propose`，直接内联 artifact 模板和生成逻辑

### 不包含

- 修改流水线 Phase 定义和执行逻辑（假设现有逻辑稳定）
- 新增流水线阶段或 Agent 类型
- npm 发布流程配置（CI/CD 部分）

### 文件命名约定

**生成文件前缀**：所有生成到用户项目中的文件统一加 `specline-` 前缀：

```
commands/   →   specline-pipeline.md / specline-explore.md
skills/     →   specline-pipeline/、specline-propose/ 等
agents/     →   specline-spec-creator.md、specline-frontend-dev.md 等
hooks/      →   specline-pipeline-gate.sh、specline-agent-guard.sh 等
```

例外：`hooks.json` 是 Cursor 标准文件名，不加前缀（需做冲突检测）。

**运行时目录**：`specline/`（不再沿用 `openspec/`）：
```
specline/
  config.yaml              ← 项目配置
  changes/                 ← 变更目录
    <change-name>/         ← 每个变更独立目录
      .specline.yaml       ← 变更元数据
      .pipeline-state.json
      proposal.md / design.md / tasks.md
      specs/               ← delta specs
    archive/               ← 归档
  specs/                   ← 主 specs 目录
```

## Impact

- 现有 dev-pipeline Skill 逻辑不变，只是相关引用路径更新（文件名加前缀 + `openspec/` → `specline/`）
- 项目 `package.json` 已有 `bin: { "specline": "./cli.mjs" }`，只需实现 `cli.mjs`
- 项目 `templates/` 目录需要新建，存放带前缀的模板文件
- 6 个 Agent 定义中 spec-creator.md 需要重写（去 openspec propose 依赖）
- 4 个 openspec-* Skill 需要重命名 + 移除对外部 CLI 的引用 + 路径改为 `specline/`
- pipeline-gate.sh 需要增加 `new`/`list`/`artifacts` 子命令 + 路径改为 `specline/`
- 所有 `openspec/changes/`、`openspec/specs/`、`.openspec.yaml` 路径引用改为 `specline/` 对应路径
