const store = require('../../utils/store')
const models = require('../../utils/models')

const TYPES = ['景点', '餐饮', '交通', '住宿', '购物', '其他']
const DAY_MS = 24 * 60 * 60 * 1000

function uid() {
  return 'day_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
}

function today() {
  const d = new Date()
  const p = n => (n < 10 ? '0' + n : '' + n)
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
}

function diffDays(start, end) {
  return Math.floor((new Date(end).getTime() - new Date(start).getTime()) / DAY_MS) + 1
}

Page({
  data: {
    view: 'list',
    trips: [],
    trip: null,
    groupedDays: [],
    dayCount: 0,
    expenseTotal: 0,
    showCreate: false,
    showItem: false,
    editingId: null,
    types: TYPES,
    minDate: today(),
    form: { name: '', startDate: '', endDate: '' },
    itemForm: { date: '', time: '', type: '景点', title: '', location: '', note: '' }
  },

  onLoad() { this.currentId = ''; this.refreshList() },
  onShow() { if (this.data.view === 'list') this.refreshList() },

  noop() {},

  /* ================= 列表态 ================= */

  refreshList() {
    const t = today()
    const order = { ongoing: 0, upcoming: 1, past: 2, done: 3 }
    const trips = store.getTrips().map(trip => {
      let status = 'upcoming'
      if (trip.completed) status = 'done'
      else if (t >= trip.startDate && t <= trip.endDate) status = 'ongoing'
      else if (t > trip.endDate) status = 'past'
      const textMap = { ongoing: '进行中', upcoming: '未开始', past: '已完成', done: '已完成' }
      return { ...trip, totalDays: diffDays(trip.startDate, trip.endDate), status, statusText: textMap[status] }
    })
    trips.sort((a, b) => order[a.status] - order[b.status] || (a.startDate < b.startDate ? -1 : 1))
    this.setData({ trips })
  },
  
  onRemoveTrip(e) {
    const id = e.currentTarget.dataset.id
    wx.showModal({
      title: '删除行程',
      content: '删除后该行程和全部日程不可恢复，确定删除吗？',
      success: res => {
        if (!res.confirm) return
        if (typeof store.removeTrip !== 'function') {
          wx.showToast({ title: '需集成者在 store.js 补充 removeTrip', icon: 'none' })
          return
        }
        store.removeTrip(id)
        this.refreshList()
        wx.showToast({ title: '已删除', icon: 'success' })
      }
    })
  },
  
  goHome() {
    wx.reLaunch({ url: '/pages/home/home' })
  },

  openCreate() {
    this.setData({ showCreate: true, form: { name: '', startDate: '', endDate: '' } })
  },
  closeCreate() { this.setData({ showCreate: false }) },
  onNameInput(e) { this.setData({ 'form.name': e.detail.value }) },
  onStartChange(e) { this.setData({ 'form.startDate': e.detail.value }) },
  onEndChange(e) { this.setData({ 'form.endDate': e.detail.value }) },

  submitTrip() {
    const form = this.data.form
    if (!form.name.trim()) return wx.showToast({ title: '请填写行程名称', icon: 'none' })
    if (!form.startDate || !form.endDate) return wx.showToast({ title: '请选择出发和返程日期', icon: 'none' })
    if (diffDays(form.startDate, form.endDate) < 1) return wx.showToast({ title: '返程不能早于出发', icon: 'none' })
    const trip = models.makeTrip({ name: form.name.trim(), startDate: form.startDate, endDate: form.endDate, cover: '' })
    store.saveTrip(trip)
    this.setData({ showCreate: false })
    this.refreshList()
    wx.showToast({ title: '已创建', icon: 'success' })
  },

  openDetail(e) {
    this.currentId = e.currentTarget.dataset.id
    this.setData({ view: 'detail' })
    this.refreshDetail()
  },
  backToList() {
    this.setData({ view: 'list' })
    this.refreshList()
  },

  /* ================= 详情态 ================= */

  getFreshTrip() {
    return store.getTrips().find(t => t.id === this.currentId)
  },
  toggleComplete() {
    const trip = this.getFreshTrip()
    if (!trip) return
    trip.completed = !trip.completed
    store.saveTrip(trip)
    this.refreshDetail()
    wx.showToast({ title: trip.completed ? '已标记完成' : '已取消完成', icon: 'success' })
  },
  
  refreshDetail() {
    const raw = this.getFreshTrip()
    if (!raw) { this.backToList(); return }
    const days = (raw.days || []).slice().sort((a, b) => ((a.date + a.time) < (b.date + b.time) ? -1 : 1))
    const dates = []
    days.forEach(d => { if (dates.indexOf(d.date) < 0) dates.push(d.date) })
    dates.sort()
    const groupedDays = dates.map((date, i) => ({
      date,
      label: date.slice(5).replace('-', '月') + '日 · 第' + (i + 1) + '天',
      items: days.filter(d => d.date === date).map(d => ({ ...d, typeChar: d.type.charAt(0) }))
    }))
    const total = store.getExpenses(raw.id).reduce((s, e) => s + (Number(e.amount) || 0), 0)
    this.setData({
      trip: { ...raw, totalDays: diffDays(raw.startDate, raw.endDate) },
      groupedDays,
      dayCount: days.length,
      expenseTotal: Math.round(total * 100) / 100
    })
  },

  openAddSheet() {
    const trip = this.data.trip
    const t = today()
    const date = t >= trip.startDate && t <= trip.endDate ? t : trip.startDate
    this.setData({
      showItem: true,
      editingId: null,
      itemForm: { date, time: '', type: '景点', title: '', location: '', note: '' }
    })
  },
  closeItem() { this.setData({ showItem: false }) },
  onItemDateChange(e) { this.setData({ 'itemForm.date': e.detail.value }) },
  onTimeChange(e) { this.setData({ 'itemForm.time': e.detail.value }) },
  onTypeTap(e) { this.setData({ 'itemForm.type': e.currentTarget.dataset.type }) },
  onTitleInput(e) { this.setData({ 'itemForm.title': e.detail.value }) },
  onLocInput(e) { this.setData({ 'itemForm.location': e.detail.value }) },
  onNoteInput(e) { this.setData({ 'itemForm.note': e.detail.value }) },

  onEditItem(e) {
    const id = e.currentTarget.dataset.id
    const it = (this.getFreshTrip().days || []).find(d => d.id === id)
    if (!it) return
    this.setData({
      showItem: true,
      editingId: id,
      itemForm: { date: it.date, time: it.time, type: it.type, title: it.title, location: it.location, note: it.note }
    })
  },

  submitItem() {
    const f = this.data.itemForm
    if (!f.title.trim()) return wx.showToast({ title: '请填写做什么', icon: 'none' })
    if (!f.time) return wx.showToast({ title: '请选择时间', icon: 'none' })
    const trip = this.getFreshTrip()
    if (!trip) return
    const days = (trip.days || []).slice()
    if (this.data.editingId) {
      const i = days.findIndex(d => d.id === this.data.editingId)
      if (i >= 0) days[i] = { ...days[i], date: f.date, time: f.time, type: f.type, title: f.title.trim(), location: f.location, note: f.note }
    } else {
      days.push({
        ...models.makeDayItem({ time: f.time, type: f.type, title: f.title.trim(), location: f.location, note: f.note }),
        id: uid(),
        date: f.date
      })
    }
    trip.days = days
    store.saveTrip(trip)
    this.setData({ showItem: false })
    this.refreshDetail()
    wx.showToast({ title: '已保存', icon: 'success' })
  },

  onDeleteItem(e) {
    const id = e.currentTarget.dataset.id
    this.confirmDelete(id)
  },

  deleteCurrent() {
    const id = this.data.editingId
    if (!id) return
    this.confirmDelete(id)
  },

  confirmDelete(id) {
    wx.showModal({
      title: '删除日程',
      content: '确定删除这条日程吗？',
      success: res => {
        if (!res.confirm) return
        const trip = this.getFreshTrip()
        if (!trip) return
        trip.days = (trip.days || []).filter(d => d.id !== id)
        store.saveTrip(trip)
        this.setData({ showItem: false, editingId: null })
        this.refreshDetail()
        wx.showToast({ title: '已删除', icon: 'success' })
      }
    })
  }
})
