---
name: campus-teacher-cert
description: "从官方考试来源采集并标准化教资、考研、四六级等大学生考试资讯；需要报名、准考证、考场、成绩和截止时间时使用。"
---

# 教资与考证资讯 Skill

用于处理与大学生直接相关的考试考证资讯。默认覆盖教师资格考试、研究生招生、英语四六级，并允许在来源目录中增加其他官方考试。

## 工作规则

1. 只接受官方考试网站或学校教务处明确发布的来源。
2. 提取考试类型、适用人群、报名开始/截止、缴费、准考证、考试时间、考点、成绩和原文链接。
3. `object_id`、时间戳和日期字段按字符串或毫秒时间保存，禁止把大整数转换成不安全的 Number。
4. 过期通知不删除，标记为过期；仍在报名或考试周期内的通知优先展示。
5. AI 回答必须给出来源和时区；无法确认时提示用户打开原文核验。

## 项目落地

- 采集器分组：`teacher-cert`、`graduate-exam`、`exam`。
- 分类统一写入 `certification`，用 `tags` 区分 `教资`、`考研`、`四六级`。
- 标准化字段使用 `deadline`、`startTime`、`location`、`audience`、`actionItem`、`evidenceScore`。
- 游客可以浏览公开考试资讯；个人报名信息、准考证和账户数据永不进入公开 RAG 投影。

## 参考

来源目录和解析规则见 `cloudfunctions/crawler/lib/source-catalog.js` 与 `cloudfunctions/crawler/index.js`。不要在此 Skill 或仓库中写入第三方密钥。
