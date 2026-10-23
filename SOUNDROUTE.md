# SoundRoute / Parrot — 交接文档

更新于 2026-10-23。这份文档写给接手的人和 Claude Code：读完就能接着做，不需要回看之前的对话。

## 0. 现在的状态（一句话版）

七个开发阶段的代码都已完成，全部在 `v2` 分支上。阶段 1–4（定位、记录、上传、收听）已在 iPhone 上实测通过；阶段 5–7（我的地图、城市广场、引导/账号/举报）只通过了模拟测试，**还没在手机上测**。正式站还是旧版本，等 `v2` 合并到 `main` 并部署后才会更新。

**接下来要做的事，按顺序：**

1. 在 Supabase 后台完成阶段 7 的三项设置（见 §6）。
2. 在手机上测试阶段 5–7（见 §7 的清单）。
3. 修复测出来的问题。
4. 把 `v2` 合并到 `main`，部署正式站（见 §8）。

## 1. 项目是什么

**Parrot** 是 YuJing Shi 的设计项目：一个挂在雨伞上、搭在肩头的鹦鹉形可穿戴设备。它把前人在城市里走过的路线变成“声音路线”。后来的人不看地图，而是靠听觉、转身和走动，去追随或偏离这些声音，在城市里漫游。

**SoundRoute** 是它的网页版，任何人用手机就能玩：

- **记录**：边走边录音（含环境声），最长 5 分钟，留下一段带声音的旅程。
- **收听**：走到别人录音的地方，就能听到他们当时在那里录下的声音；沿路线走就一直播放，转身朝向声音会听得更清楚。
- **切换**：多条旅程同时在附近时，声音会在它们之间交叉淡化切换。
- **我的地图**：我录的旅程和我收藏的旅程。只有这两类会在走路时播放，陌生人的声音不会突然出现。
- **城市广场**：公开的旅程在黑底上显示为模糊的光点（类似夜晚的城市灯光），可以试听和收藏。

硬件概念保留：网页可以独立使用，但设想中手机放进肩上的鹦鹉，不用手持，麦克风朝外，朝向也更稳定。

## 2. 链接

| 内容 | 地址 |
|---|---|
| 仓库 | https://github.com/YuJing949/yujingshistudio |
| 开发分支 | `v2`（所有新功能都在这里，**不要直接改 `main`**） |
| 网页代码 | `soundtrack/` 文件夹 |
| 测试站 | https://soundroute-preview.zoesyj1130.workers.dev （Cloudflare Worker `soundroute-preview`，构建 `v2`） |
| 正式站 | https://soundroute.yujingshistudio.com （Worker `soundroute`，目前是旧版本，在电脑上用 `wrangler deploy` 手动部署） |
| Supabase | https://saqgoppqmkaxteysteds.supabase.co |
| 产品规划文档 | https://claude.ai/artifact/JN8NPwT6PRXnUf3ypKWXaq （用户旅程地图、各阶段任务和验收标准） |

## 3. 已做的设计决定

- **定位**：GPS 负责锚定真实位置，步数和指南针让轨迹平滑，两者持续互相修正。拿到第一个 GPS 信号后可以从任何地方出发；没有 GPS 时退回原来的“同一起点”模式。
- **录音**：全程连续录音，每段旅程最长 5 分钟（需要环境声）。一段旅程只存一个音频文件，外加每 2 秒一个轨迹点。轨迹点记录“这是录音第几秒”，回放时从对应秒数开始播放。这取代了最初每 8 秒一段的做法。
- **身份**：默认匿名登录，不需要注册。可以绑定邮箱，绑定后用户 ID 不变，旅程不丢，也能在别的设备登录。
- **只听自己和收藏的旅程。**
- **默认私密。** 每段旅程有一个分享码（如 `misty-parrot-0417`）。公开的旅程出现在城市广场；私密的旅程只能通过分享码收藏。
- **删除即彻底删除**：作者删除旅程后，它也从别人的收藏里消失（数据库级联删除）。
- **隐私**：城市广场只显示约 200 米网格的模糊位置；上传时去掉每段旅程开头 30 米，起点（常常是家）不会被存储。
- **内容安全**：任何人可以举报；被 3 个不同的人举报后自动隐藏，等管理员（YuJing）审核。
- **技术约束**：保持纯静态网站，不引入构建工具。Supabase 客户端从 CDN（`cdn.jsdelivr.net`）加载。界面文字用英文。
- **基于仓库里的旧代码开发。** 正式站上那个旧版本（有 “Hi, this is Parrot” 和地图）的代码从没推到 GitHub，决定不用它；合并 `v2` 并部署后，正式站会被替换。

