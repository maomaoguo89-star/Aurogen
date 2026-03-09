# Aurogen Web 控制台 PRD

## 1. 目标

为 Aurogen 提供一个面向运营和配置管理的 Web 控制台，当前阶段覆盖 4 个页面：

1. `Chat`
2. `Agents`
3. `Channels`
4. `Providers`

该控制台需要：

- 支持基于 `web channel` 的聊天
- 支持 `agent`、`channel`、`provider` 的完整查看与配置管理
- 具备可扩展的结构，后续可平滑加入 `Skills` 与 `MCP` 管理

本文档面向前端实现，重点说明页面结构、关键数据模型、视觉风格与 API 对接方式。

## 2. 视觉风格与交互原则

本项目的 Web 控制台不应被实现成普通的后台 CRUD 页面，而应呈现为一个偏“AI 控制台 / Agent Ops Console”的产品。

### 2.1 高级感关键词

- 深色优先，整体克制
- 面板化布局，分区清晰
- 低噪音，不堆砌装饰
- 信息有层级，不把所有内容同时展开
- 操作反馈即时，但不过度动画化

### 2.2 视觉设计原则

- 主背景使用深色中性灰，不使用高饱和大面积品牌色
- 高亮色仅用于关键动作、选中态、实时状态和事件标签
- 卡片与面板使用细边框或极轻阴影，而不是厚重投影
- 页面内部尽量保持固定栅格和统一留白
- 字号层级稳定，避免用过多字号制造“设计感”

### 2.3 交互设计原则

- 使用“列表 + 详情”或“三栏布局”而不是频繁跳页
- 优先使用右侧详情抽屉或固定详情栏进行查看和编辑
- `thinking`、`tool_call`、`tool_result` 必须与普通聊天正文分层显示
- 删除类操作必须展示依赖关系和二次确认
- 敏感字段如 `api_key` 默认遮罩，仅在用户操作后短暂展示
- 空状态、加载状态、错误状态要被显式设计，不能只留空白

### 2.4 Apple-inspired 边界说明

本项目采用的是 `Apple-inspired`，不是对 Apple 系统界面的直接复刻。

可以引入的细节：

- 更柔和的大圆角，但保持控制台式排布
- 轻磨砂背景层，用于侧边栏、抽屉、浮层等局部区域
- 柔和且分层的阴影，用于区分面板深度
- 更细腻的 `hover`、`press`、`reveal` 动效
- 更克制的字重、留白和排版节奏

不建议引入的细节：

- 大面积高透明玻璃导致信息对比度下降
- 过强高光、镜面反射、炫目的渐变描边
- 过重阴影造成悬浮层“漂起来”
- 夸张弹跳、橡皮筋式转场、过长 easing

设计边界：

- 信息可读性优先于视觉效果
- 功能区仍是“控制台”，不是纯展示型官网
- 磨砂质感用于增强层次，而不是替代层次

### 2.5 侧边栏规范

侧边栏是控制台的信息骨架，应该比内容区更安静、更稳定，不应抢夺主视觉焦点。

结构建议：

- 顶部：品牌区
- 中部：主导航区
- 下部：辅助导航区或未来扩展区
- 底部：状态区与用户操作区

尺寸建议：

- 展开宽度：`240px` 到 `272px`
- 折叠宽度：`72px` 到 `80px`
- 导航项高度：`40px` 到 `44px`
- 组间距：大于普通列表项间距

交互状态：

- 默认态：低对比，保持克制
- 悬浮态：轻微背景提亮或磨砂增强
- 激活态：使用强调色边条、浅高亮底或更强层次
- 折叠态：保留图标与 tooltip，不保留长文案

信息层级：

- 主导航允许分组标题
- 二级导航仅在确有必要时使用，避免把侧边栏做成文件树
- 当前阶段建议一级导航固定为：
  - `Chat`
  - `Agents`
  - `Channels`
  - `Providers`

建议线框图：

