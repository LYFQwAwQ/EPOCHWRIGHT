import {
  BATTLE_RULES_VERSION,
  BATTLE_SETUP_SCHEMA_VERSION,
  DEFAULT_AIR_ATTACK_GROUP_TEMPLATE_ID,
  DEFAULT_AIR_ATTACK_PLATFORM_TEMPLATE_ID,
  DEFAULT_AIR_DRONE_GROUP_TEMPLATE_ID,
  DEFAULT_AIR_DRONE_PLATFORM_TEMPLATE_ID,
  DEFAULT_AIR_OBSERVER_MEMBER_TEMPLATE_ID,
  DEFAULT_AIR_RECON_GROUP_TEMPLATE_ID,
  DEFAULT_AIR_RECON_PLATFORM_TEMPLATE_ID,
  DEFAULT_ARTILLERY_GROUP_TEMPLATE_ID,
  DEFAULT_ARTILLERY_PLATFORM_TEMPLATE_ID,
  DEFAULT_CREW_MEMBER_TEMPLATE_ID,
  DEFAULT_DRONE_OPERATOR_MEMBER_TEMPLATE_ID,
  DEFAULT_GUNNER_MEMBER_TEMPLATE_ID,
  DEFAULT_RELIEF_CREW_MEMBER_TEMPLATE_ID,
  DEFAULT_GROUP_TEMPLATE_ID,
  DEFAULT_MEMBER_TEMPLATE_ID,
  DEFAULT_PASSIVE_GROUP_TEMPLATE_ID,
  DEFAULT_PASSIVE_MEMBER_TEMPLATE_ID,
  DEFAULT_PILOT_MEMBER_TEMPLATE_ID,
  DEFAULT_TRACKED_GROUP_TEMPLATE_ID,
  DEFAULT_TRACKED_PLATFORM_TEMPLATE_ID,
  DEFAULT_WHEELED_GROUP_TEMPLATE_ID,
  DEFAULT_WHEELED_PLATFORM_TEMPLATE_ID,
  SIMULATION_HZ,
  createDefaultBattleContent,
  defaultRelation,
  generateBattleMap,
  isWalkable,
  primaryAttackRouteCenterZ,
  validateBattleSetup,
} from "../sim";
import type {
  BattleMap,
  BattleModeKind,
  BattleModeSetup,
  BattleRules,
  BattleSetup,
  DefenseModeSetup,
  DefenseModeSetupInput,
  DefenseObjectiveSetup,
  FactionSetup,
  GridCoord,
  GroupSpawn,
  RelationSetup,
  ReinforcementEntranceSetup,
  ReinforcementWaveSetup,
  TransportAssignment,
} from "../sim/types";

export interface DemoBattleSetupOptions {
  readonly seed?: string;
  readonly battleId?: string;
  readonly width?: number;
  readonly height?: number;
  readonly groupsPerFaction?: number;
  readonly vehicleGroupsPerFaction?: number;
  readonly artilleryGroupsPerFaction?: number;
  readonly airGroupsPerFaction?: number;
  readonly airGroupTypes?: readonly DemoAirGroupType[];
  readonly passiveAbilityGroupsPerFaction?: number;
  readonly transportPairsPerFaction?: number;
  readonly factions?: readonly FactionSetup[];
  readonly relations?: readonly RelationSetup[];
  readonly mountainDensity?: number;
  readonly roughness?: number;
  readonly waterCoverage?: number;
  readonly wetlandCoverage?: number;
  readonly treeCoverage?: number;
  readonly rockCoverage?: number;
  readonly wallCoverage?: number;
  readonly maximumDurationSeconds?: number;
  readonly stalemateSeconds?: number;
  readonly mode?: BattleModeKind | BattleModeSetup | DefenseModeSetupInput;
  readonly reinforcementEntrances?: readonly ReinforcementEntranceSetup[];
  readonly reinforcements?: readonly ReinforcementWaveSetup[];
}

export type DemoAirGroupType =
  | "recon-helicopter"
  | "attack-helicopter"
  | "scout-drone";

const DEFAULT_FACTIONS: readonly FactionSetup[] = [
  { id: "ember", displayName: "赤焰", color: "#e45f62" },
  { id: "azure", displayName: "苍蓝", color: "#3e8fd1" },
];

const MAX_GENERATED_GROUP_COUNT = 500;
const MAX_GENERATED_GROUPS_PER_FACTION = 250;

