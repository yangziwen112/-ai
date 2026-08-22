# AI 多智能体工作流

民大通 AI 助手使用 LangChain `RunnableLambda` 构建智能体节点，使用 LangGraph `StateGraph` 编排 STAR 四阶段工作流。

```text
S Situation 情境智能体
  输入清洗、风险识别、用户与历史上下文
        ↓
T Task 意图与路由智能体
  campus_info / upcoming / platform_help / social_chat / account_action / unsafe
        ↓
A Action 行动智能体
  公开数据库检索 → 证据标准化 → RAG 回答生成
        ↓
R Result 审核与反思智能体
  事实依据、时间、来源、安全和表达审核
  不通过最多修订一次，仍不通过则安全降级
```

工作流只允许读取 `contents` 中 `status=published` 的公开资讯，不向模型开放用户、密码、身份证等集合。

API 在调用前统一完成游客额度预占、用户消息保存和最近历史读取；工作流完成后统一保存回复、链接和审计元数据，避免客户端双写与游客次数并发绕过。

## 云函数配置

- `rag` 与 `api` 超时均为 60 秒。
- `rag` 依赖兼容 Node.js 18 及以上，部署时优先选择 Node.js 18 或 20。
- 微信开发者工具的旧版本地调试器缺少 Web Streams API，入口会先加载 `runtime-polyfills.js`，为 LangChain 补充 `ReadableStream`、`WritableStream` 和 `TransformStream`。
- 环境变量 `DEEPSEEK_API_KEY` 必填。
- 图片问答会将云存储图片转换为临时 HTTPS 地址，并以 OpenAI 兼容的视觉消息格式传入回答智能体；需配置支持图片输入的 `DEEPSEEK_VISION_MODEL`。
- `api` 和 `rag` 必须配置相同的高强度环境变量 `RAG_INTERNAL_TOKEN`，用于阻止客户端绕过 API 直接调用 RAG。
- `api` 和 `crawler` 必须配置相同的高强度环境变量 `CRAWLER_INTERNAL_TOKEN`，用于阻止客户端绕过管理员权限直接触发采集；云端定时触发器不受影响。
- 可选：`DEEPSEEK_MODEL`、`DEEPSEEK_API_HOST`。
- 可选：`DEEPSEEK_TIMEOUT`，默认 20000 毫秒，最高 30000 毫秒。

为避免微信云函数 60 秒超时，意图路由和基础回复审核使用本地 LangChain 智能体节点完成，主要回答生成调用一次模型；只有审核发现明确问题时才会进入一次反思修订。

## 返回元数据

回复保持原接口兼容，并增加：

```js
meta: {
  workflow: 'STAR',
  intent,
  route,
  grounded,
  evidenceCount,
  reviewStatus,
  reviewScore,
  retryCount,
  traceId,
  stages
}
```

`stages` 只记录节点、路由和审核结果，不保存模型隐藏思维链。
