const app = getApp()

export function callApi(route, data = {}) {
  if (!app?.callApi) {
    return Promise.reject(new Error('App not initialized'))
  }
  return app.callApi(route, data)
}

export function withLoading(promise, title = '加载中') {
  wx.showLoading({ title, mask: true })
  return promise.finally(() => wx.hideLoading())
}

export function toast(title, icon = 'none') {
  wx.showToast({ title, icon })
}

export function debounce(fn, delay = 300) {
  let timer = null
  return function(...args) {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => fn.apply(this, args), delay)
  }
} 