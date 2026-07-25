import { describe, expect, it } from "vitest";
import {
  BATTLE_MAP_SCHEMA_VERSION,
  STATIC_OBJECT_DEFINITIONS,
  SURFACE_TYPE_IDS,
  WATER_DEPTH_UNITS,
  createBattleSetup,
  createSimulation,
  type BattleMap,
  type BattleSetup,
  type FactionId,
  type GridCoord,
  type GroupInspection,
  type GroupSpawn,
  type StaticMapObject,
} from "./index";

describe("limited-intelligence cover AI", () => {
  it("assigns defenders to public objective cover without inventing an enemy contact", () => {
    const map = createFlatMap([createStaticObject("objective-wall", "wall", 20, 11, 0)]);
    const setup = createDefenseSetup(map);
    const simulation = createSimulation(setup);
    const initial = simulation.inspect("azure-defender") as GroupInspection;

    expect(initial.defenseSlot).toEqual({ x: 20, z: 10 });
    expect(initial.coverEvaluation).toMatchObject({
      reason: "defend-objective-cover",
      selectedSlotId: "objective-wall:cover-0",
      evaluatedAt: 0,
    });
    expect(initial.coverEvaluation?.score).toBeGreaterThan(0);
    expect(initial.coverEvaluation?.threat).toBeUndefined();

    simulation.step(320);
    const arrived = simulation.inspect("azure-defender") as GroupInspection;
    expect(arrived.cell).toEqual({ x: 20, z: 10 });
    expect(arrived.currentCover).toMatchObject({
      slotId: "objective-wall:cover-0",
      coveredMembers: 6,
    });
  });

  it("uses the same last-known threat for suppression cover despite different hidden truth", () => {
    const first = createSuppressionScenario({ x: 12, z: 10 }, true);
    const second = createSuppressionScenario({ x: 30, z: 3 }, true);

    first.step(5);
    second.step(5);
    const firstInspection = first.inspect("ember-suppressed") as GroupInspection;
    const secondInspection = second.inspect("ember-suppressed") as GroupInspection;

    expect(firstInspection.decisionReason).toBe("seek-cover-high-suppression");
    expect(firstInspection.path.at(-1)).toEqual({ x: 12, z: 10 });
    expect(firstInspection.coverEvaluation).toMatchObject({
      reason: "seek-cover-high-suppression",
      selectedSlotId: "threat-wall:cover-0",
      evaluatedAt: 4,
      threat: {
        targetGroupId: "azure-hidden",
        lastKnown: { x: 12, z: 18 },
        observedAt: 0,
        source: "local-contact",
      },
    });
    expect(secondInspection.coverEvaluation).toEqual(firstInspection.coverEvaluation);
    expect(secondInspection.path).toEqual(firstInspection.path);

    const occupiedTruth = getMutableCoverDecision(first);
    const hash = first.getStateHash();
    occupiedTruth.score += 1;
    expect(first.getStateHash()).not.toBe(hash);
  });

  it("reports unavailable cover and continues toward known information", () => {
    const simulation = createSuppressionScenario({ x: 30, z: 20 }, false);
    simulation.step(5);
    const inspection = simulation.inspect("ember-suppressed") as GroupInspection;

    expect(inspection.coverEvaluation).toEqual({
      reason: "no-cover-available",
      score: 0,
      evaluatedAt: 4,
      threat: {
        targetGroupId: "azure-hidden",
        lastKnown: { x: 12, z: 18 },
        observedAt: 0,
        source: "local-contact",
      },
    });
    expect(inspection.action).toBe("moving-to-contact");
    expect(inspection.path.at(-1)).toEqual({ x: 12, z: 18 });
  });
});

function createDefenseSetup(map: BattleMap): BattleSetup {
  const base = createBattleSetup({
    seed: "cover-defense-ai",
    width: map.width,
    height: map.height,
    groupsPerFaction: 1,
    mode: "defense",
  });
  return {
    ...base,
    battleId: "cover-defense-ai",
    map,
    groups: [
      createGroup("ember-attacker", "ember", 8, 12),
      createGroup("azure-defender", "azure", 32, 12),
    ],
    mode: {
      kind: "defense",
      attackerFactionId: "ember",
      defenderFactionId: "azure",
      objective: {
        id: "cover-objective",
        center: { x: 20, z: 12 },
        radiusCells: 2,
      },
    },
    rules: {
      ...base.rules,
      sightRangeCells: 0,
      weaponRangeCells: 0,
      preferredRangeCells: 0,
      stalemateTicks: 1_000,
      maximumDurationTicks: 1_000,
    },
  };
}

