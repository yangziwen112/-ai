Page({
  data: {
  },

  goToPrivacySettings() {
    wx.navigateTo({
      url: '/pages/profile/settings/privacy/index'
    })
  },

  goToProfileSettings() {
    wx.navigateTo({
      url: '/pages/profile/settings/profile/index'
    })
  }
})
