---
name: campus-aggregator-workbench
description: "维护校园聚合信息小程序及其 AI、采集、内容审核和微信视频号处理能力；当需要优化校园资讯、校园墙、二手书、智能体、时间查询、受控数据库、真实爬虫或发布文档时使用。"
---

# 校园聚合平台工作台

这个 Skill 面向一个个人维护的校园聚合信息平台，覆盖官方资讯、校园动态、二手物品、AI 助手、管理员采集器和内容发布。先阅读相关参考文件，再修改代码；不要把示例数据当成线上真实数据。

## 工作路由

- 页面布局、导航、帖子详情、登录引导：读取 `references/miniapp-ui.md`。
- LangGraph/LangChain 多智能体、RAG、审核与反思：读取 `references/ai-agent.md`。
- 官方站点采集、分类、去重、摘要和失败回退：读取 `references/crawler.md`。
- 微信视频号详情、下载、解密和本地转写：读取 `references/wechat-video.md`，并优先复用已安装的 `wechat-latest-video-transcriber` Skill。
- GitHub 发布和文档组织：读取 `references/github-release.md`。
- 高级 RAG、评测、上下文压缩和可观测性：读取 `docs/advanced-practice-research.md`。
- 教资、考研、四六级：优先读取 `../campus-teacher-cert/SKILL.md`。
- 三创赛、创新创业、挑战杯：优先读取 `../campus-competition-tracker/SKILL.md`。
- 来源核验与数据质量：优先读取 `../campus-source-governance/SKILL.md`。

## 不可违反的约束

1. 真实优先：只展示可验证的官方来源或用户提交内容。禁止 `example.com`、`example.edu`、`picsum.photos`、localhost、虚构年份和占位链接进入生产展示。
2. 密钥隔离：TikHub、DeepSeek、搜索服务、RAG 内部 Token、CDN token、`decode_key` 只从环境变量或云函数配置读取，绝不写入小程序、日志、截图或 Git。
3. 数据最小化：小程序通过 `api` 云函数访问数据，不能把数据库凭据下发客户端；AI 工具只返回与问题相关的公开投影字段，管理员字段和个人隐私必须过滤。
4. 时间可信：涉及“现在、今天、截止时间”的回答必须调用服务器时间工具，并明确时区；不能依赖客户端缓存时间。
5. 会话隔离：聊天记录使用稳定的 `conversationId`。新建对话只创建新会话，不删除旧消息；游客最多三次 AI 对话，登录后再按账户策略授权。
6. 二手发布：二手书/闲置必须包含数量、新旧程度、位置、交易方式、原因和至少一张实物图；发布页和详情页要显示这些字段。
7. 采集器安全：采集失败时返回错误状态，不用假数据填充；内部调用要校验 `CRAWLER_INTERNAL_TOKEN`，并在管理页面显示可理解的失败原因。

## 修改后的验证

完成修改后至少运行：

```powershell
node --check pages/chat/index.js
node --check pages/campus-wall/publish.js
node --check pages/campus-wall/detail.js
node --check cloudfunctions/api/index.js
node --check cloudfunctions/rag/lib/tools/index.js
npm --prefix cloudfunctions/rag test
```

同时检查 WXML 标签闭合、`wx:if/wx:else` 相邻关系、页面按钮是否遮挡，并搜索假数据特征：

```powershell
rg -n "example\\.(edu|com)|picsum\\.photos|2024年春季校园招聘会|ACM程序设计竞赛|人工智能前沿技术讲座|校园足球联赛" --glob "!**/node_modules/**" .
```

## 交付方式

优先提交可审查的代码、Skill 和 Markdown 文档。没有明确的 GitHub 远程地址和凭据时，只整理本地 GitHub-ready 工作区，不执行推送；任何公开文档不得包含“AI 辅助生成”等署名。
