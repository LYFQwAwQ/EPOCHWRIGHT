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
  HealthState,
  MemberId,
  MoraleState,
  ObjectiveControlState,
  ObjectiveId,
  PresenceState,
  Tick,
} from "./types";

export interface MemberState {
  readonly id: MemberId;
  readonly groupId: GroupId;
  readonly factionId: FactionId;
  health: HealthState;
  presence: PresenceState;
  magazineRounds: number;
  reloadTicksRemaining: Tick;
  shotCooldownTicks: Tick;
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
  readonly evacuation: GridCoord;
  readonly members: MemberState[];
  cell: GridCoord;
  movingTo?: GridCoord;
  moveProgress: number;
  moveCost: number;
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
}

export interface RuntimeState {
  readonly setup: BattleSetup;
  readonly groups: GroupState[];
  readonly groupsById: Map<GroupId, GroupState>;
  readonly membersById: Map<MemberId, MemberState>;
  readonly factionKnowledge: Map<FactionId, FactionKnowledgeState>;
  readonly intelQueue: IntelMessage[];
  readonly events: BattleEvent[];
  readonly occupancy: Map<number, GroupId>;
  readonly reservations: Map<number, GroupId>;
  readonly coverOccupancy: Map<CoverSlotId, GroupId>;
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
}

export interface HitIntent {
  readonly shooterGroupId: GroupId;
  readonly targetGroupId: GroupId;
  readonly targetMemberId: MemberId;
  readonly shotOrdinal: number;
}
