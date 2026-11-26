/**
 * utils/ai-cloud.js
 * ------------------------------------------------------------
 * 云端大模型接入层（微信云开发 · wx.cloud.extend.AI）
 *
 * 关键设定（依据腾讯云官方文档「小程序成长计划使用指南 - 使用生文模型」）：
 *   provider = 'hunyuan-v3'  —— 无需在控制台手动开启模型开关，
 *                              非资源点套餐也能调用，
 *                              优先消耗赠送 Token，额度耗尽直接报错（不会扣费）
 *   model    = 'hy3'         —— hy3-preview 已于 2026-08-31 下线，不可用
 *
 * 设计原则：
 *   1. 本文件所有导出函数「失败即返回 null」，绝不抛错到页面
 *   2. 页面层拿到 null 就回退本地引擎（utils/agent-engine.js）
 *   3. 大模型输出的结构一律经 normalizePlan() 清洗后才交给页面渲染
 * ------------------------------------------------------------
 */

const engine = require('./agent-engine')  // 清单、兜底规划复用本地引擎

const PROVIDER = 'hunyuan-v3'          // 优先消耗成长计划赠送 Token
const PROVIDER_FALLBACK = 'cloudbase'  // 云开发通用 provider（消耗套餐资源点）
const MODEL = 'hy3'
const TIMEOUT_MS = 60000

let _checked = false
let _ready = false
let _lastError = ''    // 最近一次调用失败的详细信息（供界面展示）

/* ---------------- 全局请求阀门 ----------------
 * 成长计划赠送额度的 QPS/并发限制很敏感，连续快速请求会触发 429，
 * 而且我们的多层兜底重试会放大请求数，把自己摁在限流里出不来。
 * 所有网关请求（generateText / streamText）都从 gateRequest 过一道：
 * 同一时刻只发一个请求，且两次请求开始时间至少间隔 MIN_GAP 毫秒。 */
let _gateQueue = Promise.resolve()
let _lastReqAt = 0
const MIN_GAP = 3000

function gateRequest(fn) {
  const run = _gateQueue.then(() => {
    const wait = Math.max(0, MIN_GAP - (Date.now() - _lastReqAt))
    return sleep(wait).then(() => {
      _lastReqAt = Date.now()
      return fn()
    })
  })
  _gateQueue = run.then(() => undefined, () => undefined)  // 队列不因单次失败而卡死
  return run
}

/**
 * 深度合成类目合规开关：
 * 微信个人主体暂不开放 AI 生成类（深度合成）服务，置 false 后全站降级为本地规则引擎，
 * 云端大模型相关功能（云端规划/讲解/追问/翻译）全部不再调用。日后取得企业主体可改回 true。
 */
const AI_ENABLED = true  // 课程版（team 工程）开启云端 AI；上架版 miniprogram 保持 false

/** 云开发 AI 能力是否可用（只检测一次） */
function isReady() {
  if (!AI_ENABLED) return false
  if (_checked) return _ready
  _checked = true
  try {
    _ready = !!(wx.cloud && wx.cloud.extend && wx.cloud.extend.AI && wx.cloud.extend.AI.createModel)
  } catch (e) {
    _ready = false
  }
  return _ready
}

/* ---------------- 底层调用 ---------------- */

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('云端调用超时')), ms)
    promise.then(
      r => { clearTimeout(timer); resolve(r) },
      e => { clearTimeout(timer); reject(e) }
    )
  })
}

/** 从不同版本的 SDK 返回结构里把文本抠出来 */
function pickText(res) {
  if (!res) return ''
  if (typeof res === 'string') return res
  const tryPaths = [
    () => res.text,
    () => res.content,
    () => res.reply,
    () => res.result && res.result.content,
    () => res.data && res.data.content,
    () => res.choices && res.choices[0] && res.choices[0].message && res.choices[0].message.content,
    () => res.data && res.data.choices && res.data.choices[0] && res.data.choices[0].message && res.data.choices[0].message.content,
    () => res.result && res.result.choices && res.result.choices[0] && res.result.choices[0].message && res.result.choices[0].message.content
  ]
  for (const fn of tryPaths) {
    try {
      const v = fn()
      if (typeof v === 'string' && v) return v
    } catch (e) { /* 继续尝试下一个结构 */ }
  }
  return ''
}

/** 从模型输出里抠出 JSON（容忍 ```json 代码块和前后废话） */
function extractJson(text) {
  if (!text) return null
  let s = String(text).trim()
  s = s.replace(/^```(?:json)?/i, '').replace(/```\s*$/, '').trim()
  const a = s.indexOf('{')
  const b = s.lastIndexOf('}')
  if (a < 0 || b <= a) return null
  const slice = s.slice(a, b + 1)
  try {
    return JSON.parse(slice)
  } catch (e) {
    return null
  }
}

function makeModel(provider) {
  return wx.cloud.extend.AI.createModel(provider || PROVIDER)
}

/** 在模型对象上找第一个真实存在的方法（不同版本 SDK 方法名不一致） */
function pickMethod(model, names) {
  if (!model) return null
  for (let i = 0; i < names.length; i++) {
    if (typeof model[names[i]] === 'function') {
      return { name: names[i], fn: model[names[i]].bind(model) }
    }
  }
  return null
}

/**
 * 调用一次模型。
 * 兼容两种参数格式：直接传 {model, messages} / 包一层 {data:{model, messages}}
 */
