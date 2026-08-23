const CATEGORY_KEYWORDS = {
  notice: /通知|公告|公示|安排|教务|选课|放假|校历/,
  competition: /竞赛|比赛|三创赛|电子商务挑战赛|挑战杯|大创|创新创业|创新大赛|互联网\+|建模/,
  academic: /讲座|论坛|学术|研讨|报告会|科研/,
  recruit: /就业|招聘|实习|宣讲|双选|选调/,
  certification: /考试|考证|教资|教师资格|四六级|英语四级|英语六级|普通话|计算机等级|考研|研究生招生|初试|复试/,
  sports: /文体|体育|文艺|演出|社团|联赛|音乐会/,
  volunteer: /志愿|公益|社会实践|支教/,
  activity: /活动|招募|校园生活|交流/
}

const CERTIFICATION_CATEGORIES = ['certification', 'teacher-cert', 'teacher_cert', 'teacher', 'exam']
const SEARCH_TERMS = [
  '教师资格考试', '教师资格', '教资', '准考证', '考场安排', '报名时间', '考试时间',
  '笔试', '面试', '普通话', '四六级', '英语四级', '英语六级', '考研', '研究生招生',
  '初试', '复试', '考试', '报名', '成绩'
]

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function extractKeywords(query) {
  const stopWords = new Set(['请问', '一下', '关于', '怎么', '如何', '什么', '哪些', '有没有', '最近', '最新', '我想', '帮我', '可以'])
  const text = String(query || '')
  const matchedTerms = SEARCH_TERMS.filter(term => text.includes(term))
  return [...new Set(matchedTerms.concat(text.split(/[\s,，。？！?、:：]+/))
    .map(item => item.trim())
    .filter(item => item.length >= 2 && !stopWords.has(item)))]
    .slice(0, 4)
}

function inferCategory(query) {
  const priority = ['certification', 'competition', 'recruit', 'academic', 'volunteer', 'sports', 'activity', 'notice']
  return priority.find(key => CATEGORY_KEYWORDS[key].test(query)) || ''
}

function normalizeEvidence(item) {
  const sourceUrl = item.sourceUrl || item.linkUrl || ''
  return {
    id: item._id,
    title: item.title || '',
    summary: item.summary || '',
    description: String(item.description || '').slice(0, 900),
    category: item.category || 'notice',
    tags: Array.isArray(item.tags) ? item.tags.slice(0, 8) : [],
    campus: item.campus || 'all',
    location: item.location || '',
    publishTime: Number(item.publishTime || 0),
    registrationStartTime: Number(item.registrationStartTime || 0),
    startTime: Number(item.startTime || 0),
    endTime: Number(item.endTime || 0),
    deadline: Number(item.deadline || item.registrationEndTime || 0),
    audience: String(item.audience || '').slice(0, 80),
    actionItem: String(item.actionItem || '').slice(0, 160),
    freshnessScore: Number(item.freshnessScore || 0),
    evidenceScore: Number(item.evidenceScore || 0),
    sourceName: item.sourceName || item.source || '校园信息平台',
    sourceUrl,
    isOfficial: item.isOfficial !== false
  }
}

function scheduleTime(item, now = Date.now()) {
  const registrationStartTime = Number(item.registrationStartTime || 0)
  const deadline = Number(item.deadline || item.registrationEndTime || 0)
  const startTime = Number(item.startTime || 0)
  return { registrationStartTime, deadline, startTime, nextTime: registrationStartTime > now ? registrationStartTime : (deadline > now ? deadline : (startTime > now ? startTime : 0)) }
}

function isDemoPlaceholder(item) {
  const text = [item?.title, item?.summary, item?.description, item?.sourceUrl, item?.linkUrl].filter(Boolean).join(' ')
  return /example\.edu|example\.com|picsum\.photos/i.test(text) || (item?.ingestType !== 'crawler' && ['2024年春季校园招聘会', 'ACM程序设计竞赛', '人工智能前沿技术讲座', '校园足球联赛'].includes(String(item?.title || '').trim()))
}

