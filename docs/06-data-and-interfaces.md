# 数据模型与模块接口

> **文档角色**：长期数据结构与跨模块接口目标
> **权威性**：目标契约；当前可执行契约以 `src/sim/types.ts` 和 Worker 协议为准
> **何时阅读**：修改输入、地图 schema、模板、关系、模式配置、事件、帧、结果、Worker 或版本迁移时
> **可跳过**：不跨边界的纯函数、局部样式和仅表现动画
> **相关代码**：`src/sim/types.ts`、`setup.ts`、`src/worker/protocol.ts`、`src/client/useBattleWorker.ts`

## 1. 目标

数据边界需要同时满足：

- 战斗核心可以脱离 UI 运行。
- 地图生成器可以单独开发和测试。
- 外部游戏系统可以传入持久化成员、英雄和编制。
- Web Worker 之间传输成本可控。
- 多时代内容通过配置扩展。
- 相同输入、版本和种子可以复现结果。

本文件中的 TypeScript 是接口草案，用于约束边界，不代表必须逐字照搬的最终源码。

## 2. 标识与数值约定

所有实体使用稳定字符串或整数标识。逻辑状态不得依赖数组临时下标作为持久化身份。

```ts
type BattleId = string;
type FactionId = string;
type GroupId = string;
type MemberId = string;
type PlatformId = string;
type ObjectiveId = string;
type TemplateId = string;

type Tick = number;
type BasisPoints = number; // 0..10000
type HeightUnit = number;  // 默认每单位 0.5m

interface GridCoord {
  readonly x: number;
  readonly z: number;
}
```

模拟中的时间使用整数 tick；概率、比例和修正优先使用基点或其他定点整数。渲染层可以转换成浮点世界坐标。

## 3. 战斗输入

```ts
interface BattleSetup {
  readonly schemaVersion: string;
  readonly rulesVersion: string;
  readonly battleId: BattleId;
  readonly simulationSeed: string;
  readonly content: BattleContentBundle;
  readonly map: BattleMap;
  readonly factions: readonly FactionSetup[];
  readonly relations: readonly RelationSetup[];
  readonly groups: readonly TacticalGroupSpawn[];
  readonly reinforcements: readonly ReinforcementWave[];
  readonly mode: BattleModeConfig;
  readonly environment: EnvironmentSetup;
  readonly rules: BattleRules;
}
```

初始化前必须完整验证输入。不能在演算中途才发现出生区域不存在、模板引用缺失或某种移动类型没有合法位置。

## 4. 内容包

战斗使用已经解析的内容包，不在模拟过程中请求网络或读取 React 状态。

```ts
interface BattleContentBundle {
  readonly contentVersion: string;
  readonly eraId: TemplateId;
  readonly eraTemplates: Readonly<Record<TemplateId, EraTemplate>>;
  readonly groupTemplates: Readonly<Record<TemplateId, GroupTemplate>>;
  readonly memberTemplates: Readonly<Record<TemplateId, MemberTemplate>>;
  readonly platformTemplates: Readonly<Record<TemplateId, PlatformTemplate>>;
  readonly weaponTemplates: Readonly<Record<TemplateId, WeaponTemplate>>;
  readonly sensorTemplates: Readonly<Record<TemplateId, SensorTemplate>>;
  readonly abilityTemplates: Readonly<Record<TemplateId, AbilityTemplate>>;
  readonly statusTemplates: Readonly<Record<TemplateId, StatusTemplate>>;
  readonly terrainCatalog: TerrainCatalog;
}
```

每个模板可以带 `eraTags`、`techTags` 和任意内容标签。核心只按能力字段和通用标签工作，不按时代名称推断规则。

### 4.1 `CONTENT-001` 内容解析边界

`BattleContentBundle` 是进入模拟的**已解析快照**，不是内容文件目录。内容加载器属于模拟外部的组合层，负责读取文件、选择时代、展开引用并生成快照；模拟只接收快照，不读取网络、文件系统或 UI 状态。

