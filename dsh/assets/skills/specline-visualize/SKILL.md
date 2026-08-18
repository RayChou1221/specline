---
name: specline-visualize
description: 将已收敛的讨论制作成可持续修改的单文件 HTML 原型，帮助确认和交流想法。用于 Explore 后、原型图、HTML 原型、可视化、修改原型、交流想法等场景。
license: MIT
compatibility: Compatible with specline.
metadata:
  author: specline
  version: "1.0"
---

# /specline-visualize 原型可视化 Skill

## 第 1 层：定位与边界

**一句话定位**：把讨论结论变成浏览器可直接打开、可持续迭代的沟通原型，推进共识，不交付生产实现。

**典型入口**：
- Explore 后把已收敛方向做成原型
- 用户提出“原型图”“HTML 原型”“可视化”“交流想法”
- 用户要求修改已有原型、记录反馈或创建备选方向

**第一版唯一载体**：单文件 HTML。CSS 与 JavaScript 全部内联；不生成 PNG/PDF，不创建 React/Vite 项目。

**你可以做**：
- 页面 mockup、wireframe、流程图、架构图、状态机、概念板、多方案对比
- tab、折叠、modal/drawer、状态切换、简单内存导航、桌面/移动模拟
- 新建原型、局部修改原型、记录反馈、创建独立备选方向

**你不能做**：
- 修改生产代码或把原型升级为生产项目
- 接入真实后端、数据库、认证、API 或外部资源
- 自动进入 Pipeline 或自动回写 proposal/design/spec
- 把所有问题强行画成 Dashboard

## 第 2 层：输出契约

### 默认目录

通常生成两个同名文件：

```text
specline/prototypes/<requirement-slug>/
├── <requirement-slug>.html
└── <requirement-slug>.md
```

仅当**已有 change 且用户明确希望关联**时，才使用：

```text
specline/changes/<change>/prototypes/<requirement-slug>/
```

不得仅因发现相关 change 就自动关联，也不得擅自移动已有原型。修改时沿用原路径。

### 语义化命名

`requirement-slug` 和 HTML 文件名使用 lowercase-kebab-case，按以下优先级确定：

1. 用户指定
2. `<change>-<当前焦点>`
3. Explore 已收敛需求
4. `<对象>-<行为或问题>`

局部修改保持文件名。只有独立备选方向才新建语义后缀，例如 `checkout-review-compact`；禁止使用 `v2`、`final`、`new` 等无语义版本名。

### 伴随 Markdown

同名 `.md` 必须包含：

```markdown
# <Prototype Title>

## Purpose
本原型要确认或交流什么。

## Audience
谁会查看、基于它做什么决定。

## Confirmed
- 已由用户或 Artifact 明确的信息

## Prototype Assumptions
- 为了让原型可表达而暂时采用的假设

## Open Questions
- 尚待确认、会影响方向的问题

## Prototype
- HTML: `<当前路径>`
- Status: `draft | under-review | confirmed | parked`

## Revision History
- YYYY-MM-DD — <创建或修改摘要；反馈来源（如有）>
```

`Confirmed`、`Prototype Assumptions`、`Open Questions` 必须分开。Agent 推断只能进入 `Prototype Assumptions` 或 `Open Questions`，不得升级为需求。

## 第 3 层：主流程

### 步骤 1：锁定沟通目标

首次生成前，用一句话明确：**这次原型要让谁确认或交流什么？**

- 上下文已经明确：复述目标并继续。
- 缺少决定性信息：只问最少问题，优先问受众、待确认决策、关键场景。
- 方向仍模糊：建议先回 `/specline-explore`，不要用视觉细节掩盖需求不清。

随后从对话、Explore 结论和用户指定 Artifact 中提取三类信息：Confirmed / Prototype Assumptions / Open Questions。读取既有产品界面或设计规范时，遵循已有设计系统。

### 步骤 2：选择表达类型与视觉方向

先按沟通目标选择最合适的表达类型，再确定视觉方向：

| 沟通目标 | 优先表达 |
|---|---|
| 确认页面布局与操作 | 页面 mockup / wireframe |
| 解释步骤、分支、角色交接 | 流程图 |
| 解释组件关系、数据边界 | 架构图 |
| 解释状态与转换条件 | 状态机 |
| 对齐概念、语气、信息组织 | 概念板 |
| 比较互斥方向 | 多方案对比 |

视觉方向至少明确：信息层级、密度、色彩角色、字体策略、交互反馈。目标是推进共识，不是制作艺术品。

视觉纪律：
- 使用真实语境中的信息结构和可信的虚构/脱敏数据。
- 先表达核心关系，再补交互和视觉细节。
- 第二轮做减法式精修：删除不支持沟通目标的装饰、卡片、文案和交互。
- 避免无语境渐变、泛滥阴影、卡片墙、巨型标题和套模板式 Dashboard。
- 既有产品优先复用其颜色、间距、字体、组件和交互习惯。

### 步骤 3：生成自包含 HTML

