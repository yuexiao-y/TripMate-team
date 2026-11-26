// utils/models.js —— 唯一数据源定义
function uid() {
  return 'id_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
}

function makeTrip({ name, startDate, endDate, cover }) {
  return { id: uid(), name, startDate, endDate, cover: cover || '', days: [] }
}

function makeDayItem({ time, type, title, location, note }) {
  return { time, type, title, location: location || '', note: note || '' }
}

function makeTransport({ mode, from, to, depart, arrive, price, bookingNo }) {
  return { id: uid(), mode, from, to, depart, arrive, price: price || 0, bookingNo: bookingNo || '' }
}

function makeExpense({ amount, category, date, note, tripId }) {
  return { id: uid(), amount, category, date, note: note || '', tripId: tripId || '' }
}

function makePlace({ name, address, category, rating, tripId }) {
  return { id: uid(), name, address: address || '', category: category || '', rating: rating || 0, images: [], visited: false, tripId: tripId || '' }
}

function makeCheckItem({ content, group }) {
  return { id: uid(), content, group: group || '其他', checked: false }
}

// ===== 打卡（仅 pages/checkin 使用）=====
function makeCheckin({ title, content, photos, location, date, time }) {
  return {
    id: uid(), title,
    content: content || '', photos: photos || [],
    location: location || '', date: date || '', time: time || '',
    createdAt: Date.now()
  }
}

// AI 智能规划 Agent 生成的完整旅行方案（上下文 + 各模块结果）
function makeAiPlan({ tripInfo, assumptions, exclusions }) {
  const now = new Date().toISOString()
  return {
    id: uid(),
    createdAt: now,
    updatedAt: now,
    tripInfo: tripInfo || {},          // 结构化需求：目的地/人数/天数/预算/兴趣/强度
    assumptions: assumptions || [],    // 规划时使用的假设（如「未说明人数，暂按2人」）
    exclusions: exclusions || [],      // 用户修改时排除的景点
    timeLimits: {},                    // 每天结束时间限制，如 { 3: 19 }
    itinerary: [],                     // 每日行程 [{ day, theme, area, items, remark }]
    transport: [],                     // 市内交通衔接（示例数据）
    dining: [],                        // 餐饮推荐平铺列表
    budget: null,                      // 预算估算 { ticket, dining, transport, other, total, ... }
    warnings: [],                      // 超支等提示
    checks: [],                        // 合理性检查结果
    notes: [],                         // 数据说明（mock 边界）
    checklist: [],                     // 自动生成的出行清单（makeCheckItem 结构）
    tripId: '',                        // 保存为正式行程后关联的 trip.id
    source: 'ai-agent'
  }
}

// ===== 吃喝探索（仅 pages/dining 使用）=====
function createDiningItem({ name, address, type, visited }) {
  return { id: uid(), name, address: address || '', type: type || '其他', visited: !!visited }
}

// ===== 出行清单（仅 pages/checklist 使用）=====
function createChecklistItem({ id, name, done }) {
  return { id: id || uid(), name: name || '', done: !!done }
}

module.exports = {
  makeTrip, makeDayItem, makeTransport,
  makeExpense, makePlace, makeCheckItem,
  makeCheckin, makeAiPlan,
  createDiningItem, createChecklistItem
}
