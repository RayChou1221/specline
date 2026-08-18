# Web 骨架生成与架构契约

本文规定输出能力和边界。具体文件名可随 React/Vue 官方 Vite 模板小幅变化，但必须在写入前列入精确输出清单，并保持以下契约。

## 1. 最小结构

```text
<target>/
├── frontend/              # React 或 Vue；Vite + TypeScript；feature-first
├── backend/               # Go module 与 Gin HTTP adapter
├── docs/                  # 仅骨架必需说明与未来接入点
├── Makefile               # 统一开发、验证、构建命令
├── Dockerfile             # 多阶段，最终非 root 单进程
└── dockerignore/config    # 仅实际构建需要时创建
```

只创建当前可运行骨架所需目录。后端可有 composition root、HTTP adapter、application/domain 边界的最小落点；在没有业务能力时，不创建 `user`、`order`、`tenant` 等模块，也不铺设空的 entity/repository/service 目录树。使用 README 或 docs 说明“业务明确后如何新增模块”和未来认证/持久化接入位置，但不得实现它们。

## 2. 前端契约

- React 或 Vue 来自用户选择，使用 Vite + TypeScript，禁止 SSR 框架。
- `src` 采用 feature-first：共享启动壳、路由、API client 可位于明确的 app/shared 区；真实 feature 在需求出现时再添加。
- API client 使用相对 `/api/v1`，不得硬编码生产 host。
- `vite.config.*` 在开发环境将 `/api` proxy 到 Gin 开发端口。
- 环境变量只允许可公开的前端配置；不得嵌入 token、密码、私钥或服务端 secrets。文档明确 `VITE_*` 会进入浏览器 bundle。
- 提供有意义的最小测试，支持所选框架的 typecheck、test、build；不以空测试脚本伪造通过。
- UI 是登录后 SaaS SPA 的中性 shell，但不实现登录、用户或租户业务。可以显示非领域化的应用框架和“认证待接入”状态。

## 3. 后端契约

### 边界

- Go + Gin，模块化单体。
- domain 不依赖 Gin、HTTP、文件系统或其他 infrastructure。
- application/domain 接口使用 `context.Context`；`gin.Context` 不得越过 HTTP adapter。
- Handler 仅解析/校验、调用 application、映射响应和错误。
- composition root 装配 HTTP server 和未来 adapters。
- 数据库、认证仅在文档中标出未来 adapter/端口接入点；不添加 driver、migration、JWT/session 实现。
- 不添加 GraphQL；transport 与 application 分离，未来可新增 adapter 而无需改 domain。

### 路由

- `/health/live`：进程存活，成功返回稳定 JSON。
- `/health/ready`：第一版无外部依赖，可返回 ready；结构应允许未来加入依赖检查。
- `/api/v1`：版本化 API group，可提供非业务性的最小服务信息端点；若无必要，可只保留 group 与 JSON 404。
- `/api` 和任意未知 `/api/*path`：稳定 JSON 404，不得返回 `index.html`。
- assets：从嵌入文件系统提供，正确 content type 与缓存策略；不存在的 asset 返回 404。
- SPA fallback：仅匹配非 API、非缺失 asset 的前端路由，返回嵌入的 `index.html`。

### 嵌入

生产构建必须让 `frontend/dist` 可被 `go:embed` 捕获。可以把 embed 声明放在满足 Go 路径约束的 package 中，构建流程负责把 dist 放到其可嵌入位置。不得在运行时依赖宿主机上的 frontend 文件。

## 4. 开发与生产

- 开发：Makefile 提供清晰命令分别启动 Vite 和 Gin，并可提供并行 convenience target；二者是独立进程。前端通过 Vite `/api` proxy 访问后端。
- 生产：先构建 frontend，再构建含嵌入资源的 Go binary；单 binary、单 HTTP 端口。
- 所有命令遵循用户选择的 npm 或 pnpm，不同时生成两个 lockfile。
- 根命令至少覆盖 install、dev、typecheck/test/build、Go verify、完整 verify 和 production build。

## 5. Docker 契约

- 多阶段：Node/pnpm 或 npm 构建 frontend；Go stage 编译嵌入 assets 的静态或最小运行时 binary；runtime stage 仅含运行所需内容。
- 最终镜像运行单个 Go 进程、暴露单端口、使用固定非 root UID/GID 或 distroless nonroot。
- 不把 source secrets、`.env`、VCS 数据或开发缓存复制进镜像。
- `HEALTHCHECK` 若添加，应调用现有健康端点且不引入 runtime 中不存在的工具；否则由容器平台配置。

## 6. 验证契约

必需验证：

1. frontend install 成功；
2. frontend typecheck、test、build 分别成功；
3. backend gofmt 无差异、`go vet ./...`、`go test ./...`、`go build ./...` 成功；
4. production binary 在临时端口启动并完成 HTTP 集成断言；
5. `/health/live`、`/health/ready` 返回成功 JSON；
6. `/api/unknown`、`/api/v1/unknown` 返回 JSON 404；
7. 一个非 API 深层路由返回 SPA shell；
8. 一个真实 asset 成功，不存在 asset 返回非 SPA 404。

Docker build 是条件验证：Docker CLI 与 daemon 可用且网络允许时必须执行；否则最终报告为“未验证”，包含缺失工具、daemon 不可用或网络失败的具体证据。网络失败若也导致依赖安装失败，则初始化整体失败，不得把必需验证降级为未验证。

## 7. 成功报告

最终报告至少包含：

- 目标绝对路径、React/Vue 选择、npm/pnpm 选择；
- 完整已创建文件/目录；
- 解析出的主要工具/依赖版本；
- 每条验证命令及通过/失败/未验证状态；
- 关键路由验证结果；
- Docker 验证状态；
- 明确未实现项：数据库、认证、租户、GraphQL、SSR；
- 是否调用以及选择了哪些 `specline-knowledge` 文档；
- 明确“未进入 Pipeline，未执行 git commit”。