本任务采用以下边界：

- `contentVersion` 使用独立的 `content-1` 版本；`BattleSetup` schema 在实现接入时从 `stage-2.1` 升为 `stage-2.2`，`rulesVersion` 保持 `stage-2.5`。模板替换当前等价常量时不改变规则语义。
- `BattleContentBundle.eraId` 标识本场已选择的时代，`eraTemplates` 保存时代元数据和允许的模板 ID。时代选择发生在外部内容解析层；模拟不根据 `eraId`、`displayName` 或时代标签分支。
- `groupTemplates`、`memberTemplates` 和 `weaponTemplates` 是本切片的必需集合；`sensorTemplates` 至少包含每个成员引用的传感器。平台、能力和状态模板保留接口，但在本切片中可以为空且不能被 spawn 引用。
- 不引入模板继承、运行时脚本或任意字段覆盖。模板之间使用显式 ID 引用；成员 spawn 只允许引用模板并提供健康、持久化 ID 等边界字段。这样可以避免继承环、字符串特判和不可复现的内容脚本。
- 每个模板的数值在初始化时一次性验证，随后运行时只使用不可变的解析结果。模板引用缺失、时代白名单不匹配、槽位数量不匹配或不支持的移动/目标域必须在初始化阶段拒绝。

内容解析的顺序固定为：解析版本和 ID -> 校验时代白名单 -> 校验模板引用和槽位 -> 将距离从毫米转换为地图格的整数运行参数 -> 生成规范内容哈希 -> 克隆到 `BattleSetup`。内容哈希必须进入 setup 哈希；不允许依赖 `Record` 的插入顺序。

## 5. 地图格式

### 5.1 结构

```ts
interface BattleMap {
  readonly schemaVersion: string;
  readonly generator?: {
    readonly version: string;
    readonly seed: string;
    readonly requestHash: string;
  };
  readonly width: number;
  readonly height: number;
  readonly cellSizeMm: number;
  readonly heightUnitMm: number;
  readonly layers: BattleMapLayers;
  readonly staticObjects: readonly StaticMapObject[];
  readonly spawnZones: readonly MapZone[];
  readonly reinforcementEntrances: readonly MapZone[];
  readonly evacuationExits: readonly MapZone[];
  readonly objectiveZones: readonly MapZone[];
  readonly annotations: MapAnnotations;
  readonly validationReport: MapValidationReport;
}
```

大地图不应为每格创建 JavaScript 对象。固定大小图层使用扁平 TypedArray：

```ts
interface BattleMapLayers {
  readonly heightUnits: Int16Array;
  readonly surfaceTypeIds: Uint16Array;
  readonly waterDepthUnits: Uint8Array;
  readonly cellFlags: Uint16Array;
  readonly staticOccupancy: Uint8Array;
}
```

当前权威静态对象的最小契约为：

```ts
type StaticObjectKind = "tree" | "rock" | "wall";
type StaticObjectFacing = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;

interface StaticMapObject {
  readonly id: string;
  readonly kind: StaticObjectKind;
  readonly cell: GridCoord;
  readonly facing: StaticObjectFacing;
}
```

`staticObjects` 保存身份、类型、单格锚点和方向，`staticOccupancy` 保存每格的对象类型 ID 并在验证时与对象列表逐格核对。方向约定为 `0=+z`、`2=+x`、`4=-z`、`6=-x`，中间整数表示对角方向。当前对象不可摧毁；可站立的掩体槽位与对象格分离，并从对象的稳定字段与规则版本确定性派生：

```ts
interface CoverSlot {
  readonly id: string;
  readonly staticObjectId: string;
  readonly staticObjectKind: StaticObjectKind;
  readonly objectCell: GridCoord;
  readonly cell: GridCoord;
  readonly facing: StaticObjectFacing;
  readonly capacity: number;
  readonly protectionBps: number;
  readonly concealmentBps: number;
}
```

