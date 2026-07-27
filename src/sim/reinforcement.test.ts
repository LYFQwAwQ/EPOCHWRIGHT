import { createDemoBattleSetup } from "../demo";
import {
  BATTLE_MAP_SCHEMA_VERSION,
  DEFAULT_GROUP_TEMPLATE_ID,
  DEFAULT_MEMBER_TEMPLATE_ID,
  SURFACE_TYPE_IDS,
  WATER_DEPTH_UNITS,
  createSimulation,
  type BattleMap,
  type BattleSetup,
  type GroupSpawn,
  type HealthState,
} from "./index";
import { describe, expect, it } from "vitest";

describe("reinforcement entrances", () => {
  it("triggers a wave at its arrival tick and records deployed members", () => {
    const setup = createReinforcementSetup({
      entrances: [{ id: "ember-gate", factionId: "ember", cells: [{ x: 0, z: 6 }], capacityPerTick: 1 }],
      waves: [{
        id: "ember-wave-1",
        factionId: "ember",
        arrivalTick: 3,
        entranceIds: ["ember-gate"],
        blockedPolicy: "wait",
        groups: [createGroup("ember-reinforcement", "ember", 1, 6)],
      }],
    });
    const simulation = createSimulation(setup);

    simulation.step(3);
    expect(simulation.getRenderFrame().groups.some((group) => group.id === "ember-reinforcement")).toBe(false);
    simulation.step();
    expect(simulation.getRenderFrame().groups.some((group) => group.id === "ember-reinforcement")).toBe(true);
    expect(simulation.drainEvents()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "reinforcement-triggered", waveId: "ember-wave-1" }),
        expect.objectContaining({
          type: "reinforcement-deployed",
          waveId: "ember-wave-1",
          groupIds: ["ember-reinforcement"],
          entranceId: "ember-gate",
        }),
      ]),
    );
  });

  it("uses a deterministic waiting queue when entrance capacity is smaller than the batch", () => {
    const setup = createReinforcementSetup({
      entrances: [{
        id: "ember-gate",
        factionId: "ember",
        cells: [{ x: 0, z: 5 }, { x: 0, z: 6 }],
        capacityPerTick: 1,
      }],
      waves: [{
        id: "ember-wave-queue",
        factionId: "ember",
        arrivalTick: 0,
        entranceIds: ["ember-gate"],
        blockedPolicy: "wait",
        groups: [
          createGroup("ember-queue-a", "ember", 1, 5),
          createGroup("ember-queue-b", "ember", 1, 6),
        ],
      }],
    });
    const simulation = createSimulation(setup);
    simulation.step();
    expect(simulation.getRenderFrame().groups.map((group) => group.id)).toContain("ember-queue-a");
    expect(simulation.getRenderFrame().groups.map((group) => group.id)).not.toContain("ember-queue-b");
    simulation.step();
    expect(simulation.getRenderFrame().groups.map((group) => group.id)).toEqual(
      expect.arrayContaining(["ember-queue-a", "ember-queue-b"]),
    );
  });

  it("tries an alternate entrance and distinguishes cancellation from deployment", () => {
    const setup = createReinforcementSetup({
      entrances: [
        { id: "ember-blocked", factionId: "ember", cells: [{ x: 0, z: 6 }], capacityPerTick: 1 },
        { id: "ember-open", factionId: "ember", cells: [{ x: 0, z: 7 }], capacityPerTick: 1 },
      ],
      waves: [{
        id: "ember-wave-alternate",
        factionId: "ember",
        arrivalTick: 0,
        entranceIds: ["ember-blocked", "ember-open"],
        blockedPolicy: "try-alternate",
        groups: [createGroup("ember-alternate", "ember", 1, 7)],
      }],
      initialGroups: [
        createGroup("ember-initial", "ember", 4, 6),
        createGroup("azure-blocker", "azure", 0, 6),
      ],
    });
    const simulation = createSimulation(setup);
    simulation.step();
    expect(simulation.getRenderFrame().groups.map((group) => group.id)).toContain("ember-alternate");
    expect(
      simulation.drainEvents().some(
        (event) => event.type === "reinforcement-deployed" && event.entranceId === "ember-open",
      ),
    ).toBe(true);

    const cancelledSetup = createReinforcementSetup({
      entrances: [{ id: "ember-blocked", factionId: "ember", cells: [{ x: 0, z: 6 }], capacityPerTick: 1 }],
      waves: [{
        id: "ember-wave-cancel",
        factionId: "ember",
        arrivalTick: 0,
        entranceIds: ["ember-blocked"],
        blockedPolicy: "cancel",
        groups: [createGroup("ember-cancelled", "ember", 1, 6)],
      }],
      initialGroups: [
        createGroup("ember-initial", "ember", 4, 6),
        createGroup("azure-blocker", "azure", 0, 6),
      ],
      maximumDurationTicks: 1,
    });
    const cancelledSimulation = createSimulation(cancelledSetup);
    cancelledSimulation.step();
    const result = cancelledSimulation.getResult();
    expect(result?.groups).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "ember-cancelled", deployment: "undeployed" }),
      ]),
    );
    expect(result?.members).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ groupId: "ember-cancelled", disposition: "undeployed", deployment: "undeployed" }),
      ]),
    );
  });
});

interface ReinforcementScenarioOptions {
  readonly entrances: BattleSetup["reinforcementEntrances"];
  readonly waves: BattleSetup["reinforcements"];
  readonly initialGroups?: readonly GroupSpawn[];
  readonly maximumDurationTicks?: number;
}

function createReinforcementSetup(options: ReinforcementScenarioOptions): BattleSetup {
  const base = createDemoBattleSetup({
    seed: "reinforcement-test",
    width: 24,
    height: 20,
    groupsPerFaction: 1,
    maximumDurationSeconds: 120,
    stalemateSeconds: 120,
  });
  const groups = options.initialGroups ?? [
    createGroup("ember-initial", "ember", 4, 6),
    createGroup("azure-initial", "azure", 15, 6),
  ];
  return {
    ...base,
    battleId: `reinforcement-${options.waves[0]?.id ?? "empty"}`,
    map: createFlatMap(24, 20),
    groups,
    reinforcementEntrances: options.entrances,
    reinforcements: options.waves,
    rules: {
      ...base.rules,
      sightRangeCells: 0,
      weaponRangeCells: 0,
      preferredRangeCells: 0,
      maximumDurationTicks: options.maximumDurationTicks ?? 2_000,
      stalemateTicks: 2_000,
    },
  };
}

function createGroup(
  id: string,
  factionId: string,
  x: number,
  z: number,
  initialHealth: HealthState = "healthy",
): GroupSpawn {
  return {
    id,
    factionId,
    groupTemplateId: DEFAULT_GROUP_TEMPLATE_ID,
    spawn: { x, z },
    evacuation: { x, z },
    members: Array.from({ length: 8 }, (_, index) => ({
      id: `${id}-member-${index + 1}`,
      memberTemplateId: DEFAULT_MEMBER_TEMPLATE_ID,
      initialHealth,
    })),
    platforms: [],
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
