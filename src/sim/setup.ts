import {
  generateBattleMap,
  hashBattleMap,
  isWalkable,
  primaryAttackRouteCenterZ,
  validateBattleMap,
} from "./map";
import { createPathfinder } from "./pathfinder";
import { areHostile, defaultRelation, relationKey, sortRelations } from "./relations";
import { StateHasher } from "./rng";
import {
  BATTLE_RULES_VERSION,
  BATTLE_SETUP_SCHEMA_VERSION,
  LEGACY_BATTLE_RULES_VERSION,
  LEGACY_BATTLE_SETUP_SCHEMA_VERSION,
  SIMULATION_HZ,
} from "./types";
import type {
  BattleMap,
  BattleModeSetup,
  BattleRules,
  BattleSetup,
  BattleSetupInput,
  BattleSetupOptions,
  DefenseModeSetup,
  DefenseModeSetupInput,
  DefenseObjectiveSetup,
  FactionSetup,
  GridCoord,
  GroupSpawn,
  RelationSetup,
  ReinforcementEntranceSetup,
  ReinforcementWaveSetup,
} from "./types";

const DEFAULT_FACTIONS: readonly FactionSetup[] = [
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

  const factions = (options.factions ?? DEFAULT_FACTIONS).map((faction) => ({ ...faction }));
  if (factions.length < 2) {
    throw new Error("A battle requires at least two factions.");
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
  const groups = createGroupSpawns(map, factions, groupsPerFaction);
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
    map,
    factions,
    relations,
    groups,
    reinforcementEntrances: (options.reinforcementEntrances ?? []).map(cloneEntrance),
    reinforcements: (options.reinforcements ?? []).map(cloneWave),
    mode,
    rules,
  };
  validateBattleSetup(setup);
  return setup;
}

export function migrateBattleSetup(inputSetup: BattleSetupInput): BattleSetup {
  const candidate = inputSetup;
  if (
    candidate.schemaVersion === LEGACY_BATTLE_SETUP_SCHEMA_VERSION &&
    candidate.rulesVersion === LEGACY_BATTLE_RULES_VERSION &&
    candidate.factions?.length === 2
  ) {
    return {
      ...inputSetup,
      schemaVersion: BATTLE_SETUP_SCHEMA_VERSION,
      rulesVersion: BATTLE_RULES_VERSION,
      factions: inputSetup.factions.map((faction) => ({ ...faction })),
      relations: inputSetup.relations?.map((relation) => ({ ...relation })) ??
        createDefaultRelations(inputSetup.factions),
      reinforcementEntrances: (inputSetup.reinforcementEntrances ?? []).map(cloneEntrance),
      reinforcements: (inputSetup.reinforcements ?? []).map(cloneWave),
    } as BattleSetup;
  }
  return {
    ...inputSetup,
    relations: inputSetup.relations?.map((relation) => ({ ...relation })) ?? [],
    reinforcementEntrances: (inputSetup.reinforcementEntrances ?? []).map(cloneEntrance),
    reinforcements: (inputSetup.reinforcements ?? []).map(cloneWave),
  } as BattleSetup;
}

