---
name: specline-knowledge
description: >-
  面向 AI 的项目知识库管理。检测 AGENTS.md 入口文件，追踪引用的知识文件链，
  对比代码自行判断新鲜度，按需生成/更新六类知识文件（术语表/架构/约定/决策/参考/操作指南）。
  Use when the user wants to check, generate, or update AI-oriented project knowledge files.
---

# /specline-knowledge 知识库管理 Skill

---

## Layer 1: 速览与定位

**一句话定位**：管理面向 AI 的项目知识库——找入口、查新鲜度、按需生成六类知识文件。

**入口**：`/specline-knowledge [可选: 文件名]`

**你做**：

- 定位 AGENTS.md（或 CLAUDE.md / CURSOR.md）
- 解析入口文件中的知识文件引用链
- 读取源文件，自行对比判断每个知识文件的新鲜度
- 按用户选择生成/更新六类知识文件

**你不做**：

- 往知识文件中添加任何元数据（哈希、时间戳、front matter）
- 与 pipeline / quickfix 自动联动
- 修改项目源代码

**核心原则**：知识文件是 AI 的速览地图，不是完整文档。新鲜度由 AI 阅读理解判断，不由时间戳驱动。

---

## Layer 2: Happy Path

### Step 1: 定位入口文件

按优先级搜索项目根目录：

```text
AGENTS.md  →  CLAUDE.md  →  CURSOR.md  →  .cursor/rules/
```

**找到入口文件**：

- 读取内容，提取其中的 markdown 链接 `[text](path)` 作为知识文件引用链
- 进入 Step 2

**未找到任何入口文件**：

- 提示用户：「未找到 AGENTS.md 或其他入口文件。是否需要我创建一个？入口文件是知识库的导航地图，记录所有知识文件的位置。」
- 用户确认 → 使用下方 `agents-entry-template` 创建 AGENTS.md（只创建入口文件，不立即生成子知识文件）
- 用户拒绝 → 结束，提示可随时再次调用

**多个入口文件并存**：

- 列出所有存在的入口文件及其位置
- 询问用户以哪个为主入口

---

### Step 2: 解析知识文件

如果用户传入了文件名参数（如 `/specline-knowledge architecture.md`），只检查该文件。

否则，扫描入口文件中的引用链 + `docs/knowledge/` 目录：

**引用链解析**：

- 提取入口文件中所有 `[text](相对路径)` 格式的链接
- 过滤出指向知识文件类型的链接（`.md` 文件）
- 逐文件追踪引用（如果被引用的文件内部又有链接，递归追踪）

**目录扫描**：

- 检查 `docs/knowledge/` 目录下所有 `.md` 文件
- 如果文件存在但入口文件无引用 → 标记为「孤儿知识文件」

**展示给用户**：

```text
  知识库状态：
  ✅ docs/knowledge/glossary.md      — 新鲜
  ⚠️ docs/knowledge/architecture.md  — 部分过时（src/auth/ 路径已变更）
  ⚠️ docs/knowledge/reference.md     — 缺失（入口引用了但文件不存在）
  
  孤儿文件（未被入口引用）：
  📄 docs/knowledge/old-notes.md     — 存在但不在 AGENTS.md 中
```

---

### Step 3: 判断新鲜度

**不做任何额外的技术检测**——不加哈希、不加时间戳、不加 front matter。

做法：

1. 读取知识文件的内容
2. 找出文件中描述的核心模块/文件/概念
3. 直接读取对应的源代码文件
4. AI 自行对比：知识描述和实际代码还匹配吗？

**标记规则**：

| 标记 | 含义 | 触发条件 |
|------|------|---------|
| ✅ 新鲜 | 描述与代码一致 | 提到的模块存在、结构正确、接口匹配 |
| ⚠️ 部分过时 | 部分内容不准确 | 路径变了、函数重命名了、部分描述不对 |
| ❌ 严重过时 | 大部分不匹配 | 被引用的文件不存在、架构发生根本变化 |

**新鲜度判断提示词**（每次判断时在脑中执行）：

