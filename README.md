# Specline

面向 Cursor IDE 的 **Spec 驱动 AI 编码流水线**，内置确定性质量门禁。

自然语言需求 → 自动走完 编写规格 → 编码 → 审查 → 测试 → 归档 全流程：

```
/specline-pipeline "实现用户登录功能"
```

修 bug、改配置、文档微调？用轻量模式：

```
/specline-quickfix "修复登录按钮样式"
```

## 它能做什么

**完整流水线**（新功能、重构）：

```
自然语言需求 → Spec → 审核 → 编码 → 审查 → 测试 → 归档
                ↑       ↑      ↑      ↑      ↑      ↑
           spec-    spec-  前后端/  code/ 单元/   ✓ 完成
          creator  reviewer config config  集成/
                  并行              reviewer  E2E
```

**轻量修复**（修 bug、改配置、文档微调）：

```
/ specline-quickfix "描述" → 理解代码 → 直接编辑 → Lint+自审 → 现有单测 → 轻量归档
                             0 个子 Agent      0 个人工确认      0 个 state 文件
```

每个阶段都经过 **确定性门禁校验** —— 用 `grep`、`jq`、编译器退出码、测试退出码判断通过与否。**质量判断零 LLM 参与**。

## 核心特性

- **需求驱动**：自然语言 → 结构化规格文档（Requirements + Scenarios + WHEN/THEN）
- **并行编码**：自动按前端/后端/config 拆分任务，同批次并发派发 Coding Agent
- **TDD 白盒测试**：无依赖任务自动启用 TDD 模式（先写单测 → 确认失败 → 最小实现 → 重构），与黑盒 test-writer 并行协作
- **确定性门禁**：每个阶段用 Shell 脚本的退出码判定是否通过，不做模糊判断
- **黑盒测试**：测试 Agent 只看 Spec 文档，不能读取任何实现源码
- **断点续跑**：随时中断，下次从最后一个可信门禁自动恢复（tasks.md 的 `[x]`/`[ ]` 标记进度）
- **人机协作**：3 个人工检查点——Spec 确认、Review 可选复核、归档确认，支持 `full`/`minimal`/`none` 三级自动化策略配置（`specline/config.yaml` 中 `pipeline.human_gate_policy`）
- **Hook 约束体系**：sessionStart 注入 pipeline 上下文 → preToolUse 违规拦截 → postToolUse 操作后提醒，确保长对话中 Agent 不偏离流水线逻辑
- **安全 Hook**：自动拦截危险 Shell 命令（如 `rm -rf`、`curl|bash`）+ 代码变更后自动格式化
- **零外部依赖**：不依赖 OpenSpec CLI，全部功能自包含

## 快速开始

```bash
# 全局安装
npm install -g specline

# 在项目中初始化
cd my-project
specline init

# 或者用 npx（无需安装）
npx specline init

# 检查 CLI 更新
specline update

# 同步项目模板文件到最新版本
specline sync
specline sync --dry-run    # 预览变更
```

初始化后项目会获得完整的流水线基础设施：

```
my-project/
├── .cursor/
│   ├── agents/          ← 9 个 Specline Agent 定义
│   ├── commands/        ← 3 个 Slash 命令入口
│   ├── skills/          ← 6 个 Skill 指令
│   │   └── specline-pipeline/
│   │       ├── SKILL.md         ← 核心编排指令（~500 行）
│   │       ├── templates/       ← 子 Agent prompt 模板
│   │       └── references/      ← Schema / 事件日志 / 约束参考文档
│   ├── hooks/           ← 7 个 Gate/Hook 脚本
│   └── hooks.json       ← Cursor Hook 配置
├── specline/            ← 运行时目录
│   ├── config.yaml      ← 项目配置（含 pipeline 人机门禁策略）
│   ├── changes/         ← 变更目录
│   │   └── archive/     ← 归档目录
│   └── specs/           ← 主规格目录
└── .specline-config.yaml
```

然后在 Cursor 中输入：

```
/specline-pipeline "添加 JWT 用户认证"
```

小改动用快速模式：

```
/specline-quickfix "修改按钮颜色"
```

开始编码前先探索思路：

```
/specline-explore
```

## 工作流选择

Specline 提供两种工作流，按变更规模选择：

