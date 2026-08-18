---
name: specline-init-web
description: >-
  为可安全初始化的空项目生成前后端分离的登录后 SaaS SPA Web 骨架，提供 React/Vue、npm/pnpm 选择与 Go + Gin 后端。用于用户要求初始化新 Web 项目、SaaS SPA、Vite + Gin 全栈骨架或输入 /specline-init-web 时。
---

# /specline-init-web Web 项目初始化 Skill

## 第 1 层：速览与定位

**入口**：`/specline-init-web [可选目标目录]`

**适用范围**：仅用于无应用代码、且通过两次只读安全扫描的新项目。生成前后端分离、开发双进程、生产单二进制的登录后 SaaS SPA 通用骨架。

**固定技术边界**：
- 前端：用户选择 React 或 Vue；均使用 Vite + TypeScript；按 feature 组织；API 基址为相对路径 `/api/v1`。
- 包管理器：用户选择 npm 或 pnpm，不替用户猜测。
- 后端：Go + Gin；模块化单体、轻量 DDD、六边形边界，但不预造领域模型和大量空目录。
- 开发：Vite 与 Gin 分进程，Vite 将 `/api` 代理到 Gin。
- 生产：`frontend/dist` 通过 `go:embed` 编入 Go 二进制；Gin 单端口提供 API、健康检查、静态 assets 与 SPA fallback。
- 容器：Docker 多阶段构建；最终仅运行非 root 的单个 Go 进程。
- 操作入口：根目录统一 Makefile/命令。

**明确不做**：
- 不生成 User、Order 或其他虚假业务示例，不提前创建真实业务模块。
- 第一版不接数据库、不实现认证；只在文档中标明未来 adapter/composition root 接入位置。
- 租户模型待定，不生成或预埋 `tenantID`/`tenantId`。
- 不生成 GraphQL、SSR，不把 secrets 或服务端环境变量打进前端。
- 不进入 Pipeline，不运行知识库阶段，不执行 git commit。

执行前必须直接读取：
- [空项目安全门](references/empty-project-safety.md)
- [生成与架构契约](references/scaffold-contract.md)

## 第 2 层：主流程

### 阶段 1：第一次只读扫描（任何询问之前）

1. 解析可选目标目录；未提供时使用当前工作目录。将其规范化为绝对候选路径，但不得创建目录；候选不存在时扫描其最近的既存祖先及候选路径状态。
2. 按“空项目安全门”执行第一次只读扫描，记录候选与既存扫描根快照及阻断项。扫描期间不得安装、初始化或写入任何内容。
3. 候选存在但不是目录、无法完整扫描、权限不足、出现 symlink、出现不允许内容或无法可靠分类时，fail closed。
4. 阻断时列出具体相对路径，明确“本次零写入”，立即停止；不提供 force、覆盖、合并、移动或删除选项。

### 阶段 2：收集选择并形成精确输出清单

仅第一次扫描通过后询问：

1. 前端框架：`React` / `Vue`。
2. 包管理器：`npm` / `pnpm`。
3. 目标目录仅在入口未明确且当前目录意图不清时确认；确认后重新按安全门对最终目标扫描。

根据选择形成**精确输出清单**，逐项列出将创建的目录和文件，包括脚手架工具可能创建的 lockfile。先向用户展示清单，不写入。

输出清单必须满足“生成与架构契约”。版本选择使用脚手架/包管理器当前兼容版本，不臆造固定版本；解析出的依赖版本和命令需记录在最终报告。

### 阶段 3：第二次只读扫描与竞态检查

1. 对最终目标执行第二次完整只读扫描。
2. 比较两次扫描的路径、类型和可获取的元数据。两次检查之间任何变化都停止，即使变化后的内容本身在 allowlist 中。
3. 逐项验证精确输出清单：目标路径及所有关键父路径不得是 symlink；任何将创建路径已存在都阻断。
4. 无法证明目标仍为空、无法完成比较或发现冲突时 fail closed，列出阻断项并明确截至此刻零写入。

### 阶段 4：create-exclusive 生成

1. 先在内存建立创建日志；日志本身不得提前写入目标。每成功创建一项立即记录。
2. 所有目标内写入使用 create-exclusive 语义：目录只在不存在时创建；文件使用等价于 `O_CREAT|O_EXCL` 的方式。禁止普通重定向、覆盖写、`--force` 或会合并已有目录的脚手架行为。任何不能保证“不改写已存在路径”的生成/安装命令不得直接作用于目标。
3. 若使用官方 Vite 脚手架，必须在隔离临时目录生成后，将已审核的文件逐项 create-exclusive 写入目标；不得让脚手架直接写目标目录。临时目录不得位于目标目录内。
4. 按生成契约实现最小可运行骨架、测试与文档。不得为了“完整 DDD”增加空层级。
5. 在目标外的隔离工作树安装依赖并执行全部构建与验证；通过后，才将精确清单中的最终源文件、lockfile 与生产所需产物逐项 create-exclusive materialize 到目标。
6. 任何生成、安装或验证失败：立即停止后续步骤，报告失败原因、临时工作树位置与已创建项；不执行自动清理或 `rm -rf`。

