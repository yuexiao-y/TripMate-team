// utils/store.js —— 统一读写缓存
const KEY = { trips: 'trips', expenses: 'expenses', places: 'places', checklist: 'checklist', transports: 'transports', checkins: 'checkins', aiPlans: 'aiPlans', dinings: 'dinings' }


function read(k) { return wx.getStorageSync(k) || [] }
function write(k, v) { wx.setStorageSync(k, v) }

function getTrips() { return read(KEY.trips) }
function saveTrip(trip) {
  const list = getTrips()
  const i = list.findIndex(t => t.id === trip.id)
  if (i >= 0) list[i] = trip; else list.push(trip)
  write(KEY.trips, list); return trip
}

function getAllExpenses() { return read(KEY.expenses) }
function getExpenses(tripId) { return read(KEY.expenses).filter(e => e.tripId === tripId) }
function addExpense(tripId, expense) {
  const list = read(KEY.expenses); list.push({ ...expense, tripId }); write(KEY.expenses, list); return expense
}

function getPlaces(tripId) { return read(KEY.places).filter(p => p.tripId === tripId) }
function toggleVisited(placeId) {
  const list = read(KEY.places)
  const p = list.find(x => x.id === placeId)
  if (p) p.visited = !p.visited
  write(KEY.places, list); return p
}

function getChecklist() { return read(KEY.checklist) }
function toggleCheck(id) {
  const list = read(KEY.checklist)
  const c = list.find(x => x.id === id)
  if (c) c.checked = !c.checked
  write(KEY.checklist, list); return c
}
function addCheckItem(item) {
  const list = read(KEY.checklist); list.push(item); write(KEY.checklist, list); return item
}
// 交通记录
function getTransports(tripId) {
  const list = read(KEY.transports)
  return tripId ? list.filter(t => t.tripId === tripId) : list
}
function addTransport(tripId, transport) {
  const list = read(KEY.transports)
  list.push({ ...transport, tripId })
  write(KEY.transports, list)
  return transport
}

function removeTrip(tripId) {
  const list = read(KEY.trips).filter(t => t.id !== tripId)
  write(KEY.trips, list)
}

// ===== 打卡柜子（仅 pages/checkin 使用）=====
function getCheckins() { return read(KEY.checkins) }
function addCheckin(checkin) {
  const list = read(KEY.checkins); list.push(checkin)
  write(KEY.checkins, list); return checkin
}
function updateCheckin(checkin) {
  const list = read(KEY.checkins)
  const i = list.findIndex(c => c.id === checkin.id)
  if (i >= 0) list[i] = checkin
  write(KEY.checkins, list); return checkin
}
function removeCheckin(id) {
  const list = read(KEY.checkins).filter(c => c.id !== id)
  write(KEY.checkins, list)
}

// ===== 吃喝探索（仅 pages/dining 使用）=====
function getDiningList() { return read(KEY.dinings) }
function addDiningItem(item) {
  const list = read(KEY.dinings); list.push(item)
  write(KEY.dinings, list); return item
}
function toggleDiningVisited(id) {
  const list = read(KEY.dinings)
  const it = list.find(x => x.id === id)
  if (it) it.visited = !it.visited
  write(KEY.dinings, list); return it
}

// ===== 通用键值读写（pages/checklist 使用）=====
function get(key, defaultValue) {
  const v = wx.getStorageSync(key)
  return (v === '' || v === null || v === undefined) ? defaultValue : v
}
function set(key, value) { wx.setStorageSync(key, value) }

// AI 智能规划方案（Agent 上下文持久化）
function getAiPlans() { return read(KEY.aiPlans) }
function getLatestAiPlan() {
  const list = getAiPlans()
  return list.length ? list[list.length - 1] : null
}
function saveAiPlan(plan) {
  const list = getAiPlans()
  const i = list.findIndex(p => p.id === plan.id)
  plan.updatedAt = new Date().toISOString()
  if (i >= 0) list[i] = plan; else list.push(plan)
  write(KEY.aiPlans, list)
  return plan
}


module.exports = {
  getTrips, saveTrip, removeTrip,
  getAllExpenses, getExpenses, addExpense,
  getPlaces, toggleVisited,
  getChecklist, toggleCheck, addCheckItem,
  getTransports, addTransport,
  getCheckins, addCheckin, updateCheckin, removeCheckin,
  getDiningList, addDiningItem, toggleDiningVisited,
  get, set,
  getAiPlans, getLatestAiPlan, saveAiPlan
}
