# Specline

**Spec 驱动 AI 编码流水线**，内置确定性质量门禁。

自然语言需求 → 自动走完 编写规格 → 执行合同 → 编码 → 审查 → 测试 → 归档 全流程：

```text
/specline-pipeline "实现用户登录功能"
```

修 bug、改配置、文档微调？用轻量模式：

```text
/specline-quickfix "修复登录按钮样式"
```

整理面向 AI 的项目知识库？一个命令搞定：

```text
/specline-knowledge
```

## 支持平台

| 平台 | 状态 | 说明 |
| ------ | ------ | ------ |
| **Cursor** | ✅ 完整支持 | Skills + Agents + Hooks 原生集成 |
| **Claude Code** | ✅ 完整支持 | Skills + Agents + settings.json hooks |
| **Codex** | ✅ 完整支持 | Skills + TOML Agents + hooks.json |
| **OpenCode** | ✅ 完整支持 | Skills + Plugin + prompt 内嵌 agents |

## 功能一览

| 功能 | 入口 | 适用场景 | 状态 |
| ------ | ------ | ---------- | ------ |
| **完整开发流水线** | `/specline-pipeline <需求>` | 新功能、重构、跨模块改动；覆盖 Spec、执行合同、编码、审查、测试和归档 | ✅ 可用 |
| **轻量修复** | `/specline-quickfix <描述>` | 1–3 个文件的 bug、配置或文档修改 | ✅ 可用 |
| **需求探索** | `/specline-explore` | 编码前澄清需求、调查代码、比较方案和暴露风险 | ✅ 可用 |
| **HTML 原型可视化** | `/specline-visualize` | 将已收敛讨论制作成可持续修改的自包含单文件 HTML 原型 | ✅ 可用 |
| **Web 项目初始化** | `/specline-init-web [目录]` | 在通过空目录安全检查后生成 React/Vue + Vite + TypeScript + Go/Gin 骨架 | ✅ 可用 |
| **AI 项目知识库** | `/specline-knowledge` | 生成或更新术语、架构、约定、决策、参考和操作指南 | ✅ 可用 |
| **本地可编辑关系图** | `/specline-diagram` | 经上游 `@next-ai-drawio/mcp-server` 创建和增量修改 `.drawio`；缺 MCP 时引导首次 setup，失败时回退 ASCII | ✅ 可用 |
| **多平台部署与同步** | `specline init` / `specline sync` | 将同一套 Skills、Agents、Hooks 部署到 Cursor、Claude Code、Codex、OpenCode | ✅ 可用 |

> Diagram 是可选便利入口：Specline 不维护受管 Draw.io runtime，也不提供 `specline diagram` CLI。日常直接调用上游 MCP；首次缺失时由薄 Skill 询问 MCP 落点（推荐用户级）、写入 `npx @next-ai-drawio/mcp-server@latest` 并引导重载一次。`init` / `sync` 不会静默写入各平台 MCP。简单关系继续用 Explore 的 ASCII，单文件 HTML 原型继续用 `/specline-visualize`，三者不合并。操作指南见 [本地 Draw.io Diagram](docs/knowledge/howtos/local-drawio-diagrams.md)。

### 完整流水线（新功能、重构）

```text
自然语言需求 → Spec → 审核 → 执行合同 → 编码 → 审查 → 测试 → 归档
                ↑       ↑        ↑        ↑      ↑      ↑      ↑
           spec-    spec-  approved+fresh 前后端/ code/ 单元/   ✓ 完成
          creator  reviewer  contract    config config  集成/
                           hash 绑定      并行  reviewer  E2E
```

### 轻量修复（修 bug、改配置、文档微调）

```text
/specline-quickfix "描述" → 理解代码 → 直接编辑 → Lint+自审 → 现有单测 → 轻量归档
                             0 个子 Agent      0 个人工确认      0 个 state 文件
```

每个阶段都经过 **确定性门禁校验** —— 用 `grep`、`jq`、编译器退出码、测试退出码判断通过与否。**质量判断零 LLM 参与**。

## 核心特性

