# 测试、调试与发布

> **文档角色**：验证策略、问题定位、CI 和发布操作
> **权威性**：工程流程规范；当前命令以 `package.json` 为准
> **何时阅读**：选择测试、定位确定性/AI/Worker/WebGL 问题、修改 CI 或准备发布时
> **可跳过**：尚未进入验证阶段且测试路径已由相邻用例明确的微小改动
> **相关代码**：`src/**/*.test.ts`、`tests/e2e`、`scripts/run-e2e.mjs`、`.github/workflows`

## 1. 验证层级

### 1.1 纯规则测试

位置：`src/sim/*.test.ts` 与 `src/demo/*.test.ts`，运行环境为 Node.js。

适合：

- 坐标、通行、视线和寻路；
- 命中、伤情、士气和占领纯函数；
- 输入验证；
- 单个 AI 决策条件。

纯规则测试应使用最小输入，避免依赖完整随机地图造成难以解释的失败。

### 1.2 确定性场景测试

使用固定地图或固定 seed，运行多个 tick 后断言事件、检查结果、最终结果和状态哈希。

至少覆盖：

- 相同 setup 的两个模拟逐 tick 或最终哈希一致；
- 终止后继续 `step()` 不改变结果和哈希；
- 延迟情报按观察 tick 和送达 tick 生效；
- 同时交火不受遍历先后影响；
- 模式任务真实推进并以正确原因结束。

AI 回归优先断言事实，例如“进入目标并产生占领进度”，不要绑定每个中间路径点，除非路径本身就是待测规则。

### 1.3 浏览器端到端测试

位置：`tests/e2e/battle.spec.ts`。

真实启动 Vite、Web Worker 和 WebGL，用于验证：

- 运行、暂停、显式步进和会话切换；
- Canvas 非空、地形与关键效果可见；
- 镜头缩放、复位和选中检查；
- 自动导演热点移动、观察上下文重置、纯净模式共存和手动输入接管；
- 桌面与 `390x844` 窄屏不溢出或遮挡；
- 目标区、曳光、移动逻辑弹丸和弹着爆炸等特征像素实际出现；
- 全知与势力视角不会跨观察权限残留检查结果、事件或不可见实体；
- 页面错误和控制台错误为空。

不要仅断言 Canvas 元素存在。Three.js 场景可能在空白或资源失败时仍创建 Canvas。

## 2. 命令

```powershell
npm test
npm run test:watch
npm run build
npm run test:e2e
npm run perf
npm run docs:check
npm run check
npm run verify
```

| 命令 | 内容 | 何时必须运行 |
| --- | --- | --- |
| `npm test` | 全部 Vitest | 任意模拟、类型或规则改动 |
| `npm run build` | `tsc -b` + Vite production | 任意可提交改动 |
| `npm run test:e2e` | Playwright + Worker + WebGL | UI、Worker、协议、渲染改动 |
| `npm run perf` | 生产构建上的固定中型/大型 Playwright 基准 | 性能优化前后、规模验收和发布候选 |
| `npm run docs:check` | 文档头、索引登记和本地链接 | 任意文档改动 |
| `npm run check` | docs:check + test + build | 文档以外的普通提交 |
| `npm run verify` | check + e2e | 跨模块功能、发布和主分支合入 |

纯文档改动至少检查链接、命令和当前实现描述；如果同时修改配置，运行 `npm run build`。

## 3. 固定场景调试

URL 参数：

| 参数 | 示例 | 作用 |
| --- | --- | --- |
| `seed` | `seed=defense-bravo` | 固定地图和战斗随机输入 |
| `scenario` | `scenario=sequence-defense` | 精确选择开发场景；可选值以 `src/demo/scenarios.ts` 为准 |
| `mode` | `mode=defense` | 未指定场景时选择默认 `conflict` 或 `defense` 场景 |
| `autostart` | `autostart=0` | 初始化后保持暂停 |
| `devtools` | `devtools=1` | 在生产预览中显式显示场景实验台 |
| `e2e` | `e2e=1` | 安装测试调试桥 |

