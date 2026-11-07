# SoundRoute Blue：页面、交互与动效规格

这份文档用于把 Blue 画布实现到 `soundtrack/`。画布地址：https://claude.ai/artifact/Ek4qm3GXiRxHM87qrEbj3G （Blue 页，第 122 版）。

阅读约定：

- 页面名就是画布上的画板文件名，例如 `BlueCity` 对应 `project/BlueCity.dc.html`。像素值按 390×844 的 iPhone 画板计算。
- 界面文字保持英文，写在 `代码格式` 里；说明文字用中文。
- “画布里”指原型中写死的跳转，“实现时”指真实应用里应有的行为。两者不同时，以“实现时”为准。
- 行为规则（距离、时长、隐私）以 `SOUNDROUTE.md` §3、§4、§10 为准，本文只写它们在界面上怎样体现。

---

## 0. 设计逻辑（为什么这样设计）

1. **听觉优先，地图退后。** 产品的核心是走路时“听到”声音，不是看地图。所以主视觉是一颗蓝色光球（声音本身），不是街道地图；路线只用白色虚线示意走向，不显示街名。
2. **一屏一个主角。** 每屏只有一个视觉重心（光球、路线、卡片或弹窗），其余元素安静：黑色文字、灰色说明、半透明面板。
3. **颜色有固定含义。**
   - 蓝 `#0030FF`：声音和“我”。
   - 黑：可以点的主操作。
   - 灰 `#4F6470`：说明文字。
   - 橙 `#FF7B04`：只在 Journey 里出现，表示“正在录音”的话筒圈和“被选中的别人的旅程”。City 和 My map 都不用橙色。
4. **动效只回应用户。** 背景光晕缓慢漂移，让画面有呼吸感；其余动效都由用户操作触发。全应用只有一个编排好的时刻：走完后路线被画出来（见 `BlueEnding`）。
5. **隐私写进视觉。** City 不显示区域名；路线经过平滑和裁剪；起点 30 米不存储；“我”只用一个黑点表示。

---

## 1. 全局规范

### 1.1 尺寸规范（所有页面共用）

| 项目 | 值 |
|---|---|
| 字体 | Open Sans 300（标题）/ 400（正文和按钮），从 Google Fonts 加载。不要换字体 |
| 字号/行高 | 13/18 说明；16/22 次要文字和链接；18/24 正文和按钮；31/39 卡片、弹窗标题、旅程详情面板里的旅程名；46/59 页面大标题（字距 -1.4px） |
| 按钮高度 | 69 主按钮（Save、录音、心形、Next）；56 次要按钮、输入框、列表行；44 小按钮（Copy、下载、账号） |
| 圆角 | 按钮和输入框全圆；卡片 34；面板、底部弹窗、对话框 42 |
| 左边距 | 页面大标题 x 28；正文 x 30（视觉对齐）；面板、弹窗、卡片内容 x 38 |
| 右上角文字链接 | top 36，高 44，右对齐到 x 364，16px |
| 返回箭头 | left 22，top 781，热区 56×48，32×20 细线箭头 |
| 底部导航 | 250×75，left 67，top 757，底色 `#DEEBF0`；当前页按钮为黑底白图标（95×63） |
| Toast | 黑色胶囊，310×56，left 40，top 676，白字 16px，左侧带对勾 |

画布上的检查脚本：`design/blue-scale.py`（尺寸规范）、`design/blue-polish.py`（对齐规则）。

### 1.2 颜色和材质

| 名称 | 值 | 用在哪里 |
|---|---|---|
| 页面底 | `#FFFFFF` | 所有页面 |
| 光晕 | radial-gradient，`rgba(116,168,255,.95)` 渐变到透明 | 背景漂移光斑 |
| 光球 | `#0030FF` 中心，经 `#3C78FF`、`#72AAFF` 到透明 | Journey 主视觉 |
| 左侧面板 | `rgba(192,215,225,.4)` + `backdrop-filter: blur(14px)`，圆角 42 | 旅程详情（Mine、Other、MyWalk） |
| 底部弹窗/对话框 | `rgba(222,234,241,.94)` + `blur(18px)`，圆角 42 | Report、Add a walk、Discard、Delete |
| 遮罩 | `rgba(240,246,255,.55)` | 对话框后面 |
| 输入框 | `rgba(255,255,255,.72)`，出错时内描边 1.5px 黑 | 分享码、邮箱、验证码 |
| 光标 | 2px `#0030FF`，1.05 秒闪烁 | 输入框 |
| 说明灰 | `#4F6470` | 13px 说明、占位文字 |

### 1.3 共用组件

