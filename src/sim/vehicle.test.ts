import { describe, expect, it } from "vitest";
import { createDemoBattleSetup } from "../demo/setup";
import {
  BATTLE_MAP_SCHEMA_VERSION,
  BATTLE_RULES_VERSION,
  BATTLE_SETUP_SCHEMA_VERSION,
  DEFAULT_CREW_MEMBER_TEMPLATE_ID,
  DEFAULT_GROUP_TEMPLATE_ID,
  DEFAULT_MEMBER_TEMPLATE_ID,
  DEFAULT_TRACKED_GROUP_TEMPLATE_ID,
  DEFAULT_TRACKED_PLATFORM_TEMPLATE_ID,
  DEFAULT_WHEELED_GROUP_TEMPLATE_ID,
  DEFAULT_WHEELED_PLATFORM_TEMPLATE_ID,
  PRE_PLATFORM_BATTLE_RULES_VERSION,
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

describe("single-platform vehicle slice", () => {
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
      combat: "ineffective",
      disposition: "crewed",
      crewCount: 1,
    });
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
