const BLOCKED_PATTERNS = [
  /(?:自杀|自残).{0,12}(?:方法|教程|怎么)/i,
  /(?:炸弹|爆炸物|毒药).{0,12}(?:制作|配方|教程)/i,
  /(?:绕过|破解).{0,12}(?:登录|权限|系统)/i,
  /(?:密码|身份证|openid).{0,12}(?:导出|泄露|查询全部)/i
]

function normalizeQuery(value) {
  return String(value || '').replace(/[\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 500)
}

function inspectQuery(query) {
  const blocked = BLOCKED_PATTERNS.some(pattern => pattern.test(query))
  return { blocked, reason: blocked ? 'unsafe_or_sensitive_request' : '' }
}

function sanitizeAnswer(answer) {
  return String(answer || '')
    .replace(/sk-[a-zA-Z0-9_-]{12,}/g, '[敏感信息已隐藏]')
    .replace(/\b\d{17}[\dXx]\b/g, '[身份证信息已隐藏]')
    .trim()
}

module.exports = { normalizeQuery, inspectQuery, sanitizeAnswer }