示例：

```text
http://localhost:5173/?scenario=sequence-defense&seed=defense-bravo&autostart=0
```

通过 `start.bat` 启动的 Vite 开发服务会自动显示场景实验台。场景切换、seed 应用/随机化和暂停后的 `1/20 tick` 推进都使用标准 setup 与 Worker 调试命令；生产构建默认不显示该入口。

浏览器控制台可在 `e2e=1` 模式下使用：

```js
window.__battleTest?.getTick();
window.__battleTest?.getStateHash();
window.__battleTest?.getObjectives();
window.__battleTest?.step(200);
```

测试桥不保证向后兼容，不得被正式游戏系统调用。

车辆伤害和交战位的固定回归位于 `src/sim/vehicle.test.ts`。纯规则用例固定装甲面、穿透边界、加权部件与完整度状态；场景用例固定未穿透外露损伤、部件/乘员独立结算、弃车和终止冻结，并使用 `simultaneous-438217` 验证两辆平台在同一 tick 先完整生成射击意图，再同时失去武器部件。车辆交战位用例还断言同一直接目标刷新时，在途单格移动的进度与目的格不会回退，并能完成该格。

炮兵实现建立 `src/sim/artillery.test.ts`，固定场景矩阵如下：

| Seed / 场景 | 核心断言 |
| --- | --- |
| `artillery-deploy-001` | 展开/收炮 tick、岗位失效取消、未收炮不移动、未展开不发射，逐 tick 哈希一致 |
| `artillery-direct-002` | 当前直接接触、最小/最大射程、非敌对阻挡、逻辑弹丸至少飞行 1 tick、直射与同 tick 弹着同时结算 |
| `artillery-intel-003` | 相同快照的本地/同势力/同盟来源产生可解释误差；只改变 `observedAt`、来源或置信度时公式分项变化 |
| `artillery-no-leak-004` | 两个场景只改变未发现敌军实时位置/健康/部件，发射前任务、散布、事件和逐 tick 哈希相同；弹着后才允许结果分叉 |
| `artillery-impact-005` | 圆盘边界、地图边缘候选、多人/平台稳定排序、敌对伤害与非敌对免疫、部件/乘员随机键互不串扰 |
| `artillery-finish-006` | 发射方失效后弹丸仍命中；普通终止等待在途弹丸；硬截止进入 `settling`、不再发射且最终结果冻结 |

`ARTILLERY-002/003/004/005` 已落地上述六组模拟回归：覆盖 20 tick 展开、16 tick 收炮、未收炮移动阻断、岗位失效取消、间射阵地保持与近距直接自卫、整数飞行/静态首碰、格线端点 supercover 有限步进、默认炮兵 seed 连续推进及首轮弹着后的最小间距、发射方失效后继续飞行、敌对爆区与非敌对免疫、同 tick 直射先收集、情报来源/送达 tick、任务快照冻结、整数误差/散布、危险近界、隐藏真值负例、多势力非敌对拒绝、冲突/防守长程终止、硬截止 settling 和终止冻结。内容/迁移用例逐字段断言 `content-2` 武器变为单一 `direct` mode、`stage-3.7` 显式升级，并拒绝错误岗位引用、成员间射/展开武器、非法误差、零速度和超界弹道。

`ARTILLERY-005` 已增加真实 Worker/WebGL E2E：固定自行火炮场景中可观察展开状态、自然形成的间射任务、至少一颗非空移动弹丸和弹着效果；势力视角不显示不可见敌方任务或发射事件。测试在暂停状态确认两个逻辑帧间弹丸位置变化，并在逻辑 tick 不变时确认 Canvas 插值仍连续；弹着还检查特征像素，不能只检查事件文本。

