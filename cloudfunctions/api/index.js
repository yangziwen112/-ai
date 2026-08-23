﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿const cloud = require('wx-server-sdk')

cloud.init({ 
  env: cloud.DYNAMIC_CURRENT_ENV,
  traceUser: true
})

const crypto = require('crypto')
const db = cloud.database()
const _ = db.command
const RAG_PROTOCOL_VERSION = 'star-rag-v2'
const RAG_DEPLOYMENT_VERSION = 'star-langgraph-20260821-v3'
// 当前为联调阶段；正式发布前必须改为 false。
const DEBUG_ADMIN_LOGIN_ENABLED = false
const DEBUG_LOCAL_USER_ID = 'debug-admin-local'
const BOUND_ACCOUNT_CACHE_TTL = 30 * 1000
const boundAccountCache = new Map()
const debugAccountCache = new Map()
const debugAccountInflight = new Map()

function setBoundAccountCache(appUserId, openId, account) {
  const key = `${appUserId}:${openId}`
  if (boundAccountCache.size > 500) boundAccountCache.clear()
  boundAccountCache.set(key, { account, expiresAt: Date.now() + BOUND_ACCOUNT_CACHE_TTL })
}

async function getBoundAccount(appUserId, openId) {
  if (!appUserId) return false
  const cacheKey = `${appUserId}:${openId}`
  const cached = boundAccountCache.get(cacheKey)
  if (cached && cached.expiresAt > Date.now()) return cached.account
  try {
    const res = await db.collection('users').doc(appUserId).get()
    if (!res.data || res.data.openid !== openId) {
      setBoundAccountCache(appUserId, openId, null)
      return null
    }
    setBoundAccountCache(appUserId, openId, res.data)
    return res.data
  } catch (error) {
    return null
  }
}

async function isAdminAccount(appUserId, openId) {
  const account = await getBoundAccount(appUserId, openId)
  return !!(account && account.role === 'admin')
}

async function resolveAIUserId(appUserId, openId) {
  return (await getBoundAccount(appUserId, openId)) ? appUserId : openId
}

let aiUsageCollectionReady = null
let aiMessagesCollectionReady = null

async function ensureAIMessageCollection() {
  if (aiMessagesCollectionReady) return aiMessagesCollectionReady
  aiMessagesCollectionReady = (async () => {
    try {
      await db.collection('ai_messages').limit(1).get()
    } catch (_) {
      try {
        await db.createCollection('ai_messages')
      } catch (error) {
        const message = String(error?.message || error || '')
        if (!/exist|already|已存在/i.test(message)) throw error
      }
    }
    return true
  })().catch(error => {
    aiMessagesCollectionReady = null
    throw error
  })
  return aiMessagesCollectionReady
}

async function ensureAIUsageCollection() {
  if (aiUsageCollectionReady) return aiUsageCollectionReady
  aiUsageCollectionReady = (async () => {
    try {
      await db.collection('ai_usage').limit(1).get()
      return true
    } catch (_) {
      try {
        await db.createCollection('ai_usage')
      } catch (error) {
        const message = String(error?.message || error || '')
        if (!/exist|already|已存在/i.test(message)) throw error
      }
      await db.collection('ai_usage').limit(1).get()
      return true
    }
  })().catch(error => {
    aiUsageCollectionReady = null
    throw error
  })
  return aiUsageCollectionReady
}

async function reserveGuestAIUsage(openId, requestId) {
  const docId = crypto.createHash('sha256').update(openId).digest('hex').slice(0, 32)
  try {
    await ensureAIUsageCollection()
    return await db.runTransaction(async transaction => {
      const ref = transaction.collection('ai_usage').doc(docId)
      let record = null
      try { record = (await ref.get()).data } catch (_) {}
      const requestIds = Array.isArray(record?.requestIds) ? record.requestIds : []
      if (requestIds.includes(requestId)) return { allowed: true, count: Number(record.count || 0), duplicate: true, reserved: false }
      const count = Number(record?.count || 0)
      if (count >= 3) return { allowed: false, count }
      const data = {
        userIdHash: docId,
        count: count + 1,
        requestIds: requestIds.concat(requestId).slice(-10),
        updatedAt: Date.now()
      }
      if (record) await ref.update({ data })
      else await ref.set({ data: { ...data, createdAt: Date.now() } })
      return { allowed: true, count: count + 1, reserved: true }
    })
  } catch (error) {
    console.warn('游客AI次数服务暂不可用，本次降级放行:', error.message)
    return { allowed: true, count: 0, degraded: true }
  }
}

async function releaseGuestAIUsage(openId, requestId) {
  const docId = crypto.createHash('sha256').update(openId).digest('hex').slice(0, 32)
  try {
    await ensureAIUsageCollection()
    await db.runTransaction(async transaction => {
      const ref = transaction.collection('ai_usage').doc(docId)
      let record = null
      try { record = (await ref.get()).data } catch (_) {}
      if (!record) return
      const requestIds = Array.isArray(record.requestIds) ? record.requestIds : []
      if (!requestIds.includes(requestId)) return
      await ref.update({
        data: {
          count: Math.max(0, Number(record.count || 0) - 1),
          requestIds: requestIds.filter(id => id !== requestId),
          updatedAt: Date.now()
        }
      })
    })
  } catch (error) {
    console.warn('游客AI失败请求次数回退失败:', error.message)
  }
}

exports.main = async (event, context) => {
  const route = event?.route
  const data = event?.data || {}
  const ctx = cloud.getWXContext()
  const userId = ctx.OPENID || 'anon'

  try {
    if (DEBUG_ADMIN_LOGIN_ENABLED && data.appUserId === DEBUG_LOCAL_USER_ID && route !== 'auth/debugAdminLogin') {
      const debugAccount = await resolveDebugAdminAccount(userId)
      data.appUserId = debugAccount._id
    }
    switch (route) {
      case 'meta/tags':
        return await getTags()
      case 'meta/sources':
        return await getSources()
      case 'meta/banners':
        return await getBanners()

      case 'feed/recommend':
        return await listContents({ ...data })
      case 'feed/upcoming':
        return await listUpcomingContents({ ...data })
      case 'content/list':
        return await listContents({ ...data })
      case 'content/detail':
        return await getContentDetail({ id: data?.id })

      case 'content/publish':
        if (!(await isAdminAccount(data?.appUserId, userId))) return { error: 'permission_denied', message: '仅管理员可发布资讯' }
        return await publishContent({ userId: data?.appUserId, ...data })

      case 'content/edit':
        if (!(await isAdminAccount(data?.appUserId, userId))) return { error: 'permission_denied', message: '仅管理员可编辑资讯' }
        return await editContent({ userId: data?.appUserId, ...data })
      
      case 'content/delete':
        if (!(await isAdminAccount(data?.appUserId, userId))) return { error: 'permission_denied', message: '仅管理员可删除资讯' }
        return await deleteContent({ userId: data?.appUserId, ...data })

      case 'user/favorite/toggle':
        if (!(await getBoundAccount(data?.appUserId, userId))) return { error: 'login_required', message: '请登录后收藏' }
        return await toggleFavorite({ userId: data.appUserId, contentId: data?.contentId })
      case 'favorites/list':
        if (!(await getBoundAccount(data?.appUserId, userId))) return { list: [], hasMore: false, error: 'login_required' }
        return await listFavorites({ userId: data.appUserId, ...data })

      case 'history/list':
        if (!(await getBoundAccount(data?.appUserId, userId))) return { list: [], hasMore: false, error: 'login_required' }
        return await listHistory({ userId: data.appUserId, ...data })

      case 'user/subscribe/get':
        if (!(await getBoundAccount(data?.appUserId, userId))) return { sourceIds: [], tagIds: [], error: 'login_required' }
        return await getSubscription({ userId: data.appUserId })
      case 'user/subscribe/set':
        if (!(await getBoundAccount(data?.appUserId, userId))) return { error: 'login_required', message: '请登录后订阅' }
        return await setSubscription({ 
          userId: data.appUserId,
          sourceIds: data?.sourceIds, 
          tagIds: data?.tagIds 
        })

      case 'user/favorite/remove':
        if (!(await getBoundAccount(data?.appUserId, userId))) return { error: 'login_required' }
        return await removeFavorite({ userId: data.appUserId, contentId: data?.contentId })
      case 'user/favorite/clearAll':
        if (!(await getBoundAccount(data?.appUserId, userId))) return { error: 'login_required' }
        return await clearAllFavorites({ userId: data.appUserId })
      case 'history/remove':
        if (!(await getBoundAccount(data?.appUserId, userId))) return { error: 'login_required' }
        return await removeHistory({ userId: data.appUserId, contentId: data?.contentId })
      case 'history/clearAll':
        if (!(await getBoundAccount(data?.appUserId, userId))) return { error: 'login_required' }
        return await clearAllHistory({ userId: data.appUserId })
      case 'history/record':
        if (!(await getBoundAccount(data?.appUserId, userId))) return { ok: true, skipped: 'guest' }
        return await recordHistory({ userId: data.appUserId, contentId: data?.contentId, duration: data?.duration || 0 })
      
      case 'ingest/content':
        return await ingestContent({ payload: data, headers: event.headers, userId })

      case 'dev/initSeed':
        if (!(await isAdminAccount(data?.appUserId, userId))) return { error: 'permission_denied', message: '仅管理员可执行数据维护' }
        return await initSeed()
      
      case 'dev/createSampleData':
        if (!(await isAdminAccount(data?.appUserId, userId))) return { error: 'permission_denied', message: '仅管理员可执行此维护操作' }
        return await createSampleData()
      case 'dev/removeDemoContent':
        if (!(await isAdminAccount(data?.appUserId, userId))) return { error: 'permission_denied', message: '仅管理员可清理演示数据' }
        return await removeDemoContent()
      
      case 'dev/testWrite':
        if (!(await isAdminAccount(data?.appUserId, userId))) return { error: 'permission_denied', message: '仅管理员可执行写入测试' }
        return await testWrite()
      
      case 'dev/initCollections':
        if (!(await isAdminAccount(data?.appUserId, userId))) return { error: 'permission_denied', message: '仅管理员可初始化数据表' }
        return await initCollections()
      
      case 'dev/cleanDuplicates':
        if (!(await isAdminAccount(data?.appUserId, userId))) return { error: 'permission_denied', message: '仅管理员可清理数据' }
        return await cleanDuplicates()
      
      case 'dev/initDefaultUser':
        if (!(await isAdminAccount(data?.appUserId, userId))) return { error: 'permission_denied', message: '仅管理员可初始化用户' }
        return await initDefaultUser()
      
      case 'auth/login':
        return await userLogin({ ...data, openId: userId })

      case 'auth/debugAdminLogin':
        return await debugAdminLogin({ openId: userId, wxContext: ctx })
      
      case 'auth/register':
        return await userRegister(data)
      
      case 'auth/resetPassword':
        return await resetPassword(data)
      
      case 'auth/getUserInfo':
        if (!(await getBoundAccount(data?.appUserId, userId))) return { error: 'login_required' }
        return await getUserInfo({ userId: data.appUserId })

      case 'rag/chat':
        return await handleAIChat({ openId: userId, ...data })
      
      case 'ai/messages/list':
        return await listAIMessages({ userId, appUserId: await resolveAIUserId(data?.appUserId, userId), conversationId: data?.conversationId, page: data?.page, pageSize: data?.pageSize })
      case 'ai/conversations/list':
        return await listAIConversations({ userId, appUserId: await resolveAIUserId(data?.appUserId, userId) })
      case 'rag/health':
        if (!(await isAdminAccount(data?.appUserId, userId))) return { code: 403, message: '仅管理员可查看服务状态' }
        return await callRagFunction({ action: 'health' })

      case 'crawler/run':
        if (!(await isAdminAccount(data?.appUserId, userId))) return { code: 403, message: '仅管理员可运行采集器' }
        return await runCrawler({ sourceGroup: data?.sourceGroup, days: data?.days })
      case 'crawler/status':
        if (!(await isAdminAccount(data?.appUserId, userId))) return { code: 403, message: '仅管理员可查看采集状态' }
        return await getCrawlerStatus()

      case 'campus/posts/list':
        return await listCampusPosts({ userId: (await getBoundAccount(data?.appUserId, userId)) ? data.appUserId : '', page: data?.page, pageSize: data?.pageSize, category: data?.category })
      case 'campus/feed/list':
        return await listCampusFeed({ page: data?.page, pageSize: data?.pageSize, category: data?.category, q: data?.q })
      case 'campus/posts/create':
        if (!(await getBoundAccount(data?.appUserId, userId))) return { error: 'login_required', message: '请登录后发布' }
        return await createCampusPost({ userId: data.appUserId, content: data?.content, category: data?.category, customTag: data?.customTag, marketType: data?.marketType, marketDetails: data?.marketDetails, images: data?.images, anonymous: data?.anonymous })
      case 'campus/posts/detail':
        return await getCampusPostDetail({ userId: (await getBoundAccount(data?.appUserId, userId)) ? data.appUserId : '', postId: data?.postId })
      case 'campus/posts/like':
        if (!(await getBoundAccount(data?.appUserId, userId))) return { error: 'login_required', message: '请登录后点赞' }
        return await toggleCampusPostLike({ userId: data.appUserId, postId: data?.postId })
      case 'campus/comments/list':
        return await listCampusComments({ postId: data?.postId })
      case 'campus/comments/create':
        if (!(await getBoundAccount(data?.appUserId, userId))) return { error: 'login_required', message: '请登录后评论' }
        return await createCampusComment({ userId: data.appUserId, postId: data?.postId, content: data?.content, images: data?.images })
      case 'campus/posts/search':
        return await searchCampusPosts({ keyword: data?.keyword })

      case 'messages/list':
        if (!(await getBoundAccount(data?.appUserId, userId))) return { code: 401, data: [], message: '请登录' }
        return await listMessages({ userId: data.appUserId })
      case 'messages/getChat':
        if (!(await getBoundAccount(data?.appUserId, userId))) return { code: 401, data: [], message: '请登录' }
        return await getChatMessages({ userId: data.appUserId, targetUserId: data?.targetUserId })
      case 'messages/send':
        if (!(await getBoundAccount(data?.appUserId, userId))) return { code: 401, message: '请登录' }
        return await sendMessage({ userId: data.appUserId, targetUserId: data?.targetUserId, content: data?.content })

      case 'user/getSettings':
        return await getUserSettings({ userId: data?.userId || data?.appUserId })
      case 'user/updateSettings':
        if (!(await getBoundAccount(data?.appUserId, userId))) return { error: 'login_required' }
        return await updateUserSettings({ userId: data.appUserId, allowStrangerMessages: data?.allowStrangerMessages })
      case 'user/updateAvatar':
        if (!(await getBoundAccount(data?.appUserId, userId))) return { error: 'login_required' }
        return await updateUserAvatar({ userId: data.appUserId, avatarUrl: data?.avatarUrl })

      // 好友相关路由
      case 'friends/search':
        if (!(await getBoundAccount(data?.appUserId, userId))) return { users: [], error: 'login_required' }
        return await searchUsers({ keyword: data?.keyword })
      case 'friends/sendRequest':
        if (!(await getBoundAccount(data?.appUserId, userId))) return { error: 'login_required' }
        return await sendFriendRequest({ userId: data.appUserId, targetUserId: data?.targetUserId })
      case 'friends/requests':
        if (!(await getBoundAccount(data?.appUserId, userId))) return { requests: [], error: 'login_required' }
        return await listFriendRequests({ userId: data.appUserId })
      case 'friends/handleRequest':
        if (!(await getBoundAccount(data?.appUserId, userId))) return { error: 'login_required' }
        return await handleFriendRequest({ userId: data.appUserId, requestId: data?.requestId, action: data?.action })
      case 'friends/list':
        if (!(await getBoundAccount(data?.appUserId, userId))) return { friends: [], error: 'login_required' }
        return await listFriends({ userId: data.appUserId })

      default:
        return { error: 'unknown route', message: `未知的路由: ${route}` }
    }
  } catch (e) {
    console.error('========== 云函数错误 ==========')
    console.error('路由:', route)
    console.error('错误:', e)
    console.error('错误消息:', e.message)
    console.error('错误堆栈:', e.stack)
    return { error: 'internal_error', message: e.message }
  }
}