export function createDemoBattleSetup(
  options: DemoBattleSetupOptions = {},
): BattleSetup {
  const seed = options.seed ?? "epochwright-default";
  const width = options.width ?? 48;
  const height = options.height ?? 36;
  const groupsPerFaction = options.groupsPerFaction ?? 3;
  const vehicleGroupsPerFaction = options.vehicleGroupsPerFaction ?? 0;
  const artilleryGroupsPerFaction = options.artilleryGroupsPerFaction ?? 0;
  const airGroupsPerFaction = options.airGroupsPerFaction ?? 0;
  const passiveAbilityGroupsPerFaction = options.passiveAbilityGroupsPerFaction ?? 0;
  const airGroupTypes = options.airGroupTypes ?? Array.from(
    { length: airGroupsPerFaction },
    () => "recon-helicopter" as const,
  );
  const transportPairsPerFaction = options.transportPairsPerFaction ?? 0;

  const factions = (options.factions ?? DEFAULT_FACTIONS).map((faction) => ({ ...faction }));
  if (factions.length < 2) {
    throw new Error("A battle requires at least two factions.");
  }
  if (
    !Number.isInteger(groupsPerFaction) ||
    groupsPerFaction < 1 ||
    groupsPerFaction > MAX_GENERATED_GROUPS_PER_FACTION ||
    groupsPerFaction * factions.length > MAX_GENERATED_GROUP_COUNT
  ) {
    throw new Error(
      `groupsPerFaction must be an integer that keeps the generated battle within ${MAX_GENERATED_GROUP_COUNT} groups and ${MAX_GENERATED_GROUPS_PER_FACTION} groups per faction.`,
    );
  }
  if (
    !Number.isInteger(artilleryGroupsPerFaction) ||
    artilleryGroupsPerFaction < 0 ||
    artilleryGroupsPerFaction > groupsPerFaction
  ) {
    throw new Error("artilleryGroupsPerFaction must be an integer within groupsPerFaction.");
  }
  if (
    !Number.isInteger(airGroupsPerFaction) ||
    airGroupsPerFaction < 0 ||
    airGroupsPerFaction > groupsPerFaction - artilleryGroupsPerFaction
  ) {
    throw new Error("airGroupsPerFaction must fit within groupsPerFaction.");
  }
  if (
    airGroupTypes.length !== airGroupsPerFaction ||
    airGroupTypes.some(
      (type) =>
        type !== "recon-helicopter" &&
        type !== "attack-helicopter" &&
        type !== "scout-drone",
    )
  ) {
    throw new Error("airGroupTypes must provide one supported type per air group.");
  }
  if (
    !Number.isInteger(vehicleGroupsPerFaction) ||
    vehicleGroupsPerFaction < 0 ||
    vehicleGroupsPerFaction >
      groupsPerFaction - artilleryGroupsPerFaction - airGroupsPerFaction
  ) {
    throw new Error(
      "vehicleGroupsPerFaction, artilleryGroupsPerFaction, and airGroupsPerFaction must fit within groupsPerFaction.",
    );
  }
  if (
    !Number.isInteger(passiveAbilityGroupsPerFaction) ||
    passiveAbilityGroupsPerFaction < 0 ||
    passiveAbilityGroupsPerFaction >
      groupsPerFaction - artilleryGroupsPerFaction - airGroupsPerFaction - vehicleGroupsPerFaction
  ) {
    throw new Error("passiveAbilityGroupsPerFaction must fit within infantry groups.");
  }
  if (
    !Number.isInteger(transportPairsPerFaction) ||
    transportPairsPerFaction < 0 ||
    transportPairsPerFaction > vehicleGroupsPerFaction ||
    transportPairsPerFaction >
      groupsPerFaction - vehicleGroupsPerFaction - artilleryGroupsPerFaction
        - airGroupsPerFaction
  ) {
    throw new Error(
      "transportPairsPerFaction requires one vehicle and one passenger group per pair.",
    );
  }

  const map = generateBattleMap({
    seed,
    width,
    height,
    mountainDensity: options.mountainDensity ?? 0.12,
    roughness: options.roughness ?? 0.45,
    waterCoverage: options.waterCoverage ?? 0.1,
    wetlandCoverage: options.wetlandCoverage ?? 0.08,
    treeCoverage: options.treeCoverage ?? 0.02,
    rockCoverage: options.rockCoverage ?? 0.006,
    wallCoverage: options.wallCoverage ?? 0.003,
  });
  const generatedGroups = createGroupSpawns(
    map,
    factions,
    groupsPerFaction,
    vehicleGroupsPerFaction,
    artilleryGroupsPerFaction,
    airGroupsPerFaction,
    airGroupTypes,
    passiveAbilityGroupsPerFaction,
  );
  const transport = createTransportPairs(
    generatedGroups,
    factions,
    transportPairsPerFaction,
  );
  const relations = (options.relations ?? createDefaultRelations(factions)).map((relation) => ({
    ...relation,
  }));
  const mode: BattleModeSetup =
    typeof options.mode === "object"
      ? cloneMode(options.mode)
      : options.mode === "defense"
        ? createDefenseMode(map, factions)
        : ({ kind: "conflict" } as const);
  const rules: BattleRules = {
    ticksPerSecond: SIMULATION_HZ,
    sightRangeCells: 13,
    weaponRangeCells: 11,
    preferredRangeCells: 7,
    sameFactionIntelDelayTicks: 15,
    intelUpdateIntervalTicks: 10,
    contactForgetTicks: 400,
    resolutionStableTicks: 60,
    stalemateTicks: Math.round((options.stalemateSeconds ?? 75) * SIMULATION_HZ),
    maximumDurationTicks: Math.round(
      (options.maximumDurationSeconds ?? 210) * SIMULATION_HZ,
    ),
  };

  const setup: BattleSetup = {
    schemaVersion: BATTLE_SETUP_SCHEMA_VERSION,
    rulesVersion: BATTLE_RULES_VERSION,
    battleId: options.battleId ?? `battle-${seed}`,
    seed,
    content: createDefaultBattleContent(),
    map,
    factions,
    relations,
    groups: transport.groups,
    transportAssignments: transport.assignments,
    reinforcementEntrances: (options.reinforcementEntrances ?? []).map(cloneEntrance),
    reinforcements: (options.reinforcements ?? []).map(cloneWave),
    mode,
    rules,
  };
  validateBattleSetup(setup);
  return setup;
}

