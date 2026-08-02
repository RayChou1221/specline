# 使用本地 Draw.io Diagram

本功能用于需要 GUI 手工编辑、再由 Agent 读取和增量修改的复杂关系图。
简单、即时的关系优先使用 ASCII；单文件 HTML 原型仍使用 Visualize。
Diagram 是沟通 artifact，不会自动回写 proposal、design 或 spec。

> 当前状态：`releaseVerificationState=verified`、`releaseGate=true`，且
> `offlineTrace` 已绑定 canonical `releaseInputDigest`。在 bound evidence
> 仍然有效时可安装、配置、启动并暴露 MCP 工具。上游
> `auditState=verified_with_required_mitigations` 只说明 provenance 与缓解
> 可行性，与最终发布门禁分开理解。

## 发布后的首次使用流程

1. 让 Diagram Skill 生成只读安装计划。确认精确版本、官方来源、SHA-256、
   下载/解压空间、用户级目标目录、依赖闭包、`127.0.0.1` 端口策略、
   将修改的平台配置、一次重载要求和卸载范围。
2. 明确批准当前计划 digest 后再安装。计划变化、升级或重装都必须重新生成
   计划并重新批准；runtime 不会自动升级。
3. 默认只配置当前平台。Cursor、Claude Code、Codex、OpenCode 互相独立，
   每增加一个平台都要查看并批准该平台自己的配置计划。
4. 首次配置成功后重载 Agent 一次。重载后仍发现不到 MCP 时查看 doctor
   结果并回退 ASCII，不静默重装。
5. 启动 session 后，只接受形如
   `http://127.0.0.1:<port>/sessions/<session-id>/` 的本地 UI 地址。

常用命令：

```sh
specline diagram plan --action install --json
specline diagram install --approved-plan <approved-digest> --json

specline diagram plan --action configure --platform <cursor|claude|codex|opencode> --json
specline diagram configure --platform <cursor|claude|codex|opencode> \
  --approved-plan <approved-digest> --json
```

## 创建和查看 session

默认 diagram 保存在：

```text
specline/diagrams/<slug>/<slug>.drawio
specline/diagrams/<slug>/<slug>.md
specline/diagrams/<slug>/<slug>.svg   # 仅在请求 SVG 导出后
```

只有明确关联一个已经存在的 change 时，才使用
`specline/changes/<change>/diagrams/<slug>/`。不要传绝对文件路径或项目外
路径。

启动与状态命令：

```sh
specline diagram start --project <absolute-project-root> --slug <slug> --json
specline diagram status --session <session-id> --json
```

每个 session 都有独立的 MCP/HTTP 进程状态、端口、PID、revision、diagram
identity 和仅驻留内存的 bearer token。读取、写入、同步、历史、恢复、预览
和导出端点均要求 token，并校验 session、loopback peer 和同源。该安全边界
由 Specline wrapper/runtime 增加；上游 draw.io 和 Next AI Draw.io
原生并不具备全部这些修复。

## 保存、保持或停止

结束时选择以下一种模式：

- `save`：先同步浏览器中的最新 revision，再保存并停止；
- `discard`：不保存本 session 尚未持久化的修改并停止；
- `keep-30m`：保持 session，最多 30 分钟；
- `continue`：继续修改，不停止。

```sh
specline diagram stop --session <session-id> --mode <save|discard|keep-30m|continue> --json
```

空闲达到 30 分钟、stdin EOF、`SIGTERM` 或父进程退出时，runtime 会尝试同步
并幂等清理当前 session。同步失败时结果必须明确为未保存，不能把旧 revision
说成已保存。

多 session 的 stop-all 会影响多个工作，必须先生成列出全部受影响 session
的计划并单独批准：

```sh
specline diagram plan --action stop-all --session <id> --json
specline diagram stop-all --approved-plan <approved-digest> --json
```

## 使用 doctor 处理异常状态

先运行只读诊断：

```sh
specline diagram doctor --json
```

它检查 audit/release/runtime、固定版本与 checksum/closure、离线布局、
平台与 reload 状态、session 和 stale 安装目录。确认结果后才修复 stale
metadata：

```sh
specline diagram doctor --repair-stale --json
```

stale PID 处理会核对存活状态、父进程、启动时间和 session ownership。
ownership 不匹配、PID 已复用或无法核验时不会终止该进程。不要自行按 PID
强杀未知进程。

## 卸载并保留图

先停止受管 session，然后查看并批准当前卸载计划：

```sh
specline diagram plan --action uninstall --json
specline diagram uninstall --approved-plan <approved-digest> --json
```

卸载只删除计划列出的版本化 runtime 和记录的受管平台配置片段。所有
`.drawio`、伴随 Markdown、SVG、prototype、其他 MCP server 和无关平台配置
均保留。不要通过手工删除用户 diagram 目录来“卸载”。

## 失败时继续工作

以下情况都应返回可恢复状态：拒绝许可、MCP 缺失、断网、下载或 checksum
失败、依赖闭包不完整、runtime 不健康、端口失败、同步失败、首次重载后仍
不可发现，以及 release gate 尚未通过。

此时继续当前任务并输出 ASCII 图。不要改用容器化运行、托管编辑器、远端
资源或 MCP 回退、浮动依赖版本、广域监听，也不要绕过计划许可。

## 许可证注意事项

锁定的 draw.io webapp 31.1.2 和 Next AI Draw.io MCP server 0.2.3 均为
Apache-2.0。再分发必须附带完整许可证副本、保留适用 attribution/NOTICE，
并显著标记修改。draw.io 包内的图标、stencil、shape、template 和第三方
许可证也必须保留；未经明确许可，不得把打包的图标或 stencil 提取后用于
Atlassian 产品或 Marketplace，也不得暗示 draw.io 对 Specline 的关联或背书。

完整 provenance、wrapper/patch 变更边界、prominent modification notice 和
分别适用于两个上游作品的 `LICENSE.drawio`、`LICENSE.next-ai-drawio` 见
`core/runtimes/drawio/NOTICE.md`；更详细的运维合同见
`docs/diagram-runtime.md`。