// 初始化数据库集合
async function initCollections() {
  try {
    console.log('开始初始化数据库集合')
    
    const collections = ['users', 'tags', 'sources', 'banners', 'contents', 'favorites', 'history', 'subscriptions', 'test', 'campus_posts', 'campus_likes', 'campus_comments', 'messages', 'friend_requests', 'friends', 'crawl_logs', 'ai_messages', 'ai_usage', 'ai_runs']
    const results = []
    
    for (const collectionName of collections) {
      try {
        await db.createCollection(collectionName)
        results.push(`${collectionName}: 创建成功`)
      } catch (error) {
        if (error.message.includes('exist')) {
          try {
            await db.collection(collectionName).limit(1).get()
            results.push(`${collectionName}: 已存在且可访问`)
          } catch (e) {
            results.push(`${collectionName}: 访问失败 - ${e.message}`)
          }
        } else {
          results.push(`${collectionName}: 创建失败 - ${error.message}`)
        }
      }
    }

    const successCount = results.filter(r => r.includes('成功') || r.includes('可访问')).length
    const totalCount = collections.length
    
    return { 
      ok: true, 
      message: `初始化完成 (${successCount}/${totalCount})`,
      details: results.join('\n')
    }
  } catch (error) {
    console.error('初始化集合失败:', error)
    return { 
      ok: false, 
      error: '初始化失败', 
      message: error.message 
    }
  }
}

// 创建校园墙帖子 - 修复版
async function createCampusPost({ userId, content, category, images = [], anonymous = false, customTag = '', marketType = 'general', marketDetails = null }) {
  console.log('========== 创建校园墙帖子 ==========')
  console.log('参数:', { userId, content, category, images, anonymous, customTag })
  
  try {
    // 验证必填参数
    if (!content || !content.trim()) {
      console.error('内容为空')
      return { error: 'content_required', message: '内容不能为空' }
    }
    
    if (content.trim().length < 1) {
      console.error('内容太短')
      return { error: 'content_too_short', message: '内容太短' }
    }
    const allowedCategories = ['market', 'share', 'help', 'activity', 'question', 'other']
    if (!allowedCategories.includes(category)) category = 'other'
    const safeImages = sanitizeMediaUrls(images)
    if (category === 'market' && safeImages.length === 0) {
      return { error: 'market_image_required', message: '二手闲置至少需要1张实物图片' }
    }
    if (category === 'market') {
      const details = marketDetails && typeof marketDetails === 'object' ? marketDetails : {}
      const required = [['quantity', '数量'], ['condition', '新旧程度'], ['location', '位置'], ['tradeMethod', '交易方式'], ['reason', '转让原因']]
      const missing = required.find(([key]) => !String(details[key] || '').trim())
      if (missing) return { error: 'market_field_required', message: `请填写二手闲置${missing[1]}` }
    }
    
    console.log('正在查询用户信息...')
    
    let userInfo = null
    try { userInfo = (await db.collection('users').doc(userId).get()).data } catch (_) {}
    if (!userInfo) return { error: 'user_not_found', message: '登录账号不存在，请重新登录' }
    const authorName = userInfo.nickname || userInfo.username || '用户'
    const authorId = userId
    
    console.log('准备创建帖子...')
    console.log('作者:', { authorId, authorName, anonymous })
    
    // 如果有自定义标签，将分类设置为 'other'
    let finalCategory = category || 'share'
    if (customTag && customTag.trim()) {
      finalCategory = 'other'
    }
    
    const postData = {
      content: content.trim(),
      category: finalCategory,
      customTag: customTag ? customTag.trim() : '',
      marketDetails: category === 'market' ? {
        quantity: String(marketDetails.quantity).trim().slice(0, 40),
        condition: String(marketDetails.condition).trim().slice(0, 100),
        location: String(marketDetails.location).trim().slice(0, 100),
        tradeMethod: String(marketDetails.tradeMethod).trim().slice(0, 100),
        reason: String(marketDetails.reason).trim().slice(0, 160)
      } : null,
      marketType: category === 'market' && marketType === 'book' ? 'book' : 'general',
      images: safeImages,
      anonymous: !!anonymous,
      authorId: authorId,
      authorName: authorName,
      likes: 0,
      comments: 0,
      shares: 0,
      status: 'published',
      createdAt: Date.now(),
      updatedAt: Date.now()
    }
    
    console.log('帖子数据:', JSON.stringify(postData, null, 2))
    
    // 确保campus_posts集合存在
    try {
      await db.createCollection('campus_posts')
      console.log('campus_posts集合创建成功或已存在')
    } catch (e) {
      if (!e.message.includes('exist')) {
        console.log('创建campus_posts集合失败:', e.message)
      }
    }
    
    const result = await db.collection('campus_posts').add({ data: postData })
    
    console.log('========== 帖子创建成功 ==========')
    console.log('新帖子ID:', result.id)
    
    return { 
      ok: true, 
      postId: result.id,
      message: '发布成功'
    }
  } catch (error) {
    console.error('========== 创建校园墙帖子失败 ==========')
    console.error('错误:', error)
    console.error('错误消息:', error.message)
    console.error('错误堆栈:', error.stack)
    return { 
      error: 'create_failed', 
      message: `发布失败: ${error.message}` 
    }
  }
}

// 获取校园墙帖子列表
async function listCampusPosts({ userId, page = 1, pageSize = 10, category = '' }) {
  try {
    page = Math.max(parseInt(page, 10), 1)
    pageSize = Math.min(parseInt(pageSize, 10), 50)
    
    
    let query = db.collection('campus_posts').where({ status: 'published' })
    if (category && category !== 'all') {
      query = query.where({ category })
    }
    
    const countRes = await query.count()
    const totalCount = countRes.total || 0
    
    
    if (totalCount === 0) {
      return { list: [], hasMore: false, totalCount: 0 }
    }
    
    const posts = await query
      .orderBy('createdAt', 'desc')
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .get()
    
    const list = (posts.data || []).map(post => ({
      ...post,
      images: sanitizeMediaUrls(post.images),
      createdAtText: formatTime(post.createdAt),
      authorInitial: post.anonymous ? '匿' : (post.authorName?.charAt(0) || '用'),
      authorName: post.anonymous ? '匿名用户' : (post.authorName || '用户')
    }))
    
    const hasMore = (posts.data || []).length === pageSize
    
    return { list, hasMore, totalCount }
  } catch (error) {
    console.error('获取校园墙帖子失败:', error)
    return { list: [], hasMore: false, totalCount: 0, error: error.message }
  }
}

// 第二个 Tab 的展示聚合层。官方资讯与用户帖子仍分别保存在 contents 和
// campus_posts 中，避免采集内容被误认为学生发布内容。
async function listCampusFeed({ page = 1, pageSize = 10, category = 'all', q = '' }) {
  try {
    page = Math.max(parseInt(page, 10) || 1, 1)
    pageSize = Math.min(Math.max(parseInt(pageSize, 10) || 10, 1), 20)
    category = category || 'all'
    q = String(q || '').trim()
    const searchPattern = escapeRegExp(q)

    const end = page * pageSize
    const fetchLimit = Math.min(end + 1, 100)
    const includeOfficial = category === 'all' || category === 'official'
    const includeCommunity = category !== 'official'
    const tasks = []

    if (includeOfficial) {
      // 兼容早期示例/人工录入数据使用的 open 状态，避免升级筛选规则后动态页变空。
      let officialWhere = { status: _.in(['published', 'open']) }
      if (q) {
        officialWhere = _.and(officialWhere, _.or([
          { title: db.RegExp({ regexp: searchPattern, options: 'i' }) },
          { summary: db.RegExp({ regexp: searchPattern, options: 'i' }) }
        ]))
      }
      tasks.push(
        db.collection('contents')
          .where(officialWhere)
          .orderBy('publishTime', 'desc')
          .limit(fetchLimit)
          .get()
          .then(res => (res.data || []).filter(isOfficialFeedEligible).map(normalizeOfficialFeedItem))
          .catch(error => {
            console.warn('聚合流读取官方资讯失败:', error.message)
            return []
          })
      )
    } else {
      tasks.push(Promise.resolve([]))
    }

    if (includeCommunity) {
      const communityWhere = { status: 'published' }
      if (category && category !== 'all') communityWhere.category = category
      if (q) communityWhere.content = db.RegExp({ regexp: searchPattern, options: 'i' })
      tasks.push(
        db.collection('campus_posts')
          .where(communityWhere)
          .orderBy('createdAt', 'desc')
          .limit(fetchLimit)
          .get()
          .then(res => (res.data || []).filter(post => !isDemoCampusPost(post)).map(normalizeCommunityFeedItem))
          .catch(error => {
            console.warn('聚合流读取校园互动失败:', error.message)
            return []
          })
      )
    } else {
      tasks.push(Promise.resolve([]))
    }

    const [officialItems, communityItems] = await Promise.all(tasks)
    const merged = officialItems
      .concat(communityItems)
      .sort((a, b) => b.sortTime - a.sortTime)
    const start = (page - 1) * pageSize

    return {
      list: merged.slice(start, end),
      hasMore: merged.length > end,
      refreshedAt: Date.now()
    }
  } catch (error) {
    console.error('获取校园聚合动态失败:', error)
    return { list: [], hasMore: false, refreshedAt: Date.now(), error: error.message }
  }
}

