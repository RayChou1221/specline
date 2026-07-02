---
name: specline-quickfix
description: 轻量修改 Skill —— 小改动用 quickfix，大功能用 pipeline
---

# /specline-quickfix 轻量修改 Skill

---

## 第 1 层：速览与定位

**一句话定位**：小改动用 quickfix，大功能用 pipeline。

**入口**：`/specline-quickfix <描述>`

**你做：**
- 读取相关代码理解上下文
<!-- platform:cursor -->
- 直接 Write/StrReplace 编辑文件（不使用子 Agent）
- ReadLints 自动校验 + 修复（最多 2 次循环）
<!-- /platform:cursor -->
<!-- platform:claude,codex,opencode -->
- 直接编辑文件（使用平台原生编辑工具，不使用子 Agent）
- 运行项目 linter 命令自动校验 + 修复（最多 2 次循环）
<!-- /platform:claude,codex,opencode -->
- 运行项目已有单元测试（失败修复最多 2 次循环）
- 生成轻量归档（summary.md + files-changed.json）

**你不做：**
- 创建 proposal.md、design.md、tasks.md、specs/ 等规划文档
- 启动任何 specline-* 子 Agent
- 创建 `.pipeline-state.json` 或 `.pipeline-sessions.json`
- 写新测试、跑集成/E2E 测试

### 流程概览

```
    UNDERSTAND ──→ IMPLEMENT ──→ REVIEW ──→ TEST ──→ ARCHIVE
     (读代码)       (直编辑)    (Lint+自审)  (现有单测)  (轻量归档)
```

### Hook 透明

Quickfix 不绑定 Pipeline session，所有 Hook（sessionStart、preToolUse、postToolUse、subagentStart、beforeShellExecution）自动透明放行，不产生任何拦截或提醒。

---

## 第 2 层：主流程

### 阶段 1：UNDERSTAND

**目标**：理解变更上下文，明确修改范围。

**步骤**：

1. 解析用户描述，提取关键词（文件名、函数名、错误信息等）
<!-- platform:cursor -->
2. 使用 Read 工具读取相关源文件，理解当前逻辑
<!-- /platform:cursor -->
<!-- platform:claude,codex,opencode -->
2. 读取相关源文件（使用平台原生读取工具），理解当前逻辑
<!-- /platform:claude,codex,opencode -->
3. 确认变更范围：
   - 1-3 个文件 ✓
   - 单一关注点 ✓
   - 不涉及架构变更 ✓
   - 不需要新测试 ✓
4. **意图模糊时**：使用 {{CONFIRM}} 向用户确认变更范围和目标，不要猜测

**准入条件**：变更范围已验证在 quickfix 适用范围内（参见第 3 层边界判断）

---

### 阶段 2：IMPLEMENT

**目标**：直接编辑源文件，完成修改。

**步骤**：

<!-- platform:cursor -->
1. 使用 Write / StrReplace 工具直接编辑文件
2. **不使用子 Agent**，不调用 Task 工具
3. 编辑完成后，运行 ReadLints 检查新增的 lint 错误
<!-- /platform:cursor -->
<!-- platform:claude,codex,opencode -->
1. 使用平台原生编辑工具直接编辑文件
2. **不使用子 Agent**，不派发子任务
3. 编辑完成后，运行项目 linter 命令检查新增的语法和风格错误
<!-- /platform:claude,codex,opencode -->

**约束**：
- 只修改 UNDERSTAND 阶段确认的文件
- 如果发现需要修改第 4 个文件 → 暂停并建议转 `/specline-pipeline`
- 保持现有代码风格和命名约定

---

### 阶段 3：REVIEW

**目标**：通过 Lint 检查和 Agent 自审确保代码质量。

**步骤**：

<!-- platform:cursor -->
1. 运行 ReadLints 收集所有 lint 问题
2. **如有 lint 错误**：自动修复 → 再次 ReadLints → 最多循环 2 次
<!-- /platform:cursor -->
<!-- platform:claude,codex,opencode -->
1. 运行项目 linter 命令收集所有 lint 问题
2. **如有 lint 错误**：自动修复 → 再次运行 linter → 最多循环 2 次
<!-- /platform:claude,codex,opencode -->
   - 第 1 次修复后仍有错误 → 分析原因，再次修复
   - 第 2 次修复后仍有错误 → 报告用户，附错误列表和修复尝试记录，暂停
3. **Agent 自审**：
   - 变更逻辑是否正确？
   - 是否处理了边界条件？
   - 是否引入了新问题（如未使用的导入、副作用）？
   - 是否破坏现有功能？
4. 自审通过 → 进入 TEST 阶段

---

### 阶段 4：TEST

**目标**：运行项目已有单元测试，确保不引入回归。

**步骤**：

1. **自动检测测试框架**：
   - 检查 `package.json` scripts → Jest / Mocha / Vitest
   - 检查 `pytest` / `go test` / `cargo test` 配置
2. **有测试配置**：运行现有单元测试
   - 通过 → 进入 ARCHIVE 阶段
   - 失败 → 分析失败原因，修复代码 → 重新运行 → 最多循环 2 次
   - 第 2 次修复后仍失败 → 报告用户（附失败详情和修复尝试记录），暂停
3. **无测试配置**：跳过 TEST 阶段，进入 ARCHIVE 阶段（在 summary.md 中标注）

**不运行**：集成测试、E2E 测试、新编写的测试。

