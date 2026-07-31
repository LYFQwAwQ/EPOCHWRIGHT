import { StateHasher } from "./rng";
import type {
  AbilityTemplate,
  BattleContentBundle,
  EffectDefinition,
  EraTemplate,
  GroupTemplate,
  LegacyBattleContentBundle,
  MemberTemplate,
  PlatformTemplate,
  PrePassiveAbilityBattleContentBundle,
  PrePassiveAbilityMemberTemplate,
  PreAirUnitsBattleContentBundle,
  PreAirCombatBattleContentBundle,
  PreAirBattleContentBundle,
  PreArtilleryBattleContentBundle,
  PreArtilleryWeaponTemplate,
  SensorTemplate,
  StatusTemplate,
  TemplateId,
  WeaponFireModeDefinition,
  WeaponTemplate,
} from "./types";
import {
  MAX_ARTILLERY_SCATTER_MM,
  MAX_LOGICAL_PROJECTILE_FLIGHT_TICKS,
} from "./artillery";

export const BATTLE_CONTENT_VERSION = "content-7" as const;
export const PRE_PASSIVE_ABILITY_BATTLE_CONTENT_VERSION = "content-6" as const;
export const PRE_AIR_UNITS_BATTLE_CONTENT_VERSION = "content-5" as const;
export const PRE_AIR_COMBAT_BATTLE_CONTENT_VERSION = "content-4" as const;
export const PRE_AIR_BATTLE_CONTENT_VERSION = "content-3" as const;
export const DEFAULT_ERA_ID = "era-default-v1" as const;
export const DEFAULT_GROUP_TEMPLATE_ID = "infantry-rifle-squad-v1" as const;
export const DEFAULT_MEMBER_TEMPLATE_ID = "infantry-rifleman-v1" as const;
export const DEFAULT_PASSIVE_GROUP_TEMPLATE_ID = "infantry-disciplined-squad-v1" as const;
export const DEFAULT_PASSIVE_MEMBER_TEMPLATE_ID = "infantry-squad-leader-v1" as const;
export const DEFAULT_PASSIVE_ABILITY_TEMPLATE_ID = "formation-discipline-v1" as const;
export const DEFAULT_SENSOR_TEMPLATE_ID = "infantry-eyesight-v1" as const;
export const DEFAULT_WEAPON_TEMPLATE_ID = "rifle-standard-v1" as const;
export const DEFAULT_PLATFORM_WEAPON_TEMPLATE_ID = "vehicle-autocannon-v1" as const;
export const DEFAULT_ARTILLERY_WEAPON_TEMPLATE_ID = "artillery-howitzer-v1" as const;
export const DEFAULT_AIR_TO_GROUND_WEAPON_TEMPLATE_ID = "air-autocannon-v1" as const;
export const DEFAULT_AIR_TO_AIR_WEAPON_TEMPLATE_ID = "air-to-air-cannon-v1" as const;
export const DEFAULT_AIR_DEFENSE_WEAPON_TEMPLATE_ID = "air-defense-cannon-v1" as const;
export const DEFAULT_CREW_MEMBER_TEMPLATE_ID = "vehicle-driver-v1" as const;
export const DEFAULT_GUNNER_MEMBER_TEMPLATE_ID = "vehicle-gunner-v1" as const;
export const DEFAULT_RELIEF_CREW_MEMBER_TEMPLATE_ID = "vehicle-relief-crew-v1" as const;
export const DEFAULT_WHEELED_GROUP_TEMPLATE_ID = "vehicle-wheeled-scout-group-v1" as const;
export const DEFAULT_TRACKED_GROUP_TEMPLATE_ID = "vehicle-tracked-scout-group-v1" as const;
export const DEFAULT_ARTILLERY_GROUP_TEMPLATE_ID = "artillery-self-propelled-group-v1" as const;
export const DEFAULT_WHEELED_PLATFORM_TEMPLATE_ID = "vehicle-wheeled-scout-v1" as const;
export const DEFAULT_TRACKED_PLATFORM_TEMPLATE_ID = "vehicle-tracked-scout-v1" as const;
export const DEFAULT_ARTILLERY_PLATFORM_TEMPLATE_ID = "artillery-self-propelled-v1" as const;
export const DEFAULT_AIR_RECON_GROUP_TEMPLATE_ID = "air-recon-helicopter-group-v1" as const;
export const DEFAULT_AIR_RECON_PLATFORM_TEMPLATE_ID = "air-recon-helicopter-v1" as const;
export const DEFAULT_AIR_ATTACK_GROUP_TEMPLATE_ID = "air-attack-helicopter-group-v1" as const;
export const DEFAULT_AIR_ATTACK_PLATFORM_TEMPLATE_ID = "air-attack-helicopter-v1" as const;
export const DEFAULT_AIR_DRONE_GROUP_TEMPLATE_ID = "air-scout-drone-group-v1" as const;
export const DEFAULT_AIR_DRONE_PLATFORM_TEMPLATE_ID = "air-scout-drone-v1" as const;
export const DEFAULT_PILOT_MEMBER_TEMPLATE_ID = "air-pilot-v1" as const;
export const DEFAULT_AIR_OBSERVER_MEMBER_TEMPLATE_ID = "air-observer-v1" as const;
export const DEFAULT_DRONE_OPERATOR_MEMBER_TEMPLATE_ID = "air-drone-operator-v1" as const;

const DEFAULT_CELL_SIZE_MM = 4_000;

export interface DefaultBattleContentOptions {
  readonly cellSizeMm?: number;
  readonly sightRangeCells?: number;
  readonly weaponRangeCells?: number;
  readonly preferredRangeCells?: number;
  readonly contactForgetTicks?: number;
}