function normalizeOfficialFeedItem(doc) {
  const item = stripMedia(doc)
  const deadline = Number(doc.deadline || doc.registrationEndTime || 0)
  const startTime = Number(doc.startTime || 0)
  const scheduleItems = []
  if (deadline) scheduleItems.push({ label: '截止时间', value: formatDateTime(deadline) })
  if (startTime) scheduleItems.push({ label: '开始时间', value: formatDateTime(startTime) })
  if (doc.location) scheduleItems.push({ label: '地点', value: String(doc.location) })
  const importantNotices = (Array.isArray(doc.importantNotices) ? doc.importantNotices : [])
    .map(notice => typeof notice === 'string' ? notice : (notice?.text || notice?.content || notice?.title || ''))
    .filter(Boolean)
    .slice(0, 3)

  return {
    ...item,
    _id: doc._id,
    feedKey: `official-${doc._id}`,
    itemType: 'official',
    contentId: doc._id,
    sortTime: Number(item.publishTime || doc.createdAt || 0),
    scheduleItems: scheduleItems.slice(0, 3),
    importantNotices,
    audience: String(doc.audience || '').slice(0, 80),
    actionItem: String(doc.actionItem || '').slice(0, 160),
    freshnessScore: Number(doc.freshnessScore || 0),
    evidenceScore: Number(doc.evidenceScore || 0),
    autoUpdated: doc.ingestType === 'crawler'
  }
}

function isOfficialFeedEligible(doc) {
  if (isDemoPlaceholder(doc)) return false
  if (doc.ingestType !== 'crawler') return true
  if (doc.studentRelevant !== true) return false
  const now = Date.now()
  const publishTime = Number(doc.publishTime || 0)
  const deadline = Number(doc.deadline || doc.registrationEndTime || 0)
  const startTime = Number(doc.startTime || 0)
  return (publishTime > 0 && now - publishTime <= 30 * 24 * 60 * 60 * 1000) || deadline > now || startTime > now
}

function isDemoPlaceholder(doc) {
  const text = [doc?.title, doc?.summary, doc?.description, doc?.sourceUrl, doc?.linkUrl].filter(Boolean).join(' ')
  if (/example\.edu|example\.com|picsum\.photos/i.test(text)) return true
  return ['2024年春季校园招聘会', 'ACM程序设计竞赛', '人工智能前沿技术讲座', '校园足球联赛'].includes(String(doc?.title || '').trim()) && doc?.ingestType !== 'crawler'
}

function isDemoCampusPost(post) {
  const text = [post?.content, post?.customTag, post?.marketDetails?.reason].filter(Boolean).join(' ')
  return /example\.(edu|com)|picsum\.photos|2024年春季校园招聘会|ACM程序设计竞赛|人工智能前沿技术讲座|校园足球联赛/i.test(text)
}

function normalizeCommunityFeedItem(post) {
  const categoryLabels = { market: '二手闲置', share: '分享', help: '求助', activity: '活动', question: '问答', other: '其他' }
  return {
    ...post,
    _id: post._id,
    feedKey: `community-${post._id}`,
    itemType: 'community',
    postId: post._id,
    images: sanitizeMediaUrls(post.images),
    categoryText: post.customTag || categoryLabels[post.category] || '校园互动',
    createdAtText: formatTime(post.createdAt),
    authorInitial: post.anonymous ? '匿' : (post.authorName?.charAt(0) || '用'),
    authorName: post.anonymous ? '匿名用户' : (post.authorName || '用户'),
    sortTime: Number(post.createdAt || 0)
  }
}

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// 获取校园墙帖子详情
async function getCampusPostDetail({ userId, postId }) {
  try {
    
    // 确保 postId 是字符串或数字
    if (!postId || (typeof postId !== 'string' && typeof postId !== 'number')) {
      return { error: 'invalid_post_id', message: '帖子ID格式错误' }
    }
    
    const post = await db.collection('campus_posts').doc(postId).get()
    if (!post.data) {
      return { error: 'post_not_found', message: '帖子不存在' }
    }
    
    // 尝试查询点赞状态，如果集合不存在则默认未点赞
    let userLiked = false
    try {
      const likeQuery = await db.collection('campus_likes')
        .where({ postId, userId })
        .limit(1)
        .get()
      userLiked = likeQuery.data && likeQuery.data.length > 0
    } catch (e) {
      console.log('查询点赞状态失败，默认未点赞:', e.message)
    }
    
    const postData = {
      ...post.data,
      _id: post.id,
      images: sanitizeMediaUrls(post.data.images),
      userLiked,
      createdAtText: formatTime(post.data.createdAt),
      authorInitial: post.data.anonymous ? '匿' : (post.data.authorName?.charAt(0) || '用'),
      authorName: post.data.anonymous ? '匿名用户' : (post.data.authorName || '用户')
    }
    
    return { data: postData }
  } catch (error) {
    console.error('获取校园墙帖子详情失败:', error)
    return { error: 'detail_failed', message: error.message }
  }
}

// 切换校园墙帖子点赞状态
async function toggleCampusPostLike({ userId, postId }) {
  try {
    // 确保 postId 是字符串或数字
    if (!postId || (typeof postId !== 'string' && typeof postId !== 'number')) {
      return { error: 'invalid_post_id', message: '帖子ID格式错误' }
    }
    
    // 确保 campus_likes 集合存在
    try {
      await db.createCollection('campus_likes')
      console.log('campus_likes集合创建成功或已存在')
    } catch (e) {
      if (!e.message.includes('exist')) {
        console.log('创建campus_likes集合失败:', e.message)
      }
    }
    
    const post = await db.collection('campus_posts').doc(postId).get()
    if (!post.data) {
      return { error: 'post_not_found', message: '帖子不存在' }
    }
    
    // 查询点赞记录
    let likeQuery
    try {
      likeQuery = await db.collection('campus_likes')
        .where({ postId, userId })
        .limit(1)
        .get()
    } catch (e) {
      console.log('查询点赞记录失败:', e.message)
      likeQuery = { data: [] }
    }
    
    if (likeQuery.data && likeQuery.data.length > 0) {
      // 取消点赞
      try {
        await db.collection('campus_likes').doc(likeQuery.data[0]._id).remove()
      } catch (e) {
        console.log('删除点赞记录失败:', e.message)
      }
      
      // 更新帖子点赞数
      try {
        await db.collection('campus_posts').doc(postId).update({
          data: {
            likes: _.max([0, (post.data.likes || 0) - 1]),
            updatedAt: Date.now()
          }
        })
      } catch (e) {
        console.log('更新帖子点赞数失败:', e.message)
      }
    } else {
      // 添加点赞
      try {
        await db.collection('campus_likes').add({
          data: {
            postId,
            userId,
            createdAt: Date.now()
          }
        })
      } catch (e) {
        console.log('添加点赞记录失败:', e.message)
      }
      
      // 更新帖子点赞数
      try {
        await db.collection('campus_posts').doc(postId).update({
          data: {
            likes: (post.data.likes || 0) + 1,
            updatedAt: Date.now()
          }
        })
      } catch (e) {
        console.log('更新帖子点赞数失败:', e.message)
      }
    }
    
    return { ok: true }
  } catch (error) {
    console.error('切换点赞状态失败:', error)
    return { error: 'like_failed', message: error.message }
  }
}

// 获取校园墙评论列表
async function listCampusComments({ postId }) {
  try {
    // 确保 postId 是字符串或数字
    if (!postId || (typeof postId !== 'string' && typeof postId !== 'number')) {
      return { list: [] }
    }
    
    try {
      const comments = await db.collection('campus_comments')
        .where({ postId, status: 'published' })
        .orderBy('createdAt', 'asc')
        .get()
      
      const list = (comments.data || []).map(comment => ({
        ...comment,
        _id: comment._id,
        images: sanitizeMediaUrls(comment.images),
        createdAtText: formatTime(comment.createdAt),
        authorInitial: comment.anonymous ? '匿' : (comment.authorName?.charAt(0) || '用'),
        authorName: comment.anonymous ? '匿名用户' : (comment.authorName || '用户')
      }))
      
      return { list }
    } catch (e) {
      console.log('获取评论失败（可能集合不存在）:', e.message)
      return { list: [] }
    }
  } catch (error) {
    console.error('获取校园墙评论失败:', error)
    return { list: [] }
  }
}

// 创建校园墙评论
async function createCampusComment({ userId, postId, content, images = [] }) {
  try {
    // 检查是否有内容或图片
    if ((!content || !content.trim()) && (images.length === 0)) {
      return { error: 'content_required', message: '评论内容或图片不能为空' }
    }
    
    // 确保 postId 是字符串或数字
    if (!postId || (typeof postId !== 'string' && typeof postId !== 'number')) {
      return { error: 'invalid_post_id', message: '帖子ID格式错误' }
    }
    
    const post = await db.collection('campus_posts').doc(postId).get()
    if (!post.data) {
      return { error: 'post_not_found', message: '帖子不存在' }
    }
    
    let authorName = '用户'
    try {
      const user = await db.collection('users').doc(userId).get()
      authorName = user.data?.nickname || user.data?.username || '用户'
    } catch (e) { console.log('获取评论者信息失败:', e.message) }
    
    const commentData = {
      postId,
      content: content ? content.trim() : '',
      images: sanitizeMediaUrls(images),
      authorId: userId,
      authorName,
      anonymous: false,
      status: 'published',
      createdAt: Date.now()
    }
    
    // 确保campus_comments集合存在
    try {
      await db.createCollection('campus_comments')
      console.log('campus_comments集合创建成功或已存在')
    } catch (e) {
      if (!e.message.includes('exist')) {
        console.log('创建campus_comments集合失败:', e.message)
      }
    }
    
    // 先添加评论
    const commentResult = await db.collection('campus_comments').add({ data: commentData })
    
    // 只有评论添加成功后，才更新评论数
    if (commentResult) {
      await db.collection('campus_posts').doc(postId).update({
        data: {
          comments: (post.data.comments || 0) + 1,
          updatedAt: Date.now()
        }
      })
    }
    
    return { ok: true }
  } catch (error) {
    console.error('创建校园墙评论失败:', error)
    return { error: 'comment_failed', message: error.message }
  }
}

// 搜索校园墙帖子
async function searchCampusPosts({ keyword }) {
  try {
    if (!keyword || !keyword.trim()) {
      return { list: [] }
    }
    
    // 搜索帖子内容
    const posts = await db.collection('campus_posts')
      .where({
        status: 'published',
        content: db.RegExp({ regexp: keyword, options: 'i' })
      })
      .orderBy('createdAt', 'desc')
      .limit(20)
      .get()
    
    const list = (posts.data || []).map(post => ({
      ...post,
      images: sanitizeMediaUrls(post.images),
      createdAtText: formatTime(post.createdAt),
      authorInitial: post.anonymous ? '匿' : (post.authorName?.charAt(0) || '用'),
      authorName: post.anonymous ? '匿名用户' : (post.authorName || '用户')
    }))
    
    return { list }
  } catch (error) {
    console.error('搜索校园墙帖子失败:', error)
    return { list: [] }
  }
}