- **主按钮**：黑底白字胶囊，高 69 或 56。按下时缩到 0.97，150ms。
- **次按钮**：透明底，内描边 1.2px 黑。
- **圆形图标按钮**：69（心形、播放、录音）或 56（卡片上的播放）、44（下载、账号）。
- **左侧面板**：旅程详情固定在左边，宽约 184，从 top 8 到 bottom 8。面板里依次放旅程名（31/39，最多 3 行，超出用省略号；2026-11-07 从 46px 改小）、紧跟其后的作者或改名笔、时间/地点/时长（固定位置，和光球上下居中）、分享区，底部放返回箭头。面板里的文字只跟着光球上下居中，不跟着左右移动，宽屏时也留在面板内。光球和路线从面板后面穿过，面板半透明，能看到后面的蓝色。
- **卡片轮播**（City、My map）：卡片宽 250，高约 170，圆角 34，间距 12，横向滑动，右侧露出下一张的开头。卡片里依次是 13px 元信息、31px 标题（单行省略）、56 播放按钮。下方小圆点表示页数。
- **分段切换**（My map 的 `Mine 3` / `Saved 4`）：白色半透明胶囊，选中项为黑底。
- **底部弹窗**：从下方升起，左右各留 9，圆角 42，内容 x 38。
- **对话框**：居中偏上（top 290），宽 350，padding 30/18/18；两个按钮等宽，左侧次按钮（保留），右侧黑色主按钮（危险操作）。
- **系统键盘**：画布里画的键盘只是示意，实现时用系统键盘。弹窗底边要跟着键盘上移（visualViewport）。

### 1.4 页面关系

```
首次打开
  BlueGuide1 → Guide2 → Guide3 → Guide4 ─┬→ BlueCity
       (Skip 任何一页 → BlueIntro)       ├→ BlueCityCode
                                         └→ BluePermissions → BlueGPS → BlueWalking

Journey（底部导航第 1 项）
  BlueIntro ─ ↑ ─→ BlueWalking ─ ■ ─→ BlueEnding ─→ BlueMine ─ Save ─→ BlueHome
      │                                                 ├ ✎ → BlueRename
      └ Just listen → BlueListening                    └ Discard → BlueDiscard
  BlueHome / BlueMine 上点路线上的白点 → BlueOther ─ Report → BlueReport → BlueReportSent

City（第 2 项）
  BlueCity ─ 点一片光区 → BlueCityC（卡片轮播）→ 卡片 → BlueOther
      └ Add code → BlueCityCode ─┬ 找到 → BlueCityCodeFound → Save → BlueMyMapSaved
                                 └ 没找到 → BlueCityCodeWrong

My map（第 3 项）
  BlueMyMap（Mine）⇄ BlueMyMapSaved（Saved）；没有旅程时显示 BlueMyMapEmpty
      ├ 卡片 → BlueMyWalk ─ Delete → BlueMyWalkDelete
      └ 账号 → BlueAccount → BlueAccountSent → BlueAccountLinked
```

### 1.5 动效库（所有 keyframes 都在画板的 `<helmet>` 里，可以直接复制）

| 名称 | 时长/曲线 | 做什么 | 用在哪里 |
|---|---|---|---|
| `sr-drift-a/b/c` | 23s / 29s / 17s，ease-in-out，循环 | 背景光斑缓慢平移和明暗变化 | 大多数页面背景 |
| `sr-breathe` + `sr-halo` | 6.5s，cubic-bezier(.45,0,.55,1)，循环 | 光球缩放 1→1.07，外圈光晕同步扩散变淡 | Walking、Listening、Guide1 |
| `sr-in` | 1.1s，cubic-bezier(.2,.7,.2,1) | 光球从 0.35 倍放大并显现 | 进入 Walking |
| `sr-fade`（Walking） | 1.2s，前 40% 不动 | 底部控制条在光球之后上浮出现 | Walking |
| `sr-here` | 2.6s，ease-out，循环 | “我”的位置向外扩散的蓝色圆圈 | City、My map |
| `sr-glow` | 17s，循环，各光斑负延迟错开 | City 光区明暗起伏 | City 全部页面 |
| `sr-dim` | 0.5s | 没选中的路线降到 0.3 透明度 | BlueCityC |
| `sr-up` | 0.5s，依次延迟 0.55/0.65/0.75/0.85s | 卡片依次上浮出现 | BlueCityC |
| `sr-rise` | 0.5s，cubic-bezier(.2,.7,.2,1)，上移 80px | 底部弹窗、对话框和 toast 升起 | 弹窗、toast |
| `sr-veil` | 0.35s | 遮罩淡入 | 对话框 |
| `sr-caret` | 1.05s，step-end | 光标闪烁 | 输入框 |
| `sr-seek` | 2.4s，两圈相差 1.2s | 从中心向外扩散的“搜索”波纹 | GPS |
| `sr-shake` | 0.45s | 输入框左右抖动 | 分享码错误 |
| Ending 序列 | 一次性，约 9.4s | 路线绘制，见 `BlueEnding` | 走完后 |

