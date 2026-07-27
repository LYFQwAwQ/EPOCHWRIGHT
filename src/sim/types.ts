export const SIMULATION_HZ = 20 as const;
export const TICK_DURATION_MS = 1_000 / SIMULATION_HZ;
export const BATTLE_SETUP_SCHEMA_VERSION = "stage-2.2" as const;
export const BATTLE_RULES_VERSION = "stage-2.5" as const;
/** Versions accepted by the input migration for the original two-faction slice. */
export const LEGACY_BATTLE_SETUP_SCHEMA_VERSION = "stage-2" as const;
export const LEGACY_BATTLE_RULES_VERSION = "stage-2.4" as const;
/** The pre-content setup version is migrated to the current content contract. */
export const PRE_CONTENT_BATTLE_SETUP_SCHEMA_VERSION = "stage-2.1" as const;
export const BATTLE_MAP_SCHEMA_VERSION = "map-2" as const;

export const SURFACE_TYPE_IDS = {
  grass: 0,
  sand: 1,
  mud: 2,
  rock: 3,
  paved: 4,
} as const;

export const WATER_DEPTH_UNITS = {
  none: 0,
  shallow: 1,
  deep: 2,
} as const;

export const MAP_CELL_FLAGS = {
  groundBlocked: 1 << 0,
} as const;

export const STATIC_OBJECT_DEFINITIONS = {
  tree: {
    typeId: 1,
    heightUnits: 12,
    blocksMovement: true,
    blocksSight: true,
    cover: {
      capacity: 2,
      protectionBps: 1_000,
      concealmentBps: 3_000,
    },
  },
  rock: {
    typeId: 2,
    heightUnits: 6,
    blocksMovement: true,
    blocksSight: true,
    cover: {
      capacity: 4,
      protectionBps: 3_200,
      concealmentBps: 1_800,
    },
  },
  wall: {
    typeId: 3,
    heightUnits: 5,
    blocksMovement: true,
    blocksSight: true,
    cover: {
      capacity: 6,
      protectionBps: 4_800,
      concealmentBps: 2_600,
    },
  },
} as const;

export type Tick = number;
export type FactionId = string;
export type GroupId = string;
export type MemberId = string;
export type ObjectiveId = string;
export type TemplateId = string;

export interface GridCoord {
  readonly x: number;
  readonly z: number;
}

export type SurfaceTypeId = (typeof SURFACE_TYPE_IDS)[keyof typeof SURFACE_TYPE_IDS];
export type WaterDepthUnits = (typeof WATER_DEPTH_UNITS)[keyof typeof WATER_DEPTH_UNITS];
export type MovementType = "foot";
export type StaticObjectKind = keyof typeof STATIC_OBJECT_DEFINITIONS;
export type StaticObjectFacing = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
export type CoverSlotId = string;
export type CoverAspect = "front" | "flank" | "rear";

export interface StaticMapObject {
  readonly id: string;
  readonly kind: StaticObjectKind;
  readonly cell: GridCoord;
  /** Eight clockwise steps: 0=+z, 2=+x, 4=-z, 6=-x. */
  readonly facing: StaticObjectFacing;
}

export interface CoverSlot {
  readonly id: CoverSlotId;
  readonly staticObjectId: string;
  readonly staticObjectKind: StaticObjectKind;
  readonly objectCell: GridCoord;
  readonly cell: GridCoord;
  /** Direction from the occupant toward the approach protected by the object. */
  readonly facing: StaticObjectFacing;
  /** Maximum active members receiving this slot's effect. */
  readonly capacity: number;
  readonly protectionBps: number;
  readonly concealmentBps: number;
}

export interface DirectionalCoverEffect {
  readonly aspect: CoverAspect;
  readonly coveredMembers: number;
  readonly protectionBps: number;
  readonly concealmentBps: number;
}

