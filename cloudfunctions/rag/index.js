require('./lib/runtime-polyfills')

const cloud = require('wx-server-sdk')
const { runWorkflow } = require('./lib/workflow')
const { MODEL, VISION_MODEL, REQUEST_TIMEOUT } = require('./lib/services/llm')
const { currentTime } = require('./lib/tools')

const RAG_DEPLOYMENT_VERSION = 'star-langgraph-20260821-v3'
const RAG_PROTOCOL_VERSION = 'star-rag-v2'

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV, traceUser: true })
const db = cloud.database()

function validateInternalToken(token) {
  const expected = String(process.env.RAG_INTERNAL_TOKEN || '').trim()
  const provided = String(token || '').trim()
  if (!expected) return { ok: false, message: 'RAG_INTERNAL_TOKEN_MISSING' }
  if (!provided) return { ok: false, message: 'RAG_INTERNAL_TOKEN_REQUIRED' }
  const left = Buffer.from(String(expected))
  const right = Buffer.from(provided)
  return {
    ok: left.length === right.length && require('crypto').timingSafeEqual(left, right),
    message: 'RAG_INTERNAL_ACCESS_DENIED'
  }
}

function tokenFingerprint(token) {
  if (!token) return ''
  return require('crypto').createHash('sha256').update(token).digest('hex').slice(0, 12)
}

exports.main = async event => {
  const { action = 'chat', query, history = [], userContext = {}, traceId, internalToken, protocolVersion, imageUrls = [] } = event || {}
  const startedAt = Date.now()
  const tokenValidation = validateInternalToken(internalToken)
  if (!tokenValidation.ok) {
    console.warn('RAG_TOKEN_VALIDATION_FAILED', {
      action,
      expectedConfigured: !!String(process.env.RAG_INTERNAL_TOKEN || '').trim(),
      expectedLength: String(process.env.RAG_INTERNAL_TOKEN || '').trim().length,
      expectedFingerprint: tokenFingerprint(String(process.env.RAG_INTERNAL_TOKEN || '').trim()),
      providedLength: String(internalToken || '').trim().length,
      providedFingerprint: tokenFingerprint(String(internalToken || '').trim())
    })
  }

  if (action === 'health') {
    if (!tokenValidation.ok) {
      return { code: tokenValidation.message === 'RAG_INTERNAL_ACCESS_DENIED' ? 403 : 503, message: tokenValidation.message }
    }
    return {
      code: 200,
      data: {
        status: 'ok',
        workflow: 'langgraph-star',
        framework: 'langchain',
        model: MODEL,
        visionModel: VISION_MODEL,
        node: process.version,
        requestTimeout: REQUEST_TIMEOUT,
        tools: ['current_time', 'public_database', 'web_search', 'aggregation', 'privacy_filter'],
        toolHealth: {
          currentTime: !!currentTime('Asia/Shanghai').text,
          publicDatabase: true,
          webSearch: true,
          privacyFilter: true,
          conversationIsolation: true
        },
        webSearchConfigured: !!String(process.env.WEB_SEARCH_ENDPOINT || '').trim(),
        configured: !!process.env.DEEPSEEK_API_KEY,
        deploymentVersion: RAG_DEPLOYMENT_VERSION,
        protocolVersion: RAG_PROTOCOL_VERSION,
        timestamp: Date.now()
      },
      message: 'success'
    }
  }

  if (action !== 'chat') return { code: 400, message: '无效的操作' }
  if (!tokenValidation.ok) {
    return { code: tokenValidation.message === 'RAG_INTERNAL_ACCESS_DENIED' ? 403 : 503, message: tokenValidation.message }
  }
  if (protocolVersion !== RAG_PROTOCOL_VERSION) return { code: 409, message: 'RAG_PROTOCOL_MISMATCH' }
  const safeImageUrls = Array.isArray(imageUrls)
    ? imageUrls.filter(url => typeof url === 'string' && url.startsWith('https://')).slice(0, 4)
    : []
  if ((!query || !String(query).trim()) && !safeImageUrls.length) return { code: 400, message: '缺少查询参数或图片' }

  try {
    console.log('RAG_WORKFLOW_START', { traceId, action, node: process.version, model: MODEL, historyCount: Array.isArray(history) ? history.length : 0 })
    const result = await runWorkflow(db, {
      query,
      imageUrls: safeImageUrls,
      history: Array.isArray(history) ? history.slice(-12) : [],
      userContext: {
        isLoggedIn: !!userContext.isLoggedIn,
        role: userContext.role === 'admin' ? 'admin' : (userContext.isLoggedIn ? 'student' : 'guest')
      },
      traceId
    })
    console.log('RAG_WORKFLOW_DONE', { traceId, route: result.meta?.route, elapsedMs: Date.now() - startedAt })
    return {
      code: 200,
      data: {
        ...result,
        meta: { ...(result.meta || {}), deploymentVersion: RAG_DEPLOYMENT_VERSION, protocolVersion: RAG_PROTOCOL_VERSION }
      },
      message: 'success'
    }
  } catch (error) {
    const errorCode = error.message === 'AI_SERVICE_NOT_CONFIGURED'
      ? 'AI_SERVICE_NOT_CONFIGURED'
      : error.message === 'LLM_REQUEST_TIMEOUT' ? 'LLM_REQUEST_TIMEOUT' : 'RAG_WORKFLOW_FAILED'
    const visionUnavailable = safeImageUrls.length > 0 && /image|vision|multimodal|model/i.test(String(error.message || ''))
    console.error('RAG_WORKFLOW_ERROR', { traceId, errorCode, message: error.message, stack: error.stack, elapsedMs: Date.now() - startedAt })
    const responseCode = visionUnavailable ? 'AI_VISION_SERVICE_UNAVAILABLE' : errorCode
    return {
      code: 500,
      message: responseCode,
      data: { answer: errorCode === 'AI_SERVICE_NOT_CONFIGURED' ? 'AI 服务尚未配置，请联系管理员设置模型密钥。' : 'AI 服务暂时不可用，请稍后再试。校园资讯仍可在首页正常浏览和搜索。', links: [], errorCode: responseCode }
    }
  }
}
