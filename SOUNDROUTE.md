# SoundRoute / Parrot — 交接文档

交接日期：2026-10-22。这份文档写给接手的人和 Claude Code：读完就能接着做，不需要回看之前的对话。

## 1. 项目是什么

**Parrot** 是 YuJing Shi 的设计项目：一个挂在雨伞上、搭在肩头的鹦鹉形可穿戴设备。它把前人在城市里走过的路线变成“声音路线”。后来的人不看地图，而是靠听觉、转身和走动，去追随或偏离这些声音，在城市里漫游。

**SoundRoute** 是这个项目的网页版，目标是做成任何人都能用的网页游戏：
- 边走边录音（含环境声），留下一段带声音的旅程；
- 收听自己和收藏的旅程：走近哪里，就听到别人在那一刻录下的声音；
- 多条旅程同时在场时，自然地在它们之间切换；
- 在“城市广场”看到大家公开旅程的模糊光点，并收藏感兴趣的旅程。

硬件概念保留：网页可以独立使用，但设想中手机放进肩上的鹦鹉，不用一直手持，麦克风朝外，朝向也更稳定。

## 2. 链接

| 内容 | 地址 |
|---|---|
| 仓库 | https://github.com/YuJing949/yujingshistudio |
| 开发分支 | `v2`（所有新功能都在这里，**不要直接改 `main`**） |
| 网页代码 | `soundtrack/` 文件夹 |
| 测试站 | https://soundroute-preview.zoesyj1130.workers.dev （Cloudflare Worker：`soundroute-preview`，构建 `v2`） |
| 正式站 | https://soundroute.yujingshistudio.com （Worker：`soundroute`，目前是旧版本，大概率用 `wrangler deploy` 手动部署） |
| Supabase | https://saqgoppqmkaxteysteds.supabase.co |
| 产品规划文档 | https://claude.ai/artifact/JN8NPwT6PRXnUf3ypKWXaq （用户旅程地图、各阶段任务和验收标准） |

## 3. 已做的决定

- **基于仓库里的旧代码改。** 线上正式站的页面（有 “Hi, this is Parrot” 和地图）比仓库新，但那份代码没推到 GitHub，决定不用它。合并 `v2` 到 `main` 并部署后，正式站会被 v2 替换。
- **定位：GPS 锚定 + 步数/指南针修正。** 拿到第一个 GPS 信号后可以从任何地方出发；没有 GPS 时退回原来的“同一起点”模式。
- **录音：全程连续录音，每段旅程最长 5 分钟**（需要环境声）。一段旅程只存一个音频文件，外加每 2 秒一个轨迹点。轨迹点记录“这是录音第几秒”，回放时从对应秒数开始播放。这取代了原来每 8 秒一段的节点。
- **身份：匿名登录**（Supabase anonymous sign-in），不需要注册。以后再加可选的恢复码或邮箱绑定。
- **只听收藏：** 走路时只播放“我的旅程”和“我收藏的旅程”，陌生人的声音不会突然出现。
- **默认私密。** 每段旅程有一个分享码（如 `misty-parrot-0417`）。公开的旅程出现在城市广场；私密的旅程只能通过分享码收藏。
- **删除即彻底删除：** 我删除自己的旅程后，它也会从别人的收藏里消失（数据库级联删除）。
- **城市广场只显示模糊位置：** 按约 200 米网格聚合，不显示真实起点和路线。
- **举报功能放在阶段 7。**
- **保持静态网站：** 不引入构建工具。Supabase 客户端从 CDN 加载（`cdn.jsdelivr.net`）。

## 4. 代码结构（`soundtrack/`）

| 文件 | 作用 |
|---|---|
| `index.html` | 单页界面（英文 UI） |
| `style.css` | 样式 |
| `app.js` | 主程序：传感器、计步、指南针、录音、轨迹点、绘图、收听模式、上传与删除 |
| `location.js` | `LocationFusion`：GPS 与步数、指南针的卡尔曼式融合；本地坐标系为米（x = 东，y = 北），由第一个 GPS 信号锚定到经纬度 |
| `localstore.js` | IndexedDB：上传完成前把旅程存在手机上 |
| `supabase.js` | Supabase 客户端（publishable key，可以放在前端）、`ensureVisitor()` 匿名登录、`checkDatabase()` |
| `cloud.js` | `uploadWalk` / `loadMyWalks` / `signAudioUrls` / `deleteWalk` |
| `listen.js` | 收听：`decideListen()` 纯决策（开始、保持、重新对齐、切换、停止），`ListenPlayer` 双播放器，通过 Web Audio 增益节点控制音量和交叉淡化（iPhone 会忽略 `<audio>.volume`），并预先缓存附近录音；参数在 `LISTEN_CONFIG` |
| `wrangler.toml` | Cloudflare 静态资源部署（Worker 名 `soundroute`） |