export interface CoverInspection {
  readonly slotId: CoverSlotId;
  readonly staticObjectId: string;
  readonly staticObjectKind: StaticObjectKind;
  readonly facing: StaticObjectFacing;
  readonly capacity: number;
  readonly coveredMembers: number;
}

export type CoverEvaluationReason =
  | "defend-objective-cover"
  | "seek-cover-high-suppression"
  | "seek-cover-defense"
  | "hold-cover"
  | "no-cover-available";

export type CoverThreatSource =
  | "direct-contact"
  | "local-contact"
  | "shared-contact";

export interface CoverThreatInspection {
  readonly targetGroupId: GroupId;
  readonly lastKnown: GridCoord;
  readonly observedAt: Tick;
  readonly source: CoverThreatSource;
}

export interface CoverEvaluationInspection {
  readonly reason: CoverEvaluationReason;
  readonly selectedSlotId?: CoverSlotId;
  readonly score: number;
  readonly evaluatedAt: Tick;
  readonly threat?: CoverThreatInspection;
}

export interface BattleMapLayers {
  readonly heightUnits: Int16Array;
  readonly surfaceTypeIds: Uint16Array;
  readonly waterDepthUnits: Uint8Array;
  readonly cellFlags: Uint16Array;
  /** Zero for open cells; otherwise a STATIC_OBJECT_DEFINITIONS typeId. */
  readonly staticOccupancy: Uint8Array;
}

export interface BattleMap {
  readonly schemaVersion: typeof BATTLE_MAP_SCHEMA_VERSION;
  readonly width: number;
  readonly height: number;
  readonly cellSizeMm: number;
  readonly heightUnitMm: number;
  readonly layers: BattleMapLayers;
  readonly staticObjects: readonly StaticMapObject[];
}

export interface FactionSetup {
  readonly id: FactionId;
  readonly displayName: string;
  readonly color: string;
}

export type RelationKind = "hostile" | "neutral" | "allied";

export interface RelationSetup {
  readonly a: FactionId;
  readonly b: FactionId;
  readonly kind: RelationKind;
  readonly shareIntel: boolean;
  readonly minimumIntelDelayTicks: Tick;
  readonly intelUpdateIntervalTicks: Tick;
}

export interface MemberSlotRule {
  readonly slotId: string;
  readonly memberTemplateId: TemplateId;
  readonly count: number;
  readonly required: boolean;
}

export interface WeaponSlotRule {
  readonly slotId: string;
  readonly weaponTemplateId: TemplateId;
  readonly count: number;
  readonly required: boolean;
}

export interface GroupTemplate {
  readonly id: TemplateId;
  readonly tags: readonly string[];
  readonly eraTags: readonly string[];
  readonly techTags: readonly string[];
  readonly memberSlotRules: readonly MemberSlotRule[];
  readonly platformSlotRules: readonly unknown[];
  readonly cohesionRadiusCells: number;
  readonly capturePowerScaleBps: number;
  readonly behaviorProfileId: string;
}

export interface SensorTemplate {
  readonly id: TemplateId;
  readonly rangeMm: number;
  readonly acquisitionTicks: Tick;
  readonly contactForgetTicks: Tick;
  readonly tags: readonly string[];
}

export interface MemberTemplate {
  readonly id: TemplateId;
  readonly tags: readonly string[];
  readonly eraTags: readonly string[];
  readonly techTags: readonly string[];
  readonly movementType: MovementType;
  readonly sensorTemplateId: TemplateId;
  readonly weaponSlotRules: readonly WeaponSlotRule[];
  readonly roleTags: readonly string[];
  readonly silhouetteId: string;
  readonly protectionBps: number;
  readonly suppressionResistanceBps: number;
  readonly capturePowerBps: number;
}

export type WeaponTargetDomain = "ground" | "air";
export type WeaponTrajectory = "resolved" | "logical-projectile";

export interface FirePattern {
  readonly kind: "single" | "burst";
  readonly shotsPerAction: number;
}

