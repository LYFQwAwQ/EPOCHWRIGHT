import { describe, expect, it } from "vitest";
import { createDemoBattleSetup } from "../demo";
import {
  BATTLE_MAP_SCHEMA_VERSION,
  SURFACE_TYPE_IDS,
  WATER_DEPTH_UNITS,
  createPathfinder,
  createSimulation,
  isWalkable,
  resolveObjectiveTick,
  squaredGridDistance,
  type BattleMap,
  type BattleSetup,
  type FactionId,
  type GridCoord,
  type GroupInspection,
  type GroupSpawn,
  type HealthState,
  type ObjectiveInspection,
} from "./index";

describe("defense mode", () => {
  it("generates a legal reachable objective while conflict remains the default", () => {
    const conflict = createDemoBattleSetup({ seed: "conflict-regression", groupsPerFaction: 1 });
    expect(conflict.mode.kind).toBe("conflict");
    expect(createSimulation(conflict).getRenderFrame().objectives).toEqual([]);

    const defense = createDemoBattleSetup({
      seed: "defense-objective",
      mode: "defense",
      groupsPerFaction: 2,
    });
    expect(defense.mode.kind).toBe("defense");
    if (defense.mode.kind !== "defense") {
      throw new Error("Expected a defense setup.");
    }
    const objective = defense.mode.objective;
    expect(isWalkable(defense.map, objective.center)).toBe(true);
    const pathfinder = createPathfinder(defense.map);
    for (const group of defense.groups.filter((group) => group.factionId === "ember")) {
      expect(pathfinder.findPath(group.spawn, objective.center).length).toBeGreaterThan(0);
    }

    const simulation = createSimulation(defense);
    const rendered = simulation.getRenderFrame().objectives[0];
    expect(rendered).toMatchObject({
      id: objective.id,
      state: "defender-controlled",
      progressBps: 0,
      attackerFactionId: "ember",
      defenderFactionId: "azure",
    });
    expect(rendered?.radiusMeters).toBe(objective.radiusCells * 4);
    const inspected = simulation.inspect(objective.id) as ObjectiveInspection;
    expect(inspected.kind).toBe("objective");
    expect(inspected.center).toEqual(objective.center);
  });

  it("chooses elevated low-cost, distinct defense slots and stays near the objective", () => {
    const map = createFlatMap(40, 24, SURFACE_TYPE_IDS.mud);
    const preferredSlot = { x: 20, z: 11 };
    const preferredIndex = preferredSlot.z * map.width + preferredSlot.x;
    map.layers.heightUnits[preferredIndex] = 20;
    map.layers.surfaceTypeIds[preferredIndex] = SURFACE_TYPE_IDS.grass;
    const setup = createDefenseSetup(
      map,
      { x: 20, z: 12 },
      [
        createGroup("ember-assault", "ember", 8, 12),
        createGroup("azure-alpha", "azure", 32, 8),
        createGroup("azure-bravo", "azure", 32, 16),
      ],
    );
    const simulation = createSimulation(setup);
    const alpha = simulation.inspect("azure-alpha") as GroupInspection;
    const bravo = simulation.inspect("azure-bravo") as GroupInspection;

    expect(alpha.defenseSlot).toEqual(preferredSlot);
    expect(bravo.defenseSlot).toBeDefined();
    expect(bravo.defenseSlot).not.toEqual(alpha.defenseSlot);
    expect(squaredGridDistance(alpha.defenseSlot!, bravo.defenseSlot!)).toBeGreaterThan(1);

    for (let tick = 0; tick < 500 && simulation.status === "active"; tick += 1) {
      simulation.step();
      const frame = simulation.getRenderFrame();
      for (const defender of frame.groups.filter((group) => group.factionId === "azure")) {
        const cell = simulation.inspect(defender.id) as GroupInspection;
        // The groups start outside the perimeter, but once they enter they never chase back out.
        if (squaredGridDistance(cell.cell, { x: 20, z: 12 }) <= 7 ** 2) {
          expect(
            squaredGridDistance(cell.path.at(-1) ?? cell.cell, { x: 20, z: 12 }),
          ).toBeLessThanOrEqual(7 ** 2);
        }
      }
    }
  });

  it("reroutes a rear assault group around a friendly group holding the route", () => {
    const setup = createDefenseSetup(
      createFlatMap(40, 24),
      { x: 20, z: 12 },
      [
        createGroup("ember-front", "ember", 18, 12),
        createGroup("ember-rear", "ember", 17, 12),
        createGroup("azure-defender", "azure", 20, 12),
      ],
      { sightRangeCells: 40, maximumDurationTicks: 1_000 },
    );
    const simulation = createSimulation(setup);
    const replay = createSimulation(setup);
    let receivedDetour = false;
    let movedOffLine = false;
    let rearFired = false;

    for (let tick = 0; tick < 100 && simulation.status === "active"; tick += 1) {
      simulation.step();
      replay.step();
      expect(replay.getStateHash()).toBe(simulation.getStateHash());
      const rear = simulation.inspect("ember-rear") as GroupInspection;
      if (rear.destination && (rear.destination.x !== 18 || rear.destination.z !== 12)) {
        receivedDetour = true;
      }
      movedOffLine ||= rear.cell.z !== 12;
      rearFired ||= simulation
        .drainEvents()
        .some((event) => event.type === "weapon-fired" && event.groupId === "ember-rear");
    }

    expect(receivedDetour).toBe(true);
    expect(movedOffLine).toBe(true);
    expect(rearFired).toBe(true);
  });

  it("finishes a fire-line side step after the friendly blocker disappears", () => {
    const map = createFlatMap(40, 24);
    const slowStepIndex = 13 * map.width + 20;
    map.layers.surfaceTypeIds[slowStepIndex] = SURFACE_TYPE_IDS.mud;
    map.layers.waterDepthUnits[slowStepIndex] = WATER_DEPTH_UNITS.shallow;
    const setup = createDefenseSetup(
      map,
      { x: 20, z: 12 },
      [
        createGroup("ember-target", "ember", 10, 12),
        createGroup("azure-blocker", "azure", 19, 12),
        createGroup("azure-shooter", "azure", 20, 12),
      ],
      { sightRangeCells: 40, maximumDurationTicks: 1_000 },
    );
    const simulation = createSimulation(setup);

    simulation.step(10);
    const before = simulation.inspect("azure-shooter") as GroupInspection;
    expect(before).toMatchObject({
      cell: { x: 20, z: 12 },
      destination: { x: 20, z: 13 },
      action: "moving-to-contact",
      decisionReason: "clear-line-of-fire",
    });

    setGroupHealthForTest(simulation, "azure-blocker", "incapacitated");
    simulation.step(5);
    const after = simulation.inspect("azure-shooter") as GroupInspection;
    expect(after.destination).toEqual(before.destination);

    for (
      let tick = 0;
      tick < 60 && (simulation.inspect("azure-shooter") as GroupInspection).destination;
      tick += 1
    ) {
      simulation.step();
    }
    expect((simulation.inspect("azure-shooter") as GroupInspection).cell).toEqual(
      before.destination,
    );
  });

  it("backs off failed congestion repaths and resumes when the route clears", () => {
    const map = createFlatMap(40, 24);
    map.layers.waterDepthUnits.fill(WATER_DEPTH_UNITS.deep);
    for (let x = 0; x < map.width; x += 1) {
      map.layers.waterDepthUnits[12 * map.width + x] = WATER_DEPTH_UNITS.none;
    }
    const setup = createDefenseSetup(
      map,
      { x: 20, z: 12 },
      [
        createGroup("ember-front", "ember", 18, 12),
        createGroup("ember-rear", "ember", 17, 12),
        createGroup("azure-defender", "azure", 20, 12),
      ],
      {
        sightRangeCells: 0,
        weaponRangeCells: 0,
        preferredRangeCells: 0,
        maximumDurationTicks: 1_000,
      },
    );
    const simulation = createSimulation(setup);
    const pathfinder = (
      simulation as unknown as {
        pathfinder: {
          findPath(
            start: GridCoord,
            goal: GridCoord,
            blockedCellIndices?: ReadonlySet<number>,
          ): readonly GridCoord[];
        };
      }
    ).pathfinder;
    const findPath = pathfinder.findPath.bind(pathfinder);
    let dynamicPathQueries = 0;
    pathfinder.findPath = (start, goal, blockedCellIndices) => {
      if (blockedCellIndices) {
        dynamicPathQueries += 1;
      }
      return findPath(start, goal, blockedCellIndices);
    };

    simulation.step(20);
    expect(dynamicPathQueries).toBe(1);
    expect((simulation.inspect("ember-rear") as GroupInspection).cell).toEqual({
      x: 17,
      z: 12,
    });

    setGroupHealthForTest(simulation, "ember-front", "incapacitated");
    simulation.step(30);
    expect((simulation.inspect("ember-rear") as GroupInspection).cell.x).toBeGreaterThan(17);
  });

  it("resolves capture, contest, and recovery from effective member power", () => {
    expect(
      resolveObjectiveTick({ progressBps: 1_000, attackerPower: 8, defenderPower: 0 }),
    ).toEqual({ progressBps: 1_048, state: "capturing" });
    expect(
      resolveObjectiveTick({ progressBps: 1_048, attackerPower: 8, defenderPower: 8 }),
    ).toEqual({ progressBps: 1_048, state: "contested" });
    expect(
      resolveObjectiveTick({ progressBps: 1_048, attackerPower: 0, defenderPower: 8 }),
    ).toEqual({ progressBps: 1_016, state: "recovering" });
    expect(
      resolveObjectiveTick({ progressBps: 9_980, attackerPower: 8, defenderPower: 0 }),
    ).toEqual({ progressBps: 10_000, state: "attacker-controlled" });
  });

  it("holds progress while both sides contest the objective", () => {
    const setup = createDefenseSetup(
      createFlatMap(40, 24),
      { x: 20, z: 12 },
      [
        createGroup("ember-contest", "ember", 19, 12),
        createGroup("azure-contest", "azure", 21, 12),
      ],
    );
    const simulation = createSimulation(setup);
    simulation.step(5);

    const objective = simulation.getRenderFrame().objectives[0];
    expect(objective).toMatchObject({
      state: "contested",
      progressBps: 0,
      attackerPower: 8,
      defenderPower: 8,
    });
    expect(
      simulation
        .drainEvents()
        .some(
          (event) =>
            event.type === "objective-state-changed" && event.to === "contested",
        ),
    ).toBe(true);
  });

  it("awards an empty objective to attackers only after occupation completes", () => {
    const setup = createDefenseSetup(
      createFlatMap(40, 24),
      { x: 10, z: 12 },
      [
        createGroup("ember-capture", "ember", 10, 12),
        createGroup("azure-distant", "azure", 38, 12),
      ],
      { maximumDurationTicks: 1_000 },
    );
    const simulation = createSimulation(setup);
    simulation.step(1_000);

    expect(simulation.getResult()).toMatchObject({
      outcome: "win",
      terminationReason: "objective-captured",
      winnerFactionIds: ["ember"],
      objectives: [{ state: "attacker-controlled", progressBps: 10_000 }],
    });
    expect(simulation.getRenderFrame().objectives[0]?.progressBps).toBe(10_000);
  });

  it("awards defenders on timeout or after attackers lose all effective members", () => {
    const timeoutSetup = createDefenseSetup(
      createFlatMap(40, 24),
      { x: 20, z: 12 },
      [
        createGroup("ember-timeout", "ember", 2, 3),
        createGroup("azure-timeout", "azure", 20, 12),
      ],
      { maximumDurationTicks: 5 },
    );
    const timeoutSimulation = createSimulation(timeoutSetup);
    timeoutSimulation.step(100);
    expect(timeoutSimulation.getResult()).toMatchObject({
      terminationReason: "defense-time-expired",
      winnerFactionIds: ["azure"],
    });

    const defeatedSetup = createDefenseSetup(
      createFlatMap(40, 24),
      { x: 20, z: 12 },
      [
        createGroup("ember-defeated", "ember", 8, 12, "incapacitated"),
        createGroup("azure-holding", "azure", 20, 12),
      ],
      { maximumDurationTicks: 500, resolutionStableTicks: 10 },
    );
    const defeatedSimulation = createSimulation(defeatedSetup);
    defeatedSimulation.step(100);
    expect(defeatedSimulation.getResult()).toMatchObject({
      terminationReason: "attackers-eliminated",
      winnerFactionIds: ["azure"],
    });
  });

  it("keeps defense mode deterministic and conflict results backward compatible", () => {
    const setup = createDemoBattleSetup({
      seed: "defense-determinism",
      mode: "defense",
      groupsPerFaction: 2,
      maximumDurationSeconds: 80,
    });
    const first = createSimulation(setup);
    const second = createSimulation(setup);
    first.step(2_000);
    second.step(2_000);
    expect(first.getStateHash()).toBe(second.getStateHash());
    expect(first.getResult()).toEqual(second.getResult());

    const conflict = createSimulation(
      createDemoBattleSetup({
        seed: "repeatable-battle",
        width: 40,
        height: 28,
        groupsPerFaction: 2,
        maximumDurationSeconds: 150,
        stalemateSeconds: 65,
        mode: "conflict",
      }),
    );
    conflict.step(4_000);
    expect(conflict.getResult()).toBeDefined();
    expect(conflict.getResult()?.objectives).toEqual([]);
    expect(conflict.getRenderFrame().objectives).toEqual([]);
  });

  it("keeps default attackers advancing through the fire line into the objective", () => {
    const setup = createDemoBattleSetup({
      seed: "defense-bravo",
      mode: "defense",
    });
    if (setup.mode.kind !== "defense") {
      throw new Error("Expected defense mode.");
    }
    const simulation = createSimulation(setup);
    const objectiveId = setup.mode.objective.id;
    let objectiveActivated = false;
    let firedWhileAdvancing = false;

    while (simulation.status === "active") {
      simulation.step();
      const objective = simulation.inspect(objectiveId) as ObjectiveInspection;
      objectiveActivated ||=
        objective.progressBps > 0 || objective.state === "contested";
      const advancingGroups = new Set(
        setup.groups
          .filter((group) => group.factionId === "ember")
          .map((group) => simulation.inspect(group.id) as GroupInspection)
          .filter((group) => group.action === "moving-to-contact")
          .map((group) => group.id),
      );
      for (const event of simulation.drainEvents()) {
        if (
          event.type === "weapon-fired" &&
          advancingGroups.has(event.groupId)
        ) {
          firedWhileAdvancing = true;
        }
      }
    }

    expect(objectiveActivated).toBe(true);
    expect(firedWhileAdvancing).toBe(true);
    expect(simulation.getResult()).toMatchObject({
      terminationReason: "objective-captured",
      winnerFactionIds: ["ember"],
    });
    expect(simulation.getResult()?.terminationReason).not.toBe("stalemate");
    expect(simulation.getResult()?.terminationReason).not.toBe("defense-time-expired");
  });

  it("supports objective combinations, sequence unlocks, and a deterministic reserve line", () => {
    const map = createFlatMap(50, 24);
    const first = { id: "objective-alpha", center: { x: 15, z: 12 }, radiusCells: 2 };
    const second = { id: "objective-bravo", center: { x: 30, z: 12 }, radiusCells: 2 };
    const setup = createDefenseSetup(
      map,
      first.center,
      [
        createGroup("ember-alpha", "ember", 15, 12),
        createGroup("ember-bravo", "ember", 30, 12),
        createGroup("azure-front", "azure", 45, 8, "incapacitated"),
        createGroup("azure-reserve", "azure", 45, 16, "incapacitated"),
      ],
      { maximumDurationTicks: 2_000 },
    );
    const multiSetup: BattleSetup = {
      ...setup,
      mode: {
        kind: "defense",
        attackerFactionId: "ember",
        defenderFactionId: "azure",
        objective: first,
        objectives: [first, second],
        objectiveRule: "all",
        reserveRatioBps: 5_000,
      },
    };
    const simulation = createSimulation(multiSetup);
    expect(simulation.getRenderFrame().objectives).toHaveLength(2);
    expect((simulation.inspect("azure-reserve") as GroupInspection).defenseRole).toBe("reserve");
    expect((simulation.inspect("azure-front") as GroupInspection).defenseRole).toBe("frontline");

    simulation.step(400);
    expect(simulation.getResult()).toMatchObject({
      terminationReason: "objective-captured",
      winnerFactionIds: ["ember"],
      objectives: [
        { id: "objective-alpha", state: "attacker-controlled" },
        { id: "objective-bravo", state: "attacker-controlled" },
      ],
    });

    if (multiSetup.mode.kind !== "defense") {
      throw new Error("Expected a defense setup.");
    }

    const countSetup: BattleSetup = {
      ...multiSetup,
      battleId: "multi-objective-count",
      mode: { ...multiSetup.mode, objectiveRule: "count", requiredCount: 1 },
    };
    const countSimulation = createSimulation(countSetup);
    countSimulation.step(250);
    expect(countSimulation.getResult()?.terminationReason).toBe("objective-captured");
    expect(countSimulation.getResult()?.objectives).toHaveLength(2);

    const sequenceSetup: BattleSetup = {
      ...multiSetup,
      battleId: "multi-objective-sequence",
      mode: { ...multiSetup.mode, objectiveRule: "sequence" },
    };
    const sequenceSimulation = createSimulation(sequenceSetup);
    expect((sequenceSimulation.inspect("objective-bravo") as ObjectiveInspection).unlocked).toBe(false);
    sequenceSimulation.step(220);
    expect((sequenceSimulation.inspect("objective-alpha") as ObjectiveInspection).state).toBe(
      "attacker-controlled",
    );
    expect((sequenceSimulation.inspect("objective-bravo") as ObjectiveInspection).unlocked).toBe(
      true,
    );
  });
});