## 4. 代码结构

### `soundtrack/`（网页，约 3,800 行 JS）

| 文件 | 作用 |
|---|---|
| `index.html` | 单页界面：两个标签页 My map / City plaza、首次引导弹窗 `#guide`、Your account 区域 |
| `style.css` | 样式；按钮用 `.btn`，紧凑按钮加 `.btn-small` |
| `manifest.webmanifest`、`icons/` | 添加到主屏幕（PWA）；图标是原创的（暖色光点加声波） |
| `app.js` | 主程序：传感器与计步、录音与轨迹点、绘图、收听调度、上传与删除、收藏与分享、城市广场界面、账号界面、引导 |
| `location.js` | `LocationFusion`：GPS 与步数、指南针的卡尔曼式融合。本地坐标系单位为米（x = 东，y = 北），由第一个 GPS 信号锚定到经纬度 |
| `listen.js` | 收听。`decideListen()` 是纯决策函数（开始、保持、重新对齐、切换、停止），不碰音频，方便测试；`ListenPlayer` 用两个播放器做交叉淡化，音量通过 Web Audio 增益节点控制（iPhone 会忽略 `<audio>.volume`），并预先缓存附近录音；参数都在 `LISTEN_CONFIG` |
| `plaza.js` | `PlazaMap`：城市广场画布。Web Mercator 投影，无底图；拖动、双指缩放、滚轮缩放、点击选中；比例尺；“你在这里”标记 |
| `cloud.js` | 云端数据：上传（含隐去起点 `withoutPrivateStart`）、载入我的和收藏的旅程、签名音频链接、删除、收藏/取消收藏、分享码收藏、改名、公开或私密、举报、广场数据 |
| `supabase.js` | Supabase 客户端（publishable key，可以放在前端）、匿名登录、数据库检查、邮箱绑定/登录/退出 |
| `localstore.js` | IndexedDB：上传完成前把旅程存在手机上，断网不丢 |
| `wrangler.toml` | Cloudflare 静态资源部署（Worker 名 `soundroute`） |

### 仓库根目录

- `supabase/soundroute.sql`：全部数据库设置，可以重复运行。
- `tests/soundroute/`：测试（见 §9）。
- `CLAUDE.md`：给 Claude Code 的工作规则。
- 根目录的 `wrangler.toml`、`src/`、`package.json` 等属于作品集主站，和 SoundRoute 无关，不要动。

### `app.js` 里的数据结构

一段旅程（代码里沿用旧名 `route`）：

```js
{
  id, name, createdAt, durationS, audioMime, audioBlob?, audioUrl, audioPath?,
  cloud: "pending" | "uploading" | "saved" | "failed" | "device",
  isPublic, hidden, shareCode, fromCloud?,
  nodes: [ { id, t /* 录音秒数 */, timestamp, stepCount, heading, x, y, lat, lng, uncertaintyM } ]
}
```

- `routes`：我的旅程（云端载入的、本地待上传的、本次录的）。
- `savedWalks`：收藏的别人的旅程。
- `allWalks()`：以上两者合并，收听和地图叠加都用它。
- `currentRecordingRoute`：正在录的旅程。
- `nodes` 就是每 2 秒一个的轨迹点。`x`/`y` 是本次会话坐标系里的米；云端载入的旅程由 `projectWalks()` 从经纬度换算出 x/y。

