const cloud = require('wx-server-sdk')
const http = require('http')
const https = require('https')
const zlib = require('zlib')
const crypto = require('crypto')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV, traceUser: true })
const db = cloud.database()

const MAX_ITEMS_PER_SOURCE = Number(process.env.CRAWLER_MAX_ITEMS || 20)
const REQUEST_TIMEOUT = Number(process.env.CRAWLER_TIMEOUT || 15000)
const DAY_MS = 24 * 60 * 60 * 1000
const { DEFAULT_SOURCES } = require('./lib/source-catalog')

const STUDENT_KEYWORDS = /报名|申报|申请|竞赛|比赛|青苗|大创|挑战杯|创新创业|教师资格|教资|考试|考场|场地安排|准考证|四六级|普通话|选课|补考|缓考|奖学金|助学金|评优|推免|保研|实习|招聘|就业|讲座|培训|招募|志愿|社会实践|校园活动|课程|教学安排|学生|本科生|研究生/
const LOW_VALUE_KEYWORDS = /学习贯彻|党委理论|工作会议|领导班子|调研座谈|党建工作|主题教育|代表团来访|校领导会见|新闻联播|媒体聚焦|工作部署/

function validInternalToken(token) {
  const expected = process.env.CRAWLER_INTERNAL_TOKEN || ''
  if (!expected || !token) return false
  const left = Buffer.from(String(expected))
  const right = Buffer.from(String(token))
  return left.length === right.length && crypto.timingSafeEqual(left, right)
}

function tokenFingerprint(token) {
  if (!token) return ''
  return crypto.createHash('sha256').update(String(token)).digest('hex').slice(0, 12)
}

function isTrustedTimerEvent(event, context) {
  const wxContext = context || cloud.getWXContext() || {}
  const isTimer = event?.Type === 'Timer' || event?.type === 'timer' || event?.TriggerName === 'dailyCrawl'
  return isTimer && !wxContext.OPENID
}

function getSources(group = 'all') {
  let sources = DEFAULT_SOURCES
  if (!process.env.CRAWLER_SOURCES_JSON) {
    return sources.filter(source => (source.groups || ['all']).includes(group))
  }
  try {
    const custom = JSON.parse(process.env.CRAWLER_SOURCES_JSON)
    sources = Array.isArray(custom) ? custom.map(item => ({ ...item, linkPattern: new RegExp(item.linkPattern, 'i') })) : DEFAULT_SOURCES
  } catch (error) {
    console.error('CRAWLER_SOURCES_JSON 解析失败，使用内置来源:', error.message)
    sources = DEFAULT_SOURCES
  }
  return sources.filter(source => (source.groups || ['all']).includes(group))
}

function fetchText(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 4) return reject(new Error('重定向次数过多'))
    const client = url.startsWith('https:') ? https : http
    const req = client.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; MUC-Campus-Aggregator/1.0)',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Encoding': 'gzip, deflate',
        'Accept-Language': 'zh-CN,zh;q=0.9'
      }
    }, res => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
        res.resume()
        return resolve(fetchText(new URL(res.headers.location, url).toString(), redirects + 1))
      }
      if (res.statusCode < 200 || res.statusCode >= 300) {
        res.resume()
        return reject(new Error(`HTTP ${res.statusCode}`))
      }
      const chunks = []
      res.on('data', chunk => chunks.push(chunk))
      res.on('end', () => {
        try {
          let buffer = Buffer.concat(chunks)
          const encoding = res.headers['content-encoding']
          if (encoding === 'gzip') buffer = zlib.gunzipSync(buffer)
          if (encoding === 'deflate') buffer = zlib.inflateSync(buffer)
          resolve(buffer.toString('utf8'))
        } catch (error) {
          reject(error)
        }
      })
    })
    req.setTimeout(REQUEST_TIMEOUT, () => req.destroy(new Error('请求超时')))
    req.on('error', reject)
  })
}

