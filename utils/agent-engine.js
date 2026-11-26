// utils/agent-engine.js —— AI 智能规划 Agent 核心引擎
// ============================================================
// 这是一个运行在小程序本地的「规则式智能体引擎」：
//   自然语言理解(NLU) → 需求结构化 → 任务规划 → 多模块协同 → 合理性检查 → 输出
// 不调用云端大模型，不依赖真实的地图 / 餐饮 / 交通 API，
// 所有地点数据来自 utils/agent-data.js 的预置示例数据（方案中会明确标注）。
// 引擎为纯函数模块，不依赖 wx API，方便单独测试。
// ============================================================

const DATA = require('./agent-data')
const models = require('./models')

/* ================= 中文数字与通用工具 ================= */

const CN_NUM = { '一': 1, '二': 2, '两': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10, '十一': 11, '十二': 12 }
function parseNum(s) {
  if (CN_NUM[s]) return CN_NUM[s]
  const n = parseInt(s, 10)
  return isNaN(n) ? 0 : n
}

// 稳定的伪随机（同一条路线每次生成同样的时间，便于演示）
function hashCode(s) {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) & 0xffff
  return h
}

/* 行程强度 → 每天主要景点数上限 */
const DENSITY = { '轻松': 2, '适中': 3, '紧凑': 4 }

/* 兴趣关键词表（用于从自然语言中扫描兴趣） */
const INTEREST_KEYWORDS = [
  { name: '历史文化', keys: ['历史', '文化', '博物馆', '古迹', '古镇', '人文', '古迹'] },
  { name: '美食', keys: ['美食', '小吃', '吃货', '特色吃', '当地菜'] },
  { name: '自然风光', keys: ['自然', '风景', '山水', '湖', '踏青', '徒步'] },
  { name: '购物', keys: ['购物', '逛街', '买买买', '商场'] },
  { name: '亲子', keys: ['亲子', '小孩', '孩子', '宝宝', '儿童', '带娃'] },
  { name: '艺术文艺', keys: ['艺术', '文艺', '展览', '美术', '创意', 'citywalk'] },
  { name: '城市观光', keys: ['观光', '打卡', '地标', '夜景', '都市', '演出'] }
]

function scanInterests(text) {
  const out = []
  INTEREST_KEYWORDS.forEach(k => {
    if (k.keys.some(x => text.indexOf(x) >= 0) && out.indexOf(k.name) < 0) out.push(k.name)
  })
  return out
}

/* ============================================================
 * Step 1 + Step 2：需求理解 —— 从自然语言中提取关键信息
 * ============================================================ */

function parseDemand(text) {
  const t = (text || '').trim()
  const info = {
    origin: '',        // 出发城市（如「从武汉到上海」里的武汉）
    destination: '',
    travelers: 0,
    duration: 0,
    budgetPerPerson: 0,
    totalBudget: 0,
    interests: [],
    travelIntensity: '',
    hasKids: false,
    specialRequirements: ''
  }
  let m

  // —— 出发地 / 目的地 ——
  // 先识别「从X出发到/去Y」句式，避免把出发地误当成目的地
  const cities = DATA.supportedCities()
  m = t.match(/从([\u4e00-\u9fa5]{2,5})(?:出发)?(?:到|去|前往|飞往)([\u4e00-\u9fa5]{2,5})/)
  if (m) {
    info.origin = m[1]
    info.destination = m[2]
  }
  if (!info.origin) {
    m = t.match(/(?:^|从|由)([\u4e00-\u9fa5]{2,5})(?:出发|启程|动身)/)
    if (m) info.origin = m[1]
  }
  // 目的地校正：优先已预置城市，其次通用模式；都不是预置城市时保留正则命中的结果
  if (cities.indexOf(info.destination) < 0) {
    let dest = ''
    for (let i = 0; i < cities.length; i++) {
      if (t.indexOf(cities[i]) >= 0 && cities[i] !== info.origin) { dest = cities[i]; break }
    }
    if (dest) info.destination = dest
    else {
      m = t.match(/(?:去|到|前往|在)([\u4e00-\u9fa5]{2,4})(?:玩|旅游|旅行|游|逛)/)
      if (m) info.destination = m[1]
    }
  }
  // 出发地与目的地相同视为同城出行，不额外排大交通
  if (info.origin && info.origin === info.destination) info.origin = ''

  // —— 人数 ——
  m = t.match(/我和(一|二|两|三|四|五|六|七|八|[0-9]+)个?(?:朋友|同学|同事|家人|闺蜜|室友)/)
  if (m) info.travelers = parseNum(m[1]) + 1
  if (!info.travelers) { m = t.match(/一家(两|二|三|四|五|六|[0-9]+)口/); if (m) info.travelers = parseNum(m[1]) }
  if (!info.travelers) { m = t.match(/(\d+|一|二|两|三|四|五|六|七|八|九|十)个?人/); if (m) info.travelers = parseNum(m[1]) }
  if (!info.travelers) { m = t.match(/(\d+|一|二|两|三|四|五|六|七|八|九|十)位/); if (m) info.travelers = parseNum(m[1]) }

  // —— 带小孩（作为特殊需求 + 亲子兴趣）——
  if (/带(小孩|孩子|宝宝)|亲子|带娃/.test(t)) {
    info.hasKids = true
    info.specialRequirements = '带小孩出行'
    if (info.interests.indexOf('亲子') < 0) info.interests.push('亲子')
  }

  // —— 天数 ——
  m = t.match(/(\d+|一|二|两|三|四|五|六|七|八|九|十)天/)
  if (m) info.duration = parseNum(m[1])
  if (!info.duration && /周末/.test(t)) info.duration = 2
  if (!info.duration) { m = t.match(/(\d+|一|二|两|三|四|五|六|七|八|九|十)日/); if (m) info.duration = parseNum(m[1]) }
  if (info.duration) info.duration = Math.min(Math.max(info.duration, 1), 7)

  // —— 预算（人均优先，其次总预算）——
  m = t.match(/(?:人均|每人)[^\d]{0,4}(\d{3,6})/)
  if (m) info.budgetPerPerson = parseNum(m[1])
  if (!info.budgetPerPerson) {
    m = t.match(/(?:总预算|预算|总花费|一共|总共|只有)(?:约|是|大概|有)?\s*(\d{3,6})\s*元?/)
    if (m) info.totalBudget = parseNum(m[1])
  }

  // —— 兴趣 ——
  scanInterests(t).forEach(name => { if (info.interests.indexOf(name) < 0) info.interests.push(name) })

  // —— 行程强度 ——
  if (/轻松|不累|休闲|悠闲|慢节奏|不要太累|别太累|太累|别太赶|少安排/.test(t)) info.travelIntensity = '轻松'
  else if (/紧凑|特种兵|充实|多安排|赶场/.test(t)) info.travelIntensity = '紧凑'
  else if (/适中|正常|平衡/.test(t)) info.travelIntensity = '适中'

  return info
}