槽位不是新的地图序列化字段，因此地图仍为 `map-2`。动态 `coverOccupancy` 只保存在模拟状态并进入状态哈希；按需 `GroupInspection.currentCover` 投影槽位稳定 ID、对象、方向、容量和当前覆盖人数，不扩大全量 `RenderFrame`。AI 的最后一次掩体评估使用同一按需通道：

```ts
interface CoverEvaluationInspection {
  readonly reason:
    | "defend-objective-cover"
    | "seek-cover-high-suppression"
    | "seek-cover-defense"
    | "hold-cover"
    | "no-cover-available";
  readonly selectedSlotId?: string;
  readonly score: number;
  readonly evaluatedAt: Tick;
  readonly threat?: {
    readonly targetGroupId: GroupId;
    readonly lastKnown: GridCoord;
    readonly observedAt: Tick;
    readonly source: "direct-contact" | "local-contact" | "shared-contact";
  };
}
```

`threat` 只能复制接触快照，不能投影敌军当前真实位置。选择状态参与未来迟滞，因此进入状态哈希；UI 只本地化原因并显示分数，不重新计算候选。

索引统一为 `index = z * width + x`。地图创建后视为只读，动态占用、接触和临时效果放在模拟状态中。

### 5.2 区域

```ts
interface MapZone {
  readonly id: string;
  readonly kind: "spawn" | "reinforcement" | "evacuation" | "objective";
  readonly cellIndices: Uint32Array;
  readonly allowedFactionIds?: readonly FactionId[];
  readonly tags: readonly string[];
}
```

区域保存已经栅格化的格索引，避免每 tick 进行复杂多边形测试。编辑或生成工具可以同时保存原始几何用于显示。

## 6. 地图生成接口

```ts
interface MapGenerationRequest {
  readonly schemaVersion: string;
  readonly generatorVersion: string;
  readonly seed: string;
  readonly sizePreset: "small" | "medium" | "large" | "custom";
  readonly width?: number;
  readonly height?: number;
  readonly factionCount: number;
  readonly modeHint: "conflict" | "defense";
  readonly parameters: MapGenerationParameters;
}

interface MapGenerationResult {
  readonly map: BattleMap;
  readonly attempts: number;
  readonly balanceScore: number;
  readonly warnings: readonly string[];
}

interface MapGenerator {
  generate(request: MapGenerationRequest): MapGenerationResult;
}
```

生成器可以在独立 Worker 中运行。它只能返回通过最低验证条件的地图；超过最大重试次数时应返回结构化错误，而不是不完整地图。

## 7. 势力与关系

```ts
interface FactionSetup {
  readonly id: FactionId;
  readonly displayName: string;
  readonly colorKey: string;
  readonly doctrineId: string;
  readonly initialIntel: readonly InitialIntelReport[];
}

type RelationKind = "hostile" | "neutral" | "allied";

interface RelationSetup {
  readonly a: FactionId;
  readonly b: FactionId;
  readonly kind: RelationKind;
  readonly shareIntel: boolean;
  readonly minimumIntelDelayTicks: Tick;
  readonly intelUpdateIntervalTicks: Tick;
}
```

输入验证默认要求关系对称且每个势力对只有一条有效配置。同盟不自动具有传递性。

## 8. 编组、成员与平台输入

```ts
interface TacticalGroupSpawn {
  readonly id: GroupId;
  readonly factionId: FactionId;
  readonly groupTemplateId: TemplateId;
  readonly spawnZoneId: string;
  readonly preferredCell?: GridCoord;
  readonly members: readonly MemberSpawn[];
  readonly platforms: readonly PlatformSpawn[];
  readonly initialEmbarkation?: readonly EmbarkationLink[];
  readonly persistentTags: readonly string[];
}

interface MemberSpawn {
  readonly id: MemberId;
  readonly memberTemplateId: TemplateId;
  readonly persistentId?: string;
  readonly hero: boolean;
  readonly abilityTemplateIds: readonly TemplateId[];
  readonly overrides?: Readonly<Record<string, number | string | boolean>>;
}

interface PlatformSpawn {
  readonly id: PlatformId;
  readonly platformTemplateId: TemplateId;
  readonly crewAssignments: readonly CrewAssignment[];
  readonly persistentId?: string;
}

interface CrewAssignment {
  readonly stationId: string;
  readonly memberId: MemberId;
}
```