export function createDefaultBattleContent(
  options: DefaultBattleContentOptions = {},
): BattleContentBundle {
  const cellSizeMm = options.cellSizeMm ?? DEFAULT_CELL_SIZE_MM;
  const weaponRangeCells = options.weaponRangeCells ?? 11;
  const preferredRangeCells = Math.min(options.preferredRangeCells ?? 7, weaponRangeCells);
  const era: EraTemplate = {
    id: DEFAULT_ERA_ID,
    displayName: "默认时代",
    tags: ["default"],
    allowedGroupTemplateIds: [
      DEFAULT_GROUP_TEMPLATE_ID,
      DEFAULT_PASSIVE_GROUP_TEMPLATE_ID,
      DEFAULT_WHEELED_GROUP_TEMPLATE_ID,
      DEFAULT_TRACKED_GROUP_TEMPLATE_ID,
      DEFAULT_ARTILLERY_GROUP_TEMPLATE_ID,
      DEFAULT_AIR_RECON_GROUP_TEMPLATE_ID,
      DEFAULT_AIR_ATTACK_GROUP_TEMPLATE_ID,
      DEFAULT_AIR_DRONE_GROUP_TEMPLATE_ID,
    ],
    allowedMemberTemplateIds: [
      DEFAULT_MEMBER_TEMPLATE_ID,
      DEFAULT_PASSIVE_MEMBER_TEMPLATE_ID,
      DEFAULT_CREW_MEMBER_TEMPLATE_ID,
      DEFAULT_GUNNER_MEMBER_TEMPLATE_ID,
      DEFAULT_RELIEF_CREW_MEMBER_TEMPLATE_ID,
      DEFAULT_PILOT_MEMBER_TEMPLATE_ID,
      DEFAULT_AIR_OBSERVER_MEMBER_TEMPLATE_ID,
      DEFAULT_DRONE_OPERATOR_MEMBER_TEMPLATE_ID,
    ],
    allowedPlatformTemplateIds: [
      DEFAULT_WHEELED_PLATFORM_TEMPLATE_ID,
      DEFAULT_TRACKED_PLATFORM_TEMPLATE_ID,
      DEFAULT_ARTILLERY_PLATFORM_TEMPLATE_ID,
      DEFAULT_AIR_RECON_PLATFORM_TEMPLATE_ID,
      DEFAULT_AIR_ATTACK_PLATFORM_TEMPLATE_ID,
      DEFAULT_AIR_DRONE_PLATFORM_TEMPLATE_ID,
    ],
    allowedWeaponTemplateIds: [
      DEFAULT_WEAPON_TEMPLATE_ID,
      DEFAULT_PLATFORM_WEAPON_TEMPLATE_ID,
      DEFAULT_ARTILLERY_WEAPON_TEMPLATE_ID,
      DEFAULT_AIR_TO_GROUND_WEAPON_TEMPLATE_ID,
      DEFAULT_AIR_TO_AIR_WEAPON_TEMPLATE_ID,
      DEFAULT_AIR_DEFENSE_WEAPON_TEMPLATE_ID,
    ],
    allowedSensorTemplateIds: [DEFAULT_SENSOR_TEMPLATE_ID],
  };
  const group: GroupTemplate = {
    id: DEFAULT_GROUP_TEMPLATE_ID,
    tags: ["infantry", "squad"],
    eraTags: [DEFAULT_ERA_ID],
    techTags: ["basic-firearms"],
    memberSlotRules: [
      {
        slotId: "riflemen",
        memberTemplateId: DEFAULT_MEMBER_TEMPLATE_ID,
        count: 8,
        required: true,
      },
    ],
    platformSlotRules: [],
    cohesionRadiusCells: 2,
    capturePowerScaleBps: 10_000,
    behaviorProfileId: "infantry-basic",
  };
  const member: MemberTemplate = {
    id: DEFAULT_MEMBER_TEMPLATE_ID,
    tags: ["infantry", "rifleman"],
    eraTags: [DEFAULT_ERA_ID],
    techTags: ["basic-firearms"],
    movementType: "foot",
    sensorTemplateId: DEFAULT_SENSOR_TEMPLATE_ID,
    weaponSlotRules: [
      {
        slotId: "primary",
        weaponTemplateId: DEFAULT_WEAPON_TEMPLATE_ID,
        count: 1,
        required: true,
      },
    ],
    abilityTemplateIds: [],
    roleTags: ["rifleman"],
    transportOccupancyUnits: 1,
    silhouetteId: "infantry",
    protectionBps: 0,
    suppressionResistanceBps: 0,
    capturePowerBps: 10_000,
  };
  const passiveAbility: AbilityTemplate = {
    id: DEFAULT_PASSIVE_ABILITY_TEMPLATE_ID,
    displayName: "队列纪律",
    tags: ["discipline", "infantry"],
    kind: "passive",
    targetRule: "own-group",
    conditions: [
      { kind: "health", states: ["healthy", "wounded"] },
      { kind: "presence", states: ["deployed"] },
    ],
    effects: [
      {
        kind: "attribute-modifier",
        attribute: "suppression-resistance-bps",
        modifierBps: 2_000,
      },
    ],
  };
  const passiveMember: MemberTemplate = {
    ...member,
    id: DEFAULT_PASSIVE_MEMBER_TEMPLATE_ID,
    tags: ["infantry", "leader"],
    roleTags: ["rifleman", "leader"],
    abilityTemplateIds: [DEFAULT_PASSIVE_ABILITY_TEMPLATE_ID],
  };
  const passiveGroup: GroupTemplate = {
    ...group,
    id: DEFAULT_PASSIVE_GROUP_TEMPLATE_ID,
    tags: ["infantry", "squad", "disciplined"],
    memberSlotRules: [
      {
        slotId: "leader",
        memberTemplateId: DEFAULT_PASSIVE_MEMBER_TEMPLATE_ID,
        count: 1,
        required: true,
      },
      {
        slotId: "riflemen",
        memberTemplateId: DEFAULT_MEMBER_TEMPLATE_ID,
        count: 7,
        required: true,
      },
    ],
  };
  const crewMember: MemberTemplate = {
    ...member,
    id: DEFAULT_CREW_MEMBER_TEMPLATE_ID,
    tags: ["crew", "driver"],
    roleTags: ["driver"],
    silhouetteId: "vehicle-crew",
    capturePowerBps: 0,
  };
  const gunnerMember: MemberTemplate = {
    ...crewMember,
    id: DEFAULT_GUNNER_MEMBER_TEMPLATE_ID,
    tags: ["crew", "gunner"],
    roleTags: ["gunner"],
  };
  const reliefCrewMember: MemberTemplate = {
    ...crewMember,
    id: DEFAULT_RELIEF_CREW_MEMBER_TEMPLATE_ID,
    tags: ["crew", "relief"],
    roleTags: ["driver", "gunner"],
  };
  const pilotMember: MemberTemplate = {
    ...crewMember,
    id: DEFAULT_PILOT_MEMBER_TEMPLATE_ID,
    tags: ["aircrew", "pilot"],
    roleTags: ["pilot"],
    silhouetteId: "aircrew",
  };
  const airObserverMember: MemberTemplate = {
    ...crewMember,
    id: DEFAULT_AIR_OBSERVER_MEMBER_TEMPLATE_ID,
    tags: ["aircrew", "observer"],
    roleTags: ["observer"],
    silhouetteId: "aircrew",
  };
  const droneOperatorMember: MemberTemplate = {
    ...crewMember,
    id: DEFAULT_DRONE_OPERATOR_MEMBER_TEMPLATE_ID,
    tags: ["aircrew", "drone-operator"],
    roleTags: ["pilot", "observer"],
    silhouetteId: "aircrew",
  };
  const wheeledPlatform = createDefaultPlatformTemplate(
    DEFAULT_WHEELED_PLATFORM_TEMPLATE_ID,
    "wheeled",
    "vehicle-wheeled-scout",
    2,
  );
  const trackedPlatform = createDefaultPlatformTemplate(
    DEFAULT_TRACKED_PLATFORM_TEMPLATE_ID,
    "tracked",
    "vehicle-tracked-scout",
    1,
  );
  const artilleryPlatform = createDefaultPlatformTemplate(
    DEFAULT_ARTILLERY_PLATFORM_TEMPLATE_ID,
    "tracked",
    "artillery-self-propelled",
    1,
    {
      weaponTemplateId: DEFAULT_ARTILLERY_WEAPON_TEMPLATE_ID,
      tags: ["vehicle", "artillery", "tracked"],
      deploymentRule: {
        deployTicks: 20,
        packTicks: 16,
        requiredStationIds: ["gunner"],
        requiredComponentIds: ["primary-weapon"],
      },
    },
  );
  const airReconPlatform = createDefaultAirReconPlatformTemplate();
  const airAttackPlatform = createDefaultAirAttackPlatformTemplate();
  const airDronePlatform = createDefaultAirDronePlatformTemplate();
  const wheeledGroup = createDefaultVehicleGroupTemplate(
    DEFAULT_WHEELED_GROUP_TEMPLATE_ID,
    DEFAULT_WHEELED_PLATFORM_TEMPLATE_ID,
  );
  const trackedGroup = createDefaultVehicleGroupTemplate(
    DEFAULT_TRACKED_GROUP_TEMPLATE_ID,
    DEFAULT_TRACKED_PLATFORM_TEMPLATE_ID,
  );
  const artilleryGroup = createDefaultVehicleGroupTemplate(
    DEFAULT_ARTILLERY_GROUP_TEMPLATE_ID,
    DEFAULT_ARTILLERY_PLATFORM_TEMPLATE_ID,
    ["vehicle", "artillery"],
  );
  const airReconGroup = createDefaultAirReconGroupTemplate();
  const airAttackGroup = createDefaultAirAttackGroupTemplate();
  const airDroneGroup = createDefaultAirDroneGroupTemplate();
  const sensor: SensorTemplate = {
    id: DEFAULT_SENSOR_TEMPLATE_ID,
    rangeMm: (options.sightRangeCells ?? 13) * cellSizeMm,
    acquisitionTicks: 1,
    contactForgetTicks: options.contactForgetTicks ?? 400,
    tags: ["visual", "human"]
  };
  const weapon: WeaponTemplate = {
    id: DEFAULT_WEAPON_TEMPLATE_ID,
    tags: ["small-arms", "rifle"],
    eraTags: [DEFAULT_ERA_ID],
    techTags: ["basic-firearms"],
    targetDomains: ["ground"],
    fireModes: [
      {
        id: "direct",
        targeting: "direct",
        trajectory: "resolved",
        minimumRangeMm: Math.min(1, weaponRangeCells) * cellSizeMm,
        optimalRangeMm: preferredRangeCells * cellSizeMm,
        maximumRangeMm: weaponRangeCells * cellSizeMm,
        aimTicks: 0,
        requiresDeployedPlatform: false,
      },
    ],
    magazineSize: 12,
    reloadTicks: 36,
    shotIntervalTicks: 7,
    firePattern: { kind: "single", shotsPerAction: 1 },
    damageEffects: [
      { kind: "damage", amountBps: 10_000 },
      { kind: "suppression", amountBps: 90 },
    ],
    suppressionBps: 22,
    exposureOnFireBps: 1_100,
  };
  const platformWeapon: WeaponTemplate = {
    ...weapon,
    id: DEFAULT_PLATFORM_WEAPON_TEMPLATE_ID,
    tags: ["autocannon", "anti-vehicle"],
    techTags: ["basic-vehicles"],
    magazineSize: 8,
    reloadTicks: 50,
    shotIntervalTicks: 12,
    damageEffects: [
      { kind: "damage", amountBps: 12_000 },
      { kind: "suppression", amountBps: 180 },
      {
        kind: "platform-damage",
        penetrationRating: 110,
        componentDamageBps: 4_000,
        crewDamageBps: 8_000,
        externalDamageBps: 1_500,
        attackTags: [],
      },
    ],
    suppressionBps: 75,
    exposureOnFireBps: 2_400,
  };
  const artilleryWeapon: WeaponTemplate = {
    ...platformWeapon,
    id: DEFAULT_ARTILLERY_WEAPON_TEMPLATE_ID,
    tags: ["artillery", "howitzer", "anti-vehicle"],
    techTags: ["basic-artillery"],
    fireModes: [
      {
        ...platformWeapon.fireModes[0]!,
        trajectory: "logical-projectile" as const,
        requiresDeployedPlatform: true,
        projectileSpeedMmPerTick: 8_000,
        muzzleHeightMm: 2_000,
        apexHeightMm: 12_000,
        blastRadiusMm: 8_000,
        visualTypeId: "shell-medium-v1",
      },
      {
        id: "indirect",
        targeting: "indirect",
        trajectory: "logical-projectile",
        minimumRangeMm: 40_000,
        optimalRangeMm: 120_000,
        maximumRangeMm: 240_000,
        aimTicks: 20,
        requiresDeployedPlatform: true,
        projectileSpeedMmPerTick: 6_000,
        muzzleHeightMm: 2_000,
        apexHeightMm: 48_000,
        blastRadiusMm: 8_000,
        visualTypeId: "shell-medium-v1",
        uncertainty: {
          baseScatterMm: 4_000,
          ageScatterMmPerSecond: 1_000,
          sameFactionRelayPenaltyMm: 2_000,
          alliedRelayPenaltyMm: 6_000,
          zeroConfidencePenaltyMm: 12_000,
          maximumScatterMm: 40_000,
          maximumContactAgeTicks: 200,
        },
      },
    ],
    magazineSize: 6,
    reloadTicks: 60,
    shotIntervalTicks: 20,
    suppressionBps: 120,
    exposureOnFireBps: 3_000,
  };
  const airToGroundWeapon: WeaponTemplate = {
    ...platformWeapon,
    id: DEFAULT_AIR_TO_GROUND_WEAPON_TEMPLATE_ID,
    tags: ["air-weapon", "autocannon", "air-to-ground", "anti-vehicle"],
    techTags: ["basic-aviation"],
    targetDomains: ["ground"],
    fireModes: [{
      id: "direct",
      targeting: "direct",
      trajectory: "resolved",
      minimumRangeMm: 0,
      optimalRangeMm: 24_000,
      maximumRangeMm: 64_000,
      aimTicks: 0,
      requiresDeployedPlatform: false,
    }],
    magazineSize: 10,
    reloadTicks: 50,
    shotIntervalTicks: 10,
    damageEffects: [
      { kind: "damage", amountBps: 14_000 },
      { kind: "suppression", amountBps: 220 },
      {
        kind: "platform-damage",
        penetrationRating: 150,
        componentDamageBps: 5_000,
        crewDamageBps: 7_000,
        externalDamageBps: 2_000,
        attackTags: ["top-attack"],
      },
    ],
    suppressionBps: 90,
    exposureOnFireBps: 3_000,
  };
  const airToAirWeapon: WeaponTemplate = {
    ...platformWeapon,
    id: DEFAULT_AIR_TO_AIR_WEAPON_TEMPLATE_ID,
    tags: ["air-weapon", "autocannon", "air-to-air"],
    techTags: ["basic-aviation"],
    targetDomains: ["air"],
    fireModes: [{
      id: "direct",
      targeting: "direct",
      trajectory: "resolved",
      minimumRangeMm: 0,
      optimalRangeMm: 36_000,
      maximumRangeMm: 120_000,
      aimTicks: 0,
      requiresDeployedPlatform: false,
    }],
    magazineSize: 8,
    reloadTicks: 54,
    shotIntervalTicks: 12,
    damageEffects: [
      { kind: "suppression", amountBps: 180 },
      {
        kind: "platform-damage",
        penetrationRating: 130,
        componentDamageBps: 5_000,
        crewDamageBps: 7_000,
        externalDamageBps: 2_000,
        attackTags: [],
      },
    ],
    suppressionBps: 75,
    exposureOnFireBps: 3_000,
  };
  const airDefenseWeapon: WeaponTemplate = {
    ...platformWeapon,
    id: DEFAULT_AIR_DEFENSE_WEAPON_TEMPLATE_ID,
    tags: ["air-defense", "autocannon", "anti-air"],
    techTags: ["basic-air-defense"],
    targetDomains: ["air"],
    fireModes: [{
      id: "direct",
      targeting: "direct",
      trajectory: "resolved",
      minimumRangeMm: 0,
      optimalRangeMm: 28_000,
      maximumRangeMm: 60_000,
      aimTicks: 0,
      requiresDeployedPlatform: false,
    }],
    magazineSize: 8,
    reloadTicks: 48,
    shotIntervalTicks: 10,
    damageEffects: [
      { kind: "suppression", amountBps: 200 },
      {
        kind: "platform-damage",
        penetrationRating: 140,
        componentDamageBps: 5_000,
        crewDamageBps: 8_000,
        externalDamageBps: 2_000,
        attackTags: [],
      },
    ],
    suppressionBps: 85,
    exposureOnFireBps: 2_800,
  };

  return {
    contentVersion: BATTLE_CONTENT_VERSION,
    eraId: DEFAULT_ERA_ID,
    eraTemplates: { [era.id]: era },
    groupTemplates: {
      [group.id]: group,
      [passiveGroup.id]: passiveGroup,
      [wheeledGroup.id]: wheeledGroup,
      [trackedGroup.id]: trackedGroup,
      [artilleryGroup.id]: artilleryGroup,
      [airReconGroup.id]: airReconGroup,
      [airAttackGroup.id]: airAttackGroup,
      [airDroneGroup.id]: airDroneGroup,
    },
    memberTemplates: {
      [member.id]: member,
      [passiveMember.id]: passiveMember,
      [crewMember.id]: crewMember,
      [gunnerMember.id]: gunnerMember,
      [reliefCrewMember.id]: reliefCrewMember,
      [pilotMember.id]: pilotMember,
      [airObserverMember.id]: airObserverMember,
      [droneOperatorMember.id]: droneOperatorMember,
    },
    platformTemplates: {
      [wheeledPlatform.id]: wheeledPlatform,
      [trackedPlatform.id]: trackedPlatform,
      [artilleryPlatform.id]: artilleryPlatform,
      [airReconPlatform.id]: airReconPlatform,
      [airAttackPlatform.id]: airAttackPlatform,
      [airDronePlatform.id]: airDronePlatform,
    },
    weaponTemplates: {
      [weapon.id]: weapon,
      [platformWeapon.id]: platformWeapon,
      [artilleryWeapon.id]: artilleryWeapon,
      [airToGroundWeapon.id]: airToGroundWeapon,
      [airToAirWeapon.id]: airToAirWeapon,
      [airDefenseWeapon.id]: airDefenseWeapon,
    },
    sensorTemplates: { [sensor.id]: sensor },
    abilityTemplates: { [passiveAbility.id]: passiveAbility },
    statusTemplates: {},
    terrainCatalog: { version: "map-2" },
  };
}

