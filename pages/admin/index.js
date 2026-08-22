import { callApi, toast } from '../../utils/request'
import { isAdmin, getUserId, waitForAuthReady } from '../../utils/auth'

Page({
  data: {
    loading: true,
    crawlerRunning: false,
    activeCrawlerJob: '',
    showCrawlerJobs: false,
    crawlerJobs: [
      { id: 'teacher-cert', title: '更新教资信息', desc: '考试报名、准考证、考场及成绩安排', icon: '证', days: 30 },
      { id: 'graduate-exam', title: '更新考研信息', desc: '招生简章、报名、初试与复试动态', icon: '研', days: 30 },
      { id: 'exam', title: '更新四六级信息', desc: '报名批次、准考证、考试与成绩节点', icon: '英', days: 60 },
      { id: 'muc-home', title: '更新民大主页', desc: '只保留近7天与学生直接相关的通知', icon: '校', days: 7 },
      { id: 'competition', title: '更新竞赛信息', desc: '近7天报名、申报、赛程及结果发布', icon: '赛', days: 7 },
      { id: 'three-innovation', title: '更新三创赛', desc: '三创赛报名、校赛批次和作品提交通知', icon: '创', days: 30 },
      { id: 'innovation-entrepreneurship', title: '更新创新创业大赛', desc: '创新大赛及互联网+相关赛道动态', icon: '新', days: 30 },
      { id: 'challenge-cup', title: '更新挑战杯', desc: '挑战杯申报、赛程和评审安排', icon: '杯', days: 30 },
      { id: 'career', title: '更新就业实习', desc: '国家大学生就业服务平台最新信息', icon: '职', days: 14 },
      { id: 'info-engineering', title: '更新信息工程学院', desc: '本科教学、青苗计划和学院竞赛', icon: '信', days: 7 }
    ],
    crawlerStatus: null,
    stats: { tags: 0, sources: 0, contents: 0 },
    contents: []
  },

  async onLoad() {
    await waitForAuthReady()
    if (!isAdmin()) {
      wx.showModal({
        title: '无访问权限',
        content: '该页面仅面向平台管理员。',
        showCancel: false,
        success: () => wx.navigateBack()
      })
      return
    }
    this.loadDashboard()
  },

  async onShow() {
    await waitForAuthReady()
    if (isAdmin() && !this.data.loading) this.loadDashboard()
  },

  async loadDashboard(force = false) {
    if (this.dashboardLoadPromise) return this.dashboardLoadPromise
    if (!force && this.dashboardLoadedAt && Date.now() - this.dashboardLoadedAt < 5000) return
    this.setData({ loading: true })
    this.dashboardLoadPromise = (async () => {
      try {
        const [tags, sources, contents, crawlerStatus] = await Promise.all([
          callApi('meta/tags'),
          callApi('meta/sources'),
          callApi('content/list', { page: 1, pageSize: 20 }),
          callApi('crawler/status')
        ])
        this.setData({
          stats: {
            tags: (tags.list || []).length,
            sources: (sources.list || []).length,
            contents: (contents.list || []).length
          },
          contents: contents.list || [],
          crawlerStatus: crawlerStatus.code === 403
            ? { message: crawlerStatus.message || '采集器鉴权失败', accessDenied: true }
            : (crawlerStatus.data || crawlerStatus),
          loading: false
        })
        this.dashboardLoadedAt = Date.now()
      } catch (error) {
        console.error('管理中心加载失败:', error)
        this.setData({ loading: false })
        toast('管理数据加载失败')
      }
    })().finally(() => {
      this.dashboardLoadPromise = null
    })
    return this.dashboardLoadPromise
  },

  goToPublish() {
    wx.navigateTo({ url: '/pages/publish/index' })
  },

  toggleCrawlerPanel() {
    this.setData({ showCrawlerJobs: !this.data.showCrawlerJobs })
  },

  async runCrawlerJob(e) {
    if (this.data.crawlerRunning) return
    const sourceGroup = e.currentTarget.dataset.group || 'all'
    const days = Number(e.currentTarget.dataset.days || 0)
    this.setData({ crawlerRunning: true, activeCrawlerJob: sourceGroup })
    wx.showLoading({ title: '正在采集…', mask: true })
    try {
      const res = await callApi('crawler/run', { appUserId: getUserId(), sourceGroup, days })
      wx.hideLoading()
      this.setData({ crawlerRunning: false, activeCrawlerJob: '' })
      if (res.code === 200 || res.success) {
        const summary = res.summary || {}
        wx.showModal({
          title: '采集任务完成',
          content: `扫描 ${summary.fetched || 0} 条，新增 ${summary.inserted || 0} 条，更新 ${summary.updated || 0} 条，过滤低相关内容 ${summary.filtered || 0} 条。`,
          showCancel: false
        })
        this.loadDashboard(true)
      } else {
        if (res.code === 403) {
          wx.showModal({
            title: '采集器暂不可用',
            content: res.message || '请在 api 与 crawler 云函数配置相同的 CRAWLER_INTERNAL_TOKEN，并重新部署两个函数。',
            showCancel: false
          })
        } else {
          toast(res.message || '采集任务失败')
        }
      }
    } catch (error) {
      wx.hideLoading()
      this.setData({ crawlerRunning: false, activeCrawlerJob: '' })
      toast('采集任务启动失败')
    }
  },

  async initCollections() {
    wx.showLoading({ title: '检查数据表…' })
    try {
      const res = await callApi('dev/initCollections', { appUserId: getUserId() })
      wx.hideLoading()
      wx.showModal({ title: '初始化结果', content: res.message || '处理完成', showCancel: false })
      this.loadDashboard(true)
    } catch (error) {
      wx.hideLoading()
      toast('初始化失败')
    }
  },

  async removeDemoContent() {
    const modal = await new Promise(resolve => wx.showModal({ title: '确认清理演示数据', content: '只会删除 example.edu、picsum.photos 和内置演示标题，不会删除采集或用户真实内容。', confirmText: '确认清理', success: resolve }))
    if (!modal.confirm) return
    wx.showLoading({ title: '正在清理', mask: true })
    try {
      const res = await callApi('dev/removeDemoContent', { appUserId: getUserId() })
      wx.hideLoading()
      wx.showModal({ title: '清理完成', content: res.message || '演示数据已处理', showCancel: false })
      this.loadDashboard(true)
    } catch (error) {
      wx.hideLoading()
      toast('清理失败，请查看云函数日志')
    }
  },

  onEditContent(e) {
    const { id, item } = e.detail
    wx.setStorageSync('editingContent', item)
    wx.navigateTo({ url: `/pages/publish/index?editId=${id}` })
  },

  async onDeleteContent(e) {
    try {
      wx.showLoading({ title: '删除中…' })
      const res = await callApi('content/delete', { contentId: e.detail.id, appUserId: getUserId() })
      wx.hideLoading()
      if (!res.ok) throw new Error(res.message || '删除失败')
      toast('资讯已删除')
      this.loadDashboard(true)
    } catch (error) {
      wx.hideLoading()
      toast('删除失败')
    }
  }
})