仓库根目录：
- `supabase/soundroute.sql`：建表、权限规则（RLS）、分享码、`save_by_code()`、`get_plaza_cells()`、音频存储桶及其权限。可以重复运行。**已在 Supabase 上运行过。**
- `tests/soundroute/`：端到端测试（见第 7 节）。
- 根目录的 `wrangler.toml`、`src/` 等属于作品集主站，和 SoundRoute 无关，不要动。

### `app.js` 里的数据结构

一段旅程（walk，代码里沿用旧名 `route`）：
```js
{
  id, name, createdAt, durationS, audioMime, audioBlob?, audioUrl, audioPath?,
  cloud: "pending" | "uploading" | "saved" | "failed" | "device",
  isPublic, shareCode, fromCloud?,
  nodes: [ { id, t /* 录音秒数 */, timestamp, stepCount, heading, x, y, lat, lng, uncertaintyM } ]
}
```
- `routes`：我的旅程（云端载入的、本地待上传的、本次录的）。`currentRecordingRoute`：正在录的旅程。
- `nodes` 就是每 2 秒一个的轨迹点。`x`/`y` 是本次会话坐标系里的米；云端载入的旅程由 `projectWalks()` 从经纬度换算出 x/y。
- 收听逻辑：`updateListenMode()` 每 300 毫秒调用一次 `decideListen()`。走近旅程（20 米内、大致在前方）就从对应秒数淡入；沿路线走则连续播放；播放进度和所在位置相差超过 12 秒时重新对齐；另一条旅程明显更近（差 8 米以上）时交叉淡化切换；离开 28 米后淡出；播完的旅程休息 45 秒。音量由距离和朝向共同决定。

### 数据库（Supabase）

| 表 / 对象 | 内容 | 谁能读 |
|---|---|---|
| `routes` | 名称、作者 `owner`、`is_public`、`share_code`、`duration_s`、`audio_path`、`audio_mime`、`center_lat/lng` | 作者；公开的所有人；收藏了的人 |
| `points` | `route_id`、`t`、`lat`、`lng`、`heading`、`accuracy` | 能读到对应旅程的人 |
| `saves` | `user_id`、`route_id` | 本人 |
| 存储桶 `route-audio`（私有） | `<user id>/<route id>.m4a` | 能读到对应旅程的人，通过 1 小时有效的签名链接 |
| `save_by_code(code)` | 用分享码收藏任意旅程（含私密） | 已登录用户 |
| `get_plaza_cells()` | 公开旅程按约 200 米网格计数 | 所有人 |

权限规则已在本地 Postgres 里模拟 Supabase 环境测试过：别人看不到私密旅程，不能往别人的文件夹上传，私密旅程不能直接收藏，作者删除后收藏一并消失。

## 5. 部署和测试流程

1. 在 `v2` 上改代码、提交、推送。
2. 在 Cloudflare 打开 Worker **soundroute-preview** → **重新构建**（目前推送后不会自动构建）。
3. 用手机打开测试站测试。iPhone Safari 需要允许运动与方向、麦克风、位置权限；GPS 要在户外测。
4. 满意后把 `v2` 合并到 `main`，再在电脑上部署正式站：`cd soundtrack && npx wrangler deploy`。

页面底部的 **Debug log** 显示设备上的日志（`[gps]`、`[audio]`、`[cloud]`、`[listen]` 等），手机上排查问题时很有用。

## 6. 进度

| 阶段 | 内容 | 状态 |
|---|---|---|
| 0 准备 | `v2` 分支、测试站、Supabase 匿名登录、publishable key | 完成 |
| 1 后端基础 | SQL、接入 Supabase、匿名登录 | 完成，手机实测通过 |
| 2 定位 | `location.js` 融合 GPS 与步数、指南针；节点存经纬度；面板显示 GPS 精度 | 代码完成；模拟中位误差约 3 米，**未实地测试** |
| 3 记录与删除 | 连续录音（最长 5 分钟）、2 秒轨迹点、本地先存再上传、刷新后保留、命名、分享码、删除 | 代码完成；模拟环境端到端测试通过，**未在手机上测试** |
| 4 回放与切换 | 连续播放、淡入淡出、切换、重新对齐、朝向音量、预缓存 | 代码完成；决策单元测试和模拟端到端测试通过，**未在手机上测试** |
| 5 我的地图 | 见下 | 未开始 |
| 6 城市广场 | 见下 | 未开始 |
| 7 打磨 | 见下 | 未开始 |

### 下一步：先在手机上验证阶段 2 和 3