function createDefenseSetup(
  map: BattleMap,
  center: GridCoord,
  groups: readonly GroupSpawn[],
  ruleOverrides: Partial<BattleSetup["rules"]> = {},
): BattleSetup {
  const base = createDemoBattleSetup({
    seed: "defense-flat",
    width: map.width,
    height: map.height,
    groupsPerFaction: 1,
    mode: "defense",
    maximumDurationSeconds: 120,
  });
  return {
    ...base,
    battleId: `defense-${groups.map((group) => group.id).join("-")}`,
    map,
    groups,
    mode: {
      kind: "defense",
      attackerFactionId: "ember",
      defenderFactionId: "azure",
      objective: { id: "test-objective", center, radiusCells: 2 },
    },
    rules: { ...base.rules, ...ruleOverrides },
  };
}

function createFlatMap(
  width: number,
  height: number,
  surfaceTypeId: number = SURFACE_TYPE_IDS.grass,
): BattleMap {
  const size = width * height;
  return {
    schemaVersion: BATTLE_MAP_SCHEMA_VERSION,
    width,
    height,
    cellSizeMm: 4_000,
    heightUnitMm: 500,
    layers: {
      heightUnits: new Int16Array(size),
      surfaceTypeIds: new Uint16Array(size).fill(surfaceTypeId),
      waterDepthUnits: new Uint8Array(size).fill(WATER_DEPTH_UNITS.none),
      cellFlags: new Uint16Array(size),
      staticOccupancy: new Uint8Array(size),
    },
    staticObjects: [],
  };
}

function createGroup(
  id: string,
  factionId: FactionId,
  x: number,
  z: number,
  initialHealth: HealthState = "healthy",
): GroupSpawn {
  return {
    id,
    factionId,
    spawn: { x, z },
    evacuation: { x, z },
    members: Array.from({ length: 8 }, (_, index) => ({
      id: `${id}-member-${index + 1}`,
      initialHealth,
    })),
  };
}

function setGroupHealthForTest(
  simulation: ReturnType<typeof createSimulation>,
  groupId: string,
  health: HealthState,
): void {
  const runtime = simulation as unknown as {
    state: {
      groupsById: Map<string, { members: { health: HealthState }[] }>;
    };
  };
  const group = runtime.state.groupsById.get(groupId);
  if (!group) {
    throw new Error(`Expected runtime group ${groupId}.`);
  }
  for (const member of group.members) {
    member.health = health;
  }
}
