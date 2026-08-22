import { callApi, toast } from '../../utils/request'
import { isAdmin, getUserId, waitForAuthReady } from '../../utils/auth'

Page({
  data: {
    title: '',
    description: '',
    selectedTags: [],
    selectedSource: '',
    selectedSourceName: '请选择来源',
    categoryIndex: 0,
    selectedCategory: 'notice',
    categories: [
      { id: 'notice', name: '通知公告' },
      { id: 'competition', name: '竞赛实践' },
      { id: 'academic', name: '讲座学术' },
      { id: 'recruit', name: '就业招聘' },
      { id: 'certification', name: '考试考证' },
      { id: 'sports', name: '文体活动' },
      { id: 'volunteer', name: '志愿服务' },
      { id: 'activity', name: '校园活动' }
    ],
    images: [],
    showLink: false,
    linkUrl: '',
    tags: [],
    sources: [],
    loading: false,
    publishing: false,
    editingId: null,
    isAdmin: false,
    isLoggedIn: false,
    clickingTagId: null
  },

  async onLoad() {
    await waitForAuthReady()
    if (!isAdmin()) {
      wx.showModal({
        title: '权限不足',
        content: '只有管理员才能发布信息',
        showCancel: false,
        success: () => {
          wx.navigateBack()
        }
      })
      return
    }
    
    this.setData({ isAdmin: true })
    this.loadMetadata()
  },

  checkEditMode() {
    const pages = getCurrentPages()
    const currentPage = pages[pages.length - 1]
    const editId = currentPage.options.editId
    
    if (editId) {
      const editingContent = wx.getStorageSync('editingContent')
      if (editingContent) {
        let sourceIndex = 0
        const sources = this.data.sources
        if (editingContent.sourceId && sources.length > 0) {
          sourceIndex = sources.findIndex(s => s._id === editingContent.sourceId)
          if (sourceIndex === -1) sourceIndex = 0
        }
        
        const images = editingContent.images || []
        const linkUrl = editingContent.linkUrl || ''
        
        const selectedTags = (editingContent.tags || []).map(value => {
          const matched = this.data.tags.find(tag => tag._id === value || tag.name === value)
          return matched ? matched._id : value
        })

        const categoryIndex = Math.max(this.data.categories.findIndex(item => item.id === editingContent.category), 0)
        this.setData({
          editingId: editId,
          title: editingContent.title || '',
          description: editingContent.description || '',
          selectedTags,
          selectedSource: editingContent.sourceId || '',
          selectedSourceName: editingContent.sourceName || '请选择来源',
          sourceIndex: sourceIndex,
          categoryIndex,
          selectedCategory: this.data.categories[categoryIndex].id,
          images: images,
          showLink: !!linkUrl,
          linkUrl: linkUrl
        })
        wx.removeStorageSync('editingContent')
      }
    }
  },

  async loadMetadata() {
    try {
      this.setData({ loading: true })
      const [tagsRes, sourcesRes] = await Promise.all([
        callApi('meta/tags'),
        callApi('meta/sources')
      ])
      
      const tags = tagsRes.list || []
      const sources = sourcesRes.list || []
      
      this.setData({
        tags: tags,
        sources: sources,
        loading: false
      })
      this.checkEditMode()
    } catch (error) {
      console.error('❌ 加载元数据失败:', error)
      toast('加载失败，请重试')
      this.setData({ loading: false })
    }
  },

  onTitleChange(e) {
    this.setData({ title: e.detail.value })
  },

  onDescriptionChange(e) {
    this.setData({ description: e.detail.value })
  },

  onTagClick(e) {
    const tagId = e.currentTarget.dataset.id
    const { selectedTags } = this.data
    let newTags = selectedTags
    if (selectedTags.includes(tagId)) {
      newTags = selectedTags.filter(id => id !== tagId)
    } else {
      newTags = [...selectedTags, tagId]
    }
    
    this.addTagClickFeedback(tagId)
    
    this.setData({
      selectedTags: newTags
    })
  },

  addTagClickFeedback(tagId) {
    this.setData({
      clickingTagId: tagId
    })
    
    setTimeout(() => {
      this.setData({
        clickingTagId: null
      })
    }, 200)
  },

  onSourceChange(e) {
    const sourceIndex = e.detail.value
    const sources = this.data.sources
    if (sources[sourceIndex]) {
      this.setData({ 
        selectedSource: sources[sourceIndex]._id,
        selectedSourceName: sources[sourceIndex].name,
        sourceIndex: sourceIndex
      })
    }
  },

  onCategoryChange(e) {
    const categoryIndex = Number(e.detail.value) || 0
    const category = this.data.categories[categoryIndex]
    if (category) this.setData({ categoryIndex, selectedCategory: category.id })
  },

  async onUploadImage() {
    try {
      const res = await new Promise((resolve, reject) => {
        wx.chooseImage({
          count: 5,
          sizeType: ['original', 'compressed'],
          sourceType: ['album', 'camera'],
          success: resolve,
          fail: reject
        })
      })

      const images = res.tempFilePaths
      this.setData({
        images: [...this.data.images, ...images].slice(0, 5)
      })
      
      toast(`已选择 ${images.length} 张图片`)
    } catch (error) {
      console.error('选择图片失败:', error)
    }
  },

  async uploadImageToCloud(filePath) {
    try {
      const cloudPath = `images/${Date.now()}_${Math.random().toString(36).slice(2)}.jpg`
      
      const uploadRes = await wx.cloud.uploadFile({
        cloudPath: cloudPath,
        filePath: filePath
      })
      
      return uploadRes.fileID
    } catch (error) {
      console.error('❌ 图片上传失败:', error)
      throw error
    }
  },

  async uploadImagesToCloud(imagePaths) {
    try {
      if (!imagePaths || imagePaths.length === 0) {
        return []
      }

      const uploadPromises = imagePaths.map(path => {
        if (path.startsWith('cloud://')) {
          return Promise.resolve(path)
        }
        return this.uploadImageToCloud(path)
      })
      
      const uploadedUrls = await Promise.all(uploadPromises)
      
      return uploadedUrls
    } catch (error) {
      console.error('❌ 批量上传图片失败:', error)
      toast('图片上传失败，请重试')
      throw error
    }
  },

  onRemoveImage(e) {
    const index = e.currentTarget.dataset.index
    const images = this.data.images.filter((_, i) => i !== index)
    this.setData({ images })
  },

  onPreviewImage(e) {
    const url = e.currentTarget.dataset.url
    wx.previewImage({
      current: url,
      urls: this.data.images
    })
  },

  // 切换网站链接显示/隐藏
  onToggleLink() {
    const showLink = !this.data.showLink
    this.setData({ showLink })
    if (!showLink) {
      this.setData({ linkUrl: '' })
    }
  },

  // 网站链接输入
  onLinkChange(e) {
    this.setData({ linkUrl: e.detail.value })
  },

  // 移除网站链接
  onRemoveLink() {
    this.setData({ showLink: false, linkUrl: '' })
  },

  validateForm() {
    const { title, description, selectedTags, selectedSource } = this.data
    
    if (!title.trim()) {
      toast('请输入标题')
      return false
    }
    
    if (title.trim().length < 3) {
      toast('标题至少需要 3 个字符')
      return false
    }
    
    if (!description.trim()) {
      toast('请输入描述')
      return false
    }
    
    if (description.trim().length < 10) {
      toast('描述至少需要 10 个字符')
      return false
    }
    
    if (selectedTags.length === 0) {
      toast('请选择至少一个标签')
      return false
    }
    
    if (!selectedSource) {
      toast('请选择来源')
      return false
    }
    
    return true
  },

  async onPublish() {
    if (!this.validateForm()) {
      return
    }

    try {
      this.setData({ publishing: true })
      wx.showLoading({ title: '发布中...' })

      const { title, description, selectedTags, selectedSource, images, editingId, linkUrl } = this.data
      
      const isEditing = !!editingId
      const apiRoute = isEditing ? 'content/edit' : 'content/publish'
      
      let cloudImageUrls = []
      if (images.length > 0) {
        wx.showLoading({ title: '上传图片中...' })
        cloudImageUrls = await this.uploadImagesToCloud(images)
      }
      
      wx.showLoading({ title: '发布中...' })
      
      const payload = {
        title: title.trim(),
        description: description.trim(),
        tags: selectedTags,
        sourceId: selectedSource,
        category: this.data.selectedCategory,
        images: cloudImageUrls,
        linkUrl: (linkUrl || '').trim(),
        publishedBy: getUserId(),
        appUserId: getUserId()
      }
      
      if (isEditing) {
        payload.contentId = editingId
      }
      
      const result = await callApi(apiRoute, payload)

      wx.hideLoading()
      this.setData({ publishing: false })

      if (result.ok || result._id) {
        wx.showModal({
          title: isEditing ? '编辑成功' : '发布成功',
          content: isEditing ? '信息已成功更新' : '信息已成功发布到大厅',
          showCancel: false,
          success: () => {
            wx.switchTab({
              url: '/pages/home/index'
            })
          }
        })
      } else {
        toast(isEditing ? '编辑失败，请重试' : '发布失败，请重试')
        console.error('API返回错误:', result)
      }
    } catch (error) {
      console.error('发布失败:', error)
      wx.hideLoading()
      this.setData({ publishing: false })
      toast('发布失败，请检查网络')
    }
  },

  saveDraft() {
    const { title, description, selectedTags, selectedSource } = this.data
    wx.setStorageSync('publishDraft', {
      title,
      description,
      selectedTags,
      selectedSource,
      savedAt: Date.now()
    })
    toast('已保存为草稿')
    setTimeout(() => {
      wx.navigateBack()
    }, 800)
  },

  restoreDraft() {
    try {
      const draft = wx.getStorageSync('publishDraft')
      if (draft && Date.now() - draft.savedAt < 24 * 60 * 60 * 1000) {
        wx.showModal({
          title: '恢复草稿',
          content: '发现上次的草稿，是否恢复？',
          success: (res) => {
            if (res.confirm) {
              const { title, description, selectedTags, selectedSource } = draft
              this.setData({ title, description, selectedTags, selectedSource })
            }
          }
        })
      }
    } catch (error) {
      console.error('恢复草稿失败:', error)
    }
  },

  goBack() {
    wx.navigateBack({
      delta: 1
    })
  }
})