`AIR-001/002` 的悬停回归位于 `src/sim/air.test.ts`：覆盖 `stage-3.1/stage-3.8/content-3 -> stage-4.0 -> stage-4.1` 迁移、飞行内容/setup 负例、整数安全半径边界、空地同格与不同高度带共存、同带移动/跨带动作的稳定预约、低空净空、高度动作/中断/效用、传感器与暴露修正、隐藏敌方能力负例、地面占用/目标占领隔离、目标域拒绝、权威高度视线、render/inspection/result 投影、冲突/防守逐 tick 双实例哈希和终止冻结。`AIR-003` 的 `src/sim/air-combat.test.ts` 另覆盖 `stage-4.1/content-4 -> stage-4.2/content-5` 迁移、空地/空空/防空效果、超过旧 11 格上限的模板射程、低/高空三维距离、目标域拒绝、只读接触快照高度效用、低空迫降、中高空坠毁、单次事件、占用/成员守恒、确定性和最终结果。渲染纯函数另验证直升机本地机头轴经模型偏移后对齐模拟前向；`air-recon` 的真实 Worker/WebGL E2E 断言双方飞行平台、低空 `12m` 检查、选中模型特征像素、首次实际位移与权威航向同向、Canvas 非空，以及桌面和 `390 x 844` 视口无运行错误。

`AIR-004` 在 `src/sim/content.test.ts` 与 `src/demo/scenarios.test.ts` 覆盖 `content-5 -> content-6` 迁移、武装直升机/侦察无人机编制、标准空地/空空挂载、无武装无人机、自然开火、连续净空和逐 tick 双实例哈希。`air-operations` 的真实 Worker/WebGL E2E 同时检查三种悬停轮廓、无人机顶部特征像素、任务/武器/弹药 inspection、未发现敌方平台不投影且不能检查、非档位端点的连续世界 Y、质量档切换不改变哈希，以及桌面和 `390 x 844` 无溢出截图。

`ABILITY-001/002/003` 在 `src/sim/ability.test.ts`、`src/sim/active-ability.test.ts`、`src/sim/content.test.ts` 与 `src/demo/scenarios.test.ts` 覆盖 `content-6 -> content-7 -> content-8 -> content-9` 迁移、成员能力引用、条件/触发/目标/效果/范围/叠加/冷却/次数负例、显示名不进哈希、效果值进入哈希、被动派生值、光环半径边界、`stack|strongest`、主动友军效用、稳定事件顺序、隐藏敌情成对负例、终止冻结、结果摘要和逐 tick 双实例复演。`passive-ability`、`aura-ability` 与 `active-ability` 的真实 Worker E2E 检查全知/本方中文解释、主动使用事件、冷却/次数、敌方 inspection 裁剪、观察切换哈希不变，以及桌面和 `390 x 844` 无溢出。

`HERO-001` 的 `src/sim/hero.test.ts`、`src/sim/content.test.ts`、`src/demo/setup.test.ts` 与 `src/demo/scenarios.test.ts` 覆盖 `stage-4/content-9 -> stage-4.1/content-10` 迁移不注入、独立/混编槽位、持久化 ID 与档案负例、规范哈希/深拷贝、实例能力处理器复用、敌方观察裁剪、伤亡/撤离/未部署结果、终止冻结和逐 tick 双实例复演。`hero-showcase` 的真实 Worker/WebGL E2E 检查英雄独立形状像素、持久化 ID/重要度/实例能力、被动/光环/主动解释、敌方档案隐藏、观察切换哈希不变，以及桌面和 `390 x 844` 无溢出。

`DIRECTOR-001` 的 `src/client/director.test.ts` 使用固定帧/事件序列覆盖稳定区域聚合、输入反序一致、过期事件丢弃、观察上下文立即重置，以及最短停留、切换冷却、分数迟滞和距离阈值。真实 Worker/WebGL E2E 在暂停态推进到合法热点后冻结哈希，检查 CameraControls 平滑到达热点、切换势力仍保持合法导演上下文、纯净 UI 在 `390 x 844` 可恢复，以及滚轮立即切回自由镜头；全部客户端操作前后状态哈希一致。

### 批量 seed 重放

`src/sim/generated-invariants.test.ts` 默认运行 12 个稳定 seed，每个 seed 分别验证生成地图的边界/路线/哈希，以及三方交火的逐 tick 哈希、非敌对安全和结果人数守恒。测试名直接包含 seed；失败后可只重放该输入：

