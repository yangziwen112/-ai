import { callApi, toast } from '../../utils/request'

Page({
  data: {
    username: '',
    idCardLast4: '',
    newPassword: '',
    confirmPassword: '',
    showPassword: false,
    canSubmit: false,
    isLoading: false
  },

  onUsernameInput(e) {
    const username = e.detail.value.trim()
    this.setData({ username }, this.checkCanSubmit)
  },

  onIdCardInput(e) {
    const idCardLast4 = e.detail.value.trim()
    this.setData({ idCardLast4 }, this.checkCanSubmit)
  },

  onPasswordInput(e) {
    const newPassword = e.detail.value.trim()
    this.setData({ newPassword }, this.checkCanSubmit)
  },

  onConfirmPasswordInput(e) {
    const confirmPassword = e.detail.value.trim()
    this.setData({ confirmPassword }, this.checkCanSubmit)
  },

  togglePassword() {
    this.setData({ showPassword: !this.data.showPassword })
  },

  checkCanSubmit() {
    const { username, idCardLast4, newPassword, confirmPassword } = this.data
    const canSubmit = username.length > 0 && 
                     idCardLast4.length === 4 && 
                     newPassword.length > 0 && 
                     confirmPassword.length > 0
    this.setData({ canSubmit })
  },

  async onSubmit() {
    if (!this.data.canSubmit || this.data.isLoading) return

    const { username, idCardLast4, newPassword, confirmPassword } = this.data

    // 验证两次密码是否一致
    if (newPassword !== confirmPassword) {
      wx.showModal({
        title: '提示',
        content: '两次输入的密码不一致',
        showCancel: false,
        confirmColor: '#667eea'
      })
      return
    }

    this.setData({ isLoading: true })
    wx.showLoading({ title: '处理中...' })

    try {
      const result = await callApi('auth/resetPassword', {
        username,
        idCardLast4,
        newPassword
      })

      wx.hideLoading()
      this.setData({ isLoading: false })

      if (result.error) {
        wx.showModal({
          title: '重置失败',
          content: result.message || '重置失败，请重试',
          showCancel: false,
          confirmColor: '#667eea'
        })
        return
      }

      if (result.ok) {
        wx.showModal({
          title: '重置成功',
          content: '密码重置成功，请使用新密码登录',
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
      console.error('重置密码错误:', error)
      wx.showModal({
        title: '重置失败',
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

