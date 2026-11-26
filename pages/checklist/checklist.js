// pages/home/checklist/checklist.js
// TripMate · 清单工具模块（出行清单）
//
// 数据约定（项目级规定）：
//   1. 本页面不直接调用 wx.setStorageSync / wx.getStorageSync，
//      所有持久化读写一律走 utils/store.js；
//   2. 清单条目实体由 utils/models.js 的工厂函数 createChecklistItem 创建。
//
// 本模块依赖的公共接口（与集成者对齐，若签名不同只需调整本文件顶部适配层）：
//   store.get(key, defaultValue) -> any
//   store.set(key, value)        -> void
//   models.createChecklistItem({ id, name, done }) -> { id, name, done }

const store = require('../../utils/store');
const models = require('../../utils/models');

// 本模块在 store 中的存储键（加 tripmate_ 前缀避免与其他模块冲突）
const STORE_KEY = 'tripmate_checklist';

// 内置出行清单模板：首次进入自动生成，之后可自由增删
const DEFAULT_TEMPLATE = [
  {
    id: 'docs',
    title: '证件文件',
    items: ['身份证', '护照/签证（出入境用）', '机票/车票行程单', '酒店预订单', '证件照 2 张', '学生证/优惠证件']
  },
  {
    id: 'clothes',
    title: '衣物鞋帽',
    items: ['换洗衣物', '外套/防晒衣', '舒适的鞋', '睡衣', '帽子', '雨伞/雨衣']
  },
  {
    id: 'wash',
    title: '洗漱护肤',
    items: ['牙刷牙膏', '洗发水/沐浴露（分装）', '护肤品小样', '防晒霜', '毛巾', '纸巾/湿巾']
  },
  {
    id: 'elec',
    title: '电子设备',
    items: ['手机充电器', '充电宝', '耳机', '插线板', '转换插头（出境用）', '相机']
  },
  {
    id: 'med',
    title: '药品应急',
    items: ['感冒药', '肠胃药', '创可贴', '晕车药', '口罩', '个人常用药']
  },
  {
    id: 'other',
    title: '其他',
    items: ['水杯', '购物袋', '笔和小本子', '少量现金']
  }
];

// 生成短 id（页面内唯一即可）
function uid() {
  return 'i' + Date.now().toString(36) + Math.floor(Math.random() * 46656).toString(36);
}

