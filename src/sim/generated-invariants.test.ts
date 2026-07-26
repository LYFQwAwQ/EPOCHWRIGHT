import { describe, expect, it } from "vitest";
import {
  createDemoBattleSetup,
  type DemoBattleSetupOptions,
} from "../demo";
import {
  STATIC_OBJECT_DEFINITIONS,
  areHostile,
  cellIndex,
  createPathfinder,
  createSimulation,
  defaultRelation,
  defenseObjectives,
  hashBattleMap,
  hashBattleSetup,
  hasLineOfSight,
  isInsideMap,
  isWalkable,
  validateBattleSetup,
  type BattleEvent,
  type BattleMap,
  type BattleResult,
  type BattleSetup,
  type FactionSetup,
  type GridCoord,
} from "./index";

const DEFAULT_SEEDS = Array.from(
  { length: 12 },
  (_, index) => `generated-invariant-${String(index + 1).padStart(2, "0")}`,
);
const processLike = (
  globalThis as typeof globalThis & {
    readonly process?: {
      readonly env?: Readonly<Record<string, string | undefined>>;
    };
  }
).process;
const requestedSeed = processLike?.env?.EPOCHWRIGHT_TEST_SEED?.trim();
const seedCases = (requestedSeed ? [requestedSeed] : DEFAULT_SEEDS).map((seed) => ({ seed }));

const THREE_FACTIONS: readonly FactionSetup[] = [
  { id: "ember", displayName: "Ember", color: "#e45f62" },
  { id: "azure", displayName: "Azure", color: "#3e8fd1" },
  { id: "olive", displayName: "Olive", color: "#7c9a52" },
];

describe("generated map invariants", () => {
  it.each(seedCases)("keeps boundaries, routes, and hashes stable [$seed]", ({ seed }) => {
    const options = mapOptions(seed);
    const first = createDemoBattleSetup(options);
    const second = createDemoBattleSetup(options);

    expect(() => validateBattleSetup(first)).not.toThrow();
    expect(hashBattleMap(first.map), `${seed}: map hash`).toBe(hashBattleMap(second.map));
    expect(hashBattleSetup(first), `${seed}: setup hash`).toBe(hashBattleSetup(second));

    expectMapBoundaries(first.map, seed);
    expectRequiredRoutes(first, seed);
  });
});

describe("generated battle invariants", () => {
  it.each(seedCases)(
    "keeps deterministic results, non-hostile safety, and member conservation [$seed]",
    ({ seed }) => {
      const setup = placeHostileGroupsInContact(createDemoBattleSetup(battleOptions(seed)));
      expect(() => validateBattleSetup(setup)).not.toThrow();
      const first = createSimulation(setup);
      const second = createSimulation(setup);

      for (let step = 0; step <= setup.rules.maximumDurationTicks; step += 1) {
        expect(first.status, `${seed}: status diverged before tick ${step}`).toBe(second.status);
        if (first.status === "finished") {
          break;
        }
        first.step();
        second.step();
        expect(first.tick, `${seed}: tick diverged at step ${step}`).toBe(second.tick);
        expect(first.getStateHash(), `${seed}: hash diverged at tick ${first.tick}`).toBe(
          second.getStateHash(),
        );
      }

      expect(first.status, `${seed}: battle did not finish`).toBe("finished");
      expect(second.status, `${seed}: replay did not finish`).toBe("finished");

      const firstEvents = first.drainEvents();
      const secondEvents = second.drainEvents();
      const firstResult = requireResult(first.getResult(), seed);
      const secondResult = requireResult(second.getResult(), seed);
      expect(firstEvents, `${seed}: event replay`).toEqual(secondEvents);
      expect(firstResult, `${seed}: result replay`).toEqual(secondResult);

      expectHostileFireOnly(setup, firstEvents, seed);
      expectNeutralFactionUnharmed(firstResult, firstEvents, seed);
      expectMemberConservation(setup, firstResult, seed);
    },
  );
});

