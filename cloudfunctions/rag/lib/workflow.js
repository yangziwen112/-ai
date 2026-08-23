const crypto = require('crypto')
const { StateGraph, START, END } = require('@langchain/langgraph')
const { RunnableLambda } = require('@langchain/core/runnables')
const { WorkflowState } = require('./state')
const { situationAgent } = require('./agents/situation')
const { intentAgent } = require('./agents/intent')
const { createRetrievalAgent } = require('./agents/retrieval')
const { answerAgent } = require('./agents/answer')
const { reviewerAgent } = require('./agents/reviewer')
const { createRepository } = require('./services/repository')
const { runTools } = require('./tools')

const workflowCache = new WeakMap()

function normalizeLinks(links, limit = 3) {
  const seen = new Set()
  const output = []
  for (const item of Array.isArray(links) ? links : []) {
    if (!item || typeof item !== 'object') continue
    const type = item.type === 'web' ? 'web' : 'content'
    const title = String(item.title || '').replace(/\s+/g, ' ').trim().slice(0, 100)
    if (!title) continue
    const id = type === 'content' ? String(item.id || '').trim() : ''
    const url = type === 'web' && /^https:\/\//i.test(String(item.url || '')) ? String(item.url).trim() : ''
    const titleKey = title.toLowerCase().replace(/[\s【】《》（）()、，。:：·\-]/g, '')
    const key = id || url || titleKey
    if (!key || seen.has(key)) continue
    seen.add(key)
    output.push({ type, id, url, title, summary: String(item.summary || item.snippet || '').replace(/\s+/g, ' ').trim().slice(0, 160), sourceName: String(item.sourceName || '').trim().slice(0, 60), sourceUrl: type === 'content' && /^https:\/\//i.test(String(item.sourceUrl || '')) ? String(item.sourceUrl).trim() : '' })
    if (output.length >= limit) break
  }
  return output
}

function createWorkflow(db) {
  const retrievalAgent = createRetrievalAgent(createRepository(db))
  const toolAgent = RunnableLambda.from(async state => {
    const intent = state.intent || {}
    const toolResults = await runTools({ db, query: state.query, intent })
    const toolEvidence = toolResults
      .filter(item => item.tool === 'public_database')
      .flatMap(item => item.records || [])
      .map(item => ({
        id: item.id,
        title: item.title,
        summary: item.summary,
        description: item.summary,
        category: item.category,
        sourceName: item.sourceName,
        sourceUrl: item.sourceUrl,
        publishTime: item.publishTime,
        startTime: item.startTime,
        deadline: item.deadline,
        location: item.location,
        isOfficial: true
      }))
    const uniqueEvidence = []
    const evidenceKeys = new Set()
    for (const item of toolEvidence) {
      const key = String(item.id || item.sourceUrl || item.title || '').trim().toLowerCase()
      if (!key || evidenceKeys.has(key)) continue
      evidenceKeys.add(key)
      uniqueEvidence.push(item)
    }
    const webLinks = toolResults
      .filter(item => item.tool === 'web_search')
      .flatMap(item => item.results || [])
      .filter(item => item.url)
      .slice(0, 3)
      .map(item => ({ type: 'web', title: item.title, summary: item.snippet || '', url: item.url }))
    const contentLinks = uniqueEvidence.slice(0, 3).map(item => ({ type: 'content', id: item.id, title: item.title, summary: item.summary, sourceName: item.sourceName, sourceUrl: item.sourceUrl }))
    return {
      toolResults,
      evidence: uniqueEvidence.length ? uniqueEvidence.slice(0, 4) : (state.evidence || []),
      links: normalizeLinks(contentLinks.concat(webLinks)),
      tools: intent.tools || [],
      trace: [...state.trace, { stage: 'A', agent: 'tool_orchestrator', tools: intent.tools || [], resultCount: toolResults.length }]
    }
  })
  const prepareRetry = RunnableLambda.from(async state => ({
    retryCount: (state.retryCount || 0) + 1,
    trace: [...state.trace, { stage: 'R', agent: 'reflection', action: 'revise_once' }]
  }))
  const fallbackAgent = RunnableLambda.from(async state => ({
    answer: state.evidence?.length
      ? '已找到相关信息，但目前无法确认完整结论。涉及时间和政策，请按需查看参考资料并以原文为准。'
      : '暂时没有检索到足够可靠的信息。我不会猜测具体日期或政策，你可以换个关键词，或稍后查看首页的最新校园资讯。',
    trace: [...state.trace, { stage: 'R', agent: 'fallback', status: 'safe_degrade' }]
  }))

  return new StateGraph(WorkflowState)
    .addNode('situation_agent', situationAgent)
    .addNode('intent_agent', intentAgent)
    .addNode('retrieval_agent', retrievalAgent)
    .addNode('tool_agent', toolAgent)
    .addNode('answer_agent', answerAgent)
    .addNode('review_agent', reviewerAgent)
    .addNode('prepare_retry', prepareRetry)
    .addNode('fallback', fallbackAgent)
    .addEdge(START, 'situation_agent')
    .addEdge('situation_agent', 'intent_agent')
    .addConditionalEdges('intent_agent', state => (state.intent.tools || []).length ? 'tools' : (['campus_info', 'upcoming'].includes(state.intent.route) ? 'retrieve' : 'answer'), {
      tools: 'tool_agent', retrieve: 'retrieval_agent', answer: 'answer_agent'
    })
    .addConditionalEdges('tool_agent', state => ['campus_info', 'upcoming'].includes(state.intent.route) ? 'retrieve' : 'answer', { retrieve: 'retrieval_agent', answer: 'answer_agent' })
    .addEdge('retrieval_agent', 'answer_agent')
    .addEdge('answer_agent', 'review_agent')
    .addConditionalEdges('review_agent', state => {
      if (state.review.approved) return 'done'
      return (state.retryCount || 0) < 1 ? 'retry' : 'fallback'
    }, { done: END, retry: 'prepare_retry', fallback: 'fallback' })
    .addEdge('prepare_retry', 'answer_agent')
    .addEdge('fallback', END)
    .compile()
}

function getWorkflow(db) {
  if (!db || (typeof db !== 'object' && typeof db !== 'function')) return createWorkflow(db)
  if (!workflowCache.has(db)) workflowCache.set(db, createWorkflow(db))
  return workflowCache.get(db)
}

async function runWorkflow(db, input) {
  const startedAt = Date.now()
  const traceId = input.traceId || crypto.randomBytes(8).toString('hex')
  const app = getWorkflow(db)
  const result = await app.invoke({ ...input, traceId, retryCount: 0, trace: [] })
  return {
    answer: result.answer || result.draft,
    links: normalizeLinks(result.links),
    meta: {
      workflow: 'STAR',
      intent: result.intent?.intent || '',
      route: result.intent?.route || '',
      intentConfidence: result.intent?.confidence || 0,
      grounded: (result.evidence || []).length > 0,
      multimodal: Array.isArray(input.imageUrls) && input.imageUrls.length > 0,
      imageCount: Array.isArray(input.imageUrls) ? input.imageUrls.length : 0,
      evidenceCount: (result.evidence || []).length,
      tools: result.tools || [],
      toolResultCount: (result.toolResults || []).length,
      reviewStatus: result.review?.approved ? 'approved' : 'fallback',
      reviewScore: result.review?.score || 0,
      retryCount: result.retryCount || 0,
      historyUsed: Array.isArray(result.compressedHistory) ? result.compressedHistory.length : 0,
      latencyMs: Date.now() - startedAt,
      traceId,
      stages: (result.trace || []).map(item => ({ ...item }))
    }
  }
}

module.exports = { createWorkflow, runWorkflow, normalizeLinks }
