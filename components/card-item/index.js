Component({
  properties: {
    item: { type: Object, value: {} },
    isAdmin: { type: Boolean, value: false }
  },

  methods: {
    onTap() {
      const id = this.data.item?._id
      if (id) wx.navigateTo({ url: `/pages/detail/index?id=${id}` })
    },

    onToggleFavorite() {
      const id = this.data.item?._id
      if (id) this.triggerEvent('favorite', { id })
    },

    onLongPress() {
      if (!this.data.isAdmin) return
      const { _id, title } = this.data.item
      wx.showActionSheet({
        itemList: ['编辑资讯', '删除资讯'],
        success: (res) => {
          if (res.tapIndex === 0) {
            this.triggerEvent('edit', { id: _id, item: this.data.item })
          } else if (res.tapIndex === 1) {
            wx.showModal({
              title: '确认删除',
              content: `确定删除「${title}」吗？`,
              confirmText: '删除',
              confirmColor: '#DC2626',
              success: modalRes => {
                if (modalRes.confirm) this.triggerEvent('delete', { id: _id })
              }
            })
          }
        }
      })
    }
  }
})
