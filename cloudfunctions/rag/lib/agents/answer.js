const { RunnableLambda } = require('@langchain/core/runnables')
const { invoke } = require('../services/llm')
const { PLATFORM_CONTEXT, STYLE_RULES, PRIVACY_RULES } = require('../prompts')

function formatEvidence(items) {
  return items.map((item, index) => [
    `[证据${index + 1}] ${item.title}`,
    `来源:${item.sourceName}`,
    `摘要:${item.summary || item.description}`,
    `发布时间:${item.publishTime || '未知'}`,
    `开始:${item.startTime || '未知'} 截止:${item.deadline || '未知'}`,
    `地点:${item.location || '未知'}`
  ].join('\n')).join('\n\n')
}

function formatToolResults(results) {
  return (results || []).map(item => {
    if (item.tool === 'current_time') return `[时间工具] ${item.text}（${item.timeZone}，${item.timestamp}）`
    if (item.tool === 'web_search') return `[联网检索] ${item.results.map(result => `${result.title}\n${result.snippet || ''}\n${result.url || ''}`).join('\n\n') || '未检索到结果'}`
    if (item.tool === 'public_database') return `[公开数据库] 共 ${item.count || 0} 条；分类统计：${Object.entries(item.facets?.byCategory || {}).map(([key, value]) => `${key} ${value} 条`).join('、') || '无'}；有未来时间节点 ${item.facets?.upcoming || 0} 条\n${(item.records || []).map(record => `${record.title}｜${record.summary}｜来源：${record.sourceName}｜剩余${record.remainingDays == null ? '未知' : `${record.remainingDays}天`}`).join('\n') || '未检索到结果'}`
    return ''
  }).filter(Boolean).join('\n\n')
}

const answerAgent = RunnableLambda.from(async state => {
  const route = state.intent.route
  if (route === 'unsafe') return {
    draft: '抱歉，这个请求涉及安全或敏感信息，我不能协助。你可以问我公开的校园资讯或平台使用问题。',
    stage: 'A', trace: [...state.trace, { stage: 'A', agent: 'safe_response' }]
  }
  if (route === 'account_action') {
    const text = state.userContext?.isLoggedIn
      ? '我可以告诉你操作路径，但不会代替你执行涉及账号或隐私的操作。请前往“我的”页面使用对应功能。'
      : '这个功能需要登录后使用。请先前往“我的”页面登录，我会继续帮你找到对应入口。'
    return { draft: text, stage: 'A', trace: [...state.trace, { stage: 'A', agent: 'account_guard' }] }
  }
  if (route === 'time') {
    const clock = (state.toolResults || []).find(item => item.tool === 'current_time')
    const text = clock
      ? `现在是 ${clock.text}（${clock.timeZone}）。`
      : '暂时无法读取当前时间，请稍后再试。'
    return { draft: text, stage: 'A', trace: [...state.trace, { stage: 'A', agent: 'time_tool_response' }] }
  }
  if (route === 'social_chat') {
    return { draft: state.query.includes('你是谁') ? '我是民大通校园信息助手，可以帮你查公开通知、竞赛、讲座、就业和考试信息。' : '你好，需要查什么校园信息？', stage: 'A', trace: [...state.trace, { stage: 'A', agent: 'concise_social_response' }] }
  }

  const evidenceText = formatEvidence(state.evidence || [])
  const toolText = formatToolResults(state.toolResults || [])
  const noEvidenceRule = (route === 'campus_info' || route === 'upcoming') && !state.evidence?.length
    ? '目前没有检索到能够支撑结论的平台资讯。必须坦诚说明未找到，不得猜测具体时间或政策。'
    : ''
  const priorDraft = state.review?.feedback && state.draft ? `上版回答:${state.draft}\n审核意见:${state.review.feedback}\n请修订。` : ''
  const userContent = state.imageUrls?.length
    ? [
        { type: 'text', text: `路由:${route}\n用户问题:${state.query}\n工具结果:\n${toolText || '无'}\n证据:\n${evidenceText || '无'}\n${priorDraft}\n请理解用户上传的图片内容，并结合问题回答。` },
        ...state.imageUrls.map(url => ({ type: 'image_url', image_url: { url } }))
      ]
    : `路由:${route}\n用户问题:${state.query}\n工具结果:\n${toolText || '无'}\n证据:\n${evidenceText || '无'}\n${priorDraft}`
  const result = await invoke([
    { role: 'system', content: `${PLATFORM_CONTEXT}\n${STYLE_RULES}\n${PRIVACY_RULES}\n${noEvidenceRule}\n回答要求：先给结论，再给最多 3 条关键点；默认不超过 180 个中文字符；不要复述问题、不要客套、不要使用夸张的 AI 口吻。只有用户明确要求详细说明时才展开。引用平台内容时使用【准确标题】。` },
    { role: 'user', content: userContent }
  ], { temperature: 0.25, maxTokens: 360, vision: !!state.imageUrls?.length })

  return {
    draft: result.content,
    model: result.model,
    usage: result.usage,
    stage: 'A',
    trace: [...state.trace, { stage: 'A', agent: state.retryCount ? 'answer_revision' : 'answer', model: result.model }]
  }
})

module.exports = { answerAgent }