function createDefaultVehicleGroupTemplate(
  id: string,
  platformTemplateId: string,
  tags: readonly string[] = ["vehicle", "scout"],
): GroupTemplate {
  return {
    id,
    tags: [...tags],
    eraTags: [DEFAULT_ERA_ID],
    techTags: ["basic-vehicles"],
    memberSlotRules: [
      {
        slotId: "driver",
        memberTemplateId: DEFAULT_CREW_MEMBER_TEMPLATE_ID,
        count: 1,
        required: true,
      },
      {
        slotId: "gunner",
        memberTemplateId: DEFAULT_GUNNER_MEMBER_TEMPLATE_ID,
        count: 1,
        required: true,
      },
      {
        slotId: "relief",
        memberTemplateId: DEFAULT_RELIEF_CREW_MEMBER_TEMPLATE_ID,
        count: 1,
        required: true,
      },
    ],
    platformSlotRules: [
      { slotId: "vehicle", platformTemplateId, count: 1, required: true },
    ],
    cohesionRadiusCells: 0,
    capturePowerScaleBps: 10_000,
    behaviorProfileId: "vehicle-basic",
  };
}

function createDefaultAirReconGroupTemplate(): GroupTemplate {
  return {
    id: DEFAULT_AIR_RECON_GROUP_TEMPLATE_ID,
    tags: ["air", "recon", "helicopter"],
    eraTags: [DEFAULT_ERA_ID],
    techTags: ["basic-aviation"],
    memberSlotRules: [
      {
        slotId: "pilot",
        memberTemplateId: DEFAULT_PILOT_MEMBER_TEMPLATE_ID,
        count: 1,
        required: true,
      },
      {
        slotId: "observer",
        memberTemplateId: DEFAULT_AIR_OBSERVER_MEMBER_TEMPLATE_ID,
        count: 1,
        required: true,
      },
    ],
    platformSlotRules: [
      {
        slotId: "aircraft",
        platformTemplateId: DEFAULT_AIR_RECON_PLATFORM_TEMPLATE_ID,
        count: 1,
        required: true,
      },
    ],
    cohesionRadiusCells: 0,
    capturePowerScaleBps: 0,
    behaviorProfileId: "air-recon",
  };
}

function createDefaultAirReconPlatformTemplate(): PlatformTemplate {
  return {
    id: DEFAULT_AIR_RECON_PLATFORM_TEMPLATE_ID,
    tags: ["air", "recon", "helicopter", "hover"],
    eraTags: [DEFAULT_ERA_ID],
    techTags: ["basic-aviation"],
    movementType: "hover",
    flightRule: {
      kind: "hover",
      safetyRadiusMm: 2_000,
      clearanceMmByBand: {
        low: 12_000,
        medium: 40_000,
        high: 80_000,
      },
    },
    visualTypeId: "air-recon-helicopter",
    occupancyUnits: 1,
    turnTicksPer45Degrees: 1,
    armorRatingByFace: { front: 20, side: 15, rear: 10, top: 10 },
    componentRules: [
      {
        id: "structure",
        kind: "structure",
        hitWeight: 4,
        external: false,
        disabledAtBps: 0,
        requiredStationIds: [],
      },
      {
        id: "powertrain",
        kind: "powertrain",
        hitWeight: 2,
        external: false,
        disabledAtBps: 2_500,
        requiredStationIds: ["pilot"],
      },
      {
        id: "lift",
        kind: "lift",
        hitWeight: 3,
        external: true,
        disabledAtBps: 2_500,
        requiredStationIds: ["pilot"],
      },
      {
        id: "sensor",
        kind: "sensor",
        hitWeight: 1,
        external: true,
        disabledAtBps: 2_500,
        requiredStationIds: ["observer"],
      },
    ],
    crewStationRules: [
      {
        id: "pilot",
        kind: "pilot",
        requiredRoleTags: ["pilot"],
        replacementTicks: 20,
        substituteEfficiencyBps: 0,
      },
      {
        id: "observer",
        kind: "auxiliary",
        requiredRoleTags: ["observer"],
        replacementTicks: 20,
        substituteEfficiencyBps: 0,
      },
    ],
    transportCapacityUnits: 0,
    embarkTicks: 0,
    disembarkTicks: 0,
    capturePowerBps: 0,
  };
}

function createDefaultAirAttackGroupTemplate(): GroupTemplate {
  return {
    id: DEFAULT_AIR_ATTACK_GROUP_TEMPLATE_ID,
    tags: ["air", "combat", "helicopter"],
    eraTags: [DEFAULT_ERA_ID],
    techTags: ["basic-aviation"],
    memberSlotRules: [
      {
        slotId: "pilot",
        memberTemplateId: DEFAULT_PILOT_MEMBER_TEMPLATE_ID,
        count: 1,
        required: true,
      },
      {
        slotId: "gunner",
        memberTemplateId: DEFAULT_GUNNER_MEMBER_TEMPLATE_ID,
        count: 1,
        required: true,
      },
    ],
    platformSlotRules: [
      {
        slotId: "aircraft",
        platformTemplateId: DEFAULT_AIR_ATTACK_PLATFORM_TEMPLATE_ID,
        count: 1,
        required: true,
      },
    ],
    cohesionRadiusCells: 0,
    capturePowerScaleBps: 0,
    behaviorProfileId: "air-combat",
  };
}

function createDefaultAirAttackPlatformTemplate(): PlatformTemplate {
  return {
    id: DEFAULT_AIR_ATTACK_PLATFORM_TEMPLATE_ID,
    tags: ["air", "combat", "helicopter", "hover"],
    eraTags: [DEFAULT_ERA_ID],
    techTags: ["basic-aviation"],
    movementType: "hover",
    flightRule: {
      kind: "hover",
      safetyRadiusMm: 2_500,
      clearanceMmByBand: {
        low: 14_000,
        medium: 44_000,
        high: 84_000,
      },
    },
    visualTypeId: "air-attack-helicopter",
    occupancyUnits: 1,
    turnTicksPer45Degrees: 1,
    armorRatingByFace: { front: 35, side: 25, rear: 18, top: 15 },
    componentRules: [
      {
        id: "structure",
        kind: "structure",
        hitWeight: 4,
        external: false,
        disabledAtBps: 0,
        requiredStationIds: [],
      },
      {
        id: "powertrain",
        kind: "powertrain",
        hitWeight: 2,
        external: false,
        disabledAtBps: 2_500,
        requiredStationIds: ["pilot"],
      },
      {
        id: "lift",
        kind: "lift",
        hitWeight: 3,
        external: true,
        disabledAtBps: 2_500,
        requiredStationIds: ["pilot"],
      },
      {
        id: "sensor",
        kind: "sensor",
        hitWeight: 1,
        external: true,
        disabledAtBps: 2_500,
        requiredStationIds: ["gunner"],
      },
      {
        id: "air-to-ground-weapon",
        kind: "weapon",
        hitWeight: 2,
        external: true,
        disabledAtBps: 2_500,
        requiredStationIds: ["gunner"],
        weaponTemplateId: DEFAULT_AIR_TO_GROUND_WEAPON_TEMPLATE_ID,
      },
      {
        id: "air-to-air-weapon",
        kind: "weapon",
        hitWeight: 2,
        external: true,
        disabledAtBps: 2_500,
        requiredStationIds: ["gunner"],
        weaponTemplateId: DEFAULT_AIR_TO_AIR_WEAPON_TEMPLATE_ID,
      },
    ],
    crewStationRules: [
      {
        id: "pilot",
        kind: "pilot",
        requiredRoleTags: ["pilot"],
        replacementTicks: 20,
        substituteEfficiencyBps: 0,
      },
      {
        id: "gunner",
        kind: "gunner",
        requiredRoleTags: ["gunner"],
        replacementTicks: 20,
        substituteEfficiencyBps: 0,
      },
    ],
    transportCapacityUnits: 0,
    embarkTicks: 0,
    disembarkTicks: 0,
    capturePowerBps: 0,
  };
}

