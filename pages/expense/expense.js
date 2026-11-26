// pages/expense/expense.js —— 预算记账模块（负责人：龙悦）v1.3
// 团队约定：
//  1) 只动 pages/expense/，公共文件（app.* / utils / components / pages/home）一律不改；
//  2) 数据一律走 utils/store.js，记录用 utils/models.js 工厂函数创建，
//     页面内禁止直接调用 wx.setStorageSync；
//  3) 命名：变量 camelCase、组件 PascalCase。
//
// 用到的 store 接口：getTrips / saveTrip / getExpenses / addExpense（store.js 均已提供）。
// 「编辑 / 删除 / 预算 / 成员 / 结清标记」均采用「同 id 追加覆盖」实现，读取时按 id
// 归并（后写的生效、_deleted 的丢弃）；集成者后续补充 updateExpense / removeExpense
// 后只需替换 doSave / onDeleteTap 两处调用。
//
// v1.2（方案 A+C + 分摊开关）：
//  - 行程成员名单：固定 id = members_行程id、_kind='members'（A）
//  - 每笔可选「需要分摊结算」needsSettle：默认不勾；老数据（无该字段）一律视为不需要分摊，
//    不进结算；不勾时隐藏付款人/参与人字段；明细里 AA 小标
//  - 参与人 participants：默认全名单可裁剪（C），结算按每笔参与人均摊
//  - Day 切换统计 / 分类预算（_kind='catbudget'）/ 复制上一笔 / 标记已结清（_kind='settled'，仅展示不参与计算）
// v1.3：
//  - 汇总卡「我的花费 / 总花费」切换（默认「我的」）：我的 = 个人消费全额 + 每笔 AA 中
//    我的份额（不论谁垫付，与结算应承担同规则、含尾差顺延；记/删/改后实时重算）
//  - 参与人行尾「＋」现场加人：写入行程成员名单，实时同步到垫付人选项与结算页出行成员
const store = require('../../utils/store')
const models = require('../../utils/models')
const { formatDate, formatMoney } = require('../../utils/format')

// 旅行场景九宫格分类（emoji 图标，不依赖公共图片资源）
const CATEGORIES = [
  { id: 'food', name: '餐饮', icon: '🍜' },
  { id: 'transport', name: '交通', icon: '🚌' },
  { id: 'hotel', name: '住宿', icon: '🏨' },
  { id: 'ticket', name: '门票', icon: '🎫' },
  { id: 'shopping', name: '购物', icon: '🛍️' },
  { id: 'fun', name: '娱乐', icon: '🎡' },
  { id: 'medicine', name: '药品', icon: '💊' },
  { id: 'phone', name: '通讯', icon: '📱' },
  { id: 'other', name: '其他', icon: '📦' }
]

const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

// 金额一律以「分」为整数累加，避免浮点误差
function toFen(n) { return Math.round((Number(n) || 0) * 100) }
function fenToYuan(fen) { return fen / 100 }

// 解析 YYYY-MM-DD（自写 split，规避 iOS 对日期字符串的兼容问题）
function parseDate(str) {
  const arr = String(str || '').split('-')
  return new Date(Number(arr[0]), Number(arr[1]) - 1, Number(arr[2]))
}

// 归并「追加覆盖」的原始记录：同 id 后写的生效，标记 _deleted 的丢弃
function compactExpenses(raw) {
  const map = {}
  raw.forEach((e, index) => {
    map[e.id] = Object.assign({}, map[e.id], e, { seq: index })
  })
  return Object.keys(map).map(k => map[k]).filter(e => !e._deleted)
}

