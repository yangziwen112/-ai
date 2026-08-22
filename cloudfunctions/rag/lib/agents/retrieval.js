const { RunnableLambda } = require('@langchain/core/runnables')

function toLinks(evidence) {
  return evidence.map(item => ({
    type: 'content', id: item.id, title: item.title, summary: item.summary,
    sourceName: item.sourceName, sourceUrl: item.sourceUrl
  }))
}

function createRetrievalAgent(repository) {
  return RunnableLambda.from(async state => {
    let evidence = []
    if (state.intent.route === 'upcoming') evidence = await repository.getUpcoming(state.intent)
    else if (state.intent.route === 'campus_info') evidence = await repository.searchContents(state.query, state.intent)
    return {
      evidence,
      links: toLinks(evidence),
      stage: 'A',
      trace: [...state.trace, { stage: 'A', agent: 'retrieval', evidenceCount: evidence.length }]
    }
  })
}

module.exports = { createRetrievalAgent }
