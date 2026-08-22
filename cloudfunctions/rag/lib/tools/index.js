const https = require('https')

function requestJson(url, headers = {}, timeout = 8000) {
  return new Promise((resolve, reject) => {
    const target = new URL(url)
    const req = https.request({
      hostname: target.hostname,
      port: target.port || 443,
      path: `${target.pathname}${target.search}`,
      method: 'GET',
      headers: { Accept: 'application/json', 'User-Agent': 'CampusAssistant/1.0', ...headers }
    }, res => {
      let raw = ''
      res.setEncoding('utf8')
      res.on('data', chunk => { raw += chunk })
      res.on('end', () => {
        try {
          const data = JSON.parse(raw)
          if (res.statusCode < 200 || res.statusCode >= 300) return reject(new Error(`WEB_HTTP_${res.statusCode}`))
          resolve(data)
        } catch (_) {
          reject(new Error('WEB_RESPONSE_INVALID'))
        }
      })
    })
    req.setTimeout(timeout, () => req.destroy(new Error('WEB_REQUEST_TIMEOUT')))
    req.on('error', reject)
    req.end()
  })
}

function requestText(url, headers = {}, timeout = 12000, redirects = 0) {
  return new Promise((resolve, reject) => {
    const target = new URL(url)
    const req = https.request({ hostname: target.hostname, port: target.port || 443, path: `${target.pathname}${target.search}`, method: 'GET', headers: { Accept: 'application/rss+xml,text/xml,text/html', 'User-Agent': 'Mozilla/5.0 CampusAssistant/1.0', ...headers } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects < 3) {
        res.resume()
        return requestText(new URL(res.headers.location, target).toString(), headers, timeout, redirects + 1).then(resolve, reject)
      }
      let raw = ''
      res.setEncoding('utf8')
      res.on('data', chunk => { raw += chunk })
      res.on('end', () => res.statusCode >= 200 && res.statusCode < 300 ? resolve(raw) : reject(new Error(`WEB_HTTP_${res.statusCode}`)))
    })
    req.setTimeout(timeout, () => req.destroy(new Error('WEB_REQUEST_TIMEOUT')))
    req.on('error', reject)
    req.end()
  })
}

function decodeXml(value) {
  return String(value || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/<[^>]+>/g, '').trim()
}