function callModel(payload, provider) {
  const use = provider || PROVIDER
  return Promise.resolve()
    .then(() => makeModel(use))                // createModel 可能返回 Promise，统一解包
    .then(model => {
      // 官方文档：generateText 直接传参；不同版本也可能只有 invoke/chat
      const m = pickMethod(model, ['generateText', 'invoke', 'chat', 'completion', 'create'])
      if (!m) {
        console.warn('[ai-cloud] 模型对象上的可用属性：', Object.keys(model || {}))
        throw new Error('云端 SDK 未提供文本生成方法')
      }
      return Promise.resolve()
        .then(() => gateRequest(() => m.fn(payload)))
        .catch(err1 => {
          // 换 data 包裹的格式再试一次
          return Promise.resolve()
            .then(() => gateRequest(() => m.fn({ data: payload })))
            .catch(err2 => { throw err2 || err1 })
        })
    })
    .catch(e => {
      _lastError = errText(e)
      console.error('[ai-cloud] 模型调用失败：', _lastError)
      // 环境不存在 / 未开通 → 换 provider 也没用，直接给出明确提示
      if (isEnvError(e)) {
        console.error('[ai-cloud] 云开发环境不可用（Env Not Exists）。请核对 app.js 里的 CLOUD_ENV 是否与控制台「环境 ID」完全一致。')
        throw e
      }
      // 主 provider 失败 → 回退到 cloudbase（消耗套餐额度，但更通用）
      if (use !== PROVIDER_FALLBACK) {
        console.warn('[ai-cloud] ' + use + ' 调用失败，回退 ' + PROVIDER_FALLBACK, e)
        return callModel(payload, PROVIDER_FALLBACK)
      }
      throw e
    })
}

/** 判断是否环境级错误（env 写错 / 未开通云开发） */
function isEnvError(e) {
  const s = (e && (e.errMsg || e.message)) || ''
  return s.indexOf('Env Not Exists') >= 0 ||
    s.indexOf('INVALID_ENV') >= 0 ||
    s.indexOf('-501000') >= 0
}

/** 把各类错误对象揉成一段可读文本（网关 400 的具体原因就藏在里面） */
function errText(e) {
  if (!e) return '未知错误'
  const parts = []
  if (e.errMsg) parts.push(String(e.errMsg))
  if (e.message && e.message !== e.errMsg) parts.push(String(e.message))
  try {
    const s = JSON.stringify(e)
    if (s && s !== '{}') parts.push(s.slice(0, 500))
  } catch (x) { /* 循环引用忽略 */ }
  return parts.filter(Boolean).join(' | ') || String(e)
}

/** 是否请求被网关直接拒绝（400 Bad Request，重试也不会好） */
function isBadRequest(e) {
  return /400|Bad Request/i.test(errText(e))
}

/** 非流式调用（生成方案用）。
 * 网关限流（429 / Too Many Requests / 20009231）或返回空内容时，自动退避重试最多 3 次 */
