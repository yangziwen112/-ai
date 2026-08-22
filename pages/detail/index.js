import { callApi, toast } from '../../utils/request'
import favoriteManager from '../../utils/favoriteManager'
import { isLoggedIn, promptLogin } from '../../utils/auth'

Page({
  data: {
    id: '',
    detail: {},
    viewStartTime: 0,
    loading: true,
    error: false,
    historyRecorded: false
  },

  onLoad(query) {
    const id = query.id || ''
    this.setData({ id, viewStartTime: Date.now() })
    this.loadDetail()
  },

  onShow() {
    if (!this.data.id || this.data.loading) return
    const favored = favoriteManager.getFavoriteStatus(this.data.id)
    if (favored !== this.data.detail.favored) {
      this.setData({ detail: { ...this.data.detail, favored } })
    }
  },

  onUnload() {
    this.recordViewHistory()
  },

  async loadDetail() {
    if (!this.data.id) {
      this.setData({ loading: false, error: true })
      return
    }

    this.setData({ loading: true, error: false })
    try {
      const loggedIn = isLoggedIn()
      const [res, favRes] = await Promise.all([
        callApi('content/detail', { id: this.data.id }),
        loggedIn ? callApi('favorites/list', { pageSize: 100 }) : Promise.resolve({ list: [] })
      ])
      const detail = res.detail || {}
      if (!detail._id && !detail.title) throw new Error('内容不存在')

      if (loggedIn) {
        detail.favored = (favRes.list || []).some(item => item._id === this.data.id)
      } else {
        detail.favored = false
      }
      favoriteManager.setFavoriteStatus(this.data.id, detail.favored)
      wx.setNavigationBarTitle({ title: detail.categoryText || '资讯详情' })
      this.setData({ detail, loading: false })
    } catch (error) {
      console.error('加载详情失败:', error)
      this.setData({ loading: false, error: true })
    }
  },

  async recordViewHistory() {
    if (this.data.historyRecorded || !isLoggedIn() || !this.data.id) return
    this.setData({ historyRecorded: true })
    try {
      await callApi('history/record', {
        contentId: this.data.id,
        duration: Math.max(0, Date.now() - this.data.viewStartTime)
      })
    } catch (error) {
      console.warn('浏览历史记录失败:', error)
    }
  },

  async onToggleFavorite() {
    if (!isLoggedIn()) {
      await promptLogin({
        content: '登录后可以收藏这条资讯，并同步到你的个人收藏。',
        redirect: `/pages/detail/index?id=${this.data.id}`
      })
      return
    }

    try {
      await callApi('user/favorite/toggle', { contentId: this.data.id })
      const favored = !this.data.detail.favored
      favoriteManager.setFavoriteStatus(this.data.id, favored)
      this.setData({ detail: { ...this.data.detail, favored } })
      toast(favored ? '已收藏' : '已取消收藏')
    } catch (error) {
      toast('操作失败，请重试')
    }
  },

  onCopySource() {
    const url = this.data.detail.sourceUrl || this.data.detail.linkUrl
    if (!url) return
    wx.setClipboardData({
      data: url,
      success: () => toast('原文链接已复制，请在浏览器打开')
    })
  },

  onPreviewImage(e) {
    const url = e.currentTarget.dataset.url
    const images = this.data.detail.images || []
    wx.previewImage({ current: url, urls: images })
  },

  goHome() {
    wx.switchTab({ url: '/pages/home/index' })
  },

  onShareAppMessage() {
    return {
      title: this.data.detail.title || '校园资讯',
      path: `/pages/detail/index?id=${this.data.id}`
    }
  }
})
