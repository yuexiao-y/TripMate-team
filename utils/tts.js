/**
 * 语音合成（TTS）封装 —— 基于微信官方「同声传译」插件 WechatSI
 *
 * 官方限制：
 *   - 单次合成文本最多 50 个字符（这里按 48 切分留余量）
 *   - 只支持 zh_CN（中文）与 en_US（英文）
 *   - 配额：100 次/分钟，2 万次/天（个人小程序免费）
 *   - 合成出的音频链接 3 小时内有效
 *
 * 因此长文本需要：按句切分 → 逐段合成 → 依次播放，形成连贯朗读。
 */

let plugin = null
try {
  plugin = requirePlugin('WechatSI')
} catch (e) {
  plugin = null // 插件未接入时降级为「只显示文字」
}

const MAX_CHARS = 48

let ctx = null          // 全局唯一的音频播放实例
let playing = false
let stopped = false     // 用户主动停止标记

/** 插件是否可用 */
function available() {
  return !!plugin
}

/** 语言名 → 插件语言码；不支持的语言返回 null */
function langCode(lang) {
  const s = String(lang || '')
  if (/中文|汉语|普通话|Chinese|zh/i.test(s)) return 'zh_CN'
  if (/英|英语|英文|English|en/i.test(s)) return 'en_US'
  return null
}

/** 按标点切成不超过 MAX_CHARS 的若干段，保持句子完整 */
function splitText(text) {
  const raw = String(text || '').replace(/\s+/g, ' ').trim()
  if (!raw) return []

  // 先按句末/句中标点切成小片（保留标点）
  const pieces = []
  let buf = ''
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i]
    buf += ch
    if ('。！？；!?;'.indexOf(ch) >= 0) {
      pieces.push(buf)
      buf = ''
    } else if ('，,、'.indexOf(ch) >= 0 && buf.length >= MAX_CHARS - 8) {
      pieces.push(buf)
      buf = ''
    }
  }
  if (buf) pieces.push(buf)

  // 过长的片再硬切
  const segs = []
  pieces.forEach(p => {
    if (p.length <= MAX_CHARS) {
      segs.push(p)
    } else {
      for (let i = 0; i < p.length; i += MAX_CHARS) segs.push(p.slice(i, i + MAX_CHARS))
    }
  })

  // 短片合并，减少请求次数
  const chunks = []
  let cur = ''
  segs.forEach(s => {
    if (!cur) {
      cur = s
    } else if (cur.length + s.length <= MAX_CHARS) {
      cur += s
    } else {
      chunks.push(cur)
      cur = s
    }
  })
  if (cur) chunks.push(cur)
  return chunks
}

/** 单段文本 → 音频地址 */
function synth(chunk, lang) {
  return new Promise((resolve, reject) => {
    if (!plugin) return reject(new Error('插件未接入'))
    plugin.textToSpeech({
      lang: lang,
      tts: true,
      content: chunk,
      success(res) {
        if (res && res.retcode === 0 && res.filename) {
          resolve(res.filename)
        } else {
          reject(new Error('合成失败(' + (res ? res.retcode : '未知') + ')'))
        }
      },
      fail(res) {
        const code = res && res.retcode
        let msg = '语音合成失败'
        if (code === -40001) msg = '语音合成已达频率限制，稍后再试'
        else if (code === -20005) msg = '网络异常，语音合成失败'
        else if (code) msg = '语音合成失败(' + code + ')'
        reject(new Error(msg))
      }
    })
  })
}

/** 播放一个音频地址，播完 resolve */
function play(src) {
  return new Promise((resolve, reject) => {
    if (!ctx) ctx = wx.createInnerAudioContext()
    ctx.stop()
    ctx.src = src
    ctx.onEnded(() => resolve())
    ctx.onError(e => reject(new Error((e && e.errMsg) || '播放失败')))
    ctx.play()
  })
}

/**
 * 朗读一段长文本
 * @param {string} text   要朗读的内容
 * @param {string} lang   语言名（中文 / 英语 …），会自动转成插件语言码
 * @param {object} hooks  { onStart, onProgress(i, total), onEnd, onError(msg) }
 */
function speak(text, lang, hooks) {
  hooks = hooks || {}
  const code = langCode(lang)
  if (!plugin) {
    if (hooks.onError) hooks.onError('未接入同声传译插件，暂不支持朗读')
    return Promise.resolve(false)
  }
  if (!code) {
    if (hooks.onError) hooks.onError('该语言暂不支持朗读（目前支持中文、英语）')
    return Promise.resolve(false)
  }

  const chunks = splitText(text)
  if (!chunks.length) return Promise.resolve(false)

  stop()
  stopped = false
  playing = true
  if (hooks.onStart) hooks.onStart()

  let idx = 0
  const next = () => {
    if (stopped) {
      playing = false
      if (hooks.onEnd) hooks.onEnd()
      return Promise.resolve(true)
    }
    if (idx >= chunks.length) {
      playing = false
      if (hooks.onEnd) hooks.onEnd()
      return Promise.resolve(true)
    }
    const i = idx
    if (hooks.onProgress) hooks.onProgress(i + 1, chunks.length)
    return synth(chunks[i], code)
      .then(src => {
        if (stopped) throw new Error('STOPPED')
        return play(src)
      })
      .then(() => {
        idx++
        return next()
      })
      .catch(e => {
        // 用户主动停止不算错误
        if (stopped || (e && e.message === 'STOPPED')) {
          playing = false
          if (hooks.onEnd) hooks.onEnd()
          return true
        }
        playing = false
        if (hooks.onError) hooks.onError((e && e.message) || '朗读失败')
        return false
      })
  }
  return next()
}

/** 停止朗读 */
function stop() {
  stopped = true
  playing = false
  if (ctx) {
    try { ctx.stop() } catch (e) { /* 忽略未初始化时的异常 */ }
  }
}

/** 是否正在朗读 */
function isPlaying() {
  return playing
}

module.exports = {
  available: available,
  langCode: langCode,
  splitText: splitText,
  speak: speak,
  stop: stop,
  isPlaying: isPlaying
}
