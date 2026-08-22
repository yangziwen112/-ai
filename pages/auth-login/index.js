import { callApi, toast } from '../../utils/request'

Page({
  data: {
    username: '',
    password: '',
    role: 'student',
    showPassword: false,
    canSubmit: false,
    isLoading: false,
    redirect: ''
  },

  onLoad(options) {
    const redirect = options.redirect ? decodeURIComponent(options.redirect) : ''
    this.setData({ redirect })
    // 检查是否已登录
    const userInfo = wx.getStorageSync('userInfo')
    if (userInfo && userInfo.userId) {
      this.goAfterLogin()
    }
  },

  // 输入账号
  onUsernameInput(e) {
    const username = e.detail.value.trim()
    this.setData({ username }, this.checkCanSubmit)
  },

  // 输入密码
  onPasswordInput(e) {
    const password = e.detail.value.trim()
    this.setData({ password }, this.checkCanSubmit)
  },

  // 切换密码显示
  togglePassword() {
    this.setData({ showPassword: !this.data.showPassword })
  },

  // 选择身份
  selectRole(e) {
    const role = e.currentTarget.dataset.role
    this.setData({ role })
  },

  // 检查是否可以提交
  checkCanSubmit() {
    const { username, password, role } = this.data
    const canSubmit = username.length > 0 && password.length > 0 && role
    this.setData({ canSubmit })
  },

  // 登录
  async onLogin() {
    if (!this.data.canSubmit || this.data.isLoading) return

    const { username, password, role } = this.data

    this.setData({ isLoading: true })
    wx.showLoading({ title: '登录中...' })

    try {
      const result = await callApi('auth/login', {
        username,
        password,
        role
      })

      wx.hideLoading()
      this.setData({ isLoading: false })

      if (result.error) {
        wx.showModal({
          title: '登录失败',
          content: result.message || '登录失败，请重试',
          showCancel: false,
          confirmColor: '#667eea'
        })
        return
      }

      if (result.ok && result.user) {
        // 保存用户信息到本地
        wx.setStorageSync('userInfo', result.user)
        wx.setStorageSync('isLoggedIn', true)
        
        // 保存到全局
        const app = getApp()
        app.globalData.user = result.user

        toast('登录成功')

        // 延迟跳转，让用户看到成功提示
        setTimeout(() => this.goAfterLogin(), 500)
      }
    } catch (error) {
      wx.hideLoading()
      this.setData({ isLoading: false })
      console.error('登录错误:', error)
      wx.showModal({
        title: '登录失败',
        content: '网络错误，请重试',
        showCancel: false,
        confirmColor: '#667eea'
      })
    }
  },

  goAfterLogin() {
    const redirect = this.data.redirect
    const tabPages = [
      '/pages/home/index',
      '/pages/campus-wall/index',
      '/pages/chat/index',
      '/pages/messages/index',
      '/pages/profile/index'
    ]

    if (!redirect) {
      wx.switchTab({ url: '/pages/home/index' })
      return
    }

    const path = redirect.split('?')[0]
    if (tabPages.includes(path)) {
      wx.switchTab({ url: path })
    } else {
      wx.redirectTo({
        url: redirect,
        fail: () => wx.switchTab({ url: '/pages/home/index' })
      })
    }
  },

  // 注册
  onRegister() {
    wx.navigateTo({
      url: '/pages/register/index'
    })
  },

  // 忘记密码
  onForgotPassword() {
    wx.navigateTo({
      url: '/pages/reset-password/index'
    })
  }
})

