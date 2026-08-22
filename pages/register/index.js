import { callApi, toast } from '../../utils/request'

Page({
  data: {
    username: '',
    nickname: '',
    password: '',
    confirmPassword: '',
    idCardLast4: '',
    showPassword: false,
    canSubmit: false,
    isLoading: false
  },

  onUsernameInput(e) {
    const username = e.detail.value.replace(/\D/g, '').slice(0, 20)
    this.setData({ username }, this.checkCanSubmit)
  },

  onNicknameInput(e) {
    const nickname = e.detail.value.trim()
    this.setData({ nickname }, this.checkCanSubmit)
  },

  onPasswordInput(e) {
    const password = e.detail.value.trim()
    this.setData({ password }, this.checkCanSubmit)
  },

  onConfirmPasswordInput(e) {
    const confirmPassword = e.detail.value.trim()
    this.setData({ confirmPassword }, this.checkCanSubmit)
  },

  onIdCardInput(e) {
    const idCardLast4 = e.detail.value.trim()
    this.setData({ idCardLast4 }, this.checkCanSubmit)
  },

  togglePassword() {
    this.setData({ showPassword: !this.data.showPassword })
  },

  checkCanSubmit() {
    const { username, nickname, password, confirmPassword, idCardLast4 } = this.data
    const canSubmit = username.length >= 4 &&
                     nickname.length > 0 &&
                     password.length >= 6 && 
                     confirmPassword.length >= 6 &&
                     idCardLast4.length === 4
    this.setData({ canSubmit })
  },

  async onRegister() {
    if (!this.data.canSubmit || this.data.isLoading) return

    const { username, nickname, password, confirmPassword, idCardLast4 } = this.data

    // 验证两次密码
    if (password !== confirmPassword) {
      wx.showModal({
        title: '提示',
        content: '两次输入的密码不一致',
        showCancel: false,
        confirmColor: '#667eea'
      })
      return
    }

    // 验证密码长度
    if (password.length < 6) {
      wx.showModal({
        title: '提示',
        content: '密码长度不能少于6位',
        showCancel: false,
        confirmColor: '#667eea'
      })
      return
    }

    this.setData({ isLoading: true })
    wx.showLoading({ title: '注册中...' })

    try {
      const result = await callApi('auth/register', {
        username,
        nickname,
        password,
        idCardLast4
      })

      wx.hideLoading()
      this.setData({ isLoading: false })

      if (result.error) {
        wx.showModal({
          title: '注册失败',
          content: result.message || '注册失败，请重试',
          showCancel: false,
          confirmColor: '#667eea'
        })
        return
      }

      if (result.ok) {
        wx.showModal({
          title: '注册成功',
          content: '注册成功！请使用账号密码登录',
          showCancel: false,
          confirmColor: '#667eea',
          success: () => {
            wx.navigateBack()
          }
        })
      }
    } catch (error) {
      wx.hideLoading()
      this.setData({ isLoading: false })
      console.error('注册错误:', error)
      wx.showModal({
        title: '注册失败',
        content: '网络错误，请重试',
        showCancel: false,
        confirmColor: '#667eea'
      })
    }
  },

  backToLogin() {
    wx.navigateBack()
  }
})

