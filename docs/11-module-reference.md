# 模块参考与数据流

> **文档角色**：当前代码所有权、依赖和数据流参考
> **权威性**：当前架构说明；代码变化后应同步更新
> **何时阅读**：查找状态所有者、首次修改某模块或改动跨越目录边界时
> **可跳过**：目标文件和调用关系已经明确的单文件局部改动
> **相关代码**：`src`、`tests/e2e`、`scripts/run-e2e.mjs`

本文描述当前代码的真实结构。长期目标见 `01-08`，当前完成度见 [实现状态](./09-implementation-status.md)。

## 1. 总体数据流

```text
URL demo controls -> createDemoBattleSetup --+
                                              |
future game systems -> complete BattleSetup --+
                                              v
                                      useBattleWorker
                                              |
                                  initialize(BattleSetup)
                                              |
                                              v
                                      BattleSimulation
                                     step / inspect / result
                                              |
                    +-------------------------+------------------------+
                    |                          |                        |
                    v                          v                        v
               RenderFrame                BattleEvent           BattleResult
                    |                          |                        |
                    +------------- Worker protocol -------------------+
                                              |
                                    +---------+---------+
                                    v                   v
                              Three.js render         React UI
```

主线程可以生成演示输入或接收外部完整输入，但不创建或推进模拟。`battle.worker.ts` 拥有唯一模拟实例，React 只管理会话、选择、镜头和观察界面。

## 2. 依赖分层

| 层 | 目录 | 可以依赖 | 不得依赖 |
| --- | --- | --- | --- |
| 领域核心 | `src/sim` | 纯 TypeScript、封装后的算法库 | React、Three.js、DOM、Worker、真实时间 |
| 演示数据 | `src/demo` | `src/sim` 公共 API | Worker、React、模拟运行时状态 |
| 线程适配 | `src/worker` | `src/sim` 公共 API、协议类型 | React、Three.js、UI 状态 |
| 客户端适配 | `src/client` | Worker 协议、公开领域类型、React | 模拟内部状态和战斗规则 |
| 3D 表现 | `src/render` | `RenderFrame`、事件、地图投影、Three.js | `sim/internal.ts`、权威状态修改 |
| 观察 UI | `src/ui` | 公开投影和检查结果 | 运行时内部状态、战斗结算 |
| 组合层 | `src/App.tsx` | Client、Render、UI | 具体命中或 AI 规则 |

## 3. 标准输入与模拟核心

### `src/demo/setup.ts`

只负责把 seed、规模和演示模式等便利选项生成完整的当前版本 `BattleSetup`，并显式附带默认 `content-1` 内容和编组/成员模板 ID。生成结果在返回前走标准验证器；模块不创建模拟，也不属于外部系统必须依赖的战斗输入契约。

网页演示显式配置三方关系，生成器无参默认仍为两方步枪编组。性能档位也只改写演示生成选项，最终仍向 Worker 发送完整 setup。

### `src/demo/scenarios.ts`

定义只用于开发观察端的稳定场景目录，把三方同盟冲突、双边冲突、单/多目标防守和增援波次转换为 `DemoBattleSetupOptions`。它可以组合公开模式和增援输入，但不创建模拟、不绕过 `validateBattleSetup`，也不属于正式游戏输入协议。

### `src/sim/types.ts`

公共领域契约。包含版本常量、标准地图图层、战斗输入、模式判别联合、渲染帧、事件、检查结果、最终结果和 `BattleSimulation` 接口。

修改时需要检查：

- Worker 结构化克隆是否支持字段类型；
- 所有判别联合消费者是否覆盖新分支；
- schema/rules 版本是否仍成立；
- 外部系统能否通过稳定 ID 对接。

### `src/sim/content.ts`

拥有 `content-1` 默认时代、编组、成员、传感器和步枪模板，以及内容深拷贝、引用/数值/支持能力验证和规范哈希。模板字典按命名空间与稳定 ID 哈希；时代显示名等纯观察字段不影响战斗哈希。当前只接受模拟已经实现的步行、地面目标、单武器成员和即时结算弹道，不能通过内容包提前启用载具、逻辑飞行体或能力脚本。

### `src/sim/internal.ts`

模拟私有运行时状态，包括成员、小队、感知、接触、情报队列、网格/掩体占用、掩体选择黑板与目标状态。此文件不是公共 API。

