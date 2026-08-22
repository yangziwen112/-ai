import { callApi, toast } from '../../utils/request'
import { isLoggedIn, promptLogin, waitForAuthReady } from '../../utils/auth'
import favoriteManager from '../../utils/favoriteManager'

Page({
  data: {
    list: [],
    page: 1,
    pageSize: 10,
    hasMore: true,
    loading: false,
    totalCount: 0,
    editMode: false
  },

  async onShow() {
    await waitForAuthReady()
    if (!isLoggedIn()) {
      const goingLogin = await promptLogin({ content: '登录后可以查看和管理你收藏的校园资讯。', redirect: '/pages/favorites/index' })
      if (!goingLogin) wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/home/index' }) })
      return
    }
    this.loadList(true)
  },

  onPullDownRefresh() {
    this.loadList(true).finally(() => wx.stopPullDownRefresh())
  },

  onReachBottom() {
    if (this.data.loading || !this.data.hasMore) return
    this.loadList(false)
  },

  async loadList(reset = false) {
    this.setData({ loading: true })
    const page = reset ? 1 : this.data.page + 1

    try {
      const res = await callApi('favorites/list', {
        page,
        pageSize: this.data.pageSize
      })

      const list = reset ? (res.list || []) : this.data.list.concat(res.list || [])
      const totalCount = res.totalCount || list.length

      this.setData({
        list,
        page,
        hasMore: res.hasMore || false,
        totalCount,
        loading: false
      })

    } catch (error) {
      console.error('加载收藏失败:', error)
      this.setData({ loading: false })
      toast('加载失败')
    }
  },

  // 删除单条收藏
  async onRemoveFavorite(e) {
    const id = e.currentTarget.dataset.id

    wx.showModal({
      title: '删除收藏',
      content: '确认删除这个收藏吗？',
      success: async (res) => {
        if (!res.confirm) return

        try {
          await callApi('user/favorite/remove', { contentId: id })

          favoriteManager.setFavoriteStatus(id, false)

          this.setData({
            list: this.data.list.filter(it => it._id !== id),
            totalCount: Math.max(0, this.data.totalCount - 1)
          })

          toast('已删除')
        } catch (error) {
          toast('删除失败')
        }
      }
    })
  },

  // 清空所有收藏
  async onClearAll() {
    if (this.data.totalCount === 0) {
      toast('暂无收藏')
      return
    }

    wx.showModal({
      title: '清空收藏',
      content: `确认删除全部 ${this.data.totalCount} 个收藏吗？此操作不可恢复`,
      confirmColor: '#ff6b6b',
      success: async (res) => {
        if (!res.confirm) return

        wx.showLoading({ title: '清空中...' })
        try {
          await callApi('user/favorite/clearAll', {})

          this.data.list.forEach(item => {
            favoriteManager.setFavoriteStatus(item._id, false)
          })

          this.setData({
            list: [],
            totalCount: 0,
            editMode: false
          })

          wx.hideLoading()
          toast('已清空全部收藏')
        } catch (error) {
          wx.hideLoading()
          toast('清空失败')
        }
      }
    })
  },

  // 切换编辑模式
  onToggleEditMode() {
    this.setData({ editMode: !this.data.editMode })
  }
}) 