Page({
  data: {
    // 行程
    hasTrip: false,
    tripCount: 0, tripIndex: 0, tripNames: [], tripName: '', dayText: '',
    // 视图状态
    activeTab: 'list',       // list 明细 | stats 统计 | settle 结算
    orderMode: 'time',       // time 按时间 | amount 按金额
    filterDate: '',          // 明细页日期筛选，空 = 全部
    openId: '',              // 左滑展开删除按钮的条目 id
    // 列表与汇总
    groups: [],
    totalText: formatMoney(0), totalCount: 0, avgText: '--',
    myView: true,            // 汇总卡口径：true=我的花费（默认）｜false=总花费
    spendLabel: '我的花费', spendText: formatMoney(0), spendSub: '',
    // 统计（Day 切换）
    activeDay: '',           // 空 = 全部
    dayList: [],
    statMidLabel: '日均', statMidValue: '--',
    statTotal: formatMoney(0), statCount: 0, statItems: [],
    // 预算（行程级）
    budget: 0, budgetText: '', remainText: '', overText: '',
    budgetPercent: 0, overBudget: false, nearBudget: false,
    // 成员（方案 A）
    members: ['我'], memberNames: [],
    showMemberPanel: false, memberInput: '',
    // 结算
    balances: [], transfers: [], memberCount: 0, settleEmpty: false,
    settleCount: 0,          // 参与结算的笔数
    // 记一笔弹层
    panelShow: false, editing: false, editingId: '',
    hasLast: false,          // 是否有可复制的上一笔
    form: { amount: '', categoryId: 'food', date: '', note: '', needsSettle: false, payerName: '我', participants: [] },
    gridCategories: [],
    payerChips: [], participantChips: [],
    today: ''
  },

  onLoad() {
    this.setData({ today: formatDate() })
  },

  onShow() {
    // 每次回到本页都重新读 store，保证他处改动也能看到
    this.refresh()
  },

  // ================= 数据装配 =================

  currentTrip() {
    const trips = store.getTrips()
    if (!trips.length) return null
    const idx = this.data.tripIndex < trips.length ? this.data.tripIndex : 0
    return trips[idx]
  },

  refresh() {
    const trips = store.getTrips()
    if (!trips.length) {
      this.setData({
        hasTrip: false, tripCount: 0, tripNames: [], tripName: '', dayText: '',
        groups: [], statItems: [], dayList: [], activeDay: '',
        totalText: formatMoney(0), totalCount: 0, avgText: '--',
        myView: true, spendLabel: '我的花费', spendText: formatMoney(0), spendSub: '',
        statTotal: formatMoney(0), statCount: 0, statMidLabel: '日均', statMidValue: '--',
        budget: 0, budgetText: '', remainText: '', overText: '',
        budgetPercent: 0, overBudget: false, nearBudget: false,
        members: ['我'], memberNames: [], hasLast: false,
        balances: [], transfers: [], memberCount: 0, settleEmpty: true, settleCount: 0
      })
      return
    }

    const idx = this.data.tripIndex < trips.length ? this.data.tripIndex : 0
    const trip = trips[idx]
    const all = compactExpenses(store.getExpenses(trip.id))
    const budgetRec = all.find(e => e._kind === 'budget')
    const membersRec = all.find(e => e._kind === 'members')
    const settledRec = all.find(e => e._kind === 'settled')
    const catBudgetRecs = all.filter(e => e._kind === 'catbudget')
    const expenses = all.filter(e => e._kind !== 'budget' && e._kind !== 'members' &&
      e._kind !== 'settled' && e._kind !== 'catbudget')

    // 条目缓存（编辑/删除/复制时按 id 取原始数据）+ 最近分类 + 上一笔
    const expMap = {}
    expenses.forEach(e => { expMap[e.id] = e })
    this._expMap = expMap
    this._recentIds = this.recentCategoryIds(expenses)
    this._lastExpense = expenses.length
      ? expenses.slice().sort((a, b) => b.seq - a.seq)[0]
      : null

    const catMap = {}
    CATEGORIES.forEach(c => { catMap[c.id] = c })

    // 成员名单（方案 A）：优先用名单，未配置时兜底为历史垫付人收集
    const memberNames = membersRec && Array.isArray(membersRec.names) ? membersRec.names : []
    const members = memberNames.length ? ['我'].concat(memberNames) : ['我'].concat(this.recentPayers(expenses))
    this._members = members
    this._settledMap = settledRec && settledRec.done ? settledRec.done : {}

    // 分类预算表
    const catBudgetMap = {}
    catBudgetRecs.forEach(r => { catBudgetMap[r.catId] = Number(r.amount) || 0 })
    this._catBudgetMap = catBudgetMap

    // 汇总（分累加）
    const totalFen = expenses.reduce((s, e) => s + toFen(e.amount), 0)
    const totalCount = expenses.length

    // 日均 = 总花费 / 记录覆盖的天数跨度（至少 1 天）
    let avgText = '--'
    if (expenses.length) {
      const dates = expenses.map(e => e.date).sort()
      const span = Math.round((parseDate(dates[dates.length - 1]) - parseDate(dates[0])) / 86400000) + 1
      avgText = formatMoney(fenToYuan(Math.round(totalFen / Math.max(span, 1))))
    }

    // 第 N 天（读得到行程开始日期才显示）
    let dayText = ''
    if (trip.startDate) {
      const diff = Math.floor((Date.now() - parseDate(trip.startDate).getTime()) / 86400000) + 1
      if (diff >= 1) dayText = '第 ' + diff + ' 天'
    }

    // 我的花费（口径：个人消费全额 + 每笔 AA 中我的份额，不论谁垫付）
    const myFen = this.calcMySpendFen(expenses, members)
    const myView = this.data.myView

    // 预算（行程级，不随 Day 过滤）
    const budget = budgetRec ? Number(budgetRec.amount) || 0 : 0
    const remainFen = toFen(budget) - totalFen
    const overBudget = budget > 0 && remainFen < 0
    const budgetPercent = budget > 0 ? Math.min(100, Math.round(totalFen / toFen(budget) * 100)) : 0

    // Day 切换（统计页）
    const dayList = this.buildDayList(trip, expenses)
    let activeDay = this.data.activeDay
    if (!dayList.some(d => d.value === activeDay)) activeDay = ''
    const dayExpenses = activeDay ? expenses.filter(e => e.date === activeDay) : expenses
    const dayFen = dayExpenses.reduce((s, e) => s + toFen(e.amount), 0)

    this.setData({
      hasTrip: true,
      tripCount: trips.length,
      tripIndex: idx,
      tripNames: trips.map(t => t.name || '未命名行程'),
      tripName: trip.name || '未命名行程',
      dayText,
      groups: this.buildGroups(expenses, catMap),
      totalText: formatMoney(fenToYuan(totalFen)),
      totalCount,
      avgText,
      spendLabel: myView ? '我的花费' : '行程总花费',
      spendText: myView ? formatMoney(fenToYuan(myFen)) : formatMoney(fenToYuan(totalFen)),
      spendSub: myView
        ? '个人消费 + AA 我的份额 · 总 ' + formatMoney(fenToYuan(totalFen))
        : (totalCount + ' 笔 · 日均 ' + avgText),
      dayList,
      activeDay,
      statTotal: formatMoney(fenToYuan(activeDay ? dayFen : totalFen)),
      statCount: activeDay ? dayExpenses.length : totalCount,
      statMidLabel: activeDay ? '行程累计' : '日均',
      statMidValue: activeDay ? formatMoney(fenToYuan(totalFen)) : avgText,
      statItems: this.buildStatItems(dayExpenses, catMap, dayFen, catBudgetMap),
      budget,
      budgetText: formatMoney(budget),
      remainText: formatMoney(fenToYuan(Math.abs(remainFen))),
      overText: formatMoney(fenToYuan(-remainFen)),
      budgetPercent,
      budgetBarStyle: 'width: ' + budgetPercent + '%;',
      overBudget,
      nearBudget: budget > 0 && !overBudget && budgetPercent >= 80,
      members,
      memberNames,
      hasLast: !!this._lastExpense
    })

    // 结算：只统计 needsSettle === true 的花费（老数据无字段 = 不参与）
    const settleExpenses = expenses.filter(e => e.needsSettle === true)
    this.buildSettlement(settleExpenses, members, this._settledMap)
  },

  // 明细列表：按日期倒序分组，组内按时间/金额排序
  buildGroups(expenses, catMap) {
    const filterDate = this.data.filterDate
    const orderMode = this.data.orderMode
    const byDate = {}
    expenses.forEach(e => {
      if (filterDate && e.date !== filterDate) return
      if (!byDate[e.date]) byDate[e.date] = []
      byDate[e.date].push(e)
    })
    return Object.keys(byDate).sort().reverse().map(date => {
      const arr = byDate[date].slice()
      if (orderMode === 'amount') arr.sort((a, b) => toFen(b.amount) - toFen(a.amount))
      else arr.sort((a, b) => b.seq - a.seq) // 添加顺序倒序 = 最新在前
      const groupFen = arr.reduce((s, e) => s + toFen(e.amount), 0)
      const d = parseDate(date)
      return {
        date,
        dateText: (d.getMonth() + 1) + '月' + d.getDate() + '日 · ' + WEEK[d.getDay()],
        totalText: formatMoney(fenToYuan(groupFen)),
        items: arr.map(e => {
          const cat = catMap[e.category] || catMap.other
          return {
            id: e.id,
            icon: cat.icon,
            categoryName: cat.name,
            sub: e.note || '',
            aa: e.needsSettle === true,
            payerName: e.payerName || '我',
            amountText: formatMoney(e.amount)
          }
        })
      }
    })
  },

  // 分类小计：金额降序 + 占比（纯 CSS 进度条）+ 分类预算状态
  buildStatItems(expenses, catMap, totalFen, catBudgetMap) {
    const byCat = {}
    expenses.forEach(e => {
      byCat[e.category] = (byCat[e.category] || 0) + toFen(e.amount)
    })
    return Object.keys(byCat)
      .map(id => ({ id, cat: catMap[id] || catMap.other, fen: byCat[id] }))
      .sort((a, b) => b.fen - a.fen)
      .map(x => {
        const width = totalFen ? Math.max(4, Math.round(x.fen / totalFen * 100)) : 0
        const budget = catBudgetMap[x.id] || 0
        let budgetLine = ''
        let budgetCls = ''
        let barClass = ''
        if (budget > 0) {
          const bFen = toFen(budget)
          const pct = Math.round(x.fen / bFen * 100)
          if (x.fen > bFen) {
            budgetLine = '超支 ' + formatMoney(fenToYuan(x.fen - bFen))
            budgetCls = 'text-over'
            barClass = 'bar-over'
          } else if (pct >= 80) {
            budgetLine = '已用 ' + pct + '%，快超啦'
            budgetCls = 'text-warn'
            barClass = 'bar-warn'
          } else {
            budgetLine = '剩 ' + formatMoney(fenToYuan(bFen - x.fen))
            budgetCls = 'text-green'
          }
        }
        return {
          id: x.id,
          icon: x.cat.icon,
          name: x.cat.name,
          amountText: formatMoney(fenToYuan(x.fen)),
          percentText: (totalFen ? Math.round(x.fen / totalFen * 100) : 0) + '%',
          barStyle: 'width: ' + width + '%;',
          barClass,
          budgetLine,
          budgetCls
        }
      })
  },

  // Day 选项：行程 startDate 起，到最晚记录日期（或行程结束日）止
  buildDayList(trip, expenses) {
    const list = [{ label: '全部', value: '' }]
    if (!trip || !trip.startDate) return list
    let maxDate = this.data.today
    expenses.forEach(e => { if (e.date && e.date > maxDate) maxDate = e.date })
    if (trip.endDate && trip.endDate > maxDate) maxDate = trip.endDate
    const start = parseDate(trip.startDate)
    const end = parseDate(maxDate)
    if (end < start) return list
    const days = Math.round((end - start) / 86400000)
    for (let i = 0; i <= days && i < 60; i++) {
      list.push({ label: 'Day ' + (i + 1), value: formatDate(new Date(start.getTime() + i * 86400000)) })
    }
    return list
  },

  // 最近用过的 3 个分类（按记录添加顺序倒序去重）
  recentCategoryIds(expenses) {
    const ids = []
    expenses.slice().sort((a, b) => b.seq - a.seq).forEach(e => {
      if (e.category && ids.indexOf(e.category) < 0) ids.push(e.category)
    })
    return ids.slice(0, 3)
  },

  // 历史出现过的付款人（去重，仅作无名单时的兜底）
  recentPayers(expenses) {
    const names = []
    expenses.forEach(e => {
      if (e.payerName && e.payerName !== '我' && names.indexOf(e.payerName) < 0) {
        names.push(e.payerName)
      }
    })
    return names
  },

  // 「我的花费」= 个人消费（未勾分摊）全额 + 每笔 AA 中我的份额（不论谁垫付）；
  // 份额算法与 buildSettlement 完全一致（不足 1 分的尾差按参与人顺序顺延），
  // 恒等式：我的花费 = 个人消费 + （AA 我垫付合计 − AA 我的应收）
  calcMySpendFen(expenses, members) {
    let fen = 0
    expenses.forEach(e => {
      if (e.needsSettle !== true) { fen += toFen(e.amount); return }
      const parts = (Array.isArray(e.participants) && e.participants.length) ? e.participants : members
      const i = parts.indexOf('我')
      if (i < 0) return // 这笔 AA 我不参与，不担钱
      const total = toFen(e.amount)
      const share = Math.floor(total / parts.length)
      const remainder = total - share * parts.length
      fen += share + (i < remainder ? 1 : 0)
    })
    return fen
  },

  // 结算：只算 needsSettle 的花费；每笔按 participants（缺省全员）均摊；
  // 垫付人 = payerName（默认「我」）；不足 1 分的尾差按参与人顺序每人多担 1 分
  buildSettlement(settleExpenses, members, settledMap) {
    settledMap = settledMap || {}
    if (!settleExpenses.length || members.length < 2) {
      this.setData({ balances: [], transfers: [], memberCount: members.length, settleEmpty: true, settleCount: 0 })
      return
    }
    const paid = {}
    const shouldPay = {}
    members.forEach(m => { paid[m] = 0; shouldPay[m] = 0 })
    settleExpenses.forEach(e => {
      const payer = e.payerName || '我'
      if (paid[payer] === undefined) { paid[payer] = 0; shouldPay[payer] = 0 }
      paid[payer] += toFen(e.amount)
      const parts = (Array.isArray(e.participants) && e.participants.length) ? e.participants : members
      const n = parts.length
      const share = Math.floor(toFen(e.amount) / n)
      let remainder = toFen(e.amount) - share * n
      parts.forEach(m => {
        let p = share
        if (remainder > 0) { p += 1; remainder -= 1 }
        if (shouldPay[m] === undefined) { shouldPay[m] = 0; if (paid[m] === undefined) paid[m] = 0 }
        shouldPay[m] += p
      })
    })
    // 净额 = 已垫付 − 应承担（整数分）；名单全员都展示
    const names = members.slice()
    Object.keys(paid).forEach(k => { if (names.indexOf(k) < 0) names.push(k) })
    const diffs = names.map(m => ({ name: m, diff: (paid[m] || 0) - (shouldPay[m] || 0) }))
    const balances = diffs.map(b => ({
      name: b.name,
      settled: settledMap[b.name] === true,
      text: b.diff > 0
        ? '应收 ' + formatMoney(fenToYuan(b.diff))
        : (b.diff < 0 ? '应付 ' + formatMoney(fenToYuan(-b.diff)) : '已结清'),
      cls: b.diff > 0 ? 'in' : (b.diff < 0 ? 'out' : 'zero')
    }))
    // 贪心配对：每次用欠得最多的还被欠最多的（不超过 n-1 笔）
    const creditors = diffs.filter(b => b.diff > 0)
      .map(b => ({ name: b.name, fen: b.diff })).sort((a, b) => b.fen - a.fen)
    const debtors = diffs.filter(b => b.diff < 0)
      .map(b => ({ name: b.name, fen: -b.diff })).sort((a, b) => b.fen - a.fen)
    const transfers = []
    let ci = 0
    let di = 0
    while (ci < creditors.length && di < debtors.length) {
      const amt = Math.min(creditors[ci].fen, debtors[di].fen)
      transfers.push({
        from: debtors[di].name,
        to: creditors[ci].name,
        amountText: formatMoney(fenToYuan(amt))
      })
      creditors[ci].fen -= amt
      debtors[di].fen -= amt
      if (creditors[ci].fen === 0) ci++
      if (debtors[di].fen === 0) di++
    }
    this.setData({
      balances,
      transfers,
      memberCount: names.length,
      settleEmpty: false,
      settleCount: settleExpenses.length
    })
  },

  // ================= 视图交互 =================

  onTabChange(e) { this.setData({ activeTab: e.currentTarget.dataset.tab, openId: '' }) },
  // 汇总卡口径切换：我的花费 / 总花费
  setSpendView(e) {
    const my = e.currentTarget.dataset.view === 'my'
    if (my === this.data.myView) return
    this.setData({ myView: my }, () => this.refresh())
  },
  setOrderTime() { this.setData({ orderMode: 'time' }, () => this.refresh()) },
  setOrderAmount() { this.setData({ orderMode: 'amount' }, () => this.refresh()) },
  onFilterDate(e) { this.setData({ filterDate: e.detail.value, openId: '' }, () => this.refresh()) },
  clearFilter() { this.setData({ filterDate: '' }, () => this.refresh()) },
  onTripChange(e) { this.setData({ tripIndex: Number(e.detail.value), openId: '', activeDay: '' }, () => this.refresh()) },
  selectDay(e) { this.setData({ activeDay: e.currentTarget.dataset.day }, () => this.refresh()) },

  createDefaultTrip() {
    // 无行程时的兜底：用工厂函数 + saveTrip 正规接口创建，不写死数据
    const today = formatDate()
    const trip = models.makeTrip({ name: '我的旅行', startDate: today, endDate: today })
    store.saveTrip(trip)
    this.setData({ tripIndex: 0 }, () => this.refresh())
  },

  // 左滑出删除按钮
  onTouchStart(e) {
    this._sx = e.touches[0].clientX
    this._sy = e.touches[0].clientY
  },
  onTouchEnd(e) {
    const dx = e.changedTouches[0].clientX - this._sx
    const dy = e.changedTouches[0].clientY - this._sy
    if (dx < -50 && Math.abs(dy) < 40) {
      this.setData({ openId: e.currentTarget.dataset.id })
    } else if (dx > 30 && this.data.openId) {
      this.setData({ openId: '' })
    }
  },

  onItemTap(e) {
    // 已有展开项时，先收起，不进编辑
    if (this.data.openId) { this.setData({ openId: '' }); return }
    this.openEdit(e.currentTarget.dataset.id)
  },

  // ================= 成员管理（方案 A） =================

  openMembers() {
    const trip = this.currentTrip()
    if (!trip) return
    this.setData({
      showMemberPanel: true,
      memberInput: this.data.memberNames.join('、')
    })
  },
  onMemberInput(e) { this.setData({ memberInput: e.detail.value }) },
  closeMembers() { this.setData({ showMemberPanel: false }) },
  saveMembers() {
    const trip = this.currentTrip()
    if (!trip) return
    // 顿号/逗号/空格分隔均可，自动去重；「我」为保留字不收入名单
    const names = String(this.data.memberInput || '')
      .split(/[、,，;；\s]+/)
      .map(s => s.trim())
      .filter(s => s && s !== '我')
    const uniq = []
    names.forEach(n => { if (uniq.indexOf(n) < 0) uniq.push(n) })
    store.addExpense(trip.id, {
      id: 'members_' + trip.id,
      _kind: 'members',
      names: uniq,
      date: formatDate(),
      note: ''
    })
    this.setData({ showMemberPanel: false })
    wx.showToast({ title: '成员已保存', icon: 'success' })
    this.refresh()
  },

  // 参与人行尾「＋」：现场添加一位新伙伴，一处录入三处同步——
  // ① 本笔参与人自动勾选 ② 垫付人选项即时出现 ③ 结算页出行成员更新（落盘成员名单）
  addParticipant() {
    const trip = this.currentTrip()
    if (!trip) return
    wx.showModal({
      title: '添加参与人',
      editable: true,
      placeholderText: '输入名字，如：小丽',
      success: res => {
        if (!res.confirm) return
        const name = String(res.content || '').trim()
        if (!name) { wx.showToast({ title: '名字不能为空', icon: 'none' }); return }
        if (name === '我') { wx.showToast({ title: '「我」不用添加', icon: 'none' }); return }
        // 以当前名单为基础追加（无名单时带上历史垫付人，避免名单一建就把人挤掉）
        const names = (this._members || ['我']).filter(n => n !== '我')
        if (names.indexOf(name) >= 0) { wx.showToast({ title: '这位已在名单里', icon: 'none' }); return }
        names.push(name)
        store.addExpense(trip.id, {
          id: 'members_' + trip.id,
          _kind: 'members',
          names: names,
          date: formatDate(),
          note: ''
        })
        this.refresh() // 重算结算成员等，this._members 同步更新
        // 本笔表单：新伙伴自动勾为参与人，垫付人 chips 随之出现
        const parts = (this.data.form.participants || []).slice()
        if (parts.indexOf(name) < 0) parts.push(name)
        this.setData({
          'form.participants': parts,
          participantChips: this.buildFormChips().participantChips,
          payerChips: this.buildFormChips().payerChips
        })
        wx.showToast({ title: '已添加 ' + name, icon: 'success' })
      }
    })
  },

  // ================= 记一笔 / 编辑弹层 =================

  buildGrid(recentIds) {
    const top = recentIds.map(id => CATEGORIES.find(c => c.id === id)).filter(Boolean)
    const rest = CATEGORIES.filter(c => recentIds.indexOf(c.id) < 0)
    return top.concat(rest)
  },

  // 弹层里的付款人/参与人 chips（数据驱动，规避 WXML 不支持方法调用）
  buildFormChips() {
    const members = this._members || ['我']
    const payer = this.data.form.payerName || '我'
    const parts = this.data.form.participants || []
    return {
      payerChips: members.map(m => ({ name: m, on: m === payer })),
      participantChips: members.map(m => ({ name: m, on: parts.indexOf(m) >= 0 }))
    }
  },

  openAdd() {
    const recentIds = this._recentIds || []
    this.setData({
      panelShow: true,
      editing: false,
      editingId: '',
      openId: '',
      form: {
        amount: '',
        categoryId: recentIds[0] || 'food',
        date: this.data.today,
        note: '',
        needsSettle: false,
        payerName: '我',
        participants: []
      },
      gridCategories: this.buildGrid(recentIds),
      payerChips: (this._members || ['我']).map(m => ({ name: m, on: m === '我' })),
      participantChips: (this._members || ['我']).map(m => ({ name: m, on: false }))
    })
  },

  openEdit(id) {
    const e = this._expMap && this._expMap[id]
    if (!e) return
    const needsSettle = e.needsSettle === true
    const members = this._members || ['我']
    const payer = e.payerName || '我'
    const parts = needsSettle && Array.isArray(e.participants) ? e.participants : []
    this.setData({
      panelShow: true,
      editing: true,
      editingId: id,
      form: {
        amount: String(e.amount),
        categoryId: e.category || 'other',
        date: e.date || this.data.today,
        note: e.note || '',
        needsSettle,
        payerName: payer,
        participants: parts.slice()
      },
      gridCategories: this.data.gridCategories.length
        ? this.data.gridCategories
        : this.buildGrid(this._recentIds || []),
      payerChips: members.map(m => ({ name: m, on: m === payer })),
      participantChips: members.map(m => ({ name: m, on: parts.indexOf(m) >= 0 }))
    })
  },

  // 复制上一笔：全部字段带出（金额也可继续改）
  copyLast() {
    const last = this._lastExpense
    if (!last) { wx.showToast({ title: '还没有可复制的记录', icon: 'none' }); return }
    const needsSettle = last.needsSettle === true
    const members = this._members || ['我']
    const payer = last.payerName || '我'
    const parts = needsSettle && Array.isArray(last.participants) && last.participants.length
      ? last.participants.slice()
      : (needsSettle ? members.slice() : [])
    this.setData({
      form: {
        amount: String(last.amount),
        categoryId: last.category || 'other',
        date: last.date || this.data.today,
        note: last.note || '',
        needsSettle,
        payerName: payer,
        participants: parts
      },
      gridCategories: this.data.gridCategories.length
        ? this.data.gridCategories
        : this.buildGrid(this._recentIds || []),
      payerChips: members.map(m => ({ name: m, on: m === payer })),
      participantChips: members.map(m => ({ name: m, on: parts.indexOf(m) >= 0 }))
    })
    wx.showToast({ title: '已复制上一笔', icon: 'none' })
  },

  closePanel() { this.setData({ panelShow: false }) },
  noop() {},

  onAmountInput(e) { this.setData({ 'form.amount': e.detail.value }) },
  selectCategory(e) { this.setData({ 'form.categoryId': e.currentTarget.dataset.id }) },
  onFormDate(e) { this.setData({ 'form.date': e.detail.value }) },
  onNoteInput(e) { this.setData({ 'form.note': e.detail.value }) },
  onPayerInput(e) { this.setData({ 'form.payerName': e.detail.value, payerChips: this.buildFormChips().payerChips }) },
  selectPayer(e) { this.setData({ 'form.payerName': e.currentTarget.dataset.name, payerChips: this.buildFormChips().payerChips }) },

  // 分摊结算开关：勾选时默认付款人=我、参与人=全名单
  toggleSettle(e) {
    const on = e.detail.value
    const form = this.data.form
    form.needsSettle = on
    if (on) {
      if (!form.payerName) form.payerName = '我'
      if (!form.participants || !form.participants.length) {
        form.participants = (this._members || ['我']).slice()
      }
    }
    this.setData({ form: form, payerChips: this.buildFormChips().payerChips, participantChips: this.buildFormChips().participantChips })
  },

  // 参与人多选
  toggleParticipant(e) {
    const name = e.currentTarget.dataset.name
    const parts = (this.data.form.participants || []).slice()
    const i = parts.indexOf(name)
    if (i >= 0) parts.splice(i, 1)
    else parts.push(name)
    this.setData({
      'form.participants': parts,
      participantChips: (this._members || ['我']).map(m => ({ name: m, on: parts.indexOf(m) >= 0 }))
    })
  },

  validateForm() {
    const f = this.data.form
    const raw = String(f.amount || '').trim()
    // 必填、>0、最多两位小数
    if (!/^\d+(\.\d{1,2})?$/.test(raw) || !(Number(raw) > 0)) {
      wx.showToast({ title: '请输入正确的金额', icon: 'none' })
      return null
    }
    if (!f.date) {
      wx.showToast({ title: '请选择日期', icon: 'none' })
      return null
    }
    const needsSettle = f.needsSettle === true
    if (needsSettle && (!f.participants || !f.participants.length)) {
      wx.showToast({ title: '请至少选择一名参与人', icon: 'none' })
      return null
    }
    return {
      amount: Number(raw),
      category: f.categoryId,
      date: f.date,
      note: (f.note || '').trim(),
      needsSettle,
      payerName: needsSettle ? ((f.payerName || '').trim() || '我') : '',
      participants: needsSettle ? f.participants.slice() : []
    }
  },

  saveOne() { this.doSave(false) },
  saveAndAgain() { this.doSave(true) },

  doSave(again) {
    const trip = this.currentTrip()
    if (!trip) { wx.showToast({ title: '请先创建行程', icon: 'none' }); return }
    const v = this.validateForm()
    if (!v) return

    // 工厂函数创建标准记录（约定二）
    const record = models.makeExpense({
      amount: v.amount,
      category: v.category,
      date: v.date,
      note: v.note,
      tripId: trip.id
    })
    // 分摊/付款人/参与人为本模块扩展字段（models.makeExpense 暂无，页面级补充，不改公共文件）
    record.needsSettle = v.needsSettle
    if (v.needsSettle) {
      if (v.payerName !== '我') record.payerName = v.payerName
      record.participants = v.participants
    }
    // 编辑：同 id 覆盖旧记录
    if (this.data.editing) record.id = this.data.editingId

    store.addExpense(trip.id, record)
    wx.showToast({ title: this.data.editing ? '已保存' : '已记一笔', icon: 'success' })

    if (again) {
      // 保存并再记一笔：只清金额和备注，分类/日期/分摊设置保留
      this.setData({
        form: {
          amount: '', categoryId: v.category, date: v.date, note: '',
          needsSettle: v.needsSettle,
          payerName: v.needsSettle ? v.payerName : '我',
          participants: v.needsSettle ? v.participants : []
        },
        participantChips: (this._members || ['我']).map(m => ({
          name: m, on: v.needsSettle && v.participants.indexOf(m) >= 0
        }))
      })
    } else {
      this.setData({ panelShow: false })
    }
    this.refresh()
  },

  onDeleteTap(e) {
    const id = e.currentTarget.dataset.id
    wx.showModal({
      title: '删除这条花费？',
      content: '删除后无法恢复',
      confirmColor: '#FA5151',
      success: res => {
        if (!res.confirm) return
        const trip = this.currentTrip()
        const old = (this._expMap && this._expMap[id]) || {}
        // 删除 = 追加一条同 id 的墓碑记录，读取时被归并过滤
        const tomb = models.makeExpense({
          amount: old.amount || 0,
          category: old.category || 'other',
          date: old.date || this.data.today,
          note: '',
          tripId: trip.id
        })
        tomb.id = id
        tomb._deleted = true
        store.addExpense(trip.id, tomb)
        this.setData({ openId: '' })
        wx.showToast({ title: '已删除', icon: 'none' })
        this.refresh()
      }
    })
  },

  // ================= 预算（行程级 + 分类级） =================

  setBudget() {
    const trip = this.currentTrip()
    if (!trip) return
    wx.showModal({
      title: '行程总预算',
      editable: true,
      placeholderText: this.data.budget > 0 ? String(this.data.budget) : '如 3000',
      success: res => {
        if (!res.confirm) return
        const raw = String(res.content || '').trim()
        if (!/^\d+(\.\d{1,2})?$/.test(raw) || !(Number(raw) > 0)) {
          wx.showToast({ title: '请输入有效金额', icon: 'none' })
          return
        }
        // 预算也存进本模块的数据区：固定 id = budget_行程id，_kind 标记，
        // 读取归并后天然取到最新一条，与花费记录互不干扰
        store.addExpense(trip.id, {
          id: 'budget_' + trip.id,
          _kind: 'budget',
          amount: Math.round(Number(raw) * 100) / 100,
          date: formatDate(),
          note: ''
        })
        wx.showToast({ title: '预算已保存', icon: 'success' })
        this.refresh()
      }
    })
  },

  // 分类预算：输入 0 或留空 = 清除该分类预算
  setCatBudget(e) {
    const trip = this.currentTrip()
    if (!trip) return
    const catId = e.currentTarget.dataset.id
    const cat = CATEGORIES.find(c => c.id === catId) || { name: '该分类' }
    const cur = this._catBudgetMap ? (this._catBudgetMap[catId] || 0) : 0
    wx.showModal({
      title: cat.name + '分类预算',
      editable: true,
      placeholderText: cur > 0 ? String(cur) : '如 1500；留空或 0 清除',
      success: res => {
        if (!res.confirm) return
        const raw = String(res.content || '').trim()
        if (raw === '' || Number(raw) === 0) {
          store.addExpense(trip.id, {
            id: 'cbudget_' + trip.id + '_' + catId,
            _kind: 'catbudget',
            catId: catId,
            amount: 0,
            date: formatDate(),
            note: ''
          })
          wx.showToast({ title: '已清除', icon: 'none' })
          this.refresh()
          return
        }
        if (!/^\d+(\.\d{1,2})?$/.test(raw) || !(Number(raw) > 0)) {
          wx.showToast({ title: '请输入有效金额', icon: 'none' })
          return
        }
        store.addExpense(trip.id, {
          id: 'cbudget_' + trip.id + '_' + catId,
          _kind: 'catbudget',
          catId: catId,
          amount: Math.round(Number(raw) * 100) / 100,
          date: formatDate(),
          note: ''
        })
        wx.showToast({ title: '预算已保存', icon: 'success' })
        this.refresh()
      }
    })
  },

  // 标记已结清（仅展示状态，不参与结算计算）
  toggleSettled(e) {
    const name = e.currentTarget.dataset.name
    const trip = this.currentTrip()
    if (!trip) return
    const done = Object.assign({}, this._settledMap || {})
    const marking = done[name] !== true
    wx.showModal({
      title: marking ? '标记「' + name + '」已线下结清？' : '取消「' + name + '」的结清标记？',
      success: res => {
        if (!res.confirm) return
        if (marking) done[name] = true
        else delete done[name]
        store.addExpense(trip.id, {
          id: 'settled_' + trip.id,
          _kind: 'settled',
          done: done,
          date: formatDate(),
          note: ''
        })
        this.refresh()
      }
    })
  }
})