function categoryMatches(actual, requested) {
  if (!requested) return true
  if (requested === 'certification') return CERTIFICATION_CATEGORIES.includes(String(actual || '').toLowerCase())
  return String(actual || '').toLowerCase() === String(requested).toLowerCase()
}

function createRepository(db) {
  const _ = db.command

  async function searchContents(query, intent = {}) {
    const keywords = extractKeywords(query)
    const category = intent.category || inferCategory(query)
    const conditions = [{ status: _.in(['published', 'open']) }]
    if (category) conditions.push({ category: category === 'certification' ? _.in(CERTIFICATION_CATEGORIES) : category })
    if (keywords.length) {
      const patterns = keywords.flatMap(keyword => {
        const regexp = escapeRegExp(keyword).slice(0, 40)
        return [
          { title: db.RegExp({ regexp, options: 'i' }) },
          { summary: db.RegExp({ regexp, options: 'i' }) },
          { description: db.RegExp({ regexp, options: 'i' }) },
          { tags: _.in([keyword]) }
        ]
      })
      conditions.push(_.or(patterns))
    }

    const where = conditions.length === 1 ? conditions[0] : _.and(...conditions)
    try {
      const res = await db.collection('contents').where(where).orderBy('publishTime', 'desc').limit(30).get()
      return (res.data || []).filter(item => !isDemoPlaceholder(item)).map(normalizeEvidence)
    } catch (error) {
      console.warn('复杂资讯检索失败，启用兼容回退:', error.message)
      const fallback = await db.collection('contents').where({ status: _.in(['published', 'open']) }).orderBy('publishTime', 'desc').limit(100).get()
      const needle = keywords.map(item => String(item).toLowerCase())
      return (fallback.data || [])
        .filter(item => !isDemoPlaceholder(item))
        .filter(item => categoryMatches(item.category, category))
        .filter(item => !needle.length || needle.some(word => [item.title, item.summary, item.description, ...(Array.isArray(item.tags) ? item.tags : [])].join(' ').toLowerCase().includes(word)))
        .slice(0, 30)
        .map(normalizeEvidence)
    }
  }

  async function getUpcoming(intent = {}, query = '') {
    const now = Date.now()
    const category = intent.category || inferCategory(query)
    const where = { status: _.in(['published', 'open']) }
    if (category) where.category = category === 'certification' ? _.in(CERTIFICATION_CATEGORIES) : category
    let rows = []
    try {
      const res = await db.collection('contents').where(where).orderBy('publishTime', 'desc').limit(100).get()
      rows = res.data || []
    } catch (error) {
      console.warn('带分类的近期资讯检索失败，启用兼容回退:', error.message)
      const fallback = await db.collection('contents').where({ status: _.in(['published', 'open']) }).orderBy('publishTime', 'desc').limit(100).get()
      rows = fallback.data || []
    }
    const active = rows.filter(item => !isDemoPlaceholder(item))
      .map(normalizeEvidence)
      .filter(item => item.registrationStartTime > now || item.deadline > now || item.startTime > now)
      .filter(item => categoryMatches(item.category, category))
      .sort((a, b) => {
        const at = scheduleTime(a, now).nextTime || Infinity
        const bt = scheduleTime(b, now).nextTime || Infinity
        return at - bt || Number(b.publishTime || 0) - Number(a.publishTime || 0)
      })
      .slice(0, 8)
    if (active.length || !query) return active
    // 近期查询的回退结果也必须经过未来节点过滤，避免把已过期的报名日期当作“下一次”。
    const fallback = await searchContents(query, { ...intent, category })
    return fallback
      .filter(item => scheduleTime(item, now).nextTime > 0)
      .sort((a, b) => scheduleTime(a, now).nextTime - scheduleTime(b, now).nextTime)
      .slice(0, 8)
  }

  return { searchContents, getUpcoming }
}

module.exports = { createRepository, extractKeywords, inferCategory, categoryMatches, CERTIFICATION_CATEGORIES, scheduleTime }
