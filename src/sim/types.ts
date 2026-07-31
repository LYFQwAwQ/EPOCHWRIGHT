export const SIMULATION_HZ = 20 as const;
export const TICK_DURATION_MS = 1_000 / SIMULATION_HZ;
export const BATTLE_SETUP_SCHEMA_VERSION = "stage-4" as const;
export const BATTLE_RULES_VERSION = "stage-4.1" as const;
/** The fixed-altitude hover rules before authoritative altitude actions. */
export const PRE_ALTITUDE_BATTLE_RULES_VERSION = "stage-4.0" as const;
/** The final ground combined-arms contract before authoritative hover flight. */
export const PRE_AIR_BATTLE_SETUP_SCHEMA_VERSION = "stage-3.1" as const;
export const PRE_AIR_BATTLE_RULES_VERSION = "stage-3.8" as const;
/** The authoritative projectile contract before indirect fire missions. */
export const PRE_INDIRECT_BATTLE_RULES_VERSION = "stage-3.7" as const;
/** The deployment-capable artillery rules before authoritative logical projectiles. */
export const PRE_PROJECTILE_BATTLE_RULES_VERSION = "stage-3.6" as const;
/** The content-3 artillery contract before platform deployment behavior. */
export const PRE_ARTILLERY_BATTLE_SETUP_SCHEMA_VERSION = "stage-3" as const;
export const PRE_ARTILLERY_BATTLE_RULES_VERSION = "stage-3.5" as const;
/** The combined-arms tactical contract before stable vehicle engagement movement. */
export const PRE_STABLE_VEHICLE_MOVEMENT_BATTLE_RULES_VERSION = "stage-3.4" as const;
/** The transport-capable contract before combined-arms tactical AI. */
export const PRE_COMBINED_ARMS_BATTLE_RULES_VERSION = "stage-3.3" as const;
/** The armor-capable contract before explicit transport runtime behavior. */
export const PRE_TRANSPORT_BATTLE_RULES_VERSION = "stage-3.2" as const;
/** The crew-capable contract before armor penetration and component damage. */
export const PRE_DAMAGE_BATTLE_RULES_VERSION = "stage-3.1" as const;
/** The single-platform contract before crew replacement and platform weapons. */
export const PRE_CREW_BATTLE_RULES_VERSION = "stage-3.0" as const;
/** The final infantry-only contract migrates without changing stage-2 combat behavior. */
export const PRE_PLATFORM_BATTLE_SETUP_SCHEMA_VERSION = "stage-2.2" as const;
export const PRE_PLATFORM_BATTLE_RULES_VERSION = "stage-2.5" as const;
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
export type PlatformId = string;
export type ObjectiveId = string;
export type TemplateId = string;
export type TargetProfile = "personnel" | "platform";

export interface GridCoord {
  readonly x: number;
  readonly z: number;
}

export type SurfaceTypeId = (typeof SURFACE_TYPE_IDS)[keyof typeof SURFACE_TYPE_IDS];
export type WaterDepthUnits = (typeof WATER_DEPTH_UNITS)[keyof typeof WATER_DEPTH_UNITS];
export type MovementType = "foot" | "wheeled" | "tracked" | "hover";
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

export interface TargetScoreComponentsInspection {
  readonly effect: number;
  readonly confidence: number;
  readonly recency: number;
  readonly distance: number;
  readonly task: number;
  readonly retention: number;
  readonly direct: number;
}

export interface TargetCandidateInspection {
  readonly targetGroupId: GroupId;
  readonly targetProfile: TargetProfile;
  readonly targetDomain: WeaponTargetDomain;
  readonly lastKnown: GridCoord;
  readonly observedAt: Tick;
  readonly confidenceBps: number;
  readonly source: CoverThreatSource;
  readonly compatible: boolean;
  readonly score: number;
  readonly components: TargetScoreComponentsInspection;
}

export interface TargetEvaluationInspection {
  readonly evaluatedAt: Tick;
  readonly selectedTargetId?: GroupId;
  readonly candidates: readonly TargetCandidateInspection[];
}

export type VehicleEngagementReason =
  | "move-to-firing-position"
  | "hold-firing-position"
  | "orient-armor"
  | "no-firing-position";

export interface VehicleEngagementScoreComponentsInspection {
  readonly range: number;
  readonly route: number;
  readonly facing: number;
  readonly retention: number;
}

