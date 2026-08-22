import { callApi, toast } from '../../utils/request'
import { isLoggedIn, getUserId, getUser, promptLogin, waitForAuthReady } from '../../utils/auth'

Page({
  data: {
    allTags: [],           // 所有标签
    followedTags: [],      // 已关注的标签
    followedTagIds: [],    // 已关注的标签ID列表
    followedCount: 0,      // 已关注数量
    relatedContents: [],   // 相关内容列表
    loadingContents: false, // 加载内容中
    userId: ''             // 用户ID
  },
  
  async onShow() {
    await waitForAuthReady()
    if (!isLoggedIn()) {
      const goingLogin = await promptLogin({ content: '登录后可以关注栏目和信息来源，首页会为你生成个性化推荐。', redirect: '/pages/subscription/index' })
      if (!goingLogin) wx.navigateBack({ fail: () => wx.switchTab({ url: '/pages/home/index' }) })
      return
    }
    
    const userId = getUserId()
    this.setData({ userId })
    this.load()
  },
  
  async load() {
    wx.showLoading({ title: '加载中...' })
    try {
      const userId = this.data.userId
      
      // 获取所有标签和用户订阅信息
      const [tagsRes, subsRes] = await Promise.all([
        callApi('meta/tags', {}),
        callApi('user/subscribe/get', { userId })
      ])
      
      const allTagsList = tagsRes.list || []
      const followedTagIds = subsRes.tagIds || []
      
      // 为标签添加关注状态
      const allTags = allTagsList.map(tag => ({
        ...tag,
        followed: followedTagIds.includes(tag._id)
      }))
      
      // 筛选出已关注的标签
      const followedTags = allTags.filter(tag => tag.followed)
      
      this.setData({
        allTags,
        followedTags,
        followedTagIds,
        followedCount: followedTags.length
      })
      
      // 如果有关注的标签，加载相关内容
      if (followedTags.length > 0) {
        this.loadRelatedContents(followedTags)
      }
      
    } catch (error) {
      console.error('加载标签数据失败:', error)
      toast('加载失败，请重试')
    } finally {
      wx.hideLoading()
    }
  },
  
  // 加载相关内容
  async loadRelatedContents(followedTags) {
    if (!followedTags || followedTags.length === 0) {
      this.setData({ relatedContents: [] })
      return
    }
    
    this.setData({ loadingContents: true })
    
    try {
      // 获取每个标签的相关内容
      const tagNames = followedTags.map(tag => tag.name)
      const contents = []
      
      // 为每个标签获取最多3条相关内容
      for (const tag of followedTags) {
        try {
          const res = await callApi('content/list', {
            page: 1,
            pageSize: 3,
            // 这里可以根据标签过滤内容
            tags: [tag.name]
          })
          
          const tagContents = (res.list || []).map(item => ({
            ...item,
            relatedTag: tag.name,
            relatedTagIcon: tag.icon
          }))
          
          contents.push(...tagContents)
        } catch (error) {
          console.error(`加载标签 ${tag.name} 的内容失败:`, error)
        }
      }
      
      // 按发布时间排序，取前10条
      const sortedContents = contents
        .sort((a, b) => (b.publishTime || 0) - (a.publishTime || 0))
        .slice(0, 10)
      
      this.setData({ 
        relatedContents: sortedContents,
        loadingContents: false
      })
      
    } catch (error) {
      console.error('加载相关内容失败:', error)
      this.setData({ loadingContents: false })
    }
  },
  
  // 切换标签关注状态
  async onToggleTag(e) {
    const id = e.currentTarget.dataset.id
    const followed = e.currentTarget.dataset.followed
    
    // 更新本地状态
    const allTags = this.data.allTags.map(tag => {
      if (tag._id === id) {
        return { ...tag, followed: !followed }
      }
      return tag
    })
    
    const followedTags = allTags.filter(tag => tag.followed)
    const followedTagIds = followedTags.map(tag => tag._id)
    
    this.setData({
      allTags,
      followedTags,
      followedTagIds,
      followedCount: followedTags.length
    })
    
    // 显示即时反馈
    toast(followed ? '已取消关注' : '已关注')
    
    // 重新加载相关内容
    if (followedTags.length > 0) {
      this.loadRelatedContents(followedTags)
    } else {
      this.setData({ relatedContents: [] })
    }
    
    // 保存到服务器
    try {
      await callApi('user/subscribe/set', { 
        userId: this.data.userId,
        tagIds: followedTagIds 
      })
    } catch (error) {
      console.error('保存失败:', error)
      toast('保存失败，请重试')
      
      // 失败后恢复状态
      const revertTags = this.data.allTags.map(tag => {
        if (tag._id === id) {
          return { ...tag, followed: followed }
        }
        return tag
      })
      
      const revertFollowed = revertTags.filter(tag => tag.followed)
      
      this.setData({
        allTags: revertTags,
        followedTags: revertFollowed,
        followedTagIds: revertFollowed.map(tag => tag._id),
        followedCount: revertFollowed.length
      })
      
      // 恢复相关内容
      this.loadRelatedContents(revertFollowed)
    }
  },
  
  // 点击内容项跳转详情
  onContentTap(e) {
    const id = e.currentTarget.dataset.id
    if (id) {
      wx.navigateTo({
        url: `/pages/detail/index?id=${id}`
      })
    }
  },
  
  // 下拉刷新
  onPullDownRefresh() {
    this.load().finally(() => {
      wx.stopPullDownRefresh()
    })
  }
})
 