```powershell
$env:EPOCHWRIGHT_TEST_SEED="generated-invariant-07"
npm test -- src/sim/generated-invariants.test.ts
Remove-Item Env:EPOCHWRIGHT_TEST_SEED
```

新增批量 seed 时保持名称稳定。失败 seed 必须保留到回归集合或提取为更小的固定场景，不能通过改名或跳过隐藏失败。

## 4. 确定性问题定位

出现相同 seed 不同结果时：

1. 确认 setup 和 `rulesVersion` 完全相同。
2. 在两个模拟上逐 tick 比较 `getStateHash()`，找到第一个分叉 tick。
3. 检查该 tick 新增或修改的集合遍历顺序、随机键和冲突优先级。
4. 检查新权威字段是否遗漏在哈希或克隆中。
5. 检查是否把真实时间、渲染帧率或异步完成顺序带入模拟。
6. 用最小固定地图固化回归测试。

不要通过删除哈希字段或放宽断言掩盖分叉。

## 5. AI 问题定位

1. 固定 seed 和模式，暂停后按较小 tick 批次推进。
2. 使用 `inspect(groupId)` 查看 `decisionReason`、目标、路径、接触和防守阵位。
3. 分清真实敌军位置、直接接触、本地最后已知位置和势力共享情报。
4. 检查决策是否被更高优先级状态永久覆盖，例如高压制、直接接触或撤离。
5. 长程运行到模式结束，确认任务不是只在开局看起来正确。
6. 回归断言任务事实和终止原因。

AI 行为“看起来不聪明”可能是数值问题，也可能是状态机死锁。连续没有任务进度时优先排查逻辑覆盖关系，而不是先调数值。

## 6. Worker 问题定位

- 初始化后没有帧：检查 Worker `error`、setup 验证和会话 ID。
- 切换模式后旧画面闪回：检查消息的 `sessionId` 过滤。
- 暂停仍推进：检查 timer 清理和是否有调试 step 命令。
- 后台回来追赶过多：检查累积时间 250ms 钳制和 4 tick catch-up 上限。
- 页面正常但结果丢失：检查最后一批 pending events 和 `finished` 消息顺序。

协议问题应在真实 Worker E2E 中验证，仅直接调用模拟不能覆盖线程生命周期。

## 7. WebGL 和 UI 问题定位

- 先收集 `pageerror` 与 console error。
- Canvas 检查不透明比例、亮度范围和量化颜色数。
- 曳光、目标圈等使用颜色阈值或局部像素特征，避免整图快照因地形细节频繁变化。
- 动态 Three.js 资源必须 `dispose()`，长时间观察内存是否持续增长。
- UI 检查 bounding box，不只看截图；工具栏、势力卡和目标 HUD 应有明确间隔。
- 镜头位置和显示质量变化后，固定 seed 的状态哈希必须不变。

## 8. 测试选择矩阵

| 改动 | Unit | 场景/确定性 | E2E | 文档 |
| --- | --- | --- | --- | --- |
| 纯数学或局部规则 | 必须 | 视影响 | 否 | 数值语义变化时 |
| AI、情报、伤害、目标、终止 | 必须 | 必须 | 有用户可见行为时 | 必须 |
| `BattleSetup` / `BattleResult` | 必须 | 必须 | 接入变化时 | 必须 |
| Worker 协议或节拍 | 视情况 | 必须 | 必须 | 必须 |
| Three.js 表现 | 否 | 哈希不变 | 必须 | 重要表现规范时 |
| React UI / 响应式 | 否 | 否 | 必须 | 操作变化时 |
| 性能优化 | 必须 | 哈希对比 | 性能/视觉相关时 | 记录基准 |
| 纯文档 | 否 | 否 | 否 | 检查链接与事实 |

## 9. 性能基线

