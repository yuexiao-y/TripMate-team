const mock = require('./utils/mock')

// 云开发环境 ID（与上架版共用，混元大模型走这里）
const CLOUD_ENV = 'cloud1-d6gsl3l0c7b1685f2'

App({
  onLaunch() {
    mock.initMock()

    // 初始化云开发：失败不影响本地功能，AI 页面会自动回退到本地规则引擎
    if (typeof wx !== 'undefined' && wx.cloud) {
      try {
        wx.cloud.init({ env: CLOUD_ENV, traceUser: true })
        console.log('[app] 云开发已初始化，环境 ID =', CLOUD_ENV)
      } catch (e) {
        console.warn('[app] 云开发初始化失败，将使用本地引擎：', e)
      }
    } else {
      console.warn('[app] 当前环境没有 wx.cloud，只能使用本地引擎')
    }

    // 艺术字体（Baloo 2 Bold，OFL 开源圆润体）：首页自绘导航的标题用；global=true 全站可用。
    // 加载失败只是标题回退系统字体，不影响任何功能。
    try {
      wx.loadFontFace({
        global: true,
        family: 'TripArt',
        source: 'url("/assets/fonts/Baloo2-Bold.woff")',
        success: () => console.log('[app] 艺术字体加载成功'),
        fail: err => console.warn('[app] 艺术字体加载失败，标题回退系统字体：', err && err.errMsg)
      })
    } catch (e) { /* 老基础库没有该 API，忽略 */ }

    // 中文圆体（站酷庆科黄油体，OFL 免费商用）：按项目用字子集化（230KB），全站中文生效。
    // 与 TripArt 组合：英文走 Baloo 2，中文走黄油体，整 App 统一圆润观感。加载失败回退系统字体。
    try {
      wx.loadFontFace({
        global: true,
        family: 'TripCn',
        source: 'url("/assets/fonts/TripMate-font.woff")',
        success: () => console.log('[app] 中文圆体加载成功'),
        fail: err => console.warn('[app] 中文圆体加载失败，回退系统字体：', err && err.errMsg)
      })
    } catch (e) { /* 老基础库没有该 API，忽略 */ }
  }
})

