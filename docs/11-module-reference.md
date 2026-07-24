# 模块参考与数据流

> **文档角色**：当前代码所有权、依赖和数据流参考
> **权威性**：当前架构说明；代码变化后应同步更新
> **何时阅读**：查找状态所有者、首次修改某模块或改动跨越目录边界时
> **可跳过**：目标文件和调用关系已经明确的单文件局部改动
> **相关代码**：`src`、`tests/e2e`、`scripts/run-e2e.mjs`

本文描述当前代码的真实结构。长期目标见 `01-08`，当前完成度见 [实现状态](./09-implementation-status.md)。

## 1. 总体数据流

```text
URL / future game systems
          |
          v
BattleSetupOptions -> createBattleSetup -> validateBattleSetup
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
                                              v
                                      useBattleWorker
                                              |
                                    +---------+---------+
                                    v                   v
                              Three.js render         React UI
```

主线程不直接创建或推进模拟。`battle.worker.ts` 拥有模拟实例，React 只管理会话、选择、镜头和观察界面。

## 2. 依赖分层

| 层 | 目录 | 可以依赖 | 不得依赖 |
| --- | --- | --- | --- |
| 领域核心 | `src/sim` | 纯 TypeScript、封装后的算法库 | React、Three.js、DOM、Worker、真实时间 |
| 线程适配 | `src/worker` | `src/sim` 公共 API、协议类型 | React、Three.js、UI 状态 |
| 客户端适配 | `src/client` | Worker 协议、公开领域类型、React | 模拟内部状态和战斗规则 |
| 3D 表现 | `src/render` | `RenderFrame`、事件、地图投影、Three.js | `sim/internal.ts`、权威状态修改 |
| 观察 UI | `src/ui` | 公开投影和检查结果 | 运行时内部状态、战斗结算 |
| 组合层 | `src/App.tsx` | Client、Render、UI | 具体命中或 AI 规则 |

## 3. 模拟核心

### `src/sim/types.ts`

公共领域契约。包含战斗输入、模式判别联合、渲染帧、事件、检查结果、最终结果和 `BattleSimulation` 接口。

修改时需要检查：

- Worker 结构化克隆是否支持字段类型；
- 所有判别联合消费者是否覆盖新分支；
- schema/rules 版本是否仍成立；
- 外部系统能否通过稳定 ID 对接。

### `src/sim/internal.ts`

模拟私有运行时状态，包括成员、小队、感知、接触、情报队列、占用与目标状态。此文件不是公共 API。

新增字段通常还需要更新 `createRuntimeState`、`getStateHash`、结果或检查投影，以及测试。

### `src/sim/setup.ts`

负责从简化选项生成当前演示战斗，并严格验证完整 `BattleSetup`。当前在这里固定两势力、八人小队和单目标防守。

未来外部城市系统接入后，随机演示生成器与标准输入验证应拆分，但所有来源仍必须走同一个验证器。

### `src/sim/map.ts`

包含当前随机高度地图生成、网格索引、可通行查询、高度查询、视线和距离函数。地图数据使用 TypedArray，索引为 `z * width + x`。

长期组合地形应增加标准化图层，而不是把沙地、沼泽等编码进高度值。

### `src/sim/pathfinder.ts`

对 EasyStar.js 的内部封装，提供八方向 A*、禁止斜穿和移动成本。其他模块应依赖 `Pathfinder` 接口，不直接使用 EasyStar API。

未来更换分层寻路或路径缓存时，公共调用方和规则测试可以保持稳定。

### `src/sim/rng.ts`

提供种子随机、可按键推导的确定性整数和状态哈希。模拟随机逻辑必须使用这里的接口或遵循同样的无共享序列原则。

### `src/sim/objective.ts`

目标区占领、争夺和恢复的纯规则。这里不读取地图、AI 或渲染状态，适合直接单元测试和未来数值配置化。

### `src/sim/simulation.ts`

当前权威调度器，负责：

- 固定顺序的 tick 管线；
- 有限感知与延迟情报；
- 小队 AI、路径和占用；
- 弹匣、射击意图、伤情与压制；
- 士气、溃散和撤离；
- 防守阵位、占领与两种模式终止；
- 渲染帧、检查结果、最终结果和状态哈希。

该文件较大，但不能按代码长度直接拆分。拆分时先提取没有状态所有权的纯规则，再通过固定场景哈希证明行为未变。

### `src/sim/index.ts`

模拟公共入口。浏览器外部、Worker 和测试应优先从这里导入。不要无意导出 `internal.ts`。

## 4. Worker 边界

### `src/worker/protocol.ts`

定义线程命令与消息：