- **需求驱动**：自然语言 → 结构化规格文档（Requirements + Scenarios + WHEN/THEN）
- **跨平台**：同一套 Spec 驱动流水线，适配 Cursor / Claude Code / Codex / OpenCode
- **安全初始化**：`specline-init-web` 通过两次只读扫描和 create-exclusive 写入，为空项目生成 React/Vue + Go/Gin 全栈骨架
- **探索与原型**：`specline-explore` 负责澄清和收敛，`specline-visualize` 输出无 CDN、无外部请求的自包含单文件 HTML 原型；复杂可编辑关系图经同意后交接 `specline-diagram`
- **可控同步**：区分 configured platforms 与单次 target scope；scoped sync 不改写省略平台的文件、lock 条目或 baseline hash
- **执行合同**：SPEC 确认后生成 `execution-contract.md`，绑定规划 artifact hash；CODING 前必须 approved + fresh
- **并行编码**：自动按前端/后端/config 拆分任务，同批次并发派发 Coding Agent
- **TDD 白盒测试**：无依赖任务自动启用 TDD 模式（先写单测 → 确认失败 → 最小实现 → 重构），与黑盒 test-writer 并行协作
- **确定性门禁**：每个阶段用 Shell 脚本的退出码判定是否通过，不做模糊判断
- **黑盒测试**：测试 Agent 只看 Spec 文档，不能读取任何实现源码
- **断点续跑**：随时中断，下次从最后一个可信门禁自动恢复（tasks.md 的 `[x]`/`[ ]` 标记进度）
- **人机协作**：3 个人工检查点——Spec 确认、Review 可选复核、归档确认，支持 `full`/`minimal`/`none` 三级自动化策略配置
- **AI 知识库**：自动检测、生成、更新六类项目知识文件（术语表/架构/约定/决策/参考/操作指南）
- **本地可编辑图**：薄 `specline-diagram` Skill + 上游 Next AI Draw.io MCP；首次按需配置当前平台；失败可恢复并回退 ASCII
- **前端设计纪律**：可见 UI Change 经 UI Design Brief → `frontend-design` Skill → 证据型 Code Review；纯逻辑前端任务不触发；不把主观审美做成确定性 Gate
- **核心流水线自包含**：不依赖 OpenSpec CLI，也不引入运行时第三方 npm 依赖；上游 drawio MCP 经 `npx` 按需使用，不进入常驻依赖

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

# 可选：启用 shell 命令安全防护 Hook
specline init --with-shell-guard

# 或者用 npx（无需安装）
npx specline init --platform cursor
```

### `--platform` 参数

| 值 | 说明 |
| ---- | ------ |
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

# 同步共享受管文件和全部已配置平台
specline sync

# 预览同步变更（不实际写入）
specline sync --dry-run

# 仅将本次同步限定为共享文件和 Cursor 文件
specline sync --platform cursor
```

`sync` 会区分项目持久化的 **configured platforms** 与单次执行的 **target platforms**：

- configured platforms 按首个权威来源解析：`specline/platforms.yaml` → schema 2 lock 的 `platforms` → legacy 平台目录检测 → 默认 `cursor`，来源之间不会取并集。
- YAML 或 schema 2 lock 中的显式空列表是权威配置；lock 会以 `platforms: []` 持久化该状态。此时默认 sync 只同步共享受管文件。
- 不带 `--platform` 时，target platforms 是全部 configured platforms；带 `--platform <list>` 时，只同步共享受管文件和请求的平台。请求未配置的平台也不会改变项目的平台成员关系。
- scoped sync 只计划、更新或删除当前 scope 内的路径。省略平台的本地文件、lock 条目及其 baseline hash 原样保留，`UPSTREAM_REMOVED` 不会跨 scope 生效。
- `specline sync --platform none`、缺值、空值或未知平台均为错误；`none` 只对 `specline init --platform none` 合法。
- 已由旧版本写入 YAML 或 v2 lock 的平台元数据仍视为权威配置，sync 不会猜测用户意图或自动清理相关元数据和文件。

> 兼容性提醒：依赖旧版未文档化行为、期望 `sync --platform` 破坏性重写平台成员关系或清除其他平台 lock 条目的脚本需要调整；`--platform` 现在只限定本次同步。

v1 用户升级到 v2 详见 [迁移指南](docs/migration/v1-to-v2.md)。

## 架构

