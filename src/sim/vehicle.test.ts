import { describe, expect, it } from "vitest";
import { createDemoBattleSetup } from "../demo/setup";
import {
  BATTLE_MAP_SCHEMA_VERSION,
  BATTLE_RULES_VERSION,
  BATTLE_SETUP_SCHEMA_VERSION,
  DEFAULT_CREW_MEMBER_TEMPLATE_ID,
  DEFAULT_GUNNER_MEMBER_TEMPLATE_ID,
  DEFAULT_GROUP_TEMPLATE_ID,
  DEFAULT_MEMBER_TEMPLATE_ID,
  DEFAULT_RELIEF_CREW_MEMBER_TEMPLATE_ID,
  DEFAULT_TRACKED_GROUP_TEMPLATE_ID,
  DEFAULT_TRACKED_PLATFORM_TEMPLATE_ID,
  DEFAULT_WHEELED_GROUP_TEMPLATE_ID,
  DEFAULT_WHEELED_PLATFORM_TEMPLATE_ID,
  PRE_PLATFORM_BATTLE_RULES_VERSION,
  PRE_CREW_BATTLE_RULES_VERSION,
  PRE_PLATFORM_BATTLE_SETUP_SCHEMA_VERSION,
  SURFACE_TYPE_IDS,
  WATER_DEPTH_UNITS,
  createDefaultBattleContent,
  createSimulation,
  migrateBattleSetup,
  validateBattleSetup,
} from "./index";
import type {
  BattleContentBundle,
  BattleMap,
  BattleSetup,
  BattleSetupInput,
  GroupInspection,
  GroupSpawn,
  LegacyBattleContentBundle,
  MemberInspection,
  PlatformInspection,
} from "./types";
import {
  derivePlatformCapabilities,
  selectCrewReassignment,
} from "./vehicle";

describe("vehicle crew rules", () => {
  it("prefers qualified relief crew and suspends both transition stations", () => {
    const content = createDefaultBattleContent();
    const template = content.platformTemplates[DEFAULT_TRACKED_PLATFORM_TEMPLATE_ID]!;
    const assignments = [
      { stationId: "driver", memberId: "driver" },
      { stationId: "gunner", memberId: "gunner" },
      { stationId: "relief", memberId: "relief" },
    ];
    const members = [
      { id: "driver", roleTags: ["driver"], active: false },
      { id: "gunner", roleTags: ["gunner"], active: true },
      { id: "relief", roleTags: ["driver", "gunner"], active: true },
    ];
    const components = template.componentRules.map((component) => ({
      id: component.id,
      state: "operational" as const,
    }));

    expect(selectCrewReassignment(template, assignments, members, [])).toEqual({
      memberId: "relief",
      fromStationId: "relief",
      toStationId: "driver",
      efficiencyBps: 10_000,
    });
    expect(
      derivePlatformCapabilities(template, components, assignments, members, []).mobility,
    ).toEqual({
      available: false,
      reason: "crew-unavailable",
      efficiencyBps: 0,
    });
    const during = derivePlatformCapabilities(template, components, assignments, members, [
      {
        memberId: "relief",
        fromStationId: "relief",
        toStationId: "driver",
      },
    ]);
    expect(during.mobility.available).toBe(false);
    expect(during.weapons).toMatchObject([{ available: true }]);

    const substitutedDriver = derivePlatformCapabilities(
      template,
      components,
      [
        { stationId: "driver", memberId: "gunner" },
        { stationId: "gunner", memberId: "driver" },
        { stationId: "relief", memberId: "relief" },
      ],
      [
        { id: "driver", roleTags: ["driver"], active: false },
        { id: "gunner", roleTags: ["gunner"], active: true },
        { id: "relief", roleTags: ["driver", "gunner"], active: false },
      ],
      [],
    );
    expect(substitutedDriver.mobility).toEqual({
      available: true,
      reason: "available",
      efficiencyBps: 6_000,
    });
  });
});

