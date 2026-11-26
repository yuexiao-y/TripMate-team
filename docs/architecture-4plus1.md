# TripMate 软件架构 "4+1" 视图

> 4 + 1 = 逻辑视图 + 进程视图 + 开发视图 + 物理视图，由 **场景视图** 统领。
> 所有视图围绕核心场景展开：*自然语言输入 → AI 生成行程方案 → 保存为行程 → 途中记账/交通/打卡/清单/吃喝记录 → 首页汇总统计*。

## 0. 场景视图（+1，Use Case View）

```mermaid
flowchart LR
    User((旅行<br/>用户))

    subgraph S1[① 行前规划]
        direction TB
        UC1[UC1 智能规划行程]
        UC7[UC7 出行清单]
    end

    subgraph S2[② 行程管理]
        direction TB
        UC2[UC2 管理行程]
        UC3[UC3 记录交通]
    end

    subgraph S3[③ 途中记录]
        direction TB
        UC4[UC4 预算记账分摊]
        UC5[UC5 吃喝记录]
        UC6[UC6 旅行打卡]
    end

    S4[④ UC8<br/>首页统计汇总]

    User --> S1
    S1 -- 保存为行程 --> S2
    S2 -- 提供行程上下文 --> S3
    S1 & S3 -. 数据聚合 .-> S4
```

**关键场景走查（驱动其余 4 个视图）**：

| 步骤 | 动作 | 涉及模块 |
|---|---|---|
| 1 | 用户在 AI 页输入"帮我规划上海 3 日游" | `pages/ai` → `utils/ai-cloud.js` |
| 2 | 云端混元大模型生成方案；失败/限流则回退本地规则引擎 | `utils/agent-engine.js`（兜底） |
| 3 | 用户可修改方案并保存为正式行程 | `pages/ai` → `pages/itinerary` |
| 4 | 途中记账、记交通、打卡、勾清单、记吃喝（均挂到行程） | 各 `pages/*` → `utils/store.js` |
| 5 | 首页展示行程数/总花费/打卡数/清单进度 | `pages/home` |

---

## 1. 逻辑视图（Logical View）— 功能模块分解

```mermaid
flowchart LR
    subgraph Facade[门面层]
        HOME[home<br/>门户·统计·导航]
    end

    subgraph Modules[功能模块层 pages/*]
        direction TB
        AI[ai 智能规划]
        ITI[itinerary 行程]
        TRA[transport 交通]
        EXP[expense 记账]
        DIN[dining 吃喝]
        CHK[checkin 打卡]
        LIS[checklist 清单]
    end

    subgraph AIService[AI 双引擎（互为兜底）]
        direction TB
        CLOUD[ai-cloud<br/>云端混元·3s 限流]
        LOCAL[agent-engine<br/>本地规则兜底]
        DATA[agent-data<br/>预置演示数据]
    end

    subgraph Domain[领域层]
        MODELS[models<br/>8 类实体定义]
    end

    subgraph Infra[基础设施层]
        direction TB
        STORE[store<br/>唯一持久化入口<br/>8 类 Storage]
        FMT[format<br/>日期·金额]
    end

    HOME --> Modules
    AI --> CLOUD
    AI --> LOCAL
    CLOUD -.失败回退.-> LOCAL
    LOCAL --> DATA
    Modules --> MODELS
    MODELS --> STORE
    Modules --> FMT
```

要点：
- **分层**：门面（home）→ 功能模块 → AI 双引擎 / 领域模型 → 持久化与工具。
- **AI 双通道**：云端混元（`wx.cloud.extend.AI`）为主，本地纯函数规则引擎兜底，保证离线/限流可用。
- **组件极薄**：`components/card`、`components/navigation-bar` 仅为占位，非核心构件。

---

## 2. 进程视图（Process View）— 运行时控制流

```mermaid
flowchart LR
    subgraph WP[微信小程序运行时（单进程·逻辑层 JS + 视图层 WXML）]
        direction TB
        subgraph Main[主逻辑流（事件驱动）]
            EV[页面事件回调] --> STORE_W[store 读写<br/>同步 Storage]
        end

        subgraph AsyncTasks[异步任务点]
            AICLOUD[AI 云端请求<br/>受限流阀门串行化<br/>间隔 ≥3s 防止 429]
            AGENT[本地规则引擎<br/>同步纯函数]
            FONT[字体加载<br/>onLaunch 异步]
        end
    end

    subgraph WXCloud[微信云开发]
        HUNYUAN[[混元大模型 API<br/>hunyuan-v3]]
    end

    AICLOUD -- HTTPS(微信托管) --> HUNYUAN
    EV --> AICLOUD & AGENT
    AICLOUD -- 失败/null --> AGENT
```

