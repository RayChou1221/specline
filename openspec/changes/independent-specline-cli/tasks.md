# Tasks: Specline 独立 CLI 工具

## 1. [x] 实现 cli.mjs — specline init 命令

- **Type**: backend
- **Depends**: (none)
- **Covers**: Requirement: CLI 安装与初始化, Scenario: 用户安装全局包后在项目中初始化
- **Files**: cli.mjs

实现 `specline init [path]` 命令：

1. 解析目标路径（默认当前目录 `.`）
2. 验证目标路径存在且可写
3. 检测 `.specline-config.yaml` 是否已存在 → 已存在则提示 `--force` 覆盖
4. 检测 `hooks.json` 冲突 → 存在则备份为 `hooks.json.bak`
5. 创建目录结构：`.cursor/{agents,commands,skills,hooks}`, `specline/{changes/archive,specs}`
6. 从 `templates/` 复制所有文件到目标路径（保持目录结构）
7. 写入 `.specline-config.yaml` 标记已初始化 + 版本号
8. 打印初始化成功摘要（文件数统计、入口命令提示）

## 2. [x] 创建 templates/ 目录结构和第一版模板文件

- **Type**: backend
- **Depends**: 1
- **Covers**: Requirement: CLI 安装与初始化, Scenario: 初始化后项目获得完整的 Agent/Skills/Commands/Hooks 文件
- **Files**: templates/.cursor/agents/specline-spec-creator.md, templates/.cursor/agents/specline-spec-reviewer.md, templates/.cursor/agents/specline-frontend-dev.md, templates/.cursor/agents/specline-backend-dev.md, templates/.cursor/agents/specline-code-reviewer.md, templates/.cursor/agents/specline-test-writer.md, templates/.cursor/agents/specline-test-runner.md, templates/.cursor/commands/specline-pipeline.md, templates/.cursor/commands/specline-explore.md, templates/.cursor/skills/specline-pipeline/SKILL.md, templates/.cursor/skills/specline-propose/SKILL.md, templates/.cursor/skills/specline-apply-change/SKILL.md, templates/.cursor/skills/specline-archive-change/SKILL.md, templates/.cursor/skills/specline-explore/SKILL.md, templates/.cursor/hooks/specline-pipeline-gate.sh, templates/.cursor/hooks/specline-agent-guard.sh, templates/.cursor/hooks/specline-shell-guard.sh, templates/.cursor/hooks/specline-auto-format.sh, templates/.cursor/hooks.json, templates/specline/config.yaml, templates/.specline-config.yaml

操作：

1. 创建 `templates/` 根目录
2. 将现有的 `agents/*.md` → `templates/.cursor/agents/specline-*.md`（重命名 + 路径从 `openspec/` 改为 `specline/`，spec-creator.md 后面专门重写）
3. 将现有 `commands/dev-pipeline.md` → `templates/.cursor/commands/specline-pipeline.md`
4. 将现有 `commands/opsx-explore.md` → `templates/.cursor/commands/specline-explore.md`（路径 `openspec/` → `specline/`）
5. 将现有 `skills/*/SKILL.md` → `templates/.cursor/skills/specline-*/SKILL.md`（路径 `openspec/` → `specline/`）
6. 将现有 `hooks/*.sh` → `templates/.cursor/hooks/specline-*.sh`（路径 `openspec/` → `specline/`）
7. 复制 `hooks.json` → `templates/.cursor/hooks.json`（更新脚本路径和 matcher）
8. 创建新的 `templates/specline/config.yaml`（替代 `templates/openspec/config.yaml`）
9. 创建 `templates/.specline-config.yaml` 模板

## 3. [x] 重写 spec-creator.md — 去掉 openspec propose 依赖

- **Type**: backend
- **Depends**: 2
- **Covers**: Requirement: Spec 生成（propose 替代）, Scenario: spec-creator 直接生成 4 个 Artifact 文件到 specline/ 目录
- **Files**: templates/.cursor/agents/specline-spec-creator.md

