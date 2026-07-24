import { describe, expect, it } from "vitest";
import {
  canTraverseStep,
  createBattleSetup,
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

describe("stage-one simulation", () => {
  it("generates deterministic height maps with a legal cross-map route", () => {
    const options = {
      seed: "map-determinism",
      width: 42,
      height: 30,
      mountainDensity: 0.48,
      roughness: 0.65,
    };
    const first = generateBattleMap(options);
    const second = generateBattleMap(options);

    expect([...first.heightUnits]).toEqual([...second.heightUnits]);
    expect([...first.walkable]).toEqual([...second.walkable]);
    expect(first.heightUnits.length).toBe(first.width * first.height);

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
    const setup = createBattleSetup({
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
  const base = createBattleSetup({
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
    width,
    height,
    cellSizeMm: 4_000,
    heightUnitMm: 500,
    heightUnits: new Int16Array(size),
    walkable: new Uint8Array(size).fill(1),
    movementCosts: new Uint8Array(size).fill(10),
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