固定编制由 `GroupTemplate` 和具体 spawn 成员共同验证。英雄既可以是单成员编组，也可以占普通编组中的特殊成员槽位。

## 9. 模板能力组合

### 9.1 编组模板

```ts
interface GroupTemplate {
  readonly id: TemplateId;
  readonly tags: readonly string[];
  readonly eraTags: readonly string[];
  readonly techTags: readonly string[];
  readonly memberSlotRules: readonly MemberSlotRule[];
  readonly platformSlotRules: readonly PlatformSlotRule[];
  readonly cohesionRadiusCells: number;
  readonly capturePowerScaleBps: BasisPoints;
  readonly behaviorProfileId: string;
}
```

### 9.1.1 成员、传感器和槽位

```ts
interface MemberTemplate {
  readonly id: TemplateId;
  readonly tags: readonly string[];
  readonly eraTags: readonly string[];
  readonly techTags: readonly string[];
  readonly movementType: "foot";
  readonly sensorTemplateId: TemplateId;
  readonly weaponSlotRules: readonly WeaponSlotRule[];
  readonly roleTags: readonly string[];
  readonly silhouetteId: string;
  readonly protectionBps: BasisPoints;
  readonly suppressionResistanceBps: BasisPoints;
  readonly capturePowerBps: BasisPoints;
}

interface SensorTemplate {
  readonly id: TemplateId;
  readonly rangeMm: number;
  readonly acquisitionTicks: Tick;
  readonly contactForgetTicks: Tick;
  readonly tags: readonly string[];
}

interface MemberSlotRule {
  readonly slotId: string;
  readonly memberTemplateId: TemplateId;
  readonly count: number;
  readonly required: boolean;
}

interface WeaponSlotRule {
  readonly slotId: string;
  readonly weaponTemplateId: TemplateId;
  readonly count: number;
  readonly required: boolean;
}
```

`GroupTemplate.memberSlotRules` 的总数定义固定编制；每个 `MemberSpawn.memberTemplateId` 必须匹配一个槽位且不能超额。`MemberTemplate.weaponSlotRules` 决定成员的默认装备，首个切片不允许战斗内自由换装。`protectionBps`、`suppressionResistanceBps` 和 `capturePowerBps` 都是能力字段，不得由成员名称推导。

### 9.2 武器模板

```ts
interface WeaponTemplate {
  readonly id: TemplateId;
  readonly tags: readonly string[];
  readonly eraTags: readonly string[];
  readonly techTags: readonly string[];
  readonly targetDomains: readonly ("ground" | "air")[];
  readonly minimumRangeMm: number;
  readonly optimalRangeMm: number;
  readonly maximumRangeMm: number;
  readonly aimTicks: Tick;
  readonly magazineSize: number;
  readonly reloadTicks: Tick;
  readonly shotIntervalTicks: Tick;
  readonly firePattern: FirePattern;
  readonly trajectory: "resolved" | "logical-projectile";
  readonly damageEffects: readonly EffectDefinition[];
  readonly suppressionBps: BasisPoints;
  readonly exposureOnFireBps: BasisPoints;
}
```

首版运行规则把备用弹药解释为无限，但模板仍可保存未来的携弹量。

### 9.3 能力模板

```ts
interface AbilityTemplate {
  readonly id: TemplateId;
  readonly kind: "passive" | "aura" | "triggered" | "activated";
  readonly targetRule: AbilityTargetRule;
  readonly conditions: readonly AbilityCondition[];
  readonly effects: readonly EffectDefinition[];
  readonly cooldownTicks: Tick;
  readonly maxUses?: number;
  readonly aiProfile: AbilityAiProfile;
  readonly handlerId?: string;
}
```

