# Design: Specline Independent CLI

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         Specline 独立化架构                              │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│   npm 分发包                                                             │
│   ┌───────────────────────────────────────────────────────────────┐    │
│   │  @specline/cli (npm package)                                   │    │
│   │  ├── cli.mjs              ← CLI 入口 (specline init)           │    │
│   │  └── templates/           ← 所有模板文件                        │    │
│   │      ├── .cursor/agents/       (7 files, specline-* 前缀)     │    │
│   │      ├── .cursor/commands/     (2 files, specline-* 前缀)     │    │
│   │      ├── .cursor/skills/       (5 dirs, specline-* 前缀)      │    │
│   │      ├── .cursor/hooks/        (4 scripts, specline-* 前缀)   │    │
│   │      ├── .cursor/hooks.json                                   │    │
│   │      └── specline/config.yaml                                  │    │
│   └───────────────────────────────────────────────────────────────┘    │
│                                                                         │
│   $ specline init                                                       │
│       │                                                                 │
│       ├── 1. 检测项目根目录                                              │
│       ├── 2. 检测已有 AI 工具配置 (.cursor/ 等)                          │
│       ├── 3. 检测 hooks.json 冲突（如果存在）                            │
│       ├── 4. 创建目录结构                                                │
│       ├── 5. 从 templates/ 复制所有文件                                  │
│       ├── 6. 写入 .specline-config.yaml                                  │
│       └── 7. 打印初始化成功摘要                                          │
│                                                                         │
│   用户项目（init 之后）                                                  │
│   ┌───────────────────────────────────────────────────────────────┐    │
│   │                                                                   │
│   │  .specline-config.yaml     ← 标记已初始化，记录版本号              │
│   │                                                                   │
│   │  .cursor/                                                         │
│   │    agents/specline-*.md         (7 Agent 定义)                     │
│   │    commands/specline-*.md       (pipeline + explore, 2 入口)       │
│   │    skills/specline-*/SKILL.md   (5 Skill 指令)                     │
│   │    hooks/specline-*.sh          (4 Gate 脚本)                      │
│   │    hooks.json                   (标准名)                           │
│   │                                                                   │
│   │  specline/                     (运行时目录)                        │
│   │    config.yaml                                                     │
│   │    changes/                                                       │
│   │    specs/                                                         │
│   │                                                                   │
│   └───────────────────────────────────────────────────────────────┘    │
│                                                                         │
│   流水线执行（零外部 CLI 依赖）                                          │
│   ┌───────────────────────────────────────────────────────────────┐    │
│   │                                                                   │
│   │  /specline-pipeline "需求描述"                                     │
│   │    │                                                              │
│   │    ├── specline-pipeline-gate.sh new --change "xxx"               │
│   │    │       ↑ 替代 openspec new change                             │
│   │    │                                                              │
│   │    ├── spec-creator Agent（直接生成 artifacts）                    │
│   │    │       ↑ 替代 openspec propose + openspec instructions        │
│   │    │                                                              │
│   │    ├── specline-pipeline-gate.sh spec --change "xxx"              │
│   │    │       ↑ 已有，不变                                            │
│   │    │                                                              │
│   │    ├── ... coding / review / test ...                             │
│   │    │                                                              │
│   │    └── specline-pipeline-gate.sh archive --change "xxx"           │
│   │            ↑ 替代 openspec archive                                │
│   │                                                                   │
│   └───────────────────────────────────────────────────────────────┘    │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

## Key Design Decisions

### 1. CLI 实现：纯 Node.js ESM，零外部依赖

```javascript
// cli.mjs — 约 150 行
// 使用 Node.js 内置模块：fs/path/child_process
// 不使用 commander/yargs — 命令数量少，手工解析更轻量

import { existsSync, mkdirSync, readdirSync, copyFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

function cmd_init(targetPath) { ... }
function cmd_version() { ... }
function cmd_help() { ... }

const [,, command, ...args] = process.argv;
switch (command) {
  case 'init': return cmd_init(args[0] || '.');
  case '--version': case '-v': return cmd_version();
  default: return cmd_help();
}
```

**选择理由**：specline init 只有文件复制操作，不需要交互式提示（inquirer）、美化输出（chalk）、复杂参数解析（commander）。保持零依赖意味着安装速度极快。

### 2. 文件前缀统一：`specline-`

所有生成文件以 `specline-` 开头，策略如下：

| 文件类型 | 命名示例 | 理由 |
|---------|---------|------|
| Agent | `specline-spec-creator.md` | 区分度最高，不会和用户自定义 Agent 混淆 |
| Skill 目录 | `specline-pipeline/` | 目录名带前缀，skill name 不带前缀（frontmatter 中的 name) |
| Command | `specline-pipeline.md` | 文件名即命令名 `/specline-pipeline` |
| Hook 脚本 | `specline-pipeline-gate.sh` | 脚本名清晰可辨识 |
| hooks.json | `hooks.json`（原名） | Cursor 标准文件名，不加前缀 |

