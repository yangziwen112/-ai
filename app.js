// app.js
const { autoAdminLogin } = require('./utils/debug-config')
const PUBLIC_API_ROUTES = new Set([
  'meta/tags', 'meta/sources', 'meta/banners',
  'feed/recommend', 'feed/upcoming', 'content/list', 'content/detail',
  'campus/posts/list', 'campus/posts/detail', 'campus/comments/list',
  'campus/posts/search', 'user/getSettings'
])

function isDeveloperTools() {
  try {
    const info = wx.getDeviceInfo ? wx.getDeviceInfo() : wx.getSystemInfoSync()
    return String(info?.platform || '').toLowerCase() === 'devtools'
  } catch (_) {
    return false
  }
}

App({
  globalData: {
    envId: 'cloud1-9gkwb6acd2930e57',
    user: null
  },
  onLaunch() {
    this._apiInflight = new Map()
    this._apiCache = new Map()
    if (!wx.cloud) {
      console.error('请使用基础库 2.2.3 或以上以使用云能力')
    } else {
      // 确保在调用云函数之前初始化云开发
      try {
        wx.cloud.init({
          env: this.globalData.envId || wx.cloud.DYNAMIC_CURRENT_ENV,
          traceUser: true
        })
        // 提前触发数据库对象初始化，避免首次页面请求额外等待
        wx.cloud.database()
      } catch (error) {
        console.error('云开发初始化失败:', error)
        wx.showModal({
          title: '提示',
          content: '请先在微信开发者工具中开通云开发，并检查项目的云环境配置。',
          showCancel: false
        })
      }
    }
    this.hydrateStoredUser()
    this.seedLocalDebugUser()
    this.authReady = this.initializeDebugSession()
      .catch(error => {
        console.warn('调试账号自动登录失败:', error.message)
        return this.globalData.user
      })
  },
  hydrateStoredUser() {
    try {
      const user = wx.getStorageSync('userInfo') || null
      this.globalData.user = user
    } catch (_) {}
  },
  seedLocalDebugUser() {
    if (!isDeveloperTools() || !autoAdminLogin?.enabled || !autoAdminLogin.localUser) return
    const currentUser = this.globalData.user
    if (currentUser?.username === 'admin001' && currentUser?.role === 'admin' && currentUser?.userId) return
    const localUser = { ...autoAdminLogin.localUser }
    wx.setStorageSync('userInfo', localUser)
    wx.setStorageSync('isLoggedIn', true)
    this.globalData.user = localUser
  },
  async initializeDebugSession() {
    if (!isDeveloperTools() || !autoAdminLogin?.enabled) return this.globalData.user
    const cachedUser = this.globalData.user
    const sessionAt = Number(wx.getStorageSync('debugAdminSessionAt') || 0)
    const sessionFresh = cachedUser?.username === 'admin001'
      && cachedUser?.role === 'admin'
      && cachedUser?.cloudBound !== false
      && Date.now() - sessionAt < Number(autoAdminLogin.sessionTtlMs || 0)
    if (sessionFresh) return cachedUser

    const result = await this.rawCallApi('auth/debugAdminLogin', {})
    if (!result?.ok || !result.user) throw new Error(result?.message || 'admin001 自动登录失败')
    wx.setStorageSync('isLoggedIn', true)
    wx.setStorageSync('debugAdminSessionAt', Date.now())
    const boundUser = { ...result.user, cloudBound: true }
    wx.setStorageSync('userInfo', boundUser)
    this.globalData.user = boundUser
    return boundUser
  },
  clearDebugSession() {
    if (!isDeveloperTools() || !autoAdminLogin?.enabled) return
    wx.removeStorageSync('userInfo')
    wx.removeStorageSync('isLoggedIn')
    wx.removeStorageSync('debugAdminSessionAt')
    this.globalData.user = null
  },
  waitForAuthReady() {
    if (isDeveloperTools() && autoAdminLogin?.enabled && this.globalData.user?.username === 'admin001') {
      return Promise.resolve(this.globalData.user)
    }
    return this.authReady || Promise.resolve(this.globalData.user)
  },
  rawCallApi(route, data) {
    let appUserId = ''
    try {
      const storedUser = wx.getStorageSync('userInfo')
      const isUnboundLocalDebugUser = storedUser?.isDebugAccount && storedUser?.cloudBound === false
      appUserId = PUBLIC_API_ROUTES.has(route) && isUnboundLocalDebugUser
        ? ''
        : (storedUser?.userId || '')
    } catch (_) {}
    const payload = data || {}
    return wx.cloud.callFunction({
      name: 'api',
      data: { route, data: { ...payload, ...(appUserId && !payload.appUserId ? { appUserId } : {}) } }
    }).then(res => {
      if (!res || !res.result) {
        throw new Error('云函数调用失败：无返回结果')
      }
      return res.result
    }).catch((err) => {
      console.warn('云函数调用失败', route, err)
      throw err
    })
  },
  async callApi(route, data) {
    if (!route.startsWith('auth/') && !PUBLIC_API_ROUTES.has(route)) await this.waitForAuthReady()
    const payload = data || {}
    const cacheable = ['meta/tags', 'meta/sources', 'meta/banners'].includes(route)
    const cacheKey = cacheable ? `${route}:${JSON.stringify(payload)}` : ''
    if (cacheable) {
      const cached = this._apiCache.get(cacheKey)
      if (cached && Date.now() - cached.time < 5 * 60 * 1000) return cached.value
      if (this._apiInflight.has(cacheKey)) return this._apiInflight.get(cacheKey)
    }
    const request = this.rawCallApi(route, payload).then(result => {
      if (cacheable) this._apiCache.set(cacheKey, { value: result, time: Date.now() })
      return result
    }).finally(() => cacheable && this._apiInflight.delete(cacheKey))
    if (cacheable) this._apiInflight.set(cacheKey, request)
    return request
  },
  // 获取用户信息
  getUser() {
    return this.globalData.user
  },
  // 设置用户信息
  setUser(user) {
    this.globalData.user = user
  },
  // 清除用户信息
  clearUser() {
    this.globalData.user = null
  }
})