标准效果使用判别联合，例如伤害、治疗、状态、属性修正、区域效果和情报效果。`handlerId` 只能引用构建时注册且具有确定性测试的代码，禁止 `eval` 或从内容包执行任意脚本。

### 9.4 时代模板与内容选择

```ts
interface EraTemplate {
  readonly id: TemplateId;
  readonly displayName: string;
  readonly tags: readonly string[];
  readonly allowedGroupTemplateIds: readonly TemplateId[];
  readonly allowedMemberTemplateIds: readonly TemplateId[];
  readonly allowedWeaponTemplateIds: readonly TemplateId[];
  readonly allowedSensorTemplateIds: readonly TemplateId[];
}
```

`BattleContentBundle` 增加 `eraId` 和 `eraTemplates` 字段。解析器先选择一个 `EraTemplate`，再把允许的单位、成员、武器和传感器模板收集到 bundle；核心只验证 `eraId` 与引用的一致性。时代模板本身不修改伤害、射程或 AI 行为，也不提供名称到规则的映射。未来需要科技解锁时，由外部系统生成不同的已解析 bundle，而不是在模拟中加入 `if (eraId === ...)`。

`CONTENT-001` 的默认内容映射如下，目标是让现有演示在迁移后逐项表达而不改变固定 seed 行为：

| 当前演示常量 | 内容 ID / 字段 | 迁移语义 |
| --- | --- | --- |
| 八名同质成员 | `infantry-rifle-squad-v1` + `infantry-rifleman-v1` | 编组槽位为 8 个步枪手；spawn 为每名成员填写成员模板 ID |
| `MAGAZINE_SIZE = 12` | `rifle-standard-v1.magazineSize` | 每名可操作成员初始 12 发 |
| `RELOAD_TICKS = 36` | `rifle-standard-v1.reloadTicks` | 换弹仍为 36 tick |
| `SHOT_COOLDOWN_TICKS = 7` | `rifle-standard-v1.shotIntervalTicks` | 连续射击间隔仍为 7 tick |
| `weaponRangeCells = 11` | `maximumRangeMm = 44_000` | 按当前 `map.cellSizeMm = 4_000` 转换为 11 格 |
| `preferredRangeCells = 7` | `optimalRangeMm = 28_000` | 转换为 7 格；命中距离计算改读武器能力 |
| `sightRangeCells` | `infantry-eyesight-v1.rangeMm` | 传感器能力取代全局单位名称分支 |

首个内容包只提供 `foot`、`ground`、`resolved` 这组已实现能力。`air`、平台、逻辑飞行体和能力效果可以在 bundle 中预留，但在没有对应规则实现前，验证器应拒绝被引用的配置。

### 9.5 内容验证和哈希要求

初始化验证至少包括：

1. 所有模板 ID 在各自命名空间内唯一且非空；`contentVersion`、`eraId` 和模板引用存在。
2. 槽位 `count`、距离、tick、基点和弹匣值均为有限整数；最小/最佳/最大射程满足 `minimum <= optimal <= maximum`。
3. 编组 spawn 的成员数量与 `GroupTemplate` 槽位总数一致，成员模板和默认武器槽位均可解析；增强波次使用相同规则。
4. 成员传感器和武器的目标域、移动类型、弹道类型都在当前规则支持集合内。
5. 时代白名单覆盖所有被引用的编组、成员和武器模板；未使用模板可以存在，但不会进入运行时。

规范内容哈希按命名空间和模板 ID 排序，覆盖所有会影响模拟的字段（包括时代 ID、标签、槽位顺序、武器效果和传感器参数）。`displayName`、颜色和其他纯观察元数据不参与战斗哈希；但完整 setup 快照仍必须可克隆并通过 Worker 结构化克隆。