describe("single-platform vehicle slice", () => {
  it("migrates stage-3.0 setups to the crew-capable rules without changing input fields", () => {
    const current = createDemoBattleSetup({
      seed: "vehicle-crew-migration",
      groupsPerFaction: 1,
      vehicleGroupsPerFaction: 1,
    });
    const migrated = migrateBattleSetup({
      ...current,
      rulesVersion: PRE_CREW_BATTLE_RULES_VERSION,
    } satisfies BattleSetupInput);

    expect(migrated.rulesVersion).toBe(BATTLE_RULES_VERSION);
    expect(migrated.schemaVersion).toBe(BATTLE_SETUP_SCHEMA_VERSION);
    expect(migrated.groups).toEqual(current.groups);
  });

  it("migrates stage-2.2 content and spawns to the explicit stage-3 platform contract", () => {
    const current = createDemoBattleSetup({ seed: "vehicle-migration", groupsPerFaction: 1 });
    const { transportAssignments: _transportAssignments, ...withoutTransport } = current;
    const legacy: BattleSetupInput = {
      ...withoutTransport,
      schemaVersion: PRE_PLATFORM_BATTLE_SETUP_SCHEMA_VERSION,
      rulesVersion: PRE_PLATFORM_BATTLE_RULES_VERSION,
      content: createLegacyInfantryContent(current.content),
      groups: current.groups.map(({ platforms: _platforms, ...group }) => group),
    };

    const migrated = migrateBattleSetup(legacy);

    expect(migrated.schemaVersion).toBe(BATTLE_SETUP_SCHEMA_VERSION);
    expect(migrated.rulesVersion).toBe(BATTLE_RULES_VERSION);
    expect(migrated.content.contentVersion).toBe("content-2");
    expect(migrated.transportAssignments).toEqual([]);
    expect(migrated.groups.every((group) => group.platforms.length === 0)).toBe(true);
    expect(() => validateBattleSetup(migrated)).not.toThrow();
  });

  it("uses platform movement type for required routes", () => {
    const wheeled = createVehicleSetup("wheeled");
    const tracked = createVehicleSetup("tracked");

    expect(() => validateBattleSetup(wheeled)).toThrow(/evacuation cell/i);
    expect(() => validateBattleSetup(tracked)).not.toThrow();
  });

  it("rejects invalid crew stations and more than one platform before runtime", () => {
    const setup = createVehicleSetup("tracked");
    const vehicle = setup.groups[0]!;
    const platform = vehicle.platforms[0]!;
    const invalidStation = {
      ...setup,
      groups: [
        {
          ...vehicle,
          platforms: [
            {
              ...platform,
              crewAssignments: [
                { stationId: "missing-station", memberId: "ember-vehicle-driver" },
              ],
            },
          ],
        },
        setup.groups[1]!,
      ],
    } satisfies BattleSetup;
    const multiplePlatforms = {
      ...setup,
      groups: [
        {
          ...vehicle,
          platforms: [platform, { ...platform, id: "ember-vehicle-platform-2" }],
        },
        setup.groups[1]!,
      ],
    } satisfies BattleSetup;

    expect(() => validateBattleSetup(invalidStation)).toThrow(/crew station/i);
    expect(() => validateBattleSetup(multiplePlatforms)).toThrow(/platform count/i);
  });

  it("waits for deterministic facing changes before moving a tracked platform", () => {
    const first = createSimulation(createVehicleSetup("tracked"));
    const second = createSimulation(createVehicleSetup("tracked"));

    driveOneCell(first);
    driveOneCell(second);

    expect(first.getStateHash()).toBe(second.getStateHash());
    expect(first.inspect("ember-vehicle")).toMatchObject({
      cell: { x: 3, z: 10 },
      platforms: [{ facing: 2, movementType: "tracked", mobility: "mobile" }],
    });
  });

  it("reassigns qualified relief crew after a fixed deterministic delay", () => {
    const first = createSimulation(createVehicleSetup("tracked"));
    const second = createSimulation(createVehicleSetup("tracked"));
    setCrewHealth(first, "ember-vehicle-driver", "incapacitated");
    setCrewHealth(second, "ember-vehicle-driver", "incapacitated");

    first.step();
    second.step();
    expect(first.getStateHash()).toBe(second.getStateHash());
    expect(first.inspect("ember-vehicle-platform", "ember")).toMatchObject({
      mobility: "immobilized",
      mobilityCapability: {
        available: false,
        reason: "crew-unavailable",
        efficiencyBps: 0,
      },
      combat: "effective",
      crewReassignments: [
        {
          memberId: "ember-vehicle-relief",
          fromStationId: "relief",
          toStationId: "driver",
          ticksRemaining: 20,
        },
      ],
    });
    expect(first.drainEvents()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "platform-state-changed",
        to: expect.objectContaining({ mobility: "immobilized" }),
      }),
      expect.objectContaining({
        type: "crew-station-changed",
        memberId: "ember-vehicle-relief",
        phase: "started",
      }),
    ]));

    first.step(20);
    second.step(20);
    expect(first.getStateHash()).toBe(second.getStateHash());
    expect(first.inspect("ember-vehicle-platform", "ember")).toMatchObject({
      mobility: "mobile",
      combat: "effective",
      crewReassignments: [],
      crewAssignments: expect.arrayContaining([
        { stationId: "driver", memberId: "ember-vehicle-relief" },
        { stationId: "relief", memberId: "ember-vehicle-driver" },
      ]),
    });
    expect(first.inspect("ember-vehicle-driver", "ember")).toMatchObject({
      placement: {
        kind: "crew",
        platformId: "ember-vehicle-platform",
        stationId: "relief",
      },
    });
  });

  it("cancels an interrupted reassignment without vacating another required station", () => {
    const simulation = createSimulation(createVehicleSetup("tracked"));
    setCrewHealth(simulation, "ember-vehicle-driver", "incapacitated");
    simulation.step();
    simulation.drainEvents();
    setCrewHealth(simulation, "ember-vehicle-relief", "incapacitated");

    simulation.step();

    expect(simulation.inspect("ember-vehicle-platform", "ember")).toMatchObject({
      mobility: "immobilized",
      combat: "effective",
      crewReassignments: [],
    });
    expect(simulation.drainEvents()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "crew-station-changed",
        memberId: "ember-vehicle-relief",
        phase: "cancelled",
      }),
    ]));
  });

  it("applies substitute efficiency to a relief driver", () => {
    const setup = createVehicleSetup("tracked");
    const reliefTemplate = setup.content.memberTemplates[DEFAULT_RELIEF_CREW_MEMBER_TEMPLATE_ID]!;
    const content = {
      ...setup.content,
      memberTemplates: {
        ...setup.content.memberTemplates,
        [reliefTemplate.id]: {
          ...reliefTemplate,
          roleTags: ["loader"],
        },
      },
    };
    const simulation = createSimulation({ ...setup, content });
    setCrewHealth(simulation, "ember-vehicle-driver", "incapacitated");

    simulation.step(21);

    expect(simulation.inspect("ember-vehicle-platform", "ember")).toMatchObject({
      mobility: "mobile",
      mobilityCapability: {
        available: true,
        reason: "available",
        efficiencyBps: 6_000,
      },
      stations: expect.arrayContaining([
        expect.objectContaining({
          id: "driver",
          assignedMemberId: "ember-vehicle-relief",
          efficiencyBps: 6_000,
        }),
      ]),
    });
  });

  it("suspends observation and platform weapons until the gunner is replaced", () => {
    const simulation = createSimulation(createVehicleSetup("tracked"));
    setCrewHealth(simulation, "ember-vehicle-gunner", "incapacitated");

    simulation.step();
    expect(simulation.inspect("ember-vehicle-platform", "ember")).toMatchObject({
      mobility: "mobile",
      combat: "ineffective",
      observation: { available: false, reason: "crew-unavailable" },
      weapons: [{ available: false, reason: "crew-unavailable" }],
      crewReassignments: [
        {
          memberId: "ember-vehicle-relief",
          fromStationId: "relief",
          toStationId: "gunner",
        },
      ],
    });

    simulation.step(20);
    expect(simulation.inspect("ember-vehicle-platform", "ember")).toMatchObject({
      mobility: "mobile",
      combat: "effective",
      observation: { available: true, reason: "available" },
      weapons: [{ available: true, reason: "available" }],
      crewReassignments: [],
    });
  });

  it("fires platform weapons only while their crewed component is available", () => {
    const setup = createVehicleSetup("tracked");
    const target = setup.groups[1]!;
    const inRange = {
      ...setup,
      groups: [
        setup.groups[0]!,
        { ...target, spawn: { x: 9, z: 10 }, evacuation: { x: 9, z: 10 } },
      ],
      rules: { ...setup.rules, maximumDurationTicks: 300 },
    } satisfies BattleSetup;
    const simulation = createSimulation(inRange);

    simulation.step(300);

    expect(simulation.drainEvents()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "weapon-fired",
        groupId: "ember-vehicle",
        targetGroupId: "azure-infantry",
      }),
    ]));
    expect(
      (simulation.getResult()?.platforms[0]?.weaponStates[0]?.magazineRounds ?? 12),
    ).toBeLessThan(12);
  });

  it("freezes an unfinished crew action in the final result and state hash", () => {
    const setup = createVehicleSetup("tracked");
    const simulation = createSimulation({
      ...setup,
      rules: { ...setup.rules, maximumDurationTicks: 1 },
    });
    setCrewHealth(simulation, "ember-vehicle-driver", "incapacitated");

    simulation.step();
    const hash = simulation.getStateHash();
    expect(simulation.getResult()?.platforms[0]?.finalCrewReassignments).toMatchObject([
      { memberId: "ember-vehicle-relief", ticksRemaining: 20 },
    ]);

    simulation.step(100);
    expect(simulation.getStateHash()).toBe(hash);
    expect(simulation.getResult()?.stateHash).toBe(hash);
  });

  it("projects a crewed platform without duplicating its driver as dismounted infantry", () => {
    const setup = createVehicleSetup("tracked");
    const simulation = createSimulation({
      ...setup,
      rules: { ...setup.rules, maximumDurationTicks: 5 },
    });
    const frame = simulation.getRenderFrame("ember");
    const platform = simulation.inspect("ember-vehicle-platform", "ember") as PlatformInspection;
    const driver = simulation.inspect("ember-vehicle-driver", "ember") as MemberInspection;
    const group = simulation.inspect("ember-vehicle", "ember") as GroupInspection;

    expect(frame.platforms).toHaveLength(1);
    expect(frame.members).toHaveLength(0);
    expect(platform).toMatchObject({
      kind: "platform",
      mobility: "mobile",
      combat: "effective",
      disposition: "crewed",
      crewCount: 3,
    });
    expect(platform.observation).toEqual({
      available: true,
      reason: "available",
      efficiencyBps: 10_000,
    });
    expect(platform.weapons).toMatchObject([{ available: true }]);
    expect(simulation.inspect("ember-vehicle-platform", "azure")).toBeUndefined();
    expect(platform.components.every((component) => component.integrityBps === 10_000)).toBe(true);
    expect(driver.placement).toEqual({
      kind: "crew",
      platformId: "ember-vehicle-platform",
      stationId: "driver",
    });
    expect(group.platforms).toHaveLength(1);

    simulation.step(10);
    expect(simulation.getResult()).toMatchObject({
      rulesVersion: BATTLE_RULES_VERSION,
      platforms: [
        {
          id: "ember-vehicle-platform",
          damaged: false,
          disposition: "crewed",
        },
      ],
    });
  });
});

