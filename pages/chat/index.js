const { isLoggedIn, getUser, waitForAuthReady } = require('../../utils/auth')
const { callApi } = require('../../utils/request')

Page({
  data: {
    question: '',
    imageAttachments: [],
    uploadingImages: false,
    messages: [],
    isLoading: false,
    workflowStage: '',
    scrollToView: '',
    showEmojiPanel: false,
    isLoggedIn: false,
    guestMessageCount: 0,
    maxGuestMessages: 3,
    conversationId: '',
    conversationTitle: '新对话',
    conversations: [],
    showConversationList: false,
    emojis: [
      '😊', '😂', '❤️', '👍', '👎', '👋', '🎉', '🔥',
      '🤔', '😢', '😡', '😍', '🤩', '😎', '🤗', '🤫',
      '🤭', '🤮', '🤠', '🤢', '🤬', '🤧', '🥳', '🤯'
    ]
  },

  async onLoad() {
    await waitForAuthReady()
    await this.checkLoginAndLoad()
  },

  async onShow() {
    await waitForAuthReady()
    // 只检查登录状态变化，不重复加载历史（onLoad已加载）
    const loggedIn = isLoggedIn()
    if (this.authSnapshot !== undefined && this.authSnapshot !== loggedIn) {
      await this.checkLoginAndLoad()
    }
  },

  onUnload() {
    this.stopWorkflowAnimation()
  },

  async checkLoginAndLoad() {
    if (this.historyLoadPromise) return this.historyLoadPromise
    const loggedIn = isLoggedIn()
    this.authSnapshot = loggedIn
    this.setData({ isLoggedIn: loggedIn })
    if (!this.data.conversationId) {
      const storedConversationId = wx.getStorageSync('activeAiConversationId')
      if (storedConversationId) {
        const conversations = await this.loadConversations()
        const stored = conversations.find(item => item.conversationId === storedConversationId)
        if (stored || !conversations.length) {
          this.setData({ conversationId: storedConversationId, conversationTitle: stored?.title || '新对话' })
        } else {
          this.setData({ conversationId: conversations[0].conversationId, conversationTitle: conversations[0].title })
          wx.setStorageSync('activeAiConversationId', conversations[0].conversationId)
        }
      } else {
        const conversations = await this.loadConversations()
        if (conversations.length) {
          this.setData({ conversationId: conversations[0].conversationId, conversationTitle: conversations[0].title })
          wx.setStorageSync('activeAiConversationId', conversations[0].conversationId)
        } else this.createConversationId()
      }
    }
    this.historyLoadPromise = this.loadHistoryMessages().finally(() => {
      this.historyLoadPromise = null
    })
    return this.historyLoadPromise
  },

  createConversationId() {
    const id = `chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    this.setData({ conversationId: id, conversationTitle: '新对话', messages: [] })
    wx.setStorageSync('activeAiConversationId', id)
    return id
  },

  async loadConversations() {
    try {
      const result = await callApi('ai/conversations/list', { appUserId: this.getAppUserId() })
      const conversations = result.conversations || []
      this.setData({ conversations })
      return conversations
    } catch (error) {
      console.warn('加载AI会话列表失败:', error.message)
      return []
    }
  },

  toggleConversationList() {
    if (!this.data.showConversationList) this.loadConversations()
    this.setData({ showConversationList: !this.data.showConversationList })
  },

  async selectConversation(e) {
    if (this.data.isLoading) return
    const conversationId = e.currentTarget.dataset.conversationId
    if (!conversationId) return
    this.setData({ conversationId, conversationTitle: e.currentTarget.dataset.conversationTitle || '历史对话', showConversationList: false, messages: [] })
    wx.setStorageSync('activeAiConversationId', conversationId)
    await this.loadHistoryMessages()
  },

  newConversation() {
    if (this.data.isLoading) return
    this.createConversationId()
    this.showWelcomeMessage()
    this.setData({ question: '', imageAttachments: [] })
  },

  // 获取当前用户标识（登录用户用userId，游客用openid）
  getAppUserId() {
    const user = getUser()
    return user && user.userId ? user.userId : null
  },

  async loadHistoryMessages() {
    try {
      const appUserId = this.getAppUserId()
      const result = await callApi('ai/messages/list', { appUserId, conversationId: this.data.conversationId, pageSize: 30 })
      if (result.messages && result.messages.length > 0) {
        const rawMessages = await this.hydrateMessageImages(result.messages.slice(-30))
        const latestAssistantIndex = rawMessages.reduce((latest, message, index) => message.role === 'assistant' ? index : latest, -1)
        const messages = rawMessages.map((message, index) => ({
          ...message,
          contentParts: this.parseContentParts(message.content, message.links || []),
          showCompanionAnimation: index === latestAssistantIndex,
          bubbleEmojis: null
        }))
        this.setData({ messages })
        // 计算游客已发消息数
        if (!this.data.isLoggedIn) {
          const userMsgCount = messages.filter(m => m.role === 'user').length
          this.setData({ guestMessageCount: userMsgCount })
        }
        // 自动滚动到最新消息
        this.scrollToBottom()
      } else {
        this.showWelcomeMessage()
      }
    } catch (error) {
      console.error('加载历史消息失败:', error)
      this.showWelcomeMessage()
      // 历史加载失败时，游客计数设为0，仍限制消息数
      if (!this.data.isLoggedIn) {
        this.setData({ guestMessageCount: 0 })
      }
    }
  },

  showWelcomeMessage() {
    const welcomeMsg = this.data.isLoggedIn
      ? '你好，我可以帮你查校园通知、竞赛、讲座、就业和考试信息。'
      : '你好。游客可以体验 3 次问答，登录后可继续使用。'
    this.setData({
      messages: [{
        role: 'assistant',
        content: welcomeMsg,
        showCompanionAnimation: true,
        bubbleEmojis: null
      }]
    })
  },

  onQuestionInput(e) {
    this.setData({ question: e.detail.value })
  },

  async hydrateMessageImages(messages) {
    const fileIds = messages
      .flatMap(message => Array.isArray(message.imageFileIds) ? message.imageFileIds : [])
      .filter(fileId => typeof fileId === 'string' && fileId.startsWith('cloud://'))
    if (!fileIds.length || !wx.cloud?.getTempFileURL) return messages
    try {
      const result = await wx.cloud.getTempFileURL({ fileList: [...new Set(fileIds)] })
      const urlMap = {}
      ;(result.fileList || []).forEach(item => {
        if (item.status === 0 && item.tempFileURL) urlMap[item.fileID] = item.tempFileURL
      })
      return messages.map(message => ({
        ...message,
        images: (message.imageFileIds || []).map(fileId => urlMap[fileId]).filter(Boolean)
      }))
    } catch (error) {
      console.warn('恢复历史图片失败:', error.message)
      return messages
    }
  },

  chooseImage() {
    if (this.data.uploadingImages || this.data.imageAttachments.length >= 4) {
      wx.showToast({ title: '最多上传4张图片', icon: 'none' })
      return
    }
    wx.chooseImage({
      count: 4 - this.data.imageAttachments.length,
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
      success: res => this.uploadChatImages(res.tempFilePaths || [])
    })
  },

  async uploadChatImages(paths) {
    if (!paths.length) return
    this.setData({ uploadingImages: true })
    wx.showLoading({ title: '上传图片…', mask: true })
    try {
      const uploaded = []
      for (const filePath of paths) {
        const upload = await wx.cloud.uploadFile({
          cloudPath: `ai-chat/${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`,
          filePath
        })
        const tempResult = await wx.cloud.getTempFileURL({ fileList: [upload.fileID] })
        const tempUrl = tempResult.fileList?.[0]?.tempFileURL
        if (upload.fileID && tempUrl) uploaded.push({ fileID: upload.fileID, tempUrl })
      }
      this.setData({ imageAttachments: this.data.imageAttachments.concat(uploaded) })
    } catch (error) {
      console.error('上传聊天图片失败:', error)
      wx.showToast({ title: '图片上传失败，请重试', icon: 'none' })
    } finally {
      wx.hideLoading()
      this.setData({ uploadingImages: false })
    }
  },

  removeChatImage(e) {
    const index = Number(e.currentTarget.dataset.index)
    this.setData({ imageAttachments: this.data.imageAttachments.filter((_, i) => i !== index) })
  },

  async askQuestion() {
    const hasImages = this.data.imageAttachments.length > 0
    if (!this.data.question.trim() && !hasImages) return
    
    // 游客模式限制
    if (!this.data.isLoggedIn && this.data.guestMessageCount >= this.data.maxGuestMessages) {
      wx.showModal({
        title: '提示',
        content: '游客可以体验 3 次 AI 对话。登录后可以继续提问，并保存完整对话记录。',
        confirmText: '去登录',
        cancelText: '再看看',
        success: (res) => {
          if (res.confirm) {
            wx.navigateTo({ url: '/pages/auth-login/index?redirect=%2Fpages%2Fchat%2Findex' })
          }
        }
      })
      return
    }
    
    const query = this.data.question.trim()
    const imageAttachments = this.data.imageAttachments.slice()
    const userMsg = {
      role: 'user',
      content: query || '请帮我理解这张图片。',
      images: imageAttachments.map(item => item.tempUrl)
    }
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
    this.setData({
      messages: [...this.data.messages, userMsg],
      isLoading: true,
      workflowStage: '正在理解问题'
    })
    this.startWorkflowAnimation()

    // 发送消息后立即滚动到底部
    this.scrollToBottom()

    try {
      const result = await this.callWithTimeout(
        callApi('rag/chat', {
          query,
          imageFileIds: imageAttachments.map(item => item.fileID),
          imageUrls: imageAttachments.map(item => item.tempUrl),
          appUserId: this.getAppUserId(),
          requestId,
          conversationId: this.data.conversationId
        }),
        55000
      )
      
      if (result.code === 200 && result.data && result.data.answer) {
        let answer = result.data.answer
        const links = result.data.links || []
        const nextGuestMessageCount = this.data.isLoggedIn
          ? this.data.guestMessageCount
          : Math.min(this.data.guestMessageCount + 1, this.data.maxGuestMessages)
        
        if (!this.data.isLoggedIn && nextGuestMessageCount >= this.data.maxGuestMessages) {
          answer += '\n\n你已经完成 3 次游客体验。登录后可以继续提问，并保存我们的对话记录。'
        }
        
        // 解析【】标记的内容为可点击部件
        const contentParts = this.parseContentParts(answer, links)
        
        const botMsg = {
          role: 'assistant', 
          content: answer, 
          contentParts,
          links,
          meta: result.data.meta || {},
          showCompanionAnimation: true,
          bubbleEmojis: null
        }
        this.stopWorkflowAnimation()
        this.setData({
          messages: [...this.data.messages.map(message => ({ ...message, showCompanionAnimation: false, bubbleEmojis: null })), botMsg],
          isLoading: false,
          workflowStage: '',
          question: '',
          imageAttachments: [],
          guestMessageCount: nextGuestMessageCount
        })
        this.loadConversations()
        
        // 收到回复后再次滚动到底部
        setTimeout(() => {
          this.scrollToBottom()
        }, 100)
      } else {
        console.error('AI服务返回错误:', { code: result?.code, message: result?.message })
        if (result.message === 'guest_limit_reached') {
          this.stopWorkflowAnimation()
          this.setData({
            messages: this.data.messages.slice(0, -1),
            isLoading: false,
            workflowStage: '',
            guestMessageCount: this.data.maxGuestMessages
          })
          wx.showModal({
            title: '游客体验已完成',
            content: '游客可以体验 3 次 AI 对话。登录后可以继续提问并保存记录。',
            confirmText: '去登录',
            cancelText: '再看看',
            success: modal => modal.confirm && wx.navigateTo({ url: '/pages/auth-login/index?redirect=%2Fpages%2Fchat%2Findex' })
          })
          return
        }
        if (result.message === 'RAG_FUNCTION_EXECUTE_FAIL') {
          this.stopWorkflowAnimation()
          this.setData({ messages: this.data.messages.slice(0, -1), isLoading: false, workflowStage: '' })
          wx.showModal({
            title: 'AI 服务正在启动',
            content: '云端 AI 服务暂时没有正常启动，请稍后再试；管理员可在云开发日志中检查 RAG 配置。',
            showCancel: false
          })
          return
        }
        if (result.message === 'RAG_INTERNAL_TOKEN_MISSING') {
          this.stopWorkflowAnimation()
          this.setData({ messages: this.data.messages.slice(0, -1), isLoading: false, workflowStage: '' })
          wx.showModal({
            title: 'AI 服务尚未配置',
            content: '请管理员为 api 和 rag 云函数配置相同的 RAG_INTERNAL_TOKEN，然后重新部署。',
            showCancel: false
          })
          return
        }
        if (result.message === 'RAG_INTERNAL_ACCESS_DENIED') {
          this.stopWorkflowAnimation()
          this.setData({ messages: this.data.messages.slice(0, -1), isLoading: false, workflowStage: '' })
          wx.showModal({
            title: 'AI 内部配置不一致',
            content: 'api 和 rag 云函数的 RAG_INTERNAL_TOKEN 不一致。请在同一个云环境中为两个云函数配置完全相同的值，然后分别重新部署 api 和 rag。',
            showCancel: false
          })
          return
        }
        if (result.message === 'RAG_DEPLOYMENT_OUTDATED' || result.message === 'RAG_PROTOCOL_MISMATCH') {
          this.stopWorkflowAnimation()
          this.setData({ messages: this.data.messages.slice(0, -1), isLoading: false, workflowStage: '' })
          wx.showModal({
            title: 'AI 云函数版本过旧',
            content: '当前云端 rag 仍是旧测试版本，请全量上传 rag，并选择“云端安装依赖”。',
            showCancel: false
          })
          return
        }
        if (result.message === 'AI_VISION_SERVICE_UNAVAILABLE') {
          this.stopWorkflowAnimation()
          this.setData({ messages: this.data.messages.slice(0, -1), isLoading: false, workflowStage: '' })
          wx.showModal({
            title: '图片理解服务未就绪',
            content: '图片已经上传成功，但当前 AI 模型不支持图片理解。请管理员在 rag 云函数配置支持视觉输入的 DEEPSEEK_VISION_MODEL。',
            showCancel: false
          })
          return
        }
        // 友好提示代替通用toast
        const friendlyMsg = { 
          role: 'assistant', 
          content: this.getFriendlyErrorMessage(),
          bubbleEmojis: null
        }
        this.stopWorkflowAnimation()
        this.setData({
          messages: [...this.data.messages, friendlyMsg],
          isLoading: false,
          workflowStage: '',
          question: '',
          imageAttachments: []
        })
      }
      
    } catch (err) {
      console.error('请求失败:', err)
      // 超时 vs 其他错误
      const isTimeout = err.message === 'TIMEOUT'
      const friendlyText = isTimeout 
        ? this.getFriendlyTimeoutMessage() 
        : this.getFriendlyErrorMessage()
      
      const friendlyMsg = { 
        role: 'assistant', 
        content: friendlyText,
        bubbleEmojis: null
      }
      this.stopWorkflowAnimation()
      this.setData({
        messages: [...this.data.messages, friendlyMsg],
        isLoading: false,
        workflowStage: '',
        question: ''
      })
    }
  },

  startWorkflowAnimation() {
    this.stopWorkflowAnimation()
    const stages = ['正在理解问题', '正在查询信息', '正在整理回答']
    let index = 0
    this.workflowTimer = setInterval(() => {
      index = Math.min(index + 1, stages.length - 1)
      this.setData({ workflowStage: stages[index] })
    }, 1800)
  },

  stopWorkflowAnimation() {
    if (this.workflowTimer) clearInterval(this.workflowTimer)
    this.workflowTimer = null
  },
  
  scrollToBottom() {
    setTimeout(() => {
      const lastIdx = this.data.messages.length - 1
      if (lastIdx >= 0) {
        this.setData({ scrollToView: `msg-${lastIdx}` })
      }
    }, 150)
  },

  // 超时包装函数
  callWithTimeout(promise, timeoutMs = 15000) {
    return Promise.race([
      promise,
      new Promise((_, reject) => 
        setTimeout(() => reject(new Error('TIMEOUT')), timeoutMs)
      )
    ])
  },

  // 获取友好超时提示
  getFriendlyTimeoutMessage() {
    return '请求超时了，请稍后重试。'
  },

  // 获取友好错误提示
  getFriendlyErrorMessage() {
    return '暂时无法回答，请稍后重试。'
  },

  navigateBack() {
    wx.navigateBack()
  },

  // 点击聊天区域隐藏键盘和表情面板
  onChatAreaTap() {
    this.setData({ showEmojiPanel: false })
    // 通过wx.hideKeyboard隐藏键盘
    wx.hideKeyboard()
  },

  toggleEmojiPanel() {
    this.setData({ showEmojiPanel: !this.data.showEmojiPanel })
  },

  selectEmoji(e) {
    const emoji = e.currentTarget.dataset.emoji
    const question = this.data.question + emoji
    this.setData({ question })
  },

  // 解析消息内容，将【】标记的文本转为可点击部件
  parseContentParts(content, links) {
    if (!content) return null
    const parts = []
    const regex = /【([^】]+)】/g
    let lastIndex = 0
    let match
    
    while ((match = regex.exec(content)) !== null) {
      // 前面的文本
      if (match.index > lastIndex) {
        parts.push({ type: 'text', text: content.substring(lastIndex, match.index) })
      }
      // 高亮的标题 - 尝试匹配links中的内容
      const title = match[1]
      const matchedLink = links.find(l => l.title === title || l.title.includes(title) || title.includes(l.title))
      parts.push({
        type: 'highlight',
        text: `【${title}】`,
        link: matchedLink || { type: 'content', title }
      })
      lastIndex = match.index + match[0].length
    }
    
    // 剩余文本
    if (lastIndex < content.length) {
      parts.push({ type: 'text', text: content.substring(lastIndex) })
    }
    
    return parts.length > 0 ? parts : null
  },

  // 点击链接卡片
  onTapLink(e) {
    const link = e.currentTarget.dataset.link
    if (!link) return
    
    if (link.type === 'content') {
      if (link.id) {
        wx.navigateTo({ url: `/pages/detail/index?id=${link.id}` })
      } else {
        wx.switchTab({ url: '/pages/home/index' })
      }
    } else if (link.type === 'web') {
      if (link.url) {
        wx.setClipboardData({
          data: link.url,
          success: () => {
            wx.showToast({ title: '链接已复制', icon: 'success' })
          }
        })
      }
    }
  },

  // 点击【】标记的内容链接
  onTapContentLink(e) {
    const link = e.currentTarget.dataset.link
    if (!link) return
    this.onTapLink({ currentTarget: { dataset: { link } } })
  },

  // 生成AI气泡浮动表情粒子
  getBubbleEmojis() {
    const emojiPool = ['💕', '✨', '🌟', '💫', '🌸', '💖', '🎀', '💝', '🌷', '⭐']
    const count = 3 + Math.floor(Math.random() * 3) // 3-5个
    const emojis = []
    for (let i = 0; i < count; i++) {
      emojis.push({
        char: emojiPool[Math.floor(Math.random() * emojiPool.length)],
        delay: Math.random() * 1.5,
        left: 10 + Math.random() * 80,
        top: 20 + Math.random() * 60
      })
    }
    return emojis
  }
})
