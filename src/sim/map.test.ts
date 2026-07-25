import { describe, expect, it } from "vitest";
import {
  BATTLE_MAP_SCHEMA_VERSION,
  BATTLE_RULES_VERSION,
  BATTLE_SETUP_SCHEMA_VERSION,
  FOOT_MOVEMENT_COST_MATRIX,
  MAP_CELL_FLAGS,
  STATIC_OBJECT_DEFINITIONS,
  SURFACE_TYPE_IDS,
  WATER_DEPTH_UNITS,
  canTraverseStep,
  cellIndex,
  createBattleSetup,
  createPathfinder,
  createSimulation,
  generateBattleMap,
  hasLineOfSight,
  isWalkable,
  movementCostAt,
  movementStepCost,
  validateBattleMap,
  validateBattleSetup,
  type BattleMap,
  type BattleSetup,
  type StaticMapObject,
} from "./index";

describe("standard terrain layers", () => {
  it("generates deterministic, configurable mountains, water, and wetlands", () => {
    const common = {
      seed: "composite-terrain",
      width: 56,
      height: 42,
      roughness: 0.52,
    };
    const sparse = generateBattleMap({
      ...common,
      mountainDensity: 0.08,
      waterCoverage: 0.02,
      wetlandCoverage: 0.01,
    });
    const mountainDense = generateBattleMap({
      ...common,
      mountainDensity: 0.28,
      waterCoverage: 0.02,
      wetlandCoverage: 0.01,
    });
    const waterDense = generateBattleMap({
      ...common,
      mountainDensity: 0.08,
      waterCoverage: 0.16,
      wetlandCoverage: 0.01,
    });
    const wetlandDense = generateBattleMap({
      ...common,
      mountainDensity: 0.08,
      waterCoverage: 0.02,
      wetlandCoverage: 0.12,
    });
    const repeated = generateBattleMap({
      ...common,
      mountainDensity: 0.08,
      waterCoverage: 0.02,
      wetlandCoverage: 0.12,
    });

    expect(wetlandDense.layers.heightUnits).toEqual(repeated.layers.heightUnits);
    expect(wetlandDense.layers.surfaceTypeIds).toEqual(repeated.layers.surfaceTypeIds);
    expect(wetlandDense.layers.waterDepthUnits).toEqual(repeated.layers.waterDepthUnits);
    expect(wetlandDense.layers.cellFlags).toEqual(repeated.layers.cellFlags);

    const sparseSummary = summarizeTerrain(sparse);
    const mountainSummary = summarizeTerrain(mountainDense);
    const waterSummary = summarizeTerrain(waterDense);
    const wetlandSummary = summarizeTerrain(wetlandDense);
    const cellCount = common.width * common.height;
    expect(sparseSummary.mountainCells).toBe(Math.round(cellCount * 0.08));
    expect(mountainSummary.mountainCells).toBe(Math.round(cellCount * 0.28));
    expect(waterSummary.openWaterCells).toBe(Math.round(cellCount * 0.16));
    expect(wetlandSummary.wetlandCells).toBe(Math.round(cellCount * 0.12));
    expect(waterSummary.deepWaterCells).toBeGreaterThan(0);
    expect(wetlandSummary.shallowWaterCells).toBeGreaterThan(0);

    expect(() =>
      generateBattleMap({
        ...common,
        mountainDensity: Number.NaN,
        waterCoverage: 0.1,
        wetlandCoverage: 0.1,
      }),
    ).toThrow(/mountainDensity/);
    expect(() =>
      generateBattleMap({
        ...common,
        mountainDensity: 0.2,
        waterCoverage: Number.POSITIVE_INFINITY,
        wetlandCoverage: 0.1,
      }),
    ).toThrow(/waterCoverage/);
    expect(() =>
      generateBattleMap({
        ...common,
        mountainDensity: 0.2,
        waterCoverage: 0.1,
        wetlandCoverage: 1.01,
      }),
    ).toThrow(/wetlandCoverage/);
    expect(() =>
      generateBattleMap({
        ...common,
        mountainDensity: 1,
        waterCoverage: 0,
        wetlandCoverage: 0,
      }),
    ).toThrow(/mountainDensity cannot be satisfied/);
    expect(() =>
      generateBattleMap({
        ...common,
        mountainDensity: 0,
        waterCoverage: 1,
        wetlandCoverage: 0,
      }),
    ).toThrow(/waterCoverage cannot be satisfied/);
    expect(() =>
      generateBattleMap({
        ...common,
        mountainDensity: 0,
        waterCoverage: 0,
        wetlandCoverage: 1,
      }),
    ).toThrow(/wetlandCoverage cannot be satisfied/);
    expect(() =>
      generateBattleMap({
        ...common,
        width: 300,
        height: 300,
        mountainDensity: 0,
        waterCoverage: 0,
        wetlandCoverage: 0,
      }),
    ).toThrow(/cannot exceed 65536 cells/i);
    expect(() =>
      generateBattleMap({
        ...common,
        width: 100,
        height: 20,
        mountainDensity: 0,
        waterCoverage: 0,
        wetlandCoverage: 0,
      }),
    ).toThrow(/aspect ratio/i);
  });

  it("generates deterministic authoritative trees, rocks, and walls", () => {
    const options = {
      seed: "authoritative-static-objects",
      width: 56,
      height: 42,
      mountainDensity: 0.08,
      roughness: 0.52,
      waterCoverage: 0.02,
      wetlandCoverage: 0.01,
      treeCoverage: 0.03,
      rockCoverage: 0.01,
      wallCoverage: 0.005,
    };
    const first = generateBattleMap(options);
    const second = generateBattleMap(options);

    expect(first.layers.staticOccupancy).toEqual(second.layers.staticOccupancy);
    expect(first.staticObjects).toEqual(second.staticObjects);
    const counts = countStaticObjectKinds(first.staticObjects);
    const cellCount = options.width * options.height;
    expect(counts).toEqual({
      tree: Math.round(cellCount * options.treeCoverage),
      rock: Math.round(cellCount * options.rockCoverage),
      wall: Math.round(cellCount * options.wallCoverage),
    });
    expect(new Set(first.staticObjects.map((object) => object.id)).size).toBe(
      first.staticObjects.length,
    );

    for (const object of first.staticObjects) {
      const index = cellIndex(first, object.cell);
      expect(first.layers.staticOccupancy[index]).toBe(
        STATIC_OBJECT_DEFINITIONS[object.kind].typeId,
      );
      expect(first.layers.waterDepthUnits[index]).toBe(WATER_DEPTH_UNITS.none);
      expect((first.layers.cellFlags[index] ?? 0) & MAP_CELL_FLAGS.groundBlocked).toBe(0);
      expect(isWalkable(first, object.cell)).toBe(false);
    }

    expect(() =>
      generateBattleMap({ ...options, treeCoverage: Number.NaN }),
    ).toThrow(/treeCoverage/);
    expect(() =>
      generateBattleMap({ ...options, rockCoverage: Number.POSITIVE_INFINITY }),
    ).toThrow(/rockCoverage/);
    expect(() =>
      generateBattleMap({ ...options, wallCoverage: 1.01 }),
    ).toThrow(/wallCoverage/);
  });

  it("keeps deployments and a defense attack route legal on composite terrain", () => {
    const setup = createBattleSetup({
      seed: "composite-defense-route",
      width: 56,
      height: 42,
      groupsPerFaction: 4,
      mode: "defense",
      mountainDensity: 0.22,
      roughness: 0.62,
      waterCoverage: 0.18,
      wetlandCoverage: 0.14,
    });
    if (setup.mode.kind !== "defense") {
      throw new Error("Expected defense mode.");
    }
    const mode = setup.mode;

    for (const group of setup.groups) {
      expect(isWalkable(setup.map, group.spawn)).toBe(true);
      expect(isWalkable(setup.map, group.evacuation)).toBe(true);
    }
    expect(isWalkable(setup.map, mode.objective.center)).toBe(true);

    const pathfinder = createPathfinder(setup.map);
    const attackPaths = setup.groups
      .filter((group) => group.factionId === mode.attackerFactionId)
      .map((group) => pathfinder.findPath(group.spawn, mode.objective.center));
    expect(attackPaths.every((path) => path.length > 1)).toBe(true);

    const disconnected = createBattleSetup({
      seed: "disconnected-defense-route",
      width: 40,
      height: 24,
      groupsPerFaction: 1,
      mode: "defense",
      mountainDensity: 0,
      roughness: 0,
      waterCoverage: 0,
      wetlandCoverage: 0,
      treeCoverage: 0,
      rockCoverage: 0,
      wallCoverage: 0,
    });
    for (let z = 0; z < disconnected.map.height; z += 1) {
      disconnected.map.layers.waterDepthUnits[z * disconnected.map.width + 20] =
        WATER_DEPTH_UNITS.deep;
    }
    expect(() => validateBattleSetup(disconnected)).toThrow(/attack route/i);

    const disconnectedDefender = createBattleSetup({
      seed: "disconnected-defense-position",
      width: 40,
      height: 24,
      groupsPerFaction: 1,
      mode: "defense",
      mountainDensity: 0,
      roughness: 0,
      waterCoverage: 0,
      wetlandCoverage: 0,
      treeCoverage: 0,
      rockCoverage: 0,
      wallCoverage: 0,
    });
    for (let z = 0; z < disconnectedDefender.map.height; z += 1) {
      disconnectedDefender.map.layers.waterDepthUnits[
        z * disconnectedDefender.map.width + 32
      ] = WATER_DEPTH_UNITS.deep;
    }
    expect(() => validateBattleSetup(disconnectedDefender)).toThrow(/defense route/i);

    const evacuationBase = createBattleSetup({
      seed: "disconnected-evacuation-route",
      width: 40,
      height: 24,
      groupsPerFaction: 1,
      mountainDensity: 0,
      roughness: 0,
      waterCoverage: 0,
      wetlandCoverage: 0,
      treeCoverage: 0,
      rockCoverage: 0,
      wallCoverage: 0,
    });
    const isolatedEvacuation = { x: 10, z: 10 };
    const evacuationDisconnected: BattleSetup = {
      ...evacuationBase,
      groups: evacuationBase.groups.map((group, index) =>
        index === 0 ? { ...group, evacuation: isolatedEvacuation } : group,
      ),
    };
    for (let dz = -1; dz <= 1; dz += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        if (dx === 0 && dz === 0) {
          continue;
        }
        evacuationDisconnected.map.layers.waterDepthUnits[
          (isolatedEvacuation.z + dz) * evacuationDisconnected.map.width +
            isolatedEvacuation.x +
            dx
        ] = WATER_DEPTH_UNITS.deep;
      }
    }
    expect(() => validateBattleSetup(evacuationDisconnected)).toThrow(/evacuation cell/i);

    const disconnectedConflict = createBattleSetup({
      seed: "disconnected-conflict-route",
      width: 40,
      height: 24,
      groupsPerFaction: 1,
      mountainDensity: 0,
      roughness: 0,
      waterCoverage: 0,
      wetlandCoverage: 0,
      treeCoverage: 0,
      rockCoverage: 0,
      wallCoverage: 0,
    });
    for (let z = 0; z < disconnectedConflict.map.height; z += 1) {
      disconnectedConflict.map.layers.waterDepthUnits[
        z * disconnectedConflict.map.width + 20
      ] = WATER_DEPTH_UNITS.deep;
    }
    expect(() => validateBattleSetup(disconnectedConflict)).toThrow(/cross-map attack route/i);
  });

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

    const dynamicMap = createFlatMap(3, 3);
    const dynamicallyBlocked = new Set([1, dynamicMap.width]);
    expect(
      createPathfinder(dynamicMap).findPath(
        { x: 0, z: 0 },
        { x: 1, z: 1 },
        dynamicallyBlocked,
      ),
    ).toEqual([]);

    const detourMap = createFlatMap(5, 3);
    const occupiedCenter = 1 * detourMap.width + 2;
    const detour = createPathfinder(detourMap).findPath(
      { x: 0, z: 1 },
      { x: 4, z: 1 },
      new Set([occupiedCenter]),
    );
    expect(detour.length).toBeGreaterThan(0);
    expect(detour.some((coord) => cellIndex(detourMap, coord) === occupiedCenter)).toBe(
      false,
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

  it("uses authoritative static objects for movement, pathfinding, and sight", () => {
    for (const kind of ["tree", "rock", "wall"] as const) {
      const map = withStaticObjects(createFlatMap(5, 3), [
        {
          id: `${kind}-center`,
          kind,
          cell: { x: 2, z: 1 },
          facing: 0,
        },
      ]);
      expect(() => validateBattleMap(map)).not.toThrow();
      expect(isWalkable(map, { x: 2, z: 1 })).toBe(false);
      expect(hasLineOfSight(map, { x: 0, z: 1 }, { x: 4, z: 1 })).toBe(false);

      const path = createPathfinder(map).findPath({ x: 0, z: 1 }, { x: 4, z: 1 });
      expect(path.length).toBeGreaterThan(0);
      expect(path.some((coord) => coord.x === 2 && coord.z === 1)).toBe(false);
    }
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

    const missingObject = createFlatMap(3, 3);
    missingObject.layers.staticOccupancy[4] = STATIC_OBJECT_DEFINITIONS.tree.typeId;
    expect(() => validateBattleMap(missingObject)).toThrow(/static occupancy/i);

    const mismatchedObject = withStaticObjects(createFlatMap(3, 3), [
      {
        id: "mismatched-tree",
        kind: "tree",
        cell: { x: 1, z: 1 },
        facing: 0,
      },
    ]);
    mismatchedObject.layers.staticOccupancy[4] = STATIC_OBJECT_DEFINITIONS.rock.typeId;
    expect(() => validateBattleMap(mismatchedObject)).toThrow(/static object type/i);

    const floodedObject = withStaticObjects(createFlatMap(3, 3), [
      {
        id: "flooded-wall",
        kind: "wall",
        cell: { x: 1, z: 1 },
        facing: 2,
      },
    ]);
    floodedObject.layers.waterDepthUnits[4] = WATER_DEPTH_UNITS.shallow;
    expect(() => validateBattleMap(floodedObject)).toThrow(/static object.*water/i);

    const invalidFacing = withStaticObjects(createFlatMap(3, 3), [
      {
        id: "bad-facing-rock",
        kind: "rock",
        cell: { x: 1, z: 1 },
        facing: 0,
      },
    ]);
    (invalidFacing.staticObjects[0] as { facing: number }).facing = 8;
    expect(() => validateBattleMap(invalidFacing)).toThrow(/invalid facing/i);

    const duplicateIds = withStaticObjects(createFlatMap(3, 3), [
      {
        id: "duplicate-static-id",
        kind: "tree",
        cell: { x: 0, z: 0 },
        facing: 0,
      },
      {
        id: "duplicate-static-id",
        kind: "wall",
        cell: { x: 2, z: 2 },
        facing: 2,
      },
    ]);
    expect(() => validateBattleMap(duplicateIds)).toThrow(/static object ID/i);
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
    expect(() =>
      validateBattleSetup({
        ...firstSetup,
        rulesVersion: "stage-2.1",
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

    const staticObject = firstSetup.map.staticObjects[0];
    if (!staticObject) {
      throw new Error("Expected a generated static object.");
    }
    const originalFacing = staticObject.facing;
    const reorderedStaticObjects = createSimulation({
      ...firstSetup,
      map: {
        ...firstSetup.map,
        staticObjects: [...firstSetup.map.staticObjects].reverse(),
      },
    });
    expect(reorderedStaticObjects.getStateHash()).toBe(first.getStateHash());
    const changedFacing = staticObject.facing === 0 ? 1 : 0;
    const changedStaticObject = createSimulation({
      ...firstSetup,
      map: {
        ...firstSetup.map,
        staticObjects: firstSetup.map.staticObjects.map((object) =>
          object.id === staticObject.id ? { ...object, facing: changedFacing } : object,
        ),
      },
    });
    expect(first.getStateHash()).not.toBe(changedStaticObject.getStateHash());

    (staticObject as { facing: StaticMapObject["facing"] }).facing = changedFacing;
    expect(
      first.getSetup().map.staticObjects.find((object) => object.id === staticObject.id)
        ?.facing,
    ).toBe(originalFacing);
    const exposedStaticSetup = first.getSetup();
    const exposedStaticObject = exposedStaticSetup.map.staticObjects.find(
      (object) => object.id === staticObject.id,
    );
    if (!exposedStaticObject) {
      throw new Error("Expected a cloned static object.");
    }
    (exposedStaticObject as { facing: StaticMapObject["facing"] }).facing = changedFacing;
    expect(
      first.getSetup().map.staticObjects.find((object) => object.id === staticObject.id)
        ?.facing,
    ).toBe(originalFacing);
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
      staticOccupancy: new Uint8Array(size),
    },
    staticObjects: [],
  };
}

function withStaticObjects(
  map: BattleMap,
  staticObjects: readonly StaticMapObject[],
): BattleMap {
  const staticOccupancy = new Uint8Array(map.width * map.height);
  for (const object of staticObjects) {
    staticOccupancy[cellIndex(map, object.cell)] =
      STATIC_OBJECT_DEFINITIONS[object.kind].typeId;
  }
  return {
    ...map,
    layers: { ...map.layers, staticOccupancy },
    staticObjects: staticObjects.map((object) => ({
      ...object,
      cell: { ...object.cell },
    })),
  };
}

function countStaticObjectKinds(
  staticObjects: readonly StaticMapObject[],
): Readonly<Record<StaticMapObject["kind"], number>> {
  const counts = { tree: 0, rock: 0, wall: 0 };
  for (const object of staticObjects) {
    counts[object.kind] += 1;
  }
  return counts;
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

function summarizeTerrain(map: BattleMap): {
  readonly mountainCells: number;
  readonly waterCells: number;
  readonly openWaterCells: number;
  readonly shallowWaterCells: number;
  readonly deepWaterCells: number;
  readonly wetlandCells: number;
} {
  let mountainCells = 0;
  let waterCells = 0;
  let shallowWaterCells = 0;
  let deepWaterCells = 0;
  let wetlandCells = 0;
  for (let index = 0; index < map.width * map.height; index += 1) {
    const waterDepth = map.layers.waterDepthUnits[index];
    const surfaceType = map.layers.surfaceTypeIds[index];
    if (((map.layers.cellFlags[index] ?? 0) & MAP_CELL_FLAGS.groundBlocked) !== 0) {
      mountainCells += 1;
    }
    if (waterDepth !== WATER_DEPTH_UNITS.none) {
      waterCells += 1;
    }
    if (waterDepth === WATER_DEPTH_UNITS.shallow) {
      shallowWaterCells += 1;
      if (surfaceType === SURFACE_TYPE_IDS.mud) {
        wetlandCells += 1;
      }
    } else if (waterDepth === WATER_DEPTH_UNITS.deep) {
      deepWaterCells += 1;
    }
  }
  return {
    mountainCells,
    waterCells,
    openWaterCells: waterCells - wetlandCells,
    shallowWaterCells,
    deepWaterCells,
    wetlandCells,
  };
}