function createDefaultAirDroneGroupTemplate(): GroupTemplate {
  return {
    id: DEFAULT_AIR_DRONE_GROUP_TEMPLATE_ID,
    tags: ["air", "recon", "drone"],
    eraTags: [DEFAULT_ERA_ID],
    techTags: ["basic-aviation"],
    memberSlotRules: [
      {
        slotId: "operator",
        memberTemplateId: DEFAULT_DRONE_OPERATOR_MEMBER_TEMPLATE_ID,
        count: 1,
        required: true,
      },
    ],
    platformSlotRules: [
      {
        slotId: "aircraft",
        platformTemplateId: DEFAULT_AIR_DRONE_PLATFORM_TEMPLATE_ID,
        count: 1,
        required: true,
      },
    ],
    cohesionRadiusCells: 0,
    capturePowerScaleBps: 0,
    behaviorProfileId: "air-recon",
  };
}

function createDefaultAirDronePlatformTemplate(): PlatformTemplate {
  return {
    id: DEFAULT_AIR_DRONE_PLATFORM_TEMPLATE_ID,
    tags: ["air", "recon", "drone", "hover"],
    eraTags: [DEFAULT_ERA_ID],
    techTags: ["basic-aviation"],
    movementType: "hover",
    flightRule: {
      kind: "hover",
      safetyRadiusMm: 1_500,
      clearanceMmByBand: {
        low: 10_000,
        medium: 32_000,
        high: 64_000,
      },
    },
    visualTypeId: "air-scout-drone",
    occupancyUnits: 1,
    turnTicksPer45Degrees: 0,
    armorRatingByFace: { front: 8, side: 8, rear: 8, top: 8 },
    componentRules: [
      {
        id: "structure",
        kind: "structure",
        hitWeight: 3,
        external: false,
        disabledAtBps: 0,
        requiredStationIds: [],
      },
      {
        id: "powertrain",
        kind: "powertrain",
        hitWeight: 2,
        external: true,
        disabledAtBps: 2_500,
        requiredStationIds: ["operator"],
      },
      {
        id: "lift",
        kind: "lift",
        hitWeight: 4,
        external: true,
        disabledAtBps: 2_500,
        requiredStationIds: ["operator"],
      },
      {
        id: "sensor",
        kind: "sensor",
        hitWeight: 2,
        external: true,
        disabledAtBps: 2_500,
        requiredStationIds: ["operator"],
      },
    ],
    crewStationRules: [
      {
        id: "operator",
        kind: "pilot",
        requiredRoleTags: ["pilot", "observer"],
        replacementTicks: 20,
        substituteEfficiencyBps: 0,
      },
    ],
    transportCapacityUnits: 0,
    embarkTicks: 0,
    disembarkTicks: 0,
    capturePowerBps: 0,
  };
}

function createDefaultPlatformTemplate(
  id: string,
  movementType: PlatformTemplate["movementType"],
  visualTypeId: string,
  turnTicksPer45Degrees: number,
  options: {
    readonly weaponTemplateId?: string;
    readonly tags?: readonly string[];
    readonly deploymentRule?: PlatformTemplate["deploymentRule"];
  } = {},
): PlatformTemplate {
  return {
    id,
    tags: [...(options.tags ?? ["vehicle", "scout", movementType])],
    eraTags: [DEFAULT_ERA_ID],
    techTags: ["basic-vehicles"],
    movementType,
    visualTypeId,
    occupancyUnits: 8,
    turnTicksPer45Degrees,
    armorRatingByFace: movementType === "tracked"
      ? { front: 120, side: 80, rear: 45, top: 35 }
      : { front: 70, side: 50, rear: 30, top: 25 },
    componentRules: [
      {
        id: "structure",
        kind: "structure",
        hitWeight: 4,
        external: false,
        disabledAtBps: 0,
        requiredStationIds: [],
      },
      {
        id: "powertrain",
        kind: "powertrain",
        hitWeight: 2,
        external: false,
        disabledAtBps: 2_500,
        requiredStationIds: ["driver"],
      },
      {
        id: "running-gear",
        kind: "running-gear",
        hitWeight: 3,
        external: true,
        disabledAtBps: 2_500,
        requiredStationIds: ["driver"],
      },
      {
        id: "sensor",
        kind: "sensor",
        hitWeight: 1,
        external: true,
        disabledAtBps: 2_500,
        requiredStationIds: ["gunner"],
      },
      {
        id: "primary-weapon",
        kind: "weapon",
        hitWeight: 1,
        external: true,
        disabledAtBps: 2_500,
        requiredStationIds: ["gunner"],
        weaponTemplateId:
          options.weaponTemplateId ?? DEFAULT_PLATFORM_WEAPON_TEMPLATE_ID,
      },
    ],
    crewStationRules: [
      {
        id: "driver",
        kind: "driver",
        requiredRoleTags: ["driver"],
        replacementTicks: 20,
        substituteEfficiencyBps: 6_000,
      },
      {
        id: "gunner",
        kind: "gunner",
        requiredRoleTags: ["gunner"],
        replacementTicks: 20,
        substituteEfficiencyBps: 6_000,
      },
      {
        id: "relief",
        kind: "auxiliary",
        requiredRoleTags: [],
        replacementTicks: 20,
        substituteEfficiencyBps: 10_000,
      },
    ],
    deploymentRule: options.deploymentRule
      ? {
          ...options.deploymentRule,
          requiredStationIds: [...options.deploymentRule.requiredStationIds],
          requiredComponentIds: [...options.deploymentRule.requiredComponentIds],
        }
      : undefined,
    transportCapacityUnits: 8,
    embarkTicks: 20,
    disembarkTicks: 16,
    capturePowerBps: 0,
  };
}

export function migrateBattleContent(
  content:
    | BattleContentBundle
    | PrePassiveAbilityBattleContentBundle
    | PreAirUnitsBattleContentBundle
    | PreAirCombatBattleContentBundle
    | PreAirBattleContentBundle
    | PreArtilleryBattleContentBundle
    | LegacyBattleContentBundle,
): BattleContentBundle {
  if (content.contentVersion === BATTLE_CONTENT_VERSION) {
    return cloneBattleContent(content);
  }
  if (
    content.contentVersion === PRE_PASSIVE_ABILITY_BATTLE_CONTENT_VERSION ||
    content.contentVersion === PRE_AIR_UNITS_BATTLE_CONTENT_VERSION ||
    content.contentVersion === PRE_AIR_COMBAT_BATTLE_CONTENT_VERSION ||
    content.contentVersion === PRE_AIR_BATTLE_CONTENT_VERSION
  ) {
    return {
      ...content,
      contentVersion: BATTLE_CONTENT_VERSION,
      eraTemplates: cloneRecord(content.eraTemplates, cloneEraTemplate),
      groupTemplates: cloneRecord(content.groupTemplates, cloneGroupTemplate),
      memberTemplates: migratePrePassiveMemberTemplates(content.memberTemplates),
      platformTemplates: cloneRecord(content.platformTemplates, clonePlatformTemplate),
      weaponTemplates: cloneRecord(content.weaponTemplates, cloneWeaponTemplate),
      sensorTemplates: cloneRecord(content.sensorTemplates, cloneSensorTemplate),
      abilityTemplates: {},
      statusTemplates: cloneRecord(content.statusTemplates, cloneSimpleTemplate),
      terrainCatalog: { ...content.terrainCatalog },
    };
  }
  if (content.contentVersion === "content-2") {
    return {
      ...content,
      contentVersion: BATTLE_CONTENT_VERSION,
      eraTemplates: cloneRecord(content.eraTemplates, cloneEraTemplate),
      groupTemplates: cloneRecord(content.groupTemplates, cloneGroupTemplate),
      memberTemplates: migratePrePassiveMemberTemplates(content.memberTemplates),
      platformTemplates: cloneRecord(content.platformTemplates, clonePlatformTemplate),
      weaponTemplates: Object.fromEntries(
        Object.entries(content.weaponTemplates).map(([id, template]) => [
          id,
          migratePreArtilleryWeaponTemplate(template),
        ]),
      ),
      sensorTemplates: cloneRecord(content.sensorTemplates, cloneSensorTemplate),
      abilityTemplates: {},
      statusTemplates: cloneRecord(content.statusTemplates, cloneSimpleTemplate),
      terrainCatalog: { ...content.terrainCatalog },
    };
  }
  if (
    Object.keys(content.platformTemplates).length > 0 ||
    Object.values(content.groupTemplates).some(
      (template) => template.platformSlotRules.length > 0,
    )
  ) {
    throw new Error("content-1 cannot migrate referenced platform templates.");
  }
  const migratedLegacy: PreArtilleryBattleContentBundle = {
    ...content,
    contentVersion: "content-2",
    eraTemplates: Object.fromEntries(
      Object.entries(content.eraTemplates).map(([id, era]) => [
        id,
        { ...era, tags: [...era.tags], allowedPlatformTemplateIds: [] },
      ]),
    ),
    groupTemplates: Object.fromEntries(
      Object.entries(content.groupTemplates).map(([id, template]) => [
        id,
        {
          ...template,
          tags: [...template.tags],
          eraTags: [...template.eraTags],
          techTags: [...template.techTags],
          memberSlotRules: template.memberSlotRules.map((slot) => ({ ...slot })),
          platformSlotRules: [],
        },
      ]),
    ),
    memberTemplates: Object.fromEntries(
      Object.entries(content.memberTemplates).map(([id, template]) => [
        id,
        {
          ...template,
          tags: [...template.tags],
          eraTags: [...template.eraTags],
          techTags: [...template.techTags],
          weaponSlotRules: template.weaponSlotRules.map((slot) => ({ ...slot })),
          roleTags: [...template.roleTags],
          transportOccupancyUnits: 1,
        },
      ]),
    ),
    platformTemplates: {},
    weaponTemplates: cloneRecord(content.weaponTemplates, clonePreArtilleryWeaponTemplate),
    sensorTemplates: cloneRecord(content.sensorTemplates, cloneSensorTemplate),
    abilityTemplates: {},
    statusTemplates: cloneRecord(content.statusTemplates, cloneSimpleTemplate),
    terrainCatalog: { ...content.terrainCatalog },
  };
  return migrateBattleContent(migratedLegacy);
}

export function cloneBattleContent(content: BattleContentBundle): BattleContentBundle {
  return {
    ...content,
    eraTemplates: cloneRecord(content.eraTemplates, cloneEraTemplate),
    groupTemplates: cloneRecord(content.groupTemplates, cloneGroupTemplate),
    memberTemplates: cloneRecord(content.memberTemplates, cloneMemberTemplate),
    platformTemplates: cloneRecord(content.platformTemplates, clonePlatformTemplate),
    weaponTemplates: cloneRecord(content.weaponTemplates, cloneWeaponTemplate),
    sensorTemplates: cloneRecord(content.sensorTemplates, cloneSensorTemplate),
    abilityTemplates: cloneRecord(content.abilityTemplates, cloneAbilityTemplate),
    statusTemplates: cloneRecord(content.statusTemplates, cloneSimpleTemplate),
    terrainCatalog: { ...content.terrainCatalog },
  };
}