export interface VehicleEngagementInspection {
  readonly targetGroupId: GroupId;
  readonly reason: VehicleEngagementReason;
  readonly evaluatedAt: Tick;
  readonly selectedCell?: GridCoord;
  readonly desiredFacing?: StaticObjectFacing;
  readonly score: number;
  readonly components: VehicleEngagementScoreComponentsInspection;
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

export interface PlatformSlotRule {
  readonly slotId: string;
  readonly platformTemplateId: TemplateId;
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
  readonly platformSlotRules: readonly PlatformSlotRule[];
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
  readonly transportOccupancyUnits: number;
  readonly silhouetteId: string;
  readonly protectionBps: number;
  readonly suppressionResistanceBps: number;
  readonly capturePowerBps: number;
}

export type WeaponTargetDomain = "ground" | "air";
export type WeaponTrajectory = "resolved" | "logical-projectile";
export type WeaponTargeting = "direct" | "indirect";
export type FireMissionIntelSource = "local-direct" | "same-faction" | "allied";

export interface FirePattern {
  readonly kind: "single" | "burst";
  readonly shotsPerAction: number;
}

export interface MemberEffectDefinition {
  readonly kind: "damage" | "suppression";
  readonly amountBps: number;
}

export type PlatformAttackTag = "top-attack";

export interface PlatformDamageEffectDefinition {
  readonly kind: "platform-damage";
  readonly penetrationRating: number;
  readonly componentDamageBps: number;
  readonly crewDamageBps: number;
  readonly externalDamageBps?: number;
  readonly attackTags: readonly PlatformAttackTag[];
}

export type EffectDefinition = MemberEffectDefinition | PlatformDamageEffectDefinition;

export interface WeaponFireModeBase {
  readonly id: string;
  readonly targeting: WeaponTargeting;
  readonly minimumRangeMm: number;
  readonly optimalRangeMm: number;
  readonly maximumRangeMm: number;
  readonly aimTicks: Tick;
  readonly requiresDeployedPlatform: boolean;
}

export type WeaponFireModeDefinition =
  | (WeaponFireModeBase & {
      readonly targeting: "direct";
      readonly trajectory: "resolved";
    })
  | (WeaponFireModeBase & {
      readonly targeting: "direct";
      readonly trajectory: "logical-projectile";
      readonly projectileSpeedMmPerTick: number;
      readonly muzzleHeightMm: number;
      readonly apexHeightMm: number;
      readonly blastRadiusMm: number;
      readonly visualTypeId: string;
    })
  | (WeaponFireModeBase & {
      readonly targeting: "indirect";
      readonly trajectory: "logical-projectile";
      readonly projectileSpeedMmPerTick: number;
      readonly muzzleHeightMm: number;
      readonly apexHeightMm: number;
      readonly blastRadiusMm: number;
      readonly visualTypeId: string;
      readonly uncertainty: IndirectFireUncertaintyRule;
    });

export interface IndirectFireUncertaintyRule {
  readonly baseScatterMm: number;
  readonly ageScatterMmPerSecond: number;
  readonly sameFactionRelayPenaltyMm: number;
  readonly alliedRelayPenaltyMm: number;
  readonly zeroConfidencePenaltyMm: number;
  readonly maximumScatterMm: number;
  readonly maximumContactAgeTicks: Tick;
}

export interface WeaponTemplate {
  readonly id: TemplateId;
  readonly tags: readonly string[];
  readonly eraTags: readonly string[];
  readonly techTags: readonly string[];
  readonly targetDomains: readonly WeaponTargetDomain[];
  readonly fireModes: readonly WeaponFireModeDefinition[];
  readonly magazineSize: number;
  readonly reloadTicks: Tick;
  readonly shotIntervalTicks: Tick;
  readonly firePattern: FirePattern;
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
  readonly allowedPlatformTemplateIds: readonly TemplateId[];
  readonly allowedWeaponTemplateIds: readonly TemplateId[];
  readonly allowedSensorTemplateIds: readonly TemplateId[];
}

export type PlatformMovementType = Extract<MovementType, "wheeled" | "tracked" | "hover">;
export type AirAltitudeBand = "low" | "medium" | "high";
export type ArmorFace = "front" | "side" | "rear" | "top";
export type PlatformComponentKind =
  | "structure"
  | "powertrain"
  | "running-gear"
  | "lift"
  | "weapon"
  | "loader"
  | "sensor";
export type CrewStationKind =
  | "driver"
  | "pilot"
  | "gunner"
  | "commander"
  | "loader"
  | "auxiliary";

export interface PlatformComponentRule {
  readonly id: string;
  readonly kind: PlatformComponentKind;
  readonly hitWeight: number;
  readonly external: boolean;
  readonly disabledAtBps: number;
  readonly requiredStationIds: readonly string[];
  readonly weaponTemplateId?: TemplateId;
}

export interface CrewStationRule {
  readonly id: string;
  readonly kind: CrewStationKind;
  readonly requiredRoleTags: readonly string[];
  readonly replacementTicks: Tick;
  readonly substituteEfficiencyBps: number;
}

export interface PlatformDeploymentRule {
  readonly deployTicks: Tick;
  readonly packTicks: Tick;
  readonly requiredStationIds: readonly string[];
  readonly requiredComponentIds: readonly string[];
}

export interface HoverFlightRule {
  readonly kind: "hover";
  readonly safetyRadiusMm: number;
  readonly clearanceMmByBand: Partial<Readonly<Record<AirAltitudeBand, number>>>;
}

export interface PlatformTemplate {
  readonly id: TemplateId;
  readonly tags: readonly string[];
  readonly eraTags: readonly string[];
  readonly techTags: readonly string[];
  readonly movementType: PlatformMovementType;
  readonly flightRule?: HoverFlightRule;
  readonly visualTypeId: string;
  readonly occupancyUnits: number;
  readonly turnTicksPer45Degrees: Tick;
  readonly armorRatingByFace: Readonly<Record<ArmorFace, number>>;
  readonly componentRules: readonly PlatformComponentRule[];
  readonly crewStationRules: readonly CrewStationRule[];
  readonly deploymentRule?: PlatformDeploymentRule;
  readonly transportCapacityUnits: number;
  readonly embarkTicks: Tick;
  readonly disembarkTicks: Tick;
  readonly capturePowerBps: number;
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
  readonly contentVersion: "content-4";
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

export type PreAirBattleContentBundle = Omit<BattleContentBundle, "contentVersion"> & {
  readonly contentVersion: "content-3";
};

export interface PreArtilleryWeaponTemplate {
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

export interface PreArtilleryBattleContentBundle {
  readonly contentVersion: "content-2";
  readonly eraId: TemplateId;
  readonly eraTemplates: Readonly<Record<TemplateId, EraTemplate>>;
  readonly groupTemplates: Readonly<Record<TemplateId, GroupTemplate>>;
  readonly memberTemplates: Readonly<Record<TemplateId, MemberTemplate>>;
  readonly platformTemplates: Readonly<Record<TemplateId, PlatformTemplate>>;
  readonly weaponTemplates: Readonly<Record<TemplateId, PreArtilleryWeaponTemplate>>;
  readonly sensorTemplates: Readonly<Record<TemplateId, SensorTemplate>>;
  readonly abilityTemplates: Readonly<Record<TemplateId, AbilityTemplate>>;
  readonly statusTemplates: Readonly<Record<TemplateId, StatusTemplate>>;
  readonly terrainCatalog: TerrainCatalog;
}

export type LegacyEraTemplate = Omit<EraTemplate, "allowedPlatformTemplateIds">;
export type LegacyGroupTemplate = Omit<GroupTemplate, "platformSlotRules"> & {
  readonly platformSlotRules: readonly unknown[];
};
export type LegacyMemberTemplate = Omit<MemberTemplate, "transportOccupancyUnits">;

export interface LegacyBattleContentBundle {
  readonly contentVersion: "content-1";
  readonly eraId: TemplateId;
  readonly eraTemplates: Readonly<Record<TemplateId, LegacyEraTemplate>>;
  readonly groupTemplates: Readonly<Record<TemplateId, LegacyGroupTemplate>>;
  readonly memberTemplates: Readonly<Record<TemplateId, LegacyMemberTemplate>>;
  readonly platformTemplates: Readonly<Record<TemplateId, { readonly id: string; readonly tags: readonly string[] }>>;
  readonly weaponTemplates: Readonly<Record<TemplateId, PreArtilleryWeaponTemplate>>;
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

export interface CrewAssignment {
  readonly stationId: string;
  readonly memberId: MemberId;
}

export interface CrewReassignment {
  readonly memberId: MemberId;
  readonly fromStationId: string;
  readonly toStationId: string;
  readonly startedAt: Tick;
  readonly ticksRemaining: Tick;
}

export interface PlatformSpawn {
  readonly id: PlatformId;
  readonly platformTemplateId: TemplateId;
  readonly initialFacing: StaticObjectFacing;
  readonly initialAltitudeBand?: AirAltitudeBand;
  readonly crewAssignments: readonly CrewAssignment[];
  readonly persistentId?: string;
}

export interface GroupSpawn {
  readonly id: GroupId;
  readonly factionId: FactionId;
  readonly groupTemplateId: TemplateId;
  readonly spawn: GridCoord;
  readonly evacuation: GridCoord;
  readonly members: readonly MemberSpawn[];
  readonly platforms: readonly PlatformSpawn[];
}

export interface TransportAssignment {
  readonly id: string;
  readonly platformId: PlatformId;
  readonly passengerGroupId: GroupId;
  readonly initiallyEmbarked: boolean;
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

export type GroupSpawnInput = Omit<GroupSpawn, "groupTemplateId" | "members" | "platforms"> & {
  readonly groupTemplateId?: TemplateId;
  readonly members: readonly MemberSpawnInput[];
  readonly platforms?: readonly PlatformSpawn[];
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
  readonly transportAssignments: readonly TransportAssignment[];
  readonly reinforcementEntrances: readonly ReinforcementEntranceSetup[];
  readonly reinforcements: readonly ReinforcementWaveSetup[];
  readonly mode: BattleModeSetup;
  readonly rules: BattleRules;
}

/** Wire-level input accepted by validation, including the legacy two-faction version. */
export type BattleSetupInput = Omit<
  BattleSetup,
  "schemaVersion" | "rulesVersion" | "relations" | "groups" | "transportAssignments" | "reinforcementEntrances" | "reinforcements" | "content"
> & {
  readonly schemaVersion: string;
  readonly rulesVersion: string;
  readonly content?:
    | BattleContentBundle
    | PreAirBattleContentBundle
    | PreArtilleryBattleContentBundle
    | LegacyBattleContentBundle;
  readonly relations?: readonly RelationSetup[];
  readonly groups: readonly GroupSpawnInput[];
  readonly transportAssignments?: readonly TransportAssignment[];
  readonly reinforcementEntrances?: readonly ReinforcementEntranceSetup[];
  readonly reinforcements?: readonly ReinforcementWaveSetupInput[];
};

export type HealthState =
  | "healthy"
  | "wounded"
  | "incapacitated"
  | "dead";

export type PresenceState = "undeployed" | "deployed" | "evacuated";

export type TransportStatus =
  | "pending"
  | "dismounted"
  | "embarking"
  | "embarked"
  | "disembarking"
  | "trapped";

export interface TransportInspection {
  readonly assignmentId: string;
  readonly platformId: PlatformId;
  readonly passengerGroupId: GroupId;
  readonly status: TransportStatus;
  readonly ticksRemaining: Tick;
  readonly destination?: GridCoord;
  readonly dismountEvaluation?: TransportDismountEvaluationInspection;
}

export type TransportDismountReason =
  | "routing"
  | "platform-risk"
  | "direct-contact"
  | "objective-proximity"
  | "forced";

export interface TransportKnownThreatInspection {
  readonly targetGroupId: GroupId;
  readonly targetFactionId: FactionId;
  readonly targetProfile: TargetProfile;
  readonly lastKnown: GridCoord;
  readonly observedAt: Tick;
  readonly confidenceBps: number;
}

export interface TransportDismountScoreComponentsInspection {
  readonly threatSeparation: number;
  readonly platformShielding: number;
  readonly objectiveProximity: number;
}

export interface TransportDismountEvaluationInspection {
  readonly reason: TransportDismountReason;
  readonly evaluatedAt: Tick;
  readonly selectedCell?: GridCoord;
  readonly score: number;
  readonly components: TransportDismountScoreComponentsInspection;
  readonly knownThreats: readonly TransportKnownThreatInspection[];
}

export type MemberPlacement =
  | { readonly kind: "dismounted" }
  | {
      readonly kind: "crew";
      readonly platformId: PlatformId;
      readonly stationId: string;
    }
  | { readonly kind: "passenger"; readonly platformId: PlatformId };

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

export type PlatformMobilityState = "mobile" | "immobilized";
export type PlatformCombatState = "effective" | "ineffective";
export type PlatformDisposition = "crewed" | "abandoned" | "destroyed";
export type PlatformComponentState = "operational" | "damaged" | "disabled" | "destroyed";

export interface RenderPlatform {
  readonly id: PlatformId;
  readonly groupId: GroupId;
  readonly factionId: FactionId;
  readonly visibility?: "own" | "known";
  readonly observedAt?: Tick;
  readonly worldX: number;
  readonly worldY: number;
  readonly worldZ: number;
  readonly headingRadians: number;
  readonly mobility: PlatformMobilityState;
  readonly combat: PlatformCombatState;
  readonly disposition: PlatformDisposition;
  readonly damaged: boolean;
  readonly visualTypeId: string;
  readonly flight?: PlatformFlightInspection;
  readonly deployment?: PlatformDeploymentState;
}

export interface RenderProjectile {
  readonly id: string;
  readonly sourceFactionId: FactionId;
  readonly worldX: number;
  readonly worldY: number;
  readonly worldZ: number;
  readonly visualTypeId: string;
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
  readonly phase: "running" | "settling";
  readonly groups: readonly RenderGroup[];
  readonly members: readonly RenderMember[];
  readonly platforms: readonly RenderPlatform[];
  readonly projectiles: readonly RenderProjectile[];
  readonly objectives: readonly RenderObjective[];
}

export interface ContactInspection {
  readonly targetGroupId: GroupId;
  readonly targetFactionId: FactionId;
  readonly targetProfile: TargetProfile;
  readonly targetDomain: WeaponTargetDomain;
  readonly targetFlight?: PlatformFlightInspection;
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
  readonly modeEffective?: boolean;
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
  readonly targetEvaluation?: TargetEvaluationInspection;
  readonly vehicleEngagement?: VehicleEngagementInspection;
  readonly platforms: readonly PlatformSummaryInspection[];
  readonly transport?: TransportInspection;
}

export interface PlatformSummaryInspection {
  readonly id: PlatformId;
  readonly platformTemplateId: TemplateId;
  readonly movementType: PlatformMovementType;
  readonly facing: StaticObjectFacing;
  readonly mobility: PlatformMobilityState;
  readonly combat: PlatformCombatState;
  readonly disposition: PlatformDisposition;
  readonly damaged: boolean;
  readonly crewCount: number;
  readonly passengerGroupIds: readonly GroupId[];
  readonly flight?: PlatformFlightInspection;
}

export interface PlatformFlightInspection {
  readonly altitudeBand: AirAltitudeBand;
  readonly clearanceMm: number;
}

export type FlightAltitudeAction = "holding" | "climbing" | "descending";
export type FlightAltitudeEvaluationReason =
  | "hold-altitude"
  | "improve-observation"
  | "terrain-clearance"
  | "reduce-exposure"
  | "target-band-occupied"
  | "capability-unavailable";

export interface FlightAltitudeScoreComponentsInspection {
  readonly observation: number;
  readonly sensor: number;
  readonly exposure: number;
  readonly terrain: number;
  readonly retention: number;
  readonly transition: number;
}

export interface FlightAltitudeCandidateInspection {
  readonly altitudeBand: AirAltitudeBand;
  readonly clearanceMm: number;
  readonly visibleInterestCount: number;
  readonly routeClear: boolean;
  readonly score: number;
  readonly components: FlightAltitudeScoreComponentsInspection;
  readonly rejectionReason?: "terrain-clearance";
}

export interface FlightAltitudeEvaluationInspection {
  readonly evaluatedAt: Tick;
  readonly reason: FlightAltitudeEvaluationReason;
  readonly selectedAltitudeBand: AirAltitudeBand;
  readonly candidates: readonly FlightAltitudeCandidateInspection[];
}

export interface PlatformFlightControlInspection {
  readonly action: FlightAltitudeAction;
  readonly targetAltitudeBand?: AirAltitudeBand;
  readonly ticksRemaining: Tick;
  readonly evaluation?: FlightAltitudeEvaluationInspection;
}

export interface PlatformComponentInspection {
  readonly id: string;
  readonly kind: PlatformComponentKind;
  readonly integrityBps: number;
  readonly state: PlatformComponentState;
}

export type CrewStationStatus = "vacant" | "effective" | "unavailable" | "reassigning";

export interface CrewStationInspection {
  readonly id: string;
  readonly kind: CrewStationKind;
  readonly assignedMemberId?: MemberId;
  readonly status: CrewStationStatus;
  readonly efficiencyBps: number;
}

export type PlatformCapabilityReason =
  | "available"
  | "no-component"
  | "component-unavailable"
  | "crew-unavailable";

export interface PlatformCapabilityInspection {
  readonly available: boolean;
  readonly reason: PlatformCapabilityReason;
  readonly efficiencyBps: number;
}

export interface PlatformWeaponInspection extends PlatformCapabilityInspection {
  readonly componentId: string;
  readonly weaponTemplateId: TemplateId;
  readonly magazineRounds: number;
  readonly reloadTicksRemaining: Tick;
  readonly shotCooldownTicks: Tick;
}

export type PlatformDeploymentState = "packed" | "deploying" | "deployed" | "packing";

export interface FireMissionEvaluationCandidateInspection {
  readonly targetGroupId: GroupId;
  readonly source: FireMissionIntelSource;
  readonly ageTicks: Tick;
  readonly uncertaintyRadiusMm: number;
  readonly weaponCompatible: boolean;
  readonly dangerClose: boolean;
  readonly score: number;
  readonly rejectionReason?: string;
}

export interface FireMissionEvaluationInspection {
  readonly evaluatedAt: Tick;
  readonly reason: string;
  readonly selectedTargetGroupId?: GroupId;
  readonly candidates: readonly FireMissionEvaluationCandidateInspection[];
}

export interface ArtilleryMissionInspection {
  readonly id: string;
  readonly fireModeId: string;
  readonly targetGroupId: GroupId;
  readonly source: FireMissionIntelSource;
  readonly observedAt: Tick;
  readonly deliveredAt: Tick;
  readonly confidenceBps: number;
  readonly uncertaintyRadiusMm: number;
  readonly selectedOffset: { readonly dx: number; readonly dz: number };
  readonly plannedImpactCell: GridCoord;
  readonly aimTicksRemaining: Tick;
}

export interface ArtilleryPlatformInspection {
  readonly deployment: PlatformDeploymentState;
  readonly deploymentTicksRemaining: Tick;
  readonly mission?: ArtilleryMissionInspection;
  readonly evaluation?: FireMissionEvaluationInspection;
}

export interface PlatformInspection extends PlatformSummaryInspection {
  readonly kind: "platform";
  readonly groupId: GroupId;
  readonly factionId: FactionId;
  readonly cell: GridCoord;
  readonly visualTypeId: string;
  readonly armorRatingByFace: Readonly<Record<ArmorFace, number>>;
  readonly crewAssignments: readonly CrewAssignment[];
  readonly crewReassignments: readonly CrewReassignment[];
  readonly stations: readonly CrewStationInspection[];
  readonly components: readonly PlatformComponentInspection[];
  readonly mobilityCapability: PlatformCapabilityInspection;
  readonly observation: PlatformCapabilityInspection;
  readonly weapons: readonly PlatformWeaponInspection[];
  readonly transportAssignments: readonly TransportInspection[];
  readonly flightControl?: PlatformFlightControlInspection;
  readonly artillery?: ArtilleryPlatformInspection;
}

export interface MemberInspection {
  readonly kind: "member";
  readonly id: MemberId;
  readonly groupId: GroupId;
  readonly factionId: FactionId;
  readonly health: HealthState;
  readonly presence: PresenceState;
  readonly placement: MemberPlacement;
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

export type EntityInspection =
  | GroupInspection
  | MemberInspection
  | PlatformInspection
  | ObjectiveInspection;

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
      readonly fireModeId?: string;
      readonly projectileIds?: readonly string[];
    })
  | (BattleEventBase & {
      readonly type: "projectile-impacted";
      readonly projectileId: string;
      readonly sourceGroupId: GroupId;
      readonly sourcePlatformId?: PlatformId;
      readonly impactCell: GridCoord;
      readonly affectedGroupIds: readonly GroupId[];
    })
  | (BattleEventBase & {
      readonly type: "member-health-changed";
      readonly memberId: MemberId;
      readonly groupId: GroupId;
      readonly from: HealthState;
      readonly to: HealthState;
    })
  | (BattleEventBase & {
      readonly type: "crew-station-changed";
      readonly platformId: PlatformId;
      readonly groupId: GroupId;
      readonly memberId: MemberId;
      readonly fromStationId: string;
      readonly toStationId: string;
      readonly phase: "started" | "completed" | "cancelled";
    })
  | (BattleEventBase & {
      readonly type: "platform-state-changed";
      readonly platformId: PlatformId;
      readonly groupId: GroupId;
      readonly from: {
        readonly mobility: PlatformMobilityState;
        readonly combat: PlatformCombatState;
        readonly disposition: PlatformDisposition;
      };
      readonly to: {
        readonly mobility: PlatformMobilityState;
        readonly combat: PlatformCombatState;
        readonly disposition: PlatformDisposition;
      };
    })
  | (BattleEventBase & {
      readonly type: "platform-component-changed";
      readonly platformId: PlatformId;
      readonly groupId: GroupId;
      readonly componentId: string;
      readonly armorFace: ArmorFace;
      readonly penetrated: boolean;
      readonly from: {
        readonly integrityBps: number;
        readonly state: PlatformComponentState;
      };
      readonly to: {
        readonly integrityBps: number;
        readonly state: PlatformComponentState;
      };
    })
  | (BattleEventBase & {
      readonly type: "platform-deployment-changed";
      readonly platformId: PlatformId;
      readonly groupId: GroupId;
      readonly from: PlatformDeploymentState;
      readonly to: PlatformDeploymentState;
      readonly phase: "started" | "completed" | "cancelled";
      readonly reason?: "move-requested" | "capability-lost" | "platform-unavailable";
    })
  | (BattleEventBase & {
      readonly type: "artillery-mission-changed";
      readonly missionId: string;
      readonly platformId: PlatformId;
      readonly groupId: GroupId;
      readonly phase: "assigned" | "released" | "cancelled";
      readonly reason?:
        | "contact-expired"
        | "contact-replaced"
        | "danger-close"
        | "capability-lost";
    })
  | (BattleEventBase & {
      readonly type: "embarkation-changed";
      readonly assignmentId: string;
      readonly platformId: PlatformId;
      readonly passengerGroupId: GroupId;
      readonly action: "embark" | "disembark";
      readonly phase: "started" | "completed" | "cancelled" | "forced";
      readonly reason?:
        | "automatic"
        | "platform-moved"
        | "platform-unavailable"
        | "destination-blocked"
        | "platform-destroyed";
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
  readonly finalPlacement: MemberPlacement;
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

export interface PlatformComponentResult extends PlatformComponentInspection {}

export interface PlatformResult {
  readonly id: PlatformId;
  readonly groupId: GroupId;
  readonly factionId: FactionId;
  readonly persistentId?: string;
  readonly mobility: PlatformMobilityState;
  readonly combat: PlatformCombatState;
  readonly disposition: PlatformDisposition;
  readonly damaged: boolean;
  readonly components: readonly PlatformComponentResult[];
  readonly finalCrewAssignments: readonly CrewAssignment[];
  readonly finalCrewReassignments: readonly CrewReassignment[];
  readonly weaponStates: readonly PlatformWeaponInspection[];
  readonly finalFlight?: PlatformFlightInspection;
  readonly artillery?: {
    readonly finalDeploymentState: PlatformDeploymentState;
    readonly directRoundsFired: number;
    readonly indirectRoundsFired: number;
    readonly missionsAssigned: number;
  };
  readonly finalPassengerGroupIds: readonly GroupId[];
}

export interface BattleResult {
  readonly battleId: string;
  readonly rulesVersion: typeof BATTLE_RULES_VERSION;
  readonly finalTick: Tick;
  readonly settlement: {
    readonly triggeredAt: Tick;
    readonly completedAt: Tick;
    readonly projectileCountAtTrigger: number;
  };
  readonly outcome: "win" | "draw";
  readonly terminationReason: BattleTerminationReason;
  readonly winnerFactionIds: readonly FactionId[];
  readonly groups: readonly GroupResult[];
  readonly members: readonly MemberResult[];
  readonly platforms: readonly PlatformResult[];
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
  drainEvents(observerFactionId?: FactionId): readonly BattleEvent[];
  getStateHash(): string;
}
