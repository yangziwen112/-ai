const USER_KEY = 'userInfo'
const LOGIN_STATUS_KEY = 'isLoggedIn'

// 获取用户信息
export function getUser() {
  try {
    return wx.getStorageSync(USER_KEY) || null
  } catch (_) { 
    return null 
  }
}

// 判断是否已登录（新版）
export function isLoggedIn() {
  try {
    const isLogged = wx.getStorageSync(LOGIN_STATUS_KEY)
    const user = getUser()
    return !!(isLogged && user && user.userId)
  } catch (_) {
    return false
  }
}

// 统一的游客登录引导。公共资讯可以直接浏览，只有个性化操作才调用此方法。
export function promptLogin(options = {}) {
  const {
    title = '登录后使用',
    content = '登录后可使用收藏、订阅、发布和私信等个性化功能。',
    redirect = ''
  } = options

  if (isLoggedIn()) return Promise.resolve(true)

  return new Promise((resolve) => {
    wx.showModal({
      title,
      content,
      confirmText: '去登录',
      cancelText: '继续浏览',
      confirmColor: '#2563EB',
      success: (res) => {
        if (!res.confirm) {
          resolve(false)
          return
        }

        const target = redirect ? `?redirect=${encodeURIComponent(redirect)}` : ''
        wx.navigateTo({
          url: `/pages/auth-login/index${target}`,
          fail: () => wx.reLaunch({ url: `/pages/auth-login/index${target}` })
        })
        resolve(true)
      },
      fail: () => resolve(false)
    })
  })
}

// 确保用户已登录，否则跳转登录页
export async function ensureLogin() {
  if (isLoggedIn()) {
    return getUser()
  }
  
  const pages = getCurrentPages()
  const current = pages[pages.length - 1]
  const path = `/${current.route}`
  const query = Object.entries(current.options || {}).map(([k,v])=>`${k}=${encodeURIComponent(v)}`).join('&')
  const redirect = query ? `${path}?${query}` : path
  
  wx.reLaunch({ 
    url: `/pages/auth-login/index?redirect=${encodeURIComponent(redirect)}` 
  })
  throw new Error('NEED_LOGIN')
}

// 保存用户信息
export function saveUser(user) {
  wx.setStorageSync(USER_KEY, user)
  wx.setStorageSync(LOGIN_STATUS_KEY, true)
  const app = getApp()
  if (app) {
    app.globalData.user = user
  }
}

// 清除用户信息（退出登录）
export function clearUser() {
  wx.removeStorageSync(USER_KEY)
  wx.removeStorageSync(LOGIN_STATUS_KEY)
  const app = getApp()
  if (app) {
    app.globalData.user = null
  }
}

// 获取用户ID
export function getUserId() {
  const user = getUser()
  return user ? user.userId : null
}

// 判断是否是管理员
export function isAdmin() {
  try {
    const user = getUser()
    return !!(user && user.role === 'admin')
  } catch (_) {
    return false
  }
}

// 获取用户角色
export function getUserRole() {
  const user = getUser()
  return user ? user.role : null
}

export function waitForAuthReady() {
  try {
    const app = getApp()
    return app?.waitForAuthReady ? app.waitForAuthReady() : Promise.resolve(getUser())
  } catch (_) {
    return Promise.resolve(getUser())
  }
}