/* ============================================================
 * Step 3：需求结构化 —— 补默认值 + 记录假设 + 找缺失信息
 * ============================================================ */

function normalizeInfo(raw) {
  const info = {
    origin: raw.origin || '',
    destination: raw.destination,
    travelers: raw.travelers,
    duration: raw.duration,
    budgetPerPerson: raw.budgetPerPerson,
    totalBudget: raw.totalBudget,
    interests: (raw.interests || []).slice(),
    travelIntensity: raw.travelIntensity,
    hasKids: raw.hasKids,
    specialRequirements: raw.specialRequirements || ''
  }
  const assumptions = []
  const missing = []

  if (!info.destination) missing.push('目的地')
  if (!info.duration) missing.push('旅行天数')

  // 非必要信息用默认值，但必须明示假设
  if (!info.travelers) { info.travelers = 2; assumptions.push('未说明出行人数，暂按 2 人估算') }
  if (!info.travelIntensity) { info.travelIntensity = '适中'; assumptions.push('未说明行程强度，暂按「适中」安排') }
  if (!info.interests.length) { info.interests = ['城市观光', '历史文化']; assumptions.push('未说明兴趣偏好，暂按经典观光路线规划') }

  // 预算换算（人数已知后再换算总量）
  if (info.budgetPerPerson && !info.totalBudget) info.totalBudget = info.budgetPerPerson * info.travelers
  if (info.totalBudget && !info.budgetPerPerson) info.budgetPerPerson = Math.round(info.totalBudget / info.travelers)
  if (!info.totalBudget) assumptions.push('未提供预算，方案只做花费估算、不做预算控制')

  return { info, assumptions, missing }
}

// 页面展示「已识别」步骤时使用
function recognize(text) {
  return normalizeInfo(parseDemand(text))
}

function isSupported(destination) {
  return !!DATA.CITIES[destination]
}

/* ============================================================
 * Step 4~6：旅行规划 —— 选点 / 分日 / 餐饮 / 交通 / 预算 / 清单
 * ============================================================ */

function poiScore(p, interests) {
  let s = 0
  interests.forEach(name => {
    const tags = DATA.INTEREST_TAGS[name] || []
    tags.forEach(tg => { if (p.tags.indexOf(tg) >= 0) s += 3 })
  })
  if (s === 0) s = 0.5 // 无匹配的景点可作补充候选
  if (p.cost === 0) s += 0.3
  return s
}
function areaScore(list, interests, count) {
  let s = list.reduce((sum, p) => sum + poiScore(p, interests), 0)
  if (list.length >= count) s += 2 // 片区内景点数足够一整天时优先整块安排，减少跨区
  return s
}

// 判断某个 POI 是否命中排除词（如「博物馆」命中「上海博物馆」）
function poiMatches(p, term) {
  if (!term) return false
  if (p.name.indexOf(term) >= 0) return true
  return (p.tags || []).some(tg => tg.indexOf(term) >= 0 || term.indexOf(tg) >= 0)
}

// 预算紧张时启用经济模式（人均每天可用 < 300 元）
function isEconomy(info) {
  if (!info.totalBudget) return false
  return info.totalBudget / info.travelers / info.duration < 300
}

function makeCtx(plan) {
  return { usedPois: [], usedFoods: [], exclusions: plan.exclusions || [] }
}

// 选出某一天的景点：按区域分组打分，让同片区的景点落在同一天（就近安排）
function pickDayPois(city, info, ctx, dayNo, count) {
  const excl = ctx.exclusions.filter(e => !e.day || Number(e.day) === dayNo)
  let pool = city.pois.filter(p =>
    !p.fullDay && !p.eveningOnly &&
    ctx.usedPois.indexOf(p.name) < 0 &&
    !excl.some(e => poiMatches(p, e.term))
  )
  if (isEconomy(info)) {
    const cheap = pool.filter(p => p.cost <= 60)
    if (cheap.length >= Math.min(count, 2)) pool = cheap
  }
  const groups = {}
  pool.forEach(p => { (groups[p.area] = groups[p.area] || []).push(p) })
  const names = Object.keys(groups)
  names.forEach(a => groups[a].sort((x, y) => poiScore(y, info.interests) - poiScore(x, info.interests)))
  names.sort((a, b) => areaScore(groups[b], info.interests, count) - areaScore(groups[a], info.interests, count))
  const picked = []
  for (let i = 0; i < names.length; i++) {
    if (picked.length >= count) break
    const arr = groups[names[i]]
    for (let j = 0; j < arr.length && picked.length < count; j++) picked.push(arr[j])
  }
  return picked
}