export function validateBattleContent(content: BattleContentBundle): void {
  if (content.contentVersion !== BATTLE_CONTENT_VERSION) {
    throw new Error(`Unsupported battle content version: ${content.contentVersion}.`);
  }
  if (!content.eraId || !content.eraTemplates[content.eraId]) {
    throw new Error(`Battle content references an unknown era: ${content.eraId}.`);
  }
  validateRecord(content.eraTemplates, "era", validateEraTemplate);
  validateRecord(content.groupTemplates, "group", validateGroupTemplate);
  validateRecord(content.memberTemplates, "member", validateMemberTemplate);
  validateRecord(content.weaponTemplates, "weapon", validateWeaponTemplate);
  validateRecord(content.sensorTemplates, "sensor", validateSensorTemplate);
  validateRecord(content.platformTemplates, "platform", validatePlatformTemplate);
  validateRecord(content.abilityTemplates, "ability", validateAbilityTemplate);
  validateRecord(content.statusTemplates, "status", validateSimpleTemplate);
  if (!content.terrainCatalog.version) {
    throw new Error("Battle content terrain catalog requires a version.");
  }

  for (const group of Object.values(content.groupTemplates)) {
    for (const slot of group.memberSlotRules) {
      if (!content.memberTemplates[slot.memberTemplateId]) {
        throw new Error(`Group template ${group.id} references an unknown member template.`);
      }
    }
    for (const slot of group.platformSlotRules) {
      if (!content.platformTemplates[slot.platformTemplateId]) {
        throw new Error(`Group template ${group.id} references an unknown platform template.`);
      }
    }
  }
  for (const member of Object.values(content.memberTemplates)) {
    if (!content.sensorTemplates[member.sensorTemplateId]) {
      throw new Error(`Member template ${member.id} references an unknown sensor template.`);
    }
    for (const slot of member.weaponSlotRules) {
      if (!content.weaponTemplates[slot.weaponTemplateId]) {
        throw new Error(`Member template ${member.id} references an unknown weapon template.`);
      }
      if (
        content.weaponTemplates[slot.weaponTemplateId]!.fireModes.some(
          (mode) => mode.requiresDeployedPlatform || mode.targeting === "indirect",
        )
      ) {
        throw new Error(
          `Member weapon ${slot.weaponTemplateId} cannot use indirect fire or platform deployment.`,
        );
      }
    }
    for (const abilityId of member.abilityTemplateIds) {
      if (!content.abilityTemplates[abilityId]) {
        throw new Error(`Member template ${member.id} references an unknown ability template.`);
      }
    }
  }

  const era = content.eraTemplates[content.eraId]!;
  validateAllowedIds(era.allowedGroupTemplateIds, content.groupTemplates, "group", era.id);
  validateAllowedIds(era.allowedMemberTemplateIds, content.memberTemplates, "member", era.id);
  validateAllowedIds(era.allowedPlatformTemplateIds, content.platformTemplates, "platform", era.id);
  validateAllowedIds(era.allowedWeaponTemplateIds, content.weaponTemplates, "weapon", era.id);
  validateAllowedIds(era.allowedSensorTemplateIds, content.sensorTemplates, "sensor", era.id);
  for (const weaponId of era.allowedWeaponTemplateIds) {
    const weapon = content.weaponTemplates[weaponId]!;
    if (
      weapon.fireModes.some(
        (mode) =>
          (mode.targeting === "indirect" &&
            (mode.trajectory !== "logical-projectile" || !mode.requiresDeployedPlatform)) ||
          (mode.targeting === "direct" && mode.aimTicks !== 0),
      ) ||
      weapon.firePattern.kind !== "single" ||
      weapon.firePattern.shotsPerAction !== 1
    ) {
      throw new Error(`Weapon template ${weapon.id} uses capabilities not supported by content-7.`);
    }
  }
  for (const group of Object.values(content.groupTemplates)) {
    if (!era.allowedGroupTemplateIds.includes(group.id)) {
      continue;
    }
    const hoverPlatform = group.platformSlotRules.some(
      (slot) => content.platformTemplates[slot.platformTemplateId]?.movementType === "hover",
    );
    const supportedBehaviors = hoverPlatform
      ? ["air-recon", "air-combat"]
      : group.platformSlotRules.length > 0
        ? ["vehicle-basic"]
        : ["infantry-basic"];
    if (!supportedBehaviors.includes(group.behaviorProfileId)) {
      throw new Error(`Group template ${group.id} uses an unsupported behavior profile.`);
    }
    for (const slot of group.platformSlotRules) {
      if (!era.allowedPlatformTemplateIds.includes(slot.platformTemplateId)) {
        throw new Error(`Group template ${group.id} references a platform outside era ${era.id}.`);
      }
    }
    for (const slot of group.memberSlotRules) {
      if (!era.allowedMemberTemplateIds.includes(slot.memberTemplateId)) {
        throw new Error(`Group template ${group.id} references a member outside era ${era.id}.`);
      }
    }
  }
  for (const member of Object.values(content.memberTemplates)) {
    if (!era.allowedMemberTemplateIds.includes(member.id)) {
      continue;
    }
    if (member.weaponSlotRules.reduce((sum, slot) => sum + slot.count, 0) !== 1) {
      throw new Error(`Member template ${member.id} must resolve to one content-7 weapon.`);
    }
    if (!era.allowedSensorTemplateIds.includes(member.sensorTemplateId)) {
      throw new Error(`Member template ${member.id} references a sensor outside era ${era.id}.`);
    }
    for (const slot of member.weaponSlotRules) {
      if (!era.allowedWeaponTemplateIds.includes(slot.weaponTemplateId)) {
        throw new Error(`Member template ${member.id} references a weapon outside era ${era.id}.`);
      }
    }
  }
  for (const platform of Object.values(content.platformTemplates)) {
    if (!era.allowedPlatformTemplateIds.includes(platform.id)) {
      continue;
    }
    for (const component of platform.componentRules) {
      if (
        component.weaponTemplateId &&
        !era.allowedWeaponTemplateIds.includes(component.weaponTemplateId)
      ) {
        throw new Error(`Platform template ${platform.id} references a weapon outside era ${era.id}.`);
      }
      if (
        component.weaponTemplateId &&
        content.weaponTemplates[component.weaponTemplateId]!.fireModes.some(
          (mode) => mode.requiresDeployedPlatform,
        ) &&
        !platform.deploymentRule
      ) {
        throw new Error(
          `Platform template ${platform.id} requires a deployment rule for weapon ${component.weaponTemplateId}.`,
        );
      }
    }
  }
}

export function hashBattleContent(content: BattleContentBundle): string {
  const hasher = new StateHasher();
  hasher.addString(content.contentVersion);
  hasher.addString(content.eraId);
  hashRecord(hasher, "era", content.eraTemplates, hashEraTemplate);
  hashRecord(hasher, "group", content.groupTemplates, hashGroupTemplate);
  hashRecord(hasher, "member", content.memberTemplates, hashMemberTemplate);
  hashRecord(hasher, "platform", content.platformTemplates, hashPlatformTemplate);
  hashRecord(hasher, "weapon", content.weaponTemplates, hashWeaponTemplate);
  hashRecord(hasher, "sensor", content.sensorTemplates, hashSensorTemplate);
  hashRecord(hasher, "ability", content.abilityTemplates, hashAbilityTemplate);
  hashRecord(hasher, "status", content.statusTemplates, hashSimpleTemplate);
  hasher.addString(content.terrainCatalog.version);
  return hasher.digest();
}

export function getGroupTemplate(content: BattleContentBundle, id?: TemplateId): GroupTemplate {
  const resolvedId = id ?? DEFAULT_GROUP_TEMPLATE_ID;
  return content.groupTemplates[resolvedId] ?? missingTemplate("group", resolvedId);
}

export function getMemberTemplate(content: BattleContentBundle, id?: TemplateId): MemberTemplate {
  const resolvedId = id ?? DEFAULT_MEMBER_TEMPLATE_ID;
  return content.memberTemplates[resolvedId] ?? missingTemplate("member", resolvedId);
}

export function getWeaponTemplate(content: BattleContentBundle, id: TemplateId): WeaponTemplate {
  return content.weaponTemplates[id] ?? missingTemplate("weapon", id);
}

export function getPrimaryFireMode(weapon: WeaponTemplate): WeaponFireModeDefinition {
  const mode = weapon.fireModes[0];
  if (!mode) {
    throw new Error(`Weapon template ${weapon.id} has no usable fire mode.`);
  }
  return mode;
}

export function getPlatformTemplate(content: BattleContentBundle, id: TemplateId): PlatformTemplate {
  return content.platformTemplates[id] ?? missingTemplate("platform", id);
}

export function getPrimaryWeaponTemplate(
  content: BattleContentBundle,
  memberTemplateId?: TemplateId,
): WeaponTemplate {
  const member = getMemberTemplate(content, memberTemplateId);
  const slot = member.weaponSlotRules.find((candidate) => candidate.count > 0);
  if (!slot) {
    throw new Error(`Member template ${member.id} has no usable weapon slot.`);
  }
  return getWeaponTemplate(content, slot.weaponTemplateId);
}

function validateRecord<T extends { readonly id: string }>(
  record: Readonly<Record<string, T>>,
  namespace: string,
  validate: (template: T) => void,
): void {
  for (const [key, template] of Object.entries(record)) {
    if (!key || !template || template.id !== key) {
      throw new Error(`${namespace} template keys and IDs must match and be non-empty.`);
    }
    validate(template);
  }
}

function validateEraTemplate(template: EraTemplate): void {
  if (!template.id || !template.displayName) {
    throw new Error("Era templates require non-empty IDs and display names.");
  }
  for (const ids of [
    template.allowedGroupTemplateIds,
    template.allowedMemberTemplateIds,
    template.allowedPlatformTemplateIds,
    template.allowedWeaponTemplateIds,
    template.allowedSensorTemplateIds,
  ]) {
    if (new Set(ids).size !== ids.length || ids.some((id) => !id)) {
      throw new Error(`Era template ${template.id} has duplicate or empty allow-list IDs.`);
    }
  }
}

function validateGroupTemplate(template: GroupTemplate): void {
  validateTags(template.id, template.tags, template.eraTags, template.techTags);
  if (!Number.isInteger(template.cohesionRadiusCells) || template.cohesionRadiusCells < 0) {
    throw new Error(`Group template ${template.id} has an invalid cohesion radius.`);
  }
  validateBps(template.capturePowerScaleBps, `Group template ${template.id}`);
  if (!template.behaviorProfileId) {
    throw new Error(`Group template ${template.id} requires a behavior profile.`);
  }
  validateSlotRules(template.id, template.memberSlotRules, "member");
  validateSlotRules(template.id, template.platformSlotRules, "platform");
}

