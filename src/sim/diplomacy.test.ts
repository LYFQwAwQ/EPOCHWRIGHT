import { describe, expect, it } from "vitest";
import { createDemoBattleSetup } from "../demo";
import {
  BATTLE_MAP_SCHEMA_VERSION,
  BATTLE_RULES_VERSION,
  BATTLE_SETUP_SCHEMA_VERSION,
  DEFAULT_GROUP_TEMPLATE_ID,
  DEFAULT_MEMBER_TEMPLATE_ID,
  LEGACY_BATTLE_RULES_VERSION,
  LEGACY_BATTLE_SETUP_SCHEMA_VERSION,
  SURFACE_TYPE_IDS,
  WATER_DEPTH_UNITS,
  createSimulation,
  defaultRelation,
  migrateBattleSetup,
  validateBattleSetup,
  type BattleMap,
  type BattleSetup,
  type FactionSetup,
  type FactionId,
  type GroupSpawn,
  type GroupInspection,
  type HealthState,
  type RelationSetup,
} from "./index";

describe("multi-faction diplomacy", () => {
  it("generates more than two factions with deterministic hostile defaults", () => {
    const factions: readonly FactionSetup[] = [
      { id: "ember", displayName: "赤焰", color: "#e45f62" },
      { id: "azure", displayName: "苍蓝", color: "#3e8fd1" },
      { id: "olive", displayName: "橄榄", color: "#7c9a52" },
    ];
    const setup = createDemoBattleSetup({
      seed: "generated-three-factions",
      width: 40,
      height: 24,
      factions,
      groupsPerFaction: 1,
      mountainDensity: 0,
      roughness: 0,
      waterCoverage: 0,
      wetlandCoverage: 0,
      treeCoverage: 0,
      rockCoverage: 0,
      wallCoverage: 0,
    });

    expect(setup.factions.map((faction) => faction.id)).toEqual([
      "ember",
      "azure",
      "olive",
    ]);
    expect(setup.relations.every((relation) => relation.kind === "hostile")).toBe(true);
    expect(setup.groups).toHaveLength(3);
    expect(() => createSimulation(setup)).not.toThrow();
  });

  it("validates a complete relation matrix and rejects missing or duplicate pairs", () => {
    const setup = createThreeFactionSetup();
    expect(setup.factions).toHaveLength(3);
    expect(setup.relations).toHaveLength(3);
    expect(() => validateBattleSetup(setup)).not.toThrow();

    expect(() =>
      validateBattleSetup({
        ...setup,
        relations: setup.relations.slice(0, 2),
      }),
    ).toThrow(/exactly one entry/i);

    expect(() =>
      validateBattleSetup({
        ...setup,
        relations: [
          setup.relations[0]!,
          setup.relations[1]!,
          { ...setup.relations[1]!, a: "olive", b: "ember" },
        ],
      }),
    ).toThrow(/duplicate/i);
  });

  it("migrates the original two-faction setup to hostile relations", () => {
    const current = createDemoBattleSetup({ seed: "diplomacy-migration", groupsPerFaction: 1 });
    const { relations: _relations, ...withoutRelations } = current;
    const legacy = {
      ...withoutRelations,
      schemaVersion: LEGACY_BATTLE_SETUP_SCHEMA_VERSION,
      rulesVersion: LEGACY_BATTLE_RULES_VERSION,
    } as unknown as BattleSetup;

    const migrated = migrateBattleSetup(legacy);
    expect(migrated.schemaVersion).toBe(BATTLE_SETUP_SCHEMA_VERSION);
    expect(migrated.rulesVersion).toBe(BATTLE_RULES_VERSION);
    expect(migrated.relations).toEqual([defaultRelation("ember", "azure")]);
    expect(() => validateBattleSetup(legacy)).not.toThrow();
    expect(createSimulation(legacy).getSetup().relations).toEqual(migrated.relations);
  });

  it("keeps neutral and allied factions out of target selection and damage", () => {
    const setup = createThreeFactionSetup([
      createGroup("ember-shooter", "ember", 8, 12),
      createGroup("azure-target", "azure", 16, 12),
      createGroup("olive-neutral", "olive", 12, 16),
    ], {
      sightRangeCells: 40,
      weaponRangeCells: 12,
      preferredRangeCells: 6,
      maximumDurationTicks: 100,
      stalemateTicks: 100,
    });
    const simulation = createSimulation(setup);
    const runtime = simulation as unknown as {
      state: {
        groupsById: Map<string, {
          action: string;
          currentTargetId?: string;
          localContacts: Map<string, unknown>;
        }>;
      };
    };
    const shooter = runtime.state.groupsById.get("ember-shooter")!;
    shooter.action = "engaging";
    shooter.currentTargetId = "azure-target";
    shooter.localContacts.set("azure-target", {
      targetGroupId: "azure-target",
      lastKnown: { x: 16, z: 12 },
      observedAt: 0,
      lastDirectTick: 0,
      confidenceBps: 10_000,
      sourceGroupId: "ember-shooter",
    });
    shooter.localContacts.set("olive-neutral", {
      targetGroupId: "olive-neutral",
      lastKnown: { x: 12, z: 16 },
      observedAt: 0,
      lastDirectTick: 0,
      confidenceBps: 10_000,
      sourceGroupId: "ember-shooter",
    });
    const alliedShooter = runtime.state.groupsById.get("azure-target")!;
    alliedShooter.action = "engaging";
    alliedShooter.currentTargetId = "olive-neutral";
    alliedShooter.localContacts.set("olive-neutral", {
      targetGroupId: "olive-neutral",
      lastKnown: { x: 12, z: 16 },
      observedAt: 0,
      lastDirectTick: 0,
      confidenceBps: 10_000,
      sourceGroupId: "azure-target",
    });

    simulation.step();
    const events = simulation.drainEvents();
    expect(
      events.some(
        (event) => event.type === "weapon-fired" && event.targetGroupId === "olive-neutral",
      ),
    ).toBe(false);
    expect(
      events.some(
        (event) => event.type === "weapon-fired" && event.targetGroupId === "azure-target",
      ),
    ).toBe(true);
    expect(
      simulation
        .getRenderFrame()
        .members.filter((member) => member.groupId === "olive-neutral")
        .every((member) => member.health === "healthy"),
    ).toBe(true);
  });

  it("treats a neutral unit as a physical fire-line blocker", () => {
    const setup = createThreeFactionSetup([
      createGroup("ember-shooter", "ember", 8, 12),
      createGroup("olive-blocker", "olive", 12, 12),
      createGroup("azure-target", "azure", 16, 12),
    ], {
      sightRangeCells: 40,
      weaponRangeCells: 12,
      preferredRangeCells: 6,
      maximumDurationTicks: 100,
      stalemateTicks: 100,
    });
    const simulation = createSimulation(setup);
    const runtime = simulation as unknown as {
      state: {
        groupsById: Map<string, {
          action: string;
          currentTargetId?: string;
          localContacts: Map<string, unknown>;
        }>;
      };
    };
    const shooter = runtime.state.groupsById.get("ember-shooter")!;
    shooter.action = "engaging";
    shooter.currentTargetId = "azure-target";
    shooter.localContacts.set("azure-target", {
      targetGroupId: "azure-target",
      lastKnown: { x: 16, z: 12 },
      observedAt: 0,
      lastDirectTick: 0,
      confidenceBps: 10_000,
      sourceGroupId: "ember-shooter",
    });

    simulation.step();
    expect(
      simulation
        .drainEvents()
        .some((event) => event.type === "weapon-fired" && event.groupId === "ember-shooter"),
    ).toBe(false);
  });

  it("delivers allied historical snapshots only after their configured delay", () => {
    const setup = createThreeFactionSetup(
      [
        createGroup("ember-observer", "ember", 8, 6),
        createGroup("azure-receiver", "azure", 39, 23),
        createGroup("olive-target", "olive", 18, 6),
      ],
      {
        sightRangeCells: 13,
        weaponRangeCells: 0,
        preferredRangeCells: 1,
        maximumDurationTicks: 200,
        stalemateTicks: 200,
      },
      [
        defaultRelation("ember", "azure", "allied", 30, 10),
        defaultRelation("ember", "olive", "hostile"),
        defaultRelation("azure", "olive", "hostile"),
      ],
    );
    const simulation = createSimulation(setup);
    let spottedTick: number | undefined;
    for (let index = 0; index < 20 && spottedTick === undefined; index += 1) {
      simulation.step();
      spottedTick = simulation
        .drainEvents()
        .find(
          (event) =>
            event.type === "contact-spotted" &&
            event.observerGroupId === "ember-observer" &&
            event.targetGroupId === "olive-target",
        )?.tick;
    }

    expect(spottedTick).toBeTypeOf("number");
    const deliveryTick = spottedTick! + 30;
    while (simulation.tick < deliveryTick) {
      simulation.step();
      simulation.drainEvents();
    }
    expect(
      (simulation.inspect("azure-receiver") as GroupInspection).contacts.some(
        (contact) => contact.targetGroupId === "olive-target",
      ),
    ).toBe(false);

    const pausedTick = simulation.tick;
    simulation.step(0);
    expect(simulation.tick).toBe(pausedTick);

    simulation.step();
    const receiver = simulation.inspect("azure-receiver") as GroupInspection;
    const sharedContact = receiver.contacts.find(
      (contact) => contact.targetGroupId === "olive-target",
    );
    const target = simulation.inspect("olive-target") as GroupInspection;
    expect(sharedContact).toMatchObject({
      observedAt: spottedTick,
      lastKnown: { x: 18, z: 6 },
      direct: false,
    });
    expect(target.cell).not.toEqual(sharedContact?.lastKnown);
  });

  it("keeps a three-faction allied intelligence replay deterministic", () => {
    const setup = createThreeFactionSetup(
      [
        createGroup("ember-observer", "ember", 8, 6),
        createGroup("azure-receiver", "azure", 39, 23),
        createGroup("olive-target", "olive", 18, 6),
      ],
      { weaponRangeCells: 0, preferredRangeCells: 1, maximumDurationTicks: 200 },
      [
        defaultRelation("ember", "azure", "allied", 30, 10),
        defaultRelation("ember", "olive", "hostile"),
        defaultRelation("azure", "olive", "hostile"),
      ],
    );
    const first = createSimulation(setup);
    const second = createSimulation(setup);
    first.step(80);
    second.step(80);

    expect(first.getStateHash()).toBe(second.getStateHash());
    expect(first.getResult()).toEqual(second.getResult());
    expect(first.drainEvents()).toEqual(second.drainEvents());
  });

  it("ends conflict after hostile factions disappear even when a neutral faction survives", () => {
    const setup = createThreeFactionSetup([
      createGroup("ember-dead", "ember", 8, 12, "dead"),
      createGroup("azure-dead", "azure", 16, 12, "dead"),
      createGroup("olive-survivor", "olive", 24, 12),
    ], {
      resolutionStableTicks: 3,
      maximumDurationTicks: 100,
      stalemateTicks: 100,
    });
    const simulation = createSimulation(setup);
    simulation.step(10);

    expect(simulation.status).toBe("finished");
    expect(simulation.getResult()).toMatchObject({
      terminationReason: "hostiles-eliminated",
      winnerFactionIds: ["olive"],
    });
  });
});