// 挑选餐厅：优先当天所在片区，美食兴趣优先「特色」，经济模式排除高价
function pickMeal(city, info, ctx, area, meal) {
  const pool = city.foods.filter(f => (f.meal || []).indexOf(meal) >= 0 && ctx.usedFoods.indexOf(f.name) < 0)
  if (!pool.length) return null
  let cand = pool.filter(f => f.area === area)
  if (!cand.length) cand = pool.filter(f => f.area === '城市通用')
  if (!cand.length) cand = pool
  if (isEconomy(info)) {
    const cheap = cand.filter(f => !f.premium && f.cost <= 60)
    if (cheap.length) cand = cheap
  }
  const foodie = info.interests.indexOf('美食') >= 0
  cand.sort((a, b) => {
    const sa = (foodie && a.tag === '特色' ? 2 : 0) + (a.premium ? 1 : 0)
    const sb = (foodie && b.tag === '特色' ? 2 : 0) + (b.premium ? 1 : 0)
    return sb - sa
  })
  const pick = cand[0]
  ctx.usedFoods.push(pick.name)
  return pick
}

// 晚间安排：兴趣匹配的夜间项目（如宋城演出），或紧凑模式下的夜景
function pickEvening(city, info, ctx, dayNo) {
  const excl = ctx.exclusions.filter(e => !e.day || Number(e.day) === dayNo)
  const tags = info.interests.reduce((arr, name) => arr.concat(DATA.INTEREST_TAGS[name] || []), [])
  const night = city.pois.filter(p => p.eveningOnly && ctx.usedPois.indexOf(p.name) < 0 && !excl.some(e => poiMatches(p, e.term)))
  if (night.length && !isEconomy(info) && night[0].tags.some(tg => tags.indexOf(tg) >= 0)) return night[0]
  if (info.travelIntensity === '紧凑') {
    const view = city.pois.filter(p => p.tags.indexOf('夜景') >= 0 && ctx.usedPois.indexOf(p.name) < 0 && !excl.some(e => poiMatches(p, e.term)))
    if (view.length) return view[0]
  }
  return null
}

function poiItem(p, time) {
  return { time, type: '景点', title: p.name, location: p.area, note: p.note || '', cost: p.cost, stay: p.stay }
}
function mealItem(f, time, meal) {
  return { time, type: '餐饮', meal, title: f.name, location: f.area, note: f.note || '', cost: f.cost, stay: 60 }
}

// 一段市内交通（示例数据）：同片区步行、跨片区地铁
function transportLeg(plan, dayNo, from, to, sameArea) {
  const city = DATA.CITIES[plan.tripInfo.destination]
  let mode, minutes, cost
  if (sameArea) {
    mode = '步行'
    minutes = 6 + hashCode(from + '>' + to) % 7
    cost = 0
  } else {
    mode = '地铁'
    minutes = 18 + hashCode(from + '>' + to) % 18
    cost = city.metroFare
  }
  plan.transport.push({ day: dayNo, from, to, mode, minutes, cost, mock: true })
}

const THEME_WORDS = {
  '历史文化': '历史人文漫步', '美食': '寻味之旅', '自然风光': '山水自然',
  '购物': '逛街购物', '亲子': '亲子欢乐', '艺术文艺': '文艺漫游', '城市观光': '经典观光'
}
function dayTheme(pois, info) {
  if (!pois.length) return '自由活动'
  let word = '经典观光'
  info.interests.forEach(name => {
    const tags = DATA.INTEREST_TAGS[name] || []
    if (pois.some(p => p.tags.some(tg => tags.indexOf(tg) >= 0))) word = THEME_WORDS[name] || word
  })
  return pois[0].area + ' · ' + word
}

