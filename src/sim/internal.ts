import type {
  BattleEvent,
  BattleResult,
  BattleSetup,
  BattleTerminationReason,
  AirAltitudeBand,
  ArmorFace,
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
  PlatformDamageEffectDefinition,
  PlatformDeploymentState,
  PlatformFlightInspection,
  PlatformMobilityState,
  PlatformMovementType,
  StaticObjectFacing,
  TargetEvaluationInspection,
  TargetProfile,
  WeaponTargetDomain,
  TransportDismountEvaluationInspection,
  TransportStatus,
  VehicleEngagementInspection,
  ReinforcementBlockedPolicy,
  Tick,
  EffectDefinition,
  FireMissionEvaluationInspection,
  FireMissionIntelSource,
  FlightAltitudeEvaluationInspection,
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

export interface CrewReassignmentState {
  readonly memberId: MemberId;
  readonly fromStationId: string;
  readonly toStationId: string;
  readonly startedAt: Tick;
  ticksRemaining: Tick;
}

export interface PlatformWeaponStateValue {
  readonly componentId: string;
  readonly weaponTemplateId: string;
  magazineRounds: number;
  reloadTicksRemaining: Tick;
  shotCooldownTicks: Tick;
}

export interface PlatformDeploymentStateValue {
  state: PlatformDeploymentState;
  ticksRemaining: Tick;
  startedAt?: Tick;
  returnState?: Extract<PlatformDeploymentState, "packed" | "deployed">;
  directRoundsFired: number;
  indirectRoundsFired: number;
  missionsAssigned: number;
}

export interface FireMissionTargetSnapshot {
  readonly targetGroupId: GroupId;
  readonly targetFactionId: FactionId;
  readonly targetProfile: TargetProfile;
  readonly targetDomain: WeaponTargetDomain;
  readonly lastKnown: GridCoord;
  readonly observedAt: Tick;
  readonly deliveredAt: Tick;
  readonly source: FireMissionIntelSource;
  readonly confidenceBps: number;
}

export interface ArtilleryFireMissionState {
  readonly id: string;
  readonly platformId: PlatformId;
  readonly weaponComponentId: string;
  readonly fireModeId: string;
  readonly assignedAt: Tick;
  readonly snapshot: FireMissionTargetSnapshot;
  uncertaintyRadiusMm: number;
  selectedOffset: { readonly dx: number; readonly dz: number };
  plannedImpactCell: GridCoord;
  status: "aiming" | "ready" | "released" | "cancelled";
  aimTicksRemaining: Tick;
}

export interface FlightAltitudeTransitionState {
  readonly fromBand: AirAltitudeBand;
  readonly toBand: AirAltitudeBand;
  readonly startedAt: Tick;
  readonly totalTicks: Tick;
  ticksRemaining: Tick;
  readonly startClearanceMm: number;
  readonly targetClearanceMm: number;
}

export interface PlatformFlightState {
  altitudeBand: AirAltitudeBand;
  clearanceMm: number;
  transition?: FlightAltitudeTransitionState;
  evaluation?: FlightAltitudeEvaluationInspection;
}

export interface PlatformState {
  readonly id: PlatformId;
  readonly groupId: GroupId;
  readonly factionId: FactionId;
  readonly platformTemplateId: string;
  readonly persistentPlatformId?: string;
  readonly movementType: PlatformMovementType;
  readonly visualTypeId: string;
  readonly flight?: PlatformFlightState;
  cell: GridCoord;
  facing: StaticObjectFacing;
  mobility: PlatformMobilityState;
  combat: PlatformCombatState;
  disposition: PlatformDisposition;
  readonly crewAssignments: { readonly stationId: string; readonly memberId: MemberId }[];
  readonly crewReassignments: CrewReassignmentState[];
  readonly components: PlatformComponentStateValue[];
  readonly weaponStates: PlatformWeaponStateValue[];
  readonly deployment?: PlatformDeploymentStateValue;
  fireMission?: ArtilleryFireMissionState;
  fireMissionEvaluation?: FireMissionEvaluationInspection;
  readonly passengerGroupIds: GroupId[];
}

export interface LogicalProjectileState {
  readonly id: string;
  readonly sourceFactionId: FactionId;
  readonly sourceGroupId: GroupId;
  readonly sourcePlatformId?: PlatformId;
  readonly weaponTemplateId: string;
  readonly fireModeId: string;
  readonly launchedAt: Tick;
  readonly scheduledGroundImpactAt: Tick;
  readonly origin: GridCoord;
  readonly intendedAimCell: GridCoord;
  readonly plannedImpactCell: GridCoord;
  readonly totalFlightTicks: Tick;
  flightTicksElapsed: Tick;
  readonly muzzleHeightMm: number;
  readonly apexHeightMm: number;
  readonly blastRadiusMm: number;
  readonly visualTypeId: string;
  readonly damageEffects: readonly EffectDefinition[];
  readonly suppressionBps: number;
}

export interface ProjectileImpactIntent {
  readonly projectile: LogicalProjectileState;
  readonly impactCell: GridCoord;
}

export interface SettlementState {
  readonly triggeredAt: Tick;
  readonly terminationReason: BattleTerminationReason;
  readonly winnerFactionIds: readonly FactionId[];
  readonly projectileCountAtTrigger: number;
}

export interface TransportAssignmentState {
  readonly id: string;
  readonly platformId: PlatformId;
  readonly passengerGroupId: GroupId;
  readonly initiallyEmbarked: boolean;
  status: TransportStatus;
  ticksRemaining: Tick;
  destination?: GridCoord;
  lastTransitionTick: Tick;
  passengerDamageResolved: boolean;
  dismountEvaluation?: TransportDismountEvaluationInspection;
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
  readonly targetFactionId: FactionId;
  readonly targetProfile: TargetProfile;
  readonly targetDomain: WeaponTargetDomain;
  readonly targetFlight?: PlatformFlightInspection;
  lastKnown: GridCoord;
  observedAt: Tick;
  deliveredAt: Tick;
  lastDirectTick: Tick;
  confidenceBps: number;
  sourceGroupId: GroupId;
  intelSource: FireMissionIntelSource;
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
  movementType: MovementType;
  readonly evacuation: GridCoord;
  readonly members: MemberState[];
  readonly platforms: PlatformState[];
  cell: GridCoord;
  movingTo?: GridCoord;
  moveProgress: number;
  moveCost: number;
  turnTicksRemaining: Tick;
  turnGoalFacing?: StaticObjectFacing;
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
  targetEvaluation?: TargetEvaluationInspection;
  vehicleEngagement?: VehicleEngagementInspection;
}

export interface IntelMessage {
  readonly sequence: number;
  readonly factionId: FactionId;
  readonly sourceGroupId: GroupId;
  readonly targetGroupId: GroupId;
  readonly targetFactionId: FactionId;
  readonly targetProfile: TargetProfile;
  readonly targetDomain: WeaponTargetDomain;
  readonly targetFlight?: PlatformFlightInspection;
  readonly observedAt: Tick;
  readonly deliveryAt: Tick;
  readonly lastKnown: GridCoord;
  readonly confidenceBps: number;
  readonly intelSource: Exclude<FireMissionIntelSource, "local-direct">;
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
  readonly transportAssignments: TransportAssignmentState[];
  readonly transportByPassengerGroupId: Map<GroupId, TransportAssignmentState>;
  readonly transportAssignmentsByPlatformId: Map<PlatformId, TransportAssignmentState[]>;
  readonly factionKnowledge: Map<FactionId, FactionKnowledgeState>;
  readonly intelQueue: IntelMessage[];
  readonly events: BattleEvent[];
  readonly occupancy: Map<number, GroupId>;
  readonly airspaceReservations: Map<GroupId, GridCoord>;
  readonly staticPlatformOccupancy: Map<number, PlatformId>;
  readonly reservations: Map<number, GroupId>;
  readonly coverOccupancy: Map<CoverSlotId, GroupId>;
  readonly objectives: ObjectiveRuntimeState[];
  readonly reinforcementWaves: ReinforcementRuntimeState[];
  readonly projectiles: LogicalProjectileState[];
  /** Compatibility alias for the first objective in a defense setup. */
  readonly objective?: ObjectiveRuntimeState;
  tick: Tick;
  eventSequence: number;
  intelSequence: number;
  lastMeaningfulProgressTick: Tick;
  resolutionCandidateKey?: string;
  resolutionCandidateSince?: Tick;
  settlement?: SettlementState;
  result?: BattleResult;
}

export interface ShotIntent {
  readonly shooterGroupId: GroupId;
  readonly shooterEntityId: string;
  readonly targetGroupId: GroupId;
  readonly shotOrdinal: number;
  readonly hitChanceBps: number;
  readonly damageBps: number;
  readonly suppressionBps: number;
  readonly hitSuppressionBps: number;
  readonly platformDamage?: PlatformDamageEffectDefinition;
}

export interface HitIntent {
  readonly shooterGroupId: GroupId;
  readonly shooterEntityId: string;
  readonly targetGroupId: GroupId;
  readonly targetMemberId: MemberId;
  readonly shotOrdinal: number;
  readonly damageBps: number;
  readonly hitSuppressionBps: number;
  readonly randomStream?: "blast-member-effect";
  readonly randomEntityKey?: string;
  readonly randomOrdinal?: number;
}

export interface PlatformDamageIntent {
  readonly shooterGroupId: GroupId;
  readonly shooterEntityId: string;
  readonly targetGroupId: GroupId;
  readonly targetPlatformId: PlatformId;
  readonly targetComponentId?: string;
  readonly targetCrewMemberId?: MemberId;
  readonly shotOrdinal: number;
  readonly armorFace: ArmorFace;
  readonly penetrated: boolean;
  readonly componentDamageBps: number;
  readonly crewDamageBps: number;
  readonly hitSuppressionBps: number;
  readonly sourceProjectileId?: string;
}
