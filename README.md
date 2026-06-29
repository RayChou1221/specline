# Specline

**Spec 驱动 AI 编码流水线**，内置确定性质量门禁。

自然语言需求 → 自动走完 编写规格 → 编码 → 审查 → 测试 → 归档 全流程：

```
/specline-pipeline "实现用户登录功能"
```

修 bug、改配置、文档微调？用轻量模式：

```
/specline-quickfix "修复登录按钮样式"
```

整理面向 AI 的项目知识库？一个命令搞定：

```
/specline-knowledge
```

## 支持平台

| 平台 | 状态 | 说明 |
|------|------|------|
| **Cursor** | ✅ 完整支持 | Skills + Agents + Hooks 原生集成 |
| **Claude Code** | ✅ 完整支持 | Skills + Agents + settings.json hooks |
| **Codex** | ✅ 完整支持 | Skills + TOML Agents + hooks.json |
| **OpenCode** | ✅ 完整支持 | Skills + Plugin + prompt 内嵌 agents |

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
- **跨平台**：同一套 Spec 驱动流水线，适配 Cursor / Claude Code / Codex / OpenCode
- **并行编码**：自动按前端/后端/config 拆分任务，同批次并发派发 Coding Agent
- **TDD 白盒测试**：无依赖任务自动启用 TDD 模式（先写单测 → 确认失败 → 最小实现 → 重构），与黑盒 test-writer 并行协作
- **确定性门禁**：每个阶段用 Shell 脚本的退出码判定是否通过，不做模糊判断
- **黑盒测试**：测试 Agent 只看 Spec 文档，不能读取任何实现源码
- **断点续跑**：随时中断，下次从最后一个可信门禁自动恢复（tasks.md 的 `[x]`/`[ ]` 标记进度）
- **人机协作**：3 个人工检查点——Spec 确认、Review 可选复核、归档确认，支持 `full`/`minimal`/`none` 三级自动化策略配置
- **AI 知识库**：自动检测、生成、更新六类项目知识文件（术语表/架构/约定/决策/参考/操作指南）
- **零外部依赖**：不依赖 OpenSpec CLI，全部功能自包含

## 快速开始

```bash
# 全局安装
npm install -g specline

# 在项目中初始化（交互式选择平台）
cd my-project
specline init

# 指定平台初始化
specline init --platform cursor
specline init --platform cursor,claude
specline init --platform all

# 或者用 npx（无需安装）
npx specline init --platform cursor
```

### `--platform` 参数

| 值 | 说明 |
|----|------|
| `cursor` | 部署 Cursor IDE 集成（默认） |
| `claude` | 部署 Claude Code 集成 |
| `codex` | 部署 Codex 集成 |
| `opencode` | 部署 OpenCode 集成 |
| `all` | 部署全部平台 |

TTY 环境下不指定 `--platform` 时进入交互式多选界面；非 TTY 环境默认 `cursor`。

## Upgrading

```bash
# 升级 CLI 到最新版本
npm update -g specline

# 同步项目文件到最新模板
specline sync

# 预览同步变更（不实际写入）
specline sync --dry-run
```

v1 用户升级到 v2 详见 [迁移指南](docs/migration/v1-to-v2.md)。

## 架构

```
specline init --platform <list>
    │
    ▼
┌─────────────────────────────────────────────────────────────┐
│  core/                        ← 平台无关的源文件             │
│  ├── skills/                  ← 7 个 Skill（含模板变量）     │
│  ├── agents/                  ← Agent YAML Canonical        │
│  ├── gates/                   ← 确定性门禁脚本              │
│  ├── hooks/                   ← SessionStart hook 源       │
│  └── bootstrap/               ← 通用 bootstrap 文档        │
├─────────────────────────────────────────────────────────────┤
│  adapters/<platform>/         ← 平台特定配置                │
│  ├── deploy.json              ← 部署描述（目录/格式/变量）   │
│  ├── hooks.json               ← 平台 Hook 配置             │
│  └── orchestration.md         ← 工具映射参考                │
├─────────────────────────────────────────────────────────────┤
│  lib/                         ← CLI 模块                    │
│  ├── render.mjs               ← Skill/Agent 渲染器         │
│  ├── deploy.mjs               ← 单平台部署逻辑             │
│  ├── lock.mjs                 ← Lock file v2 读写          │
│  └── ...                                                    │
└─────────────────────────────────────────────────────────────┘
    │
    ▼ 渲染 + 部署
┌─────────────────────────────────────────────────────────────┐
│  项目目录                                                    │
│  ├── .cursor/   (Cursor)                                    │
│  ├── .claude/   (Claude Code)                               │
│  ├── .agents/   (Codex)                                     │
│  ├── .opencode/ (OpenCode)                                  │
│  └── specline/  ← 运行时（跨平台共享）                       │
│      ├── config.yaml                                        │
│      ├── platforms.yaml                                     │
│      ├── changes/                                           │
│      └── bin/gate.sh                                        │
└─────────────────────────────────────────────────────────────┘
```

