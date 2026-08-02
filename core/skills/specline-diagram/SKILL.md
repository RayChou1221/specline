---
name: specline-diagram
description: 创建、读取和增量修改可在本地 Draw.io UI 中继续编辑的复杂关系图。仅在用户明确选择 Diagram 且受管 runtime 审计通过时使用。
license: MIT
compatibility: Compatible with specline.
metadata:
  author: specline
  version: "1.0"
---

# /specline-diagram 本地可编辑关系图 Skill

## 定位与选择

Diagram 是复杂关系的本地可编辑沟通 Artifact，不是 Spec source of truth，也不替代 Explore 或 Visualize。

按表达目标选择工具：

| 目标 | 使用方式 |
| --- | --- |
| 简单、瞬时、无需 GUI 编辑的关系 | 直接使用 ASCII |
| 页面 mockup、交互原型或可携带演示 | 交给 `/specline-visualize` |
| 复杂架构、流程、状态或依赖关系，且用户需要 GUI 手工编辑 | 经同意后使用 `/specline-diagram` |

`specline-visualize` 的契约保持独立且不变：自包含单文件 HTML、内联 CSS/JS、无 CDN、无外部资源、无外部网络请求。Diagram 不包装、不转换、不合并或替代该契约。

## 使用前交接

调用方必须先说明使用 Diagram 的收益、受管文件位置、需要本地 runtime，以及失败时会继续原工作并降级为 ASCII。只有用户明确同意后才继续。

交接至少包含：

```yaml
purpose: 这张图要确认或交流什么
audience: 谁会查看并据此做什么决定
slug: lowercase-kebab-case
change: 仅当用户明确关联既有 change 时提供
confirmed: 用户或 Artifact 已明确的事实
assumptions: 为表达而采用、尚未确认的假设
openQuestions: 尚待确认的问题
requestedExports: [drawio] # 可按需增加 svg
```

缺少 `purpose`、`audience` 或受管路径选择时，只询问决定性的最少问题。不得因发现相关 change 自动关联。

## 强制前置检查

先只读调用 doctor/status，分别检查两个门禁（不得把一个门禁的状态推断为另一个）：

- 上游 `auditState` 必须为 `verified_with_required_mitigations`；该状态只证明来源、许可证和缓解可行性，不代表可安装或 release-ready；
- 最终 `releaseVerificationState` 必须为 `verified`，且 `releaseGate` 必须为 `true`；任一 required mitigation、许可证材料、发布输入或最终网络 trace 缺失/失败/待复审时都必须阻止安装、配置、启动和 MCP 工具暴露；
- 项目期望版本与用户级 runtime 完全一致；
- 当前平台配置和 `reloadState`；
- 本项目已有 session；
- diagram 根和目标 slug 是否满足受管路径规则。

若 `auditState=blocked`，立即停止 Diagram 路径，报告阻断证据并回退 ASCII。若上游审计通过但最终验证不是 `verified`、`releaseGate` 不为 `true`，或状态证据互相矛盾，则报告发布门禁阻断并回退 ASCII。不得以 manifest 自报、Task 完成标记、“先试运行”“之后补 checksum”或手工安装绕过最终门禁。

## 安装与配置许可

任何下载、目录创建、runtime 发布或平台配置写入前，必须生成并展示完整只读计划。计划至少列出：

- 精确包与静态资源版本、官方 URL、SHA-256；
- 下载大小、解压后空间和目标目录；
- 将启动的本地进程与 `127.0.0.1` 临时端口策略；
- 将修改的当前平台配置及结构化 diff；
- 首次配置后需要一次 Agent 重载；
- 失败回滚、doctor 和卸载范围；
- 不会删除 diagram、prototype 或其他 MCP 配置；
- 本次计划的 `planDigest`。

许可规则：

1. 展示计划本身不得产生写入或下载。
2. 只有用户明确批准当前仍有效的 `planDigest` 后，才可执行对应 action。
3. 计划内容、版本、目标或配置 diff 变化后，旧批准立即失效，必须重新展示并许可。
4. 安装、升级、重装、卸载和 `stop-all` 分别生成计划并单独许可。
5. 默认只配置当前平台；Cursor、Claude Code、Codex、OpenCode 的其他平台必须逐一展示计划并分别许可。
6. 不得静默安装、自动升级、覆盖同名用户 MCP、修复 malformed 配置或修改未许可平台。

安装成功但当前平台配置未获许可时，可以保留已校验 runtime，但不得写平台配置，并应提供受管卸载方式。

## 首次重载

当前平台首次配置成功后，必须报告 `reload_required` 并要求用户重载一次 Agent。不得承诺热重载。

重载后：

- MCP 可发现：状态转为 `reloaded`，继续创建或加载；
- MCP 仍不可发现：报告 `mcp_missing`，给出 doctor 信息并回退 ASCII；
- 不得因 MCP 缺失自动重装、重新配置或修改其他平台。