要点：
- **单进程、单包小程序**，无多线程/多进程；并发模型 = 事件循环 + 异步回调（Promise）。
- **并发控制点**：AI 云端请求用全局 3 秒间隔阀门串行化，避免触发力率限制。
- **降级路径**：云端返回 `null` 时同步回退本地规则引擎，用户无感。
- 数据读写为同步 `wx.setStorageSync`（统一收敛在 `store.js`），无异步数据竞争。

---

## 3. 开发视图（Development View）— 代码组织与团队分工

```mermaid
%%{init: {"themeVariables": {"fontSize": "18px"}}}%%
flowchart LR
    subgraph Repo[源码目录结构]
        direction LR
        APPJS[app.js / app.json<br/>全局入口·配置]

        subgraph Pages[pages/ —— 各负责人自治模块]
            direction TB
            P_HOME[home · ai]
            P_MID[itinerary · transport<br/>expense · dining]
            P_END[checkin · checklist]
        end

        subgraph Shared[utils/ —— 共享层（公共文件禁止改动）]
            direction TB
            U_CORE[store.js ★ 数据契约<br/>models.js ★ 实体定义]
            U_AGENT[agent-engine.js · agent-data.js<br/>本地规则引擎 + 演示数据]
            U_MISC[ai-cloud.js · format.js]
        end

        COMP[components/：card<br/>navigation-bar（薄组件）<br/>assets/：字体·图标]
    end

    APPJS --> Shared
    Pages -->|import| Shared
```

要点：
- **团队协作约定**（各页面 js 顶部注释 + `checklist/README.md`）：每人只改自己的 `pages/<模块>/`；公共文件（`store.js`、`models.js` 等）只读不改；禁止绕过 `store.js` 直调 `wx.setStorageSync`。
- **纯原生小程序**，无 npm 依赖、无构建工具链；页面 = 模块 = 分工单元。
- 遗留物（仅文档记录，图中已省略）：`pages/index` 空壳页、`mock.js` 停用开关，可在重构中移除；`ai.js` 中存在指向不存在 map 页的死链接。

---

## 4. 物理视图（Physical View）— 部署拓扑

```mermaid
flowchart LR
    subgraph Device[用户手机]
        WXAPP[微信客户端<br/>TripMate 小程序<br/>本地 Storage：trips/expenses/<br/>checklist/checkins/dinings/<br/>transports/aiPlans/members_*]
    end

    subgraph WeChatCloud[微信云开发环境 cloud1-d6gsl3l0c7b1685f2]
        AIGW[wx.cloud.extend.AI<br/>大模型接入网关]
    end

    subgraph Tencent[腾讯云]
        HUNYUAN[[混元大模型<br/>hunyuan-v3 / hy3]]
    end

    WXAPP -- "wx.cloud.extend.AI.generate<br/>(鉴权由微信托管)" --> AIGW --> HUNYUAN
    WXAPP -- "wx.chooseLocation" --> WXSVC[[微信位置服务]]
```

要点：
- **无自建服务器、无云函数、无云数据库** —— 所有业务数据仅存于设备本地 Storage，换机/卸载即丢失（当前最重要的架构限制）。
- 云端仅承担一件事：混元大模型生成行程方案。
- 隐私权限：仅声明 `chooseLocation`（打卡选点）。

---

## 附：视图间追溯

| 场景（+1） | 逻辑 | 进程 | 开发 | 物理 |
|---|---|---|---|---|
| AI 规划行程 | `pages/ai` + 双引擎 | 云端请求限流 + 本地兜底 | `ai-cloud.js`/`agent-engine.js`（公共层） | 云开发 AI 网关 ↔ 混元 |
| 记账/打卡/清单 | 各功能模块 + `models.js` | 同步 Storage 读写 | 各负责人 `pages/*` 自治 | 纯本地存储 |
| 首页汇总 | `pages/home` 聚合 | 页面 onShow 时读取 | 仅读 `store.js` 契约 | 本地 Storage |