export function validateBattleSetup(inputSetup: BattleSetupInput): void {
  const setup = migrateBattleSetup(inputSetup);
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
  if (
    setup.factions.length < 2 ||
    factionIds.size !== setup.factions.length ||
    setup.factions.some((faction) => !faction.id)
  ) {
    throw new Error("Battle factions must contain at least two unique non-empty IDs.");
  }
  validateRelations(setup.factions, setup.relations);

  const entityIds = new Set<string>();
  for (const staticObject of setup.map.staticObjects) {
    claimUniqueId(staticObject.id, entityIds);
  }
  validateReinforcements(setup, factionIds, entityIds);
  const occupiedSpawnCells = new Set<number>();
  const factionGroupCounts = new Map(setup.factions.map((faction) => [faction.id, 0]));
  if (setup.mode.kind === "defense") {
    const objectives = defenseObjectives(setup.mode);
    if (
      setup.mode.attackerFactionId === setup.mode.defenderFactionId ||
      !factionIds.has(setup.mode.attackerFactionId) ||
      !factionIds.has(setup.mode.defenderFactionId) ||
      !areHostile(
        setup.relations,
        setup.mode.attackerFactionId,
        setup.mode.defenderFactionId,
      )
    ) {
      throw new Error("Defense mode requires two distinct hostile factions.");
    }
    if (objectives.length === 0) {
      throw new Error("Defense mode requires at least one objective.");
    }
    const objectiveIds = new Set<string>();
    for (const objective of objectives) {
      if (
        objectiveIds.has(objective.id) ||
        !Number.isInteger(objective.radiusCells) ||
        objective.radiusCells < 1 ||
        !isLegalDeployment(setup.map, objective.center) ||
        objective.center.x - objective.radiusCells < 0 ||
        objective.center.z - objective.radiusCells < 0 ||
        objective.center.x + objective.radiusCells >= setup.map.width ||
        objective.center.z + objective.radiusCells >= setup.map.height
      ) {
        throw new Error("Defense objectives must have unique legal centers and positive integer radii.");
      }
      if (countWalkableObjectiveCells(setup.map, objective) < 5) {
        throw new Error("Defense objectives must contain at least five walkable cells.");
      }
      objectiveIds.add(objective.id);
      claimUniqueId(objective.id, entityIds);
    }
    const objectiveRule = setup.mode.objectiveRule ?? "all";
    if (!(["all", "count", "sequence"] as const).includes(objectiveRule)) {
      throw new Error("Defense objectiveRule must be all, count, or sequence.");
    }
    if (
      setup.mode.requiredCount !== undefined &&
      (!Number.isInteger(setup.mode.requiredCount) ||
        setup.mode.requiredCount < 1 ||
        setup.mode.requiredCount > objectives.length)
    ) {
      throw new Error("Defense requiredCount must be within the objective count.");
    }
    if (objectiveRule === "count" && setup.mode.requiredCount === undefined) {
      throw new Error("Count objective rules require requiredCount.");
    }
    if (
      setup.mode.reserveRatioBps !== undefined &&
      (!Number.isInteger(setup.mode.reserveRatioBps) ||
        setup.mode.reserveRatioBps < 0 ||
        setup.mode.reserveRatioBps > 10_000)
    ) {
      throw new Error("Defense reserveRatioBps must be an integer from 0 to 10000.");
    }
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
    throw new Error("Every faction must deploy at least one group.");
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

export function hashBattleSetup(setup: BattleSetupInput): string {
  const normalized = migrateBattleSetup(setup);
  const hasher = new StateHasher();
  hasher.addString(normalized.schemaVersion);
  hasher.addString(normalized.rulesVersion);
  hasher.addString(normalized.battleId);
  hasher.addString(normalized.seed);
  hasher.addString(hashBattleMap(normalized.map));

  for (const faction of normalized.factions) {
    hasher.addString(faction.id);
  }
  for (const relation of sortRelations(normalized.relations)) {
    const [firstFactionId, secondFactionId] = relation.a < relation.b
      ? [relation.a, relation.b]
      : [relation.b, relation.a];
    hasher.addString(firstFactionId);
    hasher.addString(secondFactionId);
    hasher.addString(relation.kind);
    hasher.addNumber(relation.shareIntel ? 1 : 0);
    hasher.addNumber(relation.minimumIntelDelayTicks);
    hasher.addNumber(relation.intelUpdateIntervalTicks);
  }
  for (const group of normalized.groups) {
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

  for (const entrance of [...normalized.reinforcementEntrances].sort((a, b) =>
    compareStrings(a.id, b.id),
  )) {
    hasher.addString(entrance.id);
    hasher.addString(entrance.factionId);
    hasher.addNumber(entrance.capacityPerTick);
    for (const cell of entrance.cells) {
      hasher.addNumber(cell.x);
      hasher.addNumber(cell.z);
    }
  }
  for (const wave of [...normalized.reinforcements].sort((a, b) =>
    compareStrings(a.id, b.id),
  )) {
    hasher.addString(wave.id);
    hasher.addString(wave.factionId);
    hasher.addNumber(wave.arrivalTick);
    hasher.addString(wave.blockedPolicy);
    for (const entranceId of reinforcementEntranceIds(wave)) {
      hasher.addString(entranceId);
    }
    for (const group of wave.groups) {
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
  }

  hasher.addString(normalized.mode.kind);
  if (normalized.mode.kind === "defense") {
    hasher.addString(normalized.mode.attackerFactionId);
    hasher.addString(normalized.mode.defenderFactionId);
    hasher.addString(normalized.mode.objectiveRule ?? "all");
    hasher.addNumber(normalized.mode.requiredCount ?? -1);
    hasher.addNumber(normalized.mode.reserveRatioBps ?? -1);
    for (const objective of defenseObjectives(normalized.mode)) {
      hasher.addString(objective.id);
      hasher.addNumber(objective.center.x);
      hasher.addNumber(objective.center.z);
      hasher.addNumber(objective.radiusCells);
    }
  }

  hasher.addNumber(normalized.rules.ticksPerSecond);
  hasher.addNumber(normalized.rules.sightRangeCells);
  hasher.addNumber(normalized.rules.weaponRangeCells);
  hasher.addNumber(normalized.rules.preferredRangeCells);
  hasher.addNumber(normalized.rules.sameFactionIntelDelayTicks);
  hasher.addNumber(normalized.rules.intelUpdateIntervalTicks);
  hasher.addNumber(normalized.rules.contactForgetTicks);
  hasher.addNumber(normalized.rules.resolutionStableTicks);
  hasher.addNumber(normalized.rules.stalemateTicks);
  hasher.addNumber(normalized.rules.maximumDurationTicks);
  return hasher.digest();
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

function validateReinforcements(
  setup: BattleSetup,
  factionIds: ReadonlySet<string>,
  entityIds: Set<string>,
): void {
  const entrancesById = new Map<string, ReinforcementEntranceSetup>();
  for (const entrance of setup.reinforcementEntrances) {
    if (
      entrancesById.has(entrance.id) ||
      !factionIds.has(entrance.factionId) ||
      !Number.isInteger(entrance.capacityPerTick) ||
      entrance.capacityPerTick < 1 ||
      entrance.cells.length === 0
    ) {
      throw new Error(`Reinforcement entrance ${entrance.id} is invalid.`);
    }
    claimUniqueId(entrance.id, entityIds);
    const cellKeys = new Set<number>();
    for (const cell of entrance.cells) {
      if (
        !isEdgeCell(setup.map, cell) ||
        !isLegalDeployment(setup.map, cell) ||
        cellKeys.has(cell.z * setup.map.width + cell.x)
      ) {
        throw new Error(`Reinforcement entrance ${entrance.id} must contain unique legal edge cells.`);
      }
      cellKeys.add(cell.z * setup.map.width + cell.x);
    }
    entrancesById.set(entrance.id, entrance);
  }

  for (const wave of setup.reinforcements) {
    if (
      !wave.id ||
      !Number.isInteger(wave.arrivalTick) ||
      wave.arrivalTick < 0 ||
      !factionIds.has(wave.factionId) ||
      !["wait", "try-alternate", "cancel"].includes(wave.blockedPolicy) ||
      wave.groups.length === 0
    ) {
      throw new Error(`Reinforcement wave ${wave.id} is invalid.`);
    }
    claimUniqueId(wave.id, entityIds);
    const entranceIds = reinforcementEntranceIds(wave);
    if (entranceIds.length === 0 || new Set(entranceIds).size !== entranceIds.length) {
      throw new Error(`Reinforcement wave ${wave.id} must define unique entrance IDs.`);
    }
    for (const entranceId of entranceIds) {
      const entrance = entrancesById.get(entranceId);
      if (!entrance || entrance.factionId !== wave.factionId) {
        throw new Error(`Reinforcement wave ${wave.id} references an invalid entrance.`);
      }
    }
    for (const group of wave.groups) {
      claimUniqueId(group.id, entityIds);
      if (group.factionId !== wave.factionId || group.members.length !== 8) {
        throw new Error(`Reinforcement group ${group.id} has an invalid faction or roster.`);
      }
      for (const member of group.members) {
        claimUniqueId(member.id, entityIds);
        if (
          member.initialHealth !== undefined &&
          !["healthy", "wounded", "incapacitated", "dead"].includes(member.initialHealth)
        ) {
          throw new Error(`Member ${member.id} has an invalid initial health state.`);
        }
      }
      if (!isLegalDeployment(setup.map, group.spawn) || !isLegalDeployment(setup.map, group.evacuation)) {
        throw new Error(`Reinforcement group ${group.id} has an illegal template position.`);
      }
    }
  }
}

export function reinforcementEntranceIds(wave: ReinforcementWaveSetup): readonly string[] {
  return wave.entranceIds ?? wave.entranceZoneIds ?? [];
}

function isEdgeCell(map: BattleMap, cell: GridCoord): boolean {
  return (
    Number.isInteger(cell.x) &&
    Number.isInteger(cell.z) &&
    cell.x >= 0 &&
    cell.z >= 0 &&
    cell.x < map.width &&
    cell.z < map.height &&
    (cell.x === 0 || cell.z === 0 || cell.x === map.width - 1 || cell.z === map.height - 1)
  );
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
    })),
  };
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function validateRelations(
  factions: readonly FactionSetup[],
  relations: readonly RelationSetup[] | undefined,
): void {
  const factionIds = new Set(factions.map((faction) => faction.id));
  const expectedPairCount = (factions.length * (factions.length - 1)) / 2;
  if (!Array.isArray(relations) || relations.length !== expectedPairCount) {
    throw new Error(
      `Relations must contain exactly one entry for each faction pair (${expectedPairCount}).`,
    );
  }
  const seen = new Set<string>();
  for (const relation of relations) {
    if (
      !factionIds.has(relation.a) ||
      !factionIds.has(relation.b) ||
      relation.a === relation.b
    ) {
      throw new Error("Relations must reference two distinct known factions.");
    }
    const key = relationKey(relation.a, relation.b);
    if (seen.has(key)) {
      throw new Error(`Relations contain a duplicate faction pair: ${relation.a}/${relation.b}.`);
    }
    seen.add(key);
    if (!(["hostile", "neutral", "allied"] as const).includes(relation.kind)) {
      throw new Error(`Relation ${relation.a}/${relation.b} has an invalid kind.`);
    }
    if (typeof relation.shareIntel !== "boolean") {
      throw new Error(`Relation ${relation.a}/${relation.b} must define shareIntel.`);
    }
    if (
      !Number.isInteger(relation.minimumIntelDelayTicks) ||
      relation.minimumIntelDelayTicks < 0 ||
      !Number.isInteger(relation.intelUpdateIntervalTicks) ||
      relation.intelUpdateIntervalTicks < 0 ||
      (relation.shareIntel && relation.intelUpdateIntervalTicks <= 0)
    ) {
      throw new Error(`Relation ${relation.a}/${relation.b} has invalid intelligence timing.`);
    }
  }
  if (seen.size !== expectedPairCount) {
    throw new Error("Relations are incomplete.");
  }
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
    attackerFactionId: factions[0].id,
    defenderFactionId: factions[1].id,
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
            Math.round(
              2 + ((index + 1) * (map.width - 5)) / factions.length,
            ),
          ),
        ];

  for (let side = 0; side < factions.length; side += 1) {
    const faction = factions[side];
    for (let groupIndex = 0; groupIndex < groupsPerFaction; groupIndex += 1) {
      const z = Math.round(((groupIndex + 1) * (map.height - 6)) / (groupsPerFaction + 1)) + 3;
      const desiredSpawn = {
        x: Math.min(map.width - 3, Math.max(2, sideXs[side] ?? 2)),
        z: Math.min(map.height - 3, z),
      };
      const spawn = findAvailableSpawn(map, desiredSpawn, occupied);
      occupied.add(spawn.z * map.width + spawn.x);
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

  const entrancesById = new Map(
    setup.reinforcementEntrances.map((entrance) => [entrance.id, entrance]),
  );
  for (const wave of setup.reinforcements) {
    const entranceCells = reinforcementEntranceIds(wave).flatMap(
      (entranceId) => entrancesById.get(entranceId)?.cells ?? [],
    );
    const blockedGroup = wave.groups.find(
      (group) => !entranceCells.some((cell) => hasRoute(cell, group.evacuation)),
    );
    if (blockedGroup) {
      throw new Error(
        `Reinforcement group ${blockedGroup.id} has no legal route from its entrances to its evacuation cell.`,
      );
    }
  }

  if (setup.mode.kind === "defense") {
    const mode = setup.mode;
    const objectives = defenseObjectives(mode);
    const missionBlocked = setup.groups.find((group) =>
      (group.factionId === mode.attackerFactionId || group.factionId === mode.defenderFactionId) &&
      objectives.some((objective) => !hasRoute(group.spawn, objective.center)),
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

  for (const relation of sortRelations(setup.relations)) {
    if (relation.kind !== "hostile") {
      continue;
    }
    const firstFactionGroups = setup.groups.filter(
      (group) => group.factionId === relation.a,
    );
    const secondFactionGroups = setup.groups.filter(
      (group) => group.factionId === relation.b,
    );
    const hasHostileRoute = firstFactionGroups.some((first) =>
      secondFactionGroups.some((second) => hasRoute(first.spawn, second.spawn)),
    );
    if (!hasHostileRoute) {
      throw new Error(
        `Conflict mode requires at least one legal cross-map attack route between ${relation.a} and ${relation.b}.`,
      );
    }
  }
}

export function defenseObjectives(mode: {
  readonly objective?: DefenseObjectiveSetup;
  readonly objectives?: readonly DefenseObjectiveSetup[];
}): readonly DefenseObjectiveSetup[] {
  if (mode.objectives !== undefined) {
    return mode.objectives;
  }
  return mode.objective ? [mode.objective] : [];
}

function cloneMode(mode: BattleModeSetup | DefenseModeSetupInput): BattleModeSetup {
  if (mode.kind !== "defense") {
    return { kind: "conflict" };
  }
  const objectives = defenseObjectives(mode).map((objective) => ({
    ...objective,
    center: { ...objective.center },
  }));
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
