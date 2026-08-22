import { getUser, clearUser, isLoggedIn, promptLogin, waitForAuthReady } from '../../utils/auth'

Page({
  data: {
    user: {}
  },
  
  async onShow() {
    await waitForAuthReady()
    const user = getUser()
    this.setData({ user: user || {} })
  },
  
  onGoLogin() {
    wx.reLaunch({ url: '/pages/auth-login/index' })
  },
  
  onLogout() {
    wx.showModal({
      title: '确认退出',
      content: '确定要退出登录吗？',
      confirmColor: '#667eea',
      success: (res) => {
        if (res.confirm) {
          // 清除用户信息
          clearUser()
          
          wx.showToast({
            title: '已退出登录',
            icon: 'success'
          })
          
          // 跳转到登录页
          setTimeout(() => {
            wx.reLaunch({ url: '/pages/auth-login/index' })
          }, 1000)
        }
      }
    })
  },

  goToSettings() {
    wx.navigateTo({
      url: '/pages/profile/settings/index'
    })
  },

  goToAdmin() {
    wx.navigateTo({ url: '/pages/admin/index' })
  },

  async goToProtected(e) {
    const url = e.currentTarget.dataset.url
    const label = e.currentTarget.dataset.label || '该功能'
    if (!isLoggedIn()) {
      await promptLogin({ content: `登录后可以使用${label}，相关数据会同步保存在你的账号中。`, redirect: url })
      return
    }
    wx.navigateTo({ url })
  }
}) 