新增字段通常还需要更新 `runtime.ts` 的初始化、`getStateHash`、结果或检查投影，以及测试。

### `src/sim/setup.ts`

负责迁移、严格验证和哈希完整 `BattleSetup`。`stage-2`/`stage-2.1` 输入会补入等价默认内容和模板 ID；新的 `stage-2.2` 输入缺失内容、模板引用或编制槽位时明确拒绝。地图验证委托给统一的 `validateBattleMap`，出生、撤离、目标和增援入口位置都使用步行通行规则；增援入口必须位于地图边缘，批次的每个撤离路线会从至少一个授权入口经过实际 A* 验证。`hashBattleSetup` 覆盖内容规范哈希和全部静态规则输入。

演示、未来城市/养成系统和持久化加载器都通过相同的 `BattleSetup` 边界接入，并在创建运行时状态前走同一个验证器。

### `src/sim/map.ts`

包含参数化随机高度、山地、开阔水体、湿地和静态对象生成，以及地图验证与哈希、网格索引、步行成本投影、可通行查询、高度查询、视线和距离函数。生成器使用独立 seed 流和稳定候选排序，按全图格数分配可满足的精确配额，并保留两侧部署带与跨图主通道；输入在分配数组前限制为最多 `512 x 512` 总格数和 `4:1` 长宽比。`map-2` 使用嵌套 TypedArray 图层，索引为 `z * width + x`。

地表类型、水深和静态对象是正交权威数据；沼泽由泥地与浅水组合表达。静态对象列表保存稳定 ID、类型、锚格和 8 向朝向，`staticOccupancy` 是按类型 ID 编码并强制逐格核对的稠密投影。树、岩石和墙段阻挡步行与视线；占用者使用掩体时，视线查询只忽略提供该槽位的对象，再由统一掩体效果处理部分暴露。

### `src/sim/cover.ts`

从只读静态对象确定性派生可站立槽位，负责容量与正面/侧面/后方方向效果、基点缩放，以及所有者约束的占用声明和释放。槽位冲突按稳定对象 ID 解决；模块不选择 AI 目标，也不拥有 tick。运行时 `coverOccupancy` 由 `simulation.ts` 维护并进入状态哈希。

### `src/sim/pathfinder.ts`

对 EasyStar.js 的内部封装，提供八方向 A*、禁止斜穿和移动成本。路径网格与实际移动步骤通过同一个地表×水深成本矩阵取值，A* 成本按最低正成本归一化以保持启发式可采纳。调用方可传入派生的动态阻挡格；实现会为该次查询构造包含动态障碍的完整网格，使动态障碍同样参与禁止切角判断。其他模块应依赖 `Pathfinder` 接口，不直接使用 EasyStar API。

未来更换分层寻路或路径缓存时，公共调用方和规则测试可以保持稳定。

### `src/sim/rng.ts`

提供种子随机、可按键推导的确定性整数和状态哈希。模拟随机逻辑必须使用这里的接口或遵循同样的无共享序列原则。

### `src/sim/objective.ts`

目标区占领、争夺和恢复的纯规则。这里不读取地图、AI 或渲染状态，适合直接单元测试和未来数值配置化。

### `src/sim/combat.ts`

无状态战斗规则，包括武器计时、效果数值、命中概率、士气状态转换，以及成员和编组的战斗/在场判定。函数只接收所需的最小状态切片，不拥有 tick、随机或运行时集合；`simulation.ts` 负责按固定管线调用并结算意图。

### `src/sim/ordering.ts`

集中提供字符串、实体、势力、情报消息和接触快照的稳定排序。影响权威结果或哈希的集合必须复用这些显式比较器或提供同等明确的稳定顺序。

### `src/sim/runtime.ts`

拥有规范 `BattleSetup` 的深拷贝，以及成员、编组、占用索引、势力知识、目标和增援运行时状态的确定性初始化。它不推进 tick；初始化后的权威状态仍由 `simulation.ts` 独占和调度。

### `src/sim/simulation.ts`

当前权威调度器，负责：

- 固定顺序的 tick 管线；
- 有限感知与延迟情报；
- 小队 AI、路径和占用；
- 掩体占用生命周期，以及发现/命中的统一方向效果；
- 只消费接触快照的防守/压制掩体评分、选择迟滞和无槽位降级；
- 弹匣、射击意图、伤情与压制；
- 从成员/武器/传感器模板解析射程、射击节奏、伤害、防护、压制和占领能力；
- 士气、溃散和撤离；
- 防守阵位、占领与两种模式终止；
- 增援批次的到达 tick、入口容量、等待/替代/取消策略，以及部署状态结果；
- `getRenderFrame(observerFactionId)` 与 `inspect(..., observerFactionId)` 的全知/势力信息投影；
- 渲染帧、检查结果、最终结果和状态哈希。