```text
specline init --platform <list>
    │
    ▼
┌─────────────────────────────────────────────────────────────┐
│  core/                        ← 平台无关的源文件             │
│  ├── skills/                  ← Skill 源（含模板变量；含 frontend-design） │
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
│  ├── sync-options.mjs         ← sync scope 参数解析         │
│  └── ...                                                    │
└─────────────────────────────────────────────────────────────┘
    │
    ▼ 渲染 + 部署
┌─────────────────────────────────────────────────────────────┐
│  项目目录                                                    │
│  ├── .cursor/   (Cursor)                                    │
│  ├── .claude/   (Claude Code)                               │
│  ├── .agents/skills  (Codex Skills，权威发现路径)             │
│  ├── .codex/    (Codex Agents + hooks)                      │
│  ├── .opencode/ (OpenCode)                                  │
│  └── specline/  ← 运行时（跨平台共享）                       │
│      ├── config.yaml                                        │
│      ├── platforms.yaml                                     │
│      ├── changes/                                           │
│      ├── prototypes/                                        │
│      ├── diagrams/            ← 约定 .drawio Artifact 目录  │
│      ├── templates/execution-contract.md                    │
│      ├── bin/gate.sh                                        │
│      └── bin/contract-check.mjs                             │
└─────────────────────────────────────────────────────────────┘
```

初始化后在对应平台中输入：

```text
/specline-pipeline "添加 JWT 用户认证"
```

小改动用快速模式：

```text
/specline-quickfix "修改按钮颜色"
```

开始编码前先探索思路：

```text
/specline-explore
```

把已收敛的讨论制作成 HTML 原型：

```text
/specline-visualize
```

安全初始化一个空 Web 项目：

```text
/specline-init-web
```

让 AI 理解你的项目：

```text
/specline-knowledge
```

需要可 GUI 编辑的复杂关系图时：

```text
/specline-diagram
```

若当前会话尚无上游 drawio MCP，Skill 会询问配置落点（推荐用户级）、写入 `npx @next-ai-drawio/mcp-server@latest`，并请你重载 Agent 一次后再继续。不再提供 `specline diagram` CLI。

## 工作流选择

Specline 提供两种工作流，按变更规模选择：

| 维度 | Quickfix (`/specline-quickfix`) | Pipeline (`/specline-pipeline`) |
| ------ | ------------------------------- | ------------------------------- |
| 文件改动数 | 1-3 个 | 4+ 个 |
| 关注点 | 单一关注点 | 多关注点/跨模块 |
| 架构变更 | 无新架构/新组件 | 需要新组件/新 API |
| 测试 | 不需要新测试 | 需要写新测试 |
| 典型场景 | 修 bug、改配置、文档微调 | 新增功能、重构 |
| 产出 | summary.md + files-changed.json | proposal/design/tasks/specs + execution-contract.md + 全部测试 |
| 人工确认 | 0 个 | 3 个 |
| 耗时 | 1-3 分钟 | 10-30 分钟 |

**使用建议**：如果不确定，优先用 quickfix。如果需要更严格的流程保证，用 pipeline。

## 完整流水线阶段