1. 户外录一段约 1 分钟的旅程，结束时命名。Cloud 应从 “Uploading…” 变为 “Saved · private”。
2. 刷新页面，旅程仍在，录音能播放。
3. 从同一地点再走一次并打开 Listen Mode，确认前一段录音**从对应秒数**开始播放。iPhone 上的跳转播放是最大风险：如果总从头播或不播，改成上传时把录音切成短文件，或用 Web Audio `decodeAudioData` 解码后按偏移播放。
4. 删除旅程，确认 Supabase 的 `routes` 表和 `route-audio` 桶都清空。
5. 观察 GPS 精度和轨迹形状，必要时调整 `location.js` 的参数（`maxAccuracyM`、`stepVarianceM2`、`timeVarianceM2PerS`）。

### 阶段 4：回放与切换（代码已完成，待手机验证）

验收标准：两台手机分别记录，在任意一台上都能循着另一台的声音走。

已完成下列各项；收藏的旅程要等阶段 5 才会加入收听来源。手机上要重点验证：
- iPhone 上开着麦克风录音时，播放声音可能从听筒而不是扬声器出来、音量很小，戴耳机测试；
- Supabase 签名链接的音频走 Web Audio 需要 CORS，正常情况下会先缓存成本地 blob；如果完全没声音，看 Debug log 里的 `[listen] prefetch failed`；
- 在真实 GPS 下调整 `LISTEN_CONFIG` 的距离参数。

原计划：

- 播放不再按 8 秒一段停下：走近某条旅程后从对应秒数开始，沿着路线走就一直播下去；明显偏离（例如超过 25 米）时淡出。
- 声音渐入渐出；多条旅程同时在场时，前方最近的那条胜出，切换时交叉淡化。
- 只加载“我的旅程”和“我收藏的旅程”（收藏在阶段 5 实现；`saves` 表已经就绪）。
- 预先缓存附近旅程的录音，减少等待和流量。
- 在 GPS 环境下重新调 `MAX_LISTEN_DISTANCE`（现为 20 米）和 `DIRECTION_CONE_DEGREES`（45°）。

### 阶段 5：我的地图

验收标准：能收藏、取消收藏、公开、设为私密，并用分享码在另一台手机上收藏。

- 两个列表：我记录的、我收藏的，每条带路线预览。
- 我记录的：重命名、公开或私密切换（更新 `routes.is_public`）、复制分享码、删除。
- 我收藏的：取消收藏（删除 `saves` 行）。
- 输入分享码收藏：调用 `supabase.rpc('save_by_code', { code })`。

### 阶段 6：城市广场

验收标准：多条公开旅程在黑底光点图上可见，点击后能试听并收藏。

- 视觉参考“夜晚地球的灯光图”：黑色背景上的光点，越密越亮。可以用 MapLibre 热力图配深色底图，或者完全不要底图。
- 数据来自 `supabase.rpc('get_plaza_cells')`。
- 点击光点，列出这一带的公开旅程（按 `center_lat/lng` 范围查 `routes where is_public`），可试听开头并收藏。

### 阶段 7：打磨

- 首次引导：逐个解释权限；帮新用户在出门前收藏至少一条旅程（否则第一次走路什么都听不到）；附近没有旅程时推荐别的玩法。
- PWA：manifest，引导添加到主屏幕。否则 iPhone Safari 7 天不访问会清除匿名身份。
- 恢复码或邮箱绑定（Supabase 支持把匿名用户升级为正式账号）。
- 举报按钮与下架机制；上传频率限制。
- 旅程起点附近一段自动隐去，保护隐私。

## 7. 本地测试

测试环境无法访问真实的 Supabase，所以端到端测试用 `tests/soundroute/fake-supabase.js` 替换 CDN 上的 Supabase 客户端，数据存在 localStorage 里；GPS、麦克风、指南针都是模拟的。

```
pip install playwright && playwright install chromium
(cd soundtrack && python3 -m http.server 8765) &
python3 tests/soundroute/run.py
```

测试覆盖：录音 → 上传 → 刷新后仍在 → 第二次走同一路线时从对应秒数连续播放 → 离线上传失败后自动重传 → 删除。

收听决策的单元测试：`node tests/soundroute/decide.test.mjs`。
改了 `cloud.js` 调用的 Supabase API 时，记得同步更新 `fake-supabase.js`。

## 8. 注意事项

- **永远不要**把 Supabase 的 secret / service_role key 放进代码。前端只用 publishable key（已在 `supabase.js` 里）。
- 免费版 Supabase：500 MB 数据库、约 1 GB 文件存储、每月 5 GB 流量；**7 天无访问会暂停项目**，展示或答辩前先打开一次。按 32 kbps 计算，5 分钟录音约 1.2 MB，大约能存 800 段旅程。
- iPhone 的运动与方向权限必须由点击直接触发：`startRecordingSession()` 里先请求运动和方向权限，再请求麦克风，顺序不能改。
- 仓库里误提交了 `node_modules`（约 6 万个文件），克隆很慢。可以清理，但会影响作品集主站，单独处理。