## 10. 模式配置

```ts
type BattleModeConfig = ConflictModeConfig | DefenseModeConfig;

interface ConflictModeConfig {
  readonly kind: "conflict";
  readonly maximumDurationTicks: Tick;
  readonly stalemateWindowTicks: Tick;
  readonly resolutionStableTicks: Tick;
}

interface DefenseModeConfig {
  readonly kind: "defense";
  readonly attackerFactionIds: readonly FactionId[];
  readonly defenderFactionIds: readonly FactionId[];
  readonly objectiveIds: readonly ObjectiveId[];
  readonly objectiveRule: "all" | "count" | "sequence";
  readonly requiredCount?: number;
  readonly maximumDurationTicks: Tick;
}
```

目标的占领速度、恢复速度、贡献上限和区域引用由单独 `ObjectiveDefinition` 保存。

## 11. 增援与环境

```ts
interface ReinforcementWave {
  readonly id: string;
  readonly factionId: FactionId;
  readonly entranceZoneIds: readonly string[];
  readonly trigger: ReinforcementTrigger;
  readonly groups: readonly TacticalGroupSpawn[];
  readonly blockedPolicy: "wait" | "try-alternate" | "cancel";
}

interface EnvironmentSetup {
  readonly lightLevelBps: BasisPoints;
  readonly rainLevelBps: BasisPoints;
  readonly fogLevelBps: BasisPoints;
  readonly windDirectionMilliDegrees: number;
  readonly windStrength: number;
  readonly modifiersEnabled: false;
}
```

首版 `modifiersEnabled` 固定为 `false`，但完整数据会进入战斗记录，方便以后启用。

## 12. 模拟核心接口

核心是显式推进的状态机，不自行读取真实时间：

```ts
interface BattleSimulation {
  readonly tick: Tick;
  readonly status: "ready" | "running" | "finished";

  step(): void;
  stepMany(count: number): void;
  drainEvents(): readonly BattleEvent[];
  createRenderFrame(): RenderFrame;
  inspectEntity(entityId: string): EntityInspection | undefined;
  getResult(): BattleResult | undefined;
}

interface BattleSimulationFactory {
  create(setup: BattleSetup): BattleSimulation;
}
```

暂停由 runner 停止调用 `step` 实现，核心不需要依赖线程暂停机制。

## 13. Worker 消息协议

### 13.1 主线程到 Worker

- `INITIALIZE`：传入完整 `BattleSetup` 和模拟所需的静态地图缓冲区。
- `RUN`：开始持续推进。
- `PAUSE`：停止自动推进。
- `STEP_DEBUG`：仅开发模式推进指定 tick。
- `RESET_PERFORMANCE`：仅显式性能基准重置非权威采样窗口。
- `INSPECT_ENTITY`：请求指定实体详细状态。
- `DISPOSE`：释放本场战斗。

### 13.2 Worker 到主线程

- `READY`：初始化和验证完成。
- `RENDER_FRAME`：紧凑的可视状态增量或关键帧。
- `EVENT_BATCH`：观察 UI 需要的事件批次。
- `ENTITY_INSPECTION`：按需返回详细状态。
- `BATTLE_FINISHED`：返回最终结果。
- `SIMULATION_ERROR`：结构化错误和安全诊断信息。

显式性能模式允许 `READY`、`RENDER_FRAME` 和 `BATTLE_FINISHED` 附带 Worker 初始化、tick 与渲染投影耗时摘要。遥测使用真实时间但只存在于 Worker/客户端适配层，不进入 `BattleSetup`、模拟状态、事件、结果或状态哈希；普通战斗不发送该字段。

不能每个渲染帧复制完整模拟对象树。可视实体使用稳定渲染索引和 TypedArray 传输位置、旋转、状态位及动画参数；详细成员数据只在选中时按需发送。