规则：

- 所有循环动效在 `prefers-reduced-motion: reduce` 下停止。各画板已经写好这条媒体查询，实现时照搬。
- 页面切换：同一个 tab 内前进的页面从右侧推入，返回时反向，0.35s。切换 tab 时直接淡入淡出，0.2s。画布里没有画转场，这部分是补充。
- 弹窗关闭：反向播放 `sr-rise`，0.3s。

---

## 2. 逐页规格

每页按同样的顺序写：**目的**、**布局**、**交互**、**状态和数据**、**动效**、**实现备注**。

### 2.1 Journey

#### BlueIntro：开始旅程

- **目的**：Journey 的首页。一眼看到“开始走”，次要入口是只听不录。
- **布局**：
  - 白底，右上和左下两团蓝色光斑。
  - 大标题 `Start your journey` 放在左下（这是你原图的位置，不按 x 28 规范）。
  - 右上角 `Just listen` 按钮（2026-11-07 改）：44 高的胶囊，右对齐到 x 364，top 36。材质和本页导航一样：`rgba(255,255,255,.5)` + 内描边 1px `rgba(255,255,255,.6)` + `blur(14px)`。左边是 19px 的耳机图标，间距 8，文字 16px 400 黑。按下缩到 0.97，150ms。只有文字时看起来像标语，所以加了底色。
  - 底部导航把 ↑ 开始按钮和 Journey 图标合成一个黑色连体形状，左边是 ↑，右边是 Journey。
- **交互**：
  - 点 ↑ 或点标题：开始一段旅程。第一次用时先进 `BluePermissions`；权限都给过就直接进 `BlueGPS`；已经定位到就直接进 `BlueWalking`。
  - 点 `Just listen`：进 `BlueListening`，只播放 My map 里的旅程，不录音。
  - 点 City、My map 图标：切换 tab。
- **状态和数据**：
  - 如果有未上传完的旅程（cloud = `failed`），在标题上方加一行 13px 灰字 `1 walk waiting to upload`，点它重试。这是补充，画布里没画。
- **动效**：背景 `sr-drift`。按下 ↑ 时，连体形状里的 ↑ 先放大，再淡出成光球，衔接 Walking 的 `sr-in`。这是补充建议。
- **实现备注**：↑ 必须直接由点击触发 `startRecordingSession()`。iPhone 的运动权限只能在点击事件里同步请求，中间不能有任何等待。

#### BlueWalking：正在走、正在录

- **目的**：录音中。画面上几乎什么都没有，只有声音（光球）。
- **布局**：
  - 光球居中，248px，外圈光晕 330px。
  - 底部黑色胶囊（152×69）：左边是带橙色圆圈的话筒，表示“正在录音”；右边是 ■ 结束。
- **交互**：
  - 点话筒：暂停或继续录音（aria-label `Recording, tap to stop recording`）。暂停时橙色圆圈变灰，光球停止呼吸。
  - 点 ■：结束这段旅程，进 `BlueEnding`。
  - 录到 5 分钟（`MAX_WALK_SECONDS` = 300）自动结束，同样进 `BlueEnding`。
- **状态和数据**：
  - 走路时，My map 里附近的旅程会播放（规则见 SOUNDROUTE.md §4“收听”）。光球的大小和亮度可以跟随当前播放的音量变化，比如在呼吸动画上叠加一个 0.95–1.1 的缩放。这是建议。
  - 已定（补充，画布里没画）：话筒外圈用橙色进度弧表示 5 分钟进度（0→360°），不加数字。
- **动效**：进入时光球 `sr-in` 1.1s，然后 `sr-breathe` 循环；控制条 `sr-fade` 晚一点出现。
- **实现备注**：录音期间保持屏幕常亮（Wake Lock）。开始录音会打断 Web Audio，需要调用 `ListenPlayer.resume()`。

#### BlueEnding：走完，画出路线（全应用唯一的编排动效）

- **目的**：把刚才的旅程变成一条看得见的路线，作为完成时刻。
- **时间轴**（画布里 12.5 秒一个循环，实现时只播一次，停在最后一帧，也就是 `BlueMine`）：

| 时间 | 发生什么 |
|---|---|
| 0.7–1.4s | 底部控制条下沉 12px 并淡出 |
| 0.9–2.3s | 背景光斑淡出 |
| 0.9–2.7s | 光球从 0.7 倍放大到 1 倍 |
| 2.7–6.3s | 白色虚线路线从起点画到终点（stroke-dashoffset 1→0，线性） |
| 2.65 / 4.0 / 4.8 / 5.35 / 6.25s | 路线上的 5 个点依次从 0.2 倍弹到 1 倍（起点实心白，其余半透明白） |
| 6.4–7.1s | 经过的别人的路线（细虚线）淡入 |
| 6.6–7.2s | 左侧面板从左边 22px 滑入，同时从 0.97 倍放大到 1 倍 |
| 7.25–9.4s | 面板里的文字依次上浮：标题、改名笔、时间地点、时长、右上角 `Discard` 和 `Save` |

