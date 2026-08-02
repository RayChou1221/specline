---
name: specline-diagram
description: 创建、读取和增量修改可在本地 Draw.io UI 中继续编辑的复杂关系图。MCP 可用时直接走上游工具；缺失时询问落点并写入 npx @next-ai-drawio/mcp-server。
license: MIT
compatibility: Compatible with specline.
metadata:
  author: specline
  version: "2.0"
---

# /specline-diagram 上游 Draw.io MCP 便利入口

## 定位与选择

Specline 只做便利入口与路由；画图引擎是上游 `@next-ai-drawio/mcp-server`（经 `npx ...@latest`）。图不是 Spec source of truth，也不替代 Explore 或 Visualize。

| 目标 | 使用方式 |
| --- | --- |
| 简单、瞬时、无需 GUI 编辑的关系 | ASCII |
| 页面 mockup、交互原型或可携带演示 | `/specline-visualize` |
| 复杂架构/流程/状态/依赖，且需要 GUI 手工编辑的 `.drawio` | `/specline-diagram` → 上游 MCP |

不得合并或替代 Visualize 的自包含单文件 HTML 契约。不得把 `@next-ai-drawio/mcp-server` 写入项目常驻 `package.json` 依赖。

**禁止作为默认路径**：受管 `doctor` / `install`、`planDigest`、`auditState` / `releaseGate`、`specline diagram` CLI、强制伴随 Markdown 元数据。

---

## 路径 A：MCP 可用 → 直接画图

当当前会话已能调用上游 drawio MCP 工具时，直接按上游工具流操作，不要展示受管 install 计划或 releaseGate 检查。

典型顺序：

1. `start_session`（如上游需要）
2. `create_new_diagram`（新图，须带 `xml`）或 `load_diagram`（已有文件）
3. 浏览器预览（上游提供的本地 UI）
4. `edit_diagram` / `get_diagram` / `list_pages` / `add_page` 等按需增量修改
5. 用户需要时 `export_diagram`

产物路径由用户选择；可约定落在 `specline/diagrams/<slug>/`（或用户明确关联的 change 下），但**不强制**伴随 `.md`。失败时诚实说明，可建议 ASCII 或稍后重试；不要启动受管 install 仪式。

---

## 路径 B：MCP 缺失 → 检测 → 询问 → 写入 → 重载

### 1. 检测

若会话中没有可用的 drawio / `@next-ai-drawio` MCP 工具，进入首次 setup。不要调用已删除的 `specline diagram` CLI。

### 2. 说明

向用户说明：将配置上游 MCP，命令为：

```text
npx @next-ai-drawio/mcp-server@latest
```

（配置形态：`command: npx`，`args: ["@next-ai-drawio/mcp-server@latest"]`；逻辑名建议 `drawio`。）

### 3. 询问落点（仅当前平台）

只配置**当前** Agent 平台；不要在本轮静默写入其它平台，也不依赖 `specline init` / `specline sync` 写 MCP。

询问 user-level vs project-level，**推荐用户级**：

| 平台 | 用户级（推荐） | 项目级（可选） |
| --- | --- | --- |
| Cursor | `~/.cursor/mcp.json` | `.cursor/mcp.json` |
| Claude Code | 用户级 Claude MCP 配置（按官方当前路径） | 项目 `.mcp.json` |
| Codex | 用户/项目 `.codex/config.toml` 的 `mcp_servers`（按官方当前路径） | 同左按 Codex 约定 |
| OpenCode | 用户级 OpenCode 配置（按官方当前路径） | 项目 `opencode.json` |

用户拒绝写入时：不修改任何 MCP 文件，允许回退 ASCII 或结束 Diagram 路径。

### 4. 用户确认后写入

1. 在选定文件中 upsert `drawio`（或平台允许的等价键）为上述 npx 条目。
2. 若存在旧受管 `specline-diagram` 条目（例如 command 指向 `specline diagram mcp` 或带受管 marker），**移除或替换**，避免与上游双 MCP 并存。
3. 保留用户其它无关 MCP 配置；不要修复 malformed 配置或改动未选择的平台。

Cursor JSON 示例（其它平台用对应结构）：

```json
{
  "mcpServers": {
    "drawio": {
      "command": "npx",
      "args": ["@next-ai-drawio/mcp-server@latest"]
    }
  }
}
```

### 5. 引导重载一次

写入后必须提示用户**重载 Agent 一次**；不得承诺热重载。重载后继续路径 A。若重载后仍无工具，诚实说明并建议检查 MCP 配置或回退 ASCII。

---

## 边界与清理提示

- 图仅用于沟通；禁止自动回写 proposal / design / tasks / spec。
- 保留用户已有 `specline/diagrams/`；不要强制删除。
- 若用户机器上仍有旧受管目录，可提示可选手动清理 `~/.specline/runtimes/drawio` 以释放磁盘（非必须）。
- 其它平台首次使用时各自再走路径 B；不要假定某一平台的 MCP 已覆盖全部平台。
