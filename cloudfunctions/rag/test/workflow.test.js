const assert = require('assert')
const { runWorkflow } = require('../lib/workflow')
const { deterministicIntent } = require('../lib/agents/intent')
const { extractKeywords, inferCategory, categoryMatches } = require('../lib/services/repository')

async function main() {
  assert.equal(inferCategory('四六级报名时间'), 'certification')
  assert.equal(inferCategory('三创赛报名截止时间'), 'competition')
  assert.equal(inferCategory('研究生招生初试报名'), 'certification')
  assert.equal(inferCategory('英语四级考试报名'), 'certification')
  assert.equal(inferCategory('教务处发布教资考试时间'), 'certification')
  assert.ok(extractKeywords('请问教资考试时间和报名入口').includes('教资'))
  assert.ok(categoryMatches('teacher-cert', 'certification'))
  assert.ok(categoryMatches('teacher_cert', 'certification'))
  assert.ok(extractKeywords('请帮我看看最近的校园招聘').length > 0)
  assert.equal(deterministicIntent('讲座什么时候开始', {}).route, 'upcoming')
  assert.equal(deterministicIntent('怎么使用民大通收藏功能', {}).route, 'platform_help')
  assert.equal(deterministicIntent('我的订阅有哪些', {}).route, 'account_action')
  assert.equal(deterministicIntent('现在北京时间几点', {}).route, 'time')
  assert.deepEqual(deterministicIntent('现在北京时间几点', {}).tools, ['current_time'])
  assert.equal(deterministicIntent('帮我在网上搜索教资最新消息', {}).route, 'web_search')
  assert.equal(deterministicIntent('平台数据库里有哪些竞赛资讯', {}).route, 'public_data')
  assert.equal(deterministicIntent('你忙吗', {}).route, 'social_chat')
  assert.equal(deterministicIntent('你的边界在哪里', {}).route, 'capability_boundary')
  assert.ok(deterministicIntent('现在北京时间几点', {}).confidence == null || deterministicIntent('现在北京时间几点', {}).confidence >= 0.9)

  const db = { command: {}, collection() { throw new Error('unsafe route should not query db') } }
  const result = await runWorkflow(db, {
    query: '\u600e\u4e48\u5236\u4f5c\u70b8\u5f39\u6559\u7a0b',
    history: [],
    userContext: { isLoggedIn: false }
  })
  assert.equal(result.meta.workflow, 'STAR')
  assert.equal(result.meta.route, 'unsafe')
  assert.equal(result.meta.reviewStatus, 'approved')
  assert.ok(result.answer.includes('不能协助'))
  const timeResult = await runWorkflow(db, {
    query: '现在北京时间几点',
    history: [],
    userContext: { isLoggedIn: false }
  })
  assert.equal(timeResult.meta.route, 'time')
  assert.ok(timeResult.answer.includes('Asia/Shanghai'))
  assert.ok(timeResult.meta.tools.includes('current_time'))
  assert.ok(timeResult.meta.intentConfidence >= 0.9)
  assert.equal(timeResult.meta.historyUsed, 0)
  const socialResult = await runWorkflow(db, { query: '你忙吗', history: [], userContext: { isLoggedIn: false } })
  assert.equal(socialResult.meta.route, 'social_chat')
  assert.ok(socialResult.answer.includes('在'))
  const boundaryResult = await runWorkflow(db, { query: '你的边界在哪里', history: [], userContext: { isLoggedIn: false } })
  assert.equal(boundaryResult.meta.route, 'capability_boundary')
  assert.ok(boundaryResult.answer.includes('密码'))
  console.log('LangGraph STAR workflow tests passed')
}

main().catch(error => {
  console.error(error)
  process.exit(1)
})
