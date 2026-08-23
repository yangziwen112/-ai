const { RunnableLambda } = require('@langchain/core/runnables')
const { invoke } = require('../services/llm')
const { PLATFORM_CONTEXT, STYLE_RULES, PRIVACY_RULES } = require('../prompts')
const { formatHistory } = require('../context')

function formatEvidence(items) {
  return items.slice(0, 4).map((item, index) => [
    `[证据${index + 1}] ${cleanSourceText(item.title, 100)}`,
    `来源:${item.sourceName}`,
    `摘要:${cleanSourceText(item.summary || item.description, 180)}`,
    `发布时间:${formatDateTime(item.publishTime) || '未知'}`,
    `报名开始:${formatDateTime(item.registrationStartTime) || '未知'} 考试/活动开始:${formatDateTime(item.startTime) || '未知'} 截止:${formatDateTime(item.deadline) || '未知'}`,
    `地点:${cleanSourceText(item.location, 60) || '未知'}`
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
    if (item.tool === 'public_database') return `[公开数据库] ${(item.records || []).slice(0, 4).map(record => `${cleanSourceText(record.title, 80)}｜${cleanSourceText(record.summary, 120)}｜来源：${record.sourceName || '官方来源'}`).join('\n') || '未检索到结果'}`
    return ''
  }).filter(Boolean).join('\n\n')
}

function formatDateTime(timestamp) {
  const value = Number(timestamp || 0)
  if (!value || Number.isNaN(value)) return ''
  const parts = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(value)).reduce((map, part) => ({ ...map, [part.type]: part.value }), {})
  return `${parts.year}年${parts.month}月${parts.day}日 ${parts.hour}:${parts.minute}`
}

function cleanSourceText(value, limit = 90) {
  return String(value || '')
    .replace(/\s*\|[\s\S]*(?:中国教育考试网|首页|考试动态|项目政策|资料下载|常见问题|联系我们|在线客服)[\s\S]*/i, '')
    .replace(/\s*(?:\||-->|→)\s*(?:中国教育考试网|首页|考试动态|项目政策|资料下载|常见问题|联系我们|在线客服)[\s\S]*/i, '')
    .replace(/(?:首页|考试动态|项目政策|资料下载|常见问题|联系我们|在线客服)(?:\s+|$)/g, '')
    .replace(/\s+/g, ' ').trim().slice(0, limit)
}

