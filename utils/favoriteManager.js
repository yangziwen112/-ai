/**
 * 收藏状态管理工具
 * 用于本地存储和同步收藏状态，确保页面间数据一致性
 */

const STORAGE_KEY = 'favorite_status_cache'

class FavoriteManager {
  constructor() {
    this.cache = this.loadFromStorage()
    this.listeners = []
  }

  // 从本地存储加载收藏状态缓存
  loadFromStorage() {
    try {
      const data = wx.getStorageSync(STORAGE_KEY)
      return data || {}
    } catch (error) {
      console.error('加载收藏状态缓存失败:', error)
      return {}
    }
  }

  // 保存收藏状态缓存到本地存储
  saveToStorage() {
    try {
      wx.setStorageSync(STORAGE_KEY, this.cache)
    } catch (error) {
      console.error('保存收藏状态缓存失败:', error)
    }
  }

  // 设置内容的收藏状态
  setFavoriteStatus(contentId, isFavorited) {
    if (!contentId) return
    
    this.cache[contentId] = {
      isFavorited,
      timestamp: Date.now()
    }
    
    this.saveToStorage()
    this.notifyListeners(contentId, isFavorited)
  }

  // 获取内容的收藏状态
  getFavoriteStatus(contentId) {
    if (!contentId) return false
    
    const status = this.cache[contentId]
    return status ? status.isFavorited : false
  }

  // 批量更新内容列表的收藏状态
  updateContentList(contentList) {
    if (!Array.isArray(contentList)) return contentList
    
    return contentList.map(item => ({
      ...item,
      favored: this.getFavoriteStatus(item._id)
    }))
  }

  // 清理过期的缓存数据（保留最近30天的数据）
  cleanExpiredCache() {
    const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000)
    let hasChanges = false
    
    Object.keys(this.cache).forEach(contentId => {
      const status = this.cache[contentId]
      if (status && status.timestamp < thirtyDaysAgo) {
        delete this.cache[contentId]
        hasChanges = true
      }
    })
    
    if (hasChanges) {
      this.saveToStorage()
    }
  }

  // 添加状态变化监听器
  addListener(callback) {
    if (typeof callback === 'function') {
      this.listeners.push(callback)
    }
  }

  // 移除状态变化监听器
  removeListener(callback) {
    const index = this.listeners.indexOf(callback)
    if (index > -1) {
      this.listeners.splice(index, 1)
    }
  }

  // 通知所有监听器状态变化
  notifyListeners(contentId, isFavorited) {
    this.listeners.forEach(callback => {
      try {
        callback(contentId, isFavorited)
      } catch (error) {
        console.error('收藏状态监听器执行失败:', error)
      }
    })
  }

  // 清空所有缓存
  clearCache() {
    this.cache = {}
    this.saveToStorage()
  }
}

// 创建全局单例实例
const favoriteManager = new FavoriteManager()

// 应用启动时清理过期缓存
favoriteManager.cleanExpiredCache()

export default favoriteManager