function validateMemberTemplate(template: MemberTemplate): void {
  validateTags(template.id, template.tags, template.eraTags, template.techTags);
  if (template.movementType !== "foot") {
    throw new Error(`Member template ${template.id} uses an unsupported movement type.`);
  }
  if (!template.sensorTemplateId || !template.silhouetteId) {
    throw new Error(`Member template ${template.id} requires sensor and silhouette IDs.`);
  }
  if (!Number.isInteger(template.transportOccupancyUnits) || template.transportOccupancyUnits < 1) {
    throw new Error(`Member template ${template.id} has invalid transport occupancy.`);
  }
  validateBps(template.protectionBps, `Member template ${template.id}`);
  validateBps(template.suppressionResistanceBps, `Member template ${template.id}`);
  validateBps(template.capturePowerBps, `Member template ${template.id}`);
  if (
    new Set(template.abilityTemplateIds).size !== template.abilityTemplateIds.length ||
    template.abilityTemplateIds.some((id) => !id)
  ) {
    throw new Error(`Member template ${template.id} has duplicate or empty ability references.`);
  }
  validateSlotRules(template.id, template.weaponSlotRules, "weapon");
}

function validateAbilityTemplate(template: AbilityTemplate): void {
  validateSimpleTemplate(template);
  if (!template.displayName || template.kind !== "passive") {
    throw new Error(`Ability template ${template.id} requires a name and passive kind.`);
  }
  if (template.targetRule !== "self" && template.targetRule !== "own-group") {
    throw new Error(`Ability template ${template.id} has an invalid target rule.`);
  }
  if (
    new Set(template.conditions.map((condition) => condition.kind)).size !==
    template.conditions.length
  ) {
    throw new Error(`Ability template ${template.id} has duplicate conditions.`);
  }
  for (const condition of template.conditions) {
    if (condition.kind !== "health" && condition.kind !== "presence") {
      throw new Error(`Ability template ${template.id} has an invalid condition kind.`);
    }
    if (
      condition.states.length === 0 ||
      new Set(condition.states).size !== condition.states.length
    ) {
      throw new Error(`Ability template ${template.id} has an invalid ${condition.kind} condition.`);
    }
    if (
      condition.kind === "health" &&
      condition.states.some(
        (state) => !["healthy", "wounded", "incapacitated", "dead"].includes(state),
      )
    ) {
      throw new Error(`Ability template ${template.id} has an invalid health condition.`);
    }
    if (
      condition.kind === "presence" &&
      condition.states.some((state) => !["undeployed", "deployed", "evacuated"].includes(state))
    ) {
      throw new Error(`Ability template ${template.id} has an invalid presence condition.`);
    }
  }
  if (
    template.effects.length === 0 ||
    new Set(template.effects.map((effect) => effect.attribute)).size !== template.effects.length
  ) {
    throw new Error(`Ability template ${template.id} requires unique attribute effects.`);
  }
  for (const effect of template.effects) {
    if (
      effect.kind !== "attribute-modifier" ||
      ![
        "protection-bps",
        "suppression-resistance-bps",
        "capture-power-bps",
      ].includes(effect.attribute) ||
      !Number.isInteger(effect.modifierBps) ||
      effect.modifierBps < -10_000 ||
      effect.modifierBps > 10_000
    ) {
      throw new Error(`Ability template ${template.id} has an invalid attribute modifier.`);
    }
    if (template.targetRule === "own-group" && effect.attribute === "protection-bps") {
      throw new Error(
        `Ability template ${template.id} cannot apply group protection without aura rules.`,
      );
    }
  }
}

function validateWeaponTemplate(template: WeaponTemplate): void {
  validateTags(template.id, template.tags, template.eraTags, template.techTags);
  if (
    template.fireModes.length === 0 ||
    new Set(template.fireModes.map((mode) => mode.id)).size !== template.fireModes.length ||
    template.fireModes.some((mode) => !mode.id)
  ) {
    throw new Error(`Weapon template ${template.id} requires unique non-empty fire modes.`);
  }
  for (const mode of template.fireModes) {
    if (
      !Number.isInteger(mode.minimumRangeMm) ||
      !Number.isInteger(mode.optimalRangeMm) ||
      !Number.isInteger(mode.maximumRangeMm) ||
      mode.minimumRangeMm < 0 ||
      mode.minimumRangeMm > mode.optimalRangeMm ||
      mode.optimalRangeMm > mode.maximumRangeMm ||
      !Number.isInteger(mode.aimTicks) ||
      mode.aimTicks < 0 ||
      typeof mode.requiresDeployedPlatform !== "boolean"
    ) {
      throw new Error(`Weapon template ${template.id} has an invalid fire mode.`);
    }
    if (mode.trajectory === "logical-projectile") {
      for (const value of [
        mode.projectileSpeedMmPerTick,
        mode.muzzleHeightMm,
        mode.apexHeightMm,
        mode.blastRadiusMm,
      ]) {
        if (!Number.isSafeInteger(value) || value < 0) {
          throw new Error(`Weapon template ${template.id} has invalid projectile fields.`);
        }
      }
      if (mode.projectileSpeedMmPerTick <= 0) {
        throw new Error(`Weapon template ${template.id} has invalid projectile speed.`);
      }
      const maximumFlightTicks = Math.max(
        1,
        Math.ceil(mode.maximumRangeMm / mode.projectileSpeedMmPerTick),
      );
      if (
        maximumFlightTicks > MAX_LOGICAL_PROJECTILE_FLIGHT_TICKS ||
        !Number.isSafeInteger(mode.maximumRangeMm * maximumFlightTicks) ||
        !Number.isSafeInteger(4 * mode.apexHeightMm * maximumFlightTicks ** 2)
      ) {
        throw new Error(`Weapon template ${template.id} exceeds projectile trajectory bounds.`);
      }
      if (!mode.visualTypeId) {
        throw new Error(`Weapon template ${template.id} requires a projectile visual type.`);
      }
      if (mode.targeting === "indirect") {
        const uncertainty = mode.uncertainty;
        for (const value of [
          uncertainty.baseScatterMm,
          uncertainty.ageScatterMmPerSecond,
          uncertainty.sameFactionRelayPenaltyMm,
          uncertainty.alliedRelayPenaltyMm,
          uncertainty.zeroConfidencePenaltyMm,
          uncertainty.maximumScatterMm,
          uncertainty.maximumContactAgeTicks,
        ]) {
          if (!Number.isSafeInteger(value) || value < 0) {
            throw new Error(`Weapon template ${template.id} has invalid uncertainty fields.`);
          }
        }
        if (
          uncertainty.maximumContactAgeTicks < 1 ||
          uncertainty.maximumScatterMm > MAX_ARTILLERY_SCATTER_MM ||
          !Number.isSafeInteger(
            uncertainty.maximumContactAgeTicks * uncertainty.ageScatterMmPerSecond,
          ) ||
          uncertainty.baseScatterMm > uncertainty.maximumScatterMm ||
          uncertainty.sameFactionRelayPenaltyMm > uncertainty.maximumScatterMm ||
          uncertainty.alliedRelayPenaltyMm > uncertainty.maximumScatterMm ||
          uncertainty.zeroConfidencePenaltyMm > uncertainty.maximumScatterMm
        ) {
          throw new Error(`Weapon template ${template.id} has invalid uncertainty bounds.`);
        }
      }
    }
  }
  if (
    !template.targetDomains.length ||
    template.targetDomains.some((domain) => domain !== "ground" && domain !== "air") ||
    new Set(template.targetDomains).size !== template.targetDomains.length
  ) {
    throw new Error(`Weapon template ${template.id} has invalid target domains.`);
  }
  for (const [label, value, minimum] of [
    ["magazineSize", template.magazineSize, 1],
    ["reloadTicks", template.reloadTicks, 0],
    ["shotIntervalTicks", template.shotIntervalTicks, 1],
  ] as const) {
    if (!Number.isInteger(value) || value < minimum) {
      throw new Error(`Weapon template ${template.id} has invalid ${label}.`);
    }
  }
  if (
    template.firePattern.shotsPerAction < 1 ||
    !Number.isInteger(template.firePattern.shotsPerAction) ||
    (template.firePattern.kind !== "single" && template.firePattern.kind !== "burst")
  ) {
    throw new Error(`Weapon template ${template.id} has an invalid fire pattern.`);
  }
  validateBps(template.suppressionBps, `Weapon template ${template.id}`, 10_000);
  validateBps(template.exposureOnFireBps, `Weapon template ${template.id}`, 10_000);
  for (const effect of template.damageEffects) {
    if (effect.kind === "platform-damage") {
      const externalDamageBps = effect.externalDamageBps ?? 0;
      if (
        !Number.isInteger(effect.penetrationRating) ||
        effect.penetrationRating < 0 ||
        !Number.isInteger(effect.componentDamageBps) ||
        effect.componentDamageBps < 0 ||
        effect.componentDamageBps > 20_000 ||
        !Number.isInteger(effect.crewDamageBps) ||
        effect.crewDamageBps < 0 ||
        effect.crewDamageBps > 20_000 ||
        !Number.isInteger(externalDamageBps) ||
        externalDamageBps < 0 ||
        externalDamageBps > 20_000 ||
        new Set(effect.attackTags).size !== effect.attackTags.length ||
        effect.attackTags.some((tag) => tag !== "top-attack")
      ) {
        throw new Error(`Weapon template ${template.id} has an invalid platform effect.`);
      }
      continue;
    }
    if (
      (effect.kind !== "damage" && effect.kind !== "suppression") ||
      !Number.isInteger(effect.amountBps) ||
      effect.amountBps < 0 ||
      effect.amountBps > (effect.kind === "damage" ? 20_000 : 10_000)
    ) {
      throw new Error(`Weapon template ${template.id} has an invalid effect.`);
    }
  }
}

function validateSensorTemplate(template: SensorTemplate): void {
  if (
    !template.id ||
    !Number.isInteger(template.rangeMm) ||
    template.rangeMm < 0 ||
    !Number.isInteger(template.acquisitionTicks) ||
    template.acquisitionTicks < 0 ||
    !Number.isInteger(template.contactForgetTicks) ||
    template.contactForgetTicks <= 0
  ) {
    throw new Error(`Sensor template ${template.id} has invalid fields.`);
  }
}