function decodeHtml(value = '') {
  const entities = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ensp: ' ', emsp: ' '
  }
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (_, entity) => {
      if (entity[0] === '#') {
        const hex = entity[1].toLowerCase() === 'x'
        const value = parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10)
        return Number.isFinite(value) ? String.fromCodePoint(value) : ' '
      }
      return entities[entity.toLowerCase()] || ' '
    })
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeUrl(href, baseUrl) {
  if (!href || /^(javascript:|mailto:|#)/i.test(href)) return ''
  try { return new URL(href, baseUrl).toString() } catch (_) { return '' }
}

function parseLinks(html, source) {
  const results = []
  const seen = new Set()
  const regex = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi
  let match
  while ((match = regex.exec(html)) !== null) {
    const url = normalizeUrl(match[1], source.baseUrl || source.listUrl)
    const title = decodeHtml(match[2]).replace(/^\[置顶\]\s*/, '')
    if (!url || !title || title.length < 6 || title.length > 160) continue
    const path = new URL(url).pathname + new URL(url).search
    if (source.linkPattern && !source.linkPattern.test(path)) continue
    if (seen.has(url)) continue
    seen.add(url)
    results.push({ title, url })
    if (results.length >= Number(source.maxItems || MAX_ITEMS_PER_SOURCE)) break
  }
  return results
}

function extractMeta(html, key) {
  const patterns = [
    new RegExp(`<meta[^>]+(?:name|property)=["']${key}["'][^>]+content=["']([^"']+)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:name|property)=["']${key}["']`, 'i')
  ]
  for (const pattern of patterns) {
    const match = html.match(pattern)
    if (match) return decodeHtml(match[1])
  }
  return ''
}

function extractPublishTime(html) {
  const text = decodeHtml(html.slice(0, 20000))
  const match = text.match(/(20\d{2})[年.\/-](\d{1,2})[月.\/-](\d{1,2})[日]?\s*(\d{1,2})?[:：]?(\d{1,2})?/)
  if (!match) return 0
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4] || 9), Number(match[5] || 0))
  return Number.isNaN(date.getTime()) ? Date.now() : date.getTime()
}

function parseDateMatch(match) {
  if (!match) return 0
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const hour = Number(match[4] || 23)
  const minute = Number(match[5] || 59)
  const date = new Date(year, month - 1, day, hour, minute)
  return Number.isNaN(date.getTime()) ? 0 : date.getTime()
}

function extractSchedule(text = '') {
  const normalized = decodeHtml(text)
  const datePart = '(20\\d{2})[年.\\/-](\\d{1,2})[月.\\/-](\\d{1,2})[日]?'
  const timePart = '(?:\\s*(\\d{1,2})[:：](\\d{1,2}))?'
  const deadlineMatch = normalized.match(new RegExp(`(?:报名|申报|投稿|提交|申请)[^。；;]{0,28}(?:截止|截至)[^0-9]{0,8}${datePart}${timePart}`))
    || normalized.match(new RegExp(`(?:截止|截至)[^0-9]{0,8}${datePart}${timePart}`))
  const startMatch = normalized.match(new RegExp(`(?:活动|讲座|比赛|会议|考试|宣讲|培训|演出|开幕)[^。；;]{0,28}(?:时间|日期)?[^0-9]{0,8}${datePart}${timePart}`))
  return {
    deadline: parseDateMatch(deadlineMatch),
    startTime: parseDateMatch(startMatch)
  }
}

