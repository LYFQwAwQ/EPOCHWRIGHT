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

`staticObjects` 保存身份、类型、单格锚点和方向，`staticOccupancy` 保存每格的对象类型 ID 并在验证时与对象列表逐格核对。方向约定为 `0=+z`、`2=+x`、`4=-z`、`6=-x`，中间整数表示对角方向。当前对象不可摧毁；可站立的掩体槽位与对象格分离，后续作为独立规则扩展。

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
  readonly memberSlotRules: readonly MemberSlotRule[];
  readonly platformSlotRules: readonly PlatformSlotRule[];
  readonly cohesionRadiusCells: number;
  readonly capturePowerScaleBps: BasisPoints;
  readonly behaviorProfileId: string;
}
```

### 9.2 武器模板

```ts
interface WeaponTemplate {
  readonly id: TemplateId;
  readonly tags: readonly string[];
  readonly targetDomains: readonly ("ground" | "air")[];
  readonly minimumRangeMm: number;
  readonly optimalRangeMm: number;
  readonly maximumRangeMm: number;
  readonly aimTicks: Tick;
  readonly magazineSize: number;
  readonly reloadTicks: Tick;
  readonly firePattern: FirePattern;
  readonly trajectory: "resolved" | "logical-projectile";
  readonly damageEffects: readonly EffectDefinition[];
  readonly suppression: number;
  readonly exposureOnFire: number;
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
- `INSPECT_ENTITY`：请求指定实体详细状态。
- `DISPOSE`：释放本场战斗。

### 13.2 Worker 到主线程

- `READY`：初始化和验证完成。
- `RENDER_FRAME`：紧凑的可视状态增量或关键帧。
- `EVENT_BATCH`：观察 UI 需要的事件批次。
- `ENTITY_INSPECTION`：按需返回详细状态。
- `BATTLE_FINISHED`：返回最终结果。
- `SIMULATION_ERROR`：结构化错误和安全诊断信息。

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