完整静态 setup 摘要在模拟初始化时计算一次并进入状态哈希，覆盖地图、部署、模式和规则参数，同时避免 Worker 每次发布帧时重新遍历全部输入。`getSetup()` 返回深拷贝快照，外部不能通过 TypedArray 修改运行时地图。

运行时构造、稳定排序和战斗纯计算已分别委托给 `runtime.ts`、`ordering.ts` 和 `combat.ts`。调度器仍决定调用时机、意图收集与结算顺序，提取模块不能直接推进或持有权威 tick。

静态地图的步行连通分量也在初始化时派生一次，AI 目标会投影到编组当前所在分量，避免把局部可走但隔水不可达的孤岛当作巡逻目标。该缓存由已哈希地图完全派生，不进入权威状态。

已经开始的单格移动在完成前不会被下一轮 AI 目标刷新或射线状态变化取消。编组被静止友军连续阻挡 5 tick 后，会把静止友军占用格作为动态障碍重新寻路；无路时保留原路径，并按 20 tick 的固定间隔重试。若友军挡住对射目标的射线，后排会按移动成本和稳定格索引选择可达射击位。动态阻挡、候选排序和等待/重试节奏都是确定性规则。

该文件较大，但不能按代码长度直接拆分。拆分时先提取没有状态所有权的纯规则，再通过固定场景哈希证明行为未变。

### `src/sim/index.ts`

模拟公共入口。浏览器外部、Worker 和测试应优先从这里导入。不要无意导出 `internal.ts`。

## 4. Worker 边界

### `src/worker/protocol.ts`

定义线程命令与消息：

| 方向 | 类型 | 用途 |
| --- | --- | --- |
| 主线程 -> Worker | `initialize` | 传入完整 `BattleSetup`，创建带新 `sessionId` 的战斗 |
| 主线程 -> Worker | `run/pause` | 控制真实时间泵，不修改规则 |
| 主线程 -> Worker | `step-debug` | 暂停后显式推进测试 tick |
| 主线程 -> Worker | `inspect` | 请求单个实体详情 |
| 主线程 -> Worker | `set-observation` | 切换全知或指定势力视角 |
| 主线程 -> Worker | `reset-performance` | 重置显式基准的非权威采样 |
| 主线程 -> Worker | `dispose` | 结束会话 |
| Worker -> 主线程 | `ready/frame` | 初始和持续渲染投影 |
| Worker -> 主线程 | `pause-changed` | 确认运行状态 |
| Worker -> 主线程 | `inspection` | 返回按需详情 |
| Worker -> 主线程 | `finished` | 返回最终帧、事件和结果 |
| Worker -> 主线程 | `error` | 返回边界内错误信息 |

所有消息携带 `sessionId`，用于隔离模式切换和重开战斗后的迟到消息。显式性能模式下，`ready/frame/finished` 可附带初始化、tick 和渲染投影耗时摘要；普通战斗不采样。

### `src/worker/battle.worker.ts`

负责验证并消费收到的完整 setup、真实时间累积、catch-up 上限、调用 `step()`、聚合事件和发布帧。它不生成演示数据，也不拥有战斗规则。当前每 2 tick 发布帧，最多一次追赶 4 tick。

## 5. 主线程适配

### `src/client/useBattleWorker.ts`

React Hook，负责 Worker 生命周期、会话 ID、客户端状态机和最近事件窗口。`start()` 接收完整 `BattleSetup`，可供演示生成器或未来更上层战斗会话服务调用；启动新战斗会终止旧 Worker，旧会话消息会被丢弃。显式性能模式还在客户端边界估算 Worker 消息载荷并采样同步消息处理耗时。

此处不应计算伤亡、目标进度或胜负；它只组合 Worker 已给出的事实。

### `src/App.tsx`

应用组合层。负责：

- 从 URL 读取 seed、场景和兼容模式参数，并调用独立演示场景生成器；
- 启动、重开和切换模式/开发场景；
- 暂停、选择、镜头和纯净界面状态；
- 将公开数据分发给 3D 场景和 UI；
- 仅在开发服务或显式 `devtools=1` 时显示场景实验台；
- 仅在 `e2e=1` 时安装测试 API。

