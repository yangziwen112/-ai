const assert = require('assert')
const { evaluateAnswer } = require('../lib/quality')
const { buildDegradedAnswer, cleanSourceText } = require('../lib/agents/answer')

function state(overrides = {}) {
  return {
    query: '报名什么时候截止，下一步怎么做',
    intent: { route: 'upcoming' },
    evidence: [{ title: '真实通知', sourceName: '官方来源' }],
    toolResults: [],
    ...overrides
  }
}

assert.equal(evaluateAnswer(state(), '报名截止时间是 6 月 30 日。建议打开原文确认材料清单。').approved, true)
assert.equal(evaluateAnswer(state({ evidence: [] }), '我猜报名截止是 6 月 30 日。').approved, false)
assert.equal(evaluateAnswer(state({ evidence: [] }), '目前没有检索到可靠的截止时间，请打开官方原文确认。').approved, true)
assert.equal(evaluateAnswer(state({ intent: { route: 'social_chat' }, evidence: [] }), '你好，需要查什么校园信息？').approved, true)
assert.equal(evaluateAnswer(state(), '模型暂时繁忙，请查看数据库原文。').approved, false)
assert.equal(evaluateAnswer(state(), '相关信息：\n1. 报名工作的通知 --> 中国教育考试网 --> 首页 考试动态 常见问题').approved, false)
const now = new Date('2026-08-23T00:00:00+08:00').getTime()
const expiredRegistration = buildDegradedAnswer(state({
  query: '教资什么时候报名',
  evidence: [{ id: 'teacher-cert-2026-h2', title: '2026年下半年中小学教师资格考试（笔试）报名工作的通知', deadline: new Date('2026-07-07T12:00:00+08:00').getTime(), startTime: new Date('2026-09-12T09:00:00+08:00').getTime() }],
  toolResults: [{ tool: 'current_time', unixMs: now }]
}))
assert.ok(expiredRegistration.includes('本轮报名已经结束'))
assert.ok(expiredRegistration.includes('下一轮报名时间目前尚未公布'))
assert.ok(!expiredRegistration.includes('相关信息：'))
const futureRegistration = buildDegradedAnswer(state({
  query: '教资什么时候报名',
  evidence: [{ id: 'next', title: '下一批教师资格考试报名通知', registrationStartTime: new Date('2026-10-10T08:00:00+08:00').getTime(), deadline: new Date('2026-10-13T17:00:00+08:00').getTime() }],
  toolResults: [{ tool: 'current_time', unixMs: now }]
}))
assert.ok(futureRegistration.includes('2026年10月10日'))
assert.ok(futureRegistration.includes('2026年10月13日'))
assert.equal(cleanSourceText('报名通知 | --> 中国教育考试网 --> 首页 考试动态 常见问题'), '报名通知')
console.log('Answer quality tests passed')