### 主要流程

- **记录**：`startNewWalk()` → `startRecordingSession()`（先请求运动和方向权限，再请求麦克风，顺序不能改）→ 一个 MediaRecorder 连续录音，每 2 秒 `recordTrackPoint()` → 5 分钟自动 `endWalk()` → 命名 → `keepAndUpload()`：先存 IndexedDB，再 `cloud.uploadWalk()`。
- **收听**：`updateListenMode()` 每 300 毫秒调用一次 `decideListen()`，再驱动 `ListenPlayer`。规则：走近旅程（20 米内、大致在前方）就从对应秒数淡入；沿路线走则连续播放；播放进度和所在位置相差超过 12 秒时重新对齐；另一条旅程明显更近（差 8 米以上）时交叉淡化切换；离开 28 米后淡出；播完的旅程休息 45 秒。音量由距离和朝向共同决定。
- **启动**：`loadPendingWalks()` → `connectCloud()`（匿名登录、数据库检查）→ `loadMyWalks()`（我的旅程和收藏的旅程，生成签名音频链接，每 40 分钟续期，重传未完成的上传）→ `renderAccount()`。

## 5. 数据库（Supabase）

| 表 / 对象 | 内容 | 谁能读 |
|---|---|---|
| `routes` | 名称、`owner`、`is_public`、`hidden`、`share_code`、`duration_s`、`audio_path`、`audio_mime`、`center_lat/lng` | 作者；以及未被隐藏的公开旅程或已收藏的旅程 |
| `points` | `route_id`、`t`、`lat`、`lng`、`heading`、`accuracy` | 能读到对应旅程的人 |
| `saves` | `user_id`、`route_id` | 本人 |
| `reports` | `route_id`、`reporter`、`reason` | 应用里没人能读，只在后台查看 |
| 存储桶 `route-audio`（私有） | `<user id>/<route id>.m4a` | 能读到对应旅程的人，通过 1 小时有效的签名链接 |
| `save_by_code(code)` | 用分享码收藏任意旅程（含私密，不含被隐藏的） | 已登录用户 |
| `get_plaza_cells()` | 公开且未隐藏的旅程，按约 200 米网格计数 | 所有人 |
| 触发器 | 分享码自动生成；3 次举报自动隐藏；每人每天最多 30 段旅程、20 次举报 | — |

所有权限规则都在本地 Postgres 里模拟 Supabase 环境测试过：别人看不到私密旅程、不能往别人的文件夹上传、私密旅程不能直接收藏、作者删除后收藏一并消失、不能举报自己的旅程、每人对同一旅程只能举报一次、3 次举报后隐藏、每日上限生效。

## 6. Supabase 后台设置清单

已完成：
- [x] 开启匿名登录（Authentication → Sign In / Providers → Allow anonymous sign-ins）
- [x] 运行过阶段 1 版本的 `soundroute.sql`

**阶段 7 需要做的：**
- [ ] **重新运行 `supabase/soundroute.sql`**：从 GitHub 的 `v2` 分支复制完整文件内容，粘贴到 SQL Editor 运行。它会新增 `reports` 表、`hidden` 列、触发器，并更新权限规则。
- [ ] **Authentication → URL Configuration**：Site URL 填 `https://soundroute.yujingshistudio.com`；Redirect URLs 加上 `https://soundroute-preview.zoesyj1130.workers.dev/**` 和 `https://soundroute.yujingshistudio.com/**`。
上线前建议（需要自定义 SMTP）：
- [ ] **接入自己的邮件服务**：Supabase 自带的邮件服务每小时只能发很少几封，而且不允许修改邮件模板。在 Authentication → Emails → SMTP Settings 接入 Resend：Host `smtp.resend.com`，端口 `465`，Username `resend`，Password 填 Resend 的 API key；发件地址用在 Resend 验证过的域名，例如 `noreply@yujingshistudio.com`。
- [ ] **接入之后，在邮件里加验证码**：Authentication → Emails → Templates，在 **Magic Link** 和 **Change Email Address** 两个模板里各加一行 `<p>Your code: {{ .Token }}</p>`。