// 消息相关函数
async function listMessages({ userId }) {
  try {
    // 获取用户的所有消息
    const messages = await db.collection('messages')
      .where({ $or: [{ senderId: userId }, { receiverId: userId }] })
      .orderBy('createdAt', 'desc')
      .get()
    
    // 处理聊天列表数据
    const chatMap = new Map()
    
    for (const msg of messages.data) {
      const otherUserId = msg.senderId === userId ? msg.receiverId : msg.senderId
      if (!chatMap.has(otherUserId)) {
        // 获取对方用户信息
        let userName = '用户'
        try {
          const user = await db.collection('users').doc(otherUserId).get()
          if (user.data) {
            userName = user.data.nickname || user.data.username || '用户'
          }
        } catch (e) {
          console.log('获取用户信息失败:', e.message)
        }
        
        chatMap.set(otherUserId, {
          userId: otherUserId,
          userName: userName,
          lastMessage: msg.content,
          lastMessageTime: msg.createdAt
        })
      }
    }
    
    // 转换为数组并排序
    const chatList = Array.from(chatMap.values())
    chatList.sort((a, b) => b.lastMessageTime - a.lastMessageTime)
    
    return {
      code: 200,
      data: chatList,
      message: '获取消息列表成功'
    }
  } catch (error) {
    console.error('获取消息列表失败:', error)
    return {
      code: 200,
      data: [],
      message: '获取消息列表成功'
    }
  }
}

async function getChatMessages({ userId, targetUserId }) {
  try {
    // 获取聊天消息
    const messages = await db.collection('messages')
      .where({ $or: [
        { senderId: userId, receiverId: targetUserId },
        { senderId: targetUserId, receiverId: userId }
      ] })
      .orderBy('createdAt', 'asc')
      .get()
    
    // 标记消息为已读
    try {
      await db.collection('messages')
        .where({ senderId: targetUserId, receiverId: userId, read: false })
        .update({ data: { read: true } })
    } catch (e) {
      console.log('标记消息已读失败:', e.message)
    }
    
    return {
      code: 200,
      data: messages.data || [],
      message: '获取聊天消息成功'
    }
  } catch (error) {
    console.error('获取聊天消息失败:', error)
    return {
      code: 200,
      data: [],
      message: '获取聊天消息成功'
    }
  }
}

async function sendMessage({ userId, targetUserId, content }) {
  try {
    // 检查目标用户是否存在
    const targetUser = await db.collection('users').doc(targetUserId).get()
    if (!targetUser.data) {
      return {
        code: 404,
        message: '用户不存在'
      }
    }
    
    // 检查用户是否允许陌生人私信
    if (targetUser.data.allowStrangerMessages === false) {
      // 检查是否是好友
      try {
        const friend = await db.collection('friends')
          .where({ userId: targetUserId, friendId: userId })
          .limit(1)
          .get()
        
        if (friend.data.length === 0) {
          return {
            code: 403,
            message: '该用户不允许陌生人私信'
          }
        }
      } catch (e) {
        console.log('检查好友关系失败:', e.message)
        // 出错时默认允许发送
      }
    }
    
    // 发送消息
    const messageData = {
      senderId: userId,
      receiverId: targetUserId,
      content: content.trim(),
      read: false,
      createdAt: Date.now()
    }
    
    // 确保 messages 集合存在
    try {
      await db.createCollection('messages')
      console.log('messages 集合创建成功或已存在')
    } catch (e) {
      if (!e.message.includes('exist')) {
        console.log('创建 messages 集合失败:', e.message)
      }
    }
    
    // 添加消息
    try {
      await db.collection('messages').add({ data: messageData })
      console.log('消息添加成功:', messageData)
    } catch (e) {
      console.error('添加消息失败:', e.message)
      return {
        code: 500,
        message: '发送消息失败'
      }
    }
    
    return {
      code: 200,
      message: '发送消息成功'
    }
  } catch (error) {
    console.error('发送消息失败:', error)
    return {
      code: 500,
      message: '发送消息失败'
    }
  }
}

// 用户设置相关函数
async function getUserSettings({ userId }) {
  if (!userId) return { data: { allowStrangerMessages: true } }
  try {
    const user = await db.collection('users').doc(userId).get()
    if (user.data) {
      return {
        data: {
          allowStrangerMessages: user.data.allowStrangerMessages !== false
        }
      }
    }
    return { data: { allowStrangerMessages: true } }
  } catch (error) {
    console.error('获取用户设置失败:', error)
    return { data: { allowStrangerMessages: true } }
  }
}

async function updateUserSettings({ userId, allowStrangerMessages }) {
  try {
    await db.collection('users').doc(userId).update({
      data: {
        allowStrangerMessages,
        updatedAt: Date.now()
      }
    })
    return { ok: true }
  } catch (error) {
    console.error('更新用户设置失败:', error)
    return { error: 'update_settings_failed', message: error.message }
  }
}

async function updateUserAvatar({ userId, avatarUrl }) {
  try {
    await db.collection('users').doc(userId).update({
      data: {
        avatarUrl,
        updatedAt: Date.now()
      }
    })
    return { ok: true }
  } catch (error) {
    console.error('更新用户头像失败:', error)
    return { error: 'update_avatar_failed', message: error.message }
  }
}

// 好友相关函数
async function searchUsers({ keyword }) {
  try {
    // 搜索用户
    const users = await db.collection('users')
      .where({
        $or: [
          { username: db.RegExp({ regexp: keyword, options: 'i' }) },
          { nickname: db.RegExp({ regexp: keyword, options: 'i' }) }
        ]
      })
      .limit(20)
      .get()
    
    return {
      users: users.data.map(user => ({
        userId: user._id,
        username: user.username,
        nickname: user.nickname,
        avatarUrl: user.avatarUrl,
        createdAt: user.createdAt
      }))
    }
  } catch (error) {
    console.error('搜索用户失败:', error)
    return { users: [] }
  }
}

async function sendFriendRequest({ userId, targetUserId }) {
  try {
    // 检查是否是自己
    if (userId === targetUserId) {
      return { error: 'self_request', message: '不能添加自己为好友' }
    }
    
    // 检查是否已经是好友
    try {
      const existingFriend = await db.collection('friends')
        .where({ userId, friendId: targetUserId })
        .limit(1)
        .get()
      
      if (existingFriend.data.length > 0) {
        return { error: 'already_friends', message: '已经是好友' }
      }
    } catch (e) {
      console.log('检查好友关系失败:', e.message)
    }
    
    // 确保 friend_requests 集合存在
    try {
      await db.createCollection('friend_requests')
      console.log('friend_requests 集合创建成功或已存在')
    } catch (e) {
      if (!e.message.includes('exist')) {
        console.log('创建 friend_requests 集合失败:', e.message)
      }
    }
    
    // 检查是否已经发送过请求
    try {
      const existingRequest = await db.collection('friend_requests')
        .where({ senderId: userId, receiverId: targetUserId, status: 'pending' })
        .limit(1)
        .get()
      
      if (existingRequest.data.length > 0) {
        return { error: 'request_exists', message: '已发送好友请求' }
      }
    } catch (e) {
      console.log('检查好友请求失败:', e.message)
    }
    
    // 发送好友请求
    try {
      await db.collection('friend_requests').add({
        data: {
          senderId: userId,
          receiverId: targetUserId,
          status: 'pending',
          createdAt: Date.now()
        }
      })
      console.log('好友请求发送成功:', { senderId: userId, receiverId: targetUserId })
    } catch (e) {
      console.error('发送好友请求失败:', e.message)
      return { error: 'send_request_failed', message: e.message }
    }
    
    return { ok: true }
  } catch (error) {
    console.error('发送好友请求失败:', error)
    return { error: 'send_request_failed', message: error.message }
  }
}

async function listFriendRequests({ userId }) {
  try {
    // 获取好友请求
    const requests = await db.collection('friend_requests')
      .where({ receiverId: userId, status: 'pending' })
      .orderBy('createdAt', 'desc')
      .get()
    
    // 获取请求发送者的信息
    const requestsWithSenderInfo = []
    for (const req of requests.data) {
      try {
        const sender = await db.collection('users').doc(req.senderId).get()
        if (sender.data) {
          requestsWithSenderInfo.push({
            ...req,
            senderInfo: {
              userId: sender.data._id,
              username: sender.data.username,
              nickname: sender.data.nickname,
              avatarUrl: sender.data.avatarUrl
            }
          })
        }
      } catch (e) {
        console.log('获取发送者信息失败:', e.message)
      }
    }
    
    return {
      requests: requestsWithSenderInfo
    }
  } catch (error) {
    console.error('获取好友请求失败:', error)
    return { requests: [] }
  }
}

async function handleFriendRequest({ userId, requestId, action }) {
  try {
    // 获取请求信息
    try {
      const request = await db.collection('friend_requests').doc(requestId).get()
      if (!request.data || request.data.receiverId !== userId) {
        return { error: 'invalid_request', message: '无效的请求' }
      }
      
      if (action === 'accept') {
        // 接受好友请求
        await db.collection('friend_requests').doc(requestId).update({
          data: { status: 'accepted', updatedAt: Date.now() }
        })
        
        // 确保 friends 集合存在
        try {
          await db.createCollection('friends')
          console.log('friends 集合创建成功或已存在')
        } catch (e) {
          if (!e.message.includes('exist')) {
            console.log('创建 friends 集合失败:', e.message)
          }
        }
        
        // 创建好友关系
        try {
          await db.collection('friends').add({
            data: {
              userId: userId,
              friendId: request.data.senderId,
              createdAt: Date.now()
            }
          })
          
          await db.collection('friends').add({
            data: {
              userId: request.data.senderId,
              friendId: userId,
              createdAt: Date.now()
            }
          })
          console.log('好友关系创建成功:', { userId, friendId: request.data.senderId })
        } catch (e) {
          console.error('创建好友关系失败:', e.message)
          return { error: 'create_friendship_failed', message: e.message }
        }
      } else if (action === 'reject') {
        // 拒绝好友请求
        await db.collection('friend_requests').doc(requestId).update({
          data: { status: 'rejected', updatedAt: Date.now() }
        })
      }
    } catch (e) {
      console.error('处理好友请求失败:', e.message)
      return { error: 'handle_request_failed', message: e.message }
    }
    
    return { ok: true }
  } catch (error) {
    console.error('处理好友请求失败:', error)
    return { error: 'handle_request_failed', message: error.message }
  }
}

async function listFriends({ userId }) {
  try {
    // 获取好友列表
    const friends = await db.collection('friends')
      .where({ userId })
      .get()
    
    // 获取好友信息
    const friendsWithInfo = []
    for (const friend of friends.data) {
      try {
        const user = await db.collection('users').doc(friend.friendId).get()
        if (user.data) {
          friendsWithInfo.push({
            ...friend,
            userInfo: {
              userId: user.data._id,
              username: user.data.username,
              nickname: user.data.nickname,
              avatarUrl: user.data.avatarUrl
            }
          })
        }
      } catch (e) {
        console.log('获取好友信息失败:', e.message)
      }
    }
    
    return {
      friends: friendsWithInfo
    }
  } catch (error) {
    console.error('获取好友列表失败:', error)
    return { friends: [] }
  }
}

// 其他辅助函数
async function getTags() {
  try {
    const res = await db.collection('tags').get()
    return { list: res.data || [] }
  } catch (error) {
    console.error('获取标签失败:', error)
    return { list: [] }
  }
}

async function getSources() {
  try {
    const res = await db.collection('sources').get()
    return { list: res.data || [] }
  } catch (error) {
    console.error('获取来源失败:', error)
    return { list: [] }
  }
}

async function getBanners() {
  try {
    const res = await db.collection('banners').orderBy('ts', 'desc').limit(10).get()
    return { list: (res.data || []).filter(item => !/2024|example\.edu|example\.com|picsum\.photos/i.test(JSON.stringify(item))) }
  } catch (error) {
    console.error('获取横幅失败:', error)
    return { list: [] }
  }
}