function createSuppressionScenario(
  hiddenTarget: GridCoord,
  withCover: boolean,
): ReturnType<typeof createSimulation> {
  const staticObjects = withCover
    ? [createStaticObject("threat-wall", "wall", 12, 11, 0)]
    : [];
  const map = createFlatMap(staticObjects);
  const base = createBattleSetup({
    seed: "cover-suppression-ai",
    width: map.width,
    height: map.height,
    groupsPerFaction: 1,
  });
  const setup: BattleSetup = {
    ...base,
    battleId: `cover-hidden-${hiddenTarget.x}-${hiddenTarget.z}-${withCover}`,
    map,
    groups: [
      createGroup("ember-suppressed", "ember", 10, 10),
      createGroup("azure-hidden", "azure", hiddenTarget.x, hiddenTarget.z),
    ],
    rules: {
      ...base.rules,
      sightRangeCells: 0,
      weaponRangeCells: 0,
      preferredRangeCells: 0,
      stalemateTicks: 1_000,
      maximumDurationTicks: 1_000,
    },
  };
  const simulation = createSimulation(setup);
  const group = getMutableGroup(simulation, "ember-suppressed");
  group.suppressionBps = 8_000;
  group.localContacts.set("azure-hidden", {
    targetGroupId: "azure-hidden",
    lastKnown: { x: 12, z: 18 },
    observedAt: 0,
    lastDirectTick: -100,
    confidenceBps: 10_000,
    sourceGroupId: "ember-suppressed",
  });
  return simulation;
}

function createFlatMap(staticObjects: readonly StaticMapObject[]): BattleMap {
  const width = 40;
  const height = 24;
  const size = width * height;
  const staticOccupancy = new Uint8Array(size);
  for (const object of staticObjects) {
    staticOccupancy[object.cell.z * width + object.cell.x] =
      STATIC_OBJECT_DEFINITIONS[object.kind].typeId;
  }
  return {
    schemaVersion: BATTLE_MAP_SCHEMA_VERSION,
    width,
    height,
    cellSizeMm: 4_000,
    heightUnitMm: 500,
    layers: {
      heightUnits: new Int16Array(size),
      surfaceTypeIds: new Uint16Array(size).fill(SURFACE_TYPE_IDS.grass),
      waterDepthUnits: new Uint8Array(size).fill(WATER_DEPTH_UNITS.none),
      cellFlags: new Uint16Array(size),
      staticOccupancy,
    },
    staticObjects,
  };
}

function createStaticObject(
  id: string,
  kind: StaticMapObject["kind"],
  x: number,
  z: number,
  facing: StaticMapObject["facing"],
): StaticMapObject {
  return { id, kind, cell: { x, z }, facing };
}

function createGroup(
  id: string,
  factionId: FactionId,
  x: number,
  z: number,
): GroupSpawn {
  return {
    id,
    factionId,
    spawn: { x, z },
    evacuation: { x, z },
    members: Array.from({ length: 8 }, (_, index) => ({ id: `${id}-member-${index + 1}` })),
  };
}

interface MutableGroupForCoverTest {
  suppressionBps: number;
  readonly localContacts: Map<
    string,
    {
      targetGroupId: string;
      lastKnown: GridCoord;
      observedAt: number;
      lastDirectTick: number;
      confidenceBps: number;
      sourceGroupId: string;
    }
  >;
  coverDecision?: { score: number };
}

function getMutableGroup(
  simulation: ReturnType<typeof createSimulation>,
  groupId: string,
): MutableGroupForCoverTest {
  const runtime = simulation as unknown as {
    readonly state: { readonly groupsById: Map<string, MutableGroupForCoverTest> };
  };
  const group = runtime.state.groupsById.get(groupId);
  if (!group) {
    throw new Error(`Expected runtime group ${groupId}.`);
  }
  return group;
}

function getMutableCoverDecision(
  simulation: ReturnType<typeof createSimulation>,
): { score: number } {
  const decision = getMutableGroup(simulation, "ember-suppressed").coverDecision;
  if (!decision) {
    throw new Error("Expected a cover decision.");
  }
  return decision;
}