> 这个知识文件中描述的模块路径、接口签名、概念定义，和我刚读完的源代码还一致吗？如果不一致，差异有多大？

---

### Step 4: 生成/更新知识文件

**展示可选列表**，让用户勾选需要的类型：

```text
  可生成的知识文件：
  [ ] GLOSSARY      — 从代码中推断术语定义
  [ ] ARCHITECTURE  — 从目录结构和 import 关系分析
  [ ] CONVENTIONS   — 从代码风格和配置中提取约定
  [ ] DECISIONS     — 从已归档 change 的 design.md 提取
  [ ] REFERENCE     — 从导出函数、CLI 参数提取关键接口
  [ ] HOWTOS        — 从 scripts/ 和常见模式提取操作指南

  默认路径：docs/knowledge/
```

**用户选择后**，按下方模板为每种类型生成内容。

**生成原则**：
- 知识文件是纯 Markdown，无 front matter / 元数据
- 只基于代码中真实存在的内容推断
- 不确定的地方加上 `<!-- UNVERIFIED: 描述 -->` 注释
- 每个关键陈述尽量暗示推断来源
- 内容控制在给 AI 速览的粒度，不写成完整文档

**更新策略**：
- 已有文件被判定为 ⚠️ 或 ❌ → 询问「保留手写版本 / 用 AI 重新生成 / 跳过」
- 目标文件不存在 → 直接生成

---

### Step 5: 更新入口文件

生成/更新知识文件后，检查 AGENTS.md 是否包含对应的引用：

- 无需引用的文件 → 追加引用到 AGENTS.md 的对应章节
- 已有引用 → 确认路径是否正确

```markdown
# AGENTS.md 中追加的格式：

## 系统架构
- [架构说明](docs/knowledge/architecture.md)
```

**冲突处理**：

| 场景 | 处理 |
|------|------|
| AGENTS.md 已有内容（非 Specline 创建） | 追加知识索引段落到末尾，不覆盖原有内容 |
| 知识文件存在但 AGENTS 无引用 | 提示「孤儿文件」，询问是否纳入管理 |
| 用户手动删了引用 | 不自动恢复，下次扫描时提示 |

---

## Layer 3: 六类知识文件详解

### 术语表 (GLOSSARY)

**文件**：`docs/knowledge/glossary.md`

**推断来源**：
- `type` / `interface` / `class` / `enum` 定义
- README 中的概念说明
- spec 文档中的术语

**生成内容**：

```markdown
# 术语表

<!-- 以下术语从项目代码中推断，基于类型定义和文档中出现的概念 -->

## <概念名>
- **是什么**：一句话定义
- **在哪里**：定义位置（文件:行号）
- **相关术语**：关联的其他概念
```

**示例**（以本项目为例）：

```markdown
# 术语表

## Template
- **是什么**：Specline 的源文件目录（templates/.cursor/），npm 发布时打包
- **在哪里**：项目根目录 templates/
- **相关术语**：.cursor/（运行时副本）、sync（同步机制）

## Change
- **是什么**：Specline 中的一次变更单元，包含 proposal/design/tasks/specs
- **在哪里**：specline/changes/<name>/
- **相关术语**：Pipeline、Archive、Gate
```

---

### 系统架构 (ARCHITECTURE)

**文件**：`docs/knowledge/architecture.md`

**推断来源**：
- 顶级目录结构
- 模块间 import 关系
- package.json / requirements.txt / go.mod 依赖
- tsconfig / 项目配置中的模块映射

**生成内容**：

```markdown
# 系统架构

## 模块地图

### <模块路径> — <模块名>
<一句话职责描述>
- 入口: <入口文件>
- 依赖: <依赖的模块>
- 被依赖: <哪些模块依赖它>

## 依赖关系图

\`\`\`
<ASCII 依赖图>
\`\`\`
```

---

### 编码约定 (CONVENTIONS)

**文件**：`docs/knowledge/conventions.md`

**推断来源**：
- `.eslintrc` / `.prettierrc` / `pyproject.toml` 等配置
- 代码风格的一致性模式
- 已有的 `.cursor/rules/` 中的规则
- 错误处理模式、命名约定等