function createVehicleSetup(movementType: "wheeled" | "tracked"): BattleSetup {
  const base = createDemoBattleSetup({
    seed: `vehicle-${movementType}`,
    width: 24,
    height: 20,
    groupsPerFaction: 1,
    mountainDensity: 0,
    roughness: 0,
    waterCoverage: 0,
    wetlandCoverage: 0,
    treeCoverage: 0,
    rockCoverage: 0,
    wallCoverage: 0,
  });
  return {
    ...base,
    battleId: `vehicle-${movementType}`,
    map: createBarrierMap(),
    groups: [createVehicleGroup(movementType), createInfantryGroup()],
  };
}

function createVehicleGroup(movementType: "wheeled" | "tracked"): GroupSpawn {
  const tracked = movementType === "tracked";
  return {
    id: "ember-vehicle",
    factionId: "ember",
    groupTemplateId: tracked
      ? DEFAULT_TRACKED_GROUP_TEMPLATE_ID
      : DEFAULT_WHEELED_GROUP_TEMPLATE_ID,
    spawn: { x: 2, z: 10 },
    evacuation: { x: 21, z: 10 },
    members: [
      {
        id: "ember-vehicle-driver",
        memberTemplateId: DEFAULT_CREW_MEMBER_TEMPLATE_ID,
      },
      {
        id: "ember-vehicle-gunner",
        memberTemplateId: DEFAULT_GUNNER_MEMBER_TEMPLATE_ID,
      },
      {
        id: "ember-vehicle-relief",
        memberTemplateId: DEFAULT_RELIEF_CREW_MEMBER_TEMPLATE_ID,
      },
    ],
    platforms: [
      {
        id: "ember-vehicle-platform",
        platformTemplateId: tracked
          ? DEFAULT_TRACKED_PLATFORM_TEMPLATE_ID
          : DEFAULT_WHEELED_PLATFORM_TEMPLATE_ID,
        initialFacing: 0,
        crewAssignments: [
          { stationId: "driver", memberId: "ember-vehicle-driver" },
          { stationId: "gunner", memberId: "ember-vehicle-gunner" },
          { stationId: "relief", memberId: "ember-vehicle-relief" },
        ],
      },
    ],
  };
}