| 方向 | 类型 | 用途 |
| --- | --- | --- |
| 主线程 -> Worker | `initialize` | 创建带新 `sessionId` 的战斗 |
| 主线程 -> Worker | `run/pause` | 控制真实时间泵，不修改规则 |
| 主线程 -> Worker | `step-debug` | 暂停后显式推进测试 tick |
| 主线程 -> Worker | `inspect` | 请求单个实体详情 |
| 主线程 -> Worker | `dispose` | 结束会话 |
| Worker -> 主线程 | `ready/frame` | 初始和持续渲染投影 |
| Worker -> 主线程 | `pause-changed` | 确认运行状态 |
| Worker -> 主线程 | `inspection` | 返回按需详情 |
| Worker -> 主线程 | `finished` | 返回最终帧、事件和结果 |
| Worker -> 主线程 | `error` | 返回边界内错误信息 |

所有消息携带 `sessionId`，用于隔离模式切换和重开战斗后的迟到消息。

### `src/worker/battle.worker.ts`

负责真实时间累积、catch-up 上限、调用 `step()`、聚合事件和发布帧。它不拥有战斗规则。当前每 2 tick 发布帧，最多一次追赶 4 tick。

## 5. 主线程适配

### `src/client/useBattleWorker.ts`

React Hook，负责 Worker 生命周期、会话 ID、客户端状态机和最近事件窗口。启动新战斗会终止旧 Worker，旧会话消息会被丢弃。

此处不应计算伤亡、目标进度或胜负；它只组合 Worker 已给出的事实。

### `src/App.tsx`

应用组合层。负责：

- 从 URL 读取 seed 和模式；
- 启动、重开和切换模式；
- 暂停、选择、镜头和纯净界面状态；
- 将公开数据分发给 3D 场景和 UI；
- 仅在 `e2e=1` 时安装测试 API。

未来城市系统接入时，应通过更上层路由或战斗会话服务传入 `BattleSetup`，不要继续向 `App.tsx` 堆积领域生成逻辑。

## 6. 3D 表现

| 文件 | 职责 |
| --- | --- |
| `render/Battlefield.tsx` | Canvas、灯光、雾、正交镜头、镜头控制和场景组合 |
| `render/Terrain.tsx` | 高度地形网格、网格线、程序化岩石与植被 |
| `render/Units.tsx` | 成员实例、编组标记、选择反馈和位置插值 |
| `render/Objectives.tsx` | 贴合地形的目标区域、边界、进度环和旗标 |
| `render/ShotEffects.tsx` | 从射击事件抽样生成非权威曳光和弹着闪光 |

表现可以抽样事件，例如一次齐射只画少量曳光；不得因此减少模拟中的实际射击或改变命中结果。

## 7. UI

| 文件 | 职责 |
| --- | --- |
| `ui/Toolbar.tsx` | 模式、暂停、重开、镜头和纯净界面控制 |
| `ui/FactionSummary.tsx` | 势力有效人数、伤亡与溃散概览 |
| `ui/ObjectiveSummary.tsx` | 目标状态、语义化进度条和占领力 |
| `ui/Inspector.tsx` | 选中编组的行动原因、士气、压制、伤情、接触和路线 |
| `ui/EventFeed.tsx` | 将重要领域事件转换为有限的观察提示 |
| `styles.css` | 全局工作台布局和桌面/窄屏响应式规则 |

行动原因码由模拟产生，UI 负责本地化。新增原因码时必须提供可理解标签，但不得在 UI 中重新推导原因。

## 8. 测试设施

- `src/sim/*.test.ts`：Node 环境 Vitest，覆盖纯规则、确定性和完整场景。
- `tests/e2e/battle.spec.ts`：真实 Worker、WebGL、控制、模式与响应式布局。
- `src/test-api.d.ts`：仅声明 E2E 调试桥。
- `scripts/run-e2e.mjs`：复用或启动 `4173` 端口 Vite，并可靠清理子进程。
- `playwright.config.ts`：本地 Edge，CI Chromium。

## 9. 状态所有权速查

| 状态 | 所有者 | 可否影响战斗 |
| --- | --- | --- |
| 成员健康、弹匣、士气、情报、目标进度 | 模拟 Worker | 是 |
| Worker 运行/暂停 | Worker 适配 | 只决定是否调用 step |
| 最近事件列表、当前检查结果 | Client Hook | 否 |
| 选中单位、镜头模式、纯净界面 | React App | 否 |
| 插值位置、曳光寿命、相机平滑 | Three.js | 否 |

## 10. 已知技术债

- `simulation.ts` 调度范围较大，未来应按经过测试的规则域逐步提取。
- `BattleSetup` 仍固定两势力元组，无法直接表达同盟和中立。
- 演示 setup 生成和标准输入验证仍在同一文件。
- 主包包含完整 Three.js 依赖，构建会提示超过 500KB；需要在功能边界稳定后做按路由或场景拆分。
- 当前事件列表仅保留最近 160 条，不是回放日志。
