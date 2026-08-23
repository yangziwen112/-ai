const assert = require('assert')
const { evaluateAnswer } = require('../lib/quality')

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
console.log('Answer quality tests passed')