### 3. 运行时目录：`specline/`（独立标识）

原本沿用 OpenSpec 的 `openspec/` 目录名，改为 `specline/` 以完全独立：

| 路径 | 旧值 | 新值 |
|------|------|------|
| 运行时目录 | `openspec/` | `specline/` |
| 项目配置 | `openspec/config.yaml` | `specline/config.yaml` |
| 变更元数据 | `.openspec.yaml` | `.specline.yaml` |
| 变更目录 | `openspec/changes/` | `specline/changes/` |
| 归档目录 | `openspec/changes/archive/` | `specline/changes/archive/` |
| 主 specs | `openspec/specs/` | `specline/specs/` |
| 状态文件 | `openspec/changes/<n>/.pipeline-state.json` | `specline/changes/<n>/.pipeline-state.json` |

### 4. openspec CLI 依赖替换方案

| openspec CLI 命令 | 调用位置 | 替换方式 | 实现位置 |
|---|---|---|---|
| `openspec new change` | SKILL.md Step 1 | `specline-pipeline-gate.sh new --change` | gate 脚本新增 `new` 子命令 |
| `openspec propose` | spec-creator Agent | 删除该调用，spec-creator 直接生成 4 个 artifact | spec-creator.md 重写 |
| `openspec instructions` | openspec-propose Skill | 模板内联到 spec-creator.md | spec-creator.md 重写 |
| `openspec status --json` | 多个 Skill | `specline-pipeline-gate.sh artifacts --change` + 文件存在检查 | gate 脚本新增 `artifacts` 子命令 |
| `openspec list --json` | 多个 Skill | `specline-pipeline-gate.sh list` | gate 脚本新增 `list` 子命令 |
| `openspec archive` | SKILL.md Step 15 | `specline-pipeline-gate.sh archive --change` | gate 脚本增强 `archive` 子命令 |

### 5. spec-creator.md 重写策略：内联模板

当前 spec-creator.md 的核心指令是 "调用 `openspec propose`"。改造后，spec-creator Agent 将直接执行以下逻辑：

```
spec-creator 执行流程（新）：
  1. 接收自然语言需求 + change-name
  2. 理解需求，拆解功能点
  3. 按顺序生成 4 个 artifact：
     a. proposal.md   — 使用内联模板：What/Why/Scope/Non-goals
     b. specs/*/spec.md — 使用内联模板：Purpose/Requirements/Scenarios
     c. design.md     — 使用内联模板：Architecture/DataFlow/Tradeoffs
     d. tasks.md      — 使用内联模板：Type/Depends/Covers/Files 标注
  4. 自检：并行度 ≥ 60%、第一批次 Files 无冲突
  5. 输出摘要
```

每个 artifact 模板直接内联在 spec-creator.md 的 Agent 定义中。

### 6. pipeline-gate.sh 新增子命令

```bash
# 新增 3 个子命令 + 增强 1 个（路径均为 specline/）

specline-pipeline-gate.sh new --change "<name>" [--description "..."]
  → 创建 specline/changes/<name>/ 目录
  → 写入 .specline.yaml 元数据（schema, created-date）
  → 创建 specs/ 子目录
  → 初始化 .pipeline-state.json

specline-pipeline-gate.sh list [--json]
  → 扫描 specline/changes/*/.pipeline-state.json（排除 archive/）
  → 输出每个 change 的 name + phase
  → --json 输出 JSON 数组

specline-pipeline-gate.sh artifacts --change "<name>" [--json]
  → 检查 4 个 artifact 文件是否存在
  → --json 输出 { proposal, design, tasks, specs } 布尔值

specline-pipeline-gate.sh archive --change "<name>"  (增强)
  → 现有：验证归档目录完整性
  → 新增：执行归档动作（spec delta 合并 + mv 到 archive/）
  → 通过 --execute 参数区分 "验证" 和 "执行"
```

### 7. 文件被替换影响的 Skill 路径引用

