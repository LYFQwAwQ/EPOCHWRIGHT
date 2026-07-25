import {
  generateBattleMap,
  hashBattleMap,
  isWalkable,
  primaryAttackRouteCenterZ,
  validateBattleMap,
} from "./map";
import { createPathfinder } from "./pathfinder";
import { StateHasher } from "./rng";
import {
  BATTLE_RULES_VERSION,
  BATTLE_SETUP_SCHEMA_VERSION,
  SIMULATION_HZ,
} from "./types";
import type {
  BattleMap,
  BattleRules,
  BattleSetup,
  BattleSetupOptions,
  DefenseModeSetup,
  FactionSetup,
  GridCoord,
  GroupSpawn,
} from "./types";

const DEFAULT_FACTIONS: readonly [FactionSetup, FactionSetup] = [
  { id: "ember", displayName: "赤焰", color: "#e45f62" },
  { id: "azure", displayName: "苍蓝", color: "#3e8fd1" },
];

export function createBattleSetup(options: BattleSetupOptions = {}): BattleSetup {
  const seed = options.seed ?? "epochwright-default";
  const width = options.width ?? 48;
  const height = options.height ?? 36;
  const groupsPerFaction = options.groupsPerFaction ?? 3;

  if (!Number.isInteger(groupsPerFaction) || groupsPerFaction < 1 || groupsPerFaction > 8) {
    throw new Error("groupsPerFaction must be an integer from 1 to 8.");
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
  const factions = DEFAULT_FACTIONS.map((faction) => ({ ...faction })) as [
    FactionSetup,
    FactionSetup,
  ];
  const groups = createGroupSpawns(map, factions, groupsPerFaction);
  const mode =
    options.mode === "defense"
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
    map,
    factions,
    groups,
    mode,
    rules,
  };
  validateBattleSetup(setup);
  return setup;
}

export function validateBattleSetup(setup: BattleSetup): void {
  if (
    setup.schemaVersion !== BATTLE_SETUP_SCHEMA_VERSION ||
    setup.rulesVersion !== BATTLE_RULES_VERSION
  ) {
    throw new Error("Unsupported battle setup version.");
  }
  if (setup.rules.ticksPerSecond !== SIMULATION_HZ) {
    throw new Error(`The simulation must run at ${SIMULATION_HZ} Hz.`);
  }
  validateBattleMap(setup.map);

  const factionIds = new Set(setup.factions.map((faction) => faction.id));
  if (factionIds.size !== 2 || setup.factions.some((faction) => !faction.id)) {
    throw new Error("The current rules require exactly two factions with unique IDs.");
  }

  const entityIds = new Set<string>();
  for (const staticObject of setup.map.staticObjects) {
    claimUniqueId(staticObject.id, entityIds);
  }
  const occupiedSpawnCells = new Set<number>();
  const factionGroupCounts = new Map(setup.factions.map((faction) => [faction.id, 0]));
  if (setup.mode.kind === "defense") {
    if (
      setup.mode.attackerFactionId !== "ember" ||
      setup.mode.defenderFactionId !== "azure" ||
      !factionIds.has(setup.mode.attackerFactionId) ||
      !factionIds.has(setup.mode.defenderFactionId)
    ) {
      throw new Error("Defense mode currently requires ember attacking azure.");
    }
    if (
      !Number.isInteger(setup.mode.objective.radiusCells) ||
      setup.mode.objective.radiusCells < 1 ||
      !isLegalDeployment(setup.map, setup.mode.objective.center) ||
      setup.mode.objective.center.x - setup.mode.objective.radiusCells < 0 ||
      setup.mode.objective.center.z - setup.mode.objective.radiusCells < 0 ||
      setup.mode.objective.center.x + setup.mode.objective.radiusCells >= setup.map.width ||
      setup.mode.objective.center.z + setup.mode.objective.radiusCells >= setup.map.height
    ) {
      throw new Error("Defense objective must have a legal center and positive integer radius.");
    }
    if (countWalkableObjectiveCells(setup.map, setup.mode.objective) < 5) {
      throw new Error("Defense objective must contain at least five walkable cells.");
    }
    claimUniqueId(setup.mode.objective.id, entityIds);
  }
  for (const group of setup.groups) {
    claimUniqueId(group.id, entityIds);
    if (!factionIds.has(group.factionId)) {
      throw new Error(`Group ${group.id} references an unknown faction.`);
    }
    if (group.members.length !== 8) {
      throw new Error(`Group ${group.id} must contain exactly eight members.`);
    }
    for (const member of group.members) {
      claimUniqueId(member.id, entityIds);
      if (
        member.initialHealth !== undefined &&
        !["healthy", "wounded", "incapacitated", "dead"].includes(
          member.initialHealth,
        )
      ) {
        throw new Error(`Member ${member.id} has an invalid initial health state.`);
      }
    }
    if (!isLegalDeployment(setup.map, group.spawn)) {
      throw new Error(`Group ${group.id} has an illegal spawn cell.`);
    }
    const spawnIndex = group.spawn.z * setup.map.width + group.spawn.x;
    if (occupiedSpawnCells.has(spawnIndex)) {
      throw new Error(`Multiple groups cannot share initial cell ${spawnIndex}.`);
    }
    occupiedSpawnCells.add(spawnIndex);
    if (!isLegalDeployment(setup.map, group.evacuation)) {
      throw new Error(`Group ${group.id} has an illegal evacuation cell.`);
    }
    factionGroupCounts.set(
      group.factionId,
      (factionGroupCounts.get(group.factionId) ?? 0) + 1,
    );
  }

  if ([...factionGroupCounts.values()].some((count) => count === 0)) {
    throw new Error("Both factions must deploy at least one group.");
  }
  if (setup.rules.sameFactionIntelDelayTicks !== 15) {
    throw new Error("The current same-faction intelligence delay must be 15 ticks.");
  }
  if (
    setup.rules.maximumDurationTicks <= 0 ||
    setup.rules.stalemateTicks <= 0 ||
    setup.rules.resolutionStableTicks <= 0
  ) {
    throw new Error("Battle duration and stability windows must be positive.");
  }
  validateRequiredRoutes(setup);
}

