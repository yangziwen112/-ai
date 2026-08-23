const { sanitizeAnswer } = require('./safety')

function hasUnsupportedDate(answer, state) {
  const text = String(answer || '')
  const preciseDate = /\b20\d{2}\s*[-年]\s*\d{1,2}\s*[-月]\s*\d{1,2}|\d{1,2}\s*月\s*\d{1,2}\s*日/.test(text)
  if (!preciseDate) return false
  const trustedTool = (state.toolResults || []).some(item =>
    item.tool === 'current_time' ||
    (item.tool === 'public_database' && item.available !== false && (item.records || []).length > 0) ||
    (item.tool === 'web_search' && item.available !== false && (item.results || []).length > 0)
  )
  return !trustedTool && !(state.evidence || []).length
}

function evaluateAnswer(state, answer) {
  const safe = sanitizeAnswer(answer)
  const route = state.intent?.route || ''
  const evidenceRequired = ['campus_info', 'upcoming', 'public_data', 'web_search'].includes(route)
  const evidenceCount = (state.evidence || []).length
  const hasEvidence = evidenceCount > 0
  const noEvidenceDisclosure = /没有检索到|暂时没有找到|暂未确认|无法确认|请以原文|打开原文/.test(safe)
  const concise = safe.length <= 220 || /详细|展开|分析|方案|步骤|报告/.test(String(state.query || ''))
  const actionable = route === 'social_chat' || route === 'time' || route === 'unsafe' || route === 'account_action' || route === 'capability_boundary'
    ? true
    : /下一步|建议|查看原文|打开|登录|订阅|确认|报名|联系/.test(safe)
  const unsupportedDate = hasUnsupportedDate(safe, state)
  const internalLeak = /模型暂时|数据库原文|工具调用|检索过程|工作流失败|RAG_|traceId/i.test(safe)
  const evidenceScore = evidenceRequired ? (hasEvidence ? 100 : noEvidenceDisclosure ? 72 : 35) : 100
  const conciseScore = concise ? 100 : 55
  const actionScore = actionable ? 100 : 60
  const safetyScore = unsupportedDate || internalLeak ? 20 : 100
  const score = Math.round((evidenceScore * 0.45) + (conciseScore * 0.2) + (actionScore * 0.2) + (safetyScore * 0.15))
  return {
    answer: safe,
    approved: !!safe && !unsupportedDate && !internalLeak && score >= 70,
    score,
    metrics: {
      evidenceScore,
      conciseScore,
      actionScore,
      safetyScore,
      evidenceCount,
      evidenceRequired,
      unsupportedDate,
      internalLeak
    },
    feedback: internalLeak
      ? '回答暴露了内部实现或故障状态，请改为自然、面向用户的业务表达。'
      : unsupportedDate
      ? '没有可靠证据却给出了精确日期，请删除无依据的时间。'
      : !hasEvidence && evidenceRequired && !noEvidenceDisclosure
        ? '缺少可见来源，请说明暂未检索到可靠信息。'
        : !actionable && evidenceRequired
          ? '回答缺少下一步动作，请补充查看原文、确认资格或办理入口。'
          : ''
  }
}

module.exports = { evaluateAnswer, hasUnsupportedDate }