| 受影响文件 | 变更内容 |
|---|---|
| `specline-pipeline/SKILL.md` | `openspec *` 命令 → `specline-pipeline-gate.sh *`；所有 `openspec/changes/` → `specline/changes/`；Agent 名加前缀 |
| `specline-propose/SKILL.md` | 移除 `openspec new`/`openspec status`/`openspec instructions` 调用；路径 `openspec/` → `specline/` |
| `specline-apply-change/SKILL.md` | 移除 `openspec list`/`openspec status` 调用；路径 `openspec/` → `specline/` |
| `specline-archive-change/SKILL.md` | 移除 `openspec list`/`openspec status`/`openspec sync-specs` 调用；路径 `openspec/` → `specline/` |
| `specline-explore/SKILL.md` | 移除 `openspec list` 调用；路径 `openspec/` → `specline/` |
| `specline-spec-creator.md` | 整体重写：不再调用 `openspec propose`，路径 `specline/` |
| `specline-spec-reviewer.md` | 路径 `openspec/changes/` → `specline/changes/` |
| `specline-frontend-dev.md` | 同上 |
| `specline-backend-dev.md` | 同上 |
| `specline-code-reviewer.md` | 同上 |
| `specline-test-writer.md` | 同上 |
| `specline-test-runner.md` | 同上 |
| `specline-pipeline-gate.sh` | 所有 `openspec/` 路径 → `specline/`；`PROJECT_ROOT/openspec/` → `PROJECT_ROOT/specline/` |
| `hooks.json` | 脚本路径更新为 `specline-*.sh`，matcher 更新为 `specline-*` |

## Data Flow

### init 流程

```
$ specline init [path]
      │
      ▼
  解析目标路径（默认 .）
      │
      ├── 路径存在？─── 否 ──→ 报错退出
      │
      ▼ 是
  检测 .specline-config.yaml 是否存在？
      │
      ├── 是 → 已初始化，询问是否覆盖（--force 跳过询问）
      │
      ▼ 否 / force
  检测 hooks.json 冲突？
      │
      ├── 是 → 备份原文件为 hooks.json.bak，提示用户
      │
      ▼
  创建目录结构：
    .cursor/agents/
    .cursor/commands/
    .cursor/skills/
    .cursor/hooks/
    specline/changes/archive/
    specline/specs/
      │
      ▼
  从 templates/ 复制文件：
    for each file in templates/:
      copy → 用户项目对应路径
      （保持 templates/ 中的相对路径结构）
      │
      ▼
  写入 .specline-config.yaml：
    version: "1.0.0"
    initialized_at: "2026-06-01T..."
      │
      ▼
  打印初始化摘要：
    ✅ Specline 初始化完成
    📁 文件: 2 commands, 5 skills, 7 agents, 4 hooks
    🚀 试试在 Cursor 中输入: /specline-pipeline "你的第一个需求"
```

### 流水线执行流程（去 CLI 依赖后，路径为 specline/）

```
/specline-pipeline "添加用户登录"

  PHASE 1: SPEC
    ├── specline-pipeline-gate.sh new --change "add-user-login"
    │       → mkdir、写入 .pipeline-state.json、写入 .specline.yaml
    │
    ├── spec-creator Agent（重写后）
    │       → 直接生成 proposal.md / specs/ / design.md / tasks.md
    │       → 文件写入 specline/changes/add-user-login/
    │
    ├── spec-reviewer Agent
    │       → 产出 spec-review.json（在 specline/changes/ 下）
    │
    ├── specline-pipeline-gate.sh spec --change "add-user-login"
    │       → 格式校验（路径适配为 specline/）
    │
    └── 🟡 Human Gate: 确认

  PHASE 2-4: (逻辑不变，路径 specline/changes/，Agent 名加前缀)

  PHASE 5: ARCHIVE
    ├── 🟡 Human Gate: 确认归档
    ├── specline-pipeline-gate.sh archive --change "add-user-login" --execute
    │       → spec delta 合并 + mv 到 archive/
    └── specline-pipeline-gate.sh archive --change "add-user-login" (验证)
```

## Templates Directory Structure

```
templates/
  .specline-config.yaml                          ← 项目配置标记
  specline/
    config.yaml                                   ← Specline 项目配置
  .cursor/
    hooks.json                                    ← Cursor Hook 配置（标准名）
    agents/
      specline-spec-creator.md                    ← 重写：内联 artifact 模板
      specline-spec-reviewer.md                   ← 路径更新：openspec/ → specline/
      specline-frontend-dev.md                    ← 路径更新
      specline-backend-dev.md                     ← 路径更新
      specline-code-reviewer.md                   ← 路径更新
      specline-test-writer.md                     ← 路径更新
      specline-test-runner.md                     ← 路径更新
    commands/
      specline-pipeline.md                        ← 流水线主入口
      specline-explore.md                         ← 探索模式入口
    skills/
      specline-pipeline/SKILL.md                  ← 编排 Skill（去 CLI + 改路径）
      specline-propose/SKILL.md                   ← propose Skill（去 CLI + 改路径）
      specline-apply-change/SKILL.md              ← apply Skill（去 CLI + 改路径）
      specline-archive-change/SKILL.md            ← archive Skill（去 CLI + 改路径）
      specline-explore/SKILL.md                   ← explore Skill（去 CLI + 改路径）
    hooks/
      specline-pipeline-gate.sh                   ← 增强 + 路径 specline/
      specline-agent-guard.sh                     ← 路径更新
      specline-shell-guard.sh                     ← 不变
      specline-auto-format.sh                     ← 不变
```
