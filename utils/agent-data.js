// utils/agent-data.js —— AI 智能规划的预置演示数据
// ============================================================
// 重要说明：本项目（课程版）当前没有接入任何真实的地图 / POI / 餐饮 / 交通 API。
// 本文件中的所有景点、餐厅、交通信息均为「课堂演示用的预置示例数据」，
// Agent 生成方案时会明确标注这一点，不会把它描述成实时真实数据。
// 后续如果接入真实数据源，只需保持本文件的数据结构不变，替换数据即可。
// ============================================================

const CITIES = {
  '上海': {
    metroFare: 4, // 跨片区地铁示例票价（元/人/程）
    pois: [
      { name: '外滩', area: '外滩·南京路', tags: ['历史文化', '夜景', '城市观光'], cost: 0, stay: 90, note: '万国建筑博览群，建议傍晚前往看夜景' },
      { name: '南京路步行街', area: '外滩·南京路', tags: ['购物', '城市观光'], cost: 0, stay: 60, note: '中华商业第一街，可顺路走到外滩' },
      { name: '豫园·城隍庙', area: '豫园·城南', tags: ['历史文化', '美食'], cost: 40, stay: 120, note: '江南园林 + 城隍庙小吃，适合边逛边吃' },
      { name: '上海博物馆', area: '人民广场', tags: ['历史文化'], cost: 0, stay: 150, note: '免费但需提前在公众号预约' },
      { name: '上海城市规划展示馆', area: '人民广场', tags: ['历史文化', '城市观光'], cost: 30, stay: 90, note: '巨型城市沙盘很出片' },
      { name: '田子坊', area: '法租界·武康路', tags: ['文艺', '购物'], cost: 0, stay: 90, note: '石库门弄堂改造的文创街区' },
      { name: '武康路·安福路', area: '法租界·武康路', tags: ['历史文化', '文艺'], cost: 0, stay: 90, note: '经典 citywalk 路线，梧桐区老洋房' },
      { name: '上海中心大厦观光厅', area: '陆家嘴', tags: ['现代都市', '城市观光'], cost: 180, stay: 90, note: '中国第一高楼俯瞰浦江两岸' },
      { name: '东方明珠', area: '陆家嘴', tags: ['现代都市', '亲子'], cost: 199, stay: 120, note: '地标塔览 + 历史陈列馆' },
      { name: '上海科技馆', area: '世纪公园', tags: ['亲子'], cost: 60, stay: 150, note: '互动展项多，带孩子的首选' },
      { name: '世纪公园', area: '世纪公园', tags: ['自然'], cost: 0, stay: 90, note: '市区大型绿地，适合轻松散步' },
      { name: '朱家角古镇', area: '朱家角古镇', tags: ['历史文化', '自然'], cost: 60, stay: 180, note: '江南水乡古镇，位于郊区，往返约 3 小时' },
      { name: '静安寺', area: '静安寺', tags: ['历史文化'], cost: 0, stay: 45, note: '闹市中的千年古刹' },
      { name: '外滩源·苏州河畔', area: '外滩·南京路', tags: ['历史文化', '文艺'], cost: 0, stay: 60, note: '外滩北端的老建筑群，人少清净' }
    ],
    foods: [
      { name: '弄堂早餐「四大金刚」', area: '城市通用', meal: ['早餐'], cost: 15, tag: '特色', note: '大饼、油条、粢饭、豆浆' },
      { name: '大壶春生煎', area: '人民广场', meal: ['午餐', '晚餐'], cost: 30, tag: '特色', note: '老字号无汤生煎' },
      { name: '南翔小笼包（豫园店）', area: '豫园·城南', meal: ['午餐', '晚餐'], cost: 45, tag: '特色', note: '城隍庙排队名店' },
      { name: '绿波廊（城隍庙本帮菜）', area: '豫园·城南', meal: ['午餐', '晚餐'], cost: 90, tag: '特色', note: '老字号本帮菜，桂花拉糕必点' },
      { name: '云南南路美食街', area: '人民广场', meal: ['晚餐'], cost: 60, tag: '特色', note: '鲜得来排骨年糕、小绍兴白斩鸡' },
      { name: '小绍兴白斩鸡', area: '人民广场', meal: ['午餐'], cost: 50, tag: '特色' },
      { name: '老吉士酒家（本帮菜）', area: '法租界·武康路', meal: ['晚餐'], cost: 130, tag: '特色', premium: true, note: '红烧肉、葱油鸡，需排队' },
      { name: '兰心餐厅', area: '法租界·武康路', meal: ['午餐', '晚餐'], cost: 80, tag: '特色', note: '三张桌子的网红本帮小馆' },
      { name: '外滩景观餐厅', area: '外滩·南京路', meal: ['晚餐'], cost: 320, tag: '品质', premium: true, note: '夜景位需提前订' },
      { name: '沈大成糕团', area: '豫园·城南', meal: ['下午茶'], cost: 25, tag: '特色', note: '条头糕、青团，可当伴手礼' },
      { name: '国际饭店蝴蝶酥', area: '人民广场', meal: ['下午茶'], cost: 40, tag: '特色', note: '西点房常年排队' },
      { name: '陆家嘴商场简餐', area: '陆家嘴', meal: ['午餐', '晚餐'], cost: 70, tag: '常规' },
      { name: '联洋商圈餐厅', area: '世纪公园', meal: ['午餐', '晚餐'], cost: 75, tag: '常规' },
      { name: '静安寺商圈本帮面馆', area: '静安寺', meal: ['午餐', '晚餐'], cost: 45, tag: '常规' },
      { name: '朱家角阿婆粽·扎肉', area: '朱家角古镇', meal: ['午餐', '晚餐'], cost: 45, tag: '特色' },
      { name: '迪士尼园区餐饮', area: '迪士尼', meal: ['午餐', '晚餐'], cost: 120, tag: '常规' }
    ]
  },

  '北京': {
    metroFare: 4,
    pois: [
      { name: '天安门广场', area: '天安门·故宫', tags: ['历史文化', '城市观光'], cost: 0, stay: 90, note: '看升旗需赶早，记得带身份证过安检' },
      { name: '故宫博物院', area: '天安门·故宫', tags: ['历史文化'], cost: 60, stay: 240, note: '需提前 7 天在官方小程序预约' },
      { name: '景山公园', area: '天安门·故宫', tags: ['历史文化', '自然'], cost: 2, stay: 60, note: '万春亭俯瞰故宫全景' },
      { name: '南锣鼓巷', area: '什刹海·南锣鼓巷', tags: ['文艺', '美食'], cost: 0, stay: 90, note: '胡同肌理保存最完整的街区之一' },
      { name: '什刹海·恭王府', area: '什刹海·南锣鼓巷', tags: ['历史文化'], cost: 40, stay: 120, note: '和珅府邸 + 前海后海环湖' },
      { name: '天坛公园', area: '天坛·前门', tags: ['历史文化', '自然'], cost: 34, stay: 120, note: '祈年殿建议买联票' },
      { name: '前门大街', area: '天坛·前门', tags: ['历史文化', '购物'], cost: 0, stay: 75, note: '老字号云集，可乘铛铛车' },
      { name: '颐和园', area: '颐和园·圆明园', tags: ['历史文化', '自然'], cost: 30, stay: 180, note: '建议从北宫门进，走苏州街—佛香阁路线' },
      { name: '圆明园遗址公园', area: '颐和园·圆明园', tags: ['历史文化', '自然'], cost: 10, stay: 120, note: '西洋楼遗址在东北角' },
      { name: '798 艺术区', area: '798·酒仙桥', tags: ['艺术', '文艺'], cost: 0, stay: 150, note: '画廊 + 买手店，适合拍照' },
      { name: '王府井步行街', area: '王府井', tags: ['购物', '城市观光'], cost: 0, stay: 75, note: '老北京商业街' },
      { name: '慕田峪长城', area: '慕田峪长城', tags: ['历史文化'], cost: 105, stay: 300, fullDay: true, note: '郊区一日游，含往返约需一整天（示例数据）' }
    ],
    foods: [
      { name: '护国寺小吃早餐', area: '城市通用', meal: ['早餐'], cost: 20, tag: '特色', note: '豆汁、焦圈、豌豆黄' },
      { name: '四季民福烤鸭（故宫店）', area: '天安门·故宫', meal: ['午餐', '晚餐'], cost: 150, tag: '特色', premium: true, note: '靠窗位可看角楼' },
      { name: '老北京炸酱面', area: '什刹海·南锣鼓巷', meal: ['午餐', '晚餐'], cost: 35, tag: '特色' },
      { name: '东来顺涮羊肉', area: '王府井', meal: ['晚餐'], cost: 130, tag: '特色', premium: true },
      { name: '尹三豆汁焦圈', area: '天坛·前门', meal: ['早餐'], cost: 15, tag: '特色', note: '老北京口味，勇者挑战' },
      { name: '门框胡同卤煮', area: '天坛·前门', meal: ['午餐', '晚餐'], cost: 35, tag: '特色' },
      { name: '局气·京味菜', area: '什刹海·南锣鼓巷', meal: ['晚餐'], cost: 100, tag: '特色', premium: true },
      { name: '稻香村点心', area: '王府井', meal: ['下午茶'], cost: 50, tag: '特色', note: '京八件伴手礼' },
      { name: '颐和园附近家常菜', area: '颐和园·圆明园', meal: ['午餐', '晚餐'], cost: 60, tag: '常规' },
      { name: '798 园区咖啡简餐', area: '798·酒仙桥', meal: ['午餐', '下午茶'], cost: 70, tag: '常规' }
    ]
  },

  '杭州': {
    metroFare: 3,
    pois: [
      { name: '断桥残雪·白堤', area: '西湖·北山街', tags: ['自然', '历史文化'], cost: 0, stay: 120, note: '从断桥走白堤到孤山，经典环湖路线' },
      { name: '苏堤春晓·花港观鱼', area: '西湖·南山路', tags: ['自然'], cost: 0, stay: 120, note: '苏堤慢行 + 花港喂鱼' },
      { name: '雷峰塔', area: '西湖·南山路', tags: ['历史文化'], cost: 40, stay: 90, note: '登塔可看西湖全景' },
      { name: '南宋御街', area: '河坊街·吴山', tags: ['历史文化'], cost: 0, stay: 75, note: '南宋临安城的中轴线' },
      { name: '清河坊历史街区', area: '河坊街·吴山', tags: ['历史文化', '美食', '购物'], cost: 0, stay: 90, note: '胡庆余堂、方回春堂都在这里' },
      { name: '灵隐寺·飞来峰', area: '灵隐·飞来峰', tags: ['历史文化', '自然'], cost: 75, stay: 180, note: '需先买飞来峰门票再请香花券' },
      { name: '西溪国家湿地公园', area: '西溪湿地', tags: ['自然'], cost: 80, stay: 180, note: '摇橹船体验感更好' },
      { name: '京杭大运河·拱宸桥', area: '大运河·拱宸桥', tags: ['历史文化'], cost: 0, stay: 90, note: '桥西历史街区适合傍晚散步' },
      { name: '九溪十八涧', area: '九溪', tags: ['自然'], cost: 0, stay: 150, note: '溪流 + 茶田徒步路线' },
      { name: '中国茶叶博物馆', area: '西湖·南山路', tags: ['历史文化'], cost: 0, stay: 90, note: '免费，可品茶' },
      { name: '宋城景区（千古情演出）', area: '宋城', tags: ['演出', '亲子'], cost: 320, stay: 240, eveningOnly: true, note: '下午入园，晚上看《宋城千古情》' }
    ],
    foods: [
      { name: '游埠豆浆早餐', area: '城市通用', meal: ['早餐'], cost: 20, tag: '特色', note: '咸豆浆 + 现煎鸡蛋饼' },
      { name: '菊英面店片儿川', area: '河坊街·吴山', meal: ['午餐'], cost: 25, tag: '特色', note: '杭州人的心头好' },
      { name: '知味观小吃', area: '河坊街·吴山', meal: ['午餐', '下午茶'], cost: 45, tag: '特色', note: '猫耳朵、幸福双' },
      { name: '楼外楼（孤山店）', area: '西湖·北山街', meal: ['午餐', '晚餐'], cost: 160, tag: '特色', premium: true, note: '西湖醋鱼、东坡肉' },
      { name: '绿茶餐厅（西湖店）', area: '西湖·北山街', meal: ['午餐', '晚餐'], cost: 70, tag: '常规' },
      { name: '龙井问茶茶餐', area: '西湖·南山路', meal: ['午餐', '晚餐'], cost: 120, tag: '特色', premium: true, note: '龙井虾仁配明前茶' },
      { name: '葱包桧·定胜糕', area: '河坊街·吴山', meal: ['下午茶'], cost: 15, tag: '特色' },
      { name: '灵隐寺素面', area: '灵隐·飞来峰', meal: ['午餐'], cost: 30, tag: '特色', note: '十方苑素面' },
      { name: '外婆家（运河店）', area: '大运河·拱宸桥', meal: ['晚餐'], cost: 65, tag: '常规' },
      { name: '西溪湿地农家菜', area: '西溪湿地', meal: ['午餐', '晚餐'], cost: 70, tag: '常规' }
    ]
  }
}

// 兴趣名称 → POI 标签的映射（Agent 用它做兴趣匹配）
const INTEREST_TAGS = {
  '历史文化': ['历史文化'],
  '美食': ['美食'],
  '自然风光': ['自然'],
  '购物': ['购物'],
  '亲子': ['亲子'],
  '艺术文艺': ['艺术', '文艺'],
  '城市观光': ['城市观光', '现代都市', '夜景', '演出']
}

// 支持的目的地列表（超出此列表的城市暂无演示数据）
function supportedCities() {
  return Object.keys(CITIES)
}

module.exports = { CITIES, INTEREST_TAGS, supportedCities }