function createTransportPairs(
  sourceGroups: readonly GroupSpawn[],
  factions: readonly FactionSetup[],
  pairsPerFaction: number,
): {
  readonly groups: readonly GroupSpawn[];
  readonly assignments: readonly TransportAssignment[];
} {
  if (pairsPerFaction === 0) {
    return { groups: sourceGroups, assignments: [] };
  }
  const groups = sourceGroups.map((group) => ({
    ...group,
    spawn: { ...group.spawn },
  }));
  const assignments: TransportAssignment[] = [];
  for (const faction of factions) {
    const vehicles = groups.filter(
      (group) =>
        group.factionId === faction.id &&
        group.platforms.length > 0 &&
        group.groupTemplateId !== DEFAULT_ARTILLERY_GROUP_TEMPLATE_ID &&
        group.groupTemplateId !== DEFAULT_AIR_RECON_GROUP_TEMPLATE_ID &&
        group.groupTemplateId !== DEFAULT_AIR_ATTACK_GROUP_TEMPLATE_ID &&
        group.groupTemplateId !== DEFAULT_AIR_DRONE_GROUP_TEMPLATE_ID,
    );
    const passengers = groups.filter(
      (group) => group.factionId === faction.id && group.platforms.length === 0,
    );
    for (let index = 0; index < pairsPerFaction; index += 1) {
      const vehicle = vehicles[index]!;
      const passenger = passengers[index]!;
      const platform = vehicle.platforms[0]!;
      passenger.spawn = { ...vehicle.spawn };
      assignments.push({
        id: `${faction.id}-transport-${index + 1}`,
        platformId: platform.id,
        passengerGroupId: passenger.id,
        initiallyEmbarked: true,
      });
    }
  }
  return { groups, assignments };
}

function createDefaultRelations(factions: readonly FactionSetup[]): readonly RelationSetup[] {
  const relations: RelationSetup[] = [];
  for (let first = 0; first < factions.length; first += 1) {
    for (let second = first + 1; second < factions.length; second += 1) {
      relations.push(defaultRelation(factions[first]!.id, factions[second]!.id));
    }
  }
  return relations;
}

function cloneEntrance(entrance: ReinforcementEntranceSetup): ReinforcementEntranceSetup {
  return {
    ...entrance,
    cells: entrance.cells.map((cell) => ({ ...cell })),
  };
}

