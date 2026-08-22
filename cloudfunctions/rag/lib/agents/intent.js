const { RunnableLambda } = require('@langchain/core/runnables')
const { inferCategory, extractKeywords } = require('../services/repository')

function deterministicIntent(query, safety) {
  if (safety?.blocked) return { route: 'unsafe', intent: 'unsafe', keywords: [], category: '', timeSensitive: false, requiresLogin: false }
  const text = String(query || '')
  const keywords = extractKeywords(text)
  const category = inferCategory(text)
  if (/(几点|現在.{0,4}(几点|时间)|现在.{0,4}(几点|时间|日期)|当前.{0,4}(时间|日期)|北京时间|当地时间|星期几|几号|今天.{0,4}(日期|几月几日|星期)|^时间$)/i.test(text)) return { route: 'time', intent: 'current_time', keywords, category: '', timeSensitive: true, requiresLogin: false, tools: ['current_time'], timeZone: 'Asia/Shanghai' }
  if (/(网上|互联网上|互联网|搜索|官网|官方网站|实时新闻|最新消息|网络上|全网)/i.test(text)) return { route: 'web_search', intent: 'web_search', keywords, category, timeSensitive: true, requiresLogin: false, tools: ['public_database', 'web_search'] }
  if (/(数据库|平台里有多少|目前有多少|统计|汇总|有哪些资讯|现有数据|数据里)/i.test(text)) return { route: 'public_data', intent: 'public_database', keywords, category, timeSensitive: false, requiresLogin: false, tools: ['public_database'] }
  if (/截止|报名时间|什么时候|几点|日期|近期|即将|开始时间/.test(text)) return { route: 'upcoming', intent: 'deadline_or_schedule', keywords, category, timeSensitive: true, requiresLogin: false, tools: ['public_database'] }
  if (/怎么用|在哪里|如何收藏|如何订阅|怎么登录|民大通|平台功能|校园墙/.test(text)) return { route: 'platform_help', intent: 'platform_help', keywords, category: '', timeSensitive: false, requiresLogin: false, tools: [] }
  if (/我的|帮我发布|替我收藏|修改密码|我的订阅|我的消息|私信/.test(text)) return { route: 'account_action', intent: 'private_or_action', keywords, category, timeSensitive: false, requiresLogin: true, tools: [] }
  if (/^(你好|嗨|谢谢|你是谁|在吗|早上好|晚上好)/.test(text)) return { route: 'social_chat', intent: 'social_chat', keywords: [], category: '', timeSensitive: false, requiresLogin: false, tools: [] }
  return { route: 'campus_info', intent: 'campus_information', keywords, category, timeSensitive: /最新|今天|近期|202\d/.test(text), requiresLogin: false, tools: ['public_database'] }
}

const intentAgent = RunnableLambda.from(async state => {
  const intent = deterministicIntent(state.query, state.safety)
  return { intent, stage: 'T', trace: [...state.trace, { stage: 'T', agent: 'intent', route: intent.route, mode: 'local' }] }
})

module.exports = { intentAgent, deterministicIntent }
