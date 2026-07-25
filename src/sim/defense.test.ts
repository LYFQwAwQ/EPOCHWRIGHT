import { describe, expect, it } from "vitest";
import {
  BATTLE_MAP_SCHEMA_VERSION,
  SURFACE_TYPE_IDS,
  WATER_DEPTH_UNITS,
  createBattleSetup,
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
    const conflict = createBattleSetup({ seed: "conflict-regression", groupsPerFaction: 1 });
    expect(conflict.mode.kind).toBe("conflict");
    expect(createSimulation(conflict).getRenderFrame().objectives).toEqual([]);

    const defense = createBattleSetup({
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
    const setup = createBattleSetup({
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
      createBattleSetup({
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
    const setup = createBattleSetup({
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
});

function createDefenseSetup(
  map: BattleMap,
  center: GridCoord,
  groups: readonly GroupSpawn[],
  ruleOverrides: Partial<BattleSetup["rules"]> = {},
): BattleSetup {
  const base = createBattleSetup({
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
    },
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
