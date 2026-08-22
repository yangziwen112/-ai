---
name: campus-competition-tracker
description: "追踪三创赛、创新创业大赛、挑战杯和校内竞赛的报名、赛道、校赛、作品提交与结果节点；需要真实竞赛资讯时使用。"
---

# 大学生竞赛追踪 Skill

用于把竞赛网页转换为学生可执行的事项，而不是简单转载新闻。

## 工作规则

- 识别竞赛名称、赛道、主办方、参赛对象、校赛/省赛/国赛层级、报名方式、作品要求、截止时间和结果发布时间。
- 三创赛重点提取校赛批次、团队成员要求、作品提交和学校组织方式。
- 创新创业大赛重点提取赛道、项目类型、报名批次和校内截止时间。
- 挑战杯重点提取作品类别、申报条件、校赛安排和评审阶段。
- 只把真实官方来源写入 `contents`；来源失败时记录失败，不生成虚假赛事。

## 项目落地

- 采集器分组：`competition`、`three-innovation`、`innovation-entrepreneurship`、`challenge-cup`。
- 统一分类为 `competition`，标签使用 `三创赛`、`创新创业`、`挑战杯`。
- 使用 `audience`、`actionItem`、`deadline`、`evidenceScore` 和 `freshnessScore` 支撑排序和 AI 回答。
- AI 回复优先告诉用户“是否还能报名、需要准备什么、校内截止时间是否可能早于全国截止时间”。