async function listContents(params) {
  try {
    const page = Math.max(parseInt(params.page || 1, 10), 1)
    const pageSize = Math.min(parseInt(params.pageSize || 10, 10), 50)
    const campus = params.campus || 'all'
    const type = params.type === 'teacher-cert' ? 'certification' : (params.type || '')
    const timeRange = params.timeRange || ''
    const sort = params.sort === 'hottest' ? 'hottest' : 'latest'
    const q = (params.q || '').trim()

    // 历史版本曾使用 open 表示已发布；读取时兼容两种状态，确保升级不会隐藏原有内容。
    let where = { status: _.in(['published', 'open']) }
    if (campus && campus !== 'all') where.campus = campus
    if (type === 'certification') {
      where.category = _.in(['certification', 'teacher-cert'])
    } else if (type) {
      where.category = type
    }

    const now = Date.now()
    if (timeRange === 'today') where.publishTime = _.gte(new Date(new Date().setHours(0,0,0,0)).getTime())
    else if (timeRange === 'week') where.publishTime = _.gte(startOfWeekTs())
    else if (timeRange === 'month') where.publishTime = _.gte(startOfMonthTs())

    if (q) {
      where = _.and(where, _.or([
          { title: db.RegExp({ regexp: escapeRegExp(q), options: 'i' }) },
          { summary: db.RegExp({ regexp: escapeRegExp(q), options: 'i' }) }
      ]))
    }

    const collection = db.collection('contents')
    const order = sort === 'hottest' ? { field: 'hotScore', dir: 'desc' } : { field: 'publishTime', dir: 'desc' }

    const base = collection.where(where).orderBy(order.field, order.dir)
    const res = await base.skip((page - 1) * pageSize).limit(pageSize).get()
    // 这里是首页/资讯列表，不对历史内容做动态流的严格相关性过滤。
    // 采集内容的学生相关性筛选仅应用于校园动态聚合层。
    const list = (res.data || []).filter(doc => !isDemoPlaceholder(doc)).map(stripMedia)
    const hasMore = (res.data || []).length === pageSize
    return { list, hasMore }
  } catch (error) {
    console.error('获取内容列表失败:', error)
    return { list: [], hasMore: false }
  }
}

async function listUpcomingContents(params = {}) {
  try {
    const limit = Math.min(Math.max(Number(params.limit) || 6, 1), 12)
    const now = Date.now()
    const res = await db.collection('contents')
      .where({ status: _.in(['published', 'open']) })
      .orderBy('publishTime', 'desc')
      .limit(50)
      .get()

    const list = (res.data || [])
      .filter(isOfficialFeedEligible)
      .map(doc => {
        const deadline = Number(doc.deadline || doc.registrationEndTime || 0)
        const startTime = Number(doc.startTime || 0)
        const nodeTime = deadline > now ? deadline : (startTime > now ? startTime : 0)
        if (!nodeTime) return null
        const normalized = stripMedia(doc)
        return {
          _id: doc._id,
          title: doc.title,
          category: normalized.category,
          categoryText: normalized.categoryText,
          sourceName: normalized.sourceName,
          nodeLabel: deadline > now ? '报名截止' : '活动开始',
          nodeTime,
          nodeTimeText: formatDateTime(nodeTime)
        }
      })
      .filter(Boolean)
      .sort((a, b) => a.nodeTime - b.nodeTime)
      .slice(0, limit)

    return { list }
  } catch (error) {
    console.error('获取近期关注失败:', error)
    return { list: [] }
  }
}

function stripMedia(doc) {
  if (!doc) return {}
  const category = normalizeCategory(doc.category, doc.tags, doc.title)
  const sourceName = doc.sourceName || doc.organizerName || doc.source || '校园信息平台'
  const publishTime = Number(doc.publishTime || doc.createdAt || Date.now())
  const startTime = Number(doc.startTime || 0)
  const endTime = Number(doc.endTime || 0)
  const deadline = Number(doc.deadline || doc.registrationEndTime || 0)
  const sourceUrl = sanitizeSourceLink(doc.sourceUrl || doc.linkUrl)
  return {
    ...doc,
    images: sanitizeMediaUrls(doc.images),
    coverUrl: isPersistentMediaUrl(doc.coverUrl) ? doc.coverUrl : '',
    posterUrl: isPersistentMediaUrl(doc.posterUrl) ? doc.posterUrl : '',
    category,
    categoryText: CATEGORY_LABELS[category] || '校园资讯',
    sourceName,
    source: sourceName,
    sourceUrl,
    linkUrl: sourceUrl,
    sourceInitial: sourceName.slice(0, 1),
    publishTime,
    publishTimeText: formatContentTime(publishTime),
    displayTags: Array.isArray(doc.tags) ? doc.tags.slice(0, 3) : [],
    campusText: CAMPUS_LABELS[doc.campus] || '全校',
    timeText: doc.timeText || formatEventRange(startTime, endTime),
    deadlineText: doc.deadlineText || (deadline ? formatDateTime(deadline) : ''),
    isOfficial: doc.isOfficial !== false && !!(doc.sourceUrl || doc.sourceName || doc.sourceId),
    aiProcessed: !!(doc.aiProcessed || doc.isAiGenerated || doc.ingestType === 'crawler')
  }
}