- **交互**：点屏幕任意位置跳过动画，直接到最后一帧（画布里是一个全屏链接 `Skip to walk details`）。
- **实现备注**：
  - 路线的形状来自真实轨迹点（`nodes` 的 x/y）。先裁掉开头 30 米（`PRIVATE_START_M`），再平滑，然后缩放到光球范围内（直径约 330）。
  - 5 个点不是轨迹点，而是“经过别人旅程”的位置。如果没有经过别人的旅程，就只画起点和终点。

#### BlueMine：刚录完的旅程详情

- **目的**：给刚录的旅程起名、保存或丢弃。
- **布局**：
  - 左侧面板：`New Walk`（31px）、蓝色改名笔、`8 PM / Vauxhall street / London`、`5 mins`、返回箭头。
  - 右边是光球和路线。
  - 右上角 `Discard`，右下黑色 `Save`（69 高）。
- **交互**：
  - 点 `Save`：存到本机（IndexedDB）再上传，然后进 `BlueHome`。上传是后台进行的，不阻塞界面。
  - 点改名笔或标题：进 `BlueRename`。
  - 点 `Discard`：弹出 `BlueDiscard` 对话框。
  - 点路线上半透明的白点（别人的旅程）：这个点变成橙色，进 `BlueOther`。
  - 点返回：等同于 Save。补充建议：不要直接丢掉录音。
- **状态和数据**：
  - 地点用反向地理编码得到街道名和城市。如果拿不到，显示时间和时长即可。
  - 时间格式：当天显示 `8 PM`，更早显示 `Oct 28`。
- **动效**：无循环动效，只有从 Ending 衔接过来的最后一帧。

#### BlueRename：改名

- **布局**：面板里的标题变成可编辑状态：31px 文字（最多 5 行，40 个字）、蓝色光标、下方 1px 黑线；线下是 13px 提示 `Name it after what you heard` / `Up to 40 characters`。右上角的 `Discard` 换成 `Done`。系统键盘升起。
- **交互**：
  - 键盘上的 `done`，或右上角 `Done`：保存名字，回到 `BlueMine` 或 `BlueMyWalk`（从哪里来回哪里去）。
  - 名字为空时 `Done` 不可点，恢复原名。
  - 最长 40 个字符。
- **实现备注**：用真实的 `<input>`（字号 46，font-weight 300，无边框，底部 1px 黑线）。名字太长、超过面板宽度时会换行，最多 3 行。

#### BlueDiscard：确认丢弃

- **布局**：在 BlueMine 上加遮罩，对话框 `Discard this walk?`，说明 `The recording and the route will be deleted from this phone. This can’t be undone.`，按钮 `Keep` 和 `Discard`。
- **交互**：
  - `Keep`：关闭对话框。
  - `Discard`：删除本地录音，回到 `BlueIntro`。
  - 点遮罩：等同于 `Keep`。
- **动效**：`sr-veil` + `sr-rise`。

#### BlueHome：保存后的总览

- **目的**：保存后回到 Journey，显示刚存好的旅程。这是你的原图。
- **布局**：左上 `New Walk`（这里应该显示已保存的名字），中间光球加路线，底部导航选中 Journey。
- **交互**：
  - 点标题：进这段旅程的详情（`BlueMine`；保存后实现时应进 `BlueMyWalk`）。
  - 点路线上的白点：进 `BlueOther`。
  - 已定（补充，画布里没画）：标题下方放一个 44 的圆形 ↑ 按钮作为“再走一段”入口（`aria-label="Walk again"`），点它回到开始流程。点光球中心也能触发，作为快捷方式。
- **状态和数据**：上传中、上传失败要有提示。补充建议：在标题下方用 13px 灰字显示 `Saving…`，失败时显示 `Not uploaded yet. Tap to retry`。

#### BlueOther：别人的旅程（在路线上被选中）

- **布局**：
  - 左侧面板：`Forest Walk`、作者 `Anonymous`（头像 + 13px）、`Evening / Near Vauxhall, / London`、`2 mins`。
  - 光球上被选中的点是橙色。
  - 右上角 `Report`，右下黑色心形按钮（69）。
- **交互**：
  - 点心形：收藏到 My map。心形变成实心，并出现 toast `Saved to My map`。再点一次取消收藏。这条 toast 是补充，画布里没画。
  - 点 `Report`：进 `BlueReport`。
  - 点返回：回到来源页。
  - 点播放：补充，画布里没有播放按钮。建议点橙色的点试听 20 秒（`PREVIEW_SECONDS`）。试听时点的外圈用 `sr-here` 扩散。
