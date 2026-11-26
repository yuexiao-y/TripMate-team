const store = require('../../utils/store')
const models = require('../../utils/models')
const { formatDate } = require('../../utils/format')

// 当前时刻（时:分），作时间选择器的默认值
function nowTime() {
  const d = new Date()
  const p = n => (n < 10 ? '0' + n : '' + n)
  return p(d.getHours()) + ':' + p(d.getMinutes())
}

Page({
  data: {
    items: [],
    trips: [],     // 行程名单（只读取，用来当打卡分区，绝不修改行程数据）
    filterId: '',  // 当前选中的分区：'' = 全部
    tripNames: ['不归行程'], // 表单"所属行程"下拉的选项（第一项 = 不归行程）
    tripIndex: 0,  // 当前表单选中的行程在下拉里的位置
    showForm: false,
    editingId: '',
    canSubmit: false,
    form: { title: '', content: '', location: '', date: '', time: '', photos: [], tripId: '' }
  },

  onShow() { this.refresh() },

  noop() {},

  refresh() {
    // 行程名单只读取（当分区用），不改行程数据
    const trips = store.getTrips()
    const all = store.getCheckins()
    const list = (this.data.filterId
      ? all.filter(c => c.tripId === this.data.filterId)
      : all)
      .slice()
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
      .map(c => {
        const t = trips.find(x => x.id === c.tripId)
        return {
          ...c,
          cover: (c.photos && c.photos.length) ? c.photos[0] : '',
          initial: (c.title || '记').charAt(0),
          tripName: t ? t.name : ''
        }
      })
    this.setData({ items: list, trips, tripNames: ['不归行程'].concat(trips.map(t => t.name)) })
  },

  /* -------- 顶部分区：全部 / 各行程 -------- */

  onFilterTap(e) {
    const id = e.currentTarget.dataset.id || ''
    if (id === this.data.filterId) return
    this.setData({ filterId: id })
    this.refresh()
  },

  /* -------- 表单里换所属行程 -------- */

  // 行程 id → 下拉选项位置（0 = 不归行程）
  tripIndexOf(tripId) {
    const i = this.data.trips.findIndex(t => t.id === tripId)
    return i >= 0 ? i + 1 : 0
  },

  onTripChange(e) {
    const i = Number(e.detail.value) || 0
    const t = this.data.trips[i - 1]
    this.setData({ tripIndex: i, 'form.tripId': t ? t.id : '' })
  },

  /* ================= 新建/编辑打卡 ================= */

  openForm() {
    const tid = this.data.filterId
    this.setData({
      showForm: true,
      editingId: '',
      canSubmit: false,
      tripIndex: this.tripIndexOf(tid),
      form: { title: '', content: '', location: '', date: formatDate(), time: nowTime(), photos: [], tripId: tid }
    })
  },

  closeForm() { this.setData({ showForm: false }) },

  onTitleInput(e) {
    this.setData({ 'form.title': e.detail.value, canSubmit: e.detail.value.trim().length > 0 })
  },
  onContentInput(e) { this.setData({ 'form.content': e.detail.value }) },
  onLocationInput(e) { this.setData({ 'form.location': e.detail.value }) },
  onDateChange(e) { this.setData({ 'form.date': e.detail.value }) },
  onTimeChange(e) { this.setData({ 'form.time': e.detail.value }) },

  /* -------- 照片 -------- */

  choosePhoto() {
    const left = 9 - this.data.form.photos.length
    if (left <= 0) return wx.showToast({ title: '最多 9 张照片', icon: 'none' })
    wx.chooseMedia({
      count: left,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: res => {
        const temps = res.tempFiles.map(f => f.tempFilePath)
        let done = 0
        const saved = []
        temps.forEach(p => {
          wx.saveFile({
            tempFilePath: p,
            success: r => {
              saved.push(r.savedFilePath)
              if (++done === temps.length) this.setData({ 'form.photos': this.data.form.photos.concat(saved) })
            },
            fail: () => {
              if (++done === temps.length) {
                if (saved.length) this.setData({ 'form.photos': this.data.form.photos.concat(saved) })
                else wx.showToast({ title: '照片保存失败', icon: 'none' })
              }
            }
          })
        })
      }
    })
  },

  onPhotoRemove(e) {
    const i = Number(e.currentTarget.dataset.index)
    const photos = this.data.form.photos.slice()
    photos.splice(i, 1)
    this.setData({ 'form.photos': photos })
  },

  /* -------- 定位 -------- */

  getLocation() {
    wx.chooseLocation({
      success: res => {
        this.setData({ 'form.location': res.name || res.address || '' })
      },
      fail: () => {
        wx.showToast({ title: '定位不可用，可手动输入位置', icon: 'none' })
      }
    })
  },

  /* -------- 提交（完成打卡：提示成功→关弹层→主页网格出现缩略图） -------- */

  submit() {
    const f = this.data.form
    if (!f.title.trim()) return wx.showToast({ title: '请先填写标题', icon: 'none' })
    if (this.data.editingId) {
      const old = store.getCheckins().find(c => c.id === this.data.editingId)
      if (!old) return
      store.updateCheckin({
        ...old,
        title: f.title.trim(),
        content: f.content,
        location: f.location,
        photos: f.photos,
        date: f.date,
        time: f.time,
        tripId: f.tripId || ''
      })
      this.setData({ showForm: false })
      this.refresh()
      wx.showToast({ title: '已保存', icon: 'success' })
    } else {
      // 归属以表单里"所属行程"选的为准；在分区下新建时默认已填好该行程
      store.addCheckin({
        ...models.makeCheckin({
          title: f.title.trim(),
          content: f.content,
          location: f.location,
          photos: f.photos,
          date: f.date,
          time: f.time
        }),
        tripId: f.tripId || ''
      })
      this.setData({ showForm: false })
      this.refresh()
      wx.showToast({ title: '打卡成功', icon: 'success' })
    }
  },

  /* ================= 编辑入口 ================= */

  onCardTap(e) {
    const id = e.currentTarget.dataset.id
    const item = store.getCheckins().find(c => c.id === id)
    if (!item) return
    this.setData({
      showForm: true,
      editingId: id,
      canSubmit: true,
      tripIndex: this.tripIndexOf(item.tripId || ''),
      form: {
        title: item.title || '',
        content: item.content || '',
        location: item.location || '',
        date: item.date || formatDate(),
        time: item.time || nowTime(),
        photos: (item.photos || []).slice(),
        tripId: item.tripId || ''
      }
    })
  },

  onDeleteCheckin() {
    const id = this.data.editingId
    if (!id) return
    wx.showModal({
      title: '删除打卡',
      content: '删除后不可恢复，确定删除吗？',
      success: res => {
        if (!res.confirm) return
        store.removeCheckin(id)
        this.setData({ showForm: false, editingId: '' })
        this.refresh()
        wx.showToast({ title: '已删除', icon: 'success' })
      }
    })
  }
})
