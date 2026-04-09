这是一个偏工程实验性质的项目。和“农场脚本”本身相比，更值得看的其实是两件事：

- 如何把非标准小游戏调试链路补成可用的 CDP / RPC
- 如何把游戏内能力层、外部网关、网页控制台拆开

项目目前已经同时支持两条路线：

- 微信小游戏调试环境：`CDP + 自动注入 button.js`
- QQ 小程序本地资源环境：`WebSocket 宿主 + QQ bundle`

hook 代码感谢 [evi0s/WMPFDebugger](https://github.com/evi0s/WMPFDebugger)

# 农场自动化控制台

## 30 秒快速开始

安装依赖：

```bash
npm install
```

微信路线：

```bash
npm run start -- --wx
```

QQ 路线：

```bash
npm run start -- --qq
```

启动后打开控制页：

- 默认地址：<http://127.0.0.1:8787/>

如果是 QQ 路线：

1. 进入控制页“运行时”页签
2. 若已知 `appid`，直接填入页面里的 “QQ 小程序 AppID”
3. 点击“保存 QQ Bundle”导出 bundle，或点击“一键打补丁” 自动查找最新 QQ 资源目录并把 bundle 写入 `game.js`
4. 再启动 QQ 小程序

## 当前架构

### 微信 / CDP

- `wmpf/` 把小游戏调试协议补成可用的 CDP
- `public/index.html` 通过网关拿状态、预览、输入事件
- 上下文就绪后自动注入 [`button.js`](button.js)
- 自动农场通过 `gameCtl.*` 执行业务动作

### QQ / WebSocket

- `button.js` 仍然只负责游戏内能力层
- [`qq-host.js`](qq-host.js) 是小程序内常驻宿主
- 网关通过 `/miniapp` WebSocket 和宿主 RPC 通信
- QQ bundle = `button.js + qq-host.js`
- 可在网页中直接导出 bundle，或直接给 `game.js` 打补丁

## 项目目录

| 路径 | 说明 |
|------|------|
| [`wmpf/`](wmpf) | 微信小游戏调试桥、Frida hook、CDP 代理。 |
| [`src/`](src) | 网关、自动农场编排、QQ WS / CDP transport、bundle 生成。 |
| [`public/`](public) | 网页控制台。 |
| [`button.js`](button.js) | 游戏内能力层，暴露 `gameCtl.*`。 |
| [`qq-host.js`](qq-host.js) | QQ 小程序宿主模板。 |
| [`scripts/patch-qq-miniapp.cjs`](scripts/patch-qq-miniapp.cjs) | 命令行生成 / 打补丁工具。 |
| [`docs/qq-ws-automation-plan.md`](docs/qq-ws-automation-plan.md) | QQ WebSocket 自动化改造计划。 |

## 环境要求

- Windows
- Node.js >= 22
- 微信路线需要可用的微信 PC 版调试环境
- QQ 路线需要能访问本地 `game.js` 资源文件

说明：

- `frida` 安装慢、编译慢、卡住，多半是本机环境问题，不是本项目逻辑问题
- 支持的微信版本可看 [`wmpf/frida/config`](wmpf/frida/config)

## 启动方式

统一推荐只记一个命令：

```bash
npm run start --runtime cdp
```

```bash
npm run start --runtime qq_ws
```

简写：

```bash
npm run start --wx
```

```bash
npm run start --qq
```

也可以只启动网关：

```bash
npm run gateway --wx
```

```bash
npm run gateway --qq
```

## 环境变量

项目会自动读取：

- `.env`
- `.env.local`

也支持额外文件：

```bash
FARM_ENV_FILE=.env.qq
```

参考模板见 [`.env.example`](.env.example)。

### 常用变量

| 变量 | 说明 |
|------|------|
| `FARM_RUNTIME_TARGET` | `cdp` / `qq_ws` / `auto` |
| `FARM_GATEWAY_HOST` | 网关监听地址 |
| `FARM_GATEWAY_PORT` | 网关端口 |
| `FARM_CDP_WS` | 微信 CDP 目标 |
| `FARM_QQ_WS_PATH` | QQ 宿主 WebSocket 路径，默认 `/miniapp` |
| `FARM_QQ_GAME_JS` | QQ 小程序 `game.js` 路径，用于一键打补丁 |
| `FARM_QQ_APPID` | QQ 小程序 appid；未设置 `FARM_QQ_GAME_JS` 时按它自动定位最新版本目录 |
| `FARM_QQ_MINIAPP_SRC_ROOT` | QQ `miniapp_src` 根目录；默认 `%APPDATA%\\QQEX\\miniapp\\temps\\miniapp_src` |
| `FARM_QQ_HOST_WS_URL` | 生成 QQ bundle 时写入的本地宿主地址 |
| `FARM_QQ_HOST_VERSION` | QQ 宿主版本号 |
| `FARM_QQ_BUNDLE_OUT` | 命令行生成 bundle 的输出路径 |

### QQ 路线示例

```env
FARM_RUNTIME_TARGET=qq_ws
FARM_GATEWAY_HOST=127.0.0.1
FARM_GATEWAY_PORT=18788
FARM_QQ_WS_PATH=/miniapp
FARM_QQ_WS_READY_TIMEOUT_MS=15000
FARM_QQ_WS_CALL_TIMEOUT_MS=15000
# 显式路径优先；不填时按 appid 自动扫描最新目录
# FARM_QQ_GAME_JS=D:\path\to\qq-miniapp\game.js
FARM_QQ_APPID=1112386029
# FARM_QQ_MINIAPP_SRC_ROOT=C:\Users\RJ\AppData\Roaming\QQEX\miniapp\temps\miniapp_src
FARM_QQ_HOST_WS_URL=ws://127.0.0.1:18788/miniapp
FARM_QQ_HOST_VERSION=qq-host-1
```

## 控制页说明

控制页现在是运行时感知的，不再把 QQ 路线硬套成 CDP。

主要页签：

- `自动农场`
  - 自己农场定时一键收获、浇水、除草、杀虫
  - 好友列表扫描、进好友农场偷菜
  - 可配置轮询间隔、每轮好友数、进场等待、动作等待、回家、出错停止、自动种植
- `运行时`
  - 显示当前到底走 `微信 CDP` 还是 `QQ WS`
  - 显示 QQ 宿主最近日志
  - 支持填写 `appid` 自动查找最新 QQ 小程序 `game.js`
  - 可直接“保存 QQ Bundle”
  - 若已配置 `FARM_QQ_GAME_JS` 或 `FARM_QQ_APPID`，可直接“一键打补丁”
- `画面预览`
  - 仅 CDP 路线可用
  - 仅支持点击
- `好友农场`
  - 获取好友列表
  - 直接进入指定好友农场
- `消息日志`
  - 控制页收发消息和自动农场日志

## QQ 路线使用方式

### 方式 1：网页导出 bundle

适合不想记命令的人。

1. `npm run start -- --qq`
2. 打开控制页
3. 进入“运行时”页签
4. 点击“保存 QQ Bundle”
5. 把导出的内容放进 QQ 小程序 `game.js`

说明：

- 浏览器支持 `showSaveFilePicker` 时，会弹系统保存框
- 不支持时，会走普通文件下载

### 方式 2：网页一键打补丁

前提：

- 已配置 `FARM_QQ_GAME_JS`
- 或已配置 `FARM_QQ_APPID`
- 或在控制页里临时填写 `appid`

1. `npm run start -- --qq`
2. 打开控制页
3. 进入“运行时”页签
4. 若未配置默认值，先填写 `QQ 小程序 AppID`
5. 点击“一键打补丁”

补丁行为：

- 首次写入时会生成 `game.js.qq-farm.bak`
- 重复执行会替换旧标记区块，不会无限追加
- 若未显式配置 `FARM_QQ_GAME_JS`，会扫描 `%APPDATA%\\QQEX\\miniapp\\temps\\miniapp_src` 下 `appid_*` 目录，并选取最近更新的一份 `game.js`

### 方式 3：命令行生成 / 打补丁

仅当你想绕过网页时使用。

只生成 bundle：

```bash
npm run qq:bundle
```

直接补丁：

```bash
npm run qq:patch
```

也可以临时指定 appid：

```bash
npm run qq:patch -- --qq-appid 1112386029
```

## 微信路线使用方式

1. `npm run start -- --wx`
2. 打开目标小游戏
3. 打开控制页
4. 等待上下文就绪
5. 页面会自动注入 `button.js`

说明：

- 微信路线下，画面预览、点击、拖动都走 CDP
- 若出现 `CDP timeout`，一般先检查小游戏是否真的在前台、调试链路是否还活着

## 已实现功能

- 微信 CDP 路线自动探测上下文并自动注入 `button.js`
- QQ WebSocket 宿主链路
- QQ bundle 生成
- QQ `game.js` 一键打补丁
- QQ `appid -> 最新版本目录 -> game.js` 自动发现
- 自动农场调度：
  - 自己农场一键收获 / 浇水 / 除草 / 杀虫
  - 好友列表刷新、进入好友农场、一键偷菜
  - 自动回家
  - 自动种植
- 好友列表获取与进入指定好友农场
- 运行时状态页
- CDP 画面预览与网页点击 / 拖动输入
- 消息日志与自动农场最近日志展示

## 默认端口

| 服务 | 默认值 |
|------|------|
| 微信调试 WebSocket | `9421` |
| CDP 代理 | `62000` |
| 网关 HTTP | `8787` |
| 网关控制 WebSocket | `/ws` |
| QQ 宿主 WebSocket | `/miniapp` |

## 常见说明

### 为什么 QQ 和微信不是同一条底层链路

不是故意拆开，而是宿主条件不同：

- 微信这边本来就有调试链路，适合走 CDP
- QQ 这边能直接改资源文件，适合走“常驻宿主 + 本机 WebSocket”

所以统一的是“启动入口”和“网页控制台”，不是强行把两端伪装成同一种底层协议。

### 为什么 QQ 预览还没有网页实时画面

当前网页实时预览还是 CDP 能力。QQ 路线现在先解决的是自动化控制链路和工程化补丁，没把画面采集也接到宿主里。

## 免责声明

- 本仓库仅供学习、研究与安全测试
- 作者与贡献者与腾讯、QQ、微信及其小游戏无关联
- 对第三方软件进行注入、调试或自动化，可能违反协议并导致封号、限制功能或其他后果
- 一切风险由使用者自行承担

## 许可证

本项目使用 [GNU GPL v3.0](LICENSE)。