// 构建普通一天：景点 + 三餐（+下午茶）+ 晚间 + 交通衔接
function buildDay(city, info, plan, ctx, dayNo, density) {
  const light = info.travelIntensity === '轻松'
  const pois = pickDayPois(city, info, ctx, dayNo, density)
  pois.forEach(p => ctx.usedPois.push(p.name))

  const items = []
  if (pois[0]) items.push(poiItem(pois[0], light ? '10:00' : '09:30'))
  const lunch = pickMeal(city, info, ctx, pois[0] ? pois[0].area : '', '午餐')
  if (lunch) items.push(mealItem(lunch, '12:00', '午餐'))
  if (pois[1]) items.push(poiItem(pois[1], '14:00'))
  // 美食兴趣 + 非紧凑强度：安排一个下午茶
  if (info.interests.indexOf('美食') >= 0 && density < 4) {
    const tea = pickMeal(city, info, ctx, pois[1] ? pois[1].area : (pois[0] ? pois[0].area : ''), '下午茶')
    if (tea) items.push(mealItem(tea, '15:45', '下午茶'))
  }
  if (pois[2]) items.push(poiItem(pois[2], '16:30'))
  if (pois[3]) items.push(poiItem(pois[3], '17:30'))

  const lastArea = pois.length ? pois[pois.length - 1].area : ''
  const dinner = pickMeal(city, info, ctx, lastArea, '晚餐')
  if (dinner) items.push(mealItem(dinner, '18:30', '晚餐'))

  let remark = ''
  const evening = pickEvening(city, info, ctx, dayNo)
  if (evening) {
    ctx.usedPois.push(evening.name)
    items.push(poiItem(evening, '20:00'))
    remark = '晚间安排：' + evening.name
  } else {
    remark = light ? '轻松模式：晚间自由安排，不排夜间活动' : '晚间自由活动'
  }

  // 时间限制（如「第三天晚上 7 点前结束」）
  const limit = (plan.timeLimits || {})[dayNo]
  if (limit) {
    const limitStr = (limit < 10 ? '0' + limit : limit) + ':00'
    const kept = items.filter(i => i.time < limitStr)
    if (kept.length < items.length) remark = '已按 ' + limitStr + ' 前结束当天行程'
    else remark = remark + '（已按 ' + limitStr + ' 前核对，时间无冲突）'
    items.length = 0
    kept.forEach(i => items.push(i))
  }

  // 交通衔接（基于示例数据）
  const spots = items.filter(i => i.type === '景点')
  if (spots.length) {
    transportLeg(plan, dayNo, '酒店 / 住处', spots[0].location, false)
    for (let i = 1; i < spots.length; i++) {
      transportLeg(plan, dayNo, spots[i - 1].location, spots[i].location, spots[i - 1].location === spots[i].location)
    }
    transportLeg(plan, dayNo, spots[spots.length - 1].location, '酒店 / 住处', false)
  }

  return { day: dayNo, theme: dayTheme(pois, info), area: pois.length ? pois[0].area : '', items, remark }
}

// 全天型景点（迪士尼 / 长城等）：兴趣匹配且天数足够时占用独立一天
function pickFullDayPoi(city, info, plan) {
  if (info.duration < 2) return null
  const excl = plan.exclusions || []
  return city.pois.find(p =>
    p.fullDay && !excl.some(e => poiMatches(p, e.term)) &&
    info.interests.some(name => (DATA.INTEREST_TAGS[name] || []).some(tg => p.tags.indexOf(tg) >= 0))
  ) || null
}

function buildFullDayDay(city, info, plan, ctx, dayNo, poi) {
  ctx.usedPois.push(poi.name)
  const items = [
    poiItem(poi, '09:30'),
    { time: '12:30', type: '餐饮', meal: '午餐', title: '园区内简餐', location: poi.area, cost: 80, note: '示例数据：园区餐饮人均', stay: 60 },
    { time: '18:30', type: '餐饮', meal: '晚餐', title: '返程后住处附近晚餐', location: '住处附近', cost: 50, note: '示例数据', stay: 60 }
  ]
  const limit = (plan.timeLimits || {})[dayNo]
  let remark = poi.note || ''
  if (limit) {
    const limitStr = (limit < 10 ? '0' + limit : limit) + ':00'
    const kept = items.filter(i => i.time < limitStr)
    if (kept.length < items.length) remark = '已按 ' + limitStr + ' 前结束当天行程'
    items.length = 0
    kept.forEach(i => items.push(i))
  }
  transportLeg(plan, dayNo, '酒店 / 住处', poi.area, false)
  transportLeg(plan, dayNo, poi.area, '酒店 / 住处', false)
  return { day: dayNo, theme: poi.area + ' · 全天行程', area: poi.area, items, remark }
}

// 从每日行程中派生「美食推荐」平铺列表
function refreshDiningList(plan) {
  const list = []
  plan.itinerary.forEach(day => {
    day.items.forEach(it => {
      if (it.type === '餐饮') {
        list.push({ day: day.day, meal: it.meal || '', name: it.title, area: it.location || '', cost: it.cost || 0, note: it.note || '' })
      }
    })
  })
  plan.dining = list
}

/* —— 预算计算 + 超支提示 —— */
function calcBudget(plan) {
  const info = plan.tripInfo
  const n = info.travelers
  let ticket = 0
  let dining = 0
  plan.itinerary.forEach(day => {
    day.items.forEach(it => {
      if (it.type === '餐饮') dining += Number(it.cost) || 0
      else ticket += Number(it.cost) || 0
    })
  })
  const traffic = plan.transport.reduce((s, l) => s + (l.cost || 0), 0)
  ticket = Math.round(ticket * n)
  dining = Math.round(dining * n)
  const transport = Math.round(traffic * n)
  const other = Math.round((ticket + dining + transport) * 0.08)
  const total = ticket + dining + transport + other
  const totalBudget = info.totalBudget || 0
  const remain = totalBudget - total

  plan.budget = { ticket, dining, transport, other, total, totalBudget, remain, over: totalBudget > 0 && remain < 0 }
  plan.warnings = []
  if (totalBudget > 0 && remain < 0) {
    plan.warnings.push('当前方案预计超出预算约 ¥' + Math.abs(remain) + '，建议减少部分付费项目或调整餐饮预算。')
  }
  return plan.budget
}

/* —— 天数裁剪：把已有方案截断为前 n 天（不依赖预置数据，任意城市的方案都能用） —— */
function truncatePlanDays(plan, n) {
  plan.itinerary = plan.itinerary.filter(d => d.day <= n).sort((a, b) => a.day - b.day)
  plan.itinerary.forEach((d, i) => { d.day = i + 1 })
  plan.transport = plan.transport.filter(l => l.day <= n)
  plan.dining = (plan.dining || []).filter(d => d.day <= n)
  if (plan.transport.length) plan.transport[plan.transport.length - 1].day = n
}

