const CATEGORY_KEYWORDS = {
  notice: /通知|公告|公示|安排|教务|选课|放假|校历/,
  competition: /竞赛|比赛|挑战杯|大创|创新创业|建模/,
  academic: /讲座|论坛|学术|研讨|报告会|科研/,
  recruit: /就业|招聘|实习|宣讲|双选|选调/,
  certification: /考试|考证|教资|教师资格|四六级|普通话|计算机等级|考研/,
  sports: /文体|体育|文艺|演出|社团|联赛|音乐会/,
  volunteer: /志愿|公益|社会实践|支教/,
  activity: /活动|招募|校园生活|交流/
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function extractKeywords(query) {
  const stopWords = new Set(['请问', '一下', '关于', '怎么', '如何', '什么', '哪些', '有没有', '最近', '最新', '我想', '帮我', '可以'])
  return [...new Set(String(query).split(/[\s,，。？！?、:：]+/)
    .map(item => item.trim())
    .filter(item => item.length >= 2 && !stopWords.has(item)))]
    .slice(0, 4)
}

function inferCategory(query) {
  return Object.keys(CATEGORY_KEYWORDS).find(key => CATEGORY_KEYWORDS[key].test(query)) || ''
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
    startTime: Number(item.startTime || 0),
    endTime: Number(item.endTime || 0),
    deadline: Number(item.deadline || item.registrationEndTime || 0),
    sourceName: item.sourceName || item.source || '校园信息平台',
    sourceUrl,
    isOfficial: item.isOfficial !== false
  }
}

function isDemoPlaceholder(item) {
  const text = [item?.title, item?.summary, item?.description, item?.sourceUrl, item?.linkUrl].filter(Boolean).join(' ')
  return /example\.edu|example\.com|picsum\.photos/i.test(text) || ['2024年春季校园招聘会', 'ACM程序设计竞赛', '人工智能前沿技术讲座', '校园足球联赛'].includes(String(item?.title || '').trim())
}

function createRepository(db) {
  const _ = db.command

  async function searchContents(query, intent = {}) {
    const keywords = extractKeywords(query)
    const category = intent.category || inferCategory(query)
    const conditions = [{ status: 'published' }]
    if (category) conditions.push({ category: category === 'certification' ? _.in(['certification', 'teacher-cert']) : category })
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
    const res = await db.collection('contents').where(where).orderBy('publishTime', 'desc').limit(8).get()
    return (res.data || []).filter(item => !isDemoPlaceholder(item)).map(normalizeEvidence)
  }

  async function getUpcoming(intent = {}) {
    const now = Date.now()
    const res = await db.collection('contents').where({ status: 'published' }).orderBy('publishTime', 'desc').limit(50).get()
    return (res.data || []).filter(item => !isDemoPlaceholder(item))
      .map(normalizeEvidence)
      .filter(item => item.deadline > now || item.startTime > now)
      .filter(item => !intent.category || item.category === intent.category || (intent.category === 'certification' && item.category === 'teacher-cert'))
      .sort((a, b) => Math.min(a.deadline || Infinity, a.startTime || Infinity) - Math.min(b.deadline || Infinity, b.startTime || Infinity))
      .slice(0, 8)
  }

  return { searchContents, getUpcoming }
}

module.exports = { createRepository, extractKeywords, inferCategory }
