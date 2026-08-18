# dsh-specline

Specline 在 DeepSeek Harness（DSH）上的 **Cordis bundle 插件**（`dsh-specline@0.x`）。它是第五个运行时表面：让 DSH 看见斜杠、角色工具和会话武装。它**不是**第五个文件部署平台——不会写 `.dsh/skills`，也不会把 `dsh` 写进 `specline init --platform`。

卡点策略、Change、Gate 状态仍住在每个业务仓库的 `specline/`（尤其是 `specline/config.yaml`），**不**住在 `~/.dsh`。

DSH 仍处于开发者预览。本包用 `0.x` 扛兼容风险，不绑 `specline` 2.x 的稳定承诺。

## 安装

机器上每个要用的 profile 做一次：

```bash
dsh plugin add dsh-specline
dsh plugin --profile web add dsh-specline
dsh plugin --profile headless add dsh-specline
```

然后重启（或重开）`dsh web`。脚本场景再把插件加到 `headless` profile。

每个业务仓库仍要有 Specline 项目运行时（`config.yaml`、`changes/`、`bin/gate.sh`）：

```bash
cd <repo>
specline init --platform none
# 若该仓库还在用 Cursor / Claude / Codex / OpenCode，继续用已有平台列表：
# specline init --platform cursor
# specline init --platform cursor,claude
```

**不是** `specline init --platform dsh`。`dsh` 不是合法平台名；传入会按未知平台报错。Web 斜杠若发现未 init，会询问是否在当前仓库 cwd 执行 `specline init --platform none`；Headless 只报错、不代跑 init。

Gate / init 需要本机上的 Specline CLI（`npm i -g specline` 或运行时 `npx specline`）。插件不把 CLI 打进 DSH 安装物。

## 禁止把 GitHub 根仓当插件源

**不要**执行：

```bash
dsh plugin add github:RayChou1221/specline
```

根仓 `package.json` 是 CLI 包 `specline`，**没有** `dsh.bundle`。这条命令只会把 CLI 当普通依赖装进 profile，**不会激活插件层**，还可能破坏「CLI 零运行时第三方依赖」。

合法入口只有 npm 上的 `dsh-specline`（或下方内测路径 / tgz）。

## 内测（未上 npm）

在本仓根目录：

```bash
dsh plugin add ./dsh
# 或打包后：
# dsh plugin add ./dsh-specline-0.1.0.tgz
```

可加 `--profile web` / `--profile headless`。不要用 git 根仓库 URL 当插件安装源。

## 斜杠启动

不是「打开 DSH 就变成 Specline」。平时是普通助手；**只有用户主动敲斜杠**才武装**当前这一次会话**。模型不能 `skill()` 自己开流水线。

```text
/specline-pipeline 做 JWT 登录
/specline-quickfix …
/specline-explore …
/specline-knowledge
```

还有 `/specline-propose`、`/specline-apply-change`、`/specline-archive-change`、`/specline-visualize`、`/specline-diagram`、`/specline-init-web`。未敲斜杠时看不到 pipeline Skill，也调不到角色工具。

已 init 的仓库：斜杠只武装当前会话（inject Skill、挂角色工具、写拦截、bind），**不**部署 `.dsh/skills`，**不**把 `dsh` 写入 `platforms.yaml`。第二天换会话时读项目里的绑定和 `.pipeline-state.json`，不在 `~/.dsh` 另存一套进度。

## 策略家是项目 yaml，不是 ~/.dsh

改人工卡点：打开**这个仓库**的 `specline/config.yaml`，改 `pipeline.human_gate_policy`（`full` / `minimal` / `none`）。

不要改插件 Config，不要改 `~/.dsh`。仓库 A 可以 `full`，仓库 B 可以 `none`。改完不必重启 `dsh web`（每次卡点重新读文件）。`~/.dsh/settings.yaml` 是模型密钥的地方，不放 Specline 策略。

## peer 范围（预览期占位）

`dsh` / `@deepseek-ai/*` 的 peer 范围是预览期占位，**不钉死精确版本**。DSH API 仍可能破兼容；本包 `0.x` 会跟预览期走，不承诺长期锁定某一 rc。装插件前请对照当前 DSH 预览文档做一次冒烟，而不是把某次碰巧能跑的版本写进生产约束。

## 更新与卸载

```bash
dsh plugin --profile web update dsh-specline
dsh plugin --profile web remove dsh-specline
```

对方不必 fork 本仓，也不必把 Specline 源码放进业务项目。`specline/` 仍由各仓库自己的 `specline init` 生成。