### 阶段 5：安装依赖与验证

在目标外的隔离工作树中，按生成的根目录 Makefile/等价统一命令执行；命令必须与所选包管理器一致。验证通过后再进入目标 materialization：

- 前端：安装依赖、typecheck、test、build。
- 后端：`gofmt` 检查/执行、`go vet ./...`、`go test ./...`、`go build ./...`。
- 集成：启动生产模式二进制并验证：
  - `/health/live` 与 `/health/ready` 成功；
  - 未知 `/api`（至少 `/api/unknown` 与 `/api/v1/unknown`）返回 JSON 404；
  - 前端未知非 API 路径返回 SPA shell；
  - assets 可访问，API 路径绝不落入 SPA fallback。
- Docker：环境具备 Docker 且 daemon 可用时执行 build；网络、工具或 daemon 缺失时标为“未验证”并写明证据，不得谎报通过。

验证失败即停止剩余步骤；保留隔离工作树和目标现场，报告目标中已创建项、已通过项、失败命令与原因，不自动清理。验证通过后 materialization 期间若发生冲突或写入失败，同样立即停止并报告，不重新验证、不覆盖。

### 阶段 6：可选知识库建议

仅脚手架全部必需验证成功后询问是否调用 `specline-knowledge`。不得静默调用或直接写知识库。

推荐范围：
- `AGENTS.md` 导航；
- `architecture.md`、`conventions.md`、`reference.md`；
- `howtos/local-development.md`、`docker-deployment.md`、`adding-backend-module.md`、`adding-authentication.md`。

必须基于真实生成文件。用户可全选、自选或跳过；`glossary.md` 与 `decisions/` 默认不生成。知识库完成后也不自动进入 Pipeline 或 commit。

## 第 3 层：路由与运行时契约

### Gin 路由优先级

路由语义必须明确且可测试：

1. `/health/live`、`/health/ready`；
2. `/api/v1` API group；
3. 对 `/api` 及 `/api/*path` 的 JSON 404 捕获；
4. 静态 assets；
5. 最后才是非 API 的 SPA fallback。

JSON 404 应具有稳定的 `Content-Type: application/json` 和机器可读错误体。前端路由刷新可返回嵌入的 `index.html`，但不存在的静态 asset 不应伪装成 SPA 页面。

### 后端边界

- `gin.Context` 只存在于 HTTP adapter。
- application/domain 使用标准库 `context.Context`。
- Handler 只负责解析与校验输入、调用 application、将结果/错误映射到 HTTP。
- domain 不依赖 Gin、HTTP 或 infrastructure。
- composition root 负责装配；数据库、认证、未来 GraphQL 只能作为后续 adapter 接入。

## 第 4 层：失败策略

| 情况 | 必须行为 |
|---|---|
| 第一次扫描阻断 | 列出路径，声明零写入，停止 |
| 用户选择期间目录变化 | 第二次扫描发现后声明零写入，停止 |
| symlink 或类型不确定 | fail closed，停止 |
| 输出路径已存在 | 不覆盖、不合并，停止 |
| 生成/安装失败 | 停止后续步骤，列出已创建项，不清理 |
| 必需验证失败 | 保留现场并报告，不进入知识库询问 |
| Docker 不可执行 | 标记未验证和原因；其他必需验证仍须通过 |

## Anti-Rationalization

| 借口 | 现实 |
|---|---|
| “只有 README，可以当空项目” | README、LICENSE、`.env.example` 都是用户内容，必须阻断。 |
| “这是熟悉的未知文件，应该没事” | allowlist 外即阻断；无法分类也阻断。 |
| “加 `--force` 更省事” | Skill 没有 force 路径，所有输出必须 create-exclusive。 |
| “目录刚检查过，不用再查” | 用户选择形成了竞态窗口；第二次扫描与差异比较不可省略。 |
| “先生成，失败再清理” | 自动清理可能删除用户并发创建的内容；失败必须保留现场并报告。 |
| “先放 User/tenantID 以后会用” | 业务与租户模型未确定，预埋会制造错误架构承诺。 |
| “SPA fallback 能兜底所有 404” | API 404 必须是 JSON；落入 HTML 会破坏客户端和监控语义。 |
| “知识库是推荐项，可以直接生成” | 必须在验证成功后由用户确认，且基于真实文件。 |

## 验证清单

- [ ] frontmatter 的 name/description 可自然发现，未配置禁止模型自动调用的 frontmatter 字段
- [ ] 第一次扫描发生在任何询问和写入前，第二次扫描发生在精确清单形成后
- [ ] allowlist、symlink、竞态与 create-exclusive 规则全部满足
- [ ] 骨架不含虚假领域、数据库、认证实现、tenantID、GraphQL 或 SSR
- [ ] Vite `/api` proxy 与生产 `go:embed` 单端口均已实现
- [ ] API JSON 404、健康检查、assets、SPA fallback 的优先级已验证
- [ ] 前端 typecheck/test/build 与后端 gofmt/vet/test/build 通过
- [ ] Docker 已通过，或明确记录为未验证及原因
- [ ] 失败时未自动清理；成功后仅询问可选知识库，未进入 Pipeline/commit