export function hashBattleSetup(setup: BattleSetup): string {
  const hasher = new StateHasher();
  hasher.addString(setup.schemaVersion);
  hasher.addString(setup.rulesVersion);
  hasher.addString(setup.battleId);
  hasher.addString(setup.seed);
  hasher.addString(hashBattleMap(setup.map));

  for (const faction of setup.factions) {
    hasher.addString(faction.id);
  }
  for (const group of setup.groups) {
    hasher.addString(group.id);
    hasher.addString(group.factionId);
    hasher.addNumber(group.spawn.x);
    hasher.addNumber(group.spawn.z);
    hasher.addNumber(group.evacuation.x);
    hasher.addNumber(group.evacuation.z);
    for (const member of group.members) {
      hasher.addString(member.id);
      hasher.addString(member.initialHealth ?? "healthy");
    }
  }

  hasher.addString(setup.mode.kind);
  if (setup.mode.kind === "defense") {
    hasher.addString(setup.mode.attackerFactionId);
    hasher.addString(setup.mode.defenderFactionId);
    hasher.addString(setup.mode.objective.id);
    hasher.addNumber(setup.mode.objective.center.x);
    hasher.addNumber(setup.mode.objective.center.z);
    hasher.addNumber(setup.mode.objective.radiusCells);
  }

  hasher.addNumber(setup.rules.ticksPerSecond);
  hasher.addNumber(setup.rules.sightRangeCells);
  hasher.addNumber(setup.rules.weaponRangeCells);
  hasher.addNumber(setup.rules.preferredRangeCells);
  hasher.addNumber(setup.rules.sameFactionIntelDelayTicks);
  hasher.addNumber(setup.rules.intelUpdateIntervalTicks);
  hasher.addNumber(setup.rules.contactForgetTicks);
  hasher.addNumber(setup.rules.resolutionStableTicks);
  hasher.addNumber(setup.rules.stalemateTicks);
  hasher.addNumber(setup.rules.maximumDurationTicks);
  return hasher.digest();
}

