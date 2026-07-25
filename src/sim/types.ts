export const SIMULATION_HZ = 20 as const;
export const TICK_DURATION_MS = 1_000 / SIMULATION_HZ;
export const BATTLE_SETUP_SCHEMA_VERSION = "stage-2" as const;
export const BATTLE_RULES_VERSION = "stage-2.3" as const;
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

export interface MemberSpawn {
  readonly id: MemberId;
  readonly initialHealth?: HealthState;
}

export interface GroupSpawn {
  readonly id: GroupId;
  readonly factionId: FactionId;
  readonly spawn: GridCoord;
  readonly evacuation: GridCoord;
  readonly members: readonly MemberSpawn[];
}

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

export interface DefenseModeSetup {
  readonly kind: "defense";
  readonly attackerFactionId: FactionId;
  readonly defenderFactionId: FactionId;
  readonly objective: DefenseObjectiveSetup;
}

export type BattleModeSetup = ConflictModeSetup | DefenseModeSetup;

export interface BattleSetup {
  readonly schemaVersion: typeof BATTLE_SETUP_SCHEMA_VERSION;
  readonly rulesVersion: typeof BATTLE_RULES_VERSION;
  readonly battleId: string;
  readonly seed: string;
  readonly map: BattleMap;
  readonly factions: readonly [FactionSetup, FactionSetup];
  readonly groups: readonly GroupSpawn[];
  readonly mode: BattleModeSetup;
  readonly rules: BattleRules;
}

export interface BattleSetupOptions {
  readonly seed?: string;
  readonly battleId?: string;
  readonly width?: number;
  readonly height?: number;
  readonly groupsPerFaction?: number;
  readonly mountainDensity?: number;
  readonly roughness?: number;
  readonly waterCoverage?: number;
  readonly wetlandCoverage?: number;
  readonly treeCoverage?: number;
  readonly rockCoverage?: number;
  readonly wallCoverage?: number;
  readonly maximumDurationSeconds?: number;
  readonly stalemateSeconds?: number;
  readonly mode?: BattleModeKind;
}

export type HealthState =
  | "healthy"
  | "wounded"
  | "incapacitated"
  | "dead";

export type PresenceState = "deployed" | "evacuated";

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
  readonly currentCover?: CoverInspection;
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
  readonly disposition: "present" | "evacuated" | "missing";
}

export interface GroupResult {
  readonly id: GroupId;
  readonly factionId: FactionId;
  readonly evacuated: boolean;
  readonly moraleState: MoraleState;
  readonly activeMembers: number;
}

export interface ObjectiveResult {
  readonly id: ObjectiveId;
  readonly state: ObjectiveControlState;
  readonly progressBps: number;
  readonly attackerFactionId: FactionId;
  readonly defenderFactionId: FactionId;
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
  getRenderFrame(): RenderFrame;
  inspect(entityId: GroupId | MemberId | ObjectiveId): EntityInspection | undefined;
  getResult(): BattleResult | undefined;
  drainEvents(): readonly BattleEvent[];
  getStateHash(): string;
}