export interface EffectDefinition {
  readonly kind: "damage" | "suppression";
  readonly amountBps: number;
}

export interface WeaponTemplate {
  readonly id: TemplateId;
  readonly tags: readonly string[];
  readonly eraTags: readonly string[];
  readonly techTags: readonly string[];
  readonly targetDomains: readonly WeaponTargetDomain[];
  readonly minimumRangeMm: number;
  readonly optimalRangeMm: number;
  readonly maximumRangeMm: number;
  readonly aimTicks: Tick;
  readonly magazineSize: number;
  readonly reloadTicks: Tick;
  readonly shotIntervalTicks: Tick;
  readonly firePattern: FirePattern;
  readonly trajectory: WeaponTrajectory;
  readonly damageEffects: readonly EffectDefinition[];
  readonly suppressionBps: number;
  readonly exposureOnFireBps: number;
}

export interface EraTemplate {
  readonly id: TemplateId;
  readonly displayName: string;
  readonly tags: readonly string[];
  readonly allowedGroupTemplateIds: readonly TemplateId[];
  readonly allowedMemberTemplateIds: readonly TemplateId[];
  readonly allowedWeaponTemplateIds: readonly TemplateId[];
  readonly allowedSensorTemplateIds: readonly TemplateId[];
}

/** Reserved content namespaces remain structural, but are not enabled by CONTENT-001. */
export interface PlatformTemplate {
  readonly id: TemplateId;
  readonly tags: readonly string[];
}

export interface AbilityTemplate {
  readonly id: TemplateId;
  readonly tags: readonly string[];
}

export interface StatusTemplate {
  readonly id: TemplateId;
  readonly tags: readonly string[];
}

export interface TerrainCatalog {
  readonly version: string;
}