function validatePlatformTemplate(template: PlatformTemplate): void {
  validateTags(template.id, template.tags, template.eraTags, template.techTags);
  if (
    !(["wheeled", "tracked", "hover"] as const).includes(template.movementType) ||
    !template.visualTypeId ||
    !Number.isInteger(template.occupancyUnits) ||
    template.occupancyUnits < 1 ||
    !Number.isInteger(template.turnTicksPer45Degrees) ||
    template.turnTicksPer45Degrees < 0 ||
    !Number.isInteger(template.transportCapacityUnits) ||
    template.transportCapacityUnits < 0 ||
    !Number.isInteger(template.embarkTicks) ||
    template.embarkTicks < 0 ||
    !Number.isInteger(template.disembarkTicks) ||
    template.disembarkTicks < 0
  ) {
    throw new Error(`Platform template ${template.id} has invalid movement or capacity fields.`);
  }
  for (const face of ["front", "side", "rear", "top"] as const) {
    const rating = template.armorRatingByFace[face];
    if (!Number.isInteger(rating) || rating < 0) {
      throw new Error(`Platform template ${template.id} has invalid armor ratings.`);
    }
  }
  validateBps(template.capturePowerBps, `Platform template ${template.id}`);
  const stationIds = new Set(template.crewStationRules.map((station) => station.id));
  if (
    stationIds.size !== template.crewStationRules.length ||
    template.crewStationRules.some(
      (station) =>
        !station.id ||
        !["driver", "pilot", "gunner", "commander", "loader", "auxiliary"].includes(station.kind) ||
        new Set(station.requiredRoleTags).size !== station.requiredRoleTags.length ||
        station.requiredRoleTags.some((tag) => !tag) ||
        !Number.isInteger(station.replacementTicks) ||
        station.replacementTicks < 0 ||
        !Number.isInteger(station.substituteEfficiencyBps) ||
        station.substituteEfficiencyBps < 0 ||
        station.substituteEfficiencyBps > 10_000,
    )
  ) {
    throw new Error(`Platform template ${template.id} has invalid crew stations.`);
  }
  const componentIds = new Set(template.componentRules.map((component) => component.id));
  const hover = template.movementType === "hover";
  if (
    componentIds.size !== template.componentRules.length ||
    template.componentRules.filter((component) => component.kind === "structure").length !== 1 ||
    !template.componentRules.some((component) => component.kind === "powertrain") ||
    !(hover
      ? template.componentRules.some((component) => component.kind === "lift") &&
        template.crewStationRules.some((station) => station.kind === "pilot")
      : template.componentRules.some((component) => component.kind === "running-gear") &&
        template.crewStationRules.some((station) => station.kind === "driver"))
  ) {
    throw new Error(
      `Platform template ${template.id} requires unique core mobility components and an operator.`,
    );
  }
  for (const component of template.componentRules) {
    if (
      !component.id ||
      !["structure", "powertrain", "running-gear", "lift", "weapon", "loader", "sensor"].includes(
        component.kind,
      ) ||
      typeof component.external !== "boolean" ||
      !Number.isInteger(component.hitWeight) ||
      component.hitWeight < 1 ||
      !Number.isInteger(component.disabledAtBps) ||
      component.disabledAtBps < 0 ||
      component.disabledAtBps > 10_000 ||
      new Set(component.requiredStationIds).size !== component.requiredStationIds.length ||
      component.requiredStationIds.some((stationId) => !stationIds.has(stationId)) ||
      (component.kind === "weapon") !== (component.weaponTemplateId !== undefined)
    ) {
      throw new Error(`Platform template ${template.id} has an invalid component.`);
    }
  }
  if (hover !== (template.flightRule !== undefined)) {
    throw new Error(`Platform template ${template.id} has an invalid flight rule.`);
  }
  if (template.flightRule) {
    const clearances = Object.entries(template.flightRule.clearanceMmByBand);
    if (
      template.flightRule.kind !== "hover" ||
      !Number.isInteger(template.flightRule.safetyRadiusMm) ||
      template.flightRule.safetyRadiusMm <= 0 ||
      clearances.length === 0 ||
      clearances.some(
        ([band, clearanceMm]) =>
          !(["low", "medium", "high"] as const).includes(
            band as "low" | "medium" | "high",
          ) ||
          !Number.isInteger(clearanceMm) ||
          clearanceMm <= 0,
      )
    ) {
      throw new Error(`Platform template ${template.id} has an invalid flight rule.`);
    }
  }
  if (template.deploymentRule) {
    const rule = template.deploymentRule;
    if (
      !Number.isInteger(rule.deployTicks) ||
      rule.deployTicks < 1 ||
      !Number.isInteger(rule.packTicks) ||
      rule.packTicks < 1 ||
      new Set(rule.requiredStationIds).size !== rule.requiredStationIds.length ||
      new Set(rule.requiredComponentIds).size !== rule.requiredComponentIds.length ||
      rule.requiredStationIds.some((stationId) => !stationIds.has(stationId)) ||
      rule.requiredComponentIds.some((componentId) => !componentIds.has(componentId))
    ) {
      throw new Error(`Platform template ${template.id} has an invalid deployment rule.`);
    }
  }
}

function validateSimpleTemplate(template: { readonly id: string; readonly tags: readonly string[] }): void {
  if (!template.id || new Set(template.tags).size !== template.tags.length || template.tags.some((tag) => !tag)) {
    throw new Error(`Template ${template.id} has invalid tags.`);
  }
}

function validateSlotRules<T extends { readonly slotId: string; readonly count: number }>(
  templateId: string,
  slots: readonly T[],
  namespace: string,
): void {
  if (
    new Set(slots.map((slot) => slot.slotId)).size !== slots.length ||
    slots.some((slot) => !slot.slotId || !Number.isInteger(slot.count) || slot.count < 1)
  ) {
    throw new Error(`${namespace} slots for template ${templateId} are invalid.`);
  }
}

function validateTags(id: string, ...lists: readonly (readonly string[])[]): void {
  if (!id || lists.some((tags) => new Set(tags).size !== tags.length || tags.some((tag) => !tag))) {
    throw new Error(`Template ${id} has invalid tags.`);
  }
}

function validateBps(value: number, owner: string, maximum = 10_000): void {
  if (!Number.isInteger(value) || value < 0 || value > maximum) {
    throw new Error(`${owner} has an invalid basis-point value.`);
  }
}

function validateAllowedIds<T>(
  ids: readonly string[],
  record: Readonly<Record<string, T>>,
  namespace: string,
  eraId: string,
): void {
  for (const id of ids) {
    if (!record[id]) {
      throw new Error(`Era ${eraId} references an unknown ${namespace} template: ${id}.`);
    }
  }
}

function hashRecord<T>(
  hasher: StateHasher,
  namespace: string,
  record: Readonly<Record<string, T>>,
  hashTemplate: (hasher: StateHasher, template: T) => void,
): void {
  hasher.addString(namespace);
  for (const id of Object.keys(record).sort(compareStrings)) {
    hasher.addString(id);
    hashTemplate(hasher, record[id]!);
  }
}

function hashEraTemplate(hasher: StateHasher, template: EraTemplate): void {
  hasher.addString(template.id);
  addSortedStrings(hasher, template.tags);
  addSortedStrings(hasher, template.allowedGroupTemplateIds);
  addSortedStrings(hasher, template.allowedMemberTemplateIds);
  addSortedStrings(hasher, template.allowedPlatformTemplateIds);
  addSortedStrings(hasher, template.allowedWeaponTemplateIds);
  addSortedStrings(hasher, template.allowedSensorTemplateIds);
}

function hashGroupTemplate(hasher: StateHasher, template: GroupTemplate): void {
  hasher.addString(template.id);
  addSortedStrings(hasher, template.tags);
  addSortedStrings(hasher, template.eraTags);
  addSortedStrings(hasher, template.techTags);
  for (const slot of template.memberSlotRules) {
    hasher.addString(slot.slotId);
    hasher.addString(slot.memberTemplateId);
    hasher.addNumber(slot.count);
    hasher.addNumber(slot.required ? 1 : 0);
  }
  for (const slot of template.platformSlotRules) {
    hasher.addString(slot.slotId);
    hasher.addString(slot.platformTemplateId);
    hasher.addNumber(slot.count);
    hasher.addNumber(slot.required ? 1 : 0);
  }
  hasher.addNumber(template.cohesionRadiusCells);
  hasher.addNumber(template.capturePowerScaleBps);
  hasher.addString(template.behaviorProfileId);
}

function hashMemberTemplate(hasher: StateHasher, template: MemberTemplate): void {
  hasher.addString(template.id);
  addSortedStrings(hasher, template.tags);
  addSortedStrings(hasher, template.eraTags);
  addSortedStrings(hasher, template.techTags);
  hasher.addString(template.movementType);
  hasher.addString(template.sensorTemplateId);
  for (const slot of template.weaponSlotRules) {
    hasher.addString(slot.slotId);
    hasher.addString(slot.weaponTemplateId);
    hasher.addNumber(slot.count);
    hasher.addNumber(slot.required ? 1 : 0);
  }
  addSortedStrings(hasher, template.abilityTemplateIds);
  addSortedStrings(hasher, template.roleTags);
  hasher.addNumber(template.transportOccupancyUnits);
  hasher.addString(template.silhouetteId);
  hasher.addNumber(template.protectionBps);
  hasher.addNumber(template.suppressionResistanceBps);
  hasher.addNumber(template.capturePowerBps);
}

function hashAbilityTemplate(hasher: StateHasher, template: AbilityTemplate): void {
  hasher.addString(template.id);
  addSortedStrings(hasher, template.tags);
  hasher.addString(template.kind);
  hasher.addString(template.targetRule);
  for (const condition of [...template.conditions].sort((a, b) =>
    compareStrings(a.kind, b.kind),
  )) {
    hasher.addString(condition.kind);
    addSortedStrings(hasher, condition.states);
  }
  for (const effect of [...template.effects].sort((a, b) =>
    compareStrings(a.attribute, b.attribute),
  )) {
    hasher.addString(effect.kind);
    hasher.addString(effect.attribute);
    hasher.addNumber(effect.modifierBps);
  }
}

function hashPlatformTemplate(hasher: StateHasher, template: PlatformTemplate): void {
  hasher.addString(template.id);
  addSortedStrings(hasher, template.tags);
  addSortedStrings(hasher, template.eraTags);
  addSortedStrings(hasher, template.techTags);
  hasher.addString(template.movementType);
  hasher.addNumber(template.flightRule ? 1 : 0);
  if (template.flightRule) {
    hasher.addString(template.flightRule.kind);
    hasher.addNumber(template.flightRule.safetyRadiusMm);
    for (const band of ["low", "medium", "high"] as const) {
      hasher.addNumber(template.flightRule.clearanceMmByBand[band] ?? -1);
    }
  }
  hasher.addString(template.visualTypeId);
  hasher.addNumber(template.occupancyUnits);
  hasher.addNumber(template.turnTicksPer45Degrees);
  for (const face of ["front", "side", "rear", "top"] as const) {
    hasher.addNumber(template.armorRatingByFace[face]);
  }
  for (const component of template.componentRules) {
    hasher.addString(component.id);
    hasher.addString(component.kind);
    hasher.addNumber(component.hitWeight);
    hasher.addNumber(component.external ? 1 : 0);
    hasher.addNumber(component.disabledAtBps);
    addStrings(hasher, component.requiredStationIds);
    hasher.addString(component.weaponTemplateId ?? "");
  }
  for (const station of template.crewStationRules) {
    hasher.addString(station.id);
    hasher.addString(station.kind);
    addSortedStrings(hasher, station.requiredRoleTags);
    hasher.addNumber(station.replacementTicks);
    hasher.addNumber(station.substituteEfficiencyBps);
  }
  hasher.addNumber(template.deploymentRule ? 1 : 0);
  if (template.deploymentRule) {
    hasher.addNumber(template.deploymentRule.deployTicks);
    hasher.addNumber(template.deploymentRule.packTicks);
    addSortedStrings(hasher, template.deploymentRule.requiredStationIds);
    addSortedStrings(hasher, template.deploymentRule.requiredComponentIds);
  }
  hasher.addNumber(template.transportCapacityUnits);
  hasher.addNumber(template.embarkTicks);
  hasher.addNumber(template.disembarkTicks);
  hasher.addNumber(template.capturePowerBps);
}

