const { RunnableLambda } = require('@langchain/core/runnables')
const { inferCategory, extractKeywords } = require('../services/repository')

function deterministicIntent(query, safety) {
  if (safety?.blocked) return { route: 'unsafe', intent: 'unsafe', keywords: [], category: '', timeSensitive: false, requiresLogin: false }
  const text = String(query || '')
  const keywords = extractKeywords(text)
  const category = inferCategory(text)
  if (/(你的?边界|能做什么|你会什么|你能帮我做什么|你可以帮我做什么|你能干什么|你可以干什么|哪些事情不能|不能做什么|能力范围|怎么使用你|如何和你聊天)/i.test(text)) return { route: 'capability_boundary', intent: 'capability_boundary', keywords: [], category: '', timeSensitive: false, requiresLogin: false, tools: [] }
  if (/(几点|現在.{0,4}(几点|时间)|现在.{0,4}(几点|时间|日期)|当前.{0,4}(时间|日期)|北京时间|当地时间|星期几|几号|今天.{0,4}(日期|几月几日|星期)|^时间$)/i.test(text)) return { route: 'time', intent: 'current_time', keywords, category: '', timeSensitive: true, requiresLogin: false, tools: ['current_time'], timeZone: 'Asia/Shanghai' }
  if (/(网上|互联网上|互联网|搜索|官网|官方网站|实时新闻|最新消息|网络上|全网)/i.test(text)) return { route: 'web_search', intent: 'web_search', keywords, category, timeSensitive: true, requiresLogin: false, tools: ['public_database', 'web_search'] }
  if (/(数据库|平台里有多少|目前有多少|统计|汇总|有哪些资讯|现有数据|数据里)/i.test(text)) return { route: 'public_data', intent: 'public_database', keywords, category, timeSensitive: false, requiresLogin: false, tools: ['public_database'] }
  if (/截止|报名时间|什么时候|几点|日期|近期|即将|开始时间/.test(text)) return { route: 'upcoming', intent: 'deadline_or_schedule', keywords, category, timeSensitive: true, requiresLogin: false, tools: ['public_database'] }
  if (/怎么用|在哪里|如何收藏|如何订阅|怎么登录|民大通|平台功能|校园墙/.test(text)) return { route: 'platform_help', intent: 'platform_help', keywords, category: '', timeSensitive: false, requiresLogin: false, tools: [] }
  if (/我的|帮我发布|替我收藏|修改密码|我的订阅|我的消息|私信/.test(text)) return { route: 'account_action', intent: 'private_or_action', keywords, category, timeSensitive: false, requiresLogin: true, tools: [] }
  if (/^(你好|嗨|哈喽|谢谢|多谢|你是谁|在吗|忙吗|你忙吗|你现在忙吗|辛苦了|早上好|晚上好|晚安|哈哈|嗯哼|嗯？|嗯)/.test(text) || /(你(?:现在)?忙吗|在忙吗|方便吗|累不累|你在干嘛|你在做什么)/.test(text)) return { route: 'social_chat', intent: 'social_chat', keywords: [], category: '', timeSensitive: false, requiresLogin: false, tools: [] }
  return { route: 'campus_info', intent: 'campus_information', keywords, category, timeSensitive: /最新|今天|近期|202\d/.test(text), requiresLogin: false, tools: ['public_database'] }
}

function confidenceForRoute(route) {
  return {
    unsafe: 0.99,
    time: 0.98,
    account_action: 0.92,
    platform_help: 0.9,
    capability_boundary: 0.98,
    social_chat: 0.96,
    public_data: 0.88,
    web_search: 0.84,
    upcoming: 0.82,
    campus_info: 0.62
  }[route] || 0.5
}

const intentAgent = RunnableLambda.from(async state => {
  const intent = deterministicIntent(state.query, state.safety)
  intent.confidence = Number(intent.confidence || confidenceForRoute(intent.route))
  intent.reason = intent.reason || `规则匹配路由:${intent.route}`
  return { intent, stage: 'T', trace: [...state.trace, { stage: 'T', agent: 'intent', route: intent.route, confidence: intent.confidence, mode: 'local' }] }
})

module.exports = { intentAgent, deterministicIntent, confidenceForRoute }
