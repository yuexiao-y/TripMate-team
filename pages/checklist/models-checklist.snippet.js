// ============================================================
// 【参考片段 · 非交付公共文件】
// 这是给集成者参考的 utils/models.js 中"清单工具"部分的工厂函数。
// 如果骨架中的 models.js 已有同类函数，请以骨架为准，无需合并；
// 如果签名不同，请告知清单工具模块负责人调整 checklist.js 顶部适配层。
// ============================================================

/**
 * 创建一条清单条目
 * @param {Object} opts
 * @param {string} opts.id   条目唯一 id（页面生成）
 * @param {string} opts.name 条目名称
 * @param {boolean} [opts.done=false] 是否已备好
 * @returns {{ id: string, name: string, done: boolean }}
 */
function createChecklistItem(opts) {
  return {
    id: String(opts.id || ''),
    name: String(opts.name || ''),
    done: !!opts.done
  };
}

module.exports = {
  createChecklistItem
  // ...其他模块的工厂函数
};