```text
PHASE 1: SPEC（规格）
  specline-spec-creator 生成 4 个规划文件
    ├── proposal.md     — 需求提案（What/Why/Scope）
    ├── specs/*/spec.md — 功能规格（Requirements/Scenarios/WHEN-THEN）
    ├── design.md       — 技术设计（架构/数据流/决策）
    └── tasks.md        — 任务清单（Type/Depends/Covers/Testable/Files + [ ] 进度标记）
  → specline-spec-reviewer 审核
  → Gate: grep + jq 格式校验 + semantic 语义检查
  → 🟡 人工确认 Spec 和任务规划
  → execution-contract.md（派生实现合同，记录 source artifact hash）
  → Gate: contract（approved + fresh + task/files/testable 覆盖）

PHASE 2: CODING（编码）
  以 execution-contract.md 作为 primary implementation authority
  解析 tasks.md → 按依赖 DAG 分层 → 同批次前后端/config Agent 并发
  无依赖 + 可测试任务 → 自动启用 TDD 模式（RED-GREEN-REFACTOR）
  visible-ui 任务 → 加载 frontend-design：Plan → 反模板 → Build → Verify → Refine
  每完成一个任务，[ ] 自动标记为 [x]
  → Gate: 编译检查 + 单元测试文件存在性检查

PHASE 3: REVIEW（审查）
  specline-code-reviewer + specline-config-reviewer 分别审查代码和配置/文档
  可见 UI 额外审查：设计系统兼容、Brief 一致性、响应式、焦点、reduced motion、文案与状态
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
| ------ | ------ |
| `specline init [--platform <list>] [--with-shell-guard]` | 初始化 Specline 项目，支持多平台部署和可选 shell 安全 Hook |
| `specline sync [--dry-run] [--platform <list>]` | 同步共享文件与指定 scope；不改变 configured platform 成员关系 |
| `specline gate <subcommand>` | Gate 门禁 CLI 包装（spec/semantic/contract/build/lint/test/list） |
| `specline hook session-start [--platform <p>]` | 跨平台 SessionStart hook |
| `specline platforms` | 查看已部署平台列表 |
| `specline update` | 检查 CLI 新版本 |
| `specline --version` | 显示版本号 |
| `specline --help` | 显示帮助信息 |

## 子 Agent 列表

| Agent | 职责 |
| ------- | ------ |
| `specline-spec-creator` | 根据自然语言需求生成 proposal/design/tasks/spec |
| `specline-spec-reviewer` | 审核规格的完整性、一致性和覆盖度 |
| `specline-frontend-dev` | UI 组件、页面、样式、交互；visible-ui 时执行 frontend-design 五阶段流程 |
| `specline-backend-dev` | API 端点、数据模型、业务逻辑 |
| `specline-config-dev` | Shell 脚本、配置文件、Markdown 文档 |
| `specline-code-reviewer` | 代码质量、安全性、可维护性；可见 UI 的证据型设计审查 |
| `specline-config-reviewer` | 配置文件语法、Shell 脚本安全性审查 |
| `specline-test-writer` | 黑盒测试编写（只看 Spec 不读源码） |
| `specline-test-runner` | 执行测试并分类失败原因 |
| `specline-explore-assistant` | 设计压力测试，辅助探索模式 |

## Skills 列表

| Skill | 入口 | 说明 |
| ------- | ------ | ------ |
| `specline-pipeline` | `/specline-pipeline <需求>` | 完整开发流水线编排 |
| `specline-quickfix` | `/specline-quickfix <描述>` | 轻量修复（1-3 文件） |
| `specline-propose` | 由 pipeline 调度 | 生成 Spec 规划文件（含 UI Design Brief 合同） |
| `specline-apply-change` | 由 pipeline 调度 | 执行 tasks.md 中的任务 |
| `specline-explore` | `/specline-explore` | 探索模式；按 ASCII / HTML 原型 / 可编辑 Diagram 路由表达方式 |
| `specline-visualize` | `/specline-visualize` | 生成可持续迭代的自包含单文件 HTML 原型 |
| `specline-init-web` | `/specline-init-web [目录]` | 安全生成 React/Vue + Vite + TypeScript + Go/Gin Web 骨架 |
| `specline-diagram` | `/specline-diagram` | 上游 MCP 便利入口：可编辑 `.drawio`；缺 MCP 时首次 setup + 重载；失败回退 ASCII |
| `specline-archive-change` | 由 pipeline 调度 | 归档完成的 Change |
| `specline-knowledge` | `/specline-knowledge` | AI 知识库管理 |
| `frontend-design` | 由 frontend Agent 加载 | 可见 UI 设计纪律（跨平台内置，附 Apache-2.0 归属） |

## 确定性门禁

每个门禁都是 Shell 脚本，`exit 0` = 通过，`exit 1` = 失败：

| 门禁 | 检查内容 |
| ------ | --------- |
| Spec | 结构性检查 + 语义检查（Covers 引用悬空、依赖环路、异常场景缺失、模糊需求） |
| Contract | `execution-contract.md` 存在、approved、source hash fresh、task/files/testable 映射完整 |
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

Specline 本体为 MIT。

内置 `frontend-design` Skill 派生自 [Anthropic skills/frontend-design](https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md)，按 Apache-2.0 随分发副本提供 `LICENSE` 与 `NOTICE.md`；该部分不得误标为 Specline MIT 原创。

Diagram 经上游 `@next-ai-drawio/mcp-server`（Apache-2.0）按需通过 `npx` 使用，不随 Specline 常驻依赖分发。用法见 [diagram-runtime.md](docs/diagram-runtime.md) 与 [本地 Draw.io Diagram](docs/knowledge/howtos/local-drawio-diagrams.md)。