**生成内容**：

```markdown
# 编码约定

## 代码风格
- <从配置文件提取的规则>

## 命名约定
- <从代码模式推断的命名习惯>

## 错误处理
- <从代码推断的错误处理模式>

## 已有规则
- <引用 .cursor/rules/ 中的规则文件>
```

---

### 设计决策 (DECISIONS)

**文件**：`docs/knowledge/decisions/<YYYY-MM-DD-<title>>.md`

**推断来源**：
- `specline/changes/archive/` 中已归档 change 的 `design.md`
- 如果项目不使用 Specline → 跳过此类

**生成内容**：

```markdown
# <决策标题>

- **日期**：YYYY-MM-DD
- **状态**：已采纳
- **决策**：<我们做了什么选择>
- **理由**：<为什么这么选>
- **替代方案**：<考虑过但放弃的方案及其被放弃的原因>
- **来源**：<从哪个 change 的 design.md 提取>
```

---

### API 参考 (REFERENCE)

**文件**：`docs/knowledge/reference.md`

**推断来源**：
- 导出函数/类/接口的签名
- CLI 参数定义
- 配置文件 schema
- 关键常量和枚举

**生成内容**：

```markdown
# 关键接口参考

## <函数名 / 类名>
- **签名**：\`functionName(param: Type) => ReturnType\`
- **用途**：一句话描述
- **位置**：文件:行号
```

**示例**：

```markdown
# 关键接口参考

## specline gate
- **入口**：\`specline gate <action> [--change <name>]\`
- **支持动作**：list / bind / unbind / new / artifacts / check
- **位置**：core/gates/pipeline-gate.sh（通过 CLI 命令 `specline gate` 调用）
```

---

### 操作指南 (HOWTOS)

**文件**：`docs/knowledge/howtos/<主题>.md`

**推断来源**：
- `scripts/` 目录下的脚本
- package.json 中的 npm scripts
- README 中的操作说明

**生成内容**：

```markdown
# <操作名称>

## 背景
<什么时候需要做这个操作>

## 步骤

### 1. <步骤名称>
\`\`\`bash
<命令>
\`\`\`
<预期输出>

### 2. <步骤名称>
...
```

---

## Layer 4: 模板

以下模板在生成对应文件时使用。

### AGENTS.md 入口模板

```markdown
# Project Knowledge Index

> 本文件是面向 AI 的项目知识库导航地图。每个 AI agent 应首先阅读本文件以了解项目上下文。
> 由 specline-knowledge 管理。

## 系统架构
- [架构说明](docs/knowledge/architecture.md)

## 术语表
- [术语定义](docs/knowledge/glossary.md)

## 编码约定
- [代码约定](docs/knowledge/conventions.md)

## 设计决策
- [决策记录](docs/knowledge/decisions/)

## API 参考
- [关键接口](docs/knowledge/reference.md)

## 操作指南
- [操作指南](docs/knowledge/howtos/)
```

### 术语表模板

```markdown
# 术语表

<!-- 以下术语从项目代码中推断生成 -->

## <概念名>
- **是什么**：<一句话定义>
- **在哪定义**：<文件路径:行号>
- **相关术语**：<关联概念>
```

### 架构模板

```markdown
# 系统架构

<!-- 以下架构从目录结构和 import 关系推断 -->

## 项目结构

\`\`\`
<顶级目录树>
\`\`\`

## 模块地图

### <模块路径> — <模块名称>
<职责描述>
- **入口**：<文件>
- **依赖**：<列表>
```

### 约定模板

```markdown
# 编码约定

<!-- 以下约定从代码风格、配置文件和一致性模式中推断 -->

## 代码风格
- <规则>

## 命名约定
- <约定>

## 错误处理
- <模式>
```

### 决策记录模板

```markdown
# <决策标题>

- **日期**：YYYY-MM-DD
- **状态**：已采纳
- **决策**：<内容>
- **理由**：<原因>
- **替代方案**：<被放弃的方案及理由>
- **来源**：<源文档路径>
```

### 参考模板

