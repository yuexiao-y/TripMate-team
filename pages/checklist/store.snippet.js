// ============================================================
// 【参考片段 · 非交付公共文件】
// 这是给集成者参考的 utils/store.js 最小实现。
// 如果骨架中已有 store.js，请以骨架为准，无需合并；
// 本模块仅依赖两个方法：store.get(key, defaultValue) 和 store.set(key, value)。
// ============================================================

// 统一封装的本地存储读写：所有模块通过这里读写，禁止在页面里散写 wx.setStorageSync
const PREFIX = 'tripmate_';

function get(key, defaultValue) {
  try {
    const v = wx.getStorageSync(PREFIX + key);
    return v === '' || v === null || v === undefined ? defaultValue : v;
  } catch (e) {
    return defaultValue;
  }
}

function set(key, value) {
  try {
    wx.setStorageSync(PREFIX + key, value);
  } catch (e) {
    // 存储写入失败一般不影响页面运行，静默处理
  }
}

function remove(key) {
  try {
    wx.removeStorageSync(PREFIX + key);
  } catch (e) { }
}

module.exports = {
  get,
  set,
  remove
};
