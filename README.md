# Specline

面向 Cursor IDE 的 **Spec 驱动 AI 编码流水线**，内置确定性质量门禁。

自然语言需求 → 自动走完 编写规格 → 编码 → 审查 → 测试 → 归档 全流程：

```
/specline-pipeline "实现用户登录功能"
```

## 它能做什么

```
自然语言需求 → Spec → 审核 → 编码 → 审查 → 测试 → 归档
                ↑       ↑      ↑      ↑      ↑      ↑
           spec-    spec-  前后端/  code/ 单元/   ✓ 完成
          creator  reviewer config config  集成/
                  并行              reviewer  E2E
```

每个阶段都经过 **确定性门禁校验** —— 用 `grep`、`jq`、编译器退出码、测试退出码判断通过与否。**质量判断零 LLM 参与**。

## 核心特性

- **需求驱动**：自然语言 → 结构化规格文档（Requirements + Scenarios + WHEN/THEN）
- **并行编码**：自动按前端/后端/config 拆分任务，同批次并发派发 Coding Agent
- **确定性门禁**：每个阶段用 Shell 脚本的退出码判定是否通过，不做模糊判断
- **黑盒测试**：测试 Agent 只看 Spec 文档，不能读取任何实现源码
- **断点续跑**：随时中断，下次从最后一个可信门禁自动恢复（tasks.md 的 `[x]`/`[ ]` 标记进度）
- **人机协作**：3 个人工检查点——Spec 确认、Review 可选复核、归档确认
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
│   ├── commands/        ← 2 个 Slash 命令入口
│   ├── skills/          ← 5 个 Skill 指令
│   ├── hooks/           ← 7 个 Gate/Hook 脚本
│   └── hooks.json       ← Cursor Hook 配置
├── specline/            ← 运行时目录
│   ├── config.yaml
│   ├── changes/         ← 变更目录
│   │   └── archive/     ← 归档目录
│   └── specs/           ← 主规格目录
└── .specline-config.yaml
```

然后在 Cursor 中输入：

```
/specline-pipeline "添加 JWT 用户认证"
```

开始编码前先探索思路：

```
/specline-explore
```

## 流水线阶段

```
PHASE 1: SPEC（规格）
  specline-spec-creator 生成 4 个规划文件
    ├── proposal.md    — 需求提案（What/Why/Scope）
    ├── specs/*/spec.md — 功能规格（Requirements/Scenarios/WHEN-THEN）
    ├── design.md      — 技术设计（架构/数据流/决策）
    └── tasks.md       — 任务清单（Type/Depends/Covers/Files + [ ] 进度标记）
  → specline-spec-reviewer 审核
  → Gate: grep + jq 格式校验
  → 🟡 人工确认 Spec 和任务规划

PHASE 2: CODING（编码）
  解析 tasks.md → 按依赖 DAG 分层 → 同批次前后端/config Agent 并发
  每完成一个任务，[ ] 自动标记为 [x]
  → Gate: 编译检查（tsc --noEmit / python -m compileall）

PHASE 3: REVIEW（审查）
  specline-code-reviewer + specline-config-reviewer 分别审查代码和配置/文档
  → Gate: Lint 检查 + code-review.json error 计数

PHASE 4: TEST（测试）
  单元测试 → 集成测试 → E2E 测试（黑盒，只看 Spec）
  → config/docs 变更自动跳过测试
  → 失败自动分析：测试写错了 / 代码写错了 / Spec 模糊
  → 自动重试最多 2 次

PHASE 5: ARCHIVE（归档）
  → 🟡 人工确认归档
  → delta specs 合并到主规格目录
  → 按日期归档到 specline/changes/archive/
  ✅ 完成
```

## 架构

```
/specline-pipeline       ← 你输入这个
    │
    ▼
specline-pipeline SKILL  ← 编排层（读状态、派发 Agent、调 Gate）
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
| `specline sync [--dry-run] [path]` | 将上游最新模板文件同步到项目，基于 Lock File 智能识别安全更新/冲突/仅本地修改。`--dry-run` 预览变更不实际写入 |
| `specline --version` | 显示当前 CLI 版本号 |
| `specline --help` | 显示帮助信息 |

## 子 Agent 列表

| Agent | 职责 |
|-------|------|
| `specline-spec-creator` | 根据自然语言需求，基于内联模板直接生成 proposal/design/tasks/spec 四个文件 |
| `specline-spec-reviewer` | 审核规格的完整性、一致性和覆盖度 |
| `specline-frontend-dev` | UI 组件、页面、样式、交互逻辑（单个任务级别） |
| `specline-backend-dev` | API 端点、数据模型、业务逻辑（单个任务级别） |
| `specline-config-dev` | Shell 脚本、配置文件（JSON/YAML）、Markdown 文档（处理 Type: config/docs 任务） |
| `specline-code-reviewer` | 前端/后端代码质量、安全性、可维护性审查 |
| `specline-config-reviewer` | Shell 脚本安全性、配置文件语法和一致性、Markdown 文档结构审查 |
| `specline-test-writer` | 黑盒测试编写——只能看 Spec，不能读源码 |
| `specline-test-runner` | 执行测试并分类失败原因（测试问题/代码问题/Spec 模糊） |

## 确定性门禁

每个门禁都是 Shell 脚本，`exit 0` = 通过，`exit 1` = 失败：

| 门禁 | 检查内容 |
|------|---------|
| Spec | `grep` 检查 Purpose/Requirements/Scenarios 章节完整性、WHEN/THEN 配对 |
| Build | `tsc --noEmit` / `python -m compileall` 编译检查 |
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
