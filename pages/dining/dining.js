// pages/dining/dining.js —— TripMate 吃喝模块（吃喝探索）
// 约定二：数据一律走 utils/store.js 读写，数据结构用 utils/models.js 工厂函数创建
// 禁止直接调用 wx.setStorageSync
const store = require('../../utils/store')
const models = require('../../utils/models')

const TYPES = ['正餐', '火锅', '小吃', '奶茶', '甜品', '其他']
const FILTERS = ['全部'].concat(TYPES)

// 灵感发现占位数据：等拿到集成者的 utils/mock.js 后，替换为从 mock.js 读取（只读，不改公共文件）
const SPOT_IDEAS = [
  { name: '巷子深烧烤', address: '大学城美食街 3 号', type: '小吃', rating: 4.8 },
  { name: '甜心奶茶铺', address: '步行街 12 号', type: '奶茶', rating: 4.6 },
  { name: '四海脆皮鸡', address: '人民路 45 号', type: '正餐', rating: 4.7 },
  { name: '薄荷甜品屋', address: '文化巷 7 号', type: '甜品', rating: 4.9 }
]

Page({
  data: {
    filters: FILTERS,
    filterIndex: 0,
    allList: [],
    shownList: [],
    visitedCount: 0,
    wantCount: 0,
    todayPick: null,
    ideas: SPOT_IDEAS,
    name: '',
    address: '',
    typeIndex: 0,
    types: TYPES
  },

  onLoad() {
    this.refresh()
  },

  onShow() {
    this.refresh()
  },

  // —— 数据刷新：全部从统一数据层读取 ——
  refresh() {
    const list = store.getDiningList()
    this.setData({
      allList: list,
      visitedCount: list.filter(function (item) { return item.visited }).length,
      wantCount: list.filter(function (item) { return !item.visited }).length
    })
    this.applyFilter()
    this.refreshIdeas()
    // 抽中的店如果已被标记去过，就清空重抽
    if (this.data.todayPick) {
      const stillOk = list.some(function (item) {
        return item.id === this.data.todayPick.id && !item.visited
      }, this)
      if (!stillOk) this.setData({ todayPick: null })
    }
  },

  // —— 功能 1：今天吃啥（随机抽签）——
  randomPick() {
    const pool = this.data.allList.filter(function (item) { return !item.visited })
    if (pool.length === 0) {
      this.setData({ todayPick: null })
      wx.showToast({ title: '还没有没去过的店，先添加几家吧', icon: 'none' })
      return
    }
    const pick = pool[Math.floor(Math.random() * pool.length)]
    this.setData({ todayPick: pick })
  },

  // 就去这家：直接把抽中的店标记为「去过」
  confirmPick() {
    const pick = this.data.todayPick
    if (!pick) return
    store.toggleDiningVisited(pick.id)
    this.setData({ todayPick: null })
    wx.showToast({ title: '打卡成功，开吃！', icon: 'none' })
    this.refresh()
  },

  // —— 功能 2：类型筛选 ——
  onFilterChange(e) {
    this.setData({ filterIndex: Number(e.currentTarget.dataset.index) })
    this.applyFilter()
  },

  applyFilter() {
    const list = this.data.allList
    const type = this.data.filterIndex === 0 ? '' : FILTERS[this.data.filterIndex]
    const shown = type
      ? list.filter(function (item) { return item.type === type })
      : list
    this.setData({ shownList: shown })
  },

  // —— 功能 3：灵感发现（示例数据 → 一键收进清单）——
  refreshIdeas() {
    const names = this.data.allList.map(function (item) { return item.name })
    const ideas = SPOT_IDEAS.filter(function (idea) {
      return names.indexOf(idea.name) === -1
    })
    this.setData({ ideas: ideas })
  },

  addIdea(e) {
    const name = e.currentTarget.dataset.name
    const idea = SPOT_IDEAS.find(function (item) { return item.name === name })
    if (!idea) return
    // 先用 models 工厂函数造出标准数据，再交给 store 保存
    store.addDiningItem(models.createDiningItem({
      name: idea.name,
      address: idea.address,
      type: idea.type,
      visited: false
    }))
    wx.showToast({ title: '已加入想吃清单', icon: 'none' })
    this.refresh()
  },

  // —— 添加想吃的店 ——
  onNameInput(e) {
    this.setData({ name: e.detail.value })
  },
  onAddressInput(e) {
    this.setData({ address: e.detail.value })
  },
  onTypeChange(e) {
    this.setData({ typeIndex: Number(e.detail.value) })
  },

  addShop() {
    const name = this.data.name.trim()
    if (!name) {
      wx.showToast({ title: '先写店名哦', icon: 'none' })
      return
    }
    store.addDiningItem(models.createDiningItem({
      name: name,
      address: this.data.address.trim(),
      type: TYPES[this.data.typeIndex],
      visited: false
    }))
    this.setData({ name: '', address: '', typeIndex: 0 })
    this.refresh()
  },

  // —— 标记「去过 / 没去过」——
  toggleVisited(e) {
    const id = e.currentTarget.dataset.id
    store.toggleDiningVisited(id)
    this.refresh()
  }
})


