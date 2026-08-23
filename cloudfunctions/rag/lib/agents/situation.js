const { RunnableLambda } = require('@langchain/core/runnables')
const { normalizeQuery, inspectQuery } = require('../safety')
const { compressHistory } = require('../context')

const situationAgent = RunnableLambda.from(async state => {
  const query = normalizeQuery(state.query)
  const safety = inspectQuery(query)
  const compressedHistory = compressHistory(state.history)
  return {
    query,
    safety,
    compressedHistory,
    now: Date.now(),
    stage: 'S',
    trace: [...(state.trace || []), { stage: 'S', agent: 'situation', status: safety.blocked ? 'blocked' : 'ready', historyIn: Array.isArray(state.history) ? state.history.length : 0, historyUsed: compressedHistory.length }]
  }
})

module.exports = { situationAgent }