Page({
  data: {
    groups: [],        // [{ id, title, collapsed, doneCount, items: [{ id, name, done }] }]
    total: 0,          // 条目总数
    doneCount: 0,      // 已备条目数
    percent: 0,        // 打包进度百分比
    hasData: false,    // 是否存在条目（控制空状态）
    inputVal: '',      // 底部输入框内容
    inputGroupIdx: 0,  // 新增条目归属分组下标
    groupNames: []     // 分组名列表（供 picker 使用）
  },

  onLoad() {
    this.load();
  },

  onShow() {
    // 首页等入口可能修改过存储，回到页面时以存储为准刷新
    this.load();
  },

  // ---------- 数据读写 ----------

  // 读取数据；首次使用时用内置模板初始化并落库
  load() {
    this.migrateAiChecklist();
    let data = store.get(STORE_KEY, null);
    if (!data || !Array.isArray(data.groups)) {
      data = this.buildFromTemplate();
      store.set(STORE_KEY, data);
    }
    this.apply(data);
  },

  // 适配层（集成者）：智能规划「保存为正式行程」会把清单项写入 store 的 checklist 键
  // （makeCheckItem 数组：{ id, content, group, checked }），这里把它们一次性迁移为
  // 本模块的「AI 方案清单」分组，迁移后清空原键，避免重复导入
  migrateAiChecklist() {
    const aiItems = store.getChecklist();
    if (!aiItems || !aiItems.length) return;
    const data = store.get(STORE_KEY, null) || { updatedAt: 0, groups: [] };
    const groups = Array.isArray(data.groups) ? data.groups.filter(g => g.id !== 'ai-plan') : [];
    groups.unshift({
      id: 'ai-plan',
      title: 'AI 方案清单',
      collapsed: false,
      items: aiItems.map(function (it) {
        return models.createChecklistItem({ id: it.id, name: it.content, done: !!it.checked });
      })
    });
    store.set(STORE_KEY, { updatedAt: Date.now(), groups: groups });
    store.set('checklist', []);
  },

  buildFromTemplate() {
    return {
      updatedAt: Date.now(),
      groups: DEFAULT_TEMPLATE.map(function (g) {
        return {
          id: g.id,
          title: g.title,
          collapsed: false,
          items: g.items.map(function (name) {
            return models.createChecklistItem({ id: uid(), name: name, done: false });
          })
        };
      })
    };
  },

  // 把存储数据铺到视图模型上，并统计进度
  apply(data) {
    const groups = data.groups.map(function (g) {
      const items = Array.isArray(g.items) ? g.items : [];
      let done = 0;
      items.forEach(function (it) { if (it.done) done += 1; });
      return {
        id: g.id,
        title: g.title,
        collapsed: !!g.collapsed,
        doneCount: done,
        items: items
      };
    });
    let total = 0;
    let doneCount = 0;
    groups.forEach(function (g) {
      total += g.items.length;
      doneCount += g.doneCount;
    });
    this.setData({
      groups: groups,
      total: total,
      doneCount: doneCount,
      percent: total ? Math.round((doneCount * 100) / total) : 0,
      groupNames: groups.map(function (g) { return g.title; }),
      inputGroupIdx: Math.min(this.data.inputGroupIdx, Math.max(groups.length - 1, 0)),
      hasData: total > 0
    });
  },

  // 统一保存入口：只改统计相关的派生字段，避免整页 setData 抖动
  save() {
    store.set(STORE_KEY, {
      updatedAt: Date.now(),
      groups: this.data.groups
    });
  },

  // 更新进度统计（groups 变化后调用）
  refreshStats() {
    const groups = this.data.groups;
    let total = 0;
    let doneCount = 0;
    groups.forEach(function (g) {
      total += g.items.length;
      g.items.forEach(function (it) { if (it.done) doneCount += 1; });
    });
    this.setData({
      total: total,
      doneCount: doneCount,
      percent: total ? Math.round((doneCount * 100) / total) : 0,
      hasData: total > 0
    });
  },

  // ---------- 交互 ----------

  // 勾选 / 取消勾选（点击条目）
  onToggleItem(e) {
    const gid = e.currentTarget.dataset.gid;
    const iid = e.currentTarget.dataset.iid;
    const groups = this.data.groups.map(function (g) {
      if (g.id !== gid) return g;
      const items = g.items.map(function (it) {
        return it.id === iid ? { id: it.id, name: it.name, done: !it.done } : it;
      });
      let done = 0;
      items.forEach(function (it) { if (it.done) done += 1; });
      return { id: g.id, title: g.title, collapsed: g.collapsed, doneCount: done, items: items };
    });
    this.setData({ groups: groups });
    this.save();
    this.refreshStats();
  },

  // 折叠 / 展开分组
  onToggleGroup(e) {
    const gid = e.currentTarget.dataset.gid;
    const groups = this.data.groups.map(function (g) {
      return g.id === gid ? { id: g.id, title: g.title, collapsed: !g.collapsed, doneCount: g.doneCount, items: g.items } : g;
    });
    this.setData({ groups: groups });
    this.save();
  },

  // 长按删除条目
  onDeleteItem(e) {
    const gid = e.currentTarget.dataset.gid;
    const iid = e.currentTarget.dataset.iid;
    let targetName = '';
    this.data.groups.forEach(function (g) {
      if (g.id !== gid) return;
      g.items.forEach(function (it) { if (it.id === iid) targetName = it.name; });
    });
    const that = this;
    wx.showModal({
      title: '删除条目',
      content: '确定删除「' + targetName + '」吗？',
      confirmText: '删除',
      confirmColor: '#FA5151',
      success(res) {
        if (!res.confirm) return;
        const groups = that.data.groups.map(function (g) {
          if (g.id !== gid) return g;
          const items = g.items.filter(function (it) { return it.id !== iid; });
          let done = 0;
          items.forEach(function (it) { if (it.done) done += 1; });
          return { id: g.id, title: g.title, collapsed: g.collapsed, doneCount: done, items: items };
        });
        that.setData({ groups: groups });
        that.save();
        that.refreshStats();
        wx.showToast({ title: '已删除', icon: 'none' });
      }
    });
  },

  // 底部输入
  onInput(e) {
    this.setData({ inputVal: e.detail.value });
  },

  // 选择新增条目的归属分组
  onPickGroup(e) {
    this.setData({ inputGroupIdx: Number(e.detail.value) || 0 });
  },

  // 添加条目
  onAdd() {
    const name = (this.data.inputVal || '').trim();
    if (!name) {
      wx.showToast({ title: '先写点什么吧', icon: 'none' });
      return;
    }
    const idx = this.data.inputGroupIdx;
    const groups = this.data.groups.map(function (g, i) {
      if (i !== idx) return g;
      const items = g.items.concat([models.createChecklistItem({ id: uid(), name: name, done: false })]);
      return { id: g.id, title: g.title, collapsed: false, doneCount: g.doneCount, items: items };
    });
    this.setData({ groups: groups, inputVal: '' });
    this.save();
    this.refreshStats();
  },

  // 键盘"完成"也触发添加
  onAddConfirm() {
    this.onAdd();
  },

  // 清空所有已完成条目
  onClearDone() {
    if (this.data.doneCount === 0) {
      wx.showToast({ title: '还没有已备好的条目', icon: 'none' });
      return;
    }
    const that = this;
    wx.showModal({
      title: '清空已完成',
      content: '将删除全部 ' + this.data.doneCount + ' 项已备好的条目，确定吗？',
      confirmText: '清空',
      confirmColor: '#FA5151',
      success(res) {
        if (!res.confirm) return;
        const groups = that.data.groups.map(function (g) {
          const items = g.items.filter(function (it) { return !it.done; });
          return { id: g.id, title: g.title, collapsed: g.collapsed, doneCount: 0, items: items };
        });
        that.setData({ groups: groups });
        that.save();
        that.refreshStats();
        wx.showToast({ title: '已清空', icon: 'none' });
      }
    });
  },

  // 恢复默认模板（覆盖当前清单）
  onResetTemplate() {
    const that = this;
    wx.showModal({
      title: '恢复默认清单',
      content: '将用默认出行模板覆盖当前清单（含勾选状态），确定吗？',
      confirmText: '恢复',
      success(res) {
        if (!res.confirm) return;
        const data = that.buildFromTemplate();
        store.set(STORE_KEY, data);
        that.apply(data);
        wx.showToast({ title: '已恢复默认', icon: 'none' });
      }
    });
  }
});