```markdown
# 关键接口参考

<!-- 以下接口从代码导出中提取 -->

## <名称>
- **签名**：\`<signature>\`
- **用途**：<描述>
- **位置**：<文件:行号>
```

### 操作指南模板

```markdown
# <操作名称>

## 背景
<何时需要此操作>

## 步骤
1. \`\`\`bash
   <命令>
   \`\`\`

## 常见问题
- <问题及解决>
```

---

## Layer 5: 异常与边界

### 边界判断

| 情况 | 处理方式 |
|------|---------|
| 入口文件不存在且用户拒绝创建 | 结束，提示可随时再次调用 |
| 入口文件存在但无任何引用链接 | 提示「入口文件未包含任何知识文件引用」，询问是否扫描 `docs/knowledge/` 目录 |
| 知识文件全部新鲜 | 报告「所有知识文件均为最新 ✓」，结束 |
| 用户传入的文件参数不存在 | 提示「文件 X 不在入口文件的引用链中」，列出已引用的文件供选择 |
| AGENTS.md 已有非 specline-knowledge 内容 | 追加知识索引段落，不覆盖原有内容 |
| 知识文件存在但缺少入口引用 | 标记为孤儿文件，询问是否纳入管理 |
| 用户手写了知识文件（无 AI 生成标记） | AI 仍可判断新鲜度（读代码对比），更新时询问保留/替换/合并 |
| 用户项目不使用 Specline（无 changes/archive/） | DECISIONS 类型自动跳过，提示原因 |
| 项目无 package.json / 无显式模块结构 | ARCHITECTURE 类型降级为目录树 + 文件说明 |
| 项目代码量极小（< 10 源文件） | 提示「项目规模较小，知识文件可能收益有限」，仍允许生成 |

---

## Anti-Rationalization 表格

| 借口 | 现实 |
|------|------|
| 「AI 直接读代码就行，不需要知识文件」 | 代码能告诉你"是什么"，但"为什么"和"全局关系"散落在各处。知识文件给 AI 一张速览地图，节省每次重新扫描的 token 和时间。 |
| 「新鲜度让用户自己判断吧」 | 用户很难记住「glossary.md 引用了哪几个源文件，那些文件改了没」。AI 并行读取对比是自然优势。 |
| 「ALL 知识文件都生成一遍，一步到位」 | 不同项目需要不同类型的知识。小型脚本可能只需要 GLOSSARY，大型 monorepo 需要全部六类。让用户选择，别替用户决定。 |
| 「判断新鲜度时保守一点，不确定就标记 ⚠️」 | 频繁的假过期警报会让用户不信任标记。只有确实发现不一致时才标记 ⚠️，无法判断就说「无法判断」。 |
| 「给知识文件加上时间戳/hash 更精确」 | 额外的元数据增加认知负担和维护成本。AI 阅读对比代码已经足够好，简单方案就是好方案。 |
| 「这个文件和 AGENTS.md 的链接断了，自动修」 | AGENTS.md 是用户的主入口文件。自动修改可能覆盖用户的手动编排意图。提示用户，让用户决定。 |

---

## Verification Checklist

技能实现完成后，自查：

- [ ] 入口文件检测优先级正确：AGENTS.md → CLAUDE.md → CURSOR.md → .cursor/rules/
- [ ] 能正确解析 markdown 链接 `[text](path)` 作为引用链
- [ ] 新鲜度判断仅靠 AI 阅读理解对比，不添加任何元数据
- [ ] 六类知识文件（GLOSSARY/ARCHITECTURE/CONVENTIONS/DECISIONS/REFERENCE/HOWTOS）全部支持
- [ ] 生成的知识文件为纯 Markdown，无 front matter / 元数据
- [ ] 不确定的内容标记了 `<!-- UNVERIFIED -->`
- [ ] 与 pipeline/quickfix 无联动，纯手动触发
- [ ] 支持按需检查（指定文件名）和全量扫描两种模式
- [ ] 冲突处理覆盖：已有入口文件、已有同名知识文件、孤儿文件
- [ ] 未覆盖/不适用的情况有降级策略（代码量极小、无模块结构等）