function hashWeaponTemplate(hasher: StateHasher, template: WeaponTemplate): void {
  hasher.addString(template.id);
  addSortedStrings(hasher, template.tags);
  addSortedStrings(hasher, template.eraTags);
  addSortedStrings(hasher, template.techTags);
  addSortedStrings(hasher, template.targetDomains);
  for (const mode of template.fireModes) {
    hasher.addString(mode.id);
    hasher.addString(mode.targeting);
    hasher.addString(mode.trajectory);
    hasher.addNumber(mode.minimumRangeMm);
    hasher.addNumber(mode.optimalRangeMm);
    hasher.addNumber(mode.maximumRangeMm);
    hasher.addNumber(mode.aimTicks);
    hasher.addNumber(mode.requiresDeployedPlatform ? 1 : 0);
    if (mode.trajectory === "logical-projectile") {
      hasher.addNumber(mode.projectileSpeedMmPerTick);
      hasher.addNumber(mode.muzzleHeightMm);
      hasher.addNumber(mode.apexHeightMm);
      hasher.addNumber(mode.blastRadiusMm);
      hasher.addString(mode.visualTypeId);
      if (mode.targeting === "indirect") {
        hasher.addNumber(mode.uncertainty.baseScatterMm);
        hasher.addNumber(mode.uncertainty.ageScatterMmPerSecond);
        hasher.addNumber(mode.uncertainty.sameFactionRelayPenaltyMm);
        hasher.addNumber(mode.uncertainty.alliedRelayPenaltyMm);
        hasher.addNumber(mode.uncertainty.zeroConfidencePenaltyMm);
        hasher.addNumber(mode.uncertainty.maximumScatterMm);
        hasher.addNumber(mode.uncertainty.maximumContactAgeTicks);
      }
    }
  }
  hasher.addNumber(template.magazineSize);
  hasher.addNumber(template.reloadTicks);
  hasher.addNumber(template.shotIntervalTicks);
  hasher.addString(template.firePattern.kind);
  hasher.addNumber(template.firePattern.shotsPerAction);
  for (const effect of template.damageEffects) {
    hashEffect(hasher, effect);
  }
  hasher.addNumber(template.suppressionBps);
  hasher.addNumber(template.exposureOnFireBps);
}

function hashEffect(hasher: StateHasher, effect: EffectDefinition): void {
  hasher.addString(effect.kind);
  if (effect.kind === "platform-damage") {
    hasher.addNumber(effect.penetrationRating);
    hasher.addNumber(effect.componentDamageBps);
    hasher.addNumber(effect.crewDamageBps);
    hasher.addNumber(effect.externalDamageBps ?? 0);
    addSortedStrings(hasher, effect.attackTags);
    return;
  }
  hasher.addNumber(effect.amountBps);
}

function hashSensorTemplate(hasher: StateHasher, template: SensorTemplate): void {
  hasher.addString(template.id);
  hasher.addNumber(template.rangeMm);
  hasher.addNumber(template.acquisitionTicks);
  hasher.addNumber(template.contactForgetTicks);
  addSortedStrings(hasher, template.tags);
}

function hashSimpleTemplate(hasher: StateHasher, template: { readonly id: string; readonly tags: readonly string[] }): void {
  hasher.addString(template.id);
  addSortedStrings(hasher, template.tags);
}

function addStrings(hasher: StateHasher, values: readonly string[]): void {
  for (const value of values) {
    hasher.addString(value);
  }
}

function addSortedStrings(hasher: StateHasher, values: readonly string[]): void {
  addStrings(hasher, [...values].sort(compareStrings));
}

function cloneRecord<T>(record: Readonly<Record<string, T>>, clone: (value: T) => T): Record<string, T> {
  return Object.fromEntries(Object.entries(record).map(([id, value]) => [id, clone(value)]));
}

function cloneEraTemplate(template: EraTemplate): EraTemplate {
  return {
    ...template,
    tags: [...template.tags],
    allowedGroupTemplateIds: [...template.allowedGroupTemplateIds],
    allowedMemberTemplateIds: [...template.allowedMemberTemplateIds],
    allowedPlatformTemplateIds: [...template.allowedPlatformTemplateIds],
    allowedWeaponTemplateIds: [...template.allowedWeaponTemplateIds],
    allowedSensorTemplateIds: [...template.allowedSensorTemplateIds],
  };
}

function cloneGroupTemplate(template: GroupTemplate): GroupTemplate {
  return {
    ...template,
    tags: [...template.tags],
    eraTags: [...template.eraTags],
    techTags: [...template.techTags],
    memberSlotRules: template.memberSlotRules.map((slot) => ({ ...slot })),
    platformSlotRules: template.platformSlotRules.map((slot) => ({ ...slot })),
  };
}

function clonePlatformTemplate(template: PlatformTemplate): PlatformTemplate {
  return {
    ...template,
    tags: [...template.tags],
    eraTags: [...template.eraTags],
    techTags: [...template.techTags],
    armorRatingByFace: { ...template.armorRatingByFace },
    flightRule: template.flightRule
      ? {
          ...template.flightRule,
          clearanceMmByBand: { ...template.flightRule.clearanceMmByBand },
        }
      : undefined,
    componentRules: template.componentRules.map((component) => ({
      ...component,
      requiredStationIds: [...component.requiredStationIds],
    })),
    crewStationRules: template.crewStationRules.map((station) => ({
      ...station,
      requiredRoleTags: [...station.requiredRoleTags],
    })),
    deploymentRule: template.deploymentRule
      ? {
          ...template.deploymentRule,
          requiredStationIds: [...template.deploymentRule.requiredStationIds],
          requiredComponentIds: [...template.deploymentRule.requiredComponentIds],
        }
      : undefined,
  };
}

function cloneMemberTemplate(template: MemberTemplate): MemberTemplate {
  return {
    ...template,
    tags: [...template.tags],
    eraTags: [...template.eraTags],
    techTags: [...template.techTags],
    weaponSlotRules: template.weaponSlotRules.map((slot) => ({ ...slot })),
    abilityTemplateIds: [...template.abilityTemplateIds],
    roleTags: [...template.roleTags],
  };
}

function migratePrePassiveMemberTemplate(
  template: PrePassiveAbilityMemberTemplate,
): MemberTemplate {
  return {
    ...template,
    tags: [...template.tags],
    eraTags: [...template.eraTags],
    techTags: [...template.techTags],
    weaponSlotRules: template.weaponSlotRules.map((slot) => ({ ...slot })),
    abilityTemplateIds: [],
    roleTags: [...template.roleTags],
  };
}

function migratePrePassiveMemberTemplates(
  templates: Readonly<Record<string, PrePassiveAbilityMemberTemplate>>,
): Record<string, MemberTemplate> {
  return Object.fromEntries(
    Object.entries(templates).map(([id, template]) => [
      id,
      migratePrePassiveMemberTemplate(template),
    ]),
  );
}

function cloneWeaponTemplate(template: WeaponTemplate): WeaponTemplate {
  return {
    ...template,
    tags: [...template.tags],
    eraTags: [...template.eraTags],
    techTags: [...template.techTags],
    targetDomains: [...template.targetDomains],
    fireModes: template.fireModes.map((mode) =>
      mode.targeting === "indirect"
        ? { ...mode, uncertainty: { ...mode.uncertainty } }
        : { ...mode },
    ),
    firePattern: { ...template.firePattern },
    damageEffects: template.damageEffects.map((effect) =>
      effect.kind === "platform-damage"
        ? { ...effect, attackTags: [...effect.attackTags] }
        : { ...effect },
    ),
  };
}

function clonePreArtilleryWeaponTemplate(
  template: PreArtilleryWeaponTemplate,
): PreArtilleryWeaponTemplate {
  return {
    ...template,
    tags: [...template.tags],
    eraTags: [...template.eraTags],
    techTags: [...template.techTags],
    targetDomains: [...template.targetDomains],
    firePattern: { ...template.firePattern },
    damageEffects: template.damageEffects.map((effect) =>
      effect.kind === "platform-damage"
        ? { ...effect, attackTags: [...effect.attackTags] }
        : { ...effect },
    ),
  };
}

function migratePreArtilleryWeaponTemplate(
  template: PreArtilleryWeaponTemplate,
): WeaponTemplate {
  const {
    minimumRangeMm,
    optimalRangeMm,
    maximumRangeMm,
    aimTicks,
    trajectory,
    ...rest
  } = clonePreArtilleryWeaponTemplate(template);
  const fireMode: WeaponFireModeDefinition =
    trajectory === "resolved"
      ? {
          id: "direct",
          targeting: "direct",
          trajectory,
          minimumRangeMm,
          optimalRangeMm,
          maximumRangeMm,
          aimTicks,
          requiresDeployedPlatform: false,
        }
      : {
          id: "direct",
          targeting: "direct",
          trajectory,
          minimumRangeMm,
          optimalRangeMm,
          maximumRangeMm,
          aimTicks,
          requiresDeployedPlatform: false,
          projectileSpeedMmPerTick: 0,
          muzzleHeightMm: 0,
          apexHeightMm: 0,
          blastRadiusMm: 0,
          visualTypeId: "legacy-projectile",
        };
  return {
    ...rest,
    fireModes: [fireMode],
  };
}

function cloneSensorTemplate(template: SensorTemplate): SensorTemplate {
  return { ...template, tags: [...template.tags] };
}

function cloneSimpleTemplate<T extends { readonly id: string; readonly tags: readonly string[] }>(template: T): T {
  return { ...template, tags: [...template.tags] };
}

function cloneAbilityTemplate(template: AbilityTemplate): AbilityTemplate {
  return {
    ...template,
    tags: [...template.tags],
    conditions: template.conditions.map((condition) =>
      condition.kind === "health"
        ? { kind: "health", states: [...condition.states] }
        : { kind: "presence", states: [...condition.states] },
    ),
    effects: template.effects.map((effect) => ({ ...effect })),
  };
}

function missingTemplate(namespace: string, id: string): never {
  throw new Error(`Unknown ${namespace} template: ${id}.`);
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