```text
┌──────────────────────────────┐
│ Aurogen                      │
│ Agent Ops Console            │
├──────────────────────────────┤
│ MAIN                         │
│ > Chat                       │
│   Agents                     │
│   Channels                   │
│   Providers                  │
├──────────────────────────────┤
│ LATER                        │
│   Skills                     │
│   MCP                        │
├──────────────────────────────┤
│ Status                       │
│ web: online                  │
│ feishu: online               │
│ mcp: 0 loaded                │
└──────────────────────────────┘
```

## 3. Design Tokens

本节用于指导前端把设计要求映射到 CSS Variables、Tailwind Theme 或其他 design system 配置。

### 3.1 颜色 Tokens

建议使用深色中性灰为基础色板，强调色只占较小面积。

```text
--color-bg-app:            #0b0d12
--color-bg-elevated:       rgba(22, 24, 31, 0.72)
--color-bg-panel:          rgba(18, 20, 26, 0.82)
--color-bg-hover:          rgba(255, 255, 255, 0.06)
--color-bg-active:         rgba(255, 255, 255, 0.10)
--color-border-subtle:     rgba(255, 255, 255, 0.08)
--color-border-strong:     rgba(255, 255, 255, 0.14)
--color-text-primary:      rgba(255, 255, 255, 0.92)
--color-text-secondary:    rgba(255, 255, 255, 0.64)
--color-text-tertiary:     rgba(255, 255, 255, 0.42)
--color-accent:            #7c9cff
--color-accent-soft:       rgba(124, 156, 255, 0.16)
--color-success:           #36c28b
--color-warning:           #f3b45b
--color-danger:            #ff6b7a
--color-thinking:          #9b8cff
--color-tool:              #56b6ff
```

### 3.2 间距 Tokens

推荐使用 4px 基础网格：

```text
--space-1:  4px
--space-2:  8px
--space-3:  12px
--space-4:  16px
--space-5:  20px
--space-6:  24px
--space-8:  32px
--space-10: 40px
--space-12: 48px
```

建议：

- 卡片内部最常用间距：`16px` 或 `20px`
- 页面区块间距：`24px` 到 `32px`
- 三栏布局主 gutter：`20px` 到 `24px`

### 3.3 圆角 Tokens

Apple-inspired 需要更柔和的圆角，但不能泛滥。

```text
--radius-xs:  8px
--radius-sm:  12px
--radius-md:  16px
--radius-lg:  20px
--radius-xl:  24px
--radius-pill: 999px
```

建议：

- 按钮、输入框：`12px`
- 卡片、表格容器：`16px`
- 抽屉、浮层：`20px`
- 消息气泡：`18px` 到 `20px`

### 3.4 阴影 Tokens

阴影应该体现层级，不应该制造“厚重感”。

```text
--shadow-sm:  0 4px 12px rgba(0, 0, 0, 0.18)
--shadow-md:  0 10px 30px rgba(0, 0, 0, 0.22)
--shadow-lg:  0 18px 48px rgba(0, 0, 0, 0.26)
--shadow-focus: 0 0 0 3px rgba(124, 156, 255, 0.22)
```

建议：

- 普通卡片尽量只用 `shadow-sm` 或无阴影
- 抽屉和浮层使用 `shadow-md`
- 不建议多个面板同时使用重阴影

### 3.5 动画 Tokens

动效应短、轻、稳定。

```text
--duration-fast:   120ms
--duration-base:   180ms
--duration-slow:   260ms
--ease-standard:   cubic-bezier(0.2, 0.8, 0.2, 1)
--ease-emphasis:   cubic-bezier(0.22, 1, 0.36, 1)
```

建议：

- hover：`120ms`
- 抽屉 / 浮层进出：`180ms` 到 `220ms`
- 页面转场不应使用明显位移动画

### 3.6 磨砂与模糊 Tokens

磨砂是局部增强项，不是全局底色。

```text
--blur-sidebar:  20px
--blur-drawer:   24px
--blur-popover:  16px
--glass-tint:    rgba(24, 26, 34, 0.68)
```

建议：

- 仅在侧边栏、顶部浮层、抽屉、弹窗等层级区使用
- 大面积内容区仍以实心面板为主，保证可读性

## 4. 页面结构与线框图

### 4.1 Chat

页面目标：

