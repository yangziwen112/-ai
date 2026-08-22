import { callApi, toast } from '../../utils/request'
import { isLoggedIn, promptLogin, waitForAuthReady } from '../../utils/auth'

Page({
  data: {
    loading: false,
    isLoggedIn: false,
    messages: []
  },

  async onLoad() {
    await waitForAuthReady()
    this.refreshPage(true)
  },

  async onShow() {
    await waitForAuthReady()
    this.refreshPage(false)
  },

  refreshPage(force = false) {
    const loggedIn = isLoggedIn()
    this.setData({ isLoggedIn: loggedIn })
    if (!loggedIn) {
      this.setData({ loading: false, messages: [] })
      return
    }
    if (force || !this.data.messages.length) this.loadMessages()
  },

  async loadMessages() {
    if (this.data.loading) return
    this.setData({ loading: true })
    try {
      const res = await callApi('messages/list')
      this.setData({ messages: res.code === 200 ? (res.data || []) : [], loading: false })
      if (res.code !== 200) toast(res.message || '消息加载失败')
    } catch (error) {
      console.error('加载消息失败:', error)
      this.setData({ loading: false })
      toast('消息加载失败')
    }
  },

  async goToLogin() {
    await promptLogin({
      title: '登录后查看消息',
      content: '私信、好友和消息记录属于个人内容。登录后即可查看并继续聊天。',
      redirect: '/pages/messages/index'
    })
  },

  goToAssistant() {
    wx.switchTab({ url: '/pages/chat/index' })
  },

  navigateToChat(e) {
    const { userId, userName } = e.currentTarget.dataset
    wx.navigateTo({
      url: `/pages/messages/chat?userId=${userId}&userName=${encodeURIComponent(userName)}`
    })
  }
})