function sanitizeSourceLink(url) {
  if (typeof url !== 'string') return ''
  const value = url.trim()
  if (!/^https:\/\//i.test(value)) return ''
  if (/example\.edu|example\.com|picsum\.photos|localhost|127\.0\.0\.1/i.test(value)) return ''
  return value.slice(0, 1000)
}

function isPersistentMediaUrl(url) {
  if (typeof url !== 'string') return false
  const value = url.trim()
  return value.startsWith('cloud://') || value.startsWith('https://')
}

function sanitizeMediaUrls(urls) {
  if (!Array.isArray(urls)) return []
  return urls
    .filter(isPersistentMediaUrl)
    .map(url => url.trim())
    .slice(0, 9)
}

const CATEGORY_LABELS = {
  notice: '通知公告',
  competition: '竞赛实践',
  academic: '讲座学术',
  recruit: '就业招聘',
  certification: '考试考证',
  'teacher-cert': '考试考证',
  sports: '文体活动',
  volunteer: '志愿服务',
  activity: '校园活动'
}

const CAMPUS_LABELS = {
  all: '全校',
  haidian: '海淀校区',
  fengtai: '丰台校区'
}

function normalizeCategory(category = '', tags = [], title = '') {
  if (category === 'teacher-cert') return 'certification'
  if (CATEGORY_LABELS[category]) return category
  const text = `${title} ${(tags || []).join(' ')}`
  if (/招聘|就业|实习|宣讲|双选/.test(text)) return 'recruit'
  if (/竞赛|比赛|大创|创新创业|挑战杯/.test(text)) return 'competition'
  if (/讲座|论坛|学术|报告会|研讨/.test(text)) return 'academic'
  if (/考试|考证|教资|四六级|普通话|报名|成绩查询/.test(text)) return 'certification'
  if (/体育|文艺|演出|社团|文化节/.test(text)) return 'sports'
  if (/志愿|公益|社会实践/.test(text)) return 'volunteer'
  if (/活动|招募/.test(text)) return 'activity'
  return 'notice'
}

function formatContentTime(timestamp) {
  const value = Number(timestamp)
  if (!value) return '近期发布'
  const diff = Date.now() - value
  if (diff >= 0 && diff < 60 * 1000) return '刚刚'
  if (diff >= 0 && diff < 60 * 60 * 1000) return `${Math.floor(diff / 60000)}分钟前`
  if (diff >= 0 && diff < 24 * 60 * 60 * 1000) return `${Math.floor(diff / 3600000)}小时前`
  if (diff >= 0 && diff < 7 * 24 * 60 * 60 * 1000) return `${Math.floor(diff / 86400000)}天前`
  return formatDateTime(value, false)
}

function formatDateTime(timestamp, withTime = true) {
  const date = new Date(Number(timestamp))
  if (Number.isNaN(date.getTime())) return ''
  const pad = value => String(value).padStart(2, '0')
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  return withTime ? `${day} ${pad(date.getHours())}:${pad(date.getMinutes())}` : day
}

function formatEventRange(startTime, endTime) {
  if (!startTime) return ''
  const start = formatDateTime(startTime)
  if (!endTime) return start
  return `${start} 至 ${formatDateTime(endTime)}`
}

async function getContentDetail({ id }) {
  if (!id) return { detail: {} }
  try {
    const res = await db.collection('contents').doc(id).get()
    return { detail: ['published', 'open'].includes(res.data?.status) && !isDemoPlaceholder(res.data) ? stripMedia(res.data) : {} }
  } catch (error) {
    console.error('获取内容详情失败:', error)
    return { detail: {} }
  }
}

async function publishContent({ userId, title, description, tags, sourceId, images, linkUrl, category, campus = 'all' }) {
  console.log('🚀 publishContent 被调用')
  console.log('参数:', { userId, title, description, tags, sourceId })
  
  if (!title || !description || !sourceId) {
    return { error: 'params_required', message: '标题、描述和来源必填' }
  }

  if (!tags || tags.length === 0) {
    return { error: 'tags_required', message: '至少需要选择一个标签' }
  }

  try {
    const now = Date.now()
    const tagNames = await resolveTagNames(tags)
    const sourceRes = await db.collection('sources').doc(sourceId).get().catch(() => ({ data: null }))
    const sourceName = sourceRes.data?.name || ''
    const contentData = {
      title: title.trim(),
      summary: description.trim().substring(0, 200),
      description: description.trim(),
      tags: tagNames,
      sourceId: sourceId,
      sourceName,
      campus,
      images: sanitizeMediaUrls(images),
      coverUrl: '',
      posterUrl: '',
      linkUrl: sanitizeSourceLink(linkUrl),
      status: 'published',
      publishedBy: userId,
      createdBy: userId,
      createdAt: now,
      publishTime: now,
      updatedAt: now,
      viewCount: 0,
      favoriteCount: 0,
      shareCount: 0,
      commentCount: 0,
      hotScore: 0,
      featured: false,
      category: normalizeCategory(category, tagNames, title),
      isOfficial: true,
      ingestType: 'manual',
      imageCount: Array.isArray(images) ? images.length : 0
    }
    
    const result = await db.collection('contents').add({ data: contentData })
    
    console.log('✅ 内容发布成功:', result)
    
    return {
      ok: true,
      message: '内容发布成功',
      _id: result._id,
      data: contentData
    }
  } catch (error) {
    console.error('❌ 发布内容失败:', error)
    return {
      error: 'publish_failed',
      message: '发布失败，请重试',
      details: error.message
    }
  }
}

async function editContent({ userId, contentId, title, description, tags, sourceId, images, linkUrl, category, campus = 'all' }) {
  console.log('🔄 editContent 被调用')
  
  if (!contentId) {
    return { error: 'contentId_required', message: 'contentId 必填' }
  }

  if (!title || !description || !sourceId) {
    return { error: 'params_required', message: '标题、描述和来源必填' }
  }

  if (!tags || tags.length === 0) {
    return { error: 'tags_required', message: '至少需要选择一个标签' }
  }

  try {
    const tagNames = await resolveTagNames(tags)
    const sourceRes = await db.collection('sources').doc(sourceId).get().catch(() => ({ data: null }))
    const sourceName = sourceRes.data?.name || ''
    const updateData = {
      title: title.trim(),
      summary: description.trim().substring(0, 200),
      description: description.trim(),
      tags: tagNames,
      sourceId: sourceId,
      sourceName,
      campus,
      images: sanitizeMediaUrls(images),
      linkUrl: sanitizeSourceLink(linkUrl),
      updatedAt: Date.now(),
      imageCount: Array.isArray(images) ? images.length : 0,
      category: normalizeCategory(category, tagNames, title)
    }
    
    await db.collection('contents').where({ _id: contentId }).update({ data: updateData })
    
    console.log('✅ 内容编辑成功')
    
    return {
      ok: true,
      message: '内容编辑成功',
      _id: contentId,
      data: updateData
    }
  } catch (error) {
    console.error('❌ 编辑内容失败:', error)
    return {
      error: 'edit_failed',
      message: '编辑失败，请重试',
      details: error.message
    }
  }
}

async function resolveTagNames(tags) {
  const values = Array.isArray(tags) ? tags : [tags]
  const resolved = []
  for (const value of values.filter(Boolean)) {
    try {
      const res = await db.collection('tags').doc(value).get()
      resolved.push(res.data?.name || value)
    } catch (_) {
      resolved.push(value)
    }
  }
  return [...new Set(resolved)]
}

async function deleteContent({ userId, contentId }) {
  console.log('🗑️ deleteContent 被调用')
  
  if (!contentId) {
    return { error: 'contentId_required', message: 'contentId 必填' }
  }

  try {
    const existing = await db.collection('contents').where({ _id: contentId }).get()
    if (!existing.data || existing.data.length === 0) {
      return { error: 'content_not_found', message: '内容不存在或已被删除' }
    }

    const content = existing.data[0]

    // 判断当前用户是否为管理员（管理员可删除任意帖子）
    // userId 可能是前端传入的 users 文档ID，也可能是 OPENID
    let isAdminUser = false
    try {
      const adminRes = await db.collection('users').where({ _id: userId, role: 'admin' }).limit(1).get()
      if (adminRes.data && adminRes.data.length > 0) {
        isAdminUser = true
      }
    } catch (e) {
      console.log('管理员校验失败:', e.message)
    }

    if (!isAdminUser && content.publishedBy !== userId && content.createdBy !== userId) {
      return { error: 'permission_denied', message: '您没有删除此内容的权限' }
    }
    
    await db.collection('contents').where({ _id: contentId }).remove()
    await db.collection('favorites').where({ contentId }).remove()
    await db.collection('history').where({ contentId }).remove()
    
    console.log('✅ 内容删除成功')
    
    return {
      ok: true,
      message: '内容删除成功',
      _id: contentId
    }
  } catch (error) {
    console.error('❌ 删除内容失败:', error)
    return {
      error: 'delete_failed',
      message: '删除失败，请重试',
      details: error.message
    }
  }
}

async function toggleFavorite({ userId, contentId }) {
  if (!contentId) return { error: 'contentId_required' }
  try {
    const coll = db.collection('favorites')
    const key = { userId, contentId }
    const exists = await coll.where(key).get()
    if ((exists.data || []).length) {
      await coll.where(key).remove()
    } else {
      await coll.add({ data: { ...key, ts: Date.now() } })
    }
    return { ok: true }
  } catch (error) {
    console.error('收藏操作失败:', error)
    return { error: '操作失败' }
  }
}

async function removeFavorite({ userId, contentId }) {
  if (!contentId) return { error: 'contentId_required' }
  try {
    const coll = db.collection('favorites')
    await coll.where({ userId, contentId }).remove()
    return { ok: true }
  } catch (error) {
    console.error('删除收藏失败:', error)
    return { error: '删除失败' }
  }
}

async function clearAllFavorites({ userId }) {
  if (!userId) return { error: 'userId_required' }
  try {
    const coll = db.collection('favorites')
    await coll.where({ userId }).remove()
    return { ok: true }
  } catch (error) {
    console.error('清空收藏失败:', error)
    return { error: '清空失败' }
  }
}

async function removeHistory({ userId, contentId }) {
  if (!contentId) return { error: 'contentId_required' }
  try {
    const coll = db.collection('history')
    await coll.where({ userId, contentId }).remove()
    return { ok: true }
  } catch (error) {
    console.error('删除历史失败:', error)
    return { error: '删除失败' }
  }
}

async function clearAllHistory({ userId }) {
  if (!userId) return { error: 'userId_required' }
  try {
    const coll = db.collection('history')
    await coll.where({ userId }).remove()
    return { ok: true }
  } catch (error) {
    console.error('清空历史失败:', error)
    return { error: '清空失败' }
  }
}

async function recordHistory({ userId, contentId, duration = 0 }) {
  console.log('🔔 recordHistory 被调用')
  
  if (!contentId || !userId) {
    return { error: 'contentId_required' }
  }
  
  try {
    const coll = db.collection('history')
    
    const existing = await coll.where({
      userId,
      contentId
    }).orderBy('ts', 'desc').limit(1).get()
    
    const data = {
      userId,
      contentId,
      ts: Date.now(),
      duration: Math.max(0, duration)
    }
    
    if (existing.data && existing.data.length > 0) {
      await coll.doc(existing.data[0]._id).update({ data })
    } else {
      await coll.add({ data })
    }
    
    return { ok: true, message: '浏览历史已记录' }
  } catch (error) {
    console.error('❌ 记录历史失败:', error)
    return { ok: true, message: '记录失败但不影响体验' }
  }
}

async function saveAIMessage({ userId, message, appUserId, conversationId = '', requestId = '', status = 'done', meta = {} }) {
  try {
    await ensureAIMessageCollection()
    
    // 优先使用App注册用户ID，否则使用微信OPENID作为游客标识
    const effectiveUserId = appUserId || userId || 'guest'
    
    const role = message?.role === 'assistant' ? 'assistant' : 'user'
    const cleanMessage = {
      role,
      content: String(message?.content || '').slice(0, 8000),
      links: role === 'assistant' && Array.isArray(message?.links) ? message.links.slice(0, 8) : [],
      imageFileIds: role === 'user' ? sanitizeImageFileIds(message?.imageFileIds) : [],
      meta: role === 'assistant' ? meta : {}
    }
    await db.collection('ai_messages').add({
      data: {
        userId: effectiveUserId,
        conversationId: String(conversationId || 'default').slice(0, 80),
        role,
        message: cleanMessage,
        requestId,
        status,
        createdAt: Date.now()
      }
    })
    
    return { ok: true }
  } catch (error) {
    console.error('保存AI消息失败:', error)
    return { error: 'save_message_failed', message: error.message }
  }
}

async function listAIMessages({ userId, appUserId, conversationId = '', page = 1, pageSize = 50 }) {
  try {
    page = Math.max(parseInt(page, 10), 1)
    pageSize = Math.min(parseInt(pageSize, 10), 100)
    
    // 优先使用App注册用户ID，否则使用微信OPENID
    const effectiveUserId = appUserId || userId || 'guest'
    
    const safeConversationId = String(conversationId || '').slice(0, 80)
    const messages = await db.collection('ai_messages')
      .where({ userId: effectiveUserId })
      .orderBy('createdAt', 'desc')
      .limit(Math.min(Math.max(page * pageSize * 4, 50), 100))
      .get()
    const filtered = safeConversationId
      ? (messages.data || []).filter(item => (item.conversationId || 'default') === safeConversationId)
      : (messages.data || [])
    const pageItems = filtered.slice((page - 1) * pageSize, page * pageSize)
    const ordered = pageItems.slice().reverse()
    
    return {
      messages: ordered.map(m => m.message),
      hasMore: filtered.length > page * pageSize
    }
  } catch (error) {
    console.error('获取AI消息列表失败:', error)
    return { messages: [], hasMore: false }
  }
}

async function listAIConversations({ userId, appUserId }) {
  try {
    const effectiveUserId = appUserId || userId || 'guest'
    const result = await db.collection('ai_messages')
      .where({ userId: effectiveUserId })
      .orderBy('createdAt', 'desc')
      .limit(100)
      .get()
    const grouped = new Map()
    for (const row of result.data || []) {
      const id = String(row.conversationId || 'default').slice(0, 80)
      const message = row.message || {}
      const existing = grouped.get(id)
      const title = message.role === 'user' && message.content
        ? String(message.content).replace(/\s+/g, ' ').trim().slice(0, 24)
        : ''
      if (!existing) {
        grouped.set(id, {
          conversationId: id,
          title: title || '新对话',
          updatedAt: Number(row.createdAt || 0),
          messageCount: 1
        })
      } else {
        existing.messageCount += 1
        if (title && existing.title === '新对话') existing.title = title
      }
    }
    return { conversations: Array.from(grouped.values()).sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 30) }
  } catch (error) {
    console.error('获取AI会话列表失败:', error)
    return { conversations: [] }
  }
}

async function listFavorites({ userId, page = 1, pageSize = 10 }) {
  try {
    page = Math.max(parseInt(page, 10), 1)
    pageSize = Math.min(parseInt(pageSize, 10), 50)
    const favs = await db.collection('favorites')
      .where({ userId })
      .orderBy('ts', 'desc')
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .get()
    const contentIds = (favs.data || []).map(f => f.contentId)
    if (!contentIds.length) return { list: [], hasMore: false }
    const contents = await db.collection('contents').where({ _id: _.in(contentIds) }).get()
    const list = (contents.data || []).map(stripMedia)
    const hasMore = (favs.data || []).length === pageSize
    return { list, hasMore }
  } catch (error) {
    console.error('获取收藏列表失败:', error)
    return { list: [], hasMore: false }
  }
}

async function listHistory({ userId, page = 1, pageSize = 10 }) {
  try {
    page = Math.max(parseInt(page, 10), 1)
    pageSize = Math.min(parseInt(pageSize, 10), 50)
    
    const countRes = await db.collection('history')
      .where({ userId })
      .count()
    const totalCount = countRes.total || 0
    
    if (totalCount === 0) {
      return { list: [], hasMore: false, totalCount: 0 }
    }
    
    const logs = await db.collection('history')
      .where({ userId })
      .orderBy('ts', 'desc')
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .get()
    
    const ids = (logs.data || []).map(l => l.contentId)
    if (!ids.length) {
      return { list: [], hasMore: false, totalCount }
    }
    
    const contents = await db.collection('contents').where({ _id: _.in(ids) }).get()
    
    // 建立history记录和content的映射关系
    const historyMap = new Map()
    logs.data.forEach(log => {
      historyMap.set(log.contentId, log)
    })
    
    // 为每个content添加viewTime字段
    const list = (contents.data || []).map(content => {
      const history = historyMap.get(content._id)
      const item = stripMedia(content)
      if (history && history.ts) {
        // 格式化时间为 YYYY-MM-DD HH:MM:SS
        const date = new Date(history.ts)
        const year = date.getFullYear()
        const month = String(date.getMonth() + 1).padStart(2, '0')
        const day = String(date.getDate()).padStart(2, '0')
        const hours = String(date.getHours()).padStart(2, '0')
        const minutes = String(date.getMinutes()).padStart(2, '0')
        const seconds = String(date.getSeconds()).padStart(2, '0')
        item.viewTime = `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`
      }
      return item
    })
    
    const hasMore = (logs.data || []).length === pageSize
    
    return { list, hasMore, totalCount }
  } catch (error) {
    console.error('获取历史记录失败:', error)
    return { list: [], hasMore: false, totalCount: 0 }
  }
}

async function getSubscription({ userId }) {
  try {
    const res = await db.collection('subscriptions').where({ userId }).get()
    const doc = (res.data || [])[0] || { sourceIds: [], tagIds: [] }
    return doc
  } catch (error) {
    console.error('获取订阅失败:', error)
    return { sourceIds: [], tagIds: [] }
  }
}

async function setSubscription({ userId, sourceIds, tagIds }) {
  try {
    const coll = db.collection('subscriptions')
    const res = await coll.where({ userId }).get()
    const existing = (res.data || [])[0] || {}
    
    const updateData = {
      userId,
      sourceIds: Array.isArray(sourceIds) ? sourceIds : (existing.sourceIds || []),
      tagIds: Array.isArray(tagIds) ? tagIds : (existing.tagIds || [])
    }
    
    if ((res.data || []).length) {
      await coll.where({ userId }).update({ data: updateData })
    } else {
      await coll.add({ data: updateData })
    }
    return { ok: true }
  } catch (error) {
    console.error('设置订阅失败:', error)
    return { error: '设置失败' }
  }
}

