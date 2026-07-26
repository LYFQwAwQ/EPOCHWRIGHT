import { describe, expect, it } from "vitest";
import { createDemoBattleSetup } from "../demo";
import {
  canTraverseStep,
  BATTLE_MAP_SCHEMA_VERSION,
  SURFACE_TYPE_IDS,
  WATER_DEPTH_UNITS,
  createPathfinder,
  createSimulation,
  generateBattleMap,
  SIMULATION_HZ,
  type BattleEvent,
  type BattleMap,
  type BattleSetup,
  type FactionId,
  type GroupInspection,
  type GroupSpawn,
} from "./index";

describe("battle simulation", () => {
  it("generates deterministic height maps with a legal cross-map route", () => {
    const options = {
      seed: "map-determinism",
      width: 42,
      height: 30,
      mountainDensity: 0.18,
      roughness: 0.65,
    };
    const first = generateBattleMap(options);
    const second = generateBattleMap(options);

    expect([...first.layers.heightUnits]).toEqual([...second.layers.heightUnits]);
    expect([...first.layers.surfaceTypeIds]).toEqual([...second.layers.surfaceTypeIds]);
    expect([...first.layers.waterDepthUnits]).toEqual([...second.layers.waterDepthUnits]);
    expect([...first.layers.cellFlags]).toEqual([...second.layers.cellFlags]);
    expect(first.layers.heightUnits.length).toBe(first.width * first.height);

    const pathfinder = createPathfinder(first);
    const path = pathfinder.findPath(
      { x: 2, z: Math.floor(first.height / 2) },
      { x: first.width - 3, z: Math.floor(first.height / 2) },
    );
    expect(path.length).toBeGreaterThan(2);
    for (let index = 1; index < path.length; index += 1) {
      expect(canTraverseStep(first, path[index - 1]!, path[index]!)).toBe(true);
    }
  });

  it("keeps patrol goals on the group's reachable terrain component", () => {
    const groups = [
      createGroup("ember-patrol", "ember", 2, 3),
      createGroup("azure-patrol", "azure", 37, 3),
    ];
    const base = createFlatSetup(groups);
    const map = createFlatMap(40, 24);
    map.layers.waterDepthUnits.fill(WATER_DEPTH_UNITS.deep);
    for (let x = 0; x < map.width; x += 1) {
      map.layers.waterDepthUnits[3 * map.width + x] = WATER_DEPTH_UNITS.none;
    }
    for (const x of [15, 24]) {
      for (const z of [7, 12, 17]) {
        map.layers.waterDepthUnits[z * map.width + x] = WATER_DEPTH_UNITS.none;
      }
    }

    const simulation = createSimulation({ ...base, map });
    for (const group of groups) {
      const inspection = simulation.inspect(group.id);
      if (inspection?.kind !== "group") {
        throw new Error(`Expected group inspection for ${group.id}.`);
      }
      expect(inspection.path.length).toBeGreaterThan(1);
      expect(inspection.path.every((coord) => coord.z === 3)).toBe(true);
    }
  });

  it("finishes an atomic movement step while known-contact goals update", () => {
    const simulation = createSimulation(
      createDemoBattleSetup({
        seed: "audit-2",
        width: 40,
        height: 28,
        groupsPerFaction: 3,
        mode: "conflict",
      }),
    );
    simulation.step(330);
    const before = simulation.inspect("ember-squad-3") as GroupInspection;

    simulation.step(70);
    const after = simulation.inspect("ember-squad-3") as GroupInspection;
    expect(after.cell).not.toEqual(before.cell);
  });

  it("moves around a friendly fire-line blocker before engaging", () => {
    const setup = createFlatSetup(
      [
        createGroup("ember-front-4", "ember", 14, 12),
        createGroup("ember-rear-0", "ember", 13, 12),
        createGroup("azure-target", "azure", 15, 12),
      ],
      {
        sightRangeCells: 40,
        weaponRangeCells: 2,
        preferredRangeCells: 1,
        maximumDurationTicks: 1_000,
      },
    );
    const simulation = createSimulation(setup);
    const replay = createSimulation(setup);
    let movedOffLine = false;
    let rearFired = false;

    for (let tick = 0; tick < 100 && simulation.status === "active"; tick += 1) {
      simulation.step();
      replay.step();
      expect(replay.getStateHash()).toBe(simulation.getStateHash());
      const rear = simulation.inspect("ember-rear-0") as GroupInspection;
      movedOffLine ||= rear.cell.z !== 12;
      rearFired ||= simulation
        .drainEvents()
        .some(
          (event) => event.type === "weapon-fired" && event.groupId === "ember-rear-0",
        );
    }

    expect(movedOffLine).toBe(true);
    expect(rearFired).toBe(true);
  });

  it("keeps direct observation local until the 15-tick faction delay expires", () => {
    const setup = createFlatSetup([
      createGroup("ember-observer", "ember", 8, 6),
      createGroup("ember-receiver", "ember", 2, 21),
      createGroup("azure-target", "azure", 19, 6),
    ]);
    const simulation = createSimulation(setup);
    let spottedTick: number | undefined;

    for (let index = 0; index < 80 && spottedTick === undefined; index += 1) {
      simulation.step();
      const spotted = simulation
        .drainEvents()
        .find(
          (event) =>
            event.type === "contact-spotted" &&
            event.observerGroupId === "ember-observer" &&
            event.targetGroupId === "azure-target",
        );
      spottedTick = spotted?.tick;
    }

    expect(spottedTick).toBeTypeOf("number");
    const observer = simulation.inspect("ember-observer") as GroupInspection;
    expect(observer.contacts.some((contact) => contact.targetGroupId === "azure-target")).toBe(
      true,
    );
    const deliveryTick = spottedTick! + 15;
    while (simulation.tick < deliveryTick) {
      simulation.step();
      simulation.drainEvents();
    }
    const beforeDelivery = simulation.inspect("ember-receiver") as GroupInspection;
    expect(
      beforeDelivery.contacts.some((contact) => contact.targetGroupId === "azure-target"),
    ).toBe(false);

    simulation.step();
    const afterDelivery = simulation.inspect("ember-receiver") as GroupInspection;
    expect(
      afterDelivery.contacts.some((contact) => contact.targetGroupId === "azure-target"),
    ).toBe(true);
  });

  it("fires, reloads, and records member-level casualties", () => {
    const setup = createFlatSetup([
      createGroup("ember-line", "ember", 10, 12),
      createGroup("azure-line", "azure", 18, 12),
    ]);
    const simulation = createSimulation(setup);
    const events: BattleEvent[] = [];
    let observedReload = false;

    for (let tick = 0; tick < 700 && simulation.status === "active"; tick += 1) {
      simulation.step();
      events.push(...simulation.drainEvents());
      for (const group of setup.groups) {
        for (const member of group.members) {
          const inspection = simulation.inspect(member.id);
          if (inspection?.kind === "member" && inspection.reloadTicksRemaining > 0) {
            observedReload = true;
          }
        }
      }
    }

    expect(events.some((event) => event.type === "weapon-fired")).toBe(true);
    expect(observedReload).toBe(true);
    expect(events.some((event) => event.type === "member-health-changed")).toBe(true);
  });

  it("repeats an entire autonomous battle with the same final hash", () => {
    const setup = createDemoBattleSetup({
      seed: "repeatable-battle",
      width: 40,
      height: 28,
      groupsPerFaction: 2,
      maximumDurationSeconds: 150,
      stalemateSeconds: 65,
    });
    const first = createSimulation(setup);
    const second = createSimulation(setup);

    first.step(4_000);
    second.step(4_000);
    const firstEvents = first.drainEvents();
    const secondEvents = second.drainEvents();

    expect(first.status).toBe("finished");
    expect(second.status).toBe("finished");
    expect(first.getStateHash()).toBe(second.getStateHash());
    expect(first.getResult()).toEqual(second.getResult());
    expect(firstEvents).toEqual(secondEvents);
    expect(firstEvents.some((event) => event.type === "contact-spotted")).toBe(true);
    expect(firstEvents.some((event) => event.type === "weapon-fired")).toBe(true);
    expect(first.getResult()?.members).toHaveLength(32);
    expect(
      first
        .getResult()
        ?.members.every(
          (member) =>
            ["healthy", "wounded", "incapacitated", "dead"].includes(member.health) &&
            ["deployed", "evacuated"].includes(member.presence),
        ),
    ).toBe(true);
  });

  it("uses a fixed 20 Hz clock and never advances after finishing", () => {
    const setup = createFlatSetup(
      [
        createGroup("ember-clock", "ember", 10, 12),
        createGroup("azure-clock", "azure", 18, 12),
      ],
      { maximumDurationTicks: 5, stalemateTicks: 100 },
    );
    const simulation = createSimulation(setup);
    expect(setup.rules.ticksPerSecond).toBe(SIMULATION_HZ);

    simulation.step(100);
    expect(simulation.tick).toBe(5);
    expect(simulation.getResult()?.terminationReason).toBe("maximum-duration");
    const hash = simulation.getStateHash();
    expect(simulation.getResult()?.stateHash).toBe(hash);
    simulation.step(50);
    expect(simulation.tick).toBe(5);
    expect(simulation.getStateHash()).toBe(hash);
  });
});

function createFlatSetup(
  groups: readonly GroupSpawn[],
  ruleOverrides: Partial<BattleSetup["rules"]> = {},
): BattleSetup {
  const base = createDemoBattleSetup({
    seed: "flat-test",
    width: 40,
    height: 24,
    groupsPerFaction: 1,
    maximumDurationSeconds: 120,
    stalemateSeconds: 90,
  });
  const map = createFlatMap(40, 24);
  return {
    ...base,
    battleId: `test-${groups.map((group) => group.id).join("-")}`,
    map,
    groups,
    rules: { ...base.rules, ...ruleOverrides },
  };
}

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