**现在的邮件只有链接，没有验证码**，所以页面上只提示“点邮件里的链接”，验证码输入框收在 “Have a code?” 后面。只有链接时：绑定邮箱在任何浏览器里点都可以；在新设备上用 Safari 登录也没问题；只有在**主屏幕应用**里登录不行，因为链接会打开 Safari。这时需要验证码，也就是要先接入 SMTP。

**日常管理（审核举报）**：在 Table Editor 打开 `reports` 表查看被举报的旅程。没问题就在 `routes` 表把它的 `hidden` 改回 false；有问题就删除 `routes` 里那一行（录音文件也要在 Storage → route-audio 里删掉）。

## 7. 手机测试清单

先在 Cloudflare 打开 Worker **soundroute-preview** → Deployments → **重新构建**（推送后不会自动构建）。用 iPhone 的 Safari 打开测试站，戴耳机，在户外测试。

- [x] **阶段 1–4**：匿名登录、GPS 定位、记录 5 分钟内的旅程、上传、刷新后保留、删除、沿原路收听、转身音量变化、离开后淡出（已通过）。
- [ ] **阶段 5 我的地图**：把一段旅程设为公开，再改个名字。复制另一段私密旅程的分享码。
- [ ] **阶段 6 城市广场**：用无痕窗口当作第二个人，在广场里看到光点，点开后试听、收藏；用分享码收藏那段私密旅程；开启收听沿路线走，能听到收藏的旅程。回到自己这边删除公开的旅程，无痕窗口那边刷新后它应该消失。
- [ ] **阶段 7**：
  - 无痕窗口打开时出现首次引导；
  - 添加到主屏幕后，从图标打开像一个应用；
  - 绑定邮箱：点邮件里的链接，回到页面刷新后，Your account 显示 “Linked to…”；
  - 在另一个浏览器用同一个邮箱登录，能看到同样的旅程；
  - 用无痕窗口举报一段公开旅程。

页面底部的 **Debug log** 显示设备上的日志（`[gps]`、`[audio]`、`[cloud]`、`[listen]`、`[plaza]` 等），手机上排查问题时把它截图或复制下来。

## 8. 部署流程

**日常开发**：在 `v2` 上改代码、提交、推送 → 在 Cloudflare 重新构建 soundroute-preview → 用手机测试。

**上线正式站**（`v2` 测试满意后）：

```
git checkout main
git merge v2
git push origin main
cd soundtrack
npx wrangler deploy
```

正式站和测试站用同一个 Supabase 项目，数据是共享的。

## 9. 测试

测试环境无法访问真实的 Supabase，所以端到端测试用 `tests/soundroute/fake-supabase.js` 替换 CDN 上的 Supabase 客户端。它把数据存在 localStorage 里，并模拟了数据库的可见性规则、分享码、广场网格、举报隐藏和账号接口（只接受验证码 `123456`）。切换用户：`localStorage.setItem('fake-uid', …)`。GPS、麦克风、指南针都是模拟的。

```
pip install playwright && playwright install chromium
(cd soundtrack && python3 -m http.server 8765) &
node tests/soundroute/decide.test.mjs      # 收听决策单元测试
python3 tests/soundroute/run.py            # 录音 → 上传 → 刷新 → 收听 → 离线重传 → 删除
python3 tests/soundroute/share.py          # 两个人：公开、广场、试听、收藏、分享码、取消收藏、作者删除
python3 tests/soundroute/polish.py         # 引导、主屏幕横幅、隐去起点、三人举报隐藏、邮箱绑定
```

截图保存在 `tests/soundroute/out/`（已在 .gitignore 里）。改了 `cloud.js` 或 `supabase.js` 调用的 Supabase API 时，要同步更新 `fake-supabase.js`。数据库规则的改动要另外在真实或本地 Postgres 里验证，假客户端只是近似模拟。

## 10. 可调参数