初始化后在对应平台中输入：

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

让 AI 理解你的项目：

```
/specline-knowledge
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
  → Gate: grep + jq 格式校验 + semantic 语义检查
  → 🟡 人工确认 Spec 和任务规划

PHASE 2: CODING（编码）
  解析 tasks.md → 按依赖 DAG 分层 → 同批次前后端/config Agent 并发
  无依赖 + 可测试任务 → 自动启用 TDD 模式（RED-GREEN-REFACTOR）
  每完成一个任务，[ ] 自动标记为 [x]
  → Gate: 编译检查 + 单元测试文件存在性检查

PHASE 3: REVIEW（审查）
  specline-code-reviewer + specline-config-reviewer 分别审查代码和配置/文档
  → Gate: Lint 检查 + code-review.json error 计数

PHASE 4: TEST（测试）
  单元测试 → 集成测试 → E2E 测试（黑盒，只看 Spec）
  → 失败自动分析 + 自动重试最多 2 次

PHASE 5: ARCHIVE（归档）
  → 🟡 人工确认归档
  → delta specs 合并到主规格目录
  → 按日期归档到 specline/changes/archive/
  ✅ 完成
```

## CLI 命令

| 命令 | 说明 |
|------|------|
| `specline init [--platform <list>]` | 初始化 Specline 项目，支持多平台部署 |
| `specline sync [--dry-run] [--platform <list>]` | 同步模板文件到最新版本 |
| `specline gate <subcommand>` | Gate 门禁 CLI 包装（spec/build/lint/test/list） |
| `specline hook session-start [--platform <p>]` | 跨平台 SessionStart hook |
| `specline platforms` | 查看已部署平台列表 |
| `specline update` | 检查 CLI 新版本 |
| `specline --version` | 显示版本号 |
| `specline --help` | 显示帮助信息 |

## 子 Agent 列表

| Agent | 职责 |
|-------|------|
| `specline-spec-creator` | 根据自然语言需求生成 proposal/design/tasks/spec |
| `specline-spec-reviewer` | 审核规格的完整性、一致性和覆盖度 |
| `specline-frontend-dev` | UI 组件、页面、样式、交互逻辑 |
| `specline-backend-dev` | API 端点、数据模型、业务逻辑 |
| `specline-config-dev` | Shell 脚本、配置文件、Markdown 文档 |
| `specline-code-reviewer` | 代码质量、安全性、可维护性审查 |
| `specline-config-reviewer` | 配置文件语法、Shell 脚本安全性审查 |
| `specline-test-writer` | 黑盒测试编写（只看 Spec 不读源码） |
| `specline-test-runner` | 执行测试并分类失败原因 |
| `specline-explore-assistant` | 设计压力测试，辅助探索模式 |

## Skills 列表

| Skill | 入口 | 说明 |
|-------|------|------|
| `specline-pipeline` | `/specline-pipeline <需求>` | 完整开发流水线编排 |
| `specline-quickfix` | `/specline-quickfix <描述>` | 轻量修复（1-3 文件） |
| `specline-propose` | 由 pipeline 调度 | 生成 Spec 规划文件 |
| `specline-apply-change` | 由 pipeline 调度 | 执行 tasks.md 中的任务 |
| `specline-explore` | `/specline-explore` | 探索模式，思考伙伴 |
| `specline-archive-change` | 由 pipeline 调度 | 归档完成的 Change |
| `specline-knowledge` | `/specline-knowledge` | AI 知识库管理 |

## 确定性门禁

每个门禁都是 Shell 脚本，`exit 0` = 通过，`exit 1` = 失败：

| 门禁 | 检查内容 |
|------|---------|
| Spec | 结构性检查 + 语义检查（Covers 引用悬空、依赖环路、异常场景缺失、模糊需求） |
| Build | 编译检查 + Testable 任务单元测试文件存在性 |
| Lint | Linter 退出码 + code-review.json error 数量 |
| Test | 测试框架退出码 + 覆盖率阈值 |
| Archive | 归档目录结构 + 必要文件完整性 |

## 环境要求

- **Node.js** >= 20.0.0
- **jq**（Gate 脚本 JSON 处理）
  - macOS 预装
  - Linux: `apt install jq`
  - Windows: `choco install jq`
- **支持的 AI 编码平台**（至少一个）：Cursor / Claude Code / Codex / OpenCode

## License

MIT