function mapOptions(seed: string): DemoBattleSetupOptions {
  const variant = seedVariant(seed);
  return {
    seed,
    width: 36 + (variant % 4) * 8,
    height: 24 + (Math.floor(variant / 4) % 4) * 6,
    groupsPerFaction: 2,
    mode: variant % 2 === 0 ? "conflict" : "defense",
    mountainDensity: 0.08 + (variant % 3) * 0.04,
    roughness: 0.35 + (variant % 4) * 0.1,
    waterCoverage: 0.04 + (variant % 3) * 0.03,
    wetlandCoverage: 0.03 + (variant % 3) * 0.02,
    treeCoverage: 0.006 + (variant % 3) * 0.003,
    rockCoverage: 0.002 + (variant % 2) * 0.002,
    wallCoverage: 0.001 + (variant % 2) * 0.001,
  };
}

function battleOptions(seed: string): DemoBattleSetupOptions {
  const variant = seedVariant(seed);
  return {
    seed: `${seed}-battle`,
    width: 36,
    height: 24,
    groupsPerFaction: 1,
    factions: THREE_FACTIONS,
    relations: [
      defaultRelation("ember", "azure", "hostile"),
      defaultRelation("ember", "olive", "neutral"),
      defaultRelation("azure", "olive", "allied"),
    ],
    mode: "conflict",
    mountainDensity: 0.04 + (variant % 3) * 0.02,
    roughness: 0.3 + (variant % 3) * 0.1,
    waterCoverage: 0.02 + (variant % 2) * 0.02,
    wetlandCoverage: 0.02 + (variant % 2) * 0.02,
    treeCoverage: 0.003 + (variant % 2) * 0.002,
    rockCoverage: 0.001,
    wallCoverage: 0.001,
    maximumDurationSeconds: 20,
    stalemateSeconds: 18,
  };
}

function expectMapBoundaries(map: BattleMap, seed: string): void {
  const cellCount = map.width * map.height;
  for (const [name, layer] of Object.entries(map.layers)) {
    expect(layer.length, `${seed}: ${name} length`).toBe(cellCount);
  }

  const objectIds = new Set<string>();
  for (const staticObject of map.staticObjects) {
    expect(isInsideMap(map, staticObject.cell), `${seed}: ${staticObject.id} bounds`).toBe(true);
    expect(objectIds.has(staticObject.id), `${seed}: duplicate ${staticObject.id}`).toBe(false);
    objectIds.add(staticObject.id);
    expect(
      map.layers.staticOccupancy[cellIndex(map, staticObject.cell)],
      `${seed}: ${staticObject.id} occupancy`,
    ).toBe(STATIC_OBJECT_DEFINITIONS[staticObject.kind].typeId);
  }
}

function placeHostileGroupsInContact(setup: BattleSetup): BattleSetup {
  const neutral = setup.groups.find((group) => group.factionId === "olive");
  if (!neutral) {
    throw new Error(`${setup.seed}: missing neutral fixture group.`);
  }
  const pathfinder = createPathfinder(setup.map);
  const offsets: readonly GridCoord[] = [
    { x: 6, z: 0 },
    { x: 5, z: 1 },
    { x: 5, z: -1 },
    { x: 4, z: 2 },
    { x: 4, z: -2 },
  ];
  let contactCells: readonly [GridCoord, GridCoord] | undefined;

  for (let z = 2; z < setup.map.height - 2 && !contactCells; z += 1) {
    for (let x = Math.floor(setup.map.width * 0.58); x < setup.map.width - 6; x += 1) {
      const from = { x, z };
      if (!isWalkable(setup.map, from) || squaredDistance(from, neutral.spawn) < 100) {
        continue;
      }
      for (const offset of offsets) {
        const to = { x: from.x + offset.x, z: from.z + offset.z };
        if (
          !isInsideMap(setup.map, to) ||
          !isWalkable(setup.map, to) ||
          squaredDistance(to, neutral.spawn) < 100 ||
          !hasLineOfSight(setup.map, from, to) ||
          !hasRoute(pathfinder, from, to)
        ) {
          continue;
        }
        contactCells = [from, to];
        break;
      }
      if (contactCells) {
        break;
      }
    }
  }

  if (!contactCells) {
    throw new Error(`${setup.seed}: unable to place a reproducible hostile contact.`);
  }
  const [emberSpawn, azureSpawn] = contactCells;
  return {
    ...setup,
    groups: setup.groups.map((group) => {
      const spawn =
        group.factionId === "ember"
          ? emberSpawn
          : group.factionId === "azure"
            ? azureSpawn
            : group.spawn;
      return {
        ...group,
        spawn: { ...spawn },
        evacuation: { ...spawn },
      };
    }),
  };
}

