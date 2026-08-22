const { RunnableLambda } = require('@langchain/core/runnables')
const { normalizeQuery, inspectQuery } = require('../safety')

const situationAgent = RunnableLambda.from(async state => {
  const query = normalizeQuery(state.query)
  const safety = inspectQuery(query)
  return {
    query,
    safety,
    now: Date.now(),
    stage: 'S',
    trace: [...(state.trace || []), { stage: 'S', agent: 'situation', status: safety.blocked ? 'blocked' : 'ready' }]
  }
})

module.exports = { situationAgent }
