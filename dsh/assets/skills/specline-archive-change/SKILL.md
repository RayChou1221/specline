---
name: specline-archive-change
description: 归档已完成的 Specline change。用于实现完成后 finalize 并 archive change。
license: MIT
compatibility: Compatible with specline.
metadata:
  author: specline
  version: "1.0"
  generatedBy: "1.3.1"
---

## 第 1 层：速览

> **一句话**：归档已完成的 Specline change。
> **入口**：`/specline-archive-change [change-name]`
> **流程**：选 change → 检查完成度 → Delta spec sync 决策 → 移动目录 → 归档后可选知识库更新建议 → 完成

### 归档前后目录结构变化

```
归档前 (活跃、可修改)              归档后 (只读、可追溯)

specline/changes/                  specline/changes/
├── my-change/          ──▶       ├── archive/
│   ├── proposal.md               │   └── 2026-06-01-my-change/
│   ├── design.md                 │       ├── proposal.md
│   ├── tasks.md                  │       ├── design.md
│   └── specs/                    │       ├── tasks.md
                                  │       └── specs/
```

**输入**：可选传入 change name。若未传入，先判断能否从对话上下文推断；若模糊或有歧义，必须展示可用 change 让用户选择。

---

## 第 2 层：主流程

1. **未提供 change name 时，请用户选择**

   运行 `specline gate list --json` 获取可用 change。使用 直接向用户提问 让用户选择。

   只展示活跃 change（不展示已归档项）。
   如果可用，展示每个 change 使用的 schema。

   **重要**：不要猜测或自动选择 change。始终让用户选择。

2. **检查 Artifact 完成状态**

   运行 `specline gate artifacts --change "<name>" --json` 检查 Artifact 完成状态。

   解析 JSON，确认：
   - `schemaName`：当前使用的工作流
   - `artifacts`：Artifact 列表及状态（`done` 或其他）

   **如果存在未 `done` 的 Artifact：**
   - 展示警告，列出未完成的 Artifact
   - 使用 直接向用户提问 确认用户是否继续
   - 用户确认后继续

3. **检查 task 完成状态**

   读取 tasks 文件（通常是 `tasks.md`），检查未完成任务。

   统计 `- [ ]`（未完成）和 `- [x]`（已完成）的任务数量。

   **如果发现未完成任务：**
   - 展示警告，说明未完成任务数量
   - 使用 直接向用户提问 确认用户是否继续
   - 用户确认后继续

   **如果不存在 tasks 文件：** 不展示 task 相关警告，继续执行。

4. **评估 delta spec sync 状态**

   **决策流程：**

   ```
   Delta specs 存在？
   ├── 否 → 直接归档
   └── 是 → 比较 delta spec 与 main spec
              ├── 无差异 → 「已同步」→ 直接归档
              └── 有差异 → 展示变更摘要 → 询问用户
                            ├── 同步 → 执行 sync → 归档
                            └── 跳过 → 归档
   ```

   检查 `specline/changes/<name>/specs/` 下是否存在 delta specs。若不存在，不提示 sync，直接继续。

   **如果存在 delta specs：**
   - 将每个 delta spec 与 `specline/specs/<capability>/spec.md` 中对应的 main spec 比较
   - 判断将应用哪些变化（新增、修改、删除、重命名）
   - 提示用户前先展示合并摘要

   **提示选项：**
   - 需要同步时："Sync now (recommended)", "Archive without syncing"
   - 已同步时："Archive now", "Sync anyway", "Cancel"

   如果用户选择 sync，调用 specline_* 角色工具，role="general-purpose"，prompt: "Use Skill tool to invoke specline-sync-specs for change '<name>'. Delta spec analysis: <include the analyzed delta spec summary>"。无论用户是否选择 sync，之后都继续归档。

5. **执行归档**

   如果归档目录不存在，先创建：
   ```bash
   mkdir -p specline/changes/archive
   ```

   使用当前日期生成目标名称：`YYYY-MM-DD-<change-name>`

   **检查目标目录是否已存在：**
   - 如果存在：失败并报错，建议重命名已有归档或使用不同日期
   - 如果不存在：将 change 目录移动到 archive

   ```bash
   specline gate archive --execute --change <name>
   ```

6. **展示摘要**

   展示归档完成摘要，包括：
   - Change 名称
   - 使用的 schema
   - 归档位置
   - specs 是否已同步（如适用）
   - Contract 状态：approved/fresh、stale、legacy change not required，或 quickfix skipped
   - 任何警告说明（Artifact/task 未完成）

   如果存在 `execution-contract.md`，归档时随 change 一起保留。旧 change 没有合同不阻塞归档；摘要写明 `Contract: legacy change, not required`。