function collectEvidence(state) {
  const items = (Array.isArray(state.evidence) ? state.evidence : []).concat((state.toolResults || []).filter(item => item.tool === 'public_database' && Array.isArray(item.records)).flatMap(item => item.records))
  const seen = new Set()
  return items.filter(item => {
    const key = String(item?.id || item?._id || item?.sourceUrl || item?.title || '').trim().toLowerCase()
    if (!key || seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function evidenceScore(item, query, now) {
  const title = String(item.title || '')
  const text = `${title} ${item.summary || ''} ${item.description || ''}`
  let score = Number(item.evidenceScore || 0) * 2 + Number(item.freshnessScore || 0)
  const intents = [[/报名/, /报名|报考/, /成绩|合格证明|考场|准考证/], [/成绩|结果/, /成绩|结果|查询/, /报名|考场/], [/考场|地点|场地/, /考场|地点|场地|考点/, /成绩/], [/准考证/, /准考证/, /成绩/], [/考试时间|哪一场|下一场/, /考试|笔试|面试/, /成绩|合格证明/]]
  for (const [queryPattern, positive, negative] of intents) {
    if (!queryPattern.test(query)) continue
    if (positive.test(text)) score += 8
    if (negative.test(title)) score -= 7
  }
  const registrationStartTime = Number(item.registrationStartTime || 0)
  const deadline = Number(item.deadline || 0)
  const startTime = Number(item.startTime || 0)
  if (registrationStartTime > now || deadline > now || startTime > now) score += 5
  if ((registrationStartTime || deadline || startTime) && Math.max(registrationStartTime, deadline, startTime) <= now) score -= 8
  return score
}

function buildScheduleAnswer(state, records, now) {
  const query = String(state.query || '')
  const item = records.slice().sort((a, b) => evidenceScore(b, query, now) - evidenceScore(a, query, now))[0]
  if (!item) return '目前没有检索到下一次安排。新的报名或考试通知发布后才能确认具体时间。'
  const title = cleanSourceText(item.title, 72) || '相关通知'
  const registrationStartTime = Number(item.registrationStartTime || 0)
  const deadline = Number(item.deadline || 0)
  const startTime = Number(item.startTime || 0)
  const place = cleanSourceText(item.location, 50)
  if (/报名|报考/.test(query)) {
    if (registrationStartTime > now) return `下一项可确认的报名安排是【${title}】，${formatDateTime(registrationStartTime)}开始${deadline > registrationStartTime ? `，${formatDateTime(deadline)}截止` : ''}。`
    if (deadline > now) return `下一项可确认的报名节点是【${title}】，截止时间为 ${formatDateTime(deadline)}。请打开参考资料核对报名入口和材料。`
    if (deadline && deadline <= now && startTime > now) return `【${title}】本轮报名已经结束，考试时间为 ${formatDateTime(startTime)}。下一轮报名时间目前尚未公布。`
    if (/报名|报考/.test(title)) return `已找到【${title}】，但当前资料没有可核验的报名起止时间。请打开参考资料查看官方通知，暂不要按旧日期安排。`
    return '目前没有检索到下一轮可确认的报名时间。已有记录不是有效的未来报名节点，请等待新的官方通知。'
  }
  if (/考场|地点|场地|位置|考点/.test(query)) return place ? `【${title}】的地点是${place}。请同时核对考场、校区和入场要求。` : `已找到【${title}】，但当前资料没有可核验的具体地点。请以准考证或最新考场通知为准。`
  if (/成绩|结果|合格证明/.test(query)) return `与问题最相关的是【${title}】。请打开参考资料进入官方查询入口，并以本人查询结果为准。`
  if (startTime > now) return `下一项可确认的安排是【${title}】，时间为 ${formatDateTime(startTime)}${place ? `，地点为${place}` : ''}。`
  if (deadline > now) return `【${title}】当前仍有效，截止时间为 ${formatDateTime(deadline)}。请尽快核对要求并办理。`
  return `已找到【${title}】，但当前资料没有可核验的未来时间。请打开参考资料确认最新安排。`
}

// 大模型不可用时由本地规则直接回答问题，不把搜索列表或网页导航拼进正文。
function buildDegradedAnswer(state) {
  const route = state.intent?.route || ''
  const records = collectEvidence(state)
  const clock = (state.toolResults || []).find(item => item.tool === 'current_time')
  const now = Number(clock?.unixMs || Date.now())
  if (route === 'upcoming') return buildScheduleAnswer(state, records, now)
  if (route === 'public_data') {
    const database = (state.toolResults || []).find(item => item.tool === 'public_database')
    return database ? `目前有 ${Number(database.count || 0)} 条相关公开资讯。你可以补充考试、竞赛或学院名称，我再缩小范围。` : '目前无法确认资讯数量，请稍后重试。'
  }
  if (records.length) {
    const item = records.slice().sort((a, b) => evidenceScore(b, String(state.query || ''), now) - evidenceScore(a, String(state.query || ''), now))[0]
    const title = cleanSourceText(item.title, 72)
    const summary = cleanSourceText(item.summary || item.description, 80)
    const action = cleanSourceText(item.actionItem, 60)
    return `与你的问题最相关的是【${title}】。${summary ? `${summary}。` : ''}${action ? `建议：${action}。` : '请打开参考资料核对详情。'}`
  }
  if (state.imageUrls?.length) return '图片已收到，但我暂时无法确认其中的内容。请补充一句文字说明，我再帮你判断。'
  return '目前没有检索到足够可靠的信息。请补充更具体的考试、竞赛或学院名称。'
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
      { role: 'system', content: `${PLATFORM_CONTEXT}\n${STYLE_RULES}\n${PRIVACY_RULES}\n${noEvidenceRule}\n时间规则：先比较当前时间和资料节点；用户问报名时优先回答未来报名节点，已过期报名不得作为当前答案，考试日期也不能冒充报名日期；没有未来报名时间就明确说尚未公布。任务规则：必须直接回答用户的问题，参考资料只负责佐证，禁止用标题清单代替答案。回答要求：先给结论，再给最多 3 条关键点；默认不超过 140 个中文字符，只有用户明确要求详细说明时才展开；只输出时间、地点、对象和下一步；不要提及内部实现；最多引用一个最相关标题。` },
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

module.exports = { answerAgent, buildDegradedAnswer, buildScheduleAnswer, cleanSourceText }