function cloneWave(wave: ReinforcementWaveSetup): ReinforcementWaveSetup {
  return {
    ...wave,
    entranceIds: wave.entranceIds ? [...wave.entranceIds] : undefined,
    entranceZoneIds: wave.entranceZoneIds ? [...wave.entranceZoneIds] : undefined,
    groups: wave.groups.map((group) => ({
      ...group,
      spawn: { ...group.spawn },
      evacuation: { ...group.evacuation },
      members: group.members.map((member) => ({ ...member })),
      platforms: group.platforms.map((platform) => ({
        ...platform,
        crewAssignments: platform.crewAssignments.map((assignment) => ({ ...assignment })),
      })),
    })),
  };
}

function createDefenseMode(
  map: BattleMap,
  factions: readonly FactionSetup[],
): DefenseModeSetup {
  const targetX = Math.round((map.width - 1) * 0.7);
  const corridorZ = Math.round(
    primaryAttackRouteCenterZ(map.width, map.height, targetX),
  );
  const objective = {
    id: "central-objective",
    center: findNearestWalkable(map, { x: targetX, z: corridorZ }),
    radiusCells: 2,
  } satisfies DefenseObjectiveSetup;
  return {
    kind: "defense",
    attackerFactionId: factions[0]!.id,
    defenderFactionId: factions[1]!.id,
    objective,
    objectives: [objective],
    objectiveRule: "all",
  };
}

function findNearestWalkable(map: BattleMap, origin: GridCoord): GridCoord {
  for (let radius = 0; radius < Math.max(map.width, map.height); radius += 1) {
    const candidates: GridCoord[] = [];
    for (let dz = -radius; dz <= radius; dz += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== radius) {
          continue;
        }
        const candidate = { x: origin.x + dx, z: origin.z + dz };
        if (isLegalDeployment(map, candidate)) {
          candidates.push(candidate);
        }
      }
    }
    candidates.sort((a, b) => a.z * map.width + a.x - (b.z * map.width + b.x));
    if (candidates[0]) {
      return candidates[0];
    }
  }
  throw new Error("Unable to place a legal defense objective.");
}