/* —— 合理性检查（结果页展示） —— */
function runChecks(plan) {
  const info = plan.tripInfo
  const checks = []
  const density = DENSITY[info.travelIntensity] || 3
  const maxPois = Math.max.apply(null, plan.itinerary.map(d => d.items.filter(i => i.type === '景点').length).concat([0]))
  checks.push({
    ok: maxPois <= density,
    text: '每日主要景点不超过「' + info.travelIntensity + '」强度上限（' + density + ' 个/天），当前最多 ' + maxPois + ' 个'
  })
  const mixed = plan.itinerary.filter(d => {
    const areas = {}
    d.items.forEach(i => { if (i.type === '景点' && i.location) areas[i.location] = 1 })
    return Object.keys(areas).length > 1
  })
  checks.push({
    ok: mixed.length === 0,
    text: mixed.length === 0 ? '每天景点集中在同一片区，减少来回折返' : '有 ' + mixed.length + ' 天跨片区安排，已按就近原则尽量集中'
  })
  if (plan.budget) {
    if (!info.totalBudget) {
      checks.push({ ok: true, text: '未设置预算，本方案仅做花费估算' })
    } else if (plan.budget.over) {
      checks.push({ ok: false, text: '预计总花费 ¥' + plan.budget.total + '，超出预算 ¥' + Math.abs(plan.budget.remain) })
    } else {
      checks.push({ ok: true, text: '预计总花费 ¥' + plan.budget.total + '，在预算内（剩余 ¥' + plan.budget.remain + '）' })
    }
  }
  return checks
}

/* —— 出行清单生成（走 models.js 工厂函数） —— */
function generateChecklist(info) {
  const items = []
  const add = (content, group) => items.push(models.makeCheckItem({ content, group }))
  add('身份证（全员）', '证件')
  add('学生证（景区优惠）', '证件')
  add('手机充电器', '电子')
  add('充电宝', '电子')
  add('换洗衣物（按 ' + info.duration + ' 天准备）', '生活')
  add('洗漱用品', '生活')
  add('雨伞', '生活')
  add('纸巾 / 湿巾', '生活')
  add('常用药品', '健康')
  add('创可贴', '健康')
  if (info.hasKids || info.interests.indexOf('亲子') >= 0) {
    add('儿童水杯', '儿童用品')
    add('儿童常用药', '儿童用品')
    add('儿童零食', '儿童用品')
    add('儿童身份证 / 户口本', '证件')
  }
  if (info.interests.indexOf('自然风光') >= 0) {
    add('防晒霜', '户外')
    add('防蚊液', '户外')
    add('舒适运动鞋', '户外')
  }
  if (info.interests.indexOf('美食') >= 0) {
    add('健胃消食片', '健康')
    add('打包保鲜袋', '生活')
  }
  if (info.travelIntensity === '紧凑') add('便携小零食', '生活')
  return items
}

/* —— 跨城大交通：有出发地时补一段去程与返程（示例估算，非实时票价） —— */
function addLongHaul(plan) {
  const info = plan.tripInfo
  const origin = info.origin
  if (!origin || origin === info.destination) return

  // 用稳定伪随机给一个可复现的行程时长，再按真实计价规则折算票价
  const seed = hashCode(origin + '>' + info.destination)
  const minutes = 90 + seed % 210          // 1.5 ~ 5 小时
  const km = Math.round(minutes * 3.2)     // 按高铁平均 192km/h 折算里程
  const byAir = km > 1200
  const mode = byAir ? '飞机（经济舱）' : '高铁（二等座）'
  const cost = byAir
    ? Math.round(400 + km * 0.5)
    : Math.round(km * 0.46)                // 高铁二等座 0.46 元/公里

  plan.transport.unshift({
    day: 1, from: origin, to: info.destination, mode, minutes, cost, mock: true
  })
  plan.transport.push({
    day: info.duration, from: info.destination, to: origin, mode, minutes, cost, mock: true
  })
}

/* —— 生成完整方案 —— */
function generateAll(plan) {
  const info = plan.tripInfo
  const city = DATA.CITIES[info.destination]
  plan.itinerary = []
  plan.transport = []
  const ctx = makeCtx(plan)
  const density = DENSITY[info.travelIntensity] || 3
  const fullDay = pickFullDayPoi(city, info, plan)
  const fullDayNo = fullDay ? Math.min(2, info.duration) : 0
  for (let d = 1; d <= info.duration; d++) {
    if (fullDay && d === fullDayNo) plan.itinerary.push(buildFullDayDay(city, info, plan, ctx, d, fullDay))
    else plan.itinerary.push(buildDay(city, info, plan, ctx, d, density))
  }
  addLongHaul(plan)
  refreshDiningList(plan)
  calcBudget(plan)
  plan.checks = runChecks(plan)
  plan.notes = [
    '方案由本地规则引擎基于预置示例数据生成，非实时数据',
    plan.tripInfo.origin
      ? '已估算「' + plan.tripInfo.origin + ' ⇄ ' + info.destination + '」往返大交通（示例票价，请以 12306 / 航司为准）'
      : '未识别到出发城市，预算不含往返大交通',
    '住宿费用未计入预算'
  ]
}

/* ============================================================
 * Step 7：从一句话创建完整方案（页面入口）
 * ============================================================ */

function createPlanFromInfo(info, assumptions) {
  const plan = models.makeAiPlan({ tripInfo: info, assumptions: assumptions || [] })
  generateAll(plan)
  plan.checklist = generateChecklist(info)
  return plan
}