7. **归档后知识库更新建议**

   归档成功后，评估该 change 是否包含值得为未来 AI Agent 或维护者沉淀的知识。

   **重要边界：**
   - 该步骤发生在归档之后且是可选动作，绝不能阻塞归档成功。
   - 更新任何知识文件前都必须先询问用户。
   - 如果用户跳过更新，正常完成，不视为警告。
   - 不要假设项目一定使用 `specline-knowledge`；它只是可能的知识落点之一。

   **可检查输入：**
   - `proposal.md` — 目的与范围
   - `design.md` — 架构决策与替代方案
   - `tasks.md` — 实际工作拆解与触达范围
   - `specs/` — 用户可见能力变化
   - `summary.md` — 最终归档摘要（如存在）

   **当 change 包含以下内容时，建议更新知识库：**
   - 新增或改变核心架构、pipeline 阶段行为、Agent 职责或 Skill 职责
   - 新增或改变 CLI 命令、配置字段、公开接口、Hook 行为或用户可见工作流
   - 新的长期项目概念或术语
   - 有意义的设计决策、权衡或被拒绝的替代方案
   - 未来维护者或 Agent 应知道的可复用操作指南
   - 跨模块核心变更，且 `proposal.md`、`design.md` 或 `summary.md` 解释了长期有效的 why

   **以下情况不建议更新知识库：**
   - 没有长期设计变化的纯 bug 修复
   - 仅 copy、注释、格式或 typo 修改
   - 小范围本地测试更新
   - 不应沉淀为长期项目知识的临时兼容修复

   **如果不建议更新：**
   - 在归档摘要中简短说明：`Knowledge: no update suggested`。

   **如果建议更新：**
   - 用简短列表展示可沉淀的知识。
   - 询问用户是否现在更新知识库。
   - 至少提供 `Update knowledge base` 和 `Skip` 两个选项。

   **如果用户确认：**
   1. 先查找 `specline-knowledge` 风格结构：
      - `AGENTS.md` 存在并链接到 `docs/knowledge/*`，或
      - `docs/knowledge/` 存在。
   2. 如果找到，以 archive Artifact 为增量输入更新最相关的知识文件。优先选择：
      - 架构或 pipeline 流程变化 → `docs/knowledge/architecture.md`
      - 长期编码/工作流约定 → `docs/knowledge/conventions.md`
      - CLI/config/API/Hook 参考 → `docs/knowledge/reference.md`
      - 可复用操作流程 → `docs/knowledge/howtos/`
      - 重大决策和权衡 → `docs/knowledge/decisions/`
      - 长期概念 → `docs/knowledge/glossary.md`
   3. 如果不存在 `specline-knowledge` 结构，查找项目自有的可能知识落点：
      - `AGENTS.md`, `CLAUDE.md`, `CURSOR.md`, `.cursor/rules/`
      - `docs/adr/`, `docs/decisions/`, `docs/architecture/`
      - 仅当 change 影响用户可见行为或安装配置时，才考虑 `README.md`
   4. 如果合适落点很明显，告知用户计划更新的位置，并在编辑前确认。
   5. 如果没有明显落点，询问用户知识应写到哪里。

### 成功输出

```
## 归档完成

**Change:** <change-name>
**Schema:** <schema-name>
**Archived to:** specline/changes/archive/YYYY-MM-DD-<name>/
**Specs:** ✓ Synced to main specs (or "No delta specs" or "Sync skipped")
**Contract:** Approved and fresh / Legacy change, not required / Skipped by quickfix policy
**Knowledge:** No update suggested / Suggested and skipped / Updated <path>

All artifacts complete. All tasks complete.
```

---

## 第 3 层：约束与高级话题

- 未提供 change 时，始终提示用户选择
- 使用 Artifact 图（`specline gate artifacts --json`）检查完成度
- 警告不阻塞归档，只需告知并确认
- 移动到 archive 时保留 `.specline.yaml` 和 `execution-contract.md`（如存在，随目录一起移动）
- 清晰展示发生了什么
- 如果请求 sync，使用 specline-sync-specs 方案（Agent 驱动）
- 如果存在 delta specs，始终执行 sync 评估，并在提示用户前展示合并摘要
- 仅在归档成功后运行知识库更新建议，绝不把它变成 Gate
- 没有用户明确确认时，绝不更新知识文件
- 不要假设项目使用 `specline-knowledge`；探测可能的知识落点，歧义时询问用户

---

## Anti-Rationalization 表格

归档是流水线的最后一步，松懈的代价是污染长期记录：

| 借口 | 现实 |
|------|------|
| "不用检查完成度，反正用户说可以归档了" | 用户说可以不代表真的可以。Artifact 和 task 完成度检查是归档前的最后防线。 |
| "Delta spec 不用同步，下次再说" | 未同步的 Delta spec 意味着 spec 与代码脱节。归档后几乎不会再有人回来补。 |
| "归档就是移动目录，不需要通知用户" | 归档改变了 change 的可见性和可修改性。用户需要知道发生了什么。 |
| "警告不用管，自动继续就行" | 警告（artifact 不完整、task 未完成）是信号。归档时应确认而非忽略。 |
| "知识库更新也算归档完成条件" | 知识沉淀是归档后的可选收尾动作。用户跳过时 pipeline 仍然成功完成。 |
| "项目一定用 specline-knowledge" | 用户项目可能有自己的 AGENTS.md、CLAUDE.md、ADR 或 README 维护方式。先探测，再确认，找不到就问。 |

## 验证清单

归档前自查：

- [ ] Artifact 完成度已检查（`specline gate artifacts --json`）
- [ ] Task 完成度已检查（tasks.md checkbox 状态）
- [ ] 任何警告/不完整项已向用户确认
- [ ] Delta spec sync 决策已完成（存在则展示摘要→询问；不存在则跳过）
- [ ] 归档目录已创建（`specline/changes/archive/YYYY-MM-DD-<name>/`）
- [ ] 归档摘要已展示给用户
- [ ] 归档成功后已判断是否需要知识库更新建议
- [ ] 若建议更新知识库，已由用户确认后才写入；跳过不视为失败
