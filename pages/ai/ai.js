const store = require('../../utils/store')
const models = require('../../utils/models')
const engine = require('../../utils/agent-engine')
const cloud = require('../../utils/ai-cloud')
const tts = require('../../utils/tts')
const { formatDate } = require('../../utils/format')

const EXAMPLES = [
  '从武汉出发，我和两个朋友去上海玩三天，人均预算2000元，喜欢历史文化和美食',
  '从长沙出发，北京周末游，两人总预算3000元，喜欢历史文化',
  '从南京出发，杭州两日游，喜欢自然风光和美食',
  '从成都出发，带小孩去上海玩两天，总预算6000元'
]

const MODIFY_STEPS = [
  '正在识别修改需求…',
  '正在定位受影响的部分…',
  '正在重新规划受影响行程…',
  '正在重新计算预算并复查…'
]

const CLOUD_STEPS = [
  '正在生成行程方案…',
  '正在解析目的地、人数、天数与预算…',
  '正在分析兴趣偏好与行程强度…',
  '正在检索目的地景点与特色美食…',
  '正在按就近片区编排每日行程…',
  '正在衔接市内交通…',
  '正在估算预算并做合理性检查…',
  '正在生成出行清单…'
]

const MODIFY_STEPS_CLOUD = [
  '正在理解你的修改要求…',
  '正在重排方案…',
  '正在重新计算预算并复查…'
]

// 底部快捷修改建议（点一下填进输入框，也可以自己输入）
const QUICK_MODIFIES = [
  '第二天不要去博物馆',
  '我们更想吃当地特色美食',
  '总预算只有5000元',
  '又有一个朋友加入了',
  '我们更喜欢自然风景',
  '每天少安排一点',
  '第三天晚上7点前结束'
]

function addDays(dateStr, n) {
  const d = new Date(dateStr)
  d.setDate(d.getDate() + n)
  return formatDate(d)
}

function uid() {
  return 'day_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
}

/** 判断一句话是「追问」还是「修改指令」 */
function isQuestion(text) {
  const t = (text || '').trim()
  if (!t) return false
  if (/[？?]$/.test(t)) return true
  return /(吗|呢|怎么|如何|为什么|要不要|可以吗|是不是|需要预约|适合|会不会|多久|远不远|值得)/.test(t)
}

/** 保留旧方案中清单的勾选状态 */
function mergeChecklist(oldPlan, next) {
  const done = {}
  ;(oldPlan.checklist || []).forEach(c => { if (c.checked) done[c.content] = true })
  next.checklist = (next.checklist || []).map(c => ({
    id: c.id,
    content: c.content,
    group: c.group,
    checked: !!done[c.content]
  }))
  return next
}