function createPlan(text) {
  const rec = recognize(text)
  if (rec.missing.length) {
    return {
      status: 'need-info',
      message: '还需要告诉我' + rec.missing.join('、') + '才能帮你规划' + (rec.missing.indexOf('目的地') >= 0 ? '，比如「去上海玩三天」' : '，比如「玩三天」')
    }
  }
  if (!isSupported(rec.info.destination)) {
    return {
      status: 'unsupported-city',
      message: '演示版暂只预置了上海、北京、杭州三座城市的示例数据，还不能规划「' + rec.info.destination + '」，换个城市试试吧'
    }
  }
  return { status: 'ok', plan: createPlanFromInfo(rec.info, rec.assumptions), recognized: rec }
}

/* ============================================================
 * Step 8~9：智能修改 —— 识别修改指令，只重排受影响的部分
 * ============================================================ */

function cleanTerm(s) {
  return (s || '').replace(/(觉得|感觉|安排|行程|景点|项目|地方|太累|太赶|那么)/g, '').trim()
}

// 「博物馆」这类词是否在当前城市数据里有对应对象
function isKnownTerm(term, plan) {
  const city = DATA.CITIES[plan.tripInfo.destination]
  if (!city) return false
  if (city.pois.some(p => poiMatches(p, term))) return true
  if (city.foods.some(f => f.name.indexOf(term) >= 0)) return true
  const common = ['博物馆', '公园', '寺', '塔', '街', '古镇', '乐园', '美术馆', '演出', '夜景', '游船', '胡同']
  return common.indexOf(term) >= 0
}

// 从一句修改指令中解析出全部修改动作（一句话可能包含多个修改）
function parseModifyList(text, plan) {
  const t = (text || '').trim()
  const mods = []
  let m

  const dm = t.match(/第(一|二|两|三|四|五|六|七|八|九|十|\d+)天/)
  const dayNo = dm ? parseNum(dm[1]) : 0

  // 1) 删除类：不想去 / 不要去 XX（.{0,2}? 懒惰匹配，避免吞掉目标词开头的字）
  m = t.match(/(?:不想|不要|别|不打算)(?:再)?[去逛看玩]?.{0,2}?([\u4e00-\u9fa5]{2,8}?)(?=[了啦，。,\.!！?？]|$)/)
  if (m) {
    const term = cleanTerm(m[1])
    if (term && isKnownTerm(term, plan)) mods.push({ kind: 'removePoi', day: dayNo, term: term })
  }

  // 2) 兴趣偏好：更喜欢 / 想看 / 想吃 XX
  const like = t.match(/(?:更喜欢|比较喜欢|偏好|想看|想去|想体验)([\u4e00-\u9fa5]{2,12})/) ||
    t.match(/更想(?:吃|逛|玩)([\u4e00-\u9fa5]{2,12})/)
  if (like) {
    const found = scanInterests(like[1])
    if (found.length) mods.push({ kind: 'interests', interests: found, raw: like[1] })
  }

  // 3) 预算
  m = t.match(/(?:人均|每人)[^\d]{0,4}(\d{3,6})/)
  if (m) {
    mods.push({ kind: 'budgetPerPerson', value: parseNum(m[1]) })
  } else {
    m = t.match(/(?:总预算|预算|总花费|一共|总共|只有|降到)(?:约|是|大概|有)?\s*(\d{3,6})\s*元?/)
    if (m && /元|预算|花费|钱/.test(t)) mods.push({ kind: 'budget', value: parseNum(m[1]) })
  }

  // 4) 人数
  m = t.match(/又(?:有|来了?|加入)(一|二|两|三|\d+)个?(?:朋友|人|同伴|同学)/)
  if (m) {
    mods.push({ kind: 'addTravelers', value: parseNum(m[1]) })
  } else {
    m = t.match(/(?:我们|现在|变成)?(?:一共|总共|现在)?是?(\d+|一|二|两|三|四|五|六|七|八|九|十)个?人/)
    if (m && /我们|现在|一共|总共|变成|人数/.test(t)) mods.push({ kind: 'travelers', value: parseNum(m[1]) })
  }

  // 5) 行程强度
  if (/少安排|轻松|不累|别太赶|太赶|太密集|慢一点|休闲|不要太累|太累/.test(t)) mods.push({ kind: 'intensity', value: '轻松' })
  else if (/多安排|更紧凑|更充实|特种兵|更密集/.test(t)) mods.push({ kind: 'intensity', value: '紧凑' })

  // 5.5) 天数修改：「一天」「改成3天」等（排除「第X天」的时间限制用法）
  // 追加城市（「之后再去苏州玩两天」）例外：「N天」是新增段，本地引擎不做多城市，交给上层提示
  const appendCity = t.match(/(?:再去|然后去|接着去|之后去|顺路去|顺便去|加上)\s*([\u4e00-\u9fa5]{2,6}?)(?:市)?\s*(?:玩|待|停|逛)?\s*(\d+|[一二两三四五六七八九十]+)\s*[天日]/)
  const dmDur = t.match(/(第)?\s*(\d+|[一二两三四五六七八九十]+)\s*天/)
  if (appendCity) {
    mods.push({ kind: 'appendCity', city: appendCity[1].replace(/[市玩儿]+$/, ''), days: parseNum(appendCity[2]) })
  } else if (dmDur && !dmDur[1]) {
    const v = parseNum(dmDur[2])
    if (v >= 1 && v <= 7 && v !== plan.tripInfo.duration) mods.push({ kind: 'duration', value: v })
  }

  // 6) 时间限制：第 X 天（时段）N 点前结束（时段与数字之间允许隔几个字，如「晚上必须7点」）
  m = t.match(/第(一|二|两|三|四|五|六|七|八|九|十|\d+)天/)
  if (m && /以前|之前|[点时]前|结束|回去|返回/.test(t)) {
    const rest = t.slice(m.index + m[0].length)
    const hm = rest.match(/(晚上|夜里|傍晚|下午|中午|上午|早上)?[^，。]{0,8}?(十一|十二|\d+|一|二|两|三|四|五|六|七|八|九|十)[点时](?:钟)?\s*(?:以|之)?前/)
    if (hm) {
      let h = parseNum(hm[2])
      const tod = hm[1] || ''
      if ((tod === '晚上' || tod === '夜里' || tod === '傍晚') && h < 12) h += 12
      else if (tod === '下午' && h < 12) h += 12
      else if (!tod && h > 0 && h < 12) h += 12 // 未说明时段默认按晚上理解
      if (h >= 1 && h <= 24) mods.push({ kind: 'timeLimit', day: parseNum(m[1]), hour: h })
    }
  }

  return mods
}