function createGroupSpawns(
  map: BattleMap,
  factions: readonly FactionSetup[],
  groupsPerFaction: number,
  vehicleGroupsPerFaction: number,
  artilleryGroupsPerFaction: number,
  airGroupsPerFaction: number,
  airGroupTypes: readonly DemoAirGroupType[],
  passiveAbilityGroupsPerFaction: number,
): readonly GroupSpawn[] {
  const groups: GroupSpawn[] = [];
  const occupied = new Set<number>();
  const sideXs =
    factions.length <= 2
      ? [2, map.width - 3]
      : [
          2,
          map.width - 3,
          ...factions.slice(2).map((_, index) =>
            Math.round(2 + ((index + 1) * (map.width - 5)) / factions.length),
          ),
        ];

  for (let side = 0; side < factions.length; side += 1) {
    const faction = factions[side]!;
    for (let groupIndex = 0; groupIndex < groupsPerFaction; groupIndex += 1) {
      const z = Math.round(((groupIndex + 1) * (map.height - 6)) / (groupsPerFaction + 1)) + 3;
      const desiredSpawn = {
        x: Math.min(map.width - 3, Math.max(2, sideXs[side] ?? 2)),
        z: Math.min(map.height - 3, z),
      };
      const spawn = findAvailableSpawn(map, desiredSpawn, occupied);
      occupied.add(spawn.z * map.width + spawn.x);
      if (groupIndex < artilleryGroupsPerFaction) {
        const groupId = `${faction.id}-artillery-${groupIndex + 1}`;
        const driverId = `${groupId}-driver`;
        const gunnerId = `${groupId}-gunner`;
        const reliefId = `${groupId}-relief`;
        groups.push({
          id: groupId,
          factionId: faction.id,
          groupTemplateId: DEFAULT_ARTILLERY_GROUP_TEMPLATE_ID,
          spawn,
          evacuation: { ...spawn },
          members: [
            { id: driverId, memberTemplateId: DEFAULT_CREW_MEMBER_TEMPLATE_ID },
            { id: gunnerId, memberTemplateId: DEFAULT_GUNNER_MEMBER_TEMPLATE_ID },
            { id: reliefId, memberTemplateId: DEFAULT_RELIEF_CREW_MEMBER_TEMPLATE_ID },
          ],
          platforms: [
            {
              id: `${groupId}-platform`,
              platformTemplateId: DEFAULT_ARTILLERY_PLATFORM_TEMPLATE_ID,
              initialFacing: side === 0 ? 2 : side === 1 ? 6 : 0,
              crewAssignments: [
                { stationId: "driver", memberId: driverId },
                { stationId: "gunner", memberId: gunnerId },
                { stationId: "relief", memberId: reliefId },
              ],
            },
          ],
        });
        continue;
      }
      if (groupIndex < artilleryGroupsPerFaction + airGroupsPerFaction) {
        const airIndex = groupIndex - artilleryGroupsPerFaction;
        const airGroupType = airGroupTypes[airIndex]!;
        const typeIndex =
          airGroupTypes.slice(0, airIndex + 1).filter((type) => type === airGroupType).length;
        groups.push(createAirGroupSpawn(faction.id, side, airGroupType, typeIndex, spawn));
        continue;
      }
      if (
        groupIndex <
        artilleryGroupsPerFaction + airGroupsPerFaction + vehicleGroupsPerFaction
      ) {
        const tracked = side % 2 === 1;
        const vehicleIndex = groupIndex - artilleryGroupsPerFaction - airGroupsPerFaction;
        const groupId = `${faction.id}-${tracked ? "tracked" : "wheeled"}-${vehicleIndex + 1}`;
        const driverId = `${groupId}-driver`;
        const gunnerId = `${groupId}-gunner`;
        const reliefId = `${groupId}-relief`;
        const platformId = `${groupId}-platform`;
        groups.push({
          id: groupId,
          factionId: faction.id,
          groupTemplateId: tracked
            ? DEFAULT_TRACKED_GROUP_TEMPLATE_ID
            : DEFAULT_WHEELED_GROUP_TEMPLATE_ID,
          spawn,
          evacuation: { ...spawn },
          members: [
            {
              id: driverId,
              memberTemplateId: DEFAULT_CREW_MEMBER_TEMPLATE_ID,
            },
            {
              id: gunnerId,
              memberTemplateId: DEFAULT_GUNNER_MEMBER_TEMPLATE_ID,
            },
            {
              id: reliefId,
              memberTemplateId: DEFAULT_RELIEF_CREW_MEMBER_TEMPLATE_ID,
            },
          ],
          platforms: [
            {
              id: platformId,
              platformTemplateId: tracked
                ? DEFAULT_TRACKED_PLATFORM_TEMPLATE_ID
                : DEFAULT_WHEELED_PLATFORM_TEMPLATE_ID,
              initialFacing: side === 0 ? 2 : side === 1 ? 6 : 0,
              crewAssignments: [
                { stationId: "driver", memberId: driverId },
                { stationId: "gunner", memberId: gunnerId },
                { stationId: "relief", memberId: reliefId },
              ],
            },
          ],
        });
        continue;
      }
      const infantryIndex =
        groupIndex - artilleryGroupsPerFaction - airGroupsPerFaction - vehicleGroupsPerFaction;
      const usesPassiveAbility = infantryIndex < passiveAbilityGroupsPerFaction;
      const groupId = usesPassiveAbility
        ? `${faction.id}-disciplined-${infantryIndex + 1}`
        : `${faction.id}-squad-${groupIndex + 1}`;
      groups.push({
        id: groupId,
        factionId: faction.id,
        groupTemplateId: usesPassiveAbility
          ? DEFAULT_PASSIVE_GROUP_TEMPLATE_ID
          : DEFAULT_GROUP_TEMPLATE_ID,
        spawn,
        evacuation: { ...spawn },
        members: Array.from({ length: 8 }, (_, memberIndex) => ({
          id: `${groupId}-member-${memberIndex + 1}`,
          memberTemplateId:
            usesPassiveAbility && memberIndex === 0
              ? DEFAULT_PASSIVE_MEMBER_TEMPLATE_ID
              : DEFAULT_MEMBER_TEMPLATE_ID,
        })),
        platforms: [],
      });
    }
  }
  return groups;
}