/* 把 plan 转成 WXML 直接可用的渲染模型 */
function buildPlanView(plan) {
  const info = plan.tripInfo
  const chips = []
  if (info.origin) chips.push({ k: '出发地', v: info.origin })
  chips.push(
    { k: '目的地', v: info.destination },
    { k: '人数', v: info.travelers + ' 人' },
    { k: '天数', v: info.duration + ' 天' },
    { k: '预算', v: info.totalBudget ? '¥' + info.totalBudget : '未设置' },
    { k: '兴趣', v: info.interests.join('、') },
    { k: '强度', v: info.travelIntensity }
  )

  const dayCards = plan.itinerary.map(d => ({
    day: d.day,
    theme: d.theme,
    remark: d.remark,
    items: d.items.map((it, i) => ({
      key: d.day + '_' + i + '_' + it.title,
      time: it.time,
      type: it.type,
      typeClass: it.type === '餐饮' ? 'tl-food' : (it.type === '交通' ? 'tl-traffic' : 'tl-spot'),
      title: it.title,
      location: it.location,
      note: it.note,
      cost: it.cost,
      stay: it.stay
    }))
  }))

  const tDays = []
  plan.transport.forEach(l => {
    let g = tDays.find(x => x.day === l.day)
    if (!g) { g = { day: l.day, legs: [] }; tDays.push(g) }
    g.legs.push(l)
  })

  const dDays = []
  plan.dining.forEach(d => {
    let g = dDays.find(x => x.day === d.day)
    if (!g) { g = { day: d.day, items: [] }; dDays.push(g) }
    g.items.push(d)
  })

  const b = plan.budget || { ticket: 0, dining: 0, transport: 0, other: 0, total: 0, totalBudget: 0, remain: 0, over: false }
  const max = Math.max(b.ticket, b.dining, b.transport, b.other, 1)
  const pct = v => Math.max(Math.round(v / max * 100), 4)
  const budgetView = {
    rows: [
      { name: '门票', val: b.ticket, pct: pct(b.ticket) },
      { name: '餐饮', val: b.dining, pct: pct(b.dining) },
      { name: '交通', val: b.transport, pct: pct(b.transport) },
      { name: '其他', val: b.other, pct: pct(b.other) }
    ],
    total: b.total,
    totalBudget: b.totalBudget,
    remain: b.remain,
    over: b.over
  }

  const checkGroups = []
  plan.checklist.forEach(c => {
    let g = checkGroups.find(x => x.name === c.group)
    if (!g) { g = { name: c.group, items: [] }; checkGroups.push(g) }
    g.items.push(c)
  })

  const isCloud = plan.source === 'cloud-ai'   // 云端大模型方案才显示「智能管家」标注（课程版已开启云端）

  return {
    title: info.destination + ' ' + info.duration + ' 天行程方案',
    source: isCloud ? 'cloud' : 'local',
    sourceText: isCloud ? '智能管家为你规划 · AI 生成内容仅供参考' : '由本地规则引擎生成 · 基于预置示例数据',
    chips: chips,
    assumptions: plan.assumptions || [],
    dayCards: dayCards,
    tDays: tDays,
    dDays: dDays,
    budgetView: budgetView,
    checks: plan.checks || [],
    warnings: plan.warnings || [],
    notes: plan.notes || [],
    checkGroups: checkGroups,
    checkDone: plan.checklist.filter(c => c.checked).length,
    checkTotal: plan.checklist.length,
    tripId: plan.tripId || ''
  }
}