// 判断一句话是否更像「新需求」而不是「修改」
function looksLikeNewDemand(text, plan) {
  const t = text || ''
  // 追加城市（「之后再去苏州玩两天」）是修改不是新需求：先豁免，交给修改链路（云端规则 2.5 / 本地 appendOnly 提示）
  if (/(再去|然后去|接着去|之后去|顺路去|顺便去|加上)[\u4e00-\u9fa5]{2,6}/.test(t) && /[天日]/.test(t)) return false
  const cityMentioned = DATA.supportedCities().some(c => t.indexOf(c) >= 0 && c !== plan.tripInfo.destination)
  if (cityMentioned) return true
  if (/(\d+|一|二|两|三|四|五|六|七|八|九|十)天/.test(t) && /规划|安排一份|来一份|做一份/.test(t)) return true
  return false
}

// 只重排某一天（保留其他天已用掉的景点 / 餐厅；freshMeals 时该天换一批餐厅）
function regenerateDay(plan, dayNo, freshMeals) {
  const info = plan.tripInfo
  const city = DATA.CITIES[info.destination]
  if (!city) return
  const ctx = makeCtx(plan)
  plan.itinerary.forEach(d => {
    if (d.day === dayNo) {
      if (freshMeals) d.items.forEach(it => { if (it.type === '餐饮') ctx.usedFoods.push(it.title) })
      return
    }
    d.items.forEach(it => {
      if (it.type === '景点') ctx.usedPois.push(it.title)
      else if (it.type === '餐饮') ctx.usedFoods.push(it.title)
    })
  })
  plan.transport = plan.transport.filter(l => l.day !== dayNo)
  const density = DENSITY[info.travelIntensity] || 3
  const idx = plan.itinerary.findIndex(d => d.day === dayNo)
  const newDay = buildDay(city, info, plan, ctx, dayNo, density)
  if (idx >= 0) plan.itinerary[idx] = newDay
  else plan.itinerary.push(newDay)
  refreshDiningList(plan)
}

