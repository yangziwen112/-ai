# 校园资讯采集与标准化

当前采集器位于 `cloudfunctions/crawler`，服务于整个校园信息聚合业务。它把校内部门网站和校外权威公共信息统一标准化后写入 `contents` 集合，不会自动发布到校园墙，也不会让大模型凭知识生成日期。

## 默认来源

- 中央民族大学官网
- 中央民族大学教务处
- 中央民族大学新闻网
- 中央民族大学就业信息网
- 中国教育考试网·中小学教师资格考试
- 中央民族大学信息工程学院

教资来源只属于“考试考证”业务中的一个来源，不是平台主业务。可在云函数环境变量 `CRAWLER_SOURCES_JSON` 中继续扩展学院、研究生院、团委、图书馆、后勤及其他权威考试平台，无需修改核心流程。

默认来源按业务覆盖：学校官网和新闻网覆盖综合通知与校园活动，教务处覆盖教学、竞赛及校内考试，就业信息网覆盖招聘实习，教育考试网覆盖教资等校外考试信息。

管理中心将采集拆分为独立任务：教资、民大主页、竞赛、信息工程学院。竞赛、民大主页和学院任务默认只检查近 7 天内容；教资任务检查近 30 天，同时保留尚未截止或尚未开始的有效安排。

采集结果会进行学生相关性筛选。党委会议、领导调研、工作部署等宣传新闻默认不进入“校园动态”；报名、竞赛、青苗计划、考试考场、选课、奖助学金、就业和学生活动等内容优先保留。

## 标准内容结构

```js
{
  externalId: '来源ID + URL哈希',
  title: '标题',
  summary: '摘要',
  description: '正文',
  sourceId: 'sources 文档ID',
  sourceName: '来源名称',
  sourceUrl: '原文链接',
  linkUrl: '原文链接',
  category: 'notice | competition | academic | recruit | certification | sports | volunteer | activity',
  campus: 'all | haidian | fengtai',
  tags: [],
  publishTime: 0,
  sourcePublishedAt: 0,
  status: 'published',
  isOfficial: true,
  aiProcessed: false,
  ingestType: 'crawler',
  contentHash: 'sha256'
}
```

## 处理流程

1. 按来源配置获取列表页。
2. 提取符合规则的文章链接。
3. 抓取文章正文、发布时间和元信息。
4. 按关键词映射业务分类与校区，并过滤低学生相关内容。
5. 将摘要固定为“对象｜时间/截止｜地点｜需要做”的结构，不再截取正文开头。
6. 以 `externalId` 去重，以 `contentHash` 判断是否需要更新。
7. 写入官方资讯库，详情页只展示整理后的要点并保留原文链接。
8. 记录 `crawl_logs`，供管理中心展示运行状态。

## 管理方式

管理员登录后进入「我的 → 平台管理中心」，可以手动运行采集器。云函数同时配置每日定时任务。

部署时需要在 `api` 和 `crawler` 云函数中配置相同的高强度 `CRAWLER_INTERNAL_TOKEN`。小程序不能直接调用采集器，只有经过管理员权限校验的 `api` 云函数和云端定时任务可以触发采集。

第三方 AI 密钥不得写入代码或配置文件。如需启用 AI 助手，请在微信云开发控制台为 `rag` 云函数设置 `DEEPSEEK_API_KEY`。