`npm run perf` 在 `4174` 端口启动生产预览，依次运行固定的 `medium` 和 `large` 场景。可用 `$env:PERF_PROFILE='medium'` 或 `large` 只运行一个档位。每个场景暂停启动，每 2 tick 推进一次并等待两个 RAF，共采集 120 tick；第二个会话一次性重放相同 tick 数并断言最终哈希一致。输出中的 `PERF_RESULT` 是可机器读取的单行 JSON。

开发服务或带 `devtools=1` 的显式入口提供性能诊断开关；`profile=medium|large` 会自动打开对应预算面板，`performance=1` 只开启采样而不改变演示规模。面板状态依次区分无样本、采样中、预算内和超预算，预算阈值与 `src/performance/budget.ts` 同源；重置只清空客户端和 Worker 的非权威采样，不重开战斗。帧投影 P95/P99 继续显示，但当前设备预算只约束初始化、tick P99、RAF P99 和常规帧消息 P99。

固定场景：

| 档位 | seed | 地图 | 编组 | 成员 |
| --- | --- | --- | --- | --- |
| 中型 | `perf-medium-stage-2` | `256 x 256` | 75 | 600 |
| 大型 | `perf-large-stage-2` | `512 x 512` | 252 | 2016 |

参考设备为 Windows 11 Pro `10.0.26200`、Intel Core i5-14600KF、20 逻辑处理器、31.8 GiB 内存、NVIDIA GeForce RTX 4070 Ti SUPER、Microsoft Edge `150.0.4078.99`，视口 `1440 x 900`。`stage-3.4` 在 `2026-07-28` 的 headless 生产构建基线如下；时间单位为毫秒，消息体积按数值、布尔值、TypedArray buffer 及 UTF-8 字段名/字符串估算，不含浏览器结构化克隆对象头：

| 档位 | 初始化 | tick P95 / P99 | 投影 P99 | 常规帧消息 | RAF P95 / P99 | 主页面堆增长 | 120 tick 哈希 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 中型 | 158.0 | 2.3 / 4.1 | 1.1 | 91,155 B | 16.9 / 17.0 | 1.91 MiB | `156fb33a` |
| 大型 | 848.3 | 22.6 / 34.5 | 1.4 | 306,564 B | 16.9 / 33.3 | 3.06 MiB | `c4f37e45` |

`stage-3.5` 的车辆在途移动修复已在 `2026-07-29` 重放相同固定输入并通过：中型 120 tick 哈希为 `5e242514`，大型为 `95bc9d4c`。该次运行不在参考设备上，因此不使用其耗时数据替换上述预算基线。

`ARTILLERY-005` 在 `2026-07-30` 以 Microsoft Edge `150.0.4078.105` 和 ANGLE Intel Iris Xe Graphics 重放通过。中型/大型 tick P99 为 `4.5 ms`/`42.8 ms`，投影 P99 均为 `1.6 ms`，RAF P99 为 `17.2 ms`/`17.0 ms`，主页面堆增长为 `1.90 MiB`/`2.77 MiB`，120 tick 哈希为 `3940bb2c`/`4bae4639`。常规帧为 `91,178 B`/`306,587 B`，相对参考基线各增加 `23 B`，来自空 `projectiles` 投影和帧阶段字段；两档均满足现有预算。该环境与参考设备 GPU 不同，耗时只作为本次验收记录，不替换参考基线。

`AIR-004/content-6` 在 `2026-07-31` 以 Microsoft Edge `150.0.4078.105` 和 ANGLE Intel Iris Xe Graphics 再次重放通过，双会话 120 tick 哈希为 `05edd921`/`1a2e6c85`。常规帧仍为 `91,178 B`/`306,587 B`，说明新增默认模板没有进入运行时帧载荷；中型/大型 tick P99 为 `5.6 ms`/`89.3 ms`，投影 P99 为 `1.0 ms`/`2.0 ms`，RAF P99 为 `35.8 ms`/`54.7 ms`，主页面堆增长约 `1.30 MiB`/`2.80 MiB`。本次中型 RAF 与大型 tick/RAF 超过下表预算，延续同一非参考设备上已记录的大型抖动；由于固定性能场景不生成空军实体且消息体积不变，此记录验证内容升级与重放一致性，不把耗时归因于 AIR-004，也不替换参考设备基线。发布前仍需在参考设备复测。