function createInfantryGroup(): GroupSpawn {
  return {
    id: "azure-infantry",
    factionId: "azure",
    groupTemplateId: DEFAULT_GROUP_TEMPLATE_ID,
    spawn: { x: 21, z: 9 },
    evacuation: { x: 21, z: 9 },
    members: Array.from({ length: 8 }, (_, index) => ({
      id: `azure-infantry-member-${index + 1}`,
      memberTemplateId: DEFAULT_MEMBER_TEMPLATE_ID,
    })),
    platforms: [],
  };
}

function createBarrierMap(): BattleMap {
  const width = 24;
  const height = 20;
  const size = width * height;
  const surfaceTypeIds = new Uint16Array(size).fill(SURFACE_TYPE_IDS.grass);
  const waterDepthUnits = new Uint8Array(size).fill(WATER_DEPTH_UNITS.none);
  for (let z = 0; z < height; z += 1) {
    const index = z * width + 12;
    surfaceTypeIds[index] = SURFACE_TYPE_IDS.mud;
    waterDepthUnits[index] = WATER_DEPTH_UNITS.shallow;
  }
  return {
    schemaVersion: BATTLE_MAP_SCHEMA_VERSION,
    width,
    height,
    cellSizeMm: 4_000,
    heightUnitMm: 500,
    layers: {
      heightUnits: new Int16Array(size),
      surfaceTypeIds,
      waterDepthUnits,
      cellFlags: new Uint16Array(size),
      staticOccupancy: new Uint8Array(size),
    },
    staticObjects: [],
  };
}