| 参数 | 位置 | 现值 | 作用 |
|---|---|---|---|
| `LISTEN_CONFIG.enterDistanceM` / `leaveDistanceM` | `listen.js` | 20 / 28 米 | 开始听到 / 淡出的距离 |
| `LISTEN_CONFIG.frontConeDeg` | `listen.js` | 75° | 新旅程要大致在前方才会开始 |
| `LISTEN_CONFIG.switchMarginM` | `listen.js` | 8 米 | 另一条旅程要近多少才切换 |
| `LISTEN_CONFIG.resyncSeconds` | `listen.js` | 12 秒 | 播放与位置相差多少时重新对齐 |
| `LISTEN_CONFIG.cooldownMs` | `listen.js` | 45 秒 | 播完的旅程休息多久 |
| `maxAccuracyM`、`stepVarianceM2`、`timeVarianceM2PerS` | `location.js` | 50 / 0.15 / 1.0 | GPS 融合：忽略多差的 GPS、步数和时间带来的不确定性 |
| `MAX_WALK_SECONDS`、`POINT_INTERVAL_MS`、`AUDIO_BITS_PER_SECOND` | `app.js` | 300 秒 / 2 秒 / 32 kbps | 录音时长、轨迹点间隔、码率 |
| `PRIVATE_START_M` | `cloud.js` | 30 米 | 上传时隐去的起点距离 |
| `PREVIEW_SECONDS` | `app.js` | 20 秒 | 广场试听时长 |
| 网格大小 | `soundroute.sql` 的 `get_plaza_cells()` 与 `cloud.js` 的 `PLAZA_CELL` | 0.0018° × 0.0029°（约 200 米） | 两处必须一致 |
| 举报隐藏阈值、每日上限 | `soundroute.sql` | 3 次；30 段旅程 / 20 次举报 | — |

## 11. 已知限制与注意事项

- **永远不要**把 Supabase 的 secret / service_role key 放进代码。前端只用 publishable key（已在 `supabase.js` 里）。
- **免费版 Supabase**：500 MB 数据库、约 1 GB 文件存储、每月 5 GB 流量；**7 天无访问会暂停项目**，展示或答辩前先打开一次。5 分钟录音约 1.2 MB，大约能存 800 段旅程。
- **iPhone 的权限顺序**：运动与方向权限必须由点击直接触发。`startRecordingSession()` 里先请求运动和方向，再请求麦克风，中间不能插入任何等待。
- **iPhone 的音频**：录音时，播放声音可能从听筒出来、音量很小，测试时要戴耳机。开始录音会打断 Web Audio 输出，代码会自动恢复（`ListenPlayer.resume()`）。
- **匿名身份**：Safari 网页长期不访问可能会清除数据（含匿名身份），所以引导用户添加到主屏幕或绑定邮箱。在新设备用邮箱登录时，该设备上匿名录的旅程不会合并过去（页面会先警告）。
- **短旅程的起点**：很短的旅程（不到 90 米）只隐去全程的三分之一，而不是完整的 30 米。
- **城市广场没有底图**，所以看不到街道名称。如果需要，可以加 MapLibre 深色底图（需要地图瓦片服务）。
- 没有加 Service Worker，所以没有离线界面；好处是更新后不会被旧缓存卡住。
- 仓库里误提交了 `node_modules`（约 6 万个文件），克隆很慢。可以清理，但会影响作品集主站，要单独处理。
- `/home/claude/yujing949/...` 之类的路径是之前云端会话里的临时副本，与仓库无关。

## 12. 以后可以考虑

- 删除旅程时，如果有人收藏过，提示作者“有 N 人收藏”。
- 管理员页面：不用进 Supabase 后台就能审核举报。
- Drift Mode：把别人的路线“搬”到你当前的位置，不受地点限制地漫游（概念上呼应情境主义）。
- 在广场里显示“最近公开”的旅程列表。
- 合并账号：新设备登录时，把该设备上匿名录的旅程转移过去（需要一个数据库函数）。
