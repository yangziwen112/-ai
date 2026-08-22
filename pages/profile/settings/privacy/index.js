import { callApi, toast } from '../../../../utils/request'
import { getUserId } from '../../../../utils/auth'

Page({
  data: {
    allowStrangerMessages: true
  },

  onLoad() {
    this.loadPrivacySettings()
  },

  async loadPrivacySettings() {
    const userId = getUserId()
    if (!userId) {
      toast('请先登录')
      return
    }

    try {
      const res = await callApi('user/getSettings', { userId })
      if (res.data) {
        this.setData({
          allowStrangerMessages: res.data.allowStrangerMessages !== false
        })
      }
    } catch (error) {
      console.error('加载隐私设置失败:', error)
    }
  },

  async onAllowStrangerMessagesChange(e) {
    const allowStrangerMessages = e.detail.value
    const userId = getUserId()
    
    if (!userId) {
      toast('请先登录')
      this.setData({ allowStrangerMessages: true })
      return
    }

    try {
      const res = await callApi('user/updateSettings', {
        userId,
        allowStrangerMessages
      })
      
      if (res.ok) {
        this.setData({ allowStrangerMessages })
        toast(allowStrangerMessages ? '已开启陌生人私信' : '已关闭陌生人私信')
      } else {
        toast('设置失败，请重试')
        this.setData({ allowStrangerMessages: !allowStrangerMessages })
      }
    } catch (error) {
      console.error('更新隐私设置失败:', error)
      toast('设置失败，请重试')
      this.setData({ allowStrangerMessages: !allowStrangerMessages })
    }
  }
})