async function ingestContent({ payload, headers, userId }) {
  const authHeader = headers?.authorization || headers?.Authorization || ''
  const token = payload?.token || (authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '')
  const required = process.env.API_INGEST_KEY || ''
  if (!required || token !== required) return { error: 'unauthorized' }

  const body = payload || {}
  const doc = {
    externalId: body.externalId,
    title: (body.title || '').trim(),
    summary: (body.summary || '').trim(),
    sourceId: body.sourceId || '',
    sourceName: body.sourceName || '',
    campus: body.campus || 'all',
    category: normalizeCategory(body.category, body.tags, body.title),
    tags: Array.isArray(body.tags) ? body.tags : [],
    publishTime: Number(body.publishTime) || Date.now(),
    createdAt: Number(body.createdAt) || Date.now(),
    updatedAt: Date.now(),
    sourceUrl: sanitizeSourceLink(body.sourceUrl || ''),
    linkUrl: sanitizeSourceLink(body.linkUrl || body.sourceUrl || ''),
    description: (body.description || body.content || body.summary || '').trim(),
    coverUrl: isPersistentMediaUrl(body.coverUrl) ? body.coverUrl.trim() : '',
    images: sanitizeMediaUrls(body.images),
    status: body.status || 'published',
    isOfficial: body.isOfficial !== false,
    aiProcessed: !!body.aiProcessed,
    ingestType: body.ingestType || 'api',
    sourcePublishedAt: Number(body.sourcePublishedAt || body.publishTime) || Date.now(),
    contentHash: body.contentHash || ''
  }
  if (!doc.externalId && !doc.sourceUrl) return { error: 'externalId_or_sourceUrl_required' }

  try {
    const coll = db.collection('contents')
    if (doc.externalId) {
      const existing = await coll.where({ externalId: doc.externalId }).get()
      if ((existing.data || []).length) {
        await coll.where({ externalId: doc.externalId }).update({ data: doc })
      } else {
        await coll.add({ data: doc })
      }
    } else {
      const found = await coll.where({ sourceUrl: doc.sourceUrl }).get()
      if ((found.data || []).length) {
        await coll.where({ sourceUrl: doc.sourceUrl }).update({ data: doc })
      } else {
        await coll.add({ data: doc })
      }
    }
    return { ok: true }
  } catch (error) {
    console.error('内容导入失败:', error)
    return { error: '导入失败' }
  }
}

async function initSeed() {
  return { ok: false, error: 'demo_data_disabled', message: '示例数据初始化已停用，请使用真实采集器或管理员发布' }
}

async function cleanDuplicates() {
  try {
    console.log('开始清理重复数据')
    const collections = ['users', 'tags', 'sources']
    const results = {}
    
    for (const collectionName of collections) {
      const all = await db.collection(collectionName).get()
      const items = all.data || []
      
      const nameMap = {}
      const duplicates = []
      
      items.forEach(item => {
        const key = collectionName === 'users' ? item.username : item.name
        if (!nameMap[key]) {
          nameMap[key] = item
        } else {
          duplicates.push(item._id)
        }
      })
      
      let deleted = 0
      for (const id of duplicates) {
        try {
          await db.collection(collectionName).doc(id).remove()
          deleted++
        } catch (error) {
          console.error(`删除失败:`, error)
        }
      }
      
      results[collectionName] = {
        total: items.length,
        unique: Object.keys(nameMap).length,
        deleted: deleted
      }
    }
    
    return {
      ok: true,
      message: '清理完成',
      results: results
    }
  } catch (error) {
    console.error('清理重复数据失败:', error)
    return {
      ok: false,
      error: '清理失败',
      message: error.message
    }
  }
}

async function createSampleData() {
  return {
    ok: false,
    error: 'demo_data_disabled',
    message: '演示数据已永久停用，请使用真实采集器或管理员发布功能'
  }

}

async function removeDemoContent() {
  const results = { contents: 0, banners: 0, campusPosts: 0 }
  try {
    const contentRes = await db.collection('contents').get()
    for (const doc of contentRes.data || []) {
      if (!isDemoPlaceholder(doc)) continue
      await db.collection('contents').doc(doc._id).remove()
      results.contents++
    }
    const bannerRes = await db.collection('banners').get()
    for (const doc of bannerRes.data || []) {
      if (!/2024|example\.edu|example\.com|picsum\.photos/i.test(JSON.stringify(doc))) continue
      await db.collection('banners').doc(doc._id).remove()
      results.banners++
    }
    try {
      const postRes = await db.collection('campus_posts').get()
      for (const post of postRes.data || []) {
        if (!isDemoCampusPost(post)) continue
        await db.collection('campus_posts').doc(post._id).remove()
        results.campusPosts++
      }
    } catch (error) {
      console.warn('清理校园动态演示内容时集合不可用:', error.message)
    }
    return { ok: true, message: `已清理 ${results.contents} 条演示资讯、${results.banners} 条演示横幅和 ${results.campusPosts} 条校园动态演示内容`, results }
  } catch (error) {
    console.error('清理演示数据失败:', error)
    return { ok: false, error: 'remove_demo_failed', message: error.message, results }
  }
}

async function testWrite() {
  try {
    console.log('开始测试写入')
    
    try {
      await db.collection('test').limit(1).get()
    } catch (error) {
      console.log('test集合不存在，尝试创建')
    }
    
    const testDoc = {
      title: '测试文档',
      content: '这是一个测试文档',
      timestamp: Date.now()
    }
    
    const result = await db.collection('test').add({ data: testDoc })
    
    console.log('写入结果:', result)
    
    return { 
      ok: true, 
      message: '测试写入成功',
      result: result
    }
  } catch (error) {
    console.error('测试写入失败:', error)
    return { 
      ok: false, 
      error: '写入失败', 
      message: error.message 
    }
  }
}

function startOfWeekTs() {
  const now = new Date()
  const day = now.getDay() || 7
  now.setHours(0,0,0,0)
  now.setDate(now.getDate() - day + 1)
  return now.getTime()
}

function startOfMonthTs() {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), 1).getTime()
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex')
  return { passwordHash: hash, passwordSalt: salt, passwordVersion: 1 }
}

function verifyPassword(user, password) {
  if (user.passwordHash && user.passwordSalt) {
    const candidate = crypto.scryptSync(String(password), user.passwordSalt, 64)
    const stored = Buffer.from(user.passwordHash, 'hex')
    return stored.length === candidate.length && crypto.timingSafeEqual(stored, candidate)
  }
  return typeof user.password === 'string' && user.password === password
}

function isDeveloperToolContext(wxContext = {}) {
  const source = String(wxContext.SOURCE || wxContext.CLIENTIP || '').toLowerCase()
  const platform = String(wxContext.PLATFORM || '').toLowerCase()
  return source.includes('wx_devtools') || source.includes('devtool') || platform.includes('devtool')
}

async function debugAdminLogin({ openId, wxContext }) {
  if (!DEBUG_ADMIN_LOGIN_ENABLED && process.env.ENABLE_DEBUG_ADMIN !== 'true' && !isDeveloperToolContext(wxContext)) {
    return { error: 'debug_login_disabled', message: '调试管理员登录仅允许在开发者工具中使用' }
  }

  try {
    const boundUser = await resolveDebugAdminAccount(openId)
    return {
      ok: true,
      debug: true,
      user: {
        userId: boundUser._id,
        username: boundUser.username,
        nickname: boundUser.nickname || '调试管理员',
        role: 'admin',
        avatarUrl: boundUser.avatarUrl || '',
        createdAt: boundUser.createdAt
      }
    }
  } catch (error) {
    console.error('调试管理员登录失败:', error)
    return { error: 'debug_login_failed', message: '调试管理员登录失败，请确认 users 集合可用' }
  }
}

async function resolveDebugAdminAccount(openId) {
  const cached = debugAccountCache.get(openId)
  if (cached && cached.expiresAt > Date.now()) return cached.account
  if (debugAccountInflight.has(openId)) return debugAccountInflight.get(openId)

  const request = (async () => {
    let user = (await db.collection('users').where({ username: 'admin001' }).limit(1).get()).data?.[0]
    if (!user) {
      const createdAt = Date.now()
      const result = await db.collection('users').add({
        data: {
          username: 'admin001',
          ...hashPassword(crypto.randomBytes(32).toString('hex')),
          role: 'admin',
          nickname: '调试管理员',
          idCardLast4: '',
          avatarUrl: '',
          isDebugAccount: true,
          isActive: true,
          createdAt
        }
      })
      user = { _id: result._id, username: 'admin001', role: 'admin', nickname: '调试管理员', avatarUrl: '', createdAt }
    }

    await db.collection('users').doc(user._id).update({
      data: { openid: openId, role: 'admin', lastLoginAt: Date.now(), debugBoundAt: Date.now() }
    })
    const boundUser = { ...user, openid: openId, role: 'admin' }
    setBoundAccountCache(user._id, openId, boundUser)
    debugAccountCache.set(openId, { account: boundUser, expiresAt: Date.now() + BOUND_ACCOUNT_CACHE_TTL })
    return boundUser
  })().finally(() => debugAccountInflight.delete(openId))

  debugAccountInflight.set(openId, request)
  return request
}

async function userLogin({ username, password, role, openId }) {
  try {
    if (!username || !password || !role) {
      return { error: 'missing_params', message: '请填写完整信息' }
    }

    const userRes = await db.collection('users').where({ username }).get()

    if (!userRes.data || userRes.data.length === 0) {
      return { error: 'user_not_found', message: '用户不存在' }
    }

    const user = userRes.data[0]

    if (!verifyPassword(user, password)) {
      return { error: 'wrong_password', message: '密码错误' }
    }

    if (user.role !== role) {
      return { error: 'wrong_role', message: '身份选择错误' }
    }

    if (openId || !user.passwordHash) {
      const updateData = { lastLoginAt: Date.now() }
      if (openId) updateData.openid = openId
      if (!user.passwordHash) Object.assign(updateData, hashPassword(password), { password: _.remove() })
      await db.collection('users').doc(user._id).update({
        data: updateData
      })
    }

    if (openId) setBoundAccountCache(user._id, openId, { ...user, openid: openId })

    return {
      ok: true,
      user: {
        userId: user._id,
        username: user.username,
        nickname: user.nickname,
        role: user.role,
        avatarUrl: user.avatarUrl,
        createdAt: user.createdAt
      }
    }
  } catch (error) {
    console.error('登录失败:', error)
    return { error: 'login_failed', message: '登录失败，请重试' }
  }
}

async function userRegister({ username, nickname, password, idCardLast4 }) {
  try {
    const normalizedUsername = String(username || '').trim()
    const normalizedNickname = String(nickname || '').trim().slice(0, 24)
    const normalizedPassword = String(password || '')
    const normalizedIdCardLast4 = String(idCardLast4 || '').trim()

    if (!/^\d{4,20}$/.test(normalizedUsername)) {
      return { error: 'invalid_username', message: '学生账号ID需为 4 至 20 位数字' }
    }
    if (!normalizedNickname) {
      return { error: 'invalid_nickname', message: '请填写昵称' }
    }
    if (normalizedPassword.length < 6 || normalizedPassword.length > 64) {
      return { error: 'invalid_password', message: '密码长度需为 6 至 64 位' }
    }
    if (!/^\d{4}$/.test(normalizedIdCardLast4)) {
      return { error: 'invalid_id_card', message: '请输入身份证后四位数字' }
    }
    
    const existRes = await db.collection('users').where({ username: normalizedUsername }).get()
    if (existRes.data && existRes.data.length > 0) {
      return { error: 'user_exists', message: '用户名已存在' }
    }

    const newUser = {
      username: normalizedUsername,
      ...hashPassword(normalizedPassword),
      role: 'student',
      nickname: normalizedNickname,
      idCardLast4: normalizedIdCardLast4,
      avatarUrl: '',
      createdAt: Date.now(),
      isActive: true
    }

    const result = await db.collection('users').add({ data: newUser })

    return {
      ok: true,
      message: '注册成功',
      userId: result._id
    }
  } catch (error) {
    console.error('注册失败:', error)
    return { error: 'register_failed', message: '注册失败，请重试' }
  }
}

async function resetPassword({ username, idCardLast4, newPassword }) {
  try {
    if (!username || !idCardLast4 || !newPassword) {
      return { error: 'missing_params', message: '请填写完整信息' }
    }

    const userRes = await db.collection('users').where({ username }).get()
    if (!userRes.data || userRes.data.length === 0) {
      return { error: 'user_not_found', message: '用户不存在' }
    }

    const user = userRes.data[0]

    if (user.role === 'admin') {
      return { error: 'admin_reset_disabled', message: '管理员密码不支持在小程序内重置，请联系平台运维人员处理' }
    }

    if (user.idCardLast4 !== idCardLast4) {
      return { error: 'wrong_id_card', message: '身份证后四位错误' }
    }

    await db.collection('users').doc(user._id).update({
      data: { ...hashPassword(newPassword), password: _.remove(), updatedAt: Date.now() }
    })

    return { ok: true, message: '密码重置成功' }
  } catch (error) {
    console.error('重置密码失败:', error)
    return { error: 'reset_failed', message: '重置密码失败，请重试' }
  }
}