Page({
  data: {
    view: 'input', // input | analyzing | result
    inputText: '',
    modifyText: '',
    examples: EXAMPLES,
    quickModifies: QUICK_MODIFIES,
    steps: [],
    planView: null,
    chat: [],
    agentTip: '',
    waitHint: '',
    hasHistory: false,
    busy: false,
    mode: 'local',     // ai = 云端大模型 | local = 本地规则引擎
    cloudOn: false,    // 云开发 AI 是否可用
    modeHint: '',
    // 景点讲解弹层
    spotShow: false,
    spotTitle: '',
    spotText: '',
    spotLoading: false,
    // 语音朗读（微信同声传译插件）
    spotSpeaking: false,
    speakOn: false      // 插件是否可用
  },

  onLoad() {
    this.plan = null
    this.spotCache = {}   // 景点讲解缓存，避免同一个景点重复调用
    this.setData({
      hasHistory: !!store.getLatestAiPlan(),
      cloudOn: cloud.isReady(),   // 课程版：云端就绪即开启（大模型可规划任意城市、支持追加城市）
      speakOn: false,
      mode: cloud.isReady() ? 'ai' : 'local',
      modeHint: cloud.isReady()
        ? '云端大模型已就绪：任意城市可规划，还能追加城市连游'
        : '本地引擎：支持上海 / 北京 / 杭州，离线可跑'
    })
  },

  onUnload() {
    if (this._timer) clearTimeout(this._timer)
    tts.stop()
  },

  onHide() {
    tts.stop()
    if (this.data.spotSpeaking) this.setData({ spotSpeaking: false })
  },

  noop() {},

  /* ================= 模式切换 ================= */

  switchMode(e) {
    const m = e.currentTarget.dataset.mode
    if (m === 'ai' && !this.data.cloudOn) {
      return wx.showToast({ title: '云端未就绪，请检查云开发初始化', icon: 'none' })
    }
    this.setData({
      mode: m,
      modeHint: m === 'ai'
        ? '智能管家模式：为你规划，支持任意城市'
        : '本地模式：离线可跑，仅支持上海/北京/杭州'
    })
  },

  /* ================= 输入态 ================= */

  onInput(e) { this.setData({ inputText: e.detail.value }) },
  onModifyInput(e) { this.setData({ modifyText: e.detail.value }) },
  tapExample(e) { this.setData({ inputText: e.currentTarget.dataset.text }) },
  tapQuickModify(e) { this.setData({ modifyText: e.currentTarget.dataset.text }) },

  pushChat(role, text) {
    const chat = this.data.chat.concat({ role: role, text: text })
    this.setData({ chat: chat.length > 50 ? chat.slice(chat.length - 50) : chat })
  },

  startPlan() {
    if (this.data.busy) return
    const text = (this.data.inputText || '').trim()
    if (!text) {
      return wx.showToast({ title: '请先告诉我你的旅行目的地和基本需求', icon: 'none' })
    }

    // 云端模式：不限制城市，交给大模型
    if (this.data.mode === 'ai' && this.data.cloudOn) {
      this.setData({ agentTip: '' })
      this.pushChat('user', text)
      this.runCreateCloud(text)
      return
    }

    // 本地模式：沿用原有校验
    const rec = engine.recognize(text)
    if (rec.missing.length) {
      this.setData({
        agentTip: '还需要告诉我' + rec.missing.join('、') + (rec.missing.indexOf('目的地') >= 0 ? '，比如「去上海玩三天」' : '，比如「玩三天」')
      })
      return
    }
    if (!engine.isSupported(rec.info.destination)) {
      this.setData({
        agentTip: '演示版暂只预置了上海、北京、杭州三座城市的示例数据，还不能规划「' + rec.info.destination + '」，换个城市试试吧'
      })
      return
    }
    this.setData({ agentTip: '' })
    this.pushChat('user', text)
    this.runCreate(rec)
  },

  /* ---------- 云端生成 ---------- */

  runCreateCloud(text) {
    // 先发起云端请求，同时播放分析动画，动画结束后再取结果
    const task = this.doCloudCreate(text, len => {
      this.setData({ waitHint: '云端已输出 ' + len + ' 字，正在整理方案…' })
    })
    this.runSteps(CLOUD_STEPS, () => {
      this.setData({ waitHint: '云端正在规划，通常需要 5~15 秒，请稍候…' })
      task.then(res => {
        if (res.error === 'missing') {
          this.pushChat('agent', '还需要告诉我' + res.missing.join('、') + '才能开始规划哦')
          this.setData({ view: 'input', busy: false })
          return
        }
        if (res.error === 'unsupported') {
          this.pushChat('agent', '云端暂时不可用，而本地引擎只预置了上海、北京、杭州，还不能规划「' + res.city + '」。请检查网络后重试。')
          this.setData({ view: 'input', busy: false })
          return
        }
        const plan = res.plan
        this.plan = plan
        store.saveAiPlan(plan)
        const tip = res.fallback
          ? '（云端未就绪，已自动回退本地引擎）'
          : ''
        this.pushChat('agent', '已生成 ' + plan.tripInfo.destination + ' ' + plan.tripInfo.duration + ' 天行程方案' + tip +
          '，包含每日行程、交通衔接、美食推荐、预算分析和出行清单。你可以继续提出修改，也可以直接提问，比如「这个景点需要预约吗」。')
        this.setData({ view: 'result', planView: buildPlanView(plan), hasHistory: true, busy: false })
        wx.pageScrollTo({ scrollTop: 0 })
      }).catch(e => {
        console.warn('[ai] 云端生成异常', e)
        this.pushChat('agent', '生成失败：' + (e && e.message ? e.message : '未知错误') + '。可切换到「本地引擎」模式重试。')
        this.setData({ view: 'input', busy: false })
      })
    })
  },

  /** 云端创建方案；任何环节失败都回退本地引擎 */
  doCloudCreate(text, onProgress) {
    // 快路径：一次调用同时完成「需求解析 + 方案生成」，省掉一次云端往返
    return cloud.planFromText(text, onProgress).then(one => {
      if (one && one.plan) {
        const base = models.makeAiPlan({ tripInfo: one.info, assumptions: one.assumptions || [] })
        return { plan: Object.assign(base, one.plan) }
      }
      console.warn('[ai] 快路径未成功，改用两步流程')
      return this.doCloudCreateTwoStep(text)
    }).catch(e => {
      console.warn('[ai] 快路径异常，改用两步流程', e)
      return this.doCloudCreateTwoStep(text)
    })
  },

  /** 两步流程（快路径失败时的兜底）：先解析需求，再生成方案 */
  doCloudCreateTwoStep(text) {
    // 第一步：结构化需求（云端优先）
    return cloud.parseDemand(text).then(parsed => {
      let info = parsed && parsed.info ? parsed.info : null
      let assumptions = parsed ? (parsed.assumptions || []) : []
      let fallback = !info || !info.destination

      // 云端解析失败 → 退回本地正则
      if (!info || !info.destination) {
        const rec = engine.recognize(text)
        if (rec.missing.length) return { error: 'missing', missing: rec.missing }
        info = rec.info
        assumptions = rec.assumptions || []
      }

      // 第二步：生成方案（云端优先）
      return cloud.buildPlan(info).then(p => {
        if (p) {
          const base = models.makeAiPlan({ tripInfo: info, assumptions: assumptions })
          return { plan: Object.assign(base, p) }
        }
        // 云端生成失败 → 本地兜底（仅三城）
        if (!engine.isSupported(info.destination)) {
          return { error: 'unsupported', city: info.destination }
        }
        const lp = engine.createPlanFromInfo(info, assumptions)
        lp.source = 'local-engine'
        return { plan: lp, fallback: true }
      })
    }).catch(e => {
      console.warn('[ai] doCloudCreate 失败，回退本地', e)
      const rec = engine.recognize(text)
      if (rec.missing.length) return { error: 'missing', missing: rec.missing }
      if (!engine.isSupported(rec.info.destination)) {
        return { error: 'unsupported', city: rec.info.destination }
      }
      return { plan: engine.createPlanFromInfo(rec.info, rec.assumptions), fallback: true }
    })
  },

  /* ---------- 本地生成 ---------- */

  runCreate(rec) {
    const info = rec.info
    const labels = [
      '正在理解你的旅行需求…',
      '已识别目的地：' + info.destination,
      '已识别人数：' + info.travelers + ' 人',
      '已识别天数：' + info.duration + ' 天',
      info.totalBudget ? '已识别预算：总预算 ¥' + info.totalBudget : '未提供预算：本方案只做花费估算',
      '已识别兴趣：' + info.interests.join('、'),
      '已识别行程强度：' + info.travelIntensity,
      '正在按「就近分区」规划每日行程…',
      '正在衔接市内交通（示例数据）…',
      '正在匹配沿途餐饮…',
      '正在计算预算并做合理性检查…',
      '正在生成出行清单…'
    ]
    this.runSteps(labels, () => {
      const plan = engine.createPlanFromInfo(info, rec.assumptions)
      plan.source = 'local-engine'
      this.plan = plan
      store.saveAiPlan(plan)
      this.pushChat('agent', '已生成 ' + info.destination + ' ' + info.duration + ' 天行程方案，包含每日行程、交通衔接、美食推荐、预算分析和出行清单。你可以继续提出修改，比如「第二天不要去博物馆」。')
      this.setData({ view: 'result', planView: buildPlanView(plan), hasHistory: true, busy: false })
      wx.pageScrollTo({ scrollTop: 0 })
    })
  },

  loadHistory() {
    const plan = store.getLatestAiPlan()
    if (!plan || !plan.itinerary || !plan.itinerary.length) {
      return wx.showToast({ title: '没有可恢复的方案', icon: 'none' })
    }
    this.plan = plan
    this.pushChat('agent', '已恢复上次的规划方案，你可以继续查看或提出修改。')
    this.setData({ view: 'result', planView: buildPlanView(plan) })
    wx.pageScrollTo({ scrollTop: 0 })
  },

  /* ================= 分步动画 ================= */

  runSteps(labels, done) {
    const steps = labels.map(l => ({ label: l, state: 'pending' }))
    this.setData({ view: 'analyzing', steps, busy: true, waitHint: '' })
    let i = 0
    const tick = () => {
      if (i > 0) this.setData({ ['steps[' + (i - 1) + '].state']: 'done' })
      if (i >= steps.length) {
        this._timer = setTimeout(() => done(), 350)
        return
      }
      this.setData({ ['steps[' + i + '].state']: 'active' })
      i++
      this._timer = setTimeout(tick, 280)
    }
    tick()
  },

  /* ================= 结果态：修改 / 追问 ================= */

  sendModify() {
    if (this.data.busy || !this.plan) return
    const text = (this.data.modifyText || '').trim()
    if (!text) return

    // ① 开放式追问 → 走云端问答
    if (isQuestion(text)) {
      this.setData({ modifyText: '' })
      this.askQuestion(text)
      return
    }

    // ② 新的完整需求 → 重新规划（预置城市本地直出，更快更稳）
    if (engine.looksLikeNewDemand(text, this.plan)) {
      const rec = engine.recognize(text)
      if (rec.missing.length) {
        this.pushChat('user', text)
        this.pushChat('agent', '还需要告诉我' + rec.missing.join('、') + '才能重新规划哦')
        this.setData({ modifyText: '' })
        return
      }
      if (!engine.isSupported(rec.info.destination) && !(this.data.cloudOn && cloud.isReady())) {
        this.pushChat('user', text)
        this.pushChat('agent', '演示版暂只预置了上海、北京、杭州三座城市的示例数据，换个城市试试吧')
        this.setData({ modifyText: '' })
        return
      }
      this.pushChat('user', text)
      this.setData({ modifyText: '' })
      if (this.data.cloudOn && cloud.isReady() && !engine.isSupported(rec.info.destination)) {
        this.runCreateCloud(text)   // 云端就绪：非预置城市的新需求交给大模型
      } else {
        this.runCreate(rec)
      }
      return
    }

    this.pushChat('user', text)
    this.setData({ modifyText: '' })

    // ③ 云端就绪：优先大模型重排（支持「再去苏州玩两天」这类追加城市）
    if (this.data.cloudOn && cloud.isReady()) {
      this.modifyCloud(text)
      return
    }

    // ④ 本地规则引擎兜底
    this.applyLocalModify(text, false)
  },

  // 本地规则引擎修改（云端不可用或失败时的兜底）；silent=true 直接应用不播动画
  applyLocalModify(text, silent) {
    const result = engine.applyModify(this.plan, text)
    if (result && result.appendOnly) {
      this.pushChat('agent', result.summary)
      this.setData({ view: 'result', busy: false, waitHint: '' })
      return
    }
    if (!result) {
      this.pushChat('agent', '这条修改我没有听懂，可以试试这样说：「第二天不要去博物馆」「我们总预算只有5000元」「又有一个朋友加入了」「我们更喜欢自然风景」「每天少安排一点」「第三天晚上7点前结束」。')
      this.setData({ view: 'result', busy: false, waitHint: '' })
      return
    }
    const finish = () => {
      store.saveAiPlan(this.plan)
      this.pushChat('agent', result.summary + '。方案已更新，可继续提出修改。')
      this.setData({ view: 'result', planView: buildPlanView(this.plan), busy: false, waitHint: '' })
      wx.pageScrollTo({ scrollTop: 0 })
    }
    if (silent) finish()
    else this.runSteps(MODIFY_STEPS, finish)
  },

  /* ---------- 云端修改 ---------- */

  modifyCloud(text) {
    const task = cloud.modifyPlan(this.plan, text)
    this.runSteps(MODIFY_STEPS_CLOUD, () => {
      this.setData({ waitHint: '云端正在重排方案，通常需要 5~20 秒，请稍候…' })
      task.then(next => {
        if (!next) {
          // 追加城市只能靠云端重排，失败时明确提示重试；其余修改静默回退本地引擎
          const isAppend = /(再去|然后去|接着去|之后去|顺路去|顺便去|加上)[\u4e00-\u9fa5]{2,6}/.test(text) && /[天日]/.test(text)
          if (isAppend) {
            this.pushChat('agent', '「追加城市」需要云端重排整个方案，这次没能完成（连续请求太快可能会被限流）。歇几秒再发一次吧。')
            this.setData({ view: 'result', busy: false, waitHint: '' })
            return
          }
          this.applyLocalModify(text, true)
          return
        }
        const merged = mergeChecklist(this.plan, next)
        merged.id = this.plan.id
        merged.createdAt = this.plan.createdAt
        merged.tripId = this.plan.tripId
        merged.source = 'cloud-ai'
        this.plan = merged
        store.saveAiPlan(this.plan)
        this.pushChat('agent', '已按你的要求调整方案，预算与清单已重新核算。')
        this.setData({ view: 'result', planView: buildPlanView(this.plan), busy: false })
        wx.pageScrollTo({ scrollTop: 0 })
      }).catch(e => {
        console.warn('[ai] 云端修改异常', e)
        this.pushChat('agent', '修改失败：' + (e && e.message ? e.message : '未知错误') + '，方案保持原样。')
        this.setData({ view: 'result', busy: false })
      })
    })
  },

  /* ---------- 开放式追问（流式） ---------- */

  askQuestion(question) {
    if (!this.data.cloudOn) {
      this.pushChat('user', question)
      this.pushChat('agent', '暂时不支持提问，你可以直接告诉我修改要求，比如「第二天不要去博物馆」「总预算只有5000元」。')
      return
    }
    this.pushChat('user', question)
    this.pushChat('agent', '思考中…')
    const idx = this.data.chat.length - 1
    cloud.ask(this.plan, question, partial => {
      this.setData({ ['chat[' + idx + '].text']: partial })
    }).then(ans => {
      if (!ans) {
        this.setData({ ['chat[' + idx + '].text']: '云端暂时无法回答，请稍后再试。' })
        return
      }
      this.setData({ ['chat[' + idx + '].text']: ans })
    })
  },

  /* ================= AI 景点讲解 ================= */

  onTapSpot() {
    // 纯工具版暂无 AI 讲解，点击行程项不做处理
    return
  },

  closeSpot() {
    tts.stop()
    this.setData({ spotShow: false, spotSpeaking: false })
  },

  copySpot() {
    if (!this.data.spotText) return
    wx.setClipboardData({ data: this.data.spotText })
  },

  /** 朗读 / 停止朗读 讲解词 */
  onSpeakSpot() {
    if (this.data.spotSpeaking) {
      tts.stop()
      this.setData({ spotSpeaking: false })
      return
    }
    const text = this.data.spotText
    if (!text) return
    if (!tts.available()) {
      return wx.showToast({ title: '未接入同声传译插件，暂不支持朗读', icon: 'none' })
    }
    this.setData({ spotSpeaking: true })
    tts.speak(text, '中文', {
      onEnd: () => this.setData({ spotSpeaking: false }),
      onError: msg => {
        this.setData({ spotSpeaking: false })
        wx.showToast({ title: msg, icon: 'none' })
      }
    })
  },

  /* ================= 清单勾选（走 store 持久化） ================= */

  toggleCheck(e) {
    const id = e.currentTarget.dataset.id
    const item = this.plan.checklist.find(c => c.id === id)
    if (!item) return
    item.checked = !item.checked
    store.saveAiPlan(this.plan)
    this.setData({ planView: buildPlanView(this.plan) })
  },

  /* ================= 保存为正式行程（联动已有模块） ================= */

  saveToTrip() {
    const plan = this.plan
    if (!plan) return
    if (plan.tripId) {
      return wx.showToast({ title: '已保存过，可去行程页查看', icon: 'none' })
    }
    wx.showModal({
      title: '保存为正式行程',
      content: '将把每日行程写入「行程管理」、交通衔接写入「交通规划」、清单写入「出行清单」、美食推荐导入「吃喝探索」，确定保存吗？',
      success: res => {
        if (!res.confirm) return
        const info = plan.tripInfo
        const start = formatDate(new Date())
        const trip = models.makeTrip({
          name: info.destination + info.duration + '日游 · 智能规划',
          startDate: start,
          endDate: addDays(start, info.duration - 1),
          cover: ''
        })
        trip.days = []
        plan.itinerary.forEach(day => {
          const date = addDays(start, day.day - 1)
          day.items.forEach(it => {
            trip.days.push({
              ...models.makeDayItem({ time: it.time, type: it.type, title: it.title, location: it.location, note: it.note }),
              id: uid(),
              date: date
            })
          })
        })
        store.saveTrip(trip)
        plan.transport.forEach(l => {
          store.addTransport(trip.id, models.makeTransport({
            mode: l.mode, from: l.from, to: l.to,
            depart: '', arrive: '约' + l.minutes + '分钟', price: l.cost, bookingNo: ''
          }))
        })
        plan.checklist.forEach(c => {
          store.addCheckItem({ ...models.makeCheckItem({ content: c.content, group: c.group }), checked: c.checked })
        })
        // 美食推荐导入吃喝探索：按店名去重（本方案内 + 与已有清单间），类型按餐次粗映射
        const diningNames = store.getDiningList().map(d => d.name)
        plan.dining.forEach(d => {
          if (!d.name || diningNames.indexOf(d.name) >= 0) return
          store.addDiningItem(models.createDiningItem({
            name: d.name,
            address: d.area || '',
            type: d.meal === '早餐' ? '小吃' : (d.meal === '午餐' || d.meal === '晚餐' ? '正餐' : '其他'),
            visited: false
          }))
          diningNames.push(d.name)
        })
        plan.tripId = trip.id
        store.saveAiPlan(plan)
        this.setData({ 'planView.tripId': trip.id })
        wx.showToast({ title: '已保存', icon: 'success' })
      }
    })
  },

  goItinerary() {
    wx.navigateTo({ url: '/pages/itinerary/itinerary' })
  },

  /** 查看路线地图（把当前方案传给地图页） */
  goMap() {
    if (!this.plan) return
    wx.navigateTo({ url: '/pages/map/map?planId=' + (this.plan.id || '') })
  },

  restart() {
    wx.showModal({
      title: '重新开始',
      content: '将清空当前输入并回到开始页（已生成的方案仍保留在历史中）',
      success: res => {
        if (!res.confirm) return
        this.plan = null
        this.setData({ view: 'input', inputText: '', modifyText: '', planView: null, chat: [], agentTip: '' })
        wx.pageScrollTo({ scrollTop: 0 })
      }
    })
  }
})
