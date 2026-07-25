import { describe, expect, it } from "vitest";
import {
  BATTLE_MAP_SCHEMA_VERSION,
  BATTLE_RULES_VERSION,
  BATTLE_SETUP_SCHEMA_VERSION,
  FOOT_MOVEMENT_COST_MATRIX,
  MAP_CELL_FLAGS,
  SURFACE_TYPE_IDS,
  WATER_DEPTH_UNITS,
  canTraverseStep,
  createBattleSetup,
  createPathfinder,
  createSimulation,
  hasLineOfSight,
  isWalkable,
  movementCostAt,
  movementStepCost,
  validateBattleMap,
  validateBattleSetup,
  type BattleMap,
  type BattleSetup,
} from "./index";

describe("standard terrain layers", () => {
  it("combines surface and water layers through the foot movement matrix", () => {
    const map = createFlatMap(6, 2);
    setTerrain(map, { x: 1, z: 0 }, SURFACE_TYPE_IDS.sand, WATER_DEPTH_UNITS.none);
    setTerrain(map, { x: 2, z: 0 }, SURFACE_TYPE_IDS.grass, WATER_DEPTH_UNITS.shallow);
    setTerrain(map, { x: 3, z: 0 }, SURFACE_TYPE_IDS.mud, WATER_DEPTH_UNITS.none);
    setTerrain(map, { x: 4, z: 0 }, SURFACE_TYPE_IDS.mud, WATER_DEPTH_UNITS.shallow);
    setTerrain(map, { x: 5, z: 0 }, SURFACE_TYPE_IDS.grass, WATER_DEPTH_UNITS.deep);

    const grassCost = movementCostAt(map, { x: 0, z: 0 });
    const sandCost = movementCostAt(map, { x: 1, z: 0 });
    const shallowWaterCost = movementCostAt(map, { x: 2, z: 0 });
    const dryMudCost = movementCostAt(map, { x: 3, z: 0 });
    const marshCost = movementCostAt(map, { x: 4, z: 0 });

    expect(FOOT_MOVEMENT_COST_MATRIX).toEqual([
      [10, 16, 0],
      [13, 19, 0],
      [16, 24, 0],
      [12, 18, 0],
      [8, 14, 0],
    ]);
    expect({ grassCost, sandCost, shallowWaterCost, dryMudCost, marshCost }).toEqual({
      grassCost: 10,
      sandCost: 13,
      shallowWaterCost: 16,
      dryMudCost: 16,
      marshCost: 24,
    });
    expect(sandCost).toBeGreaterThan(grassCost);
    expect(shallowWaterCost).toBeGreaterThan(grassCost);
    expect(marshCost).toBeGreaterThan(dryMudCost);
    expect(marshCost).toBeGreaterThan(shallowWaterCost);
    expect(movementStepCost(map, { x: 0, z: 0 }, { x: 1, z: 0 })).toBe(1_300);
    expect(movementCostAt(map, { x: 5, z: 0 })).toBe(0);
    expect(isWalkable(map, { x: 5, z: 0 })).toBe(false);
  });

  it("routes around expensive marsh and treats deep water as impassable", () => {
    const map = createFlatMap(7, 3);
    for (let x = 1; x <= 5; x += 1) {
      setTerrain(map, { x, z: 1 }, SURFACE_TYPE_IDS.mud, WATER_DEPTH_UNITS.shallow);
    }

    const path = createPathfinder(map).findPath({ x: 0, z: 1 }, { x: 6, z: 1 });
    expect(path.length).toBeGreaterThan(0);
    expect(path.slice(1, -1).some((coord) => coord.z !== 1)).toBe(true);

    for (let z = 0; z < map.height; z += 1) {
      setTerrain(map, { x: 3, z }, SURFACE_TYPE_IDS.grass, WATER_DEPTH_UNITS.deep);
    }
    expect(createPathfinder(map).findPath({ x: 0, z: 1 }, { x: 6, z: 1 })).toEqual([]);

    const roadMap = createFlatMap(20, 3);
    for (let x = 1; x < roadMap.width - 1; x += 1) {
      setTerrain(roadMap, { x, z: 0 }, SURFACE_TYPE_IDS.paved, WATER_DEPTH_UNITS.none);
    }
    const roadPath = createPathfinder(roadMap).findPath(
      { x: 0, z: 1 },
      { x: roadMap.width - 1, z: 1 },
    );
    expect(roadPath.some((coord) => coord.z === 0)).toBe(true);
  });

  it("keeps ground blockers separate from water and preserves corner-cutting rules", () => {
    const map = createFlatMap(3, 3);
    setTerrain(map, { x: 1, z: 0 }, SURFACE_TYPE_IDS.grass, WATER_DEPTH_UNITS.deep);
    map.layers.cellFlags[map.width] = MAP_CELL_FLAGS.groundBlocked;

    expect(isWalkable(map, { x: 1, z: 0 })).toBe(false);
    expect(isWalkable(map, { x: 0, z: 1 })).toBe(false);
    expect(canTraverseStep(map, { x: 0, z: 0 }, { x: 1, z: 1 })).toBe(false);
    expect(canTraverseStep(map, { x: 1, z: 0 }, { x: 1, z: 1 })).toBe(false);
    expect(() => movementStepCost(map, { x: 1, z: 0 }, { x: 1, z: 1 })).toThrow(
      /illegal movement step/i,
    );

    const waterLine = createFlatMap(5, 1);
    setTerrain(
      waterLine,
      { x: 2, z: 0 },
      SURFACE_TYPE_IDS.grass,
      WATER_DEPTH_UNITS.deep,
    );
    expect(hasLineOfSight(waterLine, { x: 0, z: 0 }, { x: 4, z: 0 })).toBe(true);
  });

  it("rejects unsupported versions, malformed layers, and illegal terrain values", () => {
    const wrongVersion = createFlatMap(3, 3);
    expect(() =>
      validateBattleMap({
        ...wrongVersion,
        schemaVersion: "map-v0",
      } as unknown as BattleMap),
    ).toThrow(/map schema version/i);

    const wrongLength = createFlatMap(3, 3);
    expect(() =>
      validateBattleMap({
        ...wrongLength,
        layers: { ...wrongLength.layers, waterDepthUnits: new Uint8Array(8) },
      }),
    ).toThrow(/width \* height/i);

    const invalidSurface = createFlatMap(3, 3);
    invalidSurface.layers.surfaceTypeIds[0] = 99;
    expect(() => validateBattleMap(invalidSurface)).toThrow(/surface type/i);

    const invalidWater = createFlatMap(3, 3);
    invalidWater.layers.waterDepthUnits[0] = 99;
    expect(() => validateBattleMap(invalidWater)).toThrow(/water depth/i);

    const invalidFlags = createFlatMap(3, 3);
    invalidFlags.layers.cellFlags[0] = 1 << 8;
    expect(() => validateBattleMap(invalidFlags)).toThrow(/cell flags/i);
  });

  it("rejects spawns and defense objectives placed in deep water", () => {
    const conflict = createBattleSetup({ seed: "deep-spawn", groupsPerFaction: 1 });
    const spawn = conflict.groups[0]!.spawn;
    conflict.map.layers.waterDepthUnits[spawn.z * conflict.map.width + spawn.x] =
      WATER_DEPTH_UNITS.deep;
    expect(() => validateBattleSetup(conflict)).toThrow(/illegal spawn/i);

    const evacuationBase = createBattleSetup({ seed: "deep-evacuation", groupsPerFaction: 1 });
    const spawnIndices = new Set(
      evacuationBase.groups.map(
        (group) => group.spawn.z * evacuationBase.map.width + group.spawn.x,
      ),
    );
    const exitIndex = Array.from(
      { length: evacuationBase.map.width * evacuationBase.map.height },
      (_, index) => index,
    ).find(
      (index) =>
        !spawnIndices.has(index) &&
        isWalkable(evacuationBase.map, {
          x: index % evacuationBase.map.width,
          z: Math.floor(index / evacuationBase.map.width),
        }),
    );
    if (exitIndex === undefined) {
      throw new Error("Expected an independent evacuation cell.");
    }
    const exit = {
      x: exitIndex % evacuationBase.map.width,
      z: Math.floor(exitIndex / evacuationBase.map.width),
    };
    const evacuation = {
      ...evacuationBase,
      groups: evacuationBase.groups.map((group, index) =>
        index === 0 ? { ...group, evacuation: exit } : group,
      ),
    };
    evacuation.map.layers.waterDepthUnits[exitIndex] =
      WATER_DEPTH_UNITS.deep;
    expect(() => validateBattleSetup(evacuation)).toThrow(/illegal evacuation/i);

    const defense = createBattleSetup({
      seed: "deep-objective",
      groupsPerFaction: 1,
      mode: "defense",
    });
    if (defense.mode.kind !== "defense") {
      throw new Error("Expected defense mode.");
    }
    const center = defense.mode.objective.center;
    defense.map.layers.waterDepthUnits[center.z * defense.map.width + center.x] =
      WATER_DEPTH_UNITS.deep;
    expect(() => validateBattleSetup(defense)).toThrow(/legal center/i);
  });

  it("versions, clones, and hashes authoritative map layers", () => {
    const firstSetup = createBattleSetup({ seed: "terrain-hash", groupsPerFaction: 1 });
    const secondSetup = createBattleSetup({ seed: "terrain-hash", groupsPerFaction: 1 });
    expect(firstSetup.schemaVersion).toBe(BATTLE_SETUP_SCHEMA_VERSION);
    expect(firstSetup.rulesVersion).toBe(BATTLE_RULES_VERSION);
    expect(firstSetup.map.schemaVersion).toBe(BATTLE_MAP_SCHEMA_VERSION);
    expect(() =>
      validateBattleSetup({
        ...firstSetup,
        schemaVersion: "stage-1",
      } as unknown as BattleSetup),
    ).toThrow(/setup version/i);

    const changedIndex = 10 * secondSetup.map.width + 10;
    secondSetup.map.layers.surfaceTypeIds[changedIndex] = SURFACE_TYPE_IDS.sand;
    const first = createSimulation(firstSetup);
    const second = createSimulation(secondSetup);
    expect(first.getStateHash()).not.toBe(second.getStateHash());

    secondSetup.map.layers.surfaceTypeIds[changedIndex] = SURFACE_TYPE_IDS.mud;
    expect(second.getSetup().map.layers.surfaceTypeIds[changedIndex]).toBe(
      SURFACE_TYPE_IDS.sand,
    );
    const exposedSetup = second.getSetup();
    exposedSetup.map.layers.surfaceTypeIds[changedIndex] = SURFACE_TYPE_IDS.grass;
    expect(second.getSetup().map.layers.surfaceTypeIds[changedIndex]).toBe(
      SURFACE_TYPE_IDS.sand,
    );

    const changedRules = createSimulation({
      ...firstSetup,
      rules: {
        ...firstSetup.rules,
        maximumDurationTicks: firstSetup.rules.maximumDurationTicks + 1,
      },
    });
    expect(first.getStateHash()).not.toBe(changedRules.getStateHash());
  });
});

function createFlatMap(width: number, height: number): BattleMap {
  const size = width * height;
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
    },
  };
}

function setTerrain(
  map: BattleMap,
  coord: { readonly x: number; readonly z: number },
  surfaceTypeId: number,
  waterDepthUnits: number,
): void {
  const index = coord.z * map.width + coord.x;
  map.layers.surfaceTypeIds[index] = surfaceTypeId;
  map.layers.waterDepthUnits[index] = waterDepthUnits;
}
