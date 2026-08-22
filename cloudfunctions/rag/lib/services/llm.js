const https = require('https')

const API_KEY = process.env.DEEPSEEK_API_KEY || ''
const API_HOST = process.env.DEEPSEEK_API_HOST || 'api.deepseek.com'
const MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat'
const VISION_MODEL = process.env.DEEPSEEK_VISION_MODEL || MODEL
const REQUEST_TIMEOUT = Math.max(5000, Math.min(Number(process.env.DEEPSEEK_TIMEOUT || 20000), 30000))

function requestJson(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, res => {
      let raw = ''
      res.on('data', chunk => { raw += chunk })
      res.on('end', () => {
        try {
          const data = JSON.parse(raw)
          if (res.statusCode < 200 || res.statusCode >= 300) {
            return reject(new Error(data?.error?.message || `LLM HTTP ${res.statusCode}`))
          }
          resolve(data)
        } catch (error) {
          reject(new Error(`LLM响应解析失败: ${raw.slice(0, 160)}`))
        }
      })
    })
    req.setTimeout(REQUEST_TIMEOUT, () => req.destroy(new Error('LLM_REQUEST_TIMEOUT')))
    req.on('error', reject)
    req.write(JSON.stringify(body))
    req.end()
  })
}

async function invoke(messages, options = {}) {
  if (!API_KEY) throw new Error('AI_SERVICE_NOT_CONFIGURED')
  const data = await requestJson({
    hostname: API_HOST,
    port: 443,
    path: '/v1/chat/completions',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${API_KEY}`
    }
  }, {
    model: options.vision ? VISION_MODEL : MODEL,
    messages,
    temperature: options.temperature ?? 0.35,
    max_tokens: options.maxTokens || 700,
    response_format: options.json ? { type: 'json_object' } : undefined
  })
  const content = data?.choices?.[0]?.message?.content
  if (!content) throw new Error('LLM返回内容为空')
  return { content, model: data.model || MODEL, usage: data.usage || {} }
}

async function invokeJson(messages, fallback = {}) {
  try {
    const result = await invoke(messages, { json: true, temperature: 0.1, maxTokens: 420 })
    const cleaned = result.content.replace(/^```json\s*|\s*```$/g, '').trim()
    return { ...result, data: JSON.parse(cleaned) }
  } catch (error) {
    return { content: '', data: fallback, model: MODEL, usage: {}, error: error.message }
  }
}

module.exports = { invoke, invokeJson, MODEL, VISION_MODEL, REQUEST_TIMEOUT }