- **状态和数据**：别人旅程的地点只显示模糊的区域（`Near Vauxhall`），时间只显示时段（`Evening`），不显示具体时刻。

#### BlueListening：只听不录

- **布局**：
  - 左上 `Forest Walk`（31px，目前正在听的旅程名）和 13px 说明 `A walk you saved, recorded in the evening`。
  - 中间光球。
  - 下方居中两行提示 `Turn toward the sound / to hear it more clearly`。
  - 底部黑色胶囊：左边耳机图标，右边 ■。
- **交互**：
  - ■：停止收听，回 `BlueIntro`。
  - 标题跟随当前播放的旅程变化。旅程切换时，旧名字淡出、新名字淡入（0.4s），和音频的交叉淡化同步。
- **状态**：
  - 附近没有旅程时：标题位置显示 `Nothing nearby yet`，说明改成 `Walk toward a walk on your map`。光球缩小到 0.8 倍并变淡。这是补充。
  - My map 是空的：直接进 `BlueMyMapEmpty`。
- **动效**：`sr-breathe` + `sr-halo`。光球的亮度可以跟随音量。
- **实现备注**：需要定位和运动权限，不需要麦克风权限。权限流程复用 `BluePermissions`，但只列两项。

### 2.2 City

#### BlueCity：城市广场浏览

- **目的**：看看附近有多少公开的旅程，挑一片区域去听。
- **布局**：
  - 大标题 `City`，下方 16px `128 walks nearby`，右上角 `Add code`。
  - 背景是蓝白渐变的光区：越蓝表示这里的声音路线越多。
  - 白色虚线（1px，0.72 透明度，虚线 3.4/2.6）是不同的路线。
  - 黑点加白边是“我”，外圈 `sr-here` 扩散。
  - 不显示任何区域名或街道名。
- **交互**：
  - 点一片光区：进 `BlueCityC`（这片区域的旅程）。热区是光区中心直径 220 的圆。
  - 双指缩放和拖动地图：补充，画布里没画。
  - `Add code`：进 `BlueCityCode`。
- **状态和数据**：
  - 光区来自 `get_plaza_cells()`，约 200 米一格。光区的大小和蓝度按格子里的旅程数映射。
  - 路线来自公开且未隐藏的旅程，经过平滑、裁掉起点后，只在光区内画一段。
  - 补充：附近没有公开旅程时，在“我”的位置下方显示 `No public walks nearby yet` 和链接 `Add one with a code`。
  - 补充：没有定位权限时，把“我”的位置去掉，地图以最近一次已知的位置为中心。
- **动效**：光区 `sr-glow` 17 秒，各光区错开起伏；“我”的位置 `sr-here`。

#### BlueCityC：一片区域里的旅程

- **布局**：
  - 被选中的路线：白色 4.6px 虚线（5/3），不发光。
  - 区域里其余路线：2px，0.5 透明度。
  - 区域外的元素用 `sr-dim` 降到 0.3。
  - 下方 18px `7 walks here`，卡片轮播，页码点。
  - 左下返回箭头，没有底部导航。
- **交互**：
  - 左右滑动卡片：地图上加粗的路线跟着换成当前卡片对应的路线（0.3s 过渡，粗细和透明度同时变化）。
  - 点路线：轮播滚到对应的卡片。
  - 点卡片上的播放按钮：在当前页试听 20 秒。播放时按钮变成 ■，卡片元信息前的小圆点变成蓝色并 `sr-here` 扩散。这是补充，画布里点播放会跳到 BlueOther。
  - 点卡片其他地方：进这条旅程的详情（`BlueOther`）。
  - 返回：回 `BlueCity`，路线恢复原样。
- **动效**：卡片依次 `sr-up`（延迟 0.55–0.85s），其余路线 `sr-dim`。
- **设计决定**（已确认）：City 不用橙色；选中只靠“加粗、变白”，不发光；没选中的变淡；卡片没有橙色边框。

#### BlueCityCode：用分享码添加

- **布局**：
  - 底部弹窗 `Add a walk`。
  - 同一行：输入框（216 宽）和 `Add walk` 按钮（108 宽）。
  - 下方通栏提示 `Codes look like misty-parrot-0417. A walk added by code stays private to you.`
  - 右上角 `Add code` 变成 `Cancel`。键盘自动弹出。
- **交互**：
  - 输入时自动转成小写，空格转成 `-`。
  - 按 `Add walk` 或键盘的 `go`：查询。查询中按钮里显示一个小转圈，按钮宽度不变。
  - 找到：进 `BlueCityCodeFound`。
  - 没找到：进 `BlueCityCodeWrong`。
  - `Cancel` 或点弹窗外：关闭。