- 创建新的 `web` 会话
- 展示会话列表
- 加载单个会话历史消息
- 基于 SSE 展示实时事件流

主区域说明：

- 左侧：会话列表与搜索
- 中间：聊天消息流
- 右侧：当前会话的元信息、事件流、运行上下文

建议线框图：

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ Chat                                                     New Chat   web ▼    │
├──────────────────────┬───────────────────────────────────┬───────────────────┤
│ Sessions             │ Conversation                      │ Session Details   │
│                      │                                   │                   │
│ Search sessions      │ [User] 你好                       │ Session ID        │
│ ───────────────────  │                                   │ web@8709885       │
│ web@8709885          │ [Thinking] 正在分析请求...         │                   │
│ web@8709001          │                                   │ Channel: web      │
│ web@8708123          │ [Tool Call] web_fetch(...)        │ Agent: main       │
│                      │                                   │ Provider: openai  │
│                      │ [Tool Result] 200 OK              │                   │
│                      │                                   │ Event Timeline    │
│                      │ [Assistant] 你好，有什么可以帮你？ │ THINKING          │
│                      │                                   │ TOOL_CALL         │
│                      │                                   │ TOOL_RESULT       │
├──────────────────────┴───────────────────────────────────┴───────────────────┤
│ Type a message...                                              Send          │
└──────────────────────────────────────────────────────────────────────────────┘
```

关键交互：

- 点击 `New Chat` 时先调用 `POST /chat/session`
- 发送消息后，前端以 SSE 流方式监听 `thinking/tool_call/tool_result/final`
- 右侧详情栏应始终展示当前会话绑定的 `agent/channel/provider`
- 支持在左侧会话列表中快速切换会话，而不是重新进入页面

状态设计：

- 空状态：展示“开始新对话”的引导卡片
- 加载状态：消息流骨架屏 + 右侧详情占位
- 错误状态：SSE 断开、会话加载失败、消息发送失败要分别提示

扩展预留：

- 右侧详情栏后续可加入 `Skills` 与 `MCP tools` 只读预览

### 4.2 Agents

页面目标：

- 查看所有 agent
- 查看单个 agent 详情
- 新建 agent
- 更新 agent
- 删除 agent

说明：

- `main` 为内置 agent，不可删除
- 删除 agent 前，后端会检查是否仍被 channel 引用

建议线框图：

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ Agents                                                          + New Agent  │
├──────────────────────────────┬───────────────────────────────────────────────┤
│ Agent List                   │ Agent Detail                                  │
│                              │                                               │
│ Search agents                │ Name: main                                    │
│ ───────────────────          │ Description: main agent                       │
│ main        builtin          │ Model: claude-sonnet-4-6-think                │
│ heartbeat                    │ Provider: openai_custom                       │
│ assistant                    │ Memory Window: 100                            │
│                              │                                               │
│                              │ Tabs: [Overview] [Config] [Skills] [Sessions] │
│                              │                                               │
│                              │ Actions: Edit / Delete                        │
└──────────────────────────────┴───────────────────────────────────────────────┘
```

关键交互：

- 列表点击即更新右侧详情，不建议整页跳转
- 编辑时优先使用右侧抽屉或详情区内联编辑
- 删除前展示被哪些 channel 引用

状态设计：

- 空状态：提示用户创建第一个 agent
- 错误状态：provider 不存在、删除受阻、保存失败

扩展预留：

- 后续 `Skills` 管理可以直接挂在 Agent 详情页的 `Skills` tab

### 4.3 Channels

页面目标：

- 查看所有已配置 channel
- 查看所有支持的 channel 类型
- 查看单个 channel 详情
- 新建 channel
- 更新 channel
- 删除 channel

说明：

- `web` 是内置 channel
- `web` 不出现在 `GET /channels/supported`
- `web` 不允许通过 API 新增和删除

