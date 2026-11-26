# TripMate · 清单工具模块（pages/home/checklist/）

按《TripMate 项目操作指南》开发的 6 个功能模块之一——**清单工具**（出行清单）。
不进 tabBar，作为首页二级入口页面，路径为 `pages/home/checklist/checklist`。

## 一、交付内容

```
pages/home/checklist/
├── checklist.js    页面逻辑（数据读写全部走 utils/store.js + utils/models.js）
├── checklist.json  页面配置（标题"清单工具"，不引用公共组件则留空 usingComponents）
├── checklist.wxml  页面结构
└── checklist.wxss  页面样式（自包含，未改公共样式）
```

> `reference-utils/` 下是两个**参考片段**（非交付公共文件），供集成者在骨架缺失对应接口时合并；若骨架已有同名/同职责接口，以骨架为准。

## 二、功能说明

- **内置出行模板**：首次进入自动生成 6 大分类（证件文件 / 衣物鞋帽 / 洗漱护肤 / 电子设备 / 药品应急 / 其他，共 34 项）
- **打包进度**：顶部进度条实时显示"已备 x / y 项"及百分比
- **勾选**：点击条目即勾选/取消，已完成项划线置灰
- **折叠**：点分组头折叠/展开
- **添加**：底部输入栏添加条目，可用选择器指定归属分组（键盘"完成"键也可提交）
- **删除**：长按条目，弹窗确认后删除
- **清空已完成 / 恢复默认**：右上工具栏，均有确认弹窗防误触
- 数据持久化在 `tripmate_checklist` 键下，退出重进不丢失

## 三、依赖的公共接口（需与集成者对齐）

页面顶部只依赖 3 个方法（`checklist.js` 顶部有注释，若签名不同只需改该文件顶部适配层）：

| 来源 | 方法 | 说明 |
|---|---|---|
| `utils/store.js` | `store.get(key, defaultValue)` | 读 |
| `utils/store.js` | `store.set(key, value)` | 写 |
| `utils/models.js` | `models.createChecklistItem({ id, name, done })` | 创建条目实体 |

页面内**没有**任何 `wx.setStorageSync` 调用，符合项目约定。

## 四、集成者需要做的事

1. **注册页面**（改 `app.json` 的 `pages` 数组）：
   ```json
   "pages/home/checklist/checklist"
   ```
2. **首页二级入口**（改 `pages/home/`，参考）：
   ```js
   wx.navigateTo({ url: '/pages/home/checklist/checklist' });
   ```
3. 确认 `utils/models.js` 含 `createChecklistItem`（参考 `reference-utils/models-checklist.snippet.js`），`utils/store.js` 含 `get/set`（参考 `reference-utils/store.snippet.js`）。

## 五、验收清单自查（对照指南第六部分）

| 项目 | 状态 |
|---|---|
| 只在自己 `pages/home/checklist/` 内改动，未碰公共文件 | ✅ |
| 数据全部经 `models.js`（工厂函数）+ `store.js`（读写） | ✅ |
| 未新增样式体系（自包含在本目录 wxss，无全局样式改动） | ✅ |
| `app.json` 注册 / 首页入口 | 由集成者完成（见上文第四节） |
| 开发者工具编译无报错 | 请在骨架合并后本地验证 |