export interface BattleContentBundle {
  readonly contentVersion: "content-1";
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

export interface MemberSpawn {
  readonly id: MemberId;
  readonly memberTemplateId: TemplateId;
  readonly initialHealth?: HealthState;
}

export interface GroupSpawn {
  readonly id: GroupId;
  readonly factionId: FactionId;
  readonly groupTemplateId: TemplateId;
  readonly spawn: GridCoord;
  readonly evacuation: GridCoord;
  readonly members: readonly MemberSpawn[];
}

export interface ReinforcementEntranceSetup {
  readonly id: string;
  readonly factionId: FactionId;
  readonly cells: readonly GridCoord[];
  /** Maximum number of groups that may enter through this entrance per tick. */
  readonly capacityPerTick: number;
}

export type ReinforcementBlockedPolicy = "wait" | "try-alternate" | "cancel";

export interface ReinforcementWaveSetup {
  readonly id: string;
  readonly factionId: FactionId;
  readonly arrivalTick: Tick;
  /** Preferred entrance IDs; `entranceZoneIds` is accepted for the data-contract name. */
  readonly entranceIds?: readonly string[];
  readonly entranceZoneIds?: readonly string[];
  readonly groups: readonly GroupSpawn[];
  readonly blockedPolicy: ReinforcementBlockedPolicy;
}

export type MemberSpawnInput = Omit<MemberSpawn, "memberTemplateId"> & {
  readonly memberTemplateId?: TemplateId;
};

export type GroupSpawnInput = Omit<GroupSpawn, "groupTemplateId" | "members"> & {
  readonly groupTemplateId?: TemplateId;
  readonly members: readonly MemberSpawnInput[];
};

export type ReinforcementWaveSetupInput = Omit<ReinforcementWaveSetup, "groups"> & {
  readonly groups: readonly GroupSpawnInput[];
};

export interface BattleRules {
  readonly ticksPerSecond: typeof SIMULATION_HZ;
  readonly sightRangeCells: number;
  readonly weaponRangeCells: number;
  readonly preferredRangeCells: number;
  readonly sameFactionIntelDelayTicks: Tick;
  readonly intelUpdateIntervalTicks: Tick;
  readonly contactForgetTicks: Tick;
  readonly resolutionStableTicks: Tick;
  readonly stalemateTicks: Tick;
  readonly maximumDurationTicks: Tick;
}

export type BattleModeKind = "conflict" | "defense";

export interface ConflictModeSetup {
  readonly kind: "conflict";
}

export interface DefenseObjectiveSetup {
  readonly id: ObjectiveId;
  readonly center: GridCoord;
  readonly radiusCells: number;
}

export type DefenseObjectiveRule = "all" | "count" | "sequence";

export interface DefenseModeSetup {
  readonly kind: "defense";
  readonly attackerFactionId: FactionId;
  readonly defenderFactionId: FactionId;
  /** Legacy primary objective. Multi-objective setups also expose `objectives`. */
  readonly objective: DefenseObjectiveSetup;
  readonly objectives?: readonly DefenseObjectiveSetup[];
  readonly objectiveRule?: DefenseObjectiveRule;
  readonly requiredCount?: number;
  /** Percentage of defender groups held outside the first defense line. */
  readonly reserveRatioBps?: number;
}

/** Input convenience shape for generated setups; the primary objective defaults to the first item. */
export interface DefenseModeSetupInput {
  readonly kind: "defense";
  readonly attackerFactionId: FactionId;
  readonly defenderFactionId: FactionId;
  readonly objective?: DefenseObjectiveSetup;
  readonly objectives: readonly DefenseObjectiveSetup[];
  readonly objectiveRule?: DefenseObjectiveRule;
  readonly requiredCount?: number;
  readonly reserveRatioBps?: number;
}

export type BattleModeSetup = ConflictModeSetup | DefenseModeSetup;

export interface BattleSetup {
  readonly schemaVersion: typeof BATTLE_SETUP_SCHEMA_VERSION;
  readonly rulesVersion: typeof BATTLE_RULES_VERSION;
  readonly battleId: string;
  readonly seed: string;
  readonly content: BattleContentBundle;
  readonly map: BattleMap;
  readonly factions: readonly FactionSetup[];
  readonly relations: readonly RelationSetup[];
  readonly groups: readonly GroupSpawn[];
  readonly reinforcementEntrances: readonly ReinforcementEntranceSetup[];
  readonly reinforcements: readonly ReinforcementWaveSetup[];
  readonly mode: BattleModeSetup;
  readonly rules: BattleRules;
}

/** Wire-level input accepted by validation, including the legacy two-faction version. */
export type BattleSetupInput = Omit<
  BattleSetup,
  "schemaVersion" | "rulesVersion" | "relations" | "groups" | "reinforcementEntrances" | "reinforcements" | "content"
> & {
  readonly schemaVersion: string;
  readonly rulesVersion: string;
  readonly content?: BattleContentBundle;
  readonly relations?: readonly RelationSetup[];
  readonly groups: readonly GroupSpawnInput[];
  readonly reinforcementEntrances?: readonly ReinforcementEntranceSetup[];
  readonly reinforcements?: readonly ReinforcementWaveSetupInput[];
};

export type HealthState =
  | "healthy"
  | "wounded"
  | "incapacitated"
  | "dead";

export type PresenceState = "undeployed" | "deployed" | "evacuated";

export type MoraleState = "steady" | "shaken" | "routing";

export type GroupAction =
  | "searching"
  | "moving-to-contact"
  | "engaging"
  | "routing"
  | "evacuated"
  | "combat-ineffective";

export interface RenderGroup {
  readonly id: GroupId;
  readonly factionId: FactionId;
  /** Own groups are exact; known groups are last-known intelligence contacts. */
  readonly visibility?: "own" | "known";
  readonly observedAt?: Tick;
  readonly worldX: number;
  readonly worldY: number;
  readonly worldZ: number;
  readonly headingRadians: number;
  readonly action: GroupAction;
  readonly moraleBps: number;
  readonly suppressionBps: number;
  readonly activeMembers: number;
}

export interface RenderMember {
  readonly id: MemberId;
  readonly groupId: GroupId;
  readonly factionId: FactionId;
  readonly worldX: number;
  readonly worldY: number;
  readonly worldZ: number;
  readonly health: HealthState;
  readonly presence: PresenceState;
}

export type ObjectiveControlState =
  | "defender-controlled"
  | "capturing"
  | "contested"
  | "recovering"
  | "unoccupied"
  | "attacker-controlled";

export interface RenderObjective {
  readonly id: ObjectiveId;
  readonly worldX: number;
  readonly worldY: number;
  readonly worldZ: number;
  readonly radiusMeters: number;
  readonly state: ObjectiveControlState;
  readonly progressBps: number;
  readonly attackerPower: number;
  readonly defenderPower: number;
  readonly attackerFactionId: FactionId;
  readonly defenderFactionId: FactionId;
  readonly unlocked?: boolean;
}

export interface RenderFrame {
  readonly tick: Tick;
  readonly groups: readonly RenderGroup[];
  readonly members: readonly RenderMember[];
  readonly objectives: readonly RenderObjective[];
}

export interface ContactInspection {
  readonly targetGroupId: GroupId;
  readonly lastKnown: GridCoord;
  readonly observedAt: Tick;
  readonly confidenceBps: number;
  readonly direct: boolean;
}

export interface GroupInspection {
  readonly kind: "group";
  readonly id: GroupId;
  readonly factionId: FactionId;
  readonly visibility?: "own" | "known";
  readonly observedAt?: Tick;
  readonly cell: GridCoord;
  readonly destination?: GridCoord;
  readonly action: GroupAction;
  readonly decisionReason: string;
  readonly moraleBps: number;
  readonly moraleState: MoraleState;
  readonly suppressionBps: number;
  readonly activeMembers: number;
  readonly woundedMembers: number;
  readonly incapacitatedMembers: number;
  readonly deadMembers: number;
  readonly contacts: readonly ContactInspection[];
  readonly path: readonly GridCoord[];
  readonly defenseSlot?: GridCoord;
  readonly defenseRole?: "frontline" | "reserve";
  readonly assignedObjectiveId?: ObjectiveId;
  readonly currentCover?: CoverInspection;
  readonly coverEvaluation?: CoverEvaluationInspection;
}

export interface MemberInspection {
  readonly kind: "member";
  readonly id: MemberId;
  readonly groupId: GroupId;
  readonly factionId: FactionId;
  readonly health: HealthState;
  readonly presence: PresenceState;
  readonly magazineRounds: number;
  readonly reloadTicksRemaining: Tick;
  readonly shotCooldownTicks: Tick;
}

export interface ObjectiveInspection {
  readonly kind: "objective";
  readonly id: ObjectiveId;
  readonly center: GridCoord;
  readonly radiusCells: number;
  readonly state: ObjectiveControlState;
  readonly progressBps: number;
  readonly attackerPower: number;
  readonly defenderPower: number;
  readonly attackerFactionId: FactionId;
  readonly defenderFactionId: FactionId;
  readonly unlocked?: boolean;
}

export type EntityInspection = GroupInspection | MemberInspection | ObjectiveInspection;

interface BattleEventBase {
  readonly tick: Tick;
  readonly sequence: number;
}

export type BattleEvent =
  | (BattleEventBase & {
      readonly type: "contact-spotted";
      readonly observerGroupId: GroupId;
      readonly targetGroupId: GroupId;
    })
  | (BattleEventBase & {
      readonly type: "intel-delivered";
      readonly factionId: FactionId;
      readonly targetGroupId: GroupId;
    })
  | (BattleEventBase & {
      readonly type: "weapon-fired";
      readonly groupId: GroupId;
      readonly targetGroupId: GroupId;
      readonly shotCount: number;
    })
  | (BattleEventBase & {
      readonly type: "member-health-changed";
      readonly memberId: MemberId;
      readonly groupId: GroupId;
      readonly from: HealthState;
      readonly to: HealthState;
    })
  | (BattleEventBase & {
      readonly type: "morale-changed";
      readonly groupId: GroupId;
      readonly from: MoraleState;
      readonly to: MoraleState;
    })
  | (BattleEventBase & {
      readonly type: "group-evacuated";
      readonly groupId: GroupId;
    })
  | (BattleEventBase & {
      readonly type: "reinforcement-triggered";
      readonly waveId: string;
      readonly factionId: FactionId;
    })
  | (BattleEventBase & {
      readonly type: "reinforcement-waiting";
      readonly waveId: string;
      readonly remainingGroupCount: number;
      readonly reason: "entrance-blocked" | "capacity";
    })
  | (BattleEventBase & {
      readonly type: "reinforcement-deployed";
      readonly waveId: string;
      readonly groupIds: readonly GroupId[];
      readonly entranceId: string;
    })
  | (BattleEventBase & {
      readonly type: "reinforcement-cancelled";
      readonly waveId: string;
      readonly remainingGroupIds: readonly GroupId[];
      readonly reason: "entrance-blocked" | "invalid-entrance";
    })
  | (BattleEventBase & {
      readonly type: "objective-state-changed";
      readonly objectiveId: ObjectiveId;
      readonly from: ObjectiveControlState;
      readonly to: ObjectiveControlState;
      readonly progressBps: number;
    })
  | (BattleEventBase & {
      readonly type: "battle-ended";
      readonly reason: BattleTerminationReason;
      readonly winnerFactionIds: readonly FactionId[];
    });

export type BattleTerminationReason =
  | "hostiles-eliminated"
  | "hostiles-routed"
  | "stalemate"
  | "maximum-duration"
  | "objective-captured"
  | "defense-time-expired"
  | "attackers-eliminated";

export interface MemberResult {
  readonly id: MemberId;
  readonly groupId: GroupId;
  readonly factionId: FactionId;
  readonly health: HealthState;
  readonly presence: PresenceState;
  readonly disposition: "present" | "evacuated" | "missing" | "undeployed";
  readonly deployment: "undeployed" | "deployed" | "evacuated";
}

export interface GroupResult {
  readonly id: GroupId;
  readonly factionId: FactionId;
  readonly evacuated: boolean;
  readonly moraleState: MoraleState;
  readonly activeMembers: number;
  readonly deployment: "undeployed" | "deployed" | "evacuated";
}

export interface ObjectiveResult {
  readonly id: ObjectiveId;
  readonly state: ObjectiveControlState;
  readonly progressBps: number;
  readonly attackerFactionId: FactionId;
  readonly defenderFactionId: FactionId;
  readonly unlocked?: boolean;
}

export interface BattleResult {
  readonly battleId: string;
  readonly finalTick: Tick;
  readonly outcome: "win" | "draw";
  readonly terminationReason: BattleTerminationReason;
  readonly winnerFactionIds: readonly FactionId[];
  readonly groups: readonly GroupResult[];
  readonly members: readonly MemberResult[];
  readonly objectives: readonly ObjectiveResult[];
  readonly stateHash: string;
}

export type SimulationStatus = "active" | "finished";

export interface BattleSimulation {
  readonly tick: Tick;
  readonly status: SimulationStatus;
  getSetup(): BattleSetup;
  step(count?: number): void;
  getRenderFrame(observerFactionId?: FactionId): RenderFrame;
  inspect(
    entityId: GroupId | MemberId | ObjectiveId,
    observerFactionId?: FactionId,
  ): EntityInspection | undefined;
  getResult(): BattleResult | undefined;
  drainEvents(): readonly BattleEvent[];
  getStateHash(): string;
}