设备验收预算：

| 指标 | 中型标准档 | 大型高负载档 |
| --- | ---: | ---: |
| 初始化 | 不超过 2 s | 不超过 5 s |
| tick P99 | 不超过 25 ms | 不超过 50 ms，保持 20Hz 模拟余量 |
| RAF P99 | 不超过 20 ms，目标 60 FPS | 不超过 33.3 ms，允许 30 FPS 表现 |
| 常规帧消息 P99 | 不超过 128 KiB | 不超过 384 KiB |
| 120 tick 主页面堆增长 | 不超过 16 MiB | 不超过 32 MiB |

大型档超过表现、消息或主页面内存预算但 tick 仍合格时，按 `WEB-001` 的低质量档依次降低 DPR、关闭阴影、减少非权威曳光/粒子和装饰物，并保持单位、权威静态对象与模拟规则不变。若 tick P99 超过 50 ms，表现降级不能解决模拟瓶颈：不得降低模拟 Hz 或停止离屏战斗，应阻止该设备自动进入大型档并先优化感知、寻路或空间查询。当前低/中/高质量档已实现 DPR、阴影和非权威曳光降级；低于预算的设备仍暂不承诺大型体验。

浏览器 `performance.memory` 只作为 GC 后主页面 JS 堆趋势，不覆盖 Dedicated Worker 独立堆；长时间运行和 Worker 总内存仍是后续发布采样项。基准不是 CI 默认步骤，不能用不同设备的一次波动直接修改预算；性能改动需在同一设备、浏览器和 seed 上比较，并保存前后 `PERF_RESULT`。

## 10. CI

`.github/workflows/ci.yml` 在 push 和 Pull Request 上执行：

1. Node.js 22 + `npm ci`；
2. 安装 Playwright Chromium；
3. `npm run verify`。

本地 Playwright 默认使用系统 Microsoft Edge，CI 使用 Chromium。测试不能依赖仅某一浏览器通道存在的私有行为。

CI 失败时不得只重新运行直到偶然通过。先用相同 seed 和测试名称本地复现；需要重试的网络或资源步骤应与确定性战斗断言分开。

## 11. 发布检查表

### 代码与规则

- [ ] `npm ci` 在干净环境成功。
- [ ] `npm run verify` 全部通过。
- [ ] schema/rules 版本与行为变更匹配。
- [ ] 固定基准场景的哈希变化已解释。
- [ ] 最终结果包含外部系统需要的稳定 ID 和状态。

### 体验

- [ ] 冲突和防守模式各手动观察至少一个完整战斗。
- [ ] 暂停、重开、模式切换、自由镜头和选择可用。
- [ ] 桌面与窄屏无文字溢出和面板遮挡。
- [ ] Canvas、目标区、单位、曳光和结果提示可见。
- [ ] 浏览器控制台无错误。

### 文档与交付

- [ ] `docs/09-implementation-status.md` 已更新。
- [ ] 新契约、命令和迁移步骤已记录。
- [ ] 已知限制和非阻塞警告已记录。
- [ ] 未提交生成目录、测试产物、日志或本地配置。
- [ ] 发布提交能够从 lockfile 重建。

## 12. 当前非阻塞警告

生产构建目前会提示主前端包超过 500KB。它不影响当前垂直切片正确性，但在城市建造界面和更多战场资产接入前，应按场景或路由做代码拆分并建立加载性能预算。

`2026-07-30` 当前 Intel Iris Xe / Edge `150.0.4078.105` 环境的大型档重放保持固定哈希 `4bae4639`，但一次无开发服务基准的 tick P99 为 `88.8 ms`、RAF P99 为 `100 ms`，超过大型档预算；中型档和 Worker 消息体积仍在预算内。该结果不替换参考设备基线，发布前应在参考设备复测并继续排查规模场景的模拟/渲染负载。