## 受管路径与 Artifact

默认目录：

```text
specline/diagrams/<slug>/
├── <slug>.drawio
├── <slug>.svg       # 仅在用户请求导出时
└── <slug>.md
```

仅当用户明确关联既有 change 时使用：

```text
specline/changes/<change>/diagrams/<slug>/
```

只接受 diagram identity 或受管根内的相对路径。拒绝绝对路径、空段、`..`、NUL、非法扩展、平台路径变体和符号链接逃逸。不得向 Agent 暴露上游 MCP 的任意 load/export 路径。

伴随 Markdown 固定包含：

```markdown
# <Diagram Title>

## Purpose
## Audience
## Confirmed
## Assumptions
## Open Questions
## Diagram
- Draw.io: `<relative-path>`
- SVG: `<relative-path | not-exported>`
- Status: `draft | under-review | confirmed | parked`
- Revision: `<revision>`

## Revision History
- YYYY-MM-DD — <创建、同步或修改摘要；来源>
```

Agent 推断只能进入 Assumptions 或 Open Questions。用户在 UI 中手工修改图形，不等于确认需求。

## 创建、加载与增量修改

只使用 provider-neutral 操作：

- `diagram.create`
- `diagram.load`
- `diagram.edit`
- `diagram.readState`
- `diagram.export`
- `diagram.finish`

行为要求：

1. create/load 成功后报告 `sessionId`、受管相对路径、revision 和仅含 `127.0.0.1` 的 `uiUrl`。
2. 增量修改必须基于已读取的最新 revision。
3. `REVISION_CONFLICT` 时先读取最新 UI 状态，再基于用户手工修改重建操作；不得覆盖旧 revision。
4. 读取、导出、保存或停止前都先同步浏览器状态。
5. 同步失败或超时时，不得声称已读取、导出或保存最新状态。
6. `.drawio` 是主可编辑文件；SVG 只按用户请求导出。
7. 不得读取或写入受管根外文件，也不得把绝对路径、token 或用户其他 MCP 配置写入日志或结果。

## 保存真实性

报告必须区分：

- `saved`：最新 UI revision 已同步并持久化；
- `dirty`：存在未持久化修改；
- `sync_failed`：无法确认最新 UI revision；
- `exported`：指定 revision 已导出到受管相对路径；
- `not_verified`：没有证据证明保存或导出成功。

同步失败时明确说明未保存风险，并让用户选择继续修改或不保存停止。禁止把“已发送保存请求”表述为“已保存”。

## 固定结束菜单

每次准备结束 session 时提供且只提供以下四项：

1. 保存并停止（推荐）
2. 不保存停止
3. 保持 30 分钟
4. 继续修改

执行语义：

- 保存并停止：先同步最新 UI revision，确认持久化后停止当前 session。
- 不保存停止：停止当前 session，不把未持久化 revision 写入文件。
- 保持 30 分钟：进入 `idle_held`；超时前可继续，超时清理仍先尝试安全同步。
- 继续修改：保持 session 活跃，不执行停止。

显式 stop、stdin EOF、SIGTERM、父进程退出和空闲超时都只清理当前 owned session。`stop-all` 必须先列出所有受影响 session，并取得额外的最新计划许可。

## 失败与降级

以下情况均为可恢复失败：

- 用户拒绝安装、配置或结束许可；
- 审计 blocked；
- MCP 缺失或首次重载后仍不可发现；
- 断网、下载失败或 checksum 不匹配；
- runtime/UI 健康检查失败；
- loopback 端口失败或出现非 loopback 请求；
- revision 同步失败。

失败时：

1. 停止当前 Diagram 动作并报告稳定状态/错误码；
2. 不放宽路径、网络、checksum、版本或许可边界；
3. 不远端回退，不改用 `app.diagrams.net` 或 `embed.diagrams.net`；
4. 清理本次 owned 临时状态，不产生半安装或计划外配置；
5. 保留已有 diagram、prototype 和无关配置；
6. 让调用工作流继续；需要表达关系时使用 ASCII。

## Spec 边界

Diagram 仅用于沟通。禁止：

- 把图或伴随 Markdown 自动视为需求真相；
- 自动修改 proposal、design、tasks 或 spec；
- 把 Assumptions 提升为 Confirmed；
- 根据图中手工修改自动推进 Pipeline；
- 将 Diagram 与 Visualize 合并。

若图中出现可转化为需求或设计决策的新信息，先列出准备捕获的 Confirmed 内容，取得用户同意后再交给对应 Specline 流程。

## 完成报告

完成或降级时报告：

- diagram 与伴随 Markdown 的受管相对路径；
- session 状态、revision、dirty/sync 状态；
- 本轮创建、读取、增量修改或导出的内容；
- Confirmed、Assumptions、Open Questions 的变化；
- 验证方式和未验证项；
- 若降级，说明原因和提供的 ASCII 表达。
