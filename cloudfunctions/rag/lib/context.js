const SENSITIVE = /(密码|身份证|验证码|银行卡|openid|手机号|私信|住址|token|secret|api[_ -]?key)/i

function cleanMessage(message) {
  if (!message || typeof message !== 'object') return null
  const role = message.role === 'assistant' ? 'assistant' : 'user'
  const content = typeof message.content === 'string'
    ? message.content.replace(/https?:\/\/\S+/g, '[链接]').replace(/\s+/g, ' ').trim()
    : ''
  if (!content || SENSITIVE.test(content)) return null
  return { role, content: content.slice(0, 240) }
}

function compressHistory(history, limit = 6) {
  const messages = (Array.isArray(history) ? history : []).map(cleanMessage).filter(Boolean)
  return messages.slice(-limit)
}

function formatHistory(history) {
  return compressHistory(history).map(item => `${item.role === 'user' ? '用户' : '助手'}：${item.content}`).join('\n')
}

module.exports = { compressHistory, formatHistory }