function parseBingRss(xml) {
  return [...String(xml || '').matchAll(/<item>([\s\S]*?)<\/item>/gi)].slice(0, 6).map(match => {
    const block = match[1]
    const read = tag => decodeXml(block.match(new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i'))?.[1] || '')
    return { title: read('title'), url: read('link'), snippet: read('description').slice(0, 360) }
  }).filter(item => item.title && item.url)
}

function currentTime(timeZone = 'Asia/Shanghai') {
  let zone = String(timeZone || 'Asia/Shanghai')
  try {
    const now = new Date()
    const formatter = new Intl.DateTimeFormat('zh-CN', {
      timeZone: zone,
      dateStyle: 'full',
      timeStyle: 'medium',
      hour12: false
    })
    return {
      tool: 'current_time',
      timestamp: now.toISOString(),
      timeZone: zone,
      text: formatter.format(now),
      unixMs: now.getTime()
    }
  } catch (_) {
    zone = 'Asia/Shanghai'
    const now = new Date()
    return {
      tool: 'current_time', timestamp: now.toISOString(), timeZone: zone,
      text: new Intl.DateTimeFormat('zh-CN', { timeZone: zone, dateStyle: 'full', timeStyle: 'medium', hour12: false }).format(now),
      unixMs: now.getTime()
    }
  }
}

function flattenDuckTopics(items, output = []) {
  for (const item of Array.isArray(items) ? items : []) {
    if (item?.Text) output.push({ title: String(item.Text).slice(0, 180), url: item.FirstURL || '' })
    if (item?.Topics) flattenDuckTopics(item.Topics, output)
    if (output.length >= 6) break
  }
  return output.slice(0, 6)
}

async function webSearch(query) {
  const q = String(query || '').trim().slice(0, 180)
  if (!q) return { tool: 'web_search', query: '', results: [], available: false, reason: 'empty_query' }
  if (/手机号|电话|身份证|密码|验证码|openid|私信|我的收藏|我的消息|银行卡|住址/.test(q)) {
    return { tool: 'web_search', query: '', results: [], available: false, reason: 'sensitive_query_blocked' }
  }
  const customEndpoint = String(process.env.WEB_SEARCH_ENDPOINT || '').trim()
  try {
    if (customEndpoint) {
      const url = new URL(customEndpoint)
      url.searchParams.set(process.env.WEB_SEARCH_QUERY_PARAM || 'q', q)
      const headers = process.env.WEB_SEARCH_API_KEY
        ? { Authorization: `Bearer ${process.env.WEB_SEARCH_API_KEY}` }
        : {}
      const data = await requestJson(url.toString(), headers)
      const results = Array.isArray(data.results) ? data.results : (Array.isArray(data.organic_results) ? data.organic_results : [])
      return {
        tool: 'web_search', query: q, available: true,
        results: results.slice(0, 6).map(item => ({ title: String(item.title || item.name || '').slice(0, 180), url: item.url || item.link || '', snippet: String(item.snippet || item.description || '').slice(0, 360) }))
      }
    }
    const url = new URL('https://api.duckduckgo.com/')
    url.searchParams.set('q', q)
    url.searchParams.set('format', 'json')
    url.searchParams.set('no_html', '1')
    url.searchParams.set('skip_disambig', '1')
    const data = await requestJson(url.toString(), {}, 12000)
    const results = []
    if (data.AbstractText) results.push({ title: data.Heading || q, url: data.AbstractURL || '', snippet: String(data.AbstractText).slice(0, 360) })
    flattenDuckTopics(data.RelatedTopics, results)
    if (results.length) return { tool: 'web_search', query: q, available: true, provider: 'duckduckgo', results: results.slice(0, 6) }
    const bingUrl = new URL('https://www.bing.com/search')
    bingUrl.searchParams.set('format', 'rss')
    bingUrl.searchParams.set('q', q)
    const rssResults = parseBingRss(await requestText(bingUrl.toString()))
    return { tool: 'web_search', query: q, available: rssResults.length > 0, provider: 'bing-rss', results: rssResults }
  } catch (error) {
    try {
      const bingUrl = new URL('https://www.bing.com/search')
      bingUrl.searchParams.set('format', 'rss')
      bingUrl.searchParams.set('q', q)
      const rssResults = parseBingRss(await requestText(bingUrl.toString()))
      return { tool: 'web_search', query: q, available: rssResults.length > 0, provider: 'bing-rss', results: rssResults }
    } catch (fallbackError) {
      console.warn('联网检索不可用:', error.message, fallbackError.message)
      return { tool: 'web_search', query: q, results: [], available: false, reason: fallbackError.message }
    }
  }
}

function publicDocument(item) {
  const now = Date.now()
  const deadline = Number(item.deadline || item.registrationEndTime || 0)
  const startTime = Number(item.startTime || 0)
  const nextTime = deadline > now ? deadline : (startTime > now ? startTime : 0)
  return {
    id: item._id,
    title: String(item.title || '').slice(0, 160),
    summary: String(item.summary || item.description || '').slice(0, 500),
    category: item.category || 'notice',
    sourceName: item.sourceName || '校园资讯平台',
    sourceUrl: item.sourceUrl || item.linkUrl || '',
    publishTime: Number(item.publishTime || item.createdAt || 0),
    startTime: Number(item.startTime || 0),
    deadline,
    nextTime,
    remainingDays: nextTime ? Math.ceil((nextTime - now) / 86400000) : null,
    location: String(item.location || '').slice(0, 100)
  }
}

function isDemoPlaceholder(item) {
  const text = [item?.title, item?.summary, item?.description, item?.sourceUrl, item?.linkUrl].filter(Boolean).join(' ')
  return /example\.edu|example\.com|picsum\.photos/i.test(text) || ['2024年春季校园招聘会', 'ACM程序设计竞赛', '人工智能前沿技术讲座', '校园足球联赛'].includes(String(item?.title || '').trim())
}

async function publicDatabase(db, query, intent = {}) {
  const _ = db.command
  const keywords = Array.isArray(intent.keywords) ? intent.keywords.slice(0, 4) : []
  const patterns = keywords.flatMap(keyword => {
    const safe = String(keyword).replace(/[.*+?^${}()|[\]\\]/g, '\\$&').slice(0, 40)
    return [
      { title: db.RegExp({ regexp: safe, options: 'i' }) },
      { summary: db.RegExp({ regexp: safe, options: 'i' }) },
      { tags: _.in([keyword]) }
    ]
  })
  const category = intent.category === 'certification' ? _.in(['certification', 'teacher-cert']) : intent.category
  const base = { status: _.in(['published', 'open']) }
  if (category) base.category = category
  const where = patterns.length ? _.and(base, _.or(patterns)) : base
  try {
    const res = await db.collection('contents').where(where).orderBy('publishTime', 'desc').limit(20).get()
    const docs = (res.data || []).filter(item => !isDemoPlaceholder(item)).map(publicDocument)
    const byCategory = docs.reduce((map, item) => {
      map[item.category] = (map[item.category] || 0) + 1
      return map
    }, {})
    const now = Date.now()
    const upcoming = docs.filter(item => item.deadline > now || item.startTime > now).length
    return { tool: 'public_database', query: String(query || '').slice(0, 180), count: docs.length, records: docs, facets: { byCategory, upcoming } }
  } catch (error) {
    console.warn('公开资讯库查询失败:', error.message)
    return { tool: 'public_database', query: String(query || '').slice(0, 180), count: 0, records: [], available: false }
  }
}

async function runTools({ db, query, intent = {} }) {
  const requested = Array.isArray(intent.tools) ? intent.tools : []
  const results = []
  if (requested.includes('current_time')) results.push(currentTime(intent.timeZone || 'Asia/Shanghai'))
  if (requested.includes('public_database')) results.push(await publicDatabase(db, query, intent))
  if (requested.includes('web_search')) results.push(await webSearch(query))
  return results
}

module.exports = { currentTime, webSearch, publicDatabase, runTools }