- **实现备注**：输入框设置 `autocapitalize="none" autocorrect="off" spellcheck="false" enterkeyhint="go"`。从 `BlueGuide4` 进来时直接打开这个弹窗。支持从链接带入分享码（比如 `?code=misty-parrot-0417`）。这一条是补充建议。

#### BlueCityCodeWrong：分享码不存在

- **差别**：输入框加 1.5px 黑色内描边，并 `sr-shake` 一次；提示换成黑色 `No walk has this code. Check the spelling and try again.`
- **交互**：用户一开始修改输入，就恢复成普通状态。
- **补充**：网络失败要和“没找到”分开。网络失败时提示 `Couldn’t check the code. Check your connection and try again.`

#### BlueCityCodeFound：找到了

- **布局**：
  - 弹窗换成旅程卡片：13px `🔒 Shared with you, 4 mins`、31px `Canal at dusk`、13px 灰色分享码、56 播放按钮、黑色 `♡ Save to My map`。
  - 地图上用白色粗线显示这条路线的大致位置；如果路线不在附近，地图移动过去。
  - 卡片上方的“我”变成灰色，表示当前看的不是我附近。
- **交互**：
  - 播放：试听 20 秒。
  - `Save to My map`：收藏，进 `BlueMyMapSaved`，并显示 toast `Saved to My map`。
  - 返回：回 `BlueCity`。
- **状态和数据**：用分享码加的旅程对我是私密的，不会因此变成公开。如果已经收藏过，按钮换成 `On your map ✓`，并且不可点。

#### BlueReport：举报

- **布局**：
  - 在 BlueOther 上升起底部弹窗 `Report this walk`。
  - 说明 `After three people report it, the walk is hidden until it’s reviewed. The walker isn’t told who reported it.`
  - 4 个单选行，每行 56 高，有分隔线：`Offensive or hateful`、`Records a private conversation`、`Spam, or not really a walk`、`Something else`。
  - 底部左边文字按钮 `Cancel`，右边黑色 `Send report`。
- **交互**：
  - 没选理由时 `Send report` 是禁用的（0.3 透明度）。
  - 发送：写入 `reports` 表，进 `BlueReportSent`。
  - 同一个人重复举报同一条旅程：直接显示已举报的状态。
  - 达到每日上限（20 次）：提示 `You’ve sent a lot of reports today. Try again tomorrow.`

#### BlueReportSent：举报已发送

- **布局**：弹窗收起；右上角 `Report` 变成灰色、不可点的 `Reported`；toast `Report sent. We’ll review it.`
- **动效**：toast 延迟 0.3s 后 `sr-rise` 升起，停 3 秒，再淡出。

### 2.3 My map

#### BlueMyMap：我的旅程

- **布局**：
  - 大标题 `My map`，下方 `3 of your walks, 4 saved`，右上角账号按钮（44）。
  - 地图上显示我所有旅程的路线；当前卡片对应的路线是 4.6px 白色，其余 2px、0.5 透明度。
  - 下方分段切换 `Mine 3` / `Saved 4`，卡片轮播，底部导航。
- **卡片内容**：元信息（`Today, 5 mins`）、标题、左下角状态（🔒 `Private` 或 🌐 `Public`）、播放按钮。
- **交互**：
  - 滑动卡片：地图上的路线同步高亮，和 City 规则相同。
  - 点卡片：进 `BlueMyWalk`。
  - 点播放：进 `BlueListening`，从头播放这段旅程（坐着也能听，不需要走到那里）。补充：也可以就在卡片上播放。
  - 点 `Saved 4`：切到 `BlueMyMapSaved`。
  - 账号按钮：进 `BlueAccount`。
- **状态**：
  - 上传中的旅程：左下角显示 `Uploading…`。
  - 上传失败：显示 `Not uploaded · Retry`，点 Retry 重新上传。
  - 两类都没有：显示 `BlueMyMapEmpty`。

#### BlueMyMapSaved：收藏的旅程

- **和 Mine 的差别**：卡片左下角是实心的黑色心形按钮（aria-label `Remove … from My map`）。分享码加的旅程元信息写 `Shared with you, 3 mins`。
- **交互**：
  - 点心形：取消收藏。卡片缩小淡出（0.3s），后面的卡片补位，toast `Removed from My map`，并带 `Undo`。补充：toast 带 Undo，5 秒内可撤销。
  - 点卡片：进 `BlueOther`。
- **状态**：作者删除了旅程，收藏也会消失（数据库级联删除），不需要额外提示。

#### BlueMyMapEmpty：空状态

- **布局**：
  - 标题 `My map`，中间是灰色的“我”。
  - 31px `Nothing here yet`，说明 `Record a walk, or save one from the City. Only walks on your map play while you walk.`
  - 按钮 `Record a walk`（黑）和 `Open City`（描边）。
- **交互**：`Record a walk` 进开始流程；`Open City` 切到 City tab。

#### BlueMyWalk：我的一段旅程

