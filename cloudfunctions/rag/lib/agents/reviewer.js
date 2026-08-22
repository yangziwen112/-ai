const { RunnableLambda } = require('@langchain/core/runnables')
const { sanitizeAnswer } = require('../safety')

function deterministicReview(state) {
  let answer = sanitizeAnswer(state.draft)
  if (!/详细|展开|分析|方案|步骤|报告/.test(String(state.query || '')) && answer.length > 320) {
    answer = `${answer.slice(0, 317).replace(/[，、；：\s]+$/, '')}…`
  }
  const evidenceRequired = ['campus_info', 'upcoming'].includes(state.intent.route)
  const hasEvidence = (state.evidence || []).length > 0
  const hasTrustedTool = (state.toolResults || []).some(item =>
    item.tool === 'current_time' ||
    (item.tool === 'public_database' && item.available !== false) ||
    (item.tool === 'web_search' && item.available !== false && (item.results || []).length > 0)
  )
  const unsupportedPrecision = /\b20\d{2}[-年]\d{1,2}[-月]\d{1,2}|\d{1,2}月\d{1,2}日/.test(answer) && !hasEvidence && !hasTrustedTool
  return {
    approved: !!answer && !unsupportedPrecision,
    score: answer ? (unsupportedPrecision ? 35 : evidenceRequired && !hasEvidence ? 72 : 88) : 0,
    feedback: unsupportedPrecision ? '没有证据却给出了精确日期，请删除无依据的时间。' : '',
    answer
  }
}

const reviewerAgent = RunnableLambda.from(async state => {
  const review = deterministicReview(state)
  if (['unsafe', 'account_action'].includes(state.intent.route)) Object.assign(review, { approved: true, score: 100 })
  return {
    review,
    answer: review.answer,
    stage: 'R',
    trace: [...state.trace, { stage: 'R', agent: 'reviewer', approved: review.approved, score: review.score, mode: 'local' }]
  }
})

module.exports = { reviewerAgent, deterministicReview }