function extractMainText(html) {
  const candidates = []
  const patterns = [
    /<article\b[^>]*>([\s\S]*?)<\/article>/gi,
    /<div\b[^>]*(?:class|id)=["'][^"']*(?:content|article|v_news_content|detail|show_content)[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi
  ]
  patterns.forEach(pattern => {
    let match
    while ((match = pattern.exec(html)) !== null) {
      const text = decodeHtml(match[1])
      if (text.length > 80) candidates.push(text)
    }
  })
  if (candidates.length) return candidates.sort((a, b) => b.length - a.length)[0].slice(0, 8000)
  return decodeHtml(html.replace(/<head[\s\S]*?<\/head>/i, '')).slice(0, 8000)
}

function categorize(title, body, fallback = 'notice') {
  const text = `${title} ${body}`
  if (/招聘|就业|实习|宣讲|双选会|人才引进|选调/.test(text)) return 'recruit'
  if (/竞赛|比赛|三创赛|电子商务挑战赛|创新大赛|大创|创新创业|挑战杯|建模|互联网\+/.test(text)) return 'competition'
  if (/讲座|论坛|学术|报告会|研讨会|科研|学术会议/.test(text)) return 'academic'
  if (/考试|考证|教师资格|教资|四六级|英语四级|英语六级|考研|研究生招生|普通话|报名|查分/.test(text)) return 'certification'
  if (/体育|文艺|演出|社团|文化节|联赛|展览|音乐会/.test(text)) return 'sports'
  if (/志愿|公益|社会实践|支教|普法实践/.test(text)) return 'volunteer'
  if (/活动|招募|校园新闻|交流|实践团/.test(text)) return 'activity'
  return fallback || 'notice'
}

function formatDate(timestamp) {
  if (!timestamp) return ''
  const date = new Date(timestamp)
  const pad = value => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function extractAudience(text = '') {
  const match = text.match(/(?:面向|对象|参赛对象|报名对象|申请对象)[:：]?([^。；;，]{2,36})/)
  if (match) return match[1].trim()
  if (/本科生/.test(text)) return '本科生'
  if (/研究生/.test(text)) return '研究生'
  if (/全体学生|在校学生/.test(text)) return '在校学生'
  return '相关学生'
}

function extractLocation(text = '') {
  const match = text.match(/(?:地点|考点|考场|活动场地|比赛地点)[:：]?([^。；;]{2,42})/)
  return match ? match[1].trim().slice(0, 42) : ''
}

function extractAction(text = '', category = '') {
  if (/三创赛|电子商务挑战赛/.test(text)) return '确认校赛/省赛批次、团队信息和作品提交要求'
  if (/挑战杯|创新大赛|互联网\+/.test(text)) return '确认赛道、申报材料、校内截止时间和提交入口'
  if (/考研|研究生招生|初试|复试/.test(text)) return '核对招生章程、报名时间、考试科目和目标院校要求'
  if (/教师资格|教资/.test(text)) return '核对报名、缴费、准考证和考试地点等节点'
  if (/四六级|英语四级|英语六级/.test(text)) return '核对报名批次、准考证和考试时间'
  if (/报名|申报|申请/.test(text)) return '按原文要求完成报名或材料提交'
  if (/考场|场地安排|准考证/.test(text)) return '核对考点、时间和所需证件'
  if (category === 'competition') return '查看参赛条件、赛程和报名方式'
  return '打开详情核对要求并按时办理'
}

function buildStructuredSummary(title, body, schedule, category) {
  const text = decodeHtml(`${title} ${body}`)
  const parts = [`对象：${extractAudience(text)}`]
  if (schedule.deadline) parts.push(`截止：${formatDate(schedule.deadline)}`)
  else if (schedule.startTime) parts.push(`时间：${formatDate(schedule.startTime)}`)
  const location = extractLocation(text)
  if (location) parts.push(`地点：${location}`)
  parts.push(`需要做：${extractAction(text, category)}`)
  return parts.join('｜').slice(0, 180)
}

function buildImportantNotices(title, body, schedule, category) {
  const text = `${title} ${body}`
  const notices = []
  if (schedule.deadline) notices.push(`请在 ${formatDate(schedule.deadline)} 前完成相关操作`)
  const location = extractLocation(text)
  if (location) notices.push(`地点：${location}`)
  if (/身份证|学生证|准考证/.test(text)) notices.push('请提前核对并携带要求的证件')
  if (category === 'competition') notices.push('以主办方原文中的参赛资格、批次和报名入口为准')
  return [...new Set(notices)].slice(0, 3)
}

function isStudentRelevant(title, body, category) {
  const text = `${title} ${body}`
  if (LOW_VALUE_KEYWORDS.test(title) && !STUDENT_KEYWORDS.test(title)) return false
  if (['competition', 'certification', 'recruit'].includes(category)) return true
  return STUDENT_KEYWORDS.test(text)
}

function isRecentOrActive(publishTime, schedule, recencyDays) {
  const now = Date.now()
  const recent = publishTime > 0 && now - publishTime <= recencyDays * DAY_MS
  const active = schedule.deadline > now || schedule.startTime > now
  return recent || active
}

function makeTags(category, title) {
  const labels = {
    notice: '通知', competition: '竞赛', academic: '讲座', recruit: '就业',
    certification: '考试考证', sports: '文体', volunteer: '志愿', activity: '活动'
  }
  const tags = [labels[category] || '校园资讯']
  if (/教师资格|教资/.test(title)) tags.push('教资')
  if (/四六级|英语四级|英语六级/.test(title)) tags.push('四六级')
  if (/考研|研究生招生|初试|复试/.test(title)) tags.push('考研')
  if (/三创赛|电子商务挑战赛/.test(title)) tags.push('三创赛')
  if (/挑战杯/.test(title)) tags.push('挑战杯')
  if (/创新大赛|互联网\+|创新创业/.test(title)) tags.push('创新创业')
  if (/丰台/.test(title)) tags.push('丰台校区')
  if (/海淀/.test(title)) tags.push('海淀校区')
  return tags
}

function calculateFreshnessScore(publishTime, recencyDays) {
  if (!publishTime) return 0.2
  const age = Math.max(0, Date.now() - publishTime) / DAY_MS
  return Math.max(0, Math.min(1, 1 - age / Math.max(1, Number(recencyDays || 30))))
}

function calculateEvidenceScore(source, title, body, publishTime, sourceUrl) {
  let score = source.official !== false ? 0.45 : 0.2
  if (/^https:\/\//i.test(sourceUrl)) score += 0.15
  if (title && title.length >= 6) score += 0.1
  if (body && body.length >= 120) score += 0.15
  if (publishTime) score += 0.1
  return Number(Math.min(1, score).toFixed(3))
}

function hash(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

async function ensureSource(source) {
  const existing = await db.collection('sources').where({ externalId: source.id }).limit(1).get()
  const data = {
    externalId: source.id,
    name: source.name,
    homepage: source.baseUrl || source.listUrl,
    official: source.official !== false,
    profile: source.profile || 'campus-official',
    crawlerEnabled: true,
    crawlerGroups: source.groups || ['all'],
    updatedAt: Date.now()
  }
  if (existing.data?.length) {
    await db.collection('sources').doc(existing.data[0]._id).update({ data })
    return existing.data[0]._id
  }
  const result = await db.collection('sources').add({ data: { ...data, createdAt: Date.now() } })
  return result._id
}

async function upsertContent(item) {
  const collection = db.collection('contents')
  const existing = await collection.where({ externalId: item.externalId }).limit(1).get()
  if (existing.data?.length) {
    const old = existing.data[0]
    if (old.contentHash === item.contentHash) return 'skipped'
    await collection.doc(old._id).update({ data: { ...item, updatedAt: Date.now() } })
    return 'updated'
  }
  await collection.add({ data: { ...item, createdAt: Date.now(), updatedAt: Date.now() } })
  return 'inserted'
}

async function crawlSource(source, options = {}) {
  const sourceId = await ensureSource(source)
  const listHtml = await fetchText(source.listUrl)
  const links = parseLinks(listHtml, source)
  const results = []

  for (const link of links) {
    try {
      const html = await fetchText(link.url)
      const body = extractMainText(html)
      const title = extractMeta(html, 'og:title') || link.title
      const description = extractMeta(html, 'description') || body
      const category = categorize(title, body, source.defaultCategory)
      const publishTime = extractPublishTime(html)
      const schedule = extractSchedule(`${title} ${body}`)
      const recencyDays = Number(options.days || source.recencyDays || 7)
      if (!isRecentOrActive(publishTime, schedule, recencyDays)) {
        results.push('filtered')
        continue
      }
      if (source.requireStudentRelevance !== false && !isStudentRelevant(title, body, category)) {
        results.push('filtered')
        continue
      }
      if (options.group === 'competition' && category !== 'competition') {
        results.push('filtered')
        continue
      }
      const campus = /丰台/.test(`${title} ${body}`) ? 'fengtai' : (/海淀/.test(`${title} ${body}`) ? 'haidian' : source.campus || 'all')
      const normalized = {
        externalId: `${source.id}:${hash(link.url).slice(0, 24)}`,
        title: title.slice(0, 160),
        summary: buildStructuredSummary(title, body, schedule, category),
        description: body || description,
        sourceId,
        sourceName: source.name,
        sourceUrl: link.url,
        linkUrl: link.url,
        category,
        campus,
        tags: makeTags(category, title),
        publishTime,
        sourcePublishedAt: publishTime,
        sourceProfile: source.profile || 'campus-official',
        sourceOfficial: source.official !== false,
        audience: extractAudience(`${title} ${body}`),
        actionItem: extractAction(`${title} ${body}`, category),
        freshnessScore: calculateFreshnessScore(publishTime, recencyDays),
        evidenceScore: calculateEvidenceScore(source, title, body, publishTime, link.url),
        deadline: schedule.deadline,
        startTime: schedule.startTime,
        importantNotices: buildImportantNotices(title, body, schedule, category),
        status: 'published',
        isOfficial: source.official !== false,
        aiProcessed: false,
        summaryMode: 'structured-rule-v1',
        studentRelevant: true,
        ingestType: 'crawler',
        crawlerSourceId: source.id,
        contentHash: hash(`${title}\n${body}`),
        viewCount: 0,
        favoriteCount: 0,
        hotScore: 0
      }
      results.push(await upsertContent(normalized))
    } catch (error) {
      console.error(`[${source.name}] 文章处理失败 ${link.url}:`, error.message)
      results.push('failed')
    }
  }
  return { source: source.name, found: links.length, results }
}

async function getStatus() {
  try {
    const res = await db.collection('crawl_logs').orderBy('timestamp', 'desc').limit(1).get()
    const last = res.data?.[0]
    return {
      code: 200,
      data: last ? {
        ...last.summary,
        lastRun: last.timestamp,
        lastRunText: new Date(last.timestamp).toLocaleString('zh-CN'),
        message: last.success ? '运行正常' : '上次运行存在错误'
      } : { message: '尚未运行' }
    }
  } catch (error) {
    return { code: 200, data: { message: '暂无运行记录' } }
  }
}

exports.main = async (event, context) => {
  const timerEvent = isTrustedTimerEvent(event, context)
  const tokenAccepted = validInternalToken(event?.internalToken)
  console.log('crawler access check', {
    action: event?.action || '',
    tokenProvided: !!event?.internalToken,
    tokenLength: String(event?.internalToken || '').length,
    expectedConfigured: !!String(process.env.CRAWLER_INTERNAL_TOKEN || '').trim(),
    expectedLength: String(process.env.CRAWLER_INTERNAL_TOKEN || '').trim().length,
    tokenFingerprint: tokenFingerprint(event?.internalToken),
    expectedFingerprint: tokenFingerprint(String(process.env.CRAWLER_INTERNAL_TOKEN || '').trim()),
    timerEvent
  })
  if (!tokenAccepted && !timerEvent) {
    return { code: 403, message: 'CRAWLER_INTERNAL_ACCESS_DENIED' }
  }
  if (event?.action === 'status') return getStatus()

  const startedAt = Date.now()
  const sourceGroup = String(event?.sourceGroup || 'all')
  const days = Math.min(Math.max(Number(event?.days || 0), 0), 90)
  const sources = getSources(sourceGroup)
  if (!sources.length) return { code: 400, message: '未知的采集任务' }
  const summary = { group: sourceGroup, days: days || null, fetched: 0, inserted: 0, updated: 0, skipped: 0, filtered: 0, failed: 0, sources: [], errors: [] }

  for (const source of sources) {
    try {
      const result = await crawlSource(source, { group: sourceGroup, days })
      summary.sources.push({ name: result.source, found: result.found })
      summary.fetched += result.found
      result.results.forEach(status => {
        if (Object.prototype.hasOwnProperty.call(summary, status)) summary[status]++
      })
    } catch (error) {
      console.error(`[${source.name}] 来源抓取失败:`, error)
      summary.errors.push(`${source.name}: ${error.message}`)
    }
  }

  const success = summary.errors.length < sources.length
  try {
    await db.collection('crawl_logs').add({
      data: { type: 'campus_information', success, summary, timestamp: Date.now(), duration: Date.now() - startedAt }
    })
  } catch (_) {}

  return {
    code: success ? 200 : 500,
    success,
    message: success ? '校园资讯采集完成' : '所有来源均采集失败',
    summary,
    elapsed: `${((Date.now() - startedAt) / 1000).toFixed(1)}秒`
  }
}
