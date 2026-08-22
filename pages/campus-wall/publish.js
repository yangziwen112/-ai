import { callApi, toast } from '../../utils/request'
import { isLoggedIn, getUserId, promptLogin, waitForAuthReady } from '../../utils/auth'

Page({
  data: {
    content: '',
    category: 'share',
    contentPlaceholder: '分享校园生活、经验或有用信息…',
    customTag: '',
    marketDetails: { quantity: '', condition: '', location: '', tradeMethod: '', reason: '' },
    marketType: 'general',
    categories: [
      { id: 'market', name: '二手闲置', icon: '物' },
      { id: 'share', name: '分享', icon: '📤' },
      { id: 'help', name: '求助', icon: '🙋' },
      { id: 'activity', name: '活动', icon: '🎉' },
      { id: 'question', name: '问答', icon: '❓' },
      { id: 'other', name: '其他', icon: '📌' }
    ],
    images: [],
    maxImages: 9,
    anonymous: false,
    loading: false
  },

  async onLoad(options = {}) {
    await waitForAuthReady()
    if (!isLoggedIn()) {
      const goingLogin = await promptLogin({ content: '登录后可以在校园墙发布内容，并接收评论与互动消息。', redirect: '/pages/campus-wall/publish' })
      if (!goingLogin) wx.navigateBack()
      return
    }
    
    // 加载草稿
    this.loadDraft()
    if (options.category === 'market' || options.category === 'book') {
      this.setData({
        category: 'market',
        marketType: options.category === 'book' ? 'book' : 'general',
        contentPlaceholder: '请简要写明物品名称、新旧程度、价格和交易方式…'
      })
    }
  },

  loadDraft() {
    try {
      const draftData = wx.getStorageSync('campus_post_draft')
      if (draftData) {
        const images = Array.isArray(draftData.images)
          ? draftData.images.filter(path => this.isPersistentMediaPath(path))
          : []
        this.setData({
          content: draftData.content || '',
          category: draftData.category || 'share',
          contentPlaceholder: draftData.category === 'market'
            ? '请简要写明物品名称、新旧程度、价格和交易方式…'
            : '分享校园生活、经验或有用信息…',
          customTag: draftData.customTag || '',
          marketDetails: { ...this.data.marketDetails, ...(draftData.marketDetails || {}) },
          marketType: draftData.marketType || 'general',
          images,
          anonymous: draftData.anonymous || false
        })
        toast('已加载草稿')
      }
    } catch (error) {
      console.error('加载草稿失败:', error)
    }
  },

  onContentChange(e) {
    this.setData({ content: e.detail.value })
  },

  onCategoryChange(e) {
    const category = e.currentTarget.dataset.category
    const placeholders = {
      market: '请简要写明物品名称、新旧程度、价格和交易方式…',
      share: '分享校园生活、经验或有用信息…',
      help: '请说明你遇到的问题和希望获得的帮助…',
      activity: '请写明活动时间、地点和参与方式…',
      question: '清楚描述你的问题，方便同学回答…',
      custom: '请输入你想发布的校园内容…',
      other: '请输入你想发布的校园内容…'
    }
    this.setData({ category, contentPlaceholder: placeholders[category] || placeholders.other })
  },

  onAnonymousChange(e) {
    this.setData({ anonymous: e.detail.value })
  },

  onCustomTagChange(e) {
    this.setData({ customTag: e.detail.value })
  },

  onMarketTypeChange(e) {
    this.setData({ category: 'market', marketType: e.currentTarget.dataset.type || 'general', contentPlaceholder: '请写明书名、版本、价格和使用情况…' })
  },

  onMarketDetailChange(e) {
    const field = e.currentTarget.dataset.field
    if (field) this.setData({ [`marketDetails.${field}`]: e.detail.value })
  },

  async chooseImage() {
    if (this.data.images.length >= this.data.maxImages) {
      toast(`最多只能上传${this.data.maxImages}张图片`)
      return
    }

    wx.chooseImage({
      count: this.data.maxImages - this.data.images.length,
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        const newImages = this.data.images.concat(res.tempFilePaths)
        this.setData({ images: newImages })
      }
    })
  },

  removeImage(e) {
    const index = e.currentTarget.dataset.index
    const images = this.data.images.filter((_, i) => i !== index)
    this.setData({ images })
  },

  async publishPost() {
    if (!this.data.content.trim()) {
      toast('请输入内容')
      return
    }

    if (this.data.category === 'market') {
      const details = this.data.marketDetails || {}
      const required = [['quantity', '数量'], ['condition', '新旧程度'], ['location', '位置'], ['tradeMethod', '交易方式'], ['reason', '转让原因']]
      const missing = required.find(([key]) => !String(details[key] || '').trim())
      if (missing) {
        toast(`请填写${missing[1]}`)
        return
      }
    }

    // 验证自定义标签长度
    if (this.data.customTag) {
      const tagLength = this.data.customTag.length
      if (tagLength < 5 || tagLength > 10) {
        toast('标签长度应在5-10个汉字之间')
        return
      }
    }

    if (this.data.loading) return

    this.setData({ loading: true })

    try {
      let imageUrls = []
      if (this.data.images && this.data.images.length > 0) {
        wx.showLoading({ title: '正在上传图片…', mask: true })
        imageUrls = await this.uploadImagesToCloud(this.data.images)
        wx.hideLoading()
      }

      const result = await callApi('campus/posts/create', {
        content: this.data.content,
        category: this.data.category,
        customTag: this.data.customTag,
        marketDetails: this.data.category === 'market' ? this.data.marketDetails : null,
        marketType: this.data.category === 'market' ? this.data.marketType : '',
        images: imageUrls,
        anonymous: this.data.anonymous
      })

      if (result.ok || result.postId) {
        wx.removeStorageSync('campus_post_draft')
        wx.setStorageSync('campus_feed_dirty', Date.now())
        toast('发布成功')
        setTimeout(() => {
          wx.navigateBack()
        }, 1500)
      } else {
        toast(result.message || '发布失败，请重试')
      }
    } catch (error) {
      wx.hideLoading()
      console.error('发布失败:', error)
      toast('发布失败，请重试')
    } finally {
      this.setData({ loading: false })
    }
  },

  async uploadImageToCloud(filePath) {
    try {
      const cloudPath = `campus/${Date.now()}_${Math.random().toString(36).slice(2)}.jpg`
      const uploadRes = await wx.cloud.uploadFile({
        cloudPath: cloudPath,
        filePath: filePath
      })
      return uploadRes.fileID
    } catch (error) {
      console.error('图片上传失败:', error)
      throw error
    }
  },

  async uploadImagesToCloud(imagePaths) {
    try {
      if (!imagePaths || imagePaths.length === 0) {
        return []
      }
      const uploadPromises = imagePaths.map(path => {
        if (this.isPersistentMediaPath(path)) {
          return Promise.resolve(path)
        }
        return this.uploadImageToCloud(path)
      })
      return await Promise.all(uploadPromises)
    } catch (error) {
      console.error('批量上传图片失败:', error)
      toast('图片上传失败，请重试')
      throw error
    }
  },

  previewImage(e) {
    const index = e.currentTarget.dataset.index
    wx.previewImage({
      current: this.data.images[index],
      urls: this.data.images
    })
  },

  navigateBack() {
    wx.navigateBack()
  },

  isPersistentMediaPath(path) {
    return typeof path === 'string' && (path.startsWith('cloud://') || path.startsWith('https://'))
  },

  async saveDraft() {
    try {
      if (this.data.loading) return
      this.setData({ loading: true })
      let images = this.data.images.filter(path => this.isPersistentMediaPath(path))
      const temporaryImages = this.data.images.filter(path => !this.isPersistentMediaPath(path))
      if (temporaryImages.length) {
        wx.showLoading({ title: '保存草稿图片…', mask: true })
        const uploaded = await this.uploadImagesToCloud(temporaryImages)
        images = images.concat(uploaded)
        this.setData({ images })
      }

      const draftData = {
        content: this.data.content,
        category: this.data.category,
        customTag: this.data.customTag,
        marketDetails: this.data.category === 'market' ? this.data.marketDetails : null,
        marketType: this.data.category === 'market' ? this.data.marketType : '',
        images,
        anonymous: this.data.anonymous,
        savedAt: Date.now()
      }
      wx.setStorageSync('campus_post_draft', draftData)
      toast('草稿保存成功')
    } catch (error) {
      console.error('保存草稿失败:', error)
      toast('草稿图片上传失败，请重试')
    } finally {
      wx.hideLoading()
      this.setData({ loading: false })
    }
  }
})