function expectRequiredRoutes(setup: BattleSetup, seed: string): void {
  const pathfinder = createPathfinder(setup.map);
  for (const group of setup.groups) {
    expect(isInsideMap(setup.map, group.spawn), `${seed}: ${group.id} spawn bounds`).toBe(true);
    expect(isInsideMap(setup.map, group.evacuation), `${seed}: ${group.id} evac bounds`).toBe(
      true,
    );
    expect(isWalkable(setup.map, group.spawn), `${seed}: ${group.id} spawn walkable`).toBe(true);
    expect(isWalkable(setup.map, group.evacuation), `${seed}: ${group.id} evac walkable`).toBe(
      true,
    );
    expect(
      hasRoute(pathfinder, group.spawn, group.evacuation),
      `${seed}: ${group.id} evacuation route`,
    ).toBe(true);
  }

  if (setup.mode.kind === "defense") {
    for (const objective of defenseObjectives(setup.mode)) {
      expect(isInsideMap(setup.map, objective.center), `${seed}: ${objective.id} bounds`).toBe(
        true,
      );
      expect(
        objective.center.x - objective.radiusCells,
        `${seed}: ${objective.id} left edge`,
      ).toBeGreaterThanOrEqual(0);
      expect(
        objective.center.z - objective.radiusCells,
        `${seed}: ${objective.id} top edge`,
      ).toBeGreaterThanOrEqual(0);
      expect(
        objective.center.x + objective.radiusCells,
        `${seed}: ${objective.id} right edge`,
      ).toBeLessThan(setup.map.width);
      expect(
        objective.center.z + objective.radiusCells,
        `${seed}: ${objective.id} bottom edge`,
      ).toBeLessThan(setup.map.height);
      expect(isWalkable(setup.map, objective.center), `${seed}: ${objective.id} walkable`).toBe(
        true,
      );
      for (const group of setup.groups) {
        expect(
          hasRoute(pathfinder, group.spawn, objective.center),
          `${seed}: ${group.id} route to ${objective.id}`,
        ).toBe(true);
      }
    }
    return;
  }

  for (const relation of setup.relations.filter((candidate) => candidate.kind === "hostile")) {
    const firstGroups = setup.groups.filter((group) => group.factionId === relation.a);
    const secondGroups = setup.groups.filter((group) => group.factionId === relation.b);
    expect(
      firstGroups.some((first) =>
        secondGroups.some((second) => hasRoute(pathfinder, first.spawn, second.spawn)),
      ),
      `${seed}: hostile route ${relation.a}/${relation.b}`,
    ).toBe(true);
  }
}

function expectHostileFireOnly(
  setup: BattleSetup,
  events: readonly BattleEvent[],
  seed: string,
): void {
  const factionByGroupId = new Map(setup.groups.map((group) => [group.id, group.factionId]));
  const weaponEvents = events.filter(
    (event): event is Extract<BattleEvent, { type: "weapon-fired" }> =>
      event.type === "weapon-fired",
  );
  expect(weaponEvents.length, `${seed}: hostile factions never exchanged fire`).toBeGreaterThan(0);
  for (const event of weaponEvents) {
    const attackerFactionId = factionByGroupId.get(event.groupId);
    const targetFactionId = factionByGroupId.get(event.targetGroupId);
    expect(attackerFactionId, `${seed}: unknown attacker ${event.groupId}`).toBeDefined();
    expect(targetFactionId, `${seed}: unknown target ${event.targetGroupId}`).toBeDefined();
    expect(
      areHostile(setup.relations, attackerFactionId!, targetFactionId!),
      `${seed}: non-hostile fire ${attackerFactionId}/${targetFactionId}`,
    ).toBe(true);
  }
}