async function getUserInfo({ userId }) {
  try {
    const userRes = await db.collection('users').doc(userId).get()
    if (!userRes.data) {
      return { error: 'user_not_found' }
    }

    const user = userRes.data
    return {
      ok: true,
      user: {
        userId: user._id,
        username: user.username,
        nickname: user.nickname,
        role: user.role,
        avatarUrl: user.avatarUrl,
        createdAt: user.createdAt
      }
    }
  } catch (error) {
    console.error('获取用户信息失败:', error)
    return { error: 'get_user_failed' }
  }
}

async function initDefaultUser() {
  return { ok: false, error: 'default_user_disabled', message: '固定默认账号已禁用，请通过注册或管理员授权创建用户' }
}

async function handleAIChat({ openId, query, appUserId, conversationId = '', requestId, imageFileIds = [], imageUrls = [] }) {
  const normalizedQuery = String(query || '').trim().slice(0, 500)
  const safeImageFileIds = sanitizeImageFileIds(imageFileIds)
  const resolvedImageUrls = await resolveImageUrls(safeImageFileIds, imageUrls)
  if (!normalizedQuery && !resolvedImageUrls.length) return { code: 400, message: '请输入问题或上传图片' }
  const account = await getBoundAccount(appUserId, openId)
  const isLoggedIn = !!account
  const effectiveUserId = isLoggedIn ? appUserId : openId
  const safeRequestId = String(requestId || crypto.randomBytes(8).toString('hex')).slice(0, 64)

  let guestUsage = null
  if (!isLoggedIn) {
    guestUsage = await reserveGuestAIUsage(openId, safeRequestId)
    if (!guestUsage.allowed) {
      return { code: 403, message: 'guest_limit_reached', data: { limit: 3, used: guestUsage.count } }
    }
  }

  const activeConversationId = String(conversationId || 'default').slice(0, 80)
  const historyResult = await listAIMessages({ userId: openId, appUserId: effectiveUserId, conversationId: activeConversationId, pageSize: 12 })
  const history = (historyResult.messages || []).map(item => ({ role: item.role, content: item.content }))

  const result = await callRagFunction({
    query: normalizedQuery || '请描述这张图片，并结合校园场景告诉我它可能与什么业务有关。',
    imageUrls: resolvedImageUrls,
    history,
    userContext: { isLoggedIn, role: account?.role || 'guest' },
    traceId: safeRequestId
  })
  if (result?.data?.answer) {
    await saveAIMessage({
      userId: openId,
      appUserId: effectiveUserId,
      conversationId: activeConversationId,
      requestId: safeRequestId,
      message: { role: 'user', content: normalizedQuery, imageFileIds: safeImageFileIds }
    })
    await saveAIMessage({
      userId: openId,
      appUserId: effectiveUserId,
      conversationId: activeConversationId,
      requestId: safeRequestId,
      message: { role: 'assistant', content: result.data.answer, links: result.data.links || [] },
      meta: result.data.meta || {}
    })
    try {
      await db.collection('ai_runs').add({ data: {
        userId: effectiveUserId,
        conversationId: activeConversationId,
        requestId: safeRequestId,
        route: result.data.meta?.route || '',
        intent: result.data.meta?.intent || '',
        reviewStatus: result.data.meta?.reviewStatus || '',
        evidenceCount: result.data.meta?.evidenceCount || 0,
        createdAt: Date.now()
      } })
    } catch (error) {
      console.warn('AI运行审计保存失败:', error.message)
    }
  } else if (!isLoggedIn && guestUsage?.reserved) {
    await releaseGuestAIUsage(openId, safeRequestId)
  }
  return result
}

function sanitizeImageFileIds(fileIds) {
  if (!Array.isArray(fileIds)) return []
  return fileIds
    .filter(value => typeof value === 'string' && value.startsWith('cloud://'))
    .map(value => value.trim())
    .slice(0, 4)
}

async function resolveImageUrls(fileIds, imageUrls) {
  const directUrls = Array.isArray(imageUrls)
    ? imageUrls.filter(value => typeof value === 'string' && value.startsWith('https://')).slice(0, 4)
    : []
  if (!fileIds.length) return directUrls
  try {
    const result = await cloud.getTempFileURL({ fileList: fileIds })
    const cloudUrls = (result.fileList || [])
      .filter(item => item.status === 0 && typeof item.tempFileURL === 'string')
      .map(item => item.tempFileURL)
    return directUrls.concat(cloudUrls).slice(0, 4)
  } catch (error) {
    console.warn('解析图片临时地址失败:', error.message)
    return directUrls
  }
}

async function callRagFunction({ action = 'chat', query, history = [], userContext = {}, traceId = '', imageUrls = [] }) {
  try {
    const internalToken = String(process.env.RAG_INTERNAL_TOKEN || '').trim()
    if (!internalToken) {
      console.error('RAG_CONFIG_ERROR', { traceId, reason: 'RAG_INTERNAL_TOKEN_MISSING' })
      return { code: 503, message: 'RAG_INTERNAL_TOKEN_MISSING' }
    }
    console.log('调用RAG云函数:', {
      action,
      traceId,
      historyCount: history.length,
      tokenLength: internalToken.length,
      tokenFingerprint: tokenFingerprint(internalToken)
    })
    try {
      const result = await cloud.callFunction({
        name: 'rag',
        data: { action, query, history, userContext, traceId, imageUrls, protocolVersion: RAG_PROTOCOL_VERSION, internalToken }
      })
      const payload = result?.result
      const isValidEnvelope = payload && typeof payload === 'object' && Number.isInteger(payload.code) && typeof payload.message === 'string'
      if (!isValidEnvelope) {
        console.error('RAG_INVALID_RESPONSE', {
          traceId,
          responseType: typeof payload,
          responseKeys: payload && typeof payload === 'object' ? Object.keys(payload).filter(key => key !== 'internalToken') : []
        })
        return { code: 503, message: 'RAG_DEPLOYMENT_OUTDATED' }
      }

      if (payload.code === 200) {
        if (action === 'health') {
          const health = payload.data
          if (!health || health.protocolVersion !== RAG_PROTOCOL_VERSION || health.deploymentVersion !== RAG_DEPLOYMENT_VERSION) {
            console.error('RAG_HEALTH_VERSION_MISMATCH', {
              traceId,
              protocolVersion: health?.protocolVersion || '',
              deploymentVersion: health?.deploymentVersion || ''
            })
            return { code: 503, message: 'RAG_DEPLOYMENT_OUTDATED' }
          }
          return { code: 200, message: 'success', data: health }
        }

        if (!payload.data || typeof payload.data.answer !== 'string') {
          console.error('RAG_INVALID_SUCCESS_RESPONSE', { traceId })
          return { code: 503, message: 'RAG_DEPLOYMENT_OUTDATED' }
        }
        const responseMeta = payload.data.meta && typeof payload.data.meta === 'object' ? payload.data.meta : {}
        if (responseMeta.protocolVersion !== RAG_PROTOCOL_VERSION || responseMeta.deploymentVersion !== RAG_DEPLOYMENT_VERSION) {
          console.error('RAG_CHAT_VERSION_MISMATCH', {
            traceId,
            protocolVersion: responseMeta.protocolVersion || '',
            deploymentVersion: responseMeta.deploymentVersion || ''
          })
          return { code: 503, message: 'RAG_DEPLOYMENT_OUTDATED' }
        }
        return {
          code: 200,
          message: 'success',
          data: {
            answer: payload.data.answer,
            links: Array.isArray(payload.data.links) ? payload.data.links.slice(0, 8) : [],
            meta: responseMeta
          }
        }
      }

      return {
        code: Math.max(400, Math.min(Number(payload.code) || 500, 599)),
        message: String(payload.message || 'RAG服务调用失败').slice(0, 80),
        hint: payload.message === 'RAG_INTERNAL_ACCESS_DENIED'
          ? 'api 与 rag 云函数的 RAG_INTERNAL_TOKEN 不一致，请在同一云环境中配置完全相同的值并重新部署两个云函数。'
          : '',
        data: payload.data && typeof payload.data === 'object'
          ? { answer: String(payload.data.answer || '').slice(0, 8000), links: [] }
          : undefined
      }
    } catch (error) {
      console.error('调用RAG云函数失败:', error)
      const rawMessage = String(error?.message || error || '')
      const isExecutionFailure = /-504002|FUNCTIONS_EXECUTE_FAIL/i.test(rawMessage)
      return {
        code: 500,
        message: isExecutionFailure ? 'RAG_FUNCTION_EXECUTE_FAIL' : 'RAG服务调用失败',
        error: rawMessage,
        hint: isExecutionFailure ? '请检查rag云函数运行时、依赖安装、环境变量和云端日志' : ''
      }
    }
  } catch (error) {
    console.error('调用RAG云函数失败:', error)
    return {
      code: 500,
      message: 'RAG服务调用失败',
      error: error.message
    }
  }
}

function tokenFingerprint(token) {
  if (!token) return ''
  return crypto.createHash('sha256').update(token).digest('hex').slice(0, 12)
}

// 触发爬虫运行
async function runCrawler({ sourceGroup = 'all', days = 0 } = {}) {
  try {
    const internalToken = String(process.env.CRAWLER_INTERNAL_TOKEN || '').trim()
    console.log('调用crawler云函数', {
      sourceGroup,
      days,
      tokenConfigured: !!internalToken,
      tokenLength: internalToken.length,
      tokenFingerprint: tokenFingerprint(internalToken)
    })
    const result = await cloud.callFunction({
      name: 'crawler',
      data: {
        action: 'crawl',
        sourceGroup: String(sourceGroup || 'all'),
        days: Math.min(Math.max(Number(days || 0), 0), 90),
        internalToken
      }
    })
    const payload = result?.result || {}
    if (payload.code === 403 && payload.message === 'CRAWLER_INTERNAL_ACCESS_DENIED') {
      console.error('CRAWLER_INTERNAL_ACCESS_DENIED', {
        apiTokenFingerprint: tokenFingerprint(internalToken),
        apiTokenLength: internalToken.length,
        hint: 'api 与 crawler 云函数必须配置同一 CRAWLER_INTERNAL_TOKEN，并重新部署'
      })
      return {
        code: 403,
        message: '采集器内部鉴权失败，请在 api 与 crawler 配置完全相同的 CRAWLER_INTERNAL_TOKEN 后重新部署'
      }
    }
    return payload
  } catch (error) {
    console.error('触发爬虫失败:', error)
    return { code: 500, message: '爬虫触发失败', error: error.message }
  }
}

// 获取爬虫状态
async function getCrawlerStatus() {
  try {
    const internalToken = String(process.env.CRAWLER_INTERNAL_TOKEN || '').trim()
    const result = await cloud.callFunction({
      name: 'crawler',
      data: { action: 'status', internalToken }
    })
    const payload = result?.result || {}
    if (payload.code === 403 && payload.message === 'CRAWLER_INTERNAL_ACCESS_DENIED') {
      console.error('CRAWLER_STATUS_ACCESS_DENIED', {
        apiTokenFingerprint: tokenFingerprint(internalToken),
        apiTokenLength: internalToken.length,
        hint: 'api 与 crawler 云函数必须配置同一 CRAWLER_INTERNAL_TOKEN，并重新部署'
      })
      return {
        code: 403,
        message: '采集器鉴权未配置或不一致，请检查 api/crawler 的 CRAWLER_INTERNAL_TOKEN'
      }
    }
    return payload
  } catch (error) {
    console.error('获取爬虫状态失败:', error)
    return { code: 500, message: '获取状态失败', error: error.message }
  }
}

function formatTime(timestamp) {
  const now = Date.now()
  const diff = now - timestamp
  
  if (diff < 60000) return '刚刚'
  if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`
  if (diff < 604800000) return `${Math.floor(diff / 86400000)}天前`
  
  const date = new Date(timestamp)
  return `${date.getMonth() + 1}月${date.getDate()}日`
}
