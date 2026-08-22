import { callApi, toast } from '../../utils/request'
import { isLoggedIn, getUserId, promptLogin } from '../../utils/auth'

Page({
  data: {
    post: null,
    comments: [],
    commentContent: '',
    loading: true,
    commentLoading: false,
    liked: false,
    likes: 0,
    error: false,
    keyboardHeight: 0,
    anonymousComment: false,
    showEmojiPanel: false,
    showUserCard: false,
    userCardInfo: {},
    emojis: [
      '😊', '😂', '❤️', '👍', '👎', '👋', '🎉', '🔥',
      '🤔', '😢', '😡', '😍', '🤩', '😎', '🤗', '🤫',
      '🤭', '🤮', '🤠', '🤢', '🤬', '🤧', '🥳', '🤯'
    ],
    uploadedImages: []
  },

  onLoad(options) {
    const postId = options.id
    if (postId) {
      this.loadPostDetail(postId)
    } else {
      this.setData({ loading: false, error: true })
      toast('帖子ID不存在')
      setTimeout(() => {
        wx.navigateBack()
      }, 1000)
    }
    
    // 监听键盘高度变化
    this.keyboardHeightHandler = (res) => {
      this.setData({ keyboardHeight: res.height })
    }
    wx.onKeyboardHeightChange(this.keyboardHeightHandler)
  },

  onUnload() {
    if (this.keyboardHeightHandler) wx.offKeyboardHeightChange(this.keyboardHeightHandler)
    this.keyboardHeightHandler = null
  },

  onInputFocus(e) {
    // 键盘弹起时，设置键盘高度
    if (e.detail.height) {
      this.setData({ keyboardHeight: e.detail.height })
    }
  },

  onInputBlur() {
    // 键盘收起时，设置键盘高度为0
    this.setData({ keyboardHeight: 0 })
  },

  async loadPostDetail(e) {
    try {
      // 处理事件对象的情况（来自重新加载按钮）
      let postId = e
      if (e && e.currentTarget) {
        postId = e.currentTarget.dataset.postId
      }
      
      // 如果没有传递 postId，尝试从页面数据中获取
      if (!postId && this.data.post && this.data.post._id) {
        postId = this.data.post._id
      }
      
      if (!postId) {
        throw new Error('帖子ID不存在')
      }
      
      this.setData({ loading: true, error: false })
      const res = await callApi('campus/posts/detail', { postId })
      
      if (!res) {
        throw new Error('获取帖子失败：无响应')
      }
      
      if (res.error) {
        throw new Error(res.message || '获取帖子失败')
      }
      
      if (res.data) {
        // 确保 post 对象包含 _id 字段
        const postData = {
          ...res.data,
          _id: res.data._id || postId // 如果响应中没有 _id，使用传入的 postId
        }
        this.setData({
          post: postData,
          liked: res.data.userLiked || false,
          likes: res.data.likes || 0,
          loading: false,
          error: false
        })
        
        // 重新加载评论
        await this.loadComments(postData._id)
      } else {
        throw new Error('帖子数据不存在')
      }
    } catch (error) {
      console.error('加载帖子详情失败:', error)
      this.setData({ loading: false, error: true })
      toast('加载失败，请重试')
    }
  },

  async loadComments(postId) {
    try {
      const res = await callApi('campus/comments/list', { postId })
      if (res && res.list) {
        this.setData({ comments: res.list })
      } else {
        // 如果没有评论或响应格式不正确，设置为空数组
        this.setData({ comments: [] })
      }
    } catch (error) {
      console.error('加载评论失败:', error)
      // 评论加载失败不影响主页面显示，设置为空数组
      this.setData({ comments: [] })
    }
  },

  onCommentInput(e) {
    this.setData({ commentContent: e.detail.value })
  },

  // 完整的评论提交方法
  async submitComment() {
    // 防重复提交
    if (this.data.commentLoading) {
      return
    }
    
    if (!isLoggedIn()) {
      await promptLogin({ content: '登录后可以发表评论并参与校园墙互动。' })
      return
    }

    const content = this.data.commentContent.trim()
    const uploadedImages = this.data.uploadedImages
    
    // 检查是否有内容或图片
    if (!content && uploadedImages.length === 0) {
      toast('请输入评论内容或上传图片')
      return
    }

    // 长度限制检查
    if (content.length > 500) {
      toast('评论内容长度不能超过500字符')
      return
    }

    if (!this.data.post || !this.data.post._id) {
      toast('帖子数据加载失败')
      return
    }

    this.setData({ commentLoading: true })

    try {
      // 构建评论数据，包含文本内容和图片
      const commentData = {
        postId: this.data.post._id,
        content: content,
        images: uploadedImages
      }

      const res = await callApi('campus/comments/create', commentData)

      if (res.ok) {
        toast('评论成功')
        
        // 清空评论输入框和上传图片
        this.setData({ 
          commentContent: '',
          uploadedImages: [] 
        })
        
        // 手动创建评论对象并添加到评论列表
        const newComment = {
          _id: Date.now().toString(), // 生成临时ID
          postId: this.data.post._id,
          content: content,
          images: uploadedImages,
          authorId: getUserId(),
          authorName: '当前用户', // 可以从登录信息中获取
          anonymous: this.data.anonymousComment,
          status: 'published',
          createdAt: Date.now(),
          createdAtText: '刚刚',
          authorInitial: '用' // 可以从用户名中获取
        }
        
        // 添加到评论列表
        const updatedComments = [newComment, ...this.data.comments]
        this.setData({ comments: updatedComments })
        
        // 更新帖子的评论数
        if (this.data.post) {
          const updatedPost = {
            ...this.data.post,
            comments: (this.data.post.comments || 0) + 1
          }
          this.setData({ post: updatedPost })
        }
      } else {
        toast('评论失败，请重试')
      }
    } catch (error) {
      console.error('评论失败:', error)
      toast('网络异常，请稍后重试')
    } finally {
      this.setData({ commentLoading: false })
    }
  },

  async toggleLike() {
    if (!isLoggedIn()) {
      await promptLogin({ content: '登录后可以点赞帖子，并同步你的互动记录。' })
      return
    }

    if (!this.data.post || !this.data.post._id) {
      toast('帖子数据加载失败')
      return
    }

    // 乐观更新：立即更新UI
    const previousLiked = this.data.liked
    const previousLikes = this.data.likes
    
    this.setData({
      liked: !this.data.liked,
      likes: this.data.liked ? this.data.likes - 1 : this.data.likes + 1
    })

    try {
      const res = await callApi('campus/posts/like', {
        postId: this.data.post._id
      })

      if (!res.ok) {
        // 如果请求失败，恢复之前的状态
        this.setData({
          liked: previousLiked,
          likes: previousLikes
        })
        toast('点赞失败，请重试')
      } else {
        // 点赞成功反馈
        if (!previousLiked) {
          wx.vibrateShort({ type: 'medium' })
        }
      }
    } catch (error) {
      console.error('点赞失败:', error)
      // 如果请求失败，恢复之前的状态
      this.setData({
        liked: previousLiked,
        likes: previousLikes
      })
      toast('操作失败，请重试')
    }
  },

  navigateBack() {
    wx.navigateBack()
  },

  previewImage(e) {
    const index = e.currentTarget.dataset.index
    if (this.data.post.images) {
      wx.previewImage({
        current: this.data.post.images[index],
        urls: this.data.post.images
      })
    }
  },

  async sendMessageToAuthor(e) {
    const { userId, userName } = e.currentTarget.dataset
    if (!userId) return

    if (!isLoggedIn()) {
      await promptLogin({ content: '登录后可以给作者发送私信。' })
      return
    }

    // 检查用户是否允许陌生人私信
    try {
      const res = await callApi('user/getSettings', { userId })
      if (res.data && res.data.allowStrangerMessages === false) {
        toast('该用户不允许陌生人私信')
        return
      }
      
      // 跳转到聊天页面
      wx.navigateTo({
        url: `/pages/messages/chat?userId=${userId}&userName=${encodeURIComponent(userName || '用户')}`
      })
    } catch (error) {
      console.error('检查用户设置失败:', error)
      // 出错时默认允许私信
      wx.navigateTo({
        url: `/pages/messages/chat?userId=${userId}&userName=${encodeURIComponent(userName || '用户')}`
      })
    }
  },

  async sendFriendRequest(e) {
    const { userId, userName } = e.currentTarget.dataset
    if (!userId) return

    if (!isLoggedIn()) {
      await promptLogin({ content: '登录后可以添加好友并管理好友申请。' })
      return
    }

    try {
      const res = await callApi('friends/sendRequest', { targetUserId: userId })
      if (res.ok) {
        toast('好友申请已发送')
      } else if (res.error === 'self_request') {
        toast('不能添加自己为好友')
      } else if (res.error === 'request_exists') {
        toast('您的好友申请已发送，请等待对方通过')
      } else if (res.error === 'already_friends') {
        toast('已经是好友')
      } else {
        toast('发送失败，请重试')
      }
    } catch (error) {
      console.error('发送好友申请失败:', error)
      toast('发送失败，请重试')
    }
  },

  showUserActionMenu(e) {
    const { userId, userName } = e.currentTarget.dataset
    if (!userId) return

    // 生成短ID（取userId的后8位数字或随机数字）
    let shortId = userId
    if (userId.length > 8) {
      // 提取数字部分
      const numbers = userId.match(/\d+/g)
      if (numbers && numbers.length > 0) {
        shortId = numbers.join('').slice(-8)
      } else {
        // 如果没有数字，生成8位随机数字
        shortId = Math.floor(10000000 + Math.random() * 90000000).toString()
      }
    }

    // 构建用户信息卡片数据
    const userCardInfo = {
      authorId: userId,
      shortId: shortId,
      authorName: userName,
      authorInitial: userName ? userName.charAt(0) : '用',
      likes: Number(e.currentTarget.dataset.likes || 0)
    }

    // 显示用户信息卡片
    this.setData({
      showUserCard: true,
      userCardInfo
    })
  },

  closeUserCard() {
    // 关闭用户信息卡片
    this.setData({ showUserCard: false })
  },

  blacklistUser(userId) {
    // 获取当前黑名单
    const blacklist = wx.getStorageSync('blacklist') || []
    
    // 检查用户是否已经在黑名单中
    if (!blacklist.includes(userId)) {
      // 添加到黑名单
      blacklist.push(userId)
      wx.setStorageSync('blacklist', blacklist)
    }
    
    // 显示提示
    wx.showToast({ 
      title: '已拉黑，将不再看到该用户的内容', 
      icon: 'none' 
    })
    
    // 刷新页面，隐藏被拉黑用户的内容
    this.loadPostDetail()
  },

  toggleEmojiPanel() {
    // 切换表情面板显示状态
    this.setData({ showEmojiPanel: !this.data.showEmojiPanel })
  },

  selectEmoji(e) {
    // 选择表情并插入到输入框，同时关闭面板
    const emoji = e.currentTarget.dataset.emoji
    const commentContent = this.data.commentContent + emoji
    this.setData({ commentContent, showEmojiPanel: false })
  },

  closeEmojiPanel() {
    this.setData({ showEmojiPanel: false })
  },

  chooseImage() {
    // 选择图片
    wx.chooseImage({
      count: 1,
      sizeType: ['original', 'compressed'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        // 显示选择的图片
        const tempFilePaths = res.tempFilePaths
        
        // 上传图片到云存储
        this.uploadImage(tempFilePaths[0])
      },
      fail: (error) => {
        console.error('选择图片失败:', error)
        toast('选择图片失败')
      }
    })
  },

  uploadImage(tempFilePath) {
    // 显示上传中提示
    wx.showLoading({ title: '上传中...' })
    
    // 生成唯一的文件名
    const fileName = `comment/${Date.now()}_${Math.floor(Math.random() * 10000)}.png`
    
    // 上传到云存储
    wx.cloud.uploadFile({
      cloudPath: fileName,
      filePath: tempFilePath,
      success: (res) => {
        
        // 获取图片的云存储URL
        const imageUrl = res.fileID
        
        // 将图片添加到上传图片数组中
        const uploadedImages = [...this.data.uploadedImages, imageUrl]
        this.setData({ uploadedImages })
        
        // 显示上传成功提示
        wx.hideLoading()
        toast('图片上传成功')
      },
      fail: (error) => {
        console.error('上传失败:', error)
        wx.hideLoading()
        toast('图片上传失败')
      }
    })
  },

  removeImage(index) {
    // 从上传图片数组中移除指定索引的图片
    const uploadedImages = [...this.data.uploadedImages]
    uploadedImages.splice(index, 1)
    this.setData({ uploadedImages })
  },

  onAnonymousChange(e) {
    // 切换匿名评论状态
    this.setData({ anonymousComment: e.detail.value[0] === 'anonymous' })
  }
})
