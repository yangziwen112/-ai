const { RunnableLambda } = require('@langchain/core/runnables')
const { evaluateAnswer } = require('../quality')

function deterministicReview(state) {
  const review = evaluateAnswer(state, state.draft)
  if (!/详细|展开|分析|方案|步骤|报告/.test(String(state.query || '')) && review.answer.length > 320) {
    review.answer = `${review.answer.slice(0, 317).replace(/[，、；：\s]+$/, '')}…`
    review.metrics.conciseScore = 100
  }
  return review
}

const reviewerAgent = RunnableLambda.from(async state => {
  const review = deterministicReview(state)
  if (['unsafe', 'account_action'].includes(state.intent.route)) Object.assign(review, { approved: true, score: 100 })
  return {
    review,
    answer: review.answer,
    stage: 'R',
    trace: [...state.trace, { stage: 'R', agent: 'reviewer', approved: review.approved, score: review.score, metrics: review.metrics, mode: 'local' }]
  }
})

module.exports = { reviewerAgent, deterministicReview }
