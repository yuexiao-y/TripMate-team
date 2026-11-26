function formatDate(d) {
  const dt = d ? new Date(d) : new Date()
  const p = n => (n < 10 ? '0' + n : '' + n)
  return dt.getFullYear() + '-' + p(dt.getMonth() + 1) + '-' + p(dt.getDate())
}

function formatMoney(n) {
  return '¥' + (Number(n) || 0).toFixed(2)
}

module.exports = { formatDate, formatMoney }
