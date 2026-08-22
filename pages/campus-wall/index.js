import { callApi, toast } from '../../utils/request'
import { isLoggedIn, promptLogin } from '../../utils/auth'

const REFRESH_INTERVAL = 60 * 1000
const STALE_AFTER = 30 * 1000
const FEED_DIRTY_KEY = 'campus_feed_dirty'

Page({
  data: {
    feedItems: [],
    categories: [
      { id: 'all', name: '全部' },
      { id: 'market', name: '二手闲置' },
      { id: 'official', name: '官方资讯' },
      { id: 'share', name: '分享' },
      { id: 'help', name: '求助' },
      { id: 'activity', name: '活动' },
      { id: 'question', name: '问答' }
    ],
    selectedCategory: 'all',
    page: 1,
    pageSize: 10,
    hasMore: true,
    loading: false,
    refreshing: false,
    keyword: '',
    lastUpdatedText: ''
  },

  onLoad() {
    this.lastLoadedAt = 0
    this.loadFeed(true)
  },

  onShow() {
    this.startAutoRefresh()
    const dirty = wx.getStorageSync(FEED_DIRTY_KEY)
    const stale = Date.now() - (this.lastLoadedAt || 0) > STALE_AFTER
    if (dirty || stale) {
      wx.removeStorageSync(FEED_DIRTY_KEY)
      this.loadFeed(true, { silent: this.data.feedItems.length > 0 })
    }
  },

  onHide() {
    this.stopAutoRefresh()
  },

  onUnload() {
    this.stopAutoRefresh()
  },

  startAutoRefresh() {
    this.stopAutoRefresh()
    this.refreshTimer = setInterval(() => {
      this.loadFeed(true, { silent: true })
    }, REFRESH_INTERVAL)
  },

  stopAutoRefresh() {
    if (this.refreshTimer) clearInterval(this.refreshTimer)
    this.refreshTimer = null
  },

  onPullDownRefresh() {
    this.setData({ refreshing: true })
    this.loadFeed(true).finally(() => {
      wx.stopPullDownRefresh()
      this.setData({ refreshing: false })
    })
  },

  onReachBottom() {
    this.loadMore()
  },

  loadMore() {
    if (!this.data.loading && this.data.hasMore) this.loadFeed(false)
  },

  onCategoryChange(e) {
    const category = e.currentTarget.dataset.category
    if (category === this.data.selectedCategory) return
    this.setData({ selectedCategory: category, page: 1, hasMore: true })
    this.loadFeed(true)
  },

  async goToPublish(e) {
    const category = e?.currentTarget?.dataset?.category || ''
    const target = category ? `/pages/campus-wall/publish?category=${category}` : '/pages/campus-wall/publish'
    if (!isLoggedIn()) {
      await promptLogin({
        content: '登录后可以发布校园动态，并接收评论和互动消息。',
        redirect: target
      })
      return
    }
    wx.navigateTo({ url: target })
  },

  openFeedItem(e) {
    const { type, id } = e.currentTarget.dataset
    if (!id) return
    const url = type === 'official'
      ? `/pages/detail/index?id=${id}`
      : `/pages/campus-wall/detail?id=${id}`
    wx.navigateTo({ url })
  },

  onInputChange(e) {
    this.setData({ keyword: e.detail.value })
  },

  onSearch() {
    this.loadFeed(true)
  },

  clearInput() {
    this.setData({ keyword: '' })
    this.loadFeed(true)
  },

  async loadFeed(reset = false, options = {}) {
    if (this.data.loading) return
    const page = reset ? 1 : this.data.page + 1
    const showLoading = !options.silent
    if (showLoading) this.setData({ loading: true })
    else this.data.loading = true

    try {
      const result = await callApi('campus/feed/list', {
        page,
        pageSize: this.data.pageSize,
        category: this.data.selectedCategory,
        q: this.data.keyword.trim()
      })
      if (result.error && !Array.isArray(result.list)) throw new Error(result.error)

      const newItems = result.list || []
      const feedItems = reset ? newItems : this.data.feedItems.concat(newItems)
      const now = Date.now()
      this.lastLoadedAt = now
      this.setData({
        feedItems,
        page,
        hasMore: !!result.hasMore,
        loading: false,
        lastUpdatedText: `更新于 ${this.formatClock(result.refreshedAt || now)}`
      })
    } catch (error) {
      console.error('加载校园动态失败:', error)
      this.setData({ loading: false })
      if (!options.silent) toast('加载失败，请下拉重试')
    }
  },

  formatClock(timestamp) {
    const date = new Date(Number(timestamp) || Date.now())
    const pad = value => String(value).padStart(2, '0')
    return `${pad(date.getHours())}:${pad(date.getMinutes())}`
  }
})