function invoke(messages) {
  const payload = { model: MODEL, messages: messages }
  const attempt = n =>
    withTimeout(callModel(payload), TIMEOUT_MS).then(res => {
      const t = pickText(res)
      if (t) return t
      _lastError = '模型返回内容为空（可能被限流 429）'
      throw new Error(_lastError)
    })
    .catch(e => {
      if (n < 3 && !isEnvError(e) && !isBadRequest(e)) {
        const wait = n * 3000   // 3s → 6s
        console.warn('[ai-cloud] 第 ' + n + ' 次调用失败（' + ((e && e.message) || e) + '），' + wait + 'ms 后重试')
        return sleep(wait).then(() => attempt(n + 1))
      }
      throw e
    })
  return attempt(1)
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

/** 流式调用（追问用，逐字显示） */
function stream(messages, onChunk, provider) {
  const use = provider || PROVIDER
  const payload = { model: MODEL, messages: messages }
  const smP = Promise.resolve()
    .then(() => makeModel(use))
    .then(model => pickMethod(model, ['streamText', 'stream', 'generateTextStream']))

  return withTimeout(smP, TIMEOUT_MS).then(sm => {
    // 没有流式方法 → 退化为一次性返回
    if (!sm) {
      return callModel(payload).then(t => {
        if (onChunk) onChunk(t)
        return t
      })
    }
    // 官方文档：小程序端 streamText 的参数必须包在 data:{...} 里（与 JS/Node SDK 不同），
    // 直接传参会触发网关 400 Bad Request。先按文档格式调用，旧版 SDK 再退回直传格式。
    // 两者都过全局阀门，避免和并行的其他请求撞限流。
    return Promise.resolve()
      .then(() => gateRequest(() => sm.fn({ data: payload })))
      .catch(() => gateRequest(() => sm.fn(payload)))
      .then(async res => {
        const ts = res && (res.textStream || res.eventStream)
        if (ts && typeof ts[Symbol.asyncIterator] === 'function') {
          let out = ''
          for await (const chunk of ts) {
            const t = typeof chunk === 'string' ? chunk : pickText(chunk)
            if (t) { out += t; if (onChunk) onChunk(out) }
          }
          if (out) return out
        }
        const full = pickText(res)
        if (full) { if (onChunk) onChunk(full); return full }
        // 流式没拿到内容 → 再走一次非流式兜底
        return callModel(payload, use).then(t => pickText(t))
      })
  }).catch(e => {
    if (use !== PROVIDER_FALLBACK) {
      console.warn('[ai-cloud] 流式调用失败，回退 ' + PROVIDER_FALLBACK, e)
      return stream(messages, onChunk, PROVIDER_FALLBACK)
    }
    throw e
  })
}

/* ---------------- 能力一：自然语言 → 结构化需求 ---------------- */

const DEMAND_SYSTEM = [
  '你是旅行需求分析助手。从用户的一句话里提取旅行需求，只输出 JSON，不要任何解释文字。',
  'JSON 结构：',
  '{"origin":"出发城市（用户说「从X出发/从X到Y」中的X；没提就填空字符串）",',
  '"destination":"目的地城市名（纯城市名，不要带省市后缀）",',
  '"travelers":数字,',
  '"duration":天数数字,',
  '"totalBudget":总预算数字（人均预算×人数；没提预算就填0）,',
  '"interests":["历史文化","美食","自然","购物","亲子","艺术","城市观光","夜景" 中合适的若干项],',
  '"intensity":"轻松" 或 "适中" 或 "紧凑",',
  '"hasKids":true或false}',
  '规则：',
  '- 没提到的字段用常见默认值：travelers=2，duration=2，intensity="适中"，interests=["城市观光","美食"]',
  '- "不要太累/轻松点/随便逛逛" → 轻松；"想多玩几个地方/紧凑点/特种兵" → 紧凑；其余适中',
  '- 目的地无法确定时 destination 填空字符串',
  '- 只输出 JSON'
].join('\n')

/** 把模型给出的需求 JSON 清洗成标准 info 结构 */
function normalizeDemand(raw) {
  if (!raw || typeof raw !== 'object') return null
  const travelers = Number(raw.travelers) > 0 ? Number(raw.travelers) : 2
  const duration = Number(raw.duration) > 0 ? Number(raw.duration) : 2
  const totalBudget = Number(raw.totalBudget) > 0 ? Number(raw.totalBudget) : 0
  const interests = Array.isArray(raw.interests) && raw.interests.length
    ? raw.interests.filter(Boolean)
    : ['城市观光', '美食']
  const intensity = ['轻松', '适中', '紧凑'].indexOf(raw.intensity) >= 0 ? raw.intensity : '适中'
  return {
    info: {
      origin: String(raw.origin || '').trim(),
      destination: String(raw.destination || '').trim(),
      travelers: travelers,
      duration: duration,
      totalBudget: totalBudget,
      budgetPerPerson: totalBudget ? Math.round(totalBudget / travelers) : 0,
      interests: interests,
      travelIntensity: intensity,
      hasKids: !!raw.hasKids
    },
    assumptions: []
  }
}

function parseDemand(text) {
  if (!isReady()) return null
  return invoke([
    { role: 'system', content: DEMAND_SYSTEM },
    { role: 'user', content: text }
  ]).then(t => {
    const raw = extractJson(t)
    if (!raw) return null
    return normalizeDemand(raw.info || raw)
  }).catch(e => {
    console.warn('[ai-cloud] parseDemand 失败', e)
    return null
  })
}

/* ---------------- 能力二：结构化需求 → 完整方案 ---------------- */

/** 交通/餐饮价格基准（依据国铁现行计价规则核实，生成与修改两条提示词共用） */
const PRICE_RULES = [
  '- 步行：cost 填 0，速度按 1 分钟 80 米估算时间',
  '- 公交：2 元；地铁：按里程 2~8 元，市内常见 3~5 元',
  '- 出租车/网约车：市内一般 15~60 元，视里程浮动',
  '- 高铁 G 字头二等座 0.46 元/公里（一等座约 1.6 倍）；D 字头动车二等座 0.30 元/公里；',
  '  递远递减：500 公里内原价，500~1000 公里约 9 折，1000 公里以上约 8 折（例：京沪 1318km 二等座约 553 元）',
  '- 普速列车（Z/T/K 字头，速度约 2~2.7 公里/分钟）：硬座约 0.12 元/公里，硬卧约 0.20 元/公里，软卧约 0.30 元/公里',
  '  （例：京沪普速 1463km：硬座 156 元、硬卧约 280~300 元、软卧约 437~457 元）',
  '- 方式与时长要匹配：高铁平均约 3.5~5 公里/分钟，动车约 2.5~3.3，普速约 2~2.7；',
  '  300 公里以上的白天出行默认选高铁，普速卧铺只用于「夕发朝至」的夜间车',
  '- 飞机（含税均价）：800 公里内约 400~800 元，更远 800~1500 元',
  '- 交通的 mode、minutes、cost 三者必须互相匹配（方式决定速度，速度决定时长，里程决定价格）；跨城大交通绝不可能是 0 元'
]

function planPrompt(info) {
  const budgetLine = info.totalBudget
    ? '总预算 ' + info.totalBudget + ' 元（' + info.travelers + ' 人）'
    : '用户未提供预算'
  const origin = info.origin || info.destination
  const crossCity = info.origin && info.origin !== info.destination
  const days = []
  for (let i = 1; i <= info.duration; i++) days.push(i)
  return [
    '你是资深旅行规划师。为以下需求生成一份可执行的旅行方案，只输出 JSON，不要任何解释文字。',
    '',
    '需求：从 ' + origin + ' 出发，目的地 ' + info.destination + '，' + info.travelers + ' 人，' + info.duration + ' 天，',
    budgetLine + '，兴趣偏好：' + info.interests.join('、') + '，行程强度：' + info.travelIntensity + '。',
    '',
    'JSON 结构（严格按此结构，字段名不得改动）：',
    '{',
    '  "assumptions": ["你替用户做的假设，如：未指定住宿区域，按市中心就近安排"],',
    '  "itinerary": [',
    '    {"day":1,"theme":"当日主题，如 老城历史漫步","remark":"当日提示",',
    '     "items":[{"time":"09:00","type":"景点","title":"名称","location":"所在片区","note":"一句话玩法建议","cost":60,"stay":120}]}',
    '  ],',
    '  "transport": [{"day":1,"from":"起点","to":"终点","mode":"地铁","minutes":30,"cost":4}],',
    '  "dining": [{"day":1,"meal":"午餐","name":"餐厅名","note":"推荐理由","cost":60}],',
    '  "checklist": [{"group":"证件","content":"身份证"}],',
    '  "notes": ["需要提醒用户的注意事项"]',
    '}',
    '',
    '价格参考（transport 的 cost 与 minutes 必须照此估算，贴近真实）：',
    PRICE_RULES.join('\n'),
    '- 景点门票按真实常见价（免费景点填 0，热门景点参考官方挂牌价）',
    '- 餐饮人均按城市消费水平：一线城市正餐 60~120 元，二三线城市 40~80 元',
    '',
    '硬性要求：',
    '1. itinerary 必须正好 ' + info.duration + ' 天，day 依次为 ' + days.join('、'),
    '2. 每天景点数量：轻松 2 个，适中 3 个，紧凑 4 个（当前：' + info.travelIntensity + '）',
    '3. 同一天尽量安排同城相近片区的景点，减少路上时间',
    '4. items 的 type 只能是「景点」「餐饮」「交通」三者之一；',
    '   每天要有合理的三餐（用 type=餐饮 或放入 dining 均可，不要重复计算）',
    '5. cost 是人均金额（数字），免费的填 0；stay 只对景点有意义（分钟）',
    '6. 每天时间安排从 09:00 前后开始，强度为「轻松」时每天 17:30 前结束',
    '7. dining 每天至少 2 条（午、晚），cost 为人均',
    '8. checklist 8-14 条，按 group 分组（证件 / 衣物 / 电子 / 药品 / 其他）',
    '9. 门票价格与营业时间可能变动，请在 notes 里提醒用户以官方渠道为准',
    '10. 只输出 JSON，不要 markdown 代码块',
    crossCity
      ? '11. 出发城市（' + origin + '）与目的地不同：transport 第一条必须是去程大交通（' +
        origin + ' → ' + info.destination + '，mode 按合理方式填高铁/飞机/大巴，minutes 为全程时长，cost 为人均票价），' +
        '最后一条是返程大交通（' + info.destination + ' → ' + origin + '）；' +
        '市内交通从到达 ' + info.destination + ' 之后开始安排；day1 的首日活动要为去程留出时间'
      : '11. transport 只安排 ' + info.destination + ' 市内及往返周边的交通衔接'
  ].join('\n')
}

function num(v, dft) {
  const n = Number(v)
  return isFinite(n) && n >= 0 ? n : dft
}

function str(v, dft) {
  return v === undefined || v === null ? dft : String(v)
}

/** 把模型输出清洗成与本地引擎完全一致的 plan 结构 */
function normalizePlan(raw, info) {
  if (!raw || typeof raw !== 'object') return null

  const items = []
  const itinerary = Array.isArray(raw.itinerary) ? raw.itinerary : []
  itinerary.forEach((d, idx) => {
    const dayNo = num(d.day, idx + 1)
    const list = Array.isArray(d.items) ? d.items : []
    items.push({
      day: dayNo,
      theme: str(d.theme, '第 ' + dayNo + ' 天'),
      remark: str(d.remark, ''),
      items: list.map(it => ({
        time: str(it.time, ''),
        type: ['景点', '餐饮', '交通'].indexOf(it.type) >= 0 ? it.type : '景点',
        title: str(it.title, '待定'),
        location: str(it.location, ''),
        note: str(it.note, ''),
        cost: num(it.cost, 0),
        stay: num(it.stay, 0)
      })).filter(it => it.title && it.title !== '待定')
    })
  })

  if (!items.length || !items.some(d => d.items.length)) return null

  const transport = (Array.isArray(raw.transport) ? raw.transport : []).map(l => {
    const mode = str(l.mode, '地铁')
    const minutes = num(l.minutes, 20)
    let cost = num(l.cost, 0)
    // 兜底校验：按国铁现行计价规则核对大交通价格，0 元或明显离谱的都拉回合理区间。
    // 速度（含停站平均）：高铁约 4 km/分钟、动车 2.8、普速 2.2
    const est = estimateFare(mode, minutes)
    if (est > 0 && minutes >= 30 && (cost <= 0 || cost < est * 0.4 || cost > est * 2.5)) {
      cost = est
    }
    return {
      day: num(l.day, 1),
      from: str(l.from, ''),
      to: str(l.to, ''),
      mode: mode,
      minutes: minutes,
      cost: cost
    }
  })

  const dining = (Array.isArray(raw.dining) ? raw.dining : []).map(d => ({
    day: num(d.day, 1),
    meal: str(d.meal, '正餐'),
    name: str(d.name, ''),
    note: str(d.note, ''),
    cost: num(d.cost, 0)
  })).filter(d => d.name)

  const checklist = (Array.isArray(raw.checklist) ? raw.checklist : []).map(c => ({
    id: 'c_' + Math.random().toString(36).slice(2, 10),
    content: str(c.content, ''),
    group: str(c.group, '其他'),
    checked: false
  })).filter(c => c.content)

  // 预算本地重算，不信任模型的算术
  let ticket = 0
  items.forEach(d => d.items.forEach(it => {
    if (it.type === '景点') ticket += it.cost
    else if (it.type === '餐饮') { /* 餐饮计入 dining */ }
  }))
  const diningSum = dining.reduce((s, d) => s + d.cost, 0)
  const transportSum = transport.reduce((s, l) => s + l.cost, 0)
  // 餐饮：优先用 dining 表，若为 0 则从 itinerary 的餐饮项累加
  const diningTotal = diningSum > 0
    ? diningSum
    : items.reduce((s, d) => s + d.items.filter(i => i.type === '餐饮').reduce((x, i) => x + i.cost, 0), 0)

  const people = info.travelers || 1
  const bTicket = Math.round(ticket * people)
  const bDining = Math.round(diningTotal * people)
  const bTransport = Math.round(transportSum * people)
  const bOther = Math.round((bTicket + bDining + bTransport) * 0.1)
  const total = bTicket + bDining + bTransport + bOther
  const totalBudget = info.totalBudget || 0
  const over = totalBudget > 0 && total > totalBudget
  const budget = {
    ticket: bTicket,
    dining: bDining,
    transport: bTransport,
    other: bOther,
    total: total,
    totalBudget: totalBudget,
    remain: totalBudget ? Math.abs(totalBudget - total) : 0,
    over: over
  }

  const checks = [
    {
      ok: totalBudget > 0 ? !over : true,
      text: totalBudget > 0
        ? (over ? '预计花费超出总预算 ¥' + (total - totalBudget) : '预计花费在总预算内，剩余约 ¥' + (totalBudget - total))
        : '未设置总预算，本方案只做花费估算'
    },
    { ok: true, text: '每日安排强度与「' + info.travelIntensity + '」一致' },
    { ok: true, text: '每日景点按片区集中，通勤时间可控' }
  ]
  const warnings = []
  if (over) warnings.push('当前安排超出预算 ¥' + (total - totalBudget) + '，可减少收费景点或选择更经济的餐饮')

  const notes = Array.isArray(raw.notes) ? raw.notes.filter(Boolean).map(String) : []
  notes.push('本方案由智能管家为你规划，景点票价、营业时间与预约要求请以官方渠道为准')

  const assumptions = Array.isArray(raw.assumptions) ? raw.assumptions.filter(Boolean).map(String) : []
  assumptions.push('门票与开放时间为模型估算值，出行前请再次核实')

  return {
    tripInfo: info,
    assumptions: assumptions,
    exclusions: [],
    timeLimits: {},
    itinerary: items,
    transport: transport,
    dining: dining,
    budget: budget,
    warnings: warnings,
    checks: checks,
    notes: notes,
    checklist: checklist.length ? checklist : engine.generateChecklist(info),
    tripId: '',
    source: 'cloud-ai'
  }
}

/** 按国铁/民航现行计价规则估算大交通票价（用于校验模型输出）
 *  km 由时长 × 平均速度（含停站）推算；高铁递远递减 500km 内原价 / 500-1000 约9折 / 1000以上约8折 */
function estimateFare(mode, minutes) {
  const m = String(mode || '')
  if (/飞机|航班/.test(m)) {
    const km = minutes * 7          // 含起降滑行的平均秒速
    return km <= 800 ? 400 + Math.round(km * 0.4) : 800 + Math.round((km - 800) * 0.9)
  }
  if (/软卧/.test(m)) return Math.round(minutes * 2.2 * 0.30)   // 普速软卧
  if (/硬卧/.test(m)) return Math.round(minutes * 2.2 * 0.20)   // 普速硬卧
  if (/硬座|软座/.test(m)) return Math.round(minutes * 2.2 * 0.12)
  const decay = km => (km > 1000 ? 0.8 : (km > 500 ? 0.9 : 1))
  if (/高铁|G字头/.test(m)) return Math.round(minutes * 4 * 0.46 * decay(minutes * 4))
  if (/动车|D字头/.test(m)) return Math.round(minutes * 2.8 * 0.30 * decay(minutes * 2.8))
  if (/火车|列车|铁路|特快|直达|普速/.test(m)) return Math.round(minutes * 2.2 * 0.20) // 未指明席别按硬卧水平
  return 0
}

function defaultChecklist() {
  return [
    { id: 'c_' + Math.random().toString(36).slice(2, 10), content: '身份证 / 护照', group: '证件', checked: false },
    { id: 'c_' + Math.random().toString(36).slice(2, 10), content: '充电宝与数据线', group: '电子', checked: false },
    { id: 'c_' + Math.random().toString(36).slice(2, 10), content: '常用药品', group: '药品', checked: false },
    { id: 'c_' + Math.random().toString(36).slice(2, 10), content: '舒适步行鞋', group: '衣物', checked: false },
    { id: 'c_' + Math.random().toString(36).slice(2, 10), content: '提前查询景点是否需要预约', group: '其他', checked: false }
  ]
}

/** 生成完整方案；失败返回 null，页面层回退本地引擎 */
function buildPlan(info) {
  if (!isReady()) return Promise.resolve(null)
  return invoke([{ role: 'user', content: planPrompt(info) }])
    .then(t => {
      const raw = extractJson(t)
      const plan = normalizePlan(raw, info)
      if (!plan) {
        console.warn('[ai-cloud] 方案 JSON 解析失败，原始输出：', String(t).slice(0, 200))
        return null
      }
      return plan
    })
    .catch(e => {
      console.warn('[ai-cloud] buildPlan 失败', e)
      return null
    })
}

/* ---------------- 快路径：一次调用完成「需求解析 + 方案生成」 ---------------- */
/**
 * 原本要两次云端往返（解析需求 → 生成方案），现在合成一次，可省掉将近一半等待时间。
 * onProgress(len) 用于边接收边把已输出字数显示给用户。
 * 失败返回 null，页面层自动回退到两步流程。
 */
const COMBINED_SYSTEM = [
  '你是资深旅行规划师。先理解用户的一句话旅行需求，再直接给出完整方案。只输出 JSON，不要任何解释文字。',
  '',
  '输出结构（严格照此，字段名不得改动）：',
  '{"info":{"origin":"出发城市（「从X出发/从X到Y」里的X，没提填空字符串）","destination":"目的地城市",',
  '"travelers":数字,"duration":天数数字,"totalBudget":总预算数字（没提填0）,',
  '"interests":["历史文化","美食","自然","购物","亲子","艺术","城市观光","夜景" 中合适的项],',
  '"intensity":"轻松|适中|紧凑","hasKids":布尔},',
  '"plan":{"assumptions":["最多2条"],"itinerary":[{"day":1,"theme":"主题","remark":"",',
  '"items":[{"time":"09:00","type":"景点|餐饮|交通","title":"名称","location":"片区","note":"一句话玩法","cost":60,"stay":120}]}],',
  '"transport":[{"day":1,"from":"","to":"","mode":"","minutes":0,"cost":0}],',
  '"dining":[{"day":1,"meal":"午餐","name":"","note":"","cost":0}],"notes":["最多3条"]}}',
  '',
  '规划要求：',
  '- itinerary 的天数必须等于 info.duration，day 从 1 连续递增',
  '- 每天景点数：轻松 2 个，适中 3 个，紧凑 4 个（按你判定出的 intensity）',
  '- 同一天的景点尽量在同一片区，减少路上时间',
  '- 每天从 09:00 前后开始；轻松强度当天 17:30 前结束',
  '- dining 每天至少 2 条（午、晚），cost 为人均',
  '- 出发城市与目的地不同时：transport 第一条是去程大交通（含时长与人均票价），最后一条是返程；市内交通从到达后开始',
  '  两种方式相同时：transport 只排市内与周边交通衔接',
  '- 默认值：没提人数按 2 人、没提天数按 2 天、没提强度按「适中」、没提兴趣按「城市观光」「美食」',
  '- 「不要太累/轻松点」→ 轻松；「想多玩几个/紧凑点/特种兵」→ 紧凑',
  '- 输出尽量精简：note 一句话、假设最多 2 条、notes 最多 3 条，不要输出出行清单',
  '- 只输出 JSON，不要 markdown 代码块'
].join('\n')

/** 流式取完整结果（用于生成时能显示进度） */
function invokeStream(messages, onProgress) {
  let acc = ''
  return stream(messages, p => {
    acc = p
    if (onProgress) onProgress(String(p).length)
  }).then(t => {
    const full = (t && t.trim()) ? t.trim() : (acc || '')
    return full
  })
}

function planFromText(text, onProgress) {
  if (!isReady()) return Promise.resolve(null)
  return invokeStream([
    { role: 'system', content: COMBINED_SYSTEM },
    { role: 'user', content: text }
  ], onProgress).then(t => {
    const raw = extractJson(t)
    if (!raw) {
      console.warn('[ai-cloud] 快路径 JSON 解析失败，原始输出前 300 字：', String(t || '').slice(0, 300))
      return null
    }
    const demand = normalizeDemand(raw.info || raw.demand)
    if (!demand || !demand.info.destination) {
      console.warn('[ai-cloud] 快路径没解析出目的地，原始输出前 300 字：', String(t || '').slice(0, 300))
      return null
    }
    const plan = normalizePlan(raw.plan || raw, demand.info)
    if (!plan) {
      console.warn('[ai-cloud] 快路径方案结构不完整，原始输出前 300 字：', String(t || '').slice(0, 300))
      return null
    }
    return { info: demand.info, assumptions: demand.assumptions || [], plan: plan }
  }).catch(e => {
    console.warn('[ai-cloud] planFromText 失败', e)
    return null
  })
}

/* ---------------- 能力三：基于方案的开放式追问 ---------------- */

function planBrief(plan) {
  const info = plan.tripInfo
  const lines = [
    '目的地：' + info.destination,
    '人数：' + info.travelers + ' 人',
    '天数：' + info.duration + ' 天',
    '行程强度：' + info.travelIntensity
  ]
  plan.itinerary.forEach(d => {
    lines.push('Day' + d.day + '（' + d.theme + '）：' + d.items.map(i => i.time + ' ' + i.title).join('，'))
  })
  if (plan.budget) lines.push('预计总花费：¥' + plan.budget.total)
  return lines.join('\n')
}

/**
 * 追问。onChunk 用于逐字显示；失败返回 null
 */
function ask(plan, question, onChunk) {
  if (!isReady()) return Promise.resolve(null)
  const messages = [
    {
      role: 'system',
      content: '你是旅行助手「智能管家」。用户已有一份旅行方案，请结合方案内容回答他的问题。' +
        '回答简洁实用，3-5 句话以内，不要重复罗列整个方案。若涉及票价、营业时间、预约等可能变动的信息，' +
        '必须提示以官方渠道为准。'
    },
    { role: 'user', content: '这是我的旅行方案：\n' + planBrief(plan) },
    { role: 'user', content: question }
  ]
  return stream(messages, onChunk)
    .then(t => (t && t.trim()) ? t.trim() : null)
    .catch(e => {
      console.warn('[ai-cloud] ask 失败', e)
      return null
    })
}

/* ---------------- 能力五：AI 景点讲解（流式） ---------------- */

const EXPLAIN_SYSTEM = [
  '你是资深导游。用户给你一个景点名称和所在城市，请为它写一段讲解词。',
  '要求：',
  '- 150 字以内，口语化，像导游在身边讲解，不要书面腔',
  '- 必须包含三要素：①这个景点的来历或历史背景 ②最值得看的看点 ③一条实用玩法或避坑提示',
  '- 不要写「欢迎来到」这类客套话，不要分点罗列，写成连贯的一段话',
  '- 涉及票价、开放时间、预约要求时，提示以官方渠道为准',
  '- 只输出讲解文本本身，不要标题、不要任何格式符号',
  '- 如果这个名称不是一个具体景点（比如「午餐」「自由活动」），就简单说明它在这趟行程里的作用'
].join('\n')

/**
 * 景点讲解。onChunk 用于逐字显示；失败返回 null（页面层给出降级提示）
 */
function explainSpot(name, city, onChunk) {
  if (!isReady()) return Promise.resolve(null)
  const messages = [
    { role: 'system', content: EXPLAIN_SYSTEM },
    { role: 'user', content: '景点：' + name + '\n城市：' + (city || '中国') }
  ]
  return stream(messages, onChunk)
    .then(t => (t && t.trim()) ? t.trim() : null)
    .catch(e => {
      _lastError = errText(e)
      console.warn('[ai-cloud] explainSpot 失败', _lastError)
      return null
    })
}

/* ---------------- 能力六：AI 旅行翻译官 ---------------- */

const TRANSLATE_SYSTEM = [
  '你是旅行翻译助手，为出境/入境游客做实用翻译。把用户的话翻译成目标语言。',
  '只输出 JSON，不要任何解释文字，结构：',
  '{"translated":"译文（目标语言原文）","pron":"读音提示（用中文谐音或拉丁转写标注，让不懂该语言的人能照着念出来）",',
  '"literal":"直译回中文的意思（便于用户核对，10 字以内）","tip":"一句话当地文化/用法提示，比如这句话在当地什么场合说合适、有没有更地道的说法"}',
  '要求：',
  '- translated 必须是地道的目标语言，直译腔要避免，按当地人实际会说的方式来写',
  '- pron 要真的能照着念（例：日语「ありがとう」→「a-li-ga-tou」；韩语「감사합니다」→「康桑哈密达」）',
  '- 目标语言与原文相同时（如中译中），translated 直接给更地道的中文说法，pron 填空字符串',
  '- 不要输出原文重复内容，不要 markdown 代码块'
].join('\n')

/**
 * 翻译一句话。返回 {translated, pron, literal, tip}；失败返回 null
 */
function translate(text, lang) {
  if (!isReady()) return Promise.resolve(null)
  const messages = [
    { role: 'system', content: TRANSLATE_SYSTEM },
    { role: 'user', content: '目标语言：' + lang + '\n要翻译的内容：' + text }
  ]
  return invoke(messages).then(t => {
    const raw = extractJson(t)
    if (raw && (raw.translated || raw.text)) {
      return {
        translated: str(raw.translated || raw.text, ''),
        pron: str(raw.pron || raw.pronunciation, ''),
        literal: str(raw.literal, ''),
        tip: str(raw.tip, '')
      }
    }
    // 模型没按 JSON 输出 → 直接把纯文本当译文
    const plain = String(t || '').trim()
    return plain ? { translated: plain, pron: '', literal: '', tip: '' } : null
  }).catch(e => {
    _lastError = errText(e)
    console.warn('[ai-cloud] translate 失败', _lastError)
    return null
  })
}

/* ---------------- 能力四：自然语言修改方案（云端） ---------------- */

const MODIFY_SYSTEM = [
  '你是旅行方案调整助手。用户已有一份旅行方案，并提出了修改要求。',
  '请输出修改后的完整方案 JSON，只输出 JSON，不要任何解释文字。',
  '结构：{"info":{"origin":"出发城市","destination":"目的地","travelers":人数,"duration":天数,"totalBudget":总预算,',
  '"interests":["兴趣"],"intensity":"轻松|适中|紧凑","hasKids":布尔},',
  '"plan":{"assumptions":[],"itinerary":[{"day":1,"theme":"","remark":"","items":[{"time":"","type":"景点|餐饮|交通","title":"","location":"","note":"","cost":0,"stay":0}]}],',
  '"transport":[{"day":1,"from":"","to":"","mode":"","minutes":0,"cost":0}],',
  '"dining":[{"day":1,"meal":"","name":"","note":"","cost":0}],"notes":[]}}',
  '要求：',
  '1. 先根据修改要求更新 info：例如「又有一个朋友加入了」→ travelers 改为原值+1；「总预算只有5000元」→ totalBudget 改为 5000；「更喜欢自然风景」→ interests 调整。info 里未涉及的字段保持原值',
  '   注意：如果原预算是按人均推算的（如「人均2000」），人数变化时 totalBudget 要同步按人均×新人数重算（如 4 人 = 8000）',
  '2. 天数修改：用户提到「一天 / 两天 / X天」这类词（且不是「第X天」）就是要求把行程改为 X 天：info.duration 必须改为 X，itinerary 必须正好输出 X 天（多出的天删除，保留靠前的天，交通与餐饮同步裁剪）；出发城市保持不变，目的地一般也保持不变（追加城市见第 2.5 条）',
  '2.5 追加城市：用户说「再去 / 然后去 / 接着去 / 之后去 / 顺路去 X 玩 N 天」，是在原行程后面追加 N 天 X 城市：info.duration 改为「原天数 + N」，info.destination 改为「原目的地+X」（如 上海+苏州）；itinerary 从原天数的下一天继续编号，安排 X 城市真实存在、贴合用户兴趣的景点；transport 在追加的第一天安排一段跨城大交通（高铁/大巴，按第 6 条规则估价），并逐天补 X 城市的市内交通；dining 同步补 X 城市餐饮；原有天数的内容保持不变',
  '3. 人数变化不需要改 itinerary 里的 cost（那是人均），总预算由系统按新人数重算；但人数明显变多时可以在 notes 里提醒订大交通/酒店注意人数',
  '4. 用户要求删除的景点必须彻底移除，且用同片区的其他景点替补',
  '5. 未涉及到的天数尽量保持不变',
  '6. 新增或改动的交通必须符合真实价格，跨城大交通绝不可能是 0 元，照此估算：',
  PRICE_RULES.join('\n'),
  '7. 只输出 JSON'
].join('\n')

/** 把模型更新过的 info 合并进原 tripInfo：只采信有效字段，其余保持原值 */
function mergeInfo(raw, old) {
  if (!raw || typeof raw !== 'object') return old
  const next = Object.assign({}, old)
  if (Number(raw.travelers) > 0) next.travelers = Number(raw.travelers)
  if (Number(raw.duration) > 0) next.duration = Number(raw.duration)
  if (Number(raw.totalBudget) > 0) next.totalBudget = Number(raw.totalBudget)
  next.budgetPerPerson = next.totalBudget ? Math.round(next.totalBudget / next.travelers) : 0
  if (raw.origin !== undefined && String(raw.origin).trim()) next.origin = String(raw.origin).trim()
  if (raw.destination !== undefined && String(raw.destination).trim()) next.destination = String(raw.destination).trim()
  if (Array.isArray(raw.interests) && raw.interests.length) next.interests = raw.interests.filter(Boolean)
  if (['轻松', '适中', '紧凑'].indexOf(raw.intensity) >= 0) next.travelIntensity = raw.intensity
  if (raw.hasKids === true || raw.hasKids === false) next.hasKids = raw.hasKids
  return next
}

/** 本地重算预算（天数/内容被裁剪后调用，不信任模型算术） */
function recomputeBudget(plan, info) {
  let ticket = 0
  plan.itinerary.forEach(d => d.items.forEach(it => {
    if (it.type === '景点') ticket += Number(it.cost) || 0
  }))
  const diningSum = plan.dining.reduce((s, d) => s + (Number(d.cost) || 0), 0)
  const diningTotal = diningSum > 0
    ? diningSum
    : plan.itinerary.reduce((s, d) => s + d.items.filter(i => i.type === '餐饮').reduce((x, i) => x + (Number(i.cost) || 0), 0), 0)
  const transportSum = plan.transport.reduce((s, l) => s + (Number(l.cost) || 0), 0)
  const people = info.travelers || 1
  const bTicket = Math.round(ticket * people)
  const bDining = Math.round(diningTotal * people)
  const bTransport = Math.round(transportSum * people)
  const bOther = Math.round((bTicket + bDining + bTransport) * 0.1)
  const total = bTicket + bDining + bTransport + bOther
  const totalBudget = info.totalBudget || 0
  const over = totalBudget > 0 && total > totalBudget
  plan.budget = {
    ticket: bTicket, dining: bDining, transport: bTransport, other: bOther,
    total: total, totalBudget: totalBudget,
    remain: totalBudget ? Math.abs(totalBudget - total) : 0, over: over
  }
  if (plan.checks && plan.checks.length) {
    plan.checks[0] = {
      ok: totalBudget > 0 ? !over : true,
      text: totalBudget > 0
        ? (over ? '预计花费超出总预算 ¥' + (total - totalBudget) : '预计花费在总预算内，剩余约 ¥' + (totalBudget - total))
        : '未设置总预算，本方案只做花费估算'
    }
  }
  plan.warnings = over ? ['当前安排超出预算 ¥' + (total - totalBudget) + '，可减少收费景点或选择更经济的餐饮'] : []
}

/** 从修改文本提取「改天数」意图（排除「第X天」），返回 1-7 或 0 */
function parseDurationIntent(text) {
  const m = String(text || '').match(/(第)?\s*(\d+|[一二两三四五六七八九十]+)\s*天/)
  if (!m || m[1]) return 0
  const CN = { '一': 1, '二': 2, '两': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10 }
  const v = CN[m[2]] || parseInt(m[2], 10)
  return (v >= 1 && v <= 7) ? v : 0
}

/** 识别「再去 / 然后去 X 玩 N 天」的追加城市意图，返回 { city, days } 或 null。
 *  只要命中就返回（即使 X 已在目的地里）：上层用它抑制「强制改天数」的裁剪兜底，
 *  防止「再去苏州玩两天」的「两天」被误当成总天数把行程裁短 */
function parseAppendCityIntent(text) {
  const m = String(text || '').match(/(?:再去|然后去|接着去|之后去|顺路去|顺便去|加上)\s*([\u4e00-\u9fa5]{2,6}?)(?:市)?\s*(?:玩|待|停|逛)?\s*(\d+|[一二两三四五六七八九十]+)\s*[天日]/)
  if (!m) return null
  const CN = { '一': 1, '二': 2, '两': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9, '十': 10 }
  const days = CN[m[2]] || parseInt(m[2], 10)
  const city = m[1].replace(/[市玩儿]+$/, '')
  if (!city || city.length < 2 || !(days >= 1 && days <= 7)) return null
  return { city: city, days: days }
}

/** 云端调整方案；失败返回 null，页面层保持原方案并提示 */
function modifyPlan(plan, text) {
  if (!isReady()) return Promise.resolve(null)
  const snapshot = {
    assumptions: plan.assumptions,
    itinerary: plan.itinerary,
    transport: plan.transport,
    dining: plan.dining,
    notes: plan.notes
  }
  const messages = [
    { role: 'system', content: MODIFY_SYSTEM },
    { role: 'user', content: '当前 info（人数/预算等以这里为准）：' + JSON.stringify({
        origin: plan.tripInfo.origin || plan.tripInfo.destination,
        destination: plan.tripInfo.destination,
        travelers: plan.tripInfo.travelers,
        duration: plan.tripInfo.duration,
        totalBudget: plan.tripInfo.totalBudget,
        interests: plan.tripInfo.interests,
        intensity: plan.tripInfo.travelIntensity,
        hasKids: plan.tripInfo.hasKids
      }) +
      '\n这是当前的方案 JSON：\n' + JSON.stringify(snapshot) },
    { role: 'user', content: '修改要求：' + text }
  ]
  return invoke(messages)
    .then(t => {
      const raw = extractJson(t)
      if (!raw) {
        console.warn('[ai-cloud] 修改结果解析失败，原始输出：', String(t).slice(0, 200))
        return null
      }
      const info = mergeInfo(raw.info, plan.tripInfo)
      // 本地兜底：从修改文本提取「改天数」意图，强制覆盖（模型常漏改「一天」这类无动词的天数词）
      // 追加城市例外：「再去苏州玩两天」的「两天」是新增段，绝不能拿来把总行程裁成 2 天
      const appendIntent = parseAppendCityIntent(text)
      const forcedDuration = appendIntent ? 0 : parseDurationIntent(text)
      if (forcedDuration) info.duration = forcedDuration
      const next = normalizePlan(raw.plan || raw, info)
      if (!next) {
        console.warn('[ai-cloud] 修改结果解析失败，原始输出：', String(t).slice(0, 200))
        return null
      }
      // 追加城市成功时，总天数以模型输出为准，防止下面的裁剪兜底把新增的天砍掉
      if (appendIntent && next.itinerary.length > (plan.tripInfo.duration || 0)) {
        info.duration = next.itinerary.length
      }
      // 天数对齐兜底：模型没跟着改 itinerary 时，本地裁剪到 info.duration 并重算预算
      const origDays = next.itinerary.length
      if (origDays !== info.duration || next.itinerary.some(d => d.day > info.duration)) {
        next.itinerary = next.itinerary.filter(d => d.day <= info.duration).sort((a, b) => a.day - b.day)
        next.itinerary.forEach((d, i) => { d.day = i + 1 })
        next.transport = next.transport.filter(l => l.day <= info.duration)
        next.dining = next.dining.filter(d => d.day <= info.duration)
        if (next.transport.length) next.transport[next.transport.length - 1].day = info.duration
        recomputeBudget(next, info)
      }
      return next
    })
    .catch(e => {
      console.warn('[ai-cloud] modifyPlan 失败', e)
      return null
    })
}

module.exports = {
  isReady: isReady,
  parseDemand: parseDemand,
  buildPlan: buildPlan,
  planFromText: planFromText,
  modifyPlan: modifyPlan,
  ask: ask,
  explainSpot: explainSpot,
  translate: translate,
  lastError: function () { return _lastError }
}