function createThreeFactionSetup(
  groups: readonly GroupSpawn[] = [
    createGroup("ember-group", "ember", 8, 12),
    createGroup("azure-group", "azure", 32, 12),
    createGroup("olive-group", "olive", 20, 5),
  ],
  ruleOverrides: Partial<BattleSetup["rules"]> = {},
  relationsOverride?: readonly RelationSetup[],
): BattleSetup {
  const base = createDemoBattleSetup({
    seed: "diplomacy-flat",
    width: 40,
    height: 24,
    groupsPerFaction: 1,
    maximumDurationSeconds: 120,
    stalemateSeconds: 90,
  });
  const factions: readonly FactionSetup[] = [
    { id: "ember", displayName: "赤焰", color: "#e45f62" },
    { id: "azure", displayName: "苍蓝", color: "#3e8fd1" },
    { id: "olive", displayName: "橄榄", color: "#7c9a52" },
  ];
  const relations: readonly RelationSetup[] = [
    defaultRelation("ember", "azure", "hostile"),
    defaultRelation("ember", "olive", "neutral"),
    defaultRelation("azure", "olive", "allied"),
  ];
  return {
    ...base,
    battleId: `diplomacy-${groups.map((group) => group.id).join("-")}`,
    map: createFlatMap(40, 24),
    factions,
    relations: relationsOverride ?? relations,
    groups,
    mode: { kind: "conflict" },
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
  };
}
