const { RunnableLambda } = require('@langchain/core/runnables')

function toLinks(evidence) {
  return evidence.map(item => ({
    type: 'content', id: item.id, title: item.title, summary: item.summary,
    sourceName: item.sourceName, sourceUrl: item.sourceUrl
  }))
}

function dedupeEvidence(items) {
  const seen = new Set()
  return (items || [])
    .filter(item => {
      const key = String(item.id || item.sourceUrl || item.title || '').trim().toLowerCase()
      if (!key || seen.has(key)) return false
      seen.add(key)
      return true
    })
    .sort((a, b) => (Number(b.evidenceScore || 0) - Number(a.evidenceScore || 0)) || (Number(b.freshnessScore || 0) - Number(a.freshnessScore || 0)) || (Number(b.publishTime || 0) - Number(a.publishTime || 0)))
    .slice(0, 8)
}

function createRetrievalAgent(repository) {
  return RunnableLambda.from(async state => {
    let evidence = []
    if (state.intent.route === 'upcoming') evidence = await repository.getUpcoming(state.intent, state.query)
    else if (state.intent.route === 'campus_info') evidence = await repository.searchContents(state.query, state.intent)
    evidence = dedupeEvidence(evidence)
    return {
      evidence,
      links: toLinks(evidence),
      stage: 'A',
      trace: [...state.trace, { stage: 'A', agent: 'retrieval', evidenceCount: evidence.length }]
    }
  })
}

module.exports = { createRetrievalAgent }
