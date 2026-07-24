export const SIMULATION_HZ = 20 as const;
export const TICK_DURATION_MS = 1_000 / SIMULATION_HZ;

export type Tick = number;
export type FactionId = string;
export type GroupId = string;
export type MemberId = string;
export type ObjectiveId = string;

export interface GridCoord {
  readonly x: number;
  readonly z: number;
}

export interface BattleMap {
  readonly width: number;
  readonly height: number;
  readonly cellSizeMm: number;
  readonly heightUnitMm: number;
  readonly heightUnits: Int16Array;
  readonly walkable: Uint8Array;
  readonly movementCosts: Uint8Array;
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
  readonly schemaVersion: "stage-1";
  readonly rulesVersion: "stage-1";
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
  readonly setup: BattleSetup;
  readonly tick: Tick;
  readonly status: SimulationStatus;
  step(count?: number): void;
  getRenderFrame(): RenderFrame;
  inspect(entityId: GroupId | MemberId | ObjectiveId): EntityInspection | undefined;
  getResult(): BattleResult | undefined;
  drainEvents(): readonly BattleEvent[];
  getStateHash(): string;
}
