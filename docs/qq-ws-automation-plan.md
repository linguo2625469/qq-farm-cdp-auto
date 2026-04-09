# QQ 小程序 WebSocket 自动化改造计划

## 1. 背景

当前项目的主链路是：

- 外部网关 / 网页端
- CDP 执行上下文
- 注入 `button.js`
- 通过 `gameCtl.*` 控制农场

这条链路适用于微信小游戏调试环境，但不适用于 QQ 小程序当前场景。  
QQ 小程序侧已经确认可以直接修改本地资源文件，并且已经验证：

- 可在 `game.js` 中加载新增脚本
- 可在运行环境内访问 `gameCtl`
- 可从小程序主动连接本机 WebSocket 服务
- 可通过 WebSocket 收到外部命令并调用 `gameCtl` 后返回结果

结论：QQ 路线不应继续依赖 CDP 注入，应改为“小程序内常驻宿主 + 本机 WebSocket RPC”。

补充：使用wx.getSystemInfoSync() 返回{"brand":"windows","model":"windows","pixelRatio":2,"screenWidth":483,"screenHeight":857,"windowWidth":483,"windowHeight":857,"statusBarHeight":0,"language":"zh_CN","version":"1.0.0","system":"windows 10.0","platform":"windows","fontSizeSetting":16,"SDKVersion":"1.27.0.00000","AppPlatform":"qq","theme":"light","safeArea":{"left":0,"top":0,"right":483,"bottom":857,"width":483,"height":857},"MiniAppVersion":"3.3.7","devicePixelRatio":2,"benchmarkLevel":1,"SDKBuild":"99999"} 
利用AppPlatform可判断运行在wx还是qq

## 2. 当前验证结果

已完成的最小验证：

- 本机 WebSocket 测试服务：[qq-ws-test/server.cjs](/D:/nodejs_code/农场相关/农场使用cdp控制/qq-ws-test/server.cjs)
- 小程序侧测试宿主：[qq-ws-test/miniapp-client.js](/D:/nodejs_code/农场相关/农场使用cdp控制/qq-ws-test/miniapp-client.js)

已确认可行的能力：

- 小程序侧主动连接 `ws://127.0.0.1:18788/miniapp`
- 服务端收到 `hello`
- 服务端下发 `call`
- 小程序侧调用以下方法并回传结果：
  - `gameCtl.getFarmOwnership`
  - `gameCtl.getFarmStatus`
  - `gameCtl.getFriendList`

这说明“外部控制 QQ 小程序”这件事已经成立，剩余工作主要是工程化接入，而不是能力验证。

## 3. 架构决策

### 3.1 总体方向

项目后续分成两条 transport 路线：

- 微信路线：`CDP transport`
- QQ 路线：`WebSocket transport`

两条路线尽量共用同一套自动化编排逻辑。

### 3.2 分层原则

- `button.js`：只负责游戏内能力，不负责外部调度和传输
- 小程序宿主：只负责连接、重连、命令分发、日志回传
- 自动农场编排：尽量继续放在 Node 侧
- 网页端：只作为状态展示和控制入口，不直接依赖具体 transport

### 3.3 不建议的做法

- 不把大量调度逻辑直接塞进 `button.js`
- 不继续依赖一次性 `setTimeout` 作为长期控制方案
- 不在 QQ 路线上开放任意 `eval`
- 不把 QQ 这条链路伪装成 CDP 兼容层

## 4. 目标模块拆分

### 4.1 小程序侧

新增正式宿主脚本，例如：

- `qq-host.js`

职责：

- 等待 `gameCtl` 就绪
- 建立 WebSocket 连接
- 自动重连
- 处理 `ping/pong`
- 处理白名单 RPC
- 上报日志、状态、错误

加载方式：

- `game.js` 启动时加载一次
- 由宿主创建全局单例并长期驻留

### 4.2 Node 侧

新增 QQ transport，例如：

- `src/qq-ws-session.js`

职责：

- 接收小程序连接
- 维护连接状态
- 提供统一调用接口
- 将 `call(path, args)` 转发给 QQ 小程序宿主

### 4.3 自动化层

