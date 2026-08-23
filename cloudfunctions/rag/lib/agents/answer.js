const { RunnableLambda } = require('@langchain/core/runnables')
const { invoke } = require('../services/llm')
const { PLATFORM_CONTEXT, STYLE_RULES, PRIVACY_RULES } = require('../prompts')
const { formatHistory } = require('../context')

function formatEvidence(items) {
  return items.slice(0, 4).map((item, index) => [
    `[证据${index + 1}] ${item.title}`,
    `来源:${item.sourceName}`,
    `摘要:${String(item.summary || item.description || '').slice(0, 180)}`,
    `发布时间:${item.publishTime || '未知'}`,
    `开始:${item.startTime || '未知'} 截止:${item.deadline || '未知'}`,
    `地点:${item.location || '未知'}`
  ].join('\n')).join('\n\n')
}

function formatNow(toolResults) {
  const clock = (toolResults || []).find(item => item.tool === 'current_time')
  return clock ? `当前时间：${clock.text}` : ''
}

function formatToolResults(results) {
  return (results || []).map(item => {
    if (item.tool === 'current_time') return `[时间工具] ${item.text}（${item.timeZone}，${item.timestamp}）`
    if (item.tool === 'web_search') return `[联网检索] ${(Array.isArray(item.results) ? item.results : []).map(result => `${result.title}\n${result.snippet || ''}\n${result.url || ''}`).join('\n\n') || '未检索到结果'}`
    if (item.tool === 'public_database') return `[公开数据库] 共 ${item.count || 0} 条；分类统计：${Object.entries(item.facets?.byCategory || {}).map(([key, value]) => `${key} ${value} 条`).join('、') || '无'}；有未来时间节点 ${item.facets?.upcoming || 0} 条\n${(item.records || []).map(record => `${record.title}｜${record.summary}｜来源：${record.sourceName}｜剩余${record.remainingDays == null ? '未知' : `${record.remainingDays}天`}`).join('\n') || '未检索到结果'}`
    return ''
  }).filter(Boolean).join('\n\n')
}