function expectNeutralFactionUnharmed(
  result: BattleResult,
  events: readonly BattleEvent[],
  seed: string,
): void {
  const neutralMembers = result.members.filter((member) => member.factionId === "olive");
  expect(neutralMembers.length, `${seed}: missing neutral members`).toBe(8);
  expect(
    neutralMembers.every((member) => member.health === "healthy"),
    `${seed}: neutral member was harmed`,
  ).toBe(true);
  expect(
    events.some(
      (event) => event.type === "member-health-changed" && event.groupId === "olive-squad-1",
    ),
    `${seed}: neutral health event`,
  ).toBe(false);
}

function expectMemberConservation(
  setup: BattleSetup,
  result: BattleResult,
  seed: string,
): void {
  const inputGroups = [
    ...setup.groups,
    ...setup.reinforcements.flatMap((wave) => wave.groups),
  ];
  const inputMemberIds = inputGroups
    .flatMap((group) => group.members.map((member) => member.id))
    .sort(compareStrings);
  const inputGroupIds = inputGroups.map((group) => group.id).sort(compareStrings);
  const resultGroupIds = result.groups.map((group) => group.id).sort(compareStrings);
  const resultMemberIds = result.members.map((member) => member.id).sort(compareStrings);
  expect(resultGroupIds, `${seed}: group IDs`).toEqual(inputGroupIds);
  expect(new Set(resultGroupIds).size, `${seed}: unique group IDs`).toBe(
    inputGroupIds.length,
  );
  expect(resultMemberIds, `${seed}: member IDs`).toEqual(inputMemberIds);
  expect(new Set(resultMemberIds).size, `${seed}: unique member IDs`).toBe(
    inputMemberIds.length,
  );

  expect(
    countValues(result.members.map((member) => member.health), [
      "healthy",
      "wounded",
      "incapacitated",
      "dead",
    ]),
    `${seed}: health conservation`,
  ).toBe(inputMemberIds.length);
  expect(
    countValues(result.members.map((member) => member.presence), [
      "undeployed",
      "deployed",
      "evacuated",
    ]),
    `${seed}: presence conservation`,
  ).toBe(inputMemberIds.length);
  expect(
    countValues(result.members.map((member) => member.disposition), [
      "present",
      "evacuated",
      "missing",
      "undeployed",
    ]),
    `${seed}: disposition conservation`,
  ).toBe(inputMemberIds.length);
  expect(
    countValues(result.members.map((member) => member.deployment), [
      "undeployed",
      "deployed",
      "evacuated",
    ]),
    `${seed}: deployment conservation`,
  ).toBe(inputMemberIds.length);

  for (const group of result.groups) {
    const members = result.members.filter((member) => member.groupId === group.id);
    const activeMembers = members.filter(
      (member) =>
        (group.deployment === "undeployed"
          ? member.presence === "undeployed"
          : member.presence === "deployed") &&
        (member.health === "healthy" || member.health === "wounded"),
    ).length;
    expect(group.activeMembers, `${seed}: ${group.id} active members`).toBe(activeMembers);
    expect(group.evacuated, `${seed}: ${group.id} evacuation projection`).toBe(
      members.some((member) => member.presence === "evacuated"),
    );
  }
}

function hasRoute(
  pathfinder: ReturnType<typeof createPathfinder>,
  from: GridCoord,
  to: GridCoord,
): boolean {
  return (from.x === to.x && from.z === to.z) || pathfinder.findPath(from, to).length > 0;
}

function requireResult(result: BattleResult | undefined, seed: string): BattleResult {
  expect(result, `${seed}: missing result`).toBeDefined();
  return result!;
}

function countValues<T>(values: readonly T[], allowed: readonly T[]): number {
  const allowedValues = new Set(allowed);
  return values.filter((value) => allowedValues.has(value)).length;
}

function seedVariant(seed: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

function squaredDistance(first: GridCoord, second: GridCoord): number {
  return (first.x - second.x) ** 2 + (first.z - second.z) ** 2;
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