| 维度 | Quickfix (`/specline-quickfix`) | Pipeline (`/specline-pipeline`) |
|------|-------------------------------|-------------------------------|
| 文件改动数 | 1-3 个 | 4+ 个 |
| 关注点 | 单一关注点 | 多关注点/跨模块 |
| 架构变更 | 无新架构/新组件 | 需要新组件/新 API |
| 测试 | 不需要新测试 | 需要写新测试 |
| 典型场景 | 修 bug、改配置、文档微调 | 新增功能、重构 |
| 产出 | summary.md + files-changed.json | proposal/design/tasks/specs + 全部测试 |
| 人工确认 | 0 个 | 3 个 |
| 耗时 | 1-3 分钟 | 10-30 分钟 |

**使用建议**：如果不确定，优先用 quickfix。如果需要更严格的流程保证，用 pipeline。

## 完整流水线阶段

```
PHASE 1: SPEC（规格）
  specline-spec-creator 生成 4 个规划文件
    ├── proposal.md    — 需求提案（What/Why/Scope）
    ├── specs/*/spec.md — 功能规格（Requirements/Scenarios/WHEN-THEN）
    ├── design.md      — 技术设计（架构/数据流/决策）
    └── tasks.md       — 任务清单（Type/Depends/Covers/Testable/Files + [ ] 进度标记）
  → specline-spec-reviewer 审核
  → Gate: grep + jq 格式校验 + semantic 语义检查（Covers 引用悬空 / 依赖环路 / 异常场景缺失 / 模糊需求检测）
  → 🟡 人工确认 Spec 和任务规划（策略可配：`full` 需确认 / `minimal` `none` 自动通过）

PHASE 2: CODING（编码）
  解析 tasks.md → 按依赖 DAG 分层 → 同批次前后端/config Agent 并发
  无依赖 + 可测试任务 → 自动启用 TDD 模式（RED-GREEN-REFACTOR）
  每完成一个任务，[ ] 自动标记为 [x]
  → Gate: 编译检查（tsc --noEmit / python -m compileall） + 单元测试文件存在性检查

PHASE 3: REVIEW（审查）
  specline-code-reviewer + specline-config-reviewer 分别审查代码和配置/文档
  → Gate: Lint 检查 + code-review.json error 计数

PHASE 4: TEST（测试）
  单元测试 → 集成测试 → E2E 测试（黑盒，只看 Spec）
  → config/docs 变更自动跳过测试
  → 失败自动分析：测试写错了 / 代码写错了 / Spec 模糊
  → 自动重试最多 2 次

PHASE 5: ARCHIVE（归档）
  → 🟡 人工确认归档（策略可配：`full` `minimal` 需确认 / `none` 自动归档）
  → delta specs 合并到主规格目录
  → 按日期归档到 specline/changes/archive/
  ✅ 完成

### TDD 白盒测试

Pipeline 采用「两层测试分离」架构：

```
Coding Agent（白盒 TDD）              Test-Writer（黑盒）
─────────────────────────            ─────────────────
产出: tests/unit/**                  产出: tests/integration/**
      tests/models/**                      tests/e2e/**
测试: 单个函数的输入输出              测试: 跨模块的用户行为
      边界条件、异常路径                     API 端到端契约
      Spec Scenario 全覆盖
触发: 编码时同步产出                   触发: Phase 2 与 Coding 并行启动
      先写测试 → 确认失败 → 写实现        只读 Spec，不读源码
```

tasks.md 中 `Testable: true` 的任务自动启用 TDD 模式（完整 RED-GREEN-REFACTOR 循环），`Testable: false` 的任务保持原有流程。两个测试域严格目录隔离，冲突检测自动识别越界。
```

## 轻量修复流程

```
PHASE 1: UNDERSTAND（理解）
  读取相关代码 → 理解上下文 → 意图模糊时 AskUserQuestion 确认

PHASE 2: IMPLEMENT（实现）
  直接 Write/StrReplace 编辑 1-3 个文件
  不需要 Spec 文档、DAG 构建、批次调度

PHASE 3: REVIEW（审查）
  ReadLints 检查 + 自动修复（最多 2 次）→ Agent 自审逻辑正确性

PHASE 4: TEST（测试）
  仅运行项目已有单元测试，无测试则跳过
  失败自动修复最多 2 次

PHASE 5: ARCHIVE（归档）
  生成 summary.md + files-changed.json → 询问是否 git commit
```

## 架构

```
/specline-pipeline       ← 完整流水线（大功能）    /specline-quickfix    ← 轻量修复（小改动）
    │                                                  │
    ▼                                                  ▼
specline-pipeline SKILL  ← 编排层                 编排者直接执行（无子 Agent）
    │                                               Read → Write → ReadLints → Shell → 归档
    ├── SKILL.md           核心编排指令（~500 行）
    ├── templates/         subagent-prompts.md（3 套 prompt 模板）
    └── references/        Schema / 事件日志 / 约束参考文档
    │
┌───┼──────────────────┬──────────────────────┐
▼   ▼                  ▼                      ▼
9 个子 Agent      specline-pipeline-     Cursor Hooks
（创造性工作）      gate.sh              （安全网 + 约束）
                  （确定性门禁）
```

## CLI 命令

| 命令 | 说明 |
|------|------|
| `specline init [path]` | 在指定路径（默认当前目录）初始化 Specline 项目，复制模板文件并生成锁文件 |
| `specline update` | 检查 CLI 是否有新版本可用（npm registry），输出更新提示 |
| `specline sync [--dry-run] [path]` | 将上游最新模板文件同步到项目，基于 Lock File 智能识别安全更新/冲突/仅本地修改。hooks.json 语义合并（保留用户自定义 hook）、config.yaml 注释级更新（保留用户配置值）、CONFLICT 覆盖前自动创建 `.orig` 备份。`--dry-run` 预览变更不实际写入 |
| `specline --version` | 显示当前 CLI 版本号 |
| `specline --help` | 显示帮助信息 |

## 子 Agent 列表

| Agent | 职责 |
|-------|------|
| `specline-spec-creator` | 根据自然语言需求，基于内联模板直接生成 proposal/design/tasks/spec 四个文件 |
| `specline-spec-reviewer` | 审核规格的完整性、一致性和覆盖度 |
| `specline-frontend-dev` | UI 组件、页面、样式、交互逻辑（单个任务级别，Testable 任务启用 TDD） |
| `specline-backend-dev` | API 端点、数据模型、业务逻辑（单个任务级别，Testable 任务启用 TDD） |
| `specline-config-dev` | Shell 脚本、配置文件（JSON/YAML）、Markdown 文档（处理 Type: config/docs 任务） |
| `specline-code-reviewer` | 前端/后端代码质量、安全性、可维护性审查 |
| `specline-config-reviewer` | Shell 脚本安全性、配置文件语法和一致性、Markdown 文档结构审查 |
| `specline-test-writer` | 黑盒测试编写——只能看 Spec 不能读源码，仅写集成测试（tests/integration/）和 E2E 测试 |
| `specline-test-runner` | 执行测试并分类失败原因（测试问题/代码问题/Spec 模糊），区分单元测试（回 coding agent）和集成/E2E 测试（回 test-writer） |

## 确定性门禁

每个门禁都是 Shell 脚本，`exit 0` = 通过，`exit 1` = 失败：

| 门禁 | 检查内容 |
|------|---------|
| Spec | 结构性检查（`grep` 检查章节完整性、WHEN/THEN 配对、字段格式）+ 语义检查（`semantic` 子命令：Covers 引用悬空、依赖环路、异常场景缺失、模糊需求、反向覆盖、Type-文件一致性，分 ERROR/WARNING/INFO 三级严重度） |
| Build | `tsc --noEmit` / `python -m compileall` 编译检查 + Testable 任务单元测试文件存在性与语法检查 |
| Lint | `ruff` / `eslint` 退出码 + code-review.json 中 error 数量 |
| Test | 测试框架退出码 + 覆盖率阈值 |
| Archive | 归档目录结构 + 必要文件完整性 |

## Hook 约束体系

Specline 通过 Cursor Hooks 构建三层约束，确保长对话中 Agent 始终遵循流水线的阶段逻辑：

| Hook | 时机 | 作用 |
|------|------|------|
| `sessionStart` | 新会话启动 | 扫描活跃 pipeline，自动注入阶段上下文到 Agent 系统提示 |
| `preToolUse` | 工具调用前 | 阶段校验：SPEC 阶段拦截代码编辑、阶段不匹配的子 Agent 启动 |
| `postToolUse` | 工具调用后 | 注入下一步提醒：更新 tasks.md checkbox、运行 Gate 脚本 |
| `subagentStart` | 子 Agent 启动前 | 白名单 + 阶段匹配双校验 |
| `beforeShellExecution` | Shell 命令执行前 | 拦截危险命令（`rm -rf`、`curl\|bash`、`sudo`） |
| `afterFileEdit` | 文件编辑后 | 自动格式化代码 |

> 非流水线会话完全透明——所有 Hook 第一步检查「是否有活跃 pipeline」，无则直接放行。

## 环境要求

- **Cursor IDE**（支持 hooks 和 skills）
- **jq**（Gate 脚本 JSON 处理）
  - macOS 预装
  - Linux: `apt install jq`
  - Windows: `choco install jq`

## License

MIT