重写 spec-creator Agent 定义：

1. 删除 "调用 `openspec propose`" 的指令
2. 内联 4 个 artifact 的生成逻辑（输出路径均为 `specline/changes/<name>/`）：
   - Step 1: 理解用户需求 → 推导 change name
   - Step 2: 创建目录结构（调用 specline-pipeline-gate.sh new）
   - Step 3: 生成 proposal.md（内联 What/Why/Scope/Non-goals 模板）
   - Step 4: 生成 specs/*/spec.md（内联 Purpose/Requirements/Scenarios 模板，含 WHEN/THEN 格式）
   - Step 5: 生成 design.md（内联 Architecture/DataFlow/Tradeoffs 模板）
   - Step 6: 生成 tasks.md（内联 Type/Depends/Covers/Files 标注模板，并行度 ≥ 60%）
3. 保留：并行度自检、文件冲突自检、完成摘要输出

## 4. [x] 更新 pipeline-gate.sh — 路径改为 specline/ + 新增子命令

- **Type**: backend
- **Depends**: 1
- **Covers**: Requirement: openspec CLI 替代, Scenario: 所有原本由 openspec CLI 提供的功能由 gate 脚本内部实现；所有路径从 openspec/ 改为 specline/
- **Files**: templates/.cursor/hooks/specline-pipeline-gate.sh

**4a. 路径适配**：
- `PROJECT_ROOT/openspec/` → `PROJECT_ROOT/specline/`
- 所有 `openspec/changes/` → `specline/changes/`
- `.openspec.yaml` → `.specline.yaml`

**4b. 新增功能**：

1. **`new` 子命令**（~40 行）：
   - `specline-pipeline-gate.sh new --change "<name>" [--description "..."]`
   - 创建 `specline/changes/<name>/` 目录 + `specs/` 子目录
   - 写入 `.specline.yaml`（schema/created-date）
   - 初始化 `.pipeline-state.json`（所有 phase 标记 pending）

2. **`list` 子命令**（~30 行）：
   - `specline-pipeline-gate.sh list [--json]`
   - 扫描 `specline/changes/*/.pipeline-state.json`（排除 archive/）
   - 输出 name + phase 信息

3. **`artifacts` 子命令**（~20 行）：
   - `specline-pipeline-gate.sh artifacts --change "<name>" [--json]`
   - 检查 4 个 artifact 文件是否存在
   - JSON 输出 `{ proposal, design, tasks, specs }`

4. **`archive` 子命令增强**（~40 行）：
   - 现有：验证归档目录结构 → 路径改为 `specline/`
   - 新增 `--execute` 参数：执行实际归档动作
     - 检查 artifacts 完整性
     - 将 delta specs 合并到主 `specline/specs/`
     - 移动 change 到 `specline/changes/archive/YYYY-MM-DD-<name>/`
     - 更新 `.pipeline-state.json` 状态为 archived

## 5. [x] 去 CLI 化 + 改路径 — 更新 5 个 Skill 文件

- **Type**: backend
- **Depends**: 2
- **Covers**: Requirement: openspec CLI 替代, Scenario: 所有 Skill 指令不再引用外部 openspec CLI，所有路径改为 specline/
- **Files**: templates/.cursor/skills/specline-pipeline/SKILL.md, templates/.cursor/skills/specline-propose/SKILL.md, templates/.cursor/skills/specline-apply-change/SKILL.md, templates/.cursor/skills/specline-archive-change/SKILL.md, templates/.cursor/skills/specline-explore/SKILL.md

对每个 Skill 文件执行以下替换：

| Skill 文件 | 替换内容 |
|---|---|
| `specline-pipeline/SKILL.md` | `openspec new change` → `specline-pipeline-gate.sh new`；`openspec propose` → spec-creator Agent 直接生成；`openspec archive` → `specline-pipeline-gate.sh archive --execute`；`openspec/changes/` → `specline/changes/`；`.openspec.yaml` → `.specline.yaml`；Agent 名称加 `specline-` 前缀 |
| `specline-propose/SKILL.md` | 移除所有 `openspec new`/`openspec status`/`openspec instructions` 调用；改为直接按模板生成 artifacts，路径改为 `specline/changes/` |
| `specline-apply-change/SKILL.md` | `openspec list --json` → `specline-pipeline-gate.sh list --json`；`openspec status --json` → `specline-pipeline-gate.sh artifacts`；路径 `openspec/` → `specline/` |
| `specline-archive-change/SKILL.md` | `openspec list` → `specline-pipeline-gate.sh list`；`openspec status` → 文件检查；archiving 改为 gate 脚本；路径 `openspec/` → `specline/` |
| `specline-explore/SKILL.md` | `openspec list --json` → `specline-pipeline-gate.sh list --json`；路径 `openspec/` → `specline/` |

## 6. [x] 更新 6 个 Agent 定义中的路径引用（openspec/ → specline/）

- **Type**: backend
- **Depends**: 2
- **Covers**: Requirement: 文件命名规范（specline- 前缀），Scenario: 所有 Agent 路径从 openspec/ 改为 specline/，引用同步更新
- **Files**: templates/.cursor/agents/specline-spec-reviewer.md, templates/.cursor/agents/specline-frontend-dev.md, templates/.cursor/agents/specline-backend-dev.md, templates/.cursor/agents/specline-code-reviewer.md, templates/.cursor/agents/specline-test-writer.md, templates/.cursor/agents/specline-test-runner.md

对非重写的 6 个 Agent 定义：
1. `frontmatter.name` 加 `specline-` 前缀
2. 文件路径全局替换：`openspec/changes/` → `specline/changes/`、`openspec/specs/` → `specline/specs/`
3. Agent 间互相引用名称更新（如 spec-reviewer → specline-spec-reviewer）
4. 产出文件路径更新（如 `spec-review.json` 路径 `openspec/` → `specline/`）

## 7. [x] 更新 hooks.json 配置

- **Type**: config
- **Depends**: 2
- **Covers**: Requirement: 文件命名规范（specline- 前缀）, Scenario: hooks.json 中的脚本路径和 matcher 模式更新为 specline- 前缀
- **Files**: templates/.cursor/hooks.json

1. 所有 `command` 字段中的脚本路径更新为 `specline-*.sh`
2. `matcher` 中的 Agent 名称更新为 `specline-*` 前缀

## 8. [x] 更新 package.json + README.md

- **Type**: config
- **Depends**: 1
- **Covers**: Requirement: npm 分发包, Scenario: 用户通过 npm install -g specline 安装后使用
- **Files**: package.json, README.md

1. package.json：确认 `bin.specline = "./cli.mjs"`，确认 `files = ["cli.mjs", "templates/"]`
2. README.md：
   - 安装指令更新为 `npm install -g specline` 或 `npx specline init`
   - 命令入口统一为 `/specline-pipeline` 和 `/specline-explore`
   - 路径引用 `openspec/` → `specline/`
   - 去掉 OpenSpec 依赖说明

## 9. [x] 删除旧文件 — 清理非模板化文件

- **Type**: config
- **Depends**: 8
- **Covers**: Requirement: 文件命名规范（specline- 前缀）, Scenario: 不再需要的旧文件清理
- **Files**: .cursor/commands/opsx-propose.md, .cursor/commands/opsx-apply.md, .cursor/commands/opsx-archive.md

删除不再需要的文件：
1. `opsx-propose.md` — 不再作为独立命令暴露
2. `opsx-apply.md` — 不再作为独立命令暴露
3. `opsx-archive.md` — 不再作为独立命令暴露
4. 旧的 `agents/*.md` 文件 — 模板已复制到 templates/，旧文件保留到验证通过后删除
5. 旧的 `skills/openspec-*` 目录 — 同上
6. 旧的 `hooks/*.sh` — 同上
7. `openspec/config.yaml` → 已改为 `specline/config.yaml`，旧文件删除