现有自动化逻辑应继续复用：

- [src/auto-farm-executor.js](/D:/nodejs_code/农场相关/农场使用cdp控制/src/auto-farm-executor.js)
- [src/auto-farm-manager.js](/D:/nodejs_code/农场相关/农场使用cdp控制/src/auto-farm-manager.js)

需要抽象的地方：

- 当前调用链默认依赖 CDP session
- 后续需要改成依赖统一接口，例如：
  - `ensureReady()`
  - `call(path, args)`
  - `getStatus()`

这样自动化层不关心底层到底是 CDP 还是 QQ WebSocket。

### 4.4 网关 / 网页端

现有网关与页面继续保留，但需要增加“当前 transport 类型”概念：

- `wechat-cdp`
- `qq-ws`

网页端需要根据 transport 能力决定展示：

- 预览：大概率仍仅支持 CDP 路线
- 自动农场：两条路线都应支持
- 好友列表 / 进入好友 / 日志：两条路线都应支持

## 5. RPC 白名单

QQ 路线首批只开放自动农场真正需要的方法：

- `gameCtl.getFarmOwnership`
- `gameCtl.getFarmStatus`
- `gameCtl.getFriendList`
- `gameCtl.enterOwnFarm`
- `gameCtl.enterFriendFarm`
- `gameCtl.triggerOneClickOperation`

后续按需补充，不开放任意 JS 执行。

## 6. 推荐迁移顺序

### 阶段 1：最小控制链正式化

目标：

- 用正式宿主替换测试宿主
- Node 侧能够稳定收发 QQ RPC

验收：

- 宿主自动连接 / 自动重连
- `hello / ping / pong / call / result / log` 稳定可用

### 阶段 2：打通一轮自动农场

目标：

- 在 QQ transport 上跑通 `runOnce`

优先复用：

- [src/auto-farm-executor.js](/D:/nodejs_code/农场相关/农场使用cdp控制/src/auto-farm-executor.js)

验收：

- 可触发一轮自己农场
- 可触发一轮好友偷菜
- 日志能回传到 Node 侧

### 阶段 3：接入自动调度

目标：

- 让 [src/auto-farm-manager.js](/D:/nodejs_code/农场相关/农场使用cdp控制/src/auto-farm-manager.js) 同时支持 CDP / QQ WS 两种 transport

验收：

- `start / stop / runOnce / refresh` 都能在 QQ 路线上工作

### 阶段 4：接入网页端

目标：

- 网页端展示 QQ 连接状态
- 网页端可对 QQ 路线执行自动农场控制
- 网页端日志展示 transport 区分

### 阶段 5：补充工程化能力

包括但不限于：

- QQ 小程序资源补丁脚本
- 宿主版本号与协议版本控制
- 宿主日志等级
- 断线恢复策略
- 配置持久化

## 7. 关键风险

### 7.1 小程序前后台切换

风险：

- WebSocket 可能断开
- `gameCtl` 可能暂时不可用

要求：

- 宿主必须自动重连
- Node 侧必须允许会话重建

### 7.2 `gameCtl` 就绪时机

风险：

- 宿主连接成功时，`gameCtl` 还未挂载

要求：

- 宿主持续轮询就绪状态
- 就绪变化时主动上报事件

### 7.3 小程序资源更新

风险：

- QQ 小程序更新后，手动修改的 `game.js` 可能被覆盖

要求：

- 后续补一份自动补丁脚本
- 避免手工重复修改资源

### 7.4 传输层过早耦合 UI

风险：

- 如果先把网页写死到 QQ 测试协议，后续改 transport 会很痛苦

要求：

- 先抽 transport 接口，再接 UI

## 8. 当前建议

当前最优先的下一步不是继续扩展测试脚本，而是：

1. 先把 QQ 测试宿主整理成正式宿主
2. 再在 Node 侧抽出 `qq-ws-session`
3. 再把自动农场从“依赖 CDP session”改为“依赖统一调用接口”

优先级最高的目标只有一个：

**让现有自动农场在 QQ 路线上跑通 `runOnce`。**

只要这一点打通，后面的调度、日志、网页接入都只是工程接线问题。