function createAirGroupSpawn(
  factionId: string,
  side: number,
  type: DemoAirGroupType,
  typeIndex: number,
  spawn: GridCoord,
): GroupSpawn {
  const initialFacing = side === 0 ? 2 : side === 1 ? 6 : 0;
  switch (type) {
    case "recon-helicopter": {
      const groupId = `${factionId}-air-recon-${typeIndex}`;
      const pilotId = `${groupId}-pilot`;
      const observerId = `${groupId}-observer`;
      return {
        id: groupId,
        factionId,
        groupTemplateId: DEFAULT_AIR_RECON_GROUP_TEMPLATE_ID,
        spawn,
        evacuation: { ...spawn },
        members: [
          { id: pilotId, memberTemplateId: DEFAULT_PILOT_MEMBER_TEMPLATE_ID },
          { id: observerId, memberTemplateId: DEFAULT_AIR_OBSERVER_MEMBER_TEMPLATE_ID },
        ],
        platforms: [{
          id: `${groupId}-platform`,
          platformTemplateId: DEFAULT_AIR_RECON_PLATFORM_TEMPLATE_ID,
          initialFacing,
          initialAltitudeBand: "low",
          crewAssignments: [
            { stationId: "pilot", memberId: pilotId },
            { stationId: "observer", memberId: observerId },
          ],
        }],
      };
    }
    case "attack-helicopter": {
      const groupId = `${factionId}-air-attack-${typeIndex}`;
      const pilotId = `${groupId}-pilot`;
      const gunnerId = `${groupId}-gunner`;
      return {
        id: groupId,
        factionId,
        groupTemplateId: DEFAULT_AIR_ATTACK_GROUP_TEMPLATE_ID,
        spawn,
        evacuation: { ...spawn },
        members: [
          { id: pilotId, memberTemplateId: DEFAULT_PILOT_MEMBER_TEMPLATE_ID },
          { id: gunnerId, memberTemplateId: DEFAULT_GUNNER_MEMBER_TEMPLATE_ID },
        ],
        platforms: [{
          id: `${groupId}-platform`,
          platformTemplateId: DEFAULT_AIR_ATTACK_PLATFORM_TEMPLATE_ID,
          initialFacing,
          initialAltitudeBand: "medium",
          crewAssignments: [
            { stationId: "pilot", memberId: pilotId },
            { stationId: "gunner", memberId: gunnerId },
          ],
        }],
      };
    }
    case "scout-drone": {
      const groupId = `${factionId}-air-drone-${typeIndex}`;
      const operatorId = `${groupId}-operator`;
      return {
        id: groupId,
        factionId,
        groupTemplateId: DEFAULT_AIR_DRONE_GROUP_TEMPLATE_ID,
        spawn,
        evacuation: { ...spawn },
        members: [
          { id: operatorId, memberTemplateId: DEFAULT_DRONE_OPERATOR_MEMBER_TEMPLATE_ID },
        ],
        platforms: [{
          id: `${groupId}-platform`,
          platformTemplateId: DEFAULT_AIR_DRONE_PLATFORM_TEMPLATE_ID,
          initialFacing,
          initialAltitudeBand: "high",
          crewAssignments: [{ stationId: "operator", memberId: operatorId }],
        }],
      };
    }
  }
}

function findAvailableSpawn(
  map: BattleMap,
  origin: GridCoord,
  occupied: ReadonlySet<number>,
): GridCoord {
  for (let radius = 0; radius < Math.max(map.width, map.height); radius += 1) {
    const candidates: GridCoord[] = [];
    for (let dz = -radius; dz <= radius; dz += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== radius) {
          continue;
        }
        const candidate = { x: origin.x + dx, z: origin.z + dz };
        const index = candidate.z * map.width + candidate.x;
        if (isLegalDeployment(map, candidate) && !occupied.has(index)) {
          candidates.push(candidate);
        }
      }
    }
    candidates.sort((a, b) => a.z * map.width + a.x - (b.z * map.width + b.x));
    if (candidates[0]) {
      return candidates[0];
    }
  }
  throw new Error("Unable to place a unique legal faction spawn cell.");
}

function isLegalDeployment(map: BattleMap, coord: GridCoord): boolean {
  if (
    !Number.isInteger(coord.x) ||
    !Number.isInteger(coord.z) ||
    coord.x < 0 ||
    coord.z < 0 ||
    coord.x >= map.width ||
    coord.z >= map.height
  ) {
    return false;
  }
  return isWalkable(map, coord);
}

function cloneMode(mode: BattleModeSetup | DefenseModeSetupInput): BattleModeSetup {
  if (mode.kind !== "defense") {
    return { kind: "conflict" };
  }
  const objectives = (mode.objectives ?? (mode.objective ? [mode.objective] : [])).map(
    (objective) => ({
      ...objective,
      center: { ...objective.center },
    }),
  );
  const primaryObjective = mode.objective ?? objectives[0];
  if (!primaryObjective) {
    throw new Error("Defense mode requires at least one objective.");
  }
  return {
    ...mode,
    objective: {
      ...primaryObjective,
      center: { ...primaryObjective.center },
    },
    objectives,
  };
}