- **布局**：
  - 左侧面板：`Canal at dusk`、改名笔、`Today, 6 PM / Vauxhall street / London`、`5 mins`。
  - 面板下方是公开开关 `Public`，说明 `Off: only people with the code can add it.`
  - 再下方是 `Share code`、`misty-parrot-0417`、黑色 `Copy`（44）和下载按钮（44 圆形）。
  - 右上角 `Delete`，右下黑色播放按钮（69）。
- **交互**：
  - `Public` 开关：打开后出现在 City（模糊位置）。关闭的说明是 `Off: only people with the code can add it.`，打开时换成 `On: shown in the City, near its area`。打开前不需要确认。
  - `Copy`：复制分享码，按钮文字变成 `Copied` 1.5 秒。补充：iPhone 上也可以用 `navigator.share` 分享链接。
  - 下载：下载录音和路线（`.webm`/`.m4a` 加 `.geojson`，或打成 zip）。
  - 光球上的 `Show in City` 按钮：切到 City 并定位到这条路线。只有公开的旅程才显示这个按钮。
  - 改名笔：进 `BlueRename`。
  - 播放：进 `BlueListening`。
  - `Delete`：弹出 `BlueMyWalkDelete`。

#### BlueMyWalkDelete：确认删除

- **对话框**：`Delete this walk?`，说明 `It will also disappear from the My map of 2 people who saved it. This can’t be undone.`，按钮 `Keep` 和 `Delete`。
- **数据**：“2 people”是收藏人数。人数为 0 时，说明改成 `The recording and the route will be deleted. This can’t be undone.`
- **交互**：`Delete` 删除云端和本地的数据，回 `BlueMyMap`，并显示 toast `Walk deleted`。

#### BlueAccount：账号（匿名）

- **布局**：
  - 大标题 `Your account`。
  - 卡片里：灰点和 `Anonymous on this phone`；说明 Safari 可能清除数据；`Email` 标签、输入框、黑色 `Link email`。
  - 卡片下方两行列表：`Sign in with an email you linked before >`、`Add to Home Screen >`。
- **交互**：
  - `Link email`：校验邮箱格式，发送邮件，进 `BlueAccountSent`。格式错误时，输入框加描边，并在下方用黑色 13px 写 `Check the email address`。
  - `Sign in with…`：输入框和按钮变成登录模式，按钮文字改成 `Send sign-in link`。补充：如果这台手机上有匿名旅程，提示 `Walks recorded anonymously on this phone won’t move to that account.`（见 SOUNDROUTE.md §11）。
  - `Add to Home Screen`：打开 `BlueGuide3`（单页说明，返回时回到账号页）。已经从主屏幕打开时，隐藏这一行（用 `display-mode: standalone` 判断）。

#### BlueAccountSent：查收邮件

- **布局**：
  - 卡片里：信封图标、31px `Check your email`、`We sent a link to you@example.com. Open it on this phone, in Safari.`
  - 13px `Or type the 6-digit code from the email`，下面一行是验证码输入框和 `Confirm`。
  - 卡片下方：`You can resend in 0:42. Use a different email`。
- **交互**：
  - 输满 6 位自动提交，`Confirm` 也可以手动提交。
  - 验证码错误：输入框 `sr-shake`，提示 `That code didn’t work. Check the email and try again.`
  - 倒计时结束后，`You can resend in 0:42.` 换成链接 `Resend email`。
  - `Use a different email`：回到 `BlueAccount`，保留已经输入的邮箱。
- **实现备注**：输入框设置 `inputmode="numeric" autocomplete="one-time-code"`，iPhone 会从邮件里自动建议验证码。

#### BlueAccountLinked：已绑定

- **布局**：卡片里：黑色圆形对勾和 `Linked to you@example.com`，说明，描边按钮 `Sign out`；toast `Email linked`。
- **交互**：`Sign out` 先确认（补充：用对话框，样式同 Discard），说明 `Your walks stay with this email. Sign in again to hear them.`，然后回到匿名状态。

### 2.4 首次打开

所有引导页的共同点：右上角 `Skip` 直接进 `BlueIntro`；左下角是页码点（选中的一个是 18×6 的黑色短线）；右下是黑色 `Next`（69 高）。引导只出现一次，看过后记到 localStorage。

#### BlueGuide1：`Hi, this is Parrot.`

- **布局**：
  - 上方光球（`sr-breathe`），带一个白色耳机图标。
  - 标题、18px 正文 `Walk anywhere and record up to 5 minutes…`。
  - 13px 灰色补充 `Put on headphones. In the concept, the phone rides in a parrot on your shoulder.`
- **交互**：
  - `Next`，或在屏幕上向左滑动：下一页。补充：页面之间左右滑动切换。

#### BlueGuide2：`Follow the sound`

