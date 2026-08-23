const { RunnableLambda } = require('@langchain/core/runnables')

function toLinks(evidence) {
  return evidence.slice(0, 3).map(item => ({
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
    .slice(0, 4)
}

function createRetrievalAgent(repository) {
  return RunnableLambda.from(async state => {
    let evidence = []
    let retrievalError = ''
    try {
      if (state.intent.route === 'upcoming') evidence = await repository.getUpcoming(state.intent, state.query)
      else if (state.intent.route === 'campus_info') evidence = await repository.searchContents(state.query, state.intent)
    } catch (error) {
      retrievalError = String(error?.message || 'RETRIEVAL_FAILED').slice(0, 120)
      console.warn('RAG_RETRIEVAL_DEGRADED', { route: state.intent.route, error: retrievalError })
    }
    evidence = dedupeEvidence(evidence.length ? evidence : state.evidence)
    return {
      evidence,
      links: toLinks(evidence),
      stage: 'A',
      trace: [...state.trace, { stage: 'A', agent: 'retrieval', evidenceCount: evidence.length, degraded: !!retrievalError, error: retrievalError || undefined }]
    }
  })
}

module.exports = { createRetrievalAgent, dedupeEvidence }