function driveOneCell(simulation: ReturnType<typeof createSimulation>): void {
  const internals = simulation as unknown as {
    readonly state: {
      readonly groupsById: Map<
        string,
        {
          path: { x: number; z: number }[];
          action: string;
          turnTicksRemaining: number;
          readonly platforms: { facing: number }[];
        }
      >;
    };
    advanceMovement(): void;
  };
  const group = internals.state.groupsById.get("ember-vehicle")!;
  group.path = [{ x: 3, z: 10 }];
  group.action = "moving-to-contact";

  internals.advanceMovement();
  expect(group.turnTicksRemaining).toBe(2);
  internals.advanceMovement();
  expect(group.turnTicksRemaining).toBe(1);
  expect(group.platforms[0]?.facing).toBe(0);
  internals.advanceMovement();
  expect(group.turnTicksRemaining).toBe(0);
  expect(group.platforms[0]?.facing).toBe(2);
  for (let tick = 0; tick < 30; tick += 1) {
    internals.advanceMovement();
  }
}

function setCrewHealth(
  simulation: ReturnType<typeof createSimulation>,
  memberId: string,
  health: "incapacitated" | "dead",
): void {
  const internals = simulation as unknown as {
    readonly state: {
      readonly membersById: Map<string, { health: string }>;
    };
  };
  internals.state.membersById.get(memberId)!.health = health;
}

function createLegacyInfantryContent(
  content: BattleContentBundle,
): LegacyBattleContentBundle {
  const currentEra = content.eraTemplates[content.eraId]!;
  const {
    allowedPlatformTemplateIds: _allowedPlatformTemplateIds,
    ...legacyEra
  } = currentEra;
  const currentGroup = content.groupTemplates[DEFAULT_GROUP_TEMPLATE_ID]!;
  const { platformSlotRules: _platformSlotRules, ...legacyGroup } = currentGroup;
  const currentMember = content.memberTemplates[DEFAULT_MEMBER_TEMPLATE_ID]!;
  const { transportOccupancyUnits: _transportOccupancyUnits, ...legacyMember } = currentMember;
  return {
    contentVersion: "content-1",
    eraId: content.eraId,
    eraTemplates: {
      [content.eraId]: {
        ...legacyEra,
        allowedGroupTemplateIds: [DEFAULT_GROUP_TEMPLATE_ID],
        allowedMemberTemplateIds: [DEFAULT_MEMBER_TEMPLATE_ID],
      },
    },
    groupTemplates: {
      [DEFAULT_GROUP_TEMPLATE_ID]: { ...legacyGroup, platformSlotRules: [] },
    },
    memberTemplates: { [DEFAULT_MEMBER_TEMPLATE_ID]: legacyMember },
    platformTemplates: {},
    weaponTemplates: content.weaponTemplates,
    sensorTemplates: content.sensorTemplates,
    abilityTemplates: content.abilityTemplates,
    statusTemplates: content.statusTemplates,
    terrainCatalog: content.terrainCatalog,
  };
}