- **布局**：
  - 插图是一条粗白路线和细虚线，中间有一个点在 `sr-seek` 扩散，表示“声音从这里淡入”。
  - 正文解释走近就能听到、转身听得更清楚。
  - 灰色补充说明隐私：`Walks are private until you share them. The first 30 m are left out…`

#### BlueGuide3：`Keep your walks`

- **布局**：
  - 上方是 App 图标示意（圆角方形的蓝色光球）和 `SoundRoute`。
  - 正文解释为什么要加到主屏幕。
  - 两个步骤：`1 Tap Share [分享图标]`、`2 Add to Home Screen [+图标]`。
- **交互**：
  - 已经从主屏幕打开的话，跳过这一页。
  - 不是 Safari（比如在微信或 Instagram 的内置浏览器里）时，步骤换成 `Open this page in Safari first`。这是补充。

#### BlueGuide4：`Find something to hear`

- **布局**：正文 `You only hear your own walks and the ones you save…`，然后是三个选项行（69 高，圆角全圆，半透明底，每行一个 18px 标题和一个 13px 副标题）。
- **交互**：
  - `Explore the City` → `BlueCity`。
  - `I have a share code` → `BlueCityCode`。
  - `Record my own walk first` → `BluePermissions`。
  - 这一页没有 `Next`。三个选项就是结束引导的方式。

#### BluePermissions：开始前的权限

- **布局**：
  - 标题 `Before you walk`、说明 `Your phone will ask three times. Allow all three so your walk can be heard later.`
  - 三行，每行图标、18px 标题、13px 说明：`Motion & compass`、`Microphone`、`Location`。
  - 黑色 `Allow and start`。
- **交互**：
  - 点 `Allow and start` 后，在同一次点击里依次请求运动和方向、麦克风、定位。顺序不能改，中间不能插入等待（SOUNDROUTE.md §11）。
  - 每项被允许后，这一行的图标变成黑底白色对勾。补充。
  - 被拒绝：这一行的说明换成黑色 `Turned off. Allow it in Settings › Safari, then come back.`，按钮换成 `Try again`。只拒绝了运动权限时，仍然可以继续：没有朝向数据，音量只按距离计算。
  - 全部允许后进 `BlueGPS`。

#### BlueGPS：寻找定位

- **布局**：中间是蓝色小球，外面两圈 `sr-seek` 波纹交替扩散；标题 `Finding you…`；说明 `Step outside for a moment. Recording starts as soon as GPS finds you.`；返回箭头 = 取消。
- **交互**：
  - 拿到第一个精度够的 GPS 点（精度小于 `maxAccuracyM` 50 米）：小球放大，过渡成 Walking 的光球（衔接 `sr-in`），自动开始录音。
  - 超过 20 秒还没定位到：说明换成 `Still looking. You can start anyway and we’ll place your walk once GPS finds you.`，并出现描边按钮 `Start anyway`，进入没有 GPS 的同一起点模式（SOUNDROUTE.md §3）。补充。
  - 取消：回 `BlueIntro`，同时释放已经打开的麦克风。

---

## 3. 画布里没画、实现时需要的状态

| 情况 | 在哪里 | 建议 |
|---|---|---|
| 页面加载、匿名登录中 | 启动时 | 只显示背景光斑和 `sr-breathe` 光球，不加转圈，不加文字 |
| 离线 | 全局 | 顶部居中出现 13px 灰色胶囊 `Offline. Walks will upload when you’re back.`，录音照常进行 |
| 上传失败 | Home、My map 卡片 | 见 BlueHome 和 BlueMyMap 的状态说明 |
| 录满 5 分钟 | Walking | 自动进 Ending；Mine 页的时长显示 `5 mins` |
| 录音太短（不到 10 秒） | Ending 之前 | 对话框 `Too short to keep`，按钮 `Keep walking` / `Discard`。这是建议，阈值待定 |
| 试听中切换页面 | City | 离开页面时 0.3s 淡出，停止播放 |
| 收藏或取消收藏失败 | Other、Saved | 心形恢复原来的状态，toast `Couldn’t save. Try again.` |
| 旅程被隐藏（被举报 3 次） | 作者的 My map | 卡片左下角写 `Hidden for review`，City 里不显示 |
| 浅色以外的模式 | 全局 | 暂时只做浅色。深色模式时也保持白底，不跟随系统 |

## 4. 已定的问题（2026-11-06，用户选择采用本文默认值）

1. Walking 显示剩余时间：话筒外圈橙色进度弧，不加数字。
2. City 卡片播放：在当前页试听 20 秒，不跳详情页。画布里跳到 BlueOther 的做法只是原型连线。
3. BlueHome“再走一段”：标题下方 44 圆形 ↑ 按钮；点光球中心是快捷方式。
4. Listening 标题保留 31px，让光球做主角。
5. 页面转场用 §1.5 的默认值。