建议线框图：

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ Channels                                                        + Add Channel │
├──────────────────────────────────────────────────────────────────────────────┤
│ Configured Channels                                                           │
│ ┌──────────────────────────────────────────────────────────────────────────┐ │
│ │ key       type     agent_name   description        status     actions    │ │
│ │ web       web      main         web channel        online     View       │ │
│ │ feishu    feishu   main         -                  online     Edit/Delete│ │
│ └──────────────────────────────────────────────────────────────────────────┘ │
├──────────────────────────────────────────────────────────────────────────────┤
│ Supported Channel Types                                                       │
│ ┌──────────────────────────────────────────────────────────────────────────┐ │
│ │ type      description                    required_settings              │ │
│ │ feishu    飞书 WebSocket channel         app_id, app_secret            │ │
│ └──────────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────────┘
```

关键交互：

- 新建 channel 时先选择 `type`，再根据 `required_settings` 动态渲染字段
- `web` 只允许查看，不允许出现在新增与删除动作中
- 更新 channel 后可以提示“配置已应用”

状态设计：

- 空状态：提示先查看 `supported` 再创建实例
- 错误状态：配置字段缺失、agent 不存在、重启失败

扩展预留：

- 未来若增加更多 channel 类型，本页面结构无需变化

### 4.4 Providers

页面目标：

- 查看所有已配置 provider
- 查看支持的 provider 类型与字段要求
- 查看单个 provider 详情
- 新建 provider
- 更新 provider
- 删除 provider

说明：

- provider 配置结构为 `type + description + settings`
- 删除 provider 前，后端会检查哪些 agent 正在使用该 provider

建议线框图：

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│ Providers                                                     + New Provider │
├──────────────────────┬───────────────────────────────────────────────────────┤
│ Provider Instances   │ Provider Detail / Editor                             │
│                      │                                                       │
│ openai               │ Key: openai                                          │
│ openai_custom        │ Type: openai                                         │
│ anthropic_prod       │ Description: official openai provider                │
│                      │                                                       │
│                      │ Settings                                              │
│                      │ api_key      [••••••••••••••••••••        ]          │
│                      │ thinking     [ none / low / medium / high ]          │
│                      │                                                       │
│                      │ Used By Agents                                        │
│                      │ - main                                                │
│                      │ - heartbeat                                           │
│                      │                                                       │
│                      │ Actions: Save / Delete                                │
└──────────────────────┴───────────────────────────────────────────────────────┘
```

关键交互：

- 新建 provider 时先选择 `type`
- 根据 `supported` 中的 `required_settings/optional_settings` 生成表单
- `api_key` 等敏感字段使用遮罩输入框
- 删除前展示 `used_by_agents`

状态设计：

- 空状态：提示先添加 provider 实例
- 错误状态：settings 缺失、被 agent 引用无法删除、保存失败

扩展预留：

- 后续不同 provider 类型增多时，仍通过 `supported` 驱动表单生成

## 5. 关键对象模型

### 5.1 Agent

```json
{
  "key": "main",
  "builtin": true,
  "name": "main",
  "description": "main agent",
  "model": "claude-sonnet-4-6-think",
  "provider": "openai_custom",
  "memory_window": 100
}
```

### 5.2 Channel

```json
{
  "key": "feishu",
  "type": "feishu",
  "agent_name": "main",
  "description": "",
  "settings": {
    "app_id": "cli_xxx",
    "app_secret": "xxx"
  },
  "builtin": false,
  "running": true
}
```

### 5.3 Provider

```json
{
  "key": "openai_custom",
  "type": "openai_custom",
  "description": "openai compatible custom provider",
  "settings": {
    "api_key": "sk-xxx",
    "api_base": "https://aihubmix.com/v1",
    "thinking": true
  },
  "used_by_agents": ["main", "heartbeat"]
}
```

### 5.4 Session

```json
{
  "session_id": "web@8709885",
  "channel": "web",
  "chat_id": "8709885"
}
```

### 5.5 Agent Event

SSE 事件类型：

- `thinking`
- `tool_call`
- `tool_result`
- `final`

每个事件通过 SSE 输出：

```text
event: thinking
data: {"content":"..."}
```

## 6. 页面与 API 映射

## 6.1 Chat 页面

### 创建会话

- `POST /chat/session`

请求：

```json
{
  "channel": "web",
  "chat_id": "optional"
}
```