未来城市系统接入时，应通过更上层路由或战斗会话服务传入 `BattleSetup`，不要继续向 `App.tsx` 堆积领域生成逻辑。

## 6. 3D 表现

| 文件 | 职责 |
| --- | --- |
| `render/Battlefield.tsx` | Canvas、灯光、雾、正交镜头、镜头控制和场景组合 |
| `render/Terrain.tsx` | 高度地形网格、标准地表/水深顶点色和水面组合 |
| `render/StaticObjects.tsx` | 按稳定 ID 实例化权威树木、岩石和带方向墙段 |
| `render/Units.tsx` | 成员实例、编组标记、选择反馈和位置插值 |
| `render/Objectives.tsx` | 贴合地形的目标区域、边界、进度环和旗标 |
| `render/ShotEffects.tsx` | 从射击事件抽样生成非权威曳光和弹着闪光 |

表现可以抽样事件，例如一次齐射只画少量曳光；不得因此减少模拟中的实际射击或改变命中结果。

## 7. UI

| 文件 | 职责 |
| --- | --- |
| `ui/Toolbar.tsx` | 模式、暂停、重开、镜头和纯净界面控制 |
| `ui/ScenarioLab.tsx` | 开发环境场景、seed 和暂停步进控制；不提供正式战术命令 |
| `ui/FactionSummary.tsx` | 势力有效人数、伤亡与溃散概览 |
| `ui/ObjectiveSummary.tsx` | 目标状态、语义化进度条和占领力 |
| `ui/Inspector.tsx` | 选中编组的行动原因、士气、压制、伤情、接触、掩体评估和路线 |
| `ui/EventFeed.tsx` | 将重要领域事件转换为有限的观察提示 |
| `styles.css` | 全局工作台布局和桌面/窄屏响应式规则 |

行动原因码由模拟产生，UI 负责本地化。新增原因码时必须提供可理解标签，但不得在 UI 中重新推导原因。

## 8. 测试设施

- `src/sim/*.test.ts`：Node 环境 Vitest，覆盖地图图层与移动规则、确定性和完整场景。
- `src/sim/generated-invariants.test.ts`：批量 seed 覆盖地图边界/路线、逐 tick 哈希、非敌对安全和结果人数守恒，并支持按 seed 重放。
- `src/demo/setup.test.ts`：覆盖演示生成结果、标准输入验证和 Worker 初始化边界。
- `src/demo/scenarios.test.ts`：覆盖五类人工场景验证、多目标配置和增援事件接线。
- `tests/e2e/battle.spec.ts`：真实 Worker、WebGL、控制、模式与响应式布局。
- `src/performance`：固定中型/大型预设、分位数摘要和消息载荷估算，不拥有战斗状态。
- `tests/performance/battle.perf.spec.ts`：生产构建上的可选规模基准与固定 tick 哈希重放。
- `src/test-api.d.ts`：仅声明 E2E 调试桥。
- `scripts/run-e2e.mjs`：复用或启动 `4173` 端口 Vite，并可靠清理子进程。
- `playwright.config.ts`：本地 Edge，CI Chromium。
- `playwright.performance.config.ts`、`scripts/run-performance.mjs`：单 Worker 性能运行器与 `4174` 预览生命周期。

## 9. 状态所有权速查

| 状态 | 所有者 | 可否影响战斗 |
| --- | --- | --- |
| 成员健康、弹匣、士气、情报、目标进度 | 模拟 Worker | 是 |
| Worker 运行/暂停 | Worker 适配 | 只决定是否调用 step |
| 最近事件列表、当前检查结果 | Client Hook | 否 |
| 选中单位、镜头模式、纯净界面 | React App | 否 |
| 插值位置、曳光寿命、相机平滑 | Three.js | 否 |

## 10. 已知技术债

- `simulation.ts` 仍拥有多个有状态规则域；进一步拆分必须保留调度顺序，并用固定 seed 黄金哈希逐步证明行为不变。
- Three.js 运行时保留为延迟加载的 vendor chunk，主入口和战场入口已拆分；该 vendor chunk 仍可能超过 500KB，但不会阻塞首屏 UI 加载。
- 当前事件列表仅保留最近 160 条，不是回放日志。
