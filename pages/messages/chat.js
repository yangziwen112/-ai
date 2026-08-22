import { callApi, toast } from '../../utils/request'
import { isLoggedIn, getUserId, promptLogin } from '../../utils/auth'

Page({
  data: {
    userId: '',
    userName: '',
    inputValue: '',
    messages: [],
    loading: false,
    showEmojiPanel: false,
    emojis: [
      '😊', '😂', '❤️', '👍', '👎', '👋', '🎉', '🔥',
      '🤔', '😢', '😡', '😍', '🤩', '😎', '🤗', '🤫',
      '🤭', '🤮', '🤠', '🤢', '🤬', '🤧', '🥳', '🤯'
    ]
  },

  async onLoad(options) {
    if (!isLoggedIn()) {
      const goingLogin = await promptLogin({ content: '登录后可以查看私信和好友聊天记录。' })
      if (!goingLogin) wx.navigateBack()
      return
    }
    this.setData({
      userId: options.userId,
      userName: decodeURIComponent(options.userName)
    })
    this.loadMessages()
  },

  async loadMessages() {
    this.setData({ loading: true })
    
    try {
      const res = await callApi('messages/getChat', {
        targetUserId: this.data.userId
      })

      
      if (res.code === 200) {
        this.setData({
          messages: res.data || [],
          loading: false
        })
        this.scrollToBottom()
      } else {
        console.error('加载消息失败:', res.message)
        toast('加载消息失败')
        this.setData({ loading: false })
      }
    } catch (error) {
      console.error('加载消息失败:', error)
      toast('加载消息失败')
      this.setData({ loading: false })
    }
  },

  onInputChange(e) {
    this.setData({ inputValue: e.detail.value })
  },

  async sendMessage() {
    const content = this.data.inputValue.trim()
    if (!content) return

    // 私信自我检测
    const currentUserId = getUserId() || ''
    if (this.data.userId === currentUserId) {
      toast('不能给自己发送消息')
      return
    }

    try {
      const res = await callApi('messages/send', {
        targetUserId: this.data.userId,
        content: content
      })

      
      if (res.code === 200) {
        this.setData({ inputValue: '' })
        this.loadMessages()
      } else {
        console.error('发送消息失败:', res.message)
        toast('发送失败')
      }
    } catch (error) {
      console.error('发送消息失败:', error)
      toast('发送失败')
    }
  },

  scrollToBottom() {
    setTimeout(() => {
      const query = wx.createSelectorQuery()
      query.select('.chat-content').boundingClientRect()
      query.select('.chat-content').scrollOffset()
      query.exec((res) => {
        if (res && res[0] && res[1]) {
          wx.pageScrollTo({
            scrollTop: res[1].scrollHeight,
            duration: 300
          })
        }
      })
    }, 100)
  },

  navigateBack() {
    wx.navigateBack()
  },

  showUserInfo(e) {
    const { userId, userName } = e.currentTarget.dataset
    wx.showModal({
      title: userName || '用户信息',
      content: `用户ID: ${userId}\n用户名称: ${userName || '未知'}`,
      confirmText: '添加好友',
      cancelText: '查看空间',
      success: (res) => {
        if (res.confirm) {
          // 调用添加好友的方法
          wx.showToast({ title: '添加好友功能待实现', icon: 'none' })
        } else if (res.cancel) {
          // 跳转到对方空间页面，这里可以根据实际情况调整
          wx.showToast({ title: '查看空间功能待实现', icon: 'none' })
        }
      }
    })
  },

  loadMoreMessages() {
  },

  toggleEmojiPanel() {
    this.setData({ showEmojiPanel: !this.data.showEmojiPanel })
  },

  selectEmoji(e) {
    const emoji = e.currentTarget.dataset.emoji
    const inputValue = this.data.inputValue + emoji
    this.setData({ inputValue })
  }
})