function countWalkableObjectiveCells(
  map: BattleMap,
  objective: { readonly center: GridCoord; readonly radiusCells: number },
): number {
  let count = 0;
  for (
    let z = objective.center.z - objective.radiusCells;
    z <= objective.center.z + objective.radiusCells;
    z += 1
  ) {
    for (
      let x = objective.center.x - objective.radiusCells;
      x <= objective.center.x + objective.radiusCells;
      x += 1
    ) {
      if (
        (x - objective.center.x) ** 2 + (z - objective.center.z) ** 2 <=
          objective.radiusCells ** 2 &&
        isLegalDeployment(map, { x, z })
      ) {
        count += 1;
      }
    }
  }
  return count;
}

function createDefenseMode(
  map: BattleMap,
  factions: readonly [FactionSetup, FactionSetup],
): DefenseModeSetup {
  const targetX = Math.round((map.width - 1) * 0.7);
  const corridorZ = Math.round(
    primaryAttackRouteCenterZ(map.width, map.height, targetX),
  );
  return {
    kind: "defense",
    attackerFactionId: factions[0].id,
    defenderFactionId: factions[1].id,
    objective: {
      id: "central-objective",
      center: findNearestWalkable(map, { x: targetX, z: corridorZ }),
      radiusCells: 2,
    },
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
  factions: readonly [FactionSetup, FactionSetup],
  groupsPerFaction: number,
): readonly GroupSpawn[] {
  const groups: GroupSpawn[] = [];
  const sideXs = [2, map.width - 3] as const;

  for (let side = 0; side < factions.length; side += 1) {
    const faction = factions[side];
    for (let groupIndex = 0; groupIndex < groupsPerFaction; groupIndex += 1) {
      const z = Math.round(((groupIndex + 1) * (map.height - 6)) / (groupsPerFaction + 1)) + 3;
      const spawn = { x: sideXs[side], z: Math.min(map.height - 3, z) };
      const groupId = `${faction.id}-squad-${groupIndex + 1}`;
      groups.push({
        id: groupId,
        factionId: faction.id,
        spawn,
        evacuation: { ...spawn },
        members: Array.from({ length: 8 }, (_, memberIndex) => ({
          id: `${groupId}-member-${memberIndex + 1}`,
        })),
      });
    }
  }
  return groups;
}

function claimUniqueId(id: string, ids: Set<string>): void {
  if (!id || ids.has(id)) {
    throw new Error(`Entity ID must be non-empty and globally unique: ${id}`);
  }
  ids.add(id);
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

function validateRequiredRoutes(setup: BattleSetup): void {
  const pathfinder = createPathfinder(setup.map);
  const hasRoute = (from: GridCoord, to: GridCoord): boolean =>
    (from.x === to.x && from.z === to.z) || pathfinder.findPath(from, to).length > 0;
  const evacuationBlocked = setup.groups.find(
    (group) => !hasRoute(group.spawn, group.evacuation),
  );
  if (evacuationBlocked) {
    throw new Error(`Group ${evacuationBlocked.id} has no legal route to its evacuation cell.`);
  }

  if (setup.mode.kind === "defense") {
    const mode = setup.mode;
    const missionBlocked = setup.groups.find(
      (group) => !hasRoute(group.spawn, mode.objective.center),
    );
    if (missionBlocked) {
      const routeKind =
        missionBlocked.factionId === mode.attackerFactionId ? "attack" : "defense";
      throw new Error(
        `Group ${missionBlocked.id} has no legal ${routeKind} route to the objective.`,
      );
    }
    return;
  }

  const firstFactionGroups = setup.groups.filter(
    (group) => group.factionId === setup.factions[0].id,
  );
  const secondFactionGroups = setup.groups.filter(
    (group) => group.factionId === setup.factions[1].id,
  );
  const hasCrossMapRoute = firstFactionGroups.some((first) =>
    secondFactionGroups.some((second) => hasRoute(first.spawn, second.spawn)),
  );
  if (!hasCrossMapRoute) {
    throw new Error("Conflict mode requires at least one legal cross-map attack route.");
  }
}