HTML 必须满足：
- 一个 `.html` 文件，内联 CSS/JS，无 npm、无构建步骤。
- 无 CDN、外部字体、外链图片、第三方脚本或任何外部网络请求。
- 浏览器直接打开即可表达核心路径；即使 JavaScript 失败，关键内容仍可阅读。
- 使用语义 HTML、清晰焦点样式、合理对比度和键盘可达控件。
- 对窄屏提供基本响应式布局；避免文本截断、元素重叠和横向溢出。
- 交互仅用于沟通：状态保存在内存中，刷新后丢失是允许且预期的。

### 步骤 4：安全与真实性约束

必须使用虚构或脱敏数据。禁止：
- 真实 secrets、访问令牌、个人敏感信息或生产数据
- `fetch`、XHR、WebSocket、外部 `form action` 或其他网络通信
- `eval`、`new Function`、动态加载远程代码
- 自动下载、读取真实 cookie、读取或写入 `localStorage` / `sessionStorage`
- 仿冒真实登录、身份验证、支付或金融确认页面
- 声称原型已连接真实服务

若沟通目标涉及登录或支付，只能制作明确标注为“概念演示 / 非真实流程”的低保真结构，不得复制真实品牌凭证页或诱导输入真实信息。

### 步骤 5：修改已有原型

修改前必须同时读取现有 HTML 与同名 Markdown：

1. 从用户要求定位受影响区域。
2. 未点名区域默认保持结构、文案、样式和行为稳定。
3. 若请求会连带影响其他区域，编辑前明确说明最小必要影响。
4. 只更新相关的 Confirmed / Prototype Assumptions / Open Questions。
5. 在 Revision History 追加记录，不覆盖历史。
6. 局部迭代保持原文件名；独立备选方向新建语义化后缀文件及配套 Markdown。

不得以“统一风格”“顺便优化”为由全量重写现有原型。

### 步骤 6：验证与报告

生成或修改后执行验证清单。当前平台有浏览器能力时，直接打开本地 HTML，检查桌面与窄屏、主要交互和视觉边界；无浏览器能力时将状态诚实报告为 `not_verified`，不得用静态阅读冒充浏览器验证。

完成报告包含：
- HTML 与 Markdown 路径
- 本轮新增/修改的区域
- 保持稳定的区域（修改场景）
- Prototype Assumptions 与 Open Questions
- 验证方式、结果和未验证项

## 验证清单

### 文件与自包含
- [ ] 仅生成单文件 HTML 与同名 Markdown
- [ ] CSS/JS 全部内联，无 npm、构建、CDN 和外部资源
- [ ] 文件名符合语义化 lowercase-kebab-case
- [ ] HTML 路径和 Markdown 状态一致

### 安全
- [ ] 数据均为虚构或脱敏
- [ ] 无真实 secrets、真实认证/支付仿冒
- [ ] 无 `fetch` / XHR / WebSocket / 外部 form action
- [ ] 无 `eval` / `new Function` / 自动下载
- [ ] 无 cookie、`localStorage`、`sessionStorage` 读写

### 表达质量
- [ ] 沟通目标和受众明确
- [ ] Confirmed / Prototype Assumptions / Open Questions 清晰分离
- [ ] 类型服务于目标，没有强行 Dashboard 化
- [ ] 信息层级清晰，已做第二轮减法式精修
- [ ] 既有产品遵循已有设计系统

### 浏览器验证
- [ ] HTML 可直接打开，控制台无阻塞性错误
- [ ] 主要交互可用，键盘焦点可见
- [ ] 桌面和窄屏无明显重叠、裁切或横向溢出
- [ ] modal/drawer 可关闭，状态切换可恢复
- [ ] 无浏览器能力时明确记录 `not_verified`

## 完成后的下一步

只提供选择，不自动执行：

A. 继续修改当前原型
B. 记录他人反馈，并据此做局部修改
C. 用户确认后，提议捕获到 proposal/design/spec
D. 创建一个语义明确的备选方向
E. 搁置当前原型

用户选择 C 时，先说明准备捕获哪些 Confirmed 结论，再交给对应 Specline 流程；不得由本 Skill 自动回写 Artifact 或进入 Pipeline。

## Anti-Rationalization

| 借口 | 现实 |
|---|---|
| “先画出来再说，目标之后补” | 没有待确认目标的原型只会制造视觉噪声。先用一句话锁定沟通目的。 |
| “一个 Dashboard 最容易展示” | 表达类型必须服从沟通目标；流程、架构和状态不应被塞进卡片墙。 |
| “只是演示，连个 CDN 没关系” | 自包含是可携带、可复现和安全审查的基础，任何外部依赖都违反契约。 |
| “为了更真实，可以接测试 API” | 本 Skill 只做沟通原型；真实连接属于实现范围。 |
| “用户没提其他区域，顺手统一一下” | 未点名区域默认稳定；局部修改不是重新设计授权。 |
| “Agent 推断很合理，可以写进 Confirmed” | 合理不等于已确认。推断必须留在 Prototype Assumptions 或 Open Questions。 |
| “静态看过代码就算浏览器验证” | 浏览器验证需要实际打开和操作；做不到就诚实标记 `not_verified`。 |
| “确认了就直接更新 Spec” | 原型不自动成为需求；必须由用户选择并通过对应流程捕获。 |
