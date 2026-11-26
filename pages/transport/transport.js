// pages/transport/transport.js
// 出行交通模块：交通记录的添加 / 查看 / 按行程筛选 / 花费统计
// 数据一律通过 utils/store 读写，结构一律用 utils/models 工厂函数创建
const store = require('../../utils/store');
const models = require('../../utils/models');

const MODE_OPTIONS = ['飞机', '高铁', '火车', '大巴', '轮船', '租车', '其他'];
const MODE_ICONS = {
  '飞机': '✈️',
  '高铁': '🚄',
  '火车': '🚆',
  '大巴': '🚌',
  '轮船': '🚢',
  '租车': '🚗',
  '其他': '🧭'
};

Page({
  data: {
    // 列表与统计
    transportList: [],
    totalCount: 0,
    totalPrice: '0.00',
    // 行程筛选（0 = 全部行程）
    filterIndex: 0,
    filterNames: ['全部行程'],
    tripOptions: [],
    // 表单
    showForm: false,
    modeOptions: MODE_OPTIONS,
    modeIndex: 0,
    tripNames: [],
    tripIndex: 0,
    // 自绘选择抽屉（替代原生 picker，字号可控）
    sheetShow: false,
    sheetType: '',
    sheetTitle: '',
    sheetOptions: [],
    sheetIndex: -1,
    form: {
      from: '',
      to: '',
      departDate: '',
      departTime: '',
      arriveDate: '',
      arriveTime: '',
      price: '',
      bookingNo: ''
    }
  },

  onShow() {
    this.refreshData();
  },

  // 每次显示时重新拉取行程与交通数据，保证跨模块数据同步
  refreshData() {
    const tripOptions = store.getTrips().map(trip => ({ id: trip.id, name: trip.name }));
    const filterNames = ['全部行程'].concat(tripOptions.map(trip => trip.name));
    const filterIndex = Math.min(this.data.filterIndex, filterNames.length - 1);
    const tripNames = tripOptions.map(trip => trip.name);
    const tripIndex = Math.min(this.data.tripIndex, Math.max(0, tripNames.length - 1));
    this.setData({ tripOptions, filterNames, filterIndex, tripNames, tripIndex });
    this.refreshList();
  },

  // 读取交通记录：store.getTransports() 不传 tripId 返回全部
  refreshList() {
    const { filterIndex, tripOptions } = this.data;
    const all = store.getTransports();
    const filteredTripId = filterIndex > 0 && tripOptions[filterIndex - 1]
      ? tripOptions[filterIndex - 1].id
      : '';
    const sourceList = filteredTripId
      ? all.filter(item => item.tripId === filteredTripId)
      : all;

    const transportList = sourceList
      .slice()
      .sort((a, b) => ((a.depart || '') > (b.depart || '') ? 1 : -1))
      .map(item => ({
        ...item,
        modeIcon: MODE_ICONS[item.mode] || '🧭',
        departText: item.depart || '时间待定',
        arriveText: item.arrive || '时间待定',
        priceText: Number(item.price) > 0 ? Number(item.price).toFixed(2) : ''
      }));

    const total = sourceList.reduce((sum, item) => sum + (Number(item.price) || 0), 0);
    this.setData({
      transportList,
      totalCount: sourceList.length,
      totalPrice: total.toFixed(2)
    });
  },

  // ---------- 自绘选择抽屉 ----------
  openSheet(e) {
    const type = e.currentTarget.dataset.type;
    let title = '', options = [], index = -1;
    if (type === 'mode') {
      title = '选择交通方式';
      options = MODE_OPTIONS.map(m => MODE_ICONS[m] + ' ' + m);
      index = this.data.modeIndex;
    } else if (type === 'trip') {
      if (this.data.tripNames.length === 0) {
        return wx.showToast({ title: '请先在首页创建行程', icon: 'none' });
      }
      title = '选择所属行程';
      options = this.data.tripNames;
      index = this.data.tripIndex;
    } else {
      title = '筛选行程';
      options = this.data.filterNames;
      index = this.data.filterIndex;
    }
    this.setData({ sheetShow: true, sheetType: type, sheetTitle: title, sheetOptions: options, sheetIndex: index });
  },

  closeSheet() {
    this.setData({ sheetShow: false });
  },

  onSheetPick(e) {
    const idx = Number(e.currentTarget.dataset.index);
    const type = this.data.sheetType;
    if (type === 'mode') {
      this.setData({ modeIndex: idx });
    } else if (type === 'trip') {
      this.setData({ tripIndex: idx });
    } else {
      this.setData({ filterIndex: idx }, () => this.refreshList());
    }
    this.closeSheet();
  },

  // 打开表单前先确保行程数据最新
  onAddTap() {
    const tripNames = store.getTrips().map(trip => trip.name);
    this.setData({
      showForm: true,
      tripNames,
      tripIndex: Math.min(this.data.tripIndex, Math.max(0, tripNames.length - 1)),
      form: { from: '', to: '', departDate: '', departTime: '', arriveDate: '', arriveTime: '', price: '', bookingNo: '' }
    });
  },

  onCloseForm() {
    this.setData({ showForm: false });
  },

  // 阻止表单面板点击冒泡到遮罩
  noop() {},

  onFormInput(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({ ['form.' + field]: e.detail.value });
  },

  onPickDate(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({ ['form.' + field]: e.detail.value });
  },

  onPickTime(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({ ['form.' + field]: e.detail.value });
  },

  // 提交：makeTransport 创建结构，addTransport(tripId, transport) 统一写入
  onSubmitForm() {
    const { form, modeIndex, tripIndex, tripNames } = this.data;
    if (tripNames.length === 0) {
      wx.showToast({ title: '请先在首页创建行程', icon: 'none' });
      return;
    }
    if (!form.from.trim() || !form.to.trim()) {
      wx.showToast({ title: '请填写出发地和目的地', icon: 'none' });
      return;
    }
    if (!form.departDate) {
      wx.showToast({ title: '请选择出发日期', icon: 'none' });
      return;
    }

    const tripOptions = store.getTrips();
    const targetTrip = tripOptions[tripIndex];
    if (!targetTrip) {
      wx.showToast({ title: '请先在首页创建行程', icon: 'none' });
      return;
    }

    const tripId = targetTrip.id;
    const transport = models.makeTransport({
      mode: MODE_OPTIONS[modeIndex],
      from: form.from.trim(),
      to: form.to.trim(),
      depart: form.departDate + (form.departTime ? ' ' + form.departTime : ''),
      arrive: form.arriveDate + (form.arriveTime ? ' ' + form.arriveTime : ''),
      price: Number(form.price) || 0,
      bookingNo: form.bookingNo.trim()
    });
    store.addTransport(tripId, transport);

    wx.showToast({ title: '已添加', icon: 'success' });
    this.onCloseForm();
    this.refreshData();
  }
});
