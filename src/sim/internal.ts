import type {
  BattleEvent,
  BattleResult,
  BattleSetup,
  CoverSlotId,
  CoverEvaluationReason,
  CoverThreatSource,
  FactionId,
  GridCoord,
  GroupAction,
  GroupId,
  GroupSpawn,
  HealthState,
  MemberId,
  MemberPlacement,
  MovementType,
  MoraleState,
  ObjectiveControlState,
  ObjectiveId,
  PresenceState,
  PlatformCombatState,
  PlatformComponentKind,
  PlatformComponentState,
  PlatformDisposition,
  PlatformId,
  PlatformMobilityState,
  PlatformMovementType,
  StaticObjectFacing,
  ReinforcementBlockedPolicy,
  Tick,
} from "./types";

export interface MemberState {
  readonly id: MemberId;
  readonly groupId: GroupId;
  readonly factionId: FactionId;
  readonly memberTemplateId: string;
  readonly weaponTemplateId: string;
  health: HealthState;
  presence: PresenceState;
  magazineRounds: number;
  reloadTicksRemaining: Tick;
  shotCooldownTicks: Tick;
  placement: MemberPlacement;
}

export interface PlatformComponentStateValue {
  readonly id: string;
  readonly kind: PlatformComponentKind;
  integrityBps: number;
  state: PlatformComponentState;
}

export interface PlatformState {
  readonly id: PlatformId;
  readonly groupId: GroupId;
  readonly factionId: FactionId;
  readonly platformTemplateId: string;
  readonly persistentPlatformId?: string;
  readonly movementType: PlatformMovementType;
  readonly visualTypeId: string;
  facing: StaticObjectFacing;
  mobility: PlatformMobilityState;
  combat: PlatformCombatState;
  disposition: PlatformDisposition;
  readonly crewAssignments: { readonly stationId: string; readonly memberId: MemberId }[];
  readonly components: PlatformComponentStateValue[];
}

export interface DetectionState {
  progressBps: number;
  lastCandidateTick: Tick;
  lastSentTick: Tick;
  /** Last tick at which an allied recipient received an update from this detection. */
  lastSentTickByFaction: Map<FactionId, Tick>;
  confirmed: boolean;
}

export interface ContactState {
  readonly targetGroupId: GroupId;
  lastKnown: GridCoord;
  observedAt: Tick;
  lastDirectTick: Tick;
  confidenceBps: number;
  sourceGroupId: GroupId;
}

export interface CoverThreatState {
  readonly targetGroupId: GroupId;
  readonly lastKnown: GridCoord;
  readonly observedAt: Tick;
  readonly source: CoverThreatSource;
}

export interface CoverDecisionState {
  readonly reason: CoverEvaluationReason;
  readonly selectedSlotId?: CoverSlotId;
  score: number;
  readonly evaluatedAt: Tick;
  readonly threat?: CoverThreatState;
}

export interface GroupState {
  readonly id: GroupId;
  readonly factionId: FactionId;
  readonly groupTemplateId: string;
  readonly movementType: MovementType;
  readonly evacuation: GridCoord;
  readonly members: MemberState[];
  readonly platforms: PlatformState[];
  cell: GridCoord;
  movingTo?: GridCoord;
  moveProgress: number;
  moveCost: number;
  turnTicksRemaining: Tick;
  waitAge: number;
  headingRadians: number;
  path: GridCoord[];
  pathGoal?: GridCoord;
  goal?: GridCoord;
  action: GroupAction;
  decisionReason: string;
  currentTargetId?: GroupId;
  moraleBps: number;
  moraleState: MoraleState;
  suppressionBps: number;
  patrolIndex: number;
  lastFiredTick: Tick;
  lastDecisionTick: Tick;
  localDetections: Map<GroupId, DetectionState>;
  localContacts: Map<GroupId, ContactState>;
  searchedContacts: Map<GroupId, Tick>;
  defenseSlot?: GridCoord;
  defenseRole?: "frontline" | "reserve";
  assignedObjectiveId?: ObjectiveId;
  coverDecision?: CoverDecisionState;
}

export interface IntelMessage {
  readonly sequence: number;
  readonly factionId: FactionId;
  readonly sourceGroupId: GroupId;
  readonly targetGroupId: GroupId;
  readonly observedAt: Tick;
  readonly deliveryAt: Tick;
  readonly lastKnown: GridCoord;
  readonly confidenceBps: number;
}

export interface FactionKnowledgeState {
  readonly factionId: FactionId;
  readonly contacts: Map<GroupId, ContactState>;
}

export interface ObjectiveRuntimeState {
  readonly id: ObjectiveId;
  readonly center: GridCoord;
  readonly radiusCells: number;
  readonly attackerFactionId: FactionId;
  readonly defenderFactionId: FactionId;
  state: ObjectiveControlState;
  progressBps: number;
  attackerPower: number;
  defenderPower: number;
  unlocked: boolean;
}

export interface ReinforcementRuntimeState {
  readonly id: string;
  readonly factionId: FactionId;
  readonly arrivalTick: Tick;
  readonly entranceIds: readonly string[];
  readonly groups: readonly GroupSpawn[];
  readonly blockedPolicy: ReinforcementBlockedPolicy;
  status: "pending" | "waiting" | "deployed" | "cancelled";
  deployedGroupIds: GroupId[];
  lastWaitingEventTick?: Tick;
}

export interface RuntimeState {
  readonly setup: BattleSetup;
  readonly groups: GroupState[];
  readonly groupsById: Map<GroupId, GroupState>;
  readonly membersById: Map<MemberId, MemberState>;
  readonly platformsById: Map<PlatformId, PlatformState>;
  readonly factionKnowledge: Map<FactionId, FactionKnowledgeState>;
  readonly intelQueue: IntelMessage[];
  readonly events: BattleEvent[];
  readonly occupancy: Map<number, GroupId>;
  readonly reservations: Map<number, GroupId>;
  readonly coverOccupancy: Map<CoverSlotId, GroupId>;
  readonly objectives: ObjectiveRuntimeState[];
  readonly reinforcementWaves: ReinforcementRuntimeState[];
  /** Compatibility alias for the first objective in a defense setup. */
  readonly objective?: ObjectiveRuntimeState;
  tick: Tick;
  eventSequence: number;
  intelSequence: number;
  lastMeaningfulProgressTick: Tick;
  resolutionCandidateKey?: string;
  resolutionCandidateSince?: Tick;
  result?: BattleResult;
}

export interface ShotIntent {
  readonly shooterGroupId: GroupId;
  readonly shooterMemberId: MemberId;
  readonly targetGroupId: GroupId;
  readonly shotOrdinal: number;
  readonly hitChanceBps: number;
  readonly damageBps: number;
  readonly suppressionBps: number;
  readonly hitSuppressionBps: number;
}

export interface HitIntent {
  readonly shooterGroupId: GroupId;
  readonly shooterMemberId: MemberId;
  readonly targetGroupId: GroupId;
  readonly targetMemberId: MemberId;
  readonly shotOrdinal: number;
  readonly damageBps: number;
  readonly hitSuppressionBps: number;
}