响应：

```json
{
  "session_id": "web@8709885",
  "channel": "web",
  "chat_id": "8709885",
  "agent_name": "main"
}
```

说明：

- 当前仅支持 `channel=web`
- 如果不传 `chat_id`，后端自动生成

### 获取会话列表

- `GET /list-sessions?channel=web`

响应：

```json
{
  "agent_name": "main",
  "sessions": [
    {
      "session_id": "web@8709885",
      "channel": "web",
      "chat_id": "8709885"
    }
  ]
}
```

### 获取单个会话消息

- `GET /get-session?channel=web&session_id=web@8709885`

响应：

```json
{
  "agent_name": "main",
  "session_id": "web@8709885",
  "messages": [
    {
      "role": "user",
      "content": "你好"
    },
    {
      "role": "assistant",
      "content": "你好，有什么可以帮你？"
    }
  ]
}
```

### SSE 事件协议说明

- `GET /chat/events/schema`

响应：

```json
{
  "transport": "sse",
  "endpoint": "/chat",
  "events": [
    {
      "event": "thinking",
      "description": "LLM 思考过程",
      "data_schema": {
        "content": "string"
      }
    },
    {
      "event": "tool_call",
      "description": "工具调用开始",
      "data_schema": {
        "tool_name": "string",
        "args": "object"
      }
    },
    {
      "event": "tool_result",
      "description": "工具调用结果",
      "data_schema": {
        "tool_name": "string",
        "result": "string"
      }
    },
    {
      "event": "final",
      "description": "最终回复",
      "data_schema": {
        "content": "string"
      }
    }
  ]
}
```

### 发送消息并接收 SSE

- `POST /chat`

请求：

```json
{
  "session_id": "web@8709885",
  "message": "你好",
  "metadata": {}
}
```

说明：

- 这是 SSE 端点，浏览器应按流式方式消费
- 事件顺序通常为：
  - `thinking`
  - `tool_call`
  - `tool_result`
  - `final`
- 如果本轮没有工具调用，则可能只有：
  - `thinking`
  - `final`

## 6.2 Agents 页面

### 获取列表

- `GET /agents`

### 获取详情

- `GET /agents/{name}`

### 新建

- `POST /agents`

请求：

```json
{
  "name": "assistant",
  "display_name": "assistant",
  "description": "业务助手",
  "model": "gpt-4o",
  "provider": "openai_custom",
  "memory_window": 100
}
```

说明：

- 后端会复制 `./template` 到 `./.workspace/agents/{name}`

### 更新

- `PATCH /agents/{name}`

请求为部分更新：

```json
{
  "description": "新的描述",
  "model": "gpt-4o-mini",
  "provider": "openai"
}
```

### 删除

- `DELETE /agents/{name}`

说明：

- `main` 不可删除
- 若仍被 channel 引用，会返回 400

## 6.3 Channels 页面

### 获取运行状态

- `GET /channels`

### 获取已配置列表

- `GET /channels/config`

### 获取详情

- `GET /channels/{key}`

### 获取支持的 channel 类型

- `GET /channels/supported`

响应示例：

```json
{
  "supported": [
    {
      "type": "feishu",
      "description": "飞书 WebSocket channel",
      "required_settings": ["app_id", "app_secret"]
    }
  ]
}
```

### 新建

- `POST /channels`

请求：

```json
{
  "key": "feishu_work",
  "type": "feishu",
  "agent_name": "main",
  "description": "飞书工作台",
  "settings": {
    "app_id": "cli_xxx",
    "app_secret": "xxx"
  }
}
```

### 更新

- `PATCH /channels/{key}`

请求为部分更新：

```json
{
  "agent_name": "assistant",
  "description": "新的描述",
  "settings": {
    "app_secret": "new_secret"
  }
}
```

说明：

- 更新后，后端会尝试重启对应 channel，使配置立即生效

### 删除

- `DELETE /channels/{key}`

说明：

- 内置 `web` channel 不可删除

### 全量重载

- `POST /channels/reload`

## 6.4 Providers 页面

### 获取支持类型

- `GET /providers/supported`

响应示例：