// 应用修改：解析 → 改 tripInfo / exclusions → 只重排受影响部分 → 重算预算
function applyModify(plan, text) {
  let mods = parseModifyList(text, plan)
  if (!mods.length) return null

  const info = plan.tripInfo
  const changes = []

  // 追加城市：本地引擎没有多城市数据，云端不可用时明确告知（appendOnly=true 时页面只展示提示，不说「已更新」）
  const appendMod = mods.find(m => m.kind === 'appendCity')
  if (appendMod) {
    const curParts = String(info.destination || '').split(/[+＋、,，\s]+/)
    if (curParts.indexOf(appendMod.city) < 0) {
      return {
        appendOnly: true,
        summary: '「' + appendMod.city + '」的追加需要云端大模型规划，当前云端不可用。可稍后重试，或直接发一条包含两个城市的完整需求（如「去上海玩3天再去苏州玩2天」）重新生成'
      }
    }
    mods = mods.filter(m => m.kind !== 'appendCity')
    if (!mods.length) return null
  }

  // 非预置城市的方案（如云端生成的任意城市）：只支持不依赖本地数据的修改
  const cityReady = !!DATA.CITIES[info.destination]
  if (!cityReady) {
    const allowed = { removePoi: 1, budget: 1, budgetPerPerson: 1, travelers: 1, addTravelers: 1, duration: 1 }
    const skippedNames = { intensity: '行程强度', interests: '兴趣偏好', timeLimit: '时间限制' }
    const skipped = []
    mods = mods.filter(m => {
      if (allowed[m.kind]) return true
      if (skippedNames[m.kind]) skipped.push(skippedNames[m.kind])
      return false
    })
    if (skipped.length) changes.push('该方案的目的地不在预置城市中，「' + skipped.join('、') + '」相关的重排暂不支持')
    if (!mods.length) {
      plan.updatedAt = new Date().toISOString()
      return {
        changes: changes,
        summary: changes.join('；') || '该方案的目的地不在预置城市中，暂不支持修改行程内容，可尝试调整预算或人数。'
      }
    }
  }
  const affected = {}
  const freshMealDays = {} // 这些天重排时强制换一批餐厅
  let replanAll = false
  let interestsChanged = false
  let durationChanged = false

  mods.forEach(mod => {
    switch (mod.kind) {
      case 'removePoi': {
        if (!cityReady) {
          // 非预置城市：直接从行程里物理删除，不重排
          let removed = 0
          plan.itinerary.forEach(d => {
            const before = d.items.length
            d.items = d.items.filter(i => !(i.type === '景点' && i.title.indexOf(mod.term) >= 0))
            removed += before - d.items.length
          })
          plan.exclusions.push({ day: 0, term: mod.term })
          changes.push(removed ? '已移除「' + mod.term + '」相关安排' : '方案里没有「' + mod.term + '」相关安排，之后也不会再安排')
          break
        }
        const termIn = day => plan.itinerary.some(d => d.day === day && d.items.some(i => i.type === '景点' && i.title.indexOf(mod.term) >= 0))
        const daysWithTerm = plan.itinerary.filter(d => d.items.some(i => i.type === '景点' && i.title.indexOf(mod.term) >= 0)).map(d => d.day)
        if (mod.day && !termIn(mod.day) && daysWithTerm.length) {
          // 用户说的那天没有该项（实际安排在其他天）：智能响应——全程移除并说明
          plan.exclusions.push({ day: 0, term: mod.term })
          daysWithTerm.forEach(d => { affected[d] = true })
          affected[mod.day] = true // 用户点名的那天也重排（含餐饮按偏好刷新）
          freshMealDays[mod.day] = true
          changes.push('「' + mod.term + '」不在第 ' + mod.day + ' 天（实际安排在第 ' + daysWithTerm.join('、') + ' 天），已全程移除并重新规划')
        } else if (mod.day && !termIn(mod.day)) {
          // 哪天都没有：预防性排除，重排用户点名的那天
          plan.exclusions.push({ day: mod.day, term: mod.term })
          affected[mod.day] = true
          changes.push('方案里没有「' + mod.term + '」相关安排，已重新规划第 ' + mod.day + ' 天并避免安排')
        } else {
          plan.exclusions.push({ day: mod.day, term: mod.term })
          if (mod.day) affected[mod.day] = true
          else replanAll = true
          changes.push((mod.day ? '第 ' + mod.day + ' 天' : '全部行程') + '已移除「' + mod.term + '」相关安排')
        }
        break
      }
      case 'interests': {
        const merged = info.interests.slice()
        mod.interests.forEach(i => { if (merged.indexOf(i) < 0) merged.push(i) })
        if (merged.join(',') !== info.interests.join(',')) {
          info.interests = merged
          interestsChanged = true
          replanAll = true
          changes.push('兴趣偏好已加入「' + mod.interests.join('、') + '」并重新规划')
        } else if (Object.keys(affected).length) {
          // 兴趣没变（如本来就含美食），但用户强调了偏好：受影响的天换一批更贴合的餐厅
          Object.keys(affected).forEach(d => { freshMealDays[d] = true })
          changes.push('已按「' + mod.interests.join('、') + '」偏好重新安排受影响行程的餐饮')
        }
        break
      }
      case 'budgetPerPerson':
        info.budgetPerPerson = mod.value
        info.totalBudget = mod.value * info.travelers
        changes.push('人均预算已调整为 ¥' + mod.value + '（总预算 ¥' + info.totalBudget + '）')
        break
      case 'budget':
        info.totalBudget = mod.value
        info.budgetPerPerson = Math.round(mod.value / info.travelers)
        changes.push('总预算已调整为 ¥' + mod.value)
        break
      case 'addTravelers':
        info.travelers += mod.value
        if (info.budgetPerPerson) info.totalBudget = info.budgetPerPerson * info.travelers
        changes.push('人数已更新为 ' + info.travelers + ' 人')
        break
      case 'travelers':
        if (mod.value > 0 && mod.value !== info.travelers) {
          info.travelers = mod.value
          if (info.budgetPerPerson) info.totalBudget = info.budgetPerPerson * info.travelers
          changes.push('人数已更新为 ' + mod.value + ' 人')
        }
        break
      case 'intensity':
        if (info.travelIntensity !== mod.value) {
          info.travelIntensity = mod.value
          replanAll = true
          changes.push('行程强度已调整为「' + mod.value + '」并重新规划')
        } else {
          changes.push('行程强度已是「' + mod.value + '」，无需调整')
        }
        break
      case 'duration':
        if (info.duration !== mod.value) {
          info.duration = mod.value
          truncatePlanDays(plan, mod.value)
          durationChanged = true
          changes.push('行程已调整为 ' + mod.value + ' 天')
        }
        break
      case 'timeLimit':
        plan.timeLimits = plan.timeLimits || {}
        plan.timeLimits[mod.day] = mod.hour
        affected[mod.day] = true
        changes.push('第 ' + mod.day + ' 天已按 ' + mod.hour + ':00 前结束安排')
        break
    }
  })

  if (replanAll) {
    generateAll(plan)
  } else {
    Object.keys(affected).forEach(d => regenerateDay(plan, Number(d), !!freshMealDays[d]))
    refreshDiningList(plan)
  }

  // 预算是全局的：任何修改后都重算 + 重新检查
  calcBudget(plan)
  plan.checks = runChecks(plan)
  if (interestsChanged || durationChanged) plan.checklist = generateChecklist(info)
  plan.updatedAt = new Date().toISOString()
  return { changes: changes, summary: changes.join('；') }
}

module.exports = {
  parseDemand,
  recognize,
  normalizeInfo,
  isSupported,
  createPlan,
  createPlanFromInfo,
  applyModify,
  looksLikeNewDemand,
  generateChecklist,
  supportedCities: DATA.supportedCities
}
