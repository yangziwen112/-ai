import { callApi, toast } from '../../utils/request'
import favoriteManager from '../../utils/favoriteManager'
import { isLoggedIn, promptLogin } from '../../utils/auth'

Page({
  data: {
    list: [],
    page: 1,
    pageSize: 10,
    hasMore: true,
    loading: false,
    refreshing: false,
    upcomingItems: [],
    selectedTag: 'all',
    searchKeyword: '',
    tags: [
      { id: 'all', name: '推荐' },
      { id: 'notice', name: '通知' },
      { id: 'competition', name: '竞赛' },
      { id: 'academic', name: '讲座' },
      { id: 'recruit', name: '就业' },
      { id: 'certification', name: '考试考证' },
      { id: 'sports', name: '文体' },
      { id: 'volunteer', name: '志愿' },
      { id: 'activity', name: '活动' }
    ]
  },

  onLoad() {
    this.initPage()
  },

  onShow() {
    if (this.data.list.length) this.updateFavoriteStatus()
  },

  onPullDownRefresh() {
    this.refreshData()
  },

  onReachBottom() {
    this.loadMore()
  },

  async initPage() {
    this.setData({ refreshing: true })
    await Promise.all([this.loadList(true), this.loadUpcoming()])
    this.setData({ refreshing: false })
  },

  async refreshData() {
    if (this.data.refreshing) return
    this.setData({ refreshing: true })
    await Promise.all([this.loadList(true), this.loadUpcoming()])
    this.setData({ refreshing: false })
    wx.stopPullDownRefresh()
  },

  async loadUpcoming() {
    try {
      const res = await callApi('feed/upcoming', { limit: 6 })
      this.setData({ upcomingItems: res.list || [] })
    } catch (error) {
      console.warn('近期节点加载失败:', error)
    }
  },

  async loadList(reset = false) {
    if (this.data.loading) return
    const page = reset ? 1 : this.data.page + 1
    this.setData({ loading: true })

    try {
      const res = await callApi('feed/recommend', {
        page,
        pageSize: this.data.pageSize,
        type: this.data.selectedTag === 'all' ? '' : this.data.selectedTag,
        q: this.data.searchKeyword
      })
      const incoming = favoriteManager.updateContentList(res.list || [])
      this.setData({
        list: reset ? incoming : this.data.list.concat(incoming),
        page,
        hasMore: !!res.hasMore,
        loading: false
      })
    } catch (error) {
      console.error('加载资讯失败:', error)
      this.setData({ loading: false })
      toast('资讯加载失败，请稍后重试')
    }
  },

  loadMore() {
    if (!this.data.loading && this.data.hasMore) this.loadList(false)
  },

  onTagClick(e) {
    const selectedTag = e.currentTarget.dataset.tag
    if (selectedTag === this.data.selectedTag) return
    this.setData({ selectedTag, list: [], hasMore: true })
    this.loadList(true)
  },

  onSearchInput(e) {
    this.setData({ searchKeyword: e.detail.value })
  },

  onSearch() {
    this.setData({ list: [], hasMore: true })
    this.loadList(true)
  },

  clearSearch() {
    if (!this.data.searchKeyword) return
    this.setData({ searchKeyword: '', list: [] })
    this.loadList(true)
  },

  async onFavorite(e) {
    const id = e.detail.id
    if (!isLoggedIn()) {
      await promptLogin({
        content: '登录后可以收藏资讯，并在“我的收藏”中随时查看。',
        redirect: `/pages/detail/index?id=${id}`
      })
      return
    }

    const item = this.data.list.find(current => current._id === id)
    const wasFavorited = !!item?.favored
    try {
      await callApi('user/favorite/toggle', { contentId: id })
      const list = this.data.list.map(current => current._id === id
        ? { ...current, favored: !wasFavorited }
        : current)
      favoriteManager.setFavoriteStatus(id, !wasFavorited)
      this.setData({ list })
      toast(wasFavorited ? '已取消收藏' : '已收藏')
    } catch (error) {
      toast('操作失败，请重试')
    }
  },

  updateFavoriteStatus() {
    this.setData({ list: favoriteManager.updateContentList(this.data.list) })
  },

  async goToSubscription() {
    if (!isLoggedIn()) {
      await promptLogin({
        content: '登录后可以关注感兴趣的栏目和信息来源，获得更适合你的推荐。',
        redirect: '/pages/subscription/index'
      })
      return
    }
    wx.navigateTo({ url: '/pages/subscription/index' })
  },

  goToCampusWall() {
    wx.switchTab({ url: '/pages/campus-wall/index' })
  },

  goToAssistant() {
    wx.switchTab({ url: '/pages/chat/index' })
  },

  openUpcoming(e) {
    const id = e.currentTarget.dataset.id
    if (id) wx.navigateTo({ url: `/pages/detail/index?id=${id}` })
  },

  onShareAppMessage() {
    return {
      title: '民大通 · 校园信息聚合平台',
      path: '/pages/home/index'
    }
  }
})