```json
{
  "supported": [
    {
      "type": "openai",
      "description": "OpenAI 官方 API",
      "required_settings": ["api_key"],
      "optional_settings": ["thinking"]
    }
  ]
}
```

### 获取已配置列表

- `GET /providers/config`

### 获取详情

- `GET /providers/{key}`

### 新建

- `POST /providers`

请求：

```json
{
  "key": "official_openai",
  "type": "openai",
  "description": "official openai",
  "settings": {
    "api_key": "sk-xxx"
  }
}
```

### 更新

- `PATCH /providers/{key}`

请求为部分更新：

```json
{
  "description": "新的描述",
  "settings": {
    "thinking": "medium"
  }
}
```

### 删除

- `DELETE /providers/{key}`

说明：

- 若仍被 agent 引用，会返回 400，并附带 `used_by_agents`

## 7. 首页与全局状态接口

### 系统状态

- `GET /system/status`

响应示例：

```json
{
  "app": "ok",
  "agent_loop_running": true,
  "heartbeat_running": true,
  "channels": [
    {
      "name": "web",
      "type": "WebChannel",
      "running": true
    }
  ],
  "mcp": {
    "configured": 0,
    "loaded_count": 0,
    "loaded_tools": []
  }
}
```

### 资源摘要

- `GET /resources/summary`

响应示例：

```json
{
  "agents_count": 2,
  "channels_count": 2,
  "providers_count": 2,
  "sessions_count": 8
}
```

## 8. 组件级规范

### 8.1 表格

视觉特征：

- 使用圆角容器包裹整张表，而不是每行单独做卡片
- 表头与内容区保持明显但克制的层级差
- 行 hover 使用浅提亮，不使用高饱和底色

交互状态：

- 默认态：清晰但低噪音
- 悬浮态：轻微背景提亮
- 选中态：可使用强调色边或淡色底

推荐用法：

- `Channels`、`Providers` 列表页
- 简短摘要型信息

不推荐用法：

- 在表格里塞入过多多行说明文本
- 让每一行都有多个主按钮

### 8.2 抽屉

视觉特征：

- 使用更强一级的圆角与阴影
- 可加入轻磨砂背景，但内部表单区应保持实心
- 标题区、内容区、底部操作区清晰分层

交互状态：

- 打开关闭使用 `180ms` 左右平滑过渡
- 遮罩层不应过黑，保持上下文可感知

推荐用法：

- 编辑 `agent`
- 编辑 `channel`
- 编辑 `provider`

不推荐用法：

- 在抽屉里再打开多层抽屉
- 把复杂长流程都塞进单个抽屉

### 8.3 事件卡片

视觉特征：

- 与消息正文分开，采用辅助卡片形态
- `thinking`、`tool_call`、`tool_result` 使用不同的标签色
- 卡片背景应弱于普通消息气泡，避免抢主视觉

交互状态：

- 支持折叠长内容
- 长 JSON 参数与结果允许展开查看

推荐用法：

- `Chat` 页面右侧事件时间线
- 或消息流中穿插的辅助事件块

不推荐用法：

- 与最终回复用同一视觉层级
- 让工具结果直接撑满整个对话区

### 8.4 消息气泡

视觉特征：

- 用户与助手气泡应有明显区分，但不使用过强色差
- 助手气泡更偏中性色，用户气泡可以带弱强调色
- 保持较大圆角和舒适内边距

交互状态：

- 支持复制内容
- 代码块区域应独立处理，不强行塞进单层纯文本气泡

推荐用法：

- 仅用于最终对话内容

不推荐用法：

- 把 `thinking`、`tool_call`、`tool_result` 全部做成和聊天正文相同的气泡

### 8.5 侧边栏导航项

视觉特征：

- 图标与文案保持稳定对齐
- 激活项可采用浅色底 + 边线或左侧高亮条
- 折叠态仍保留统一图标视觉节奏

交互状态：

- hover 时轻微提亮
- active 时层级清晰但不过于发光

推荐用法：

- 一级导航
- 状态入口

不推荐用法：

- 导航项里堆放过多徽标、数值和按钮