// 大模型不可用时仍返回可核验的数据库结果，避免一次网络/配额波动把整条工作流变成 500。
function buildDegradedAnswer(state, error) {
  const query = String(state.query || '')
  const asksTime = /时间|日期|几号|几月|截止|报名|考试|场地|地点|位置/.test(query)
  const evidence = Array.isArray(state.evidence) ? state.evidence.slice(0, 3) : []
  if (evidence.length) {
    const lines = evidence.map((item, index) => {
      const title = String(item.title || '未命名资讯').trim()
      const summary = String(item.summary || item.description || '').trim().replace(/\s+/g, ' ')
      const time = item.startTime || item.deadline || item.publishTime
      const place = String(item.location || '').trim()
      const detail = asksTime && time ? `时间：${time}` : (asksTime && place ? `地点：${place}` : summary.slice(0, 48))
      return `${index + 1}. ${title}${detail ? `｜${detail}` : ''}`
    })
    return `相关信息：\n${lines.join('\n')}\n详情请打开对应资讯。`
  }
  const toolRecords = (state.toolResults || [])
    .filter(item => item.tool === 'public_database' && Array.isArray(item.records))
    .flatMap(item => item.records)
    .slice(0, 3)
  if (toolRecords.length) {
    return `相关信息：\n${toolRecords.map((item, index) => `${index + 1}. ${item.title || '未命名资讯'}`).join('\n')}\n详情请打开对应资讯。`
  }
  if (state.imageUrls?.length) return '图片已收到，但我暂时无法确认其中的内容。请补充一句文字说明，我再帮你判断。'
  return '暂时没有找到足够可靠的信息。你可以换个关键词，或打开相关资讯查看详情。'
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
  if (route === 'capability_boundary') return {
    draft: '我主要帮你处理公开的校园信息：通知、考试、竞赛、就业、时间查询和平台使用。涉及密码、私信、身份证、管理员内部数据或替你执行账号操作时，我会拒绝或引导你到对应页面；重要日期和政策仍建议以官方原文为准。',
    stage: 'A', trace: [...state.trace, { stage: 'A', agent: 'boundary_response', mode: 'local' }]
  }
  if (route === 'time') {
    const clock = (state.toolResults || []).find(item => item.tool === 'current_time')
    const text = clock
      ? `现在是 ${clock.text}（${clock.timeZone}）。`
      : '暂时无法读取当前时间，请稍后再试。'
    return { draft: text, stage: 'A', trace: [...state.trace, { stage: 'A', agent: 'time_tool_response' }] }
  }
  if (route === 'social_chat') {
    let draft = '你好，我在。需要查哪类校园信息？'
    if (/你是谁/.test(state.query)) draft = '我是民大通校园信息助手，可以帮你查公开通知、竞赛、讲座、就业、考试和平台功能。'
    else if (/忙吗|在忙吗|方便吗|累不累/.test(state.query)) draft = '我在，可以直接问。通知、竞赛、考试时间或平台操作都可以。'
    else if (/谢谢|多谢|辛苦/.test(state.query)) draft = '不客气，有需要继续问我就好。'
    else if (/早上好|晚上好|晚安/.test(state.query)) draft = /晚安/.test(state.query) ? '晚安，祝你今晚休息好。' : '你好，今天想查点什么校园信息？'
    return { draft, stage: 'A', trace: [...state.trace, { stage: 'A', agent: 'concise_social_response', mode: 'local' }] }
  }

  const nowText = formatNow(state.toolResults)
  const evidenceText = formatEvidence(state.evidence || [])
  const toolText = formatToolResults(state.toolResults || [])
  const noEvidenceRule = (route === 'campus_info' || route === 'upcoming') && !state.evidence?.length
    ? '目前没有检索到能够支撑结论的平台资讯。必须坦诚说明未找到，不得猜测具体时间或政策。'
    : ''
  const priorDraft = state.review?.feedback && state.draft ? `上版回答:${state.draft}\n审核意见:${state.review.feedback}\n请修订。` : ''
  const historyText = formatHistory(state.compressedHistory || state.history)
  const userContent = state.imageUrls?.length
    ? [
        { type: 'text', text: `路由:${route}\n${nowText}\n用户问题:${state.query}\n最近对话:\n${historyText || '无'}\n工具结果:\n${toolText || '无'}\n证据:\n${evidenceText || '无'}\n${priorDraft}\n请理解用户上传的图片内容，并结合问题回答。` },
        ...state.imageUrls.map(url => ({ type: 'image_url', image_url: { url } }))
      ]
    : `路由:${route}\n${nowText}\n用户问题:${state.query}\n最近对话:\n${historyText || '无'}\n工具结果:\n${toolText || '无'}\n证据:\n${evidenceText || '无'}\n${priorDraft}`
  let result
  try {
    result = await invoke([
      { role: 'system', content: `${PLATFORM_CONTEXT}\n${STYLE_RULES}\n${PRIVACY_RULES}\n${noEvidenceRule}\n时间规则：先根据当前时间判断节点是否已过去；用户问“下一场”“最近一次”或“什么时候报名”时，只能回答当前时间之后最近的有效节点，已过期节点不能作为答案。若没有未来节点，明确说明暂未找到下一次安排。回答要求：先给结论，再给最多 3 条关键点；默认不超过 140 个中文字符，只有用户明确要求详细说明时才展开；只输出解决问题所需的时间、地点、对象和下一步，不要罗列多个来源的重复内容；不要提及模型、数据库、工具、检索过程、故障或系统状态；引用平台内容时只保留最相关的一个标题。` },
      { role: 'user', content: userContent }
    ], { temperature: 0.25, maxTokens: 260, vision: !!state.imageUrls?.length })
  } catch (error) {
    return {
      draft: buildDegradedAnswer(state, error),
      model: 'degraded-local',
      usage: {},
      stage: 'A',
      trace: [...state.trace, { stage: 'A', agent: 'answer_degraded', reason: String(error?.message || 'LLM_UNAVAILABLE').slice(0, 120) }]
    }
  }

  return {
    draft: result.content,
    model: result.model,
    usage: result.usage,
    stage: 'A',
    trace: [...state.trace, { stage: 'A', agent: state.retryCount ? 'answer_revision' : 'answer', model: result.model }]
  }
})

module.exports = { answerAgent }
