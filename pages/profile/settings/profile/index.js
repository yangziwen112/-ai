import { callApi, toast } from '../../../../utils/request'
import { getUserId, getUser } from '../../../../utils/auth'

Page({
  data: {
    user: {}
  },

  onLoad() {
    this.loadUserInfo()
  },

  loadUserInfo() {
    const user = getUser()
    if (user) {
      this.setData({ user })
    }
  },

  async chooseAvatar() {
    const userId = getUserId()
    if (!userId) {
      toast('请先登录')
      return
    }

    try {
      const res = await wx.chooseMedia({
        count: 1,
        mediaType: ['image'],
        sourceType: ['album', 'camera'],
        sizeType: ['compressed'],
        maxDuration: 30,
        camera: 'back'
      })

      if (res.tempFiles && res.tempFiles.length > 0) {
        const tempFile = res.tempFiles[0]
        await this.uploadAvatar(tempFile.tempFilePath)
      }
    } catch (error) {
      console.error('选择头像失败:', error)
      if (error.errMsg !== 'chooseMedia:fail cancel') {
        toast('选择头像失败，请重试')
      }
    }
  },

  async uploadAvatar(tempFilePath) {
    const userId = getUserId()
    if (!userId) return

    try {
      // 上传图片到云存储
      const cloudPath = `avatars/${userId}/${Date.now()}.jpg`
      const uploadResult = await wx.cloud.uploadFile({
        cloudPath,
        filePath: tempFilePath
      })

      if (uploadResult.fileID) {
        // 更新用户头像
        const res = await callApi('user/updateAvatar', {
          userId,
          avatarUrl: uploadResult.fileID
        })

        if (res.ok) {
          // 更新本地用户信息
          const user = getUser()
          user.avatarUrl = uploadResult.fileID
          wx.setStorageSync('userInfo', user)
          this.setData({ user })
          toast('头像更新成功')
        } else {
          toast('头像更新失败，请重试')
        }
      } else {
        toast('上传失败，请重试')
      }
    } catch (error) {
      console.error('上传头像失败:', error)
      toast('上传失败，请重试')
    }
  },

  navigateToPasswordChange() {
    const userId = getUserId()
    if (!userId) {
      toast('请先登录')
      return
    }

    wx.navigateTo({
      url: '/pages/reset-password/index'
    })
  }
})