### 8.6 顶部栏与状态栏

视觉特征：

- 顶部栏应更轻，作为操作入口而不是主视觉区
- 状态栏可做成低对比、细条形区域

推荐用法：

- 顶部栏：全局搜索、创建操作、当前上下文
- 状态栏：channel 在线状态、mcp 状态、同步状态

## 9. 前端实现建议

## 9.1 路由

- `/chat`
- `/agents`
- `/channels`
- `/providers`

## 9.2 数据流建议

### Chat

1. 页面初始化调用 `POST /chat/session` 或从已有 session 列表中选择
2. 左侧列表调用 `GET /list-sessions?channel=web`
3. 点击某个 session 后调用 `GET /get-session`
4. 发送消息时连接 `POST /chat` 的 SSE 流
5. 根据 `event` 渲染 `thinking/tool_call/tool_result/final`

### Agents / Channels / Providers

1. 列表页先拉对应 list/config 接口
2. 详情页进入后再拉单项详情
3. 编辑走 `PATCH`
4. 删除前展示后端返回的依赖信息

## 9.3 UI 交互建议

- `Chat` 页面使用三栏布局，避免把会话列表和事件信息折叠到多个弹层里
- `thinking/tool_call/tool_result` 与普通消息分层显示，不要混成统一气泡列表
- 配置页优先使用右侧抽屉或固定侧边详情，而不是频繁跳页
- `provider`、`channel` 表单应基于 `supported` 接口动态生成字段
- 所有删除动作都要二次确认，并在确认弹窗中展示依赖关系
- 敏感字段默认遮罩，只在用户明确交互后显示

## 9.4 前端实现提示

页面优先级建议：

1. 先实现 `Chat`，因为它最能体现产品能力，也最依赖事件流体验
2. 再实现 `Providers`，因为其接口最完整，适合先把动态表单跑通
3. 然后实现 `Agents`
4. 最后实现 `Channels`

组件与交互建议：

- `Chat` 建议使用三栏固定布局，中间消息区可独立滚动
- `Agents`、`Channels`、`Providers` 建议统一使用“左侧列表 + 右侧详情”的结构
- `Providers` 和 `Channels` 的新建/编辑应优先使用 schema-driven form
- 详情与编辑尽量共用同一块右侧区域，减少视觉跳转

视觉实现建议：

- 页面层级靠留白、边框和背景层次区分，不靠大量颜色
- 强调色只用于主按钮、激活态、在线状态和事件标签
- 表单页保持固定宽度，避免全屏拉满导致信息密度失控
- Apple-inspired 细节应优先落在侧边栏、抽屉、浮层和状态卡片，不要整页玻璃化
- 内容主区域以实心面板为主，保持阅读稳定性

状态实现建议：

- 每个页面都要有 `loading`、`empty`、`error` 三种状态
- `Chat` 还需要额外处理 `connecting`、`streaming`、`disconnected` 状态
- 配置更新成功后使用轻量 toast，而不是阻塞式弹窗

Token 落地建议：

- 优先将颜色、圆角、阴影、动画定义为 CSS Variables
- 如果使用 Tailwind，可将 token 映射到 `theme.extend.colors`、`borderRadius`、`boxShadow`、`transitionTimingFunction`
- 模糊与玻璃层建议封装为少量可复用 utility class，而不是每个组件自由发挥

Apple-inspired 落地建议：

- 圆角要统一，不要不同组件各用一套半径
- 动画要短、轻、准，避免“为了高级感而到处动”
- 阴影用于分层，不用于装饰
- 磨砂用于局部面板，不用于正文阅读区

前端 AI 输出目标：

- 最终产物应更像控制台，而不是传统管理后台
- 页面结构要稳定、可扩展，能在后续接入 `Skills` 和 `MCP` 时保持一致信息架构

## 10. 后续扩展预留

当前 PRD 不覆盖但后续会加入：

- `Skills` 管理
  - 公共 skill
  - 每个 agent 的私有 skill
- `MCP` 管理
  - 全局共享的 server 配置
  - 已加载工具状态

当前页面结构与接口风格已为这两块预留扩展空间。
