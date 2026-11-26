const store = require('../../utils/store')
const { formatMoney } = require('../../utils/format')

Page({
  data: {
    tripCount: 0,
    totalExpense: '¥0.00',
    doneCount: 0,
    checkTotal: 0,
    checkinCount: 0,
    transportCount: 0,
    hasData: false,
    statusBarHeight: 44,
    barHeight: 44,
    navTotal: 88
  },

  onLoad() {
    // 自定义导航栏：标题条与右上角胶囊按钮垂直居中对齐
    try {
      const win = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()
      const menu = wx.getMenuButtonBoundingClientRect()
      const barHeight = (menu.top - win.statusBarHeight) * 2 + menu.height
      this.setData({
        statusBarHeight: win.statusBarHeight,
        barHeight: barHeight,
        navTotal: win.statusBarHeight + barHeight
      })
    } catch (e) {
      console.warn('[home] 导航高度计算失败，使用兜底值', e)
    }
  },

  onShow() {
    const trips = store.getTrips()
    // 记账总额：全域统计（含未绑定行程的散笔）
    const total = store.getAllExpenses().reduce((s, e) => s + Number(e.amount || 0), 0)

    // 清单统计：数据源已切换为出行清单模块（tripmate_checklist 分组结构）
    const cl = store.get('tripmate_checklist', null)
    let list = []
    if (cl && Array.isArray(cl.groups)) {
      cl.groups.forEach(g => { (g.items || []).forEach(it => list.push(it)) })
    }
    const checkins = store.getCheckins()
    const transports = store.getTransports()

    this.setData({
      tripCount: trips.length,
      totalExpense: formatMoney(total),
      doneCount: list.filter(i => i.done).length,
      checkTotal: list.length,
      checkinCount: checkins.length,
      transportCount: transports.length,
      hasData: list.length + checkins.length + transports.length > 0
    })
  },
  goFeature(e) {
    wx.navigateTo({ url: e.currentTarget.dataset.url })
  }
})