静态地图同时被模拟和 3D 地形使用，初始化时必须明确缓冲区所有权。默认允许一次性结构化克隆给 Worker；如果为了减少复制而转移 TypedArray，主线程必须先生成并保留独立的只读渲染数据。首版不强制使用需要额外安全响应头的 `SharedArrayBuffer`。

## 14. 渲染帧

```ts
interface RenderFrame {
  readonly tick: Tick;
  readonly entityCount: number;
  readonly renderIds: Uint32Array;
  readonly positions: Float32Array;
  readonly rotations: Float32Array;
  readonly stateFlags: Uint16Array;
  readonly factionIndices: Uint8Array;
  readonly visualTypeIndices: Uint16Array;
}
```

表现层在前后两个逻辑帧之间插值。死亡、爆炸、射击等短事件通过事件批次驱动，不通过猜测位置变化生成。

## 15. 战斗事件

事件是事实记录，建议使用判别联合：

```ts
type BattleEvent =
  | EntitySpottedEvent
  | WeaponFiredEvent
  | MemberStateChangedEvent
  | PlatformStateChangedEvent
  | MoraleStateChangedEvent
  | ObjectiveStateChangedEvent
  | ReinforcementEvent
  | EvacuationEvent
  | BattleEndedEvent;
```

每条事件至少带 `tick`、事件类型、来源实体和相关势力。视觉粒子、镜头选择和 UI 展开不属于战斗事件。

## 16. 战斗结果

```ts
interface BattleResult {
  readonly battleId: BattleId;
  readonly rulesVersion: string;
  readonly finalTick: Tick;
  readonly outcome: "resolved" | "attacker-win" | "defender-win" | "draw";
  readonly terminationReason: string;
  readonly survivingFactionIds: readonly FactionId[];
  readonly groupResults: readonly GroupResult[];
  readonly memberResults: readonly MemberResult[];
  readonly platformResults: readonly PlatformResult[];
  readonly objectiveResults: readonly ObjectiveResult[];
  readonly statistics: BattleStatistics;
}
```

成员结果必须区分受伤、失能、死亡、撤离和失散。平台结果必须区分受损、失去机动、失去作战能力、废弃和摧毁。外部系统根据这些事实决定医疗、俘获、维修或永久损失。

## 17. 确定性要求

首版不实现回放 UI，但从第一天遵守：

- 固定基础步长，建议初始值 `50ms`，即每秒 20 tick。
- 逻辑时间只来源于 tick。
- 禁止在模拟中使用 `Math.random()`、`Date.now()` 和非稳定对象遍历结果。
- 使用带名称的独立随机流，例如地图、发现、武器、伤害、AI 平局和表现。
- 位置、生命、士气、概率和冷却在逻辑边界量化为整数。
- 实体按稳定 ID 或固定创建序列迭代。
- 每隔固定 tick 可计算状态哈希，用于测试复现性。

表现层随机数不进入模拟状态，也不能改变实体标识或事件顺序。

## 18. 版本与迁移

- `schemaVersion` 描述数据结构。
- `rulesVersion` 描述战斗规则行为。
- `contentVersion` 描述单位与地形配置。
- 地图另存 `generatorVersion`。

加载旧输入时先通过显式迁移器转换，再进入验证。核心不应到处兼容旧字段。版本不匹配且无法迁移时返回明确错误。

当前运行代码的 `BattleSetup` schema 为 `stage-2.2`，规则为 `stage-2.5`，内容为 `content-1`，地图为 `map-2`。迁移器会把 `stage-2`/`stage-2.1` 输入补入等价默认内容和模板 ID；新的 `stage-2.2` 输入必须显式提供内容包、编组模板 ID 和成员模板 ID。`stage-2.5` 仍负责多势力关系及基于关系的目标、阻挡和终止语义。

内容规范哈希参与 setup 哈希，因此固定 seed 回归比较“同输入同哈希”，不承诺跨 schema 的旧哈希字面值不变。版本不匹配、内容版本不支持、模板引用缺失或编制槽位不一致都会在创建运行时状态前明确拒绝。