---

### 阶段 5：ARCHIVE

**目标**：生成轻量归档，提供变更可追溯性。

**步骤**：

1. 在 `specline/changes/archive/` 下创建归档目录：
   ```
   specline/changes/archive/YYYY-MM-DD-<description>/
       ├── summary.md
       └── files-changed.json
   ```
2. **summary.md** 内容：
   ```markdown
   # <变更标题>
   
   ## What
   <一句话描述做了什么>
   
   ## Why
   <为什么要做这个修改>
   
   ## Files Changed
   - path/to/file1 — <修改简述>
   - path/to/file2 — <修改简述>
   
   ## Test Result
   - 通过 / 跳过（无现有单元测试）/ 失败（附详情）
   ```
3. **files-changed.json** 内容：
   ```json
   {
     "files": ["path/to/file1", "path/to/file2"],
     "change_count": 2,
     "description": "<变更描述>"
   }
   ```
4. 展示变更摘要，**询问用户**：是否需要 git commit？

**无人确认点**：整个 quickfix 流程不暂停等待人工确认（lint + test 是自动质量底线）。

---

## 第 3 层：异常与边界

### Quickfix vs Pipeline 边界判断

使用以下规则判断变更是否适合 quickfix：

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

**边界处理规则**：

| 异常情况 | 处理方式 |
|----------|----------|
| 变更范围 > 3 个文件 | 暂停，建议转 `/specline-pipeline` |
| 需要写新测试 | 暂停，建议转 `/specline-pipeline` |
| 涉及架构变更/新 API | 暂停，建议转 `/specline-pipeline` |
| Lint 修复 2 次后仍有错误 | 报告用户（附错误列表和修复记录），暂停 |
| 测试失败 2 次后仍失败 | 报告用户（附失败详情和修复记录），暂停 |
| 实现过程中发现需要额外文件 | 如果总数仍 ≤ 3 → 继续；如果 > 3 → 暂停并建议转 pipeline |
| 项目无测试配置 | 跳过 TEST 阶段，在 summary.md 中标注 |

### 不适合 Quickfix 的典型场景

- 新增功能模块（需要 spec/design 规划）
- 跨 3+ 模块的接口变更
- 数据库 schema 变更
- 需要新增测试覆盖的复杂修复
- 需要多人/多步骤协调的改动

**使用建议**：如果不确定，优先用 quickfix。如果需要更严格的流程保证，用 pipeline。

---

## 第 4 层：附录

### 与 Pipeline 的关系

```
specline-pipeline (完整流程)           specline-quickfix (轻量流程)
    SPEC                                  UNDERSTAND
     ↓                                       ↓
    CODING (子 Agent 并发)                   IMPLEMENT (单 Agent 直编)
     ↓                                       ↓
    CODE REVIEW (review Agent)              REVIEW (Lint 检查 + 自审)
     ↓                                       ↓
    TEST (unit → integration → e2e)         TEST (现有单测 only)
     ↓                                       ↓
    ARCHIVE (Delta sync)                    ARCHIVE (summary + files-changed)
```

两者完全独立，通过边界判断规则选择。不共享状态文件，不互相依赖。

### 归档目录结构兼容性

Quickfix 归档目录结构与 Pipeline 归档保持一致：

```
specline/changes/archive/
├── YYYY-MM-DD-<pipeline-change>/       ← Pipeline 归档
│   ├── proposal.md
│   ├── design.md
│   ├── tasks.md
│   ├── specs/
│   └── ...
│
└── YYYY-MM-DD-<quickfix-description>/   ← Quickfix 归档
    ├── summary.md
    └── files-changed.json
```

两种归档方式共存于同一目录，通过内容区分（Pipeline 归档有 proposal.md 等完整文档，Quickfix 归档只有 summary.md + files-changed.json）。

---

## Anti-Rationalization 表格

Quickfix 的极简流程容易让人产生"反正很快，随便点"的心态：

| 借口 | 现实 |
|------|------|
| "顺便多改一个文件也没事，就一行" | Quickfix 的 1-3 文件边界是防止范围蔓延的最后防线。第 4 个文件应该走 Pipeline。 |
| "不需要 lint 检查，我肉眼确认了" | 人类肉眼无法可靠检测拼写错误、未使用导入、类型不匹配。Lint 检查是自动化底线。 |
| "测试跳过没事，改动很小" | 改动越小越容易有隐性耦合。现有测试套件就是你的回归检测网。 |
| "不用归档了，就是个小修，没记录无所谓" | 不归档意味着不可追溯。三个月后没人记得这个修改是谁做的、为什么做的。 |
| "不用询问用户 git commit，我自己提交了" | Commit 是用户的决定，不是 Agent 的。擅自 commit 剥夺了用户的审查机会。 |

## 验证清单

Quickfix 完成后，自查：

- [ ] UNDERSTAND 阶段确认了变更范围（≤3 文件，单一关注点）
- [ ] IMPLEMENT 阶段只修改了确认的文件，未越界
- [ ] REVIEW 阶段 lint 检查通过（或 2 次修复后仍有错误已报告）
- [ ] Agent 自审完成：逻辑正确、边界已处理、未引入新问题、未破坏现有功能
- [ ] TEST 阶段现有单元测试全部通过（或已标注跳过原因）
- [ ] ARCHIVE 阶段 summary.md + files-changed.json 已写入归档目录
- [ ] 已询问用户是否需要 git commit
