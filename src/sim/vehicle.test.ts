import { describe, expect, it } from "vitest";
import { createDemoScenarioOptions } from "../demo/scenarios";
import { createDemoBattleSetup } from "../demo/setup";
import {
  BATTLE_MAP_SCHEMA_VERSION,
  BATTLE_RULES_VERSION,
  BATTLE_SETUP_SCHEMA_VERSION,
  DEFAULT_CREW_MEMBER_TEMPLATE_ID,
  DEFAULT_GUNNER_MEMBER_TEMPLATE_ID,
  DEFAULT_GROUP_TEMPLATE_ID,
  DEFAULT_MEMBER_TEMPLATE_ID,
  DEFAULT_PLATFORM_WEAPON_TEMPLATE_ID,
  DEFAULT_RELIEF_CREW_MEMBER_TEMPLATE_ID,
  DEFAULT_TRACKED_GROUP_TEMPLATE_ID,
  DEFAULT_TRACKED_PLATFORM_TEMPLATE_ID,
  DEFAULT_WHEELED_GROUP_TEMPLATE_ID,
  DEFAULT_WHEELED_PLATFORM_TEMPLATE_ID,
  PRE_PLATFORM_BATTLE_RULES_VERSION,
  PRE_DAMAGE_BATTLE_RULES_VERSION,
  PRE_CREW_BATTLE_RULES_VERSION,
  PRE_PLATFORM_BATTLE_SETUP_SCHEMA_VERSION,
  PRE_STABLE_VEHICLE_MOVEMENT_BATTLE_RULES_VERSION,
  SURFACE_TYPE_IDS,
  WATER_DEPTH_UNITS,
  createDefaultBattleContent,
  cloneBattleContent,
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
  armorFaceForAttack,
  componentStateForIntegrity,
  penetrationChanceBps,
  selectWeightedPlatformComponent,
  derivePlatformCapabilities,
  selectCrewReassignment,
} from "./vehicle";

describe("vehicle armor rules", () => {
  it("resolves front, side, rear, and explicit top attacks from stable facings", () => {
    const target = { x: 10, z: 10 };

    expect(armorFaceForAttack(0, target, { x: 10, z: 15 }, false)).toBe("front");
    expect(armorFaceForAttack(0, target, { x: 15, z: 10 }, false)).toBe("side");
    expect(armorFaceForAttack(0, target, { x: 10, z: 5 }, false)).toBe("rear");
    expect(armorFaceForAttack(0, target, { x: 10, z: 15 }, true)).toBe("top");
  });

  it("uses bounded integer penetration odds around the armor rating", () => {
    expect(penetrationChanceBps(0, 0)).toBe(0);
    expect(penetrationChanceBps(100, 0)).toBe(10_000);
    expect(penetrationChanceBps(100, 100)).toBe(5_000);
    expect(penetrationChanceBps(80, 100)).toBe(4_000);
    expect(penetrationChanceBps(1, 1_000)).toBe(500);
    expect(penetrationChanceBps(1_000, 1)).toBe(9_500);
  });

  it("selects weighted eligible components and derives threshold states", () => {
    const rules = [
      {
        id: "structure",
        kind: "structure" as const,
        hitWeight: 1,
        external: false,
        disabledAtBps: 0,
        requiredStationIds: [],
      },
      {
        id: "tracks",
        kind: "running-gear" as const,
        hitWeight: 3,
        external: true,
        disabledAtBps: 2_500,
        requiredStationIds: ["driver"],
      },
    ];

    expect(selectWeightedPlatformComponent(rules, 0)?.id).toBe("structure");
    expect(selectWeightedPlatformComponent(rules, 1)?.id).toBe("tracks");
    expect(selectWeightedPlatformComponent(rules, 0, true)?.id).toBe("tracks");
    expect(componentStateForIntegrity(10_000, 2_500)).toBe("operational");
    expect(componentStateForIntegrity(9_999, 2_500)).toBe("damaged");
    expect(componentStateForIntegrity(2_500, 2_500)).toBe("disabled");
    expect(componentStateForIntegrity(0, 2_500)).toBe("destroyed");
  });
});

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
  it("migrates stage-3.1 setups to armor-capable rules without changing input fields", () => {
    const current = createVehicleSetup("tracked");
    const migrated = migrateBattleSetup({
      ...current,
      rulesVersion: PRE_DAMAGE_BATTLE_RULES_VERSION,
    });

    expect(migrated.rulesVersion).toBe(BATTLE_RULES_VERSION);
    expect(migrated.groups).toEqual(current.groups);
    expect(migrated.content).toEqual(current.content);
  });

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

  it("migrates stage-3.4 setups to stable vehicle movement rules without changing inputs", () => {
    const current = createDemoBattleSetup(
      createDemoScenarioOptions("vehicle-defense", "vehicle-movement-migration"),
    );
    const migrated = migrateBattleSetup({
      ...current,
      rulesVersion: PRE_STABLE_VEHICLE_MOVEMENT_BATTLE_RULES_VERSION,
    } satisfies BattleSetupInput);

    expect(migrated.rulesVersion).toBe(BATTLE_RULES_VERSION);
    expect(migrated.groups).toEqual(current.groups);
    expect(migrated.transportAssignments).toEqual(current.transportAssignments);
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
    expect(migrated.content.contentVersion).toBe("content-3");
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

  it("projects a crewed platform at the group's continuous in-cell position", () => {
    const simulation = createSimulation(createVehicleSetup("tracked"));
    const internals = simulation as unknown as {
      readonly state: {
        readonly groupsById: Map<
          string,
          {
            path: { x: number; z: number }[];
            action: string;
            moveProgress: number;
            readonly platforms: { readonly cell: { x: number; z: number } }[];
          }
        >;
      };
      advanceMovement(): void;
    };
    const groupState = internals.state.groupsById.get("ember-vehicle")!;
    groupState.path = [{ x: 3, z: 10 }];
    groupState.action = "moving-to-contact";

    for (let tick = 0; tick < 4; tick += 1) {
      internals.advanceMovement();
    }

    const frame = simulation.getRenderFrame("ember");
    const renderedGroup = frame.groups.find((group) => group.id === "ember-vehicle")!;
    const renderedPlatform = frame.platforms.find(
      (platform) => platform.id === "ember-vehicle-platform",
    )!;
    expect(groupState.moveProgress).toBeGreaterThan(0);
    expect(groupState.platforms[0]?.cell).toEqual({ x: 2, z: 10 });
    expect(renderedPlatform.worldX).toBe(renderedGroup.worldX);
    expect(renderedPlatform.worldZ).toBe(renderedGroup.worldZ);
    expect(renderedPlatform.worldX).toBeGreaterThan(2 * 4);
    expect(renderedPlatform.worldX).toBeLessThan(3 * 4);
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

  it("resolves deterministic anti-vehicle damage through components, crew survival, and abandonment", () => {
    const setup = createVehicleDuelSetup({
      kind: "platform-damage",
      penetrationRating: 10_000,
      componentDamageBps: 6_000,
      crewDamageBps: 0,
      externalDamageBps: 0,
      attackTags: [],
    });
    const first = createSimulation(setup);
    const second = createSimulation(setup);
    const events: ReturnType<typeof first.drainEvents>[number][] = [];
    let crewHealthyWhenDestroyed = false;

    while (first.status !== "finished" && first.tick < 800) {
      first.step();
      second.step();
      expect(second.getStateHash()).toBe(first.getStateHash());
      const tickEvents = first.drainEvents();
      events.push(...tickEvents);
      const destruction = tickEvents.find(
        (event) =>
          event.type === "platform-state-changed" &&
          event.to.disposition === "destroyed",
      );
      if (destruction?.type === "platform-state-changed") {
        const group = setup.groups.find((candidate) => candidate.id === destruction.groupId)!;
        crewHealthyWhenDestroyed = group.members.every(
          (member) =>
            (first.inspect(member.id, group.factionId) as MemberInspection).health === "healthy",
        );
      }
    }

    const result = first.getResult();
    const destroyed = result?.platforms.find(
      (platform) => platform.disposition === "destroyed",
    );
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "platform-component-changed",
        penetrated: true,
      }),
      expect.objectContaining({
        type: "platform-state-changed",
        to: expect.objectContaining({ disposition: "destroyed" }),
      }),
    ]));
    expect(destroyed).toBeDefined();
    expect(crewHealthyWhenDestroyed).toBe(true);
    expect(destroyed?.finalCrewAssignments).toEqual([]);
    expect(
      result?.members
        .filter((member) => member.groupId === destroyed?.groupId)
        .some((member) => member.health !== "dead"),
    ).toBe(true);
    expect(
      result?.members
        .filter((member) => member.groupId === destroyed?.groupId)
        .every((member) => member.finalPlacement.kind === "dismounted"),
    ).toBe(true);
    const frozenHash = first.getStateHash();
    first.step(100);
    expect(first.getStateHash()).toBe(frozenHash);
    expect(first.getResult()?.stateHash).toBe(frozenHash);
  });

  it("keeps non-penetrating damage on external components and away from crew", () => {
    const setup = createVehicleDuelSetup({
      kind: "platform-damage",
      penetrationRating: 0,
      componentDamageBps: 10_000,
      crewDamageBps: 20_000,
      externalDamageBps: 10_000,
      attackTags: [],
    });
    const simulation = createSimulation(setup);
    const componentEvents: Extract<
      ReturnType<typeof simulation.drainEvents>[number],
      { type: "platform-component-changed" }
    >[] = [];

    while (componentEvents.length === 0 && simulation.tick < 500) {
      simulation.step();
      componentEvents.push(
        ...simulation.drainEvents().filter(
          (event): event is typeof componentEvents[number] =>
            event.type === "platform-component-changed",
        ),
      );
    }

    expect(componentEvents.length).toBeGreaterThan(0);
    expect(componentEvents.every((event) => !event.penetrated)).toBe(true);
    expect(
      componentEvents.every((event) =>
        ["running-gear", "sensor", "primary-weapon"].includes(event.componentId),
      ),
    ).toBe(true);
    expect(
      setup.groups.every((group) =>
        group.members.every(
          (member) =>
            (simulation.inspect(member.id, group.factionId) as MemberInspection).health === "healthy",
        ),
      ),
    ).toBe(true);
  });

  it("keeps an immobilized armed platform fighting and withdraws a mobile disarmed platform", () => {
    const fixedGun = createSimulation(createVehicleSetup("tracked"));
    setPlatformComponent(fixedGun, "ember-vehicle-platform", "running-gear", 0, "destroyed");
    refreshPlatform(fixedGun, "ember-vehicle-platform");
    expect(fixedGun.inspect("ember-vehicle", "ember")).toMatchObject({
      modeEffective: true,
    });
    fixedGun.step(300);
    expect(fixedGun.inspect("ember-vehicle-platform", "ember")).toMatchObject({
      mobility: "immobilized",
      combat: "effective",
      disposition: "crewed",
    });
    expect(fixedGun.drainEvents()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "weapon-fired",
        groupId: "ember-vehicle",
      }),
    ]));

    const withdrawal = createSimulation(createVehicleSetup("tracked"));
    setPlatformComponent(withdrawal, "ember-vehicle-platform", "primary-weapon", 0, "destroyed");
    refreshPlatform(withdrawal, "ember-vehicle-platform");
    expect(withdrawal.inspect("ember-vehicle", "ember")).toMatchObject({
      modeEffective: false,
    });
    withdrawal.step(5);
    expect(withdrawal.inspect("ember-vehicle", "ember")).toMatchObject({
      action: "routing",
      decisionReason: "platform-combat-ineffective",
    });
    expect(withdrawal.inspect("ember-vehicle-platform", "ember")).toMatchObject({
      mobility: "mobile",
      combat: "ineffective",
      disposition: "crewed",
    });
  });

  it("collects mutual platform hits before either weapon component is disabled", () => {
    const base = createVehicleDuelSetup({
      kind: "platform-damage",
      penetrationRating: 10_000,
      componentDamageBps: 10_000,
      crewDamageBps: 0,
      externalDamageBps: 0,
      attackTags: [],
    });
    const content = cloneBattleContent(base.content);
    const tracked = content.platformTemplates[DEFAULT_TRACKED_PLATFORM_TEMPLATE_ID]!;
    const setup: BattleSetup = {
      ...base,
      seed: "simultaneous-438217",
      content: {
        ...content,
        platformTemplates: {
          ...content.platformTemplates,
          [tracked.id]: {
            ...tracked,
            armorRatingByFace: { front: 0, side: 0, rear: 0, top: 0 },
          },
        },
      },
    };
    const simulation = createSimulation(setup);
    primeDirectVehicleDuel(simulation);

    invokeWeaponUpdate(simulation);

    for (const platformId of ["ember-vehicle-platform", "azure-vehicle-platform"]) {
      expect(simulation.inspect(platformId)).toMatchObject({
        combat: "ineffective",
        components: expect.arrayContaining([
          expect.objectContaining({
            id: "primary-weapon",
            integrityBps: 0,
            state: "destroyed",
          }),
        ]),
      });
    }
    const events = simulation.drainEvents();
    expect(
      events.filter((event) => event.type === "weapon-fired"),
    ).toHaveLength(2);
    expect(
      events.filter(
        (event) =>
          event.type === "platform-component-changed" &&
          event.componentId === "primary-weapon",
      ),
    ).toHaveLength(2);
  });

  it("leaves a destroyed platform in place while its surviving crew withdraws on foot", () => {
    const simulation = createSimulation(createVehicleSetup("tracked"));
    setPlatformComponent(
      simulation,
      "ember-vehicle-platform",
      "structure",
      0,
      "destroyed",
    );
    refreshPlatform(simulation, "ember-vehicle-platform");

    simulation.step(20);

    const platform = simulation.inspect(
      "ember-vehicle-platform",
      "ember",
    ) as PlatformInspection;
    const group = simulation.inspect("ember-vehicle", "ember") as GroupInspection;
    expect(platform).toMatchObject({
      disposition: "destroyed",
      cell: { x: 2, z: 10 },
      crewAssignments: [],
    });
    expect(group.action).toBe("routing");
    expect(group.cell).not.toEqual(platform.cell);
    const frame = simulation.getRenderFrame("ember");
    const renderedGroup = frame.groups.find((entry) => entry.id === "ember-vehicle")!;
    const renderedPlatform = frame.platforms.find(
      (entry) => entry.id === "ember-vehicle-platform",
    )!;
    expect(renderedPlatform.worldX).toBe(platform.cell.x * 4);
    expect(renderedPlatform.worldZ).toBe(platform.cell.z * 4);
    expect(renderedPlatform.worldX).not.toBe(renderedGroup.worldX);
    for (const memberId of [
      "ember-vehicle-driver",
      "ember-vehicle-gunner",
      "ember-vehicle-relief",
    ]) {
      expect(simulation.inspect(memberId, "ember")).toMatchObject({
        placement: { kind: "dismounted" },
      });
    }
  });

  it("pursues a stale vehicle contact without targeting its blocked wreck cell", () => {
    const simulation = createSimulation(createVehicleSetup("tracked"));
    const wreckCell = { x: 17, z: 10 };
    const internals = simulation as unknown as {
      readonly setup: BattleSetup;
      readonly state: {
        readonly groupsById: Map<
          string,
          {
            readonly id: string;
            goal?: { x: number; z: number };
            path: { x: number; z: number }[];
            readonly localContacts: Map<string, unknown>;
          }
        >;
        readonly staticPlatformOccupancy: Map<number, string>;
      };
      decideForGroup(group: unknown): void;
    };
    const group = internals.state.groupsById.get("azure-infantry")!;
    const wreckIndex =
      wreckCell.z * internals.setup.map.width + wreckCell.x;
    internals.state.staticPlatformOccupancy.set(
      wreckIndex,
      "ember-vehicle-platform",
    );
    group.localContacts.set("ember-vehicle", {
      targetGroupId: "ember-vehicle",
      lastKnown: wreckCell,
      observedAt: 0,
      lastDirectTick: -100,
      confidenceBps: 10_000,
      sourceGroupId: group.id,
    });

    internals.decideForGroup(group);

    expect(group.goal).toBeDefined();
    expect(group.goal).not.toEqual(wreckCell);
    expect(group.path.length).toBeGreaterThan(1);
  });

  it("keeps a rifle squad on a damageable routing target instead of an intact vehicle", () => {
    const simulation = createSimulation(
      createDemoBattleSetup(
        createDemoScenarioOptions("vehicle-skirmish", "target-suitability"),
      ),
    );
    const internals = simulation as unknown as {
      readonly state: {
        readonly tick: number;
        readonly groupsById: Map<
          string,
          {
            readonly id: string;
            cell: { x: number; z: number };
            moraleState: string;
            readonly localContacts: Map<string, unknown>;
          }
        >;
      };
      chooseDirectTarget(group: unknown): { readonly id: string } | undefined;
    };
    const attacker = internals.state.groupsById.get("azure-squad-3")!;
    const vehicle = internals.state.groupsById.get("ember-wheeled-1")!;
    const routingSquad = internals.state.groupsById.get("ember-squad-3")!;
    attacker.cell = { x: 20, z: 10 };
    vehicle.cell = { x: 22, z: 10 };
    routingSquad.cell = { x: 26, z: 10 };
    routingSquad.moraleState = "routing";
    attacker.localContacts.clear();
    for (const target of [vehicle, routingSquad]) {
      attacker.localContacts.set(target.id, {
        targetGroupId: target.id,
        lastKnown: { ...target.cell },
        observedAt: internals.state.tick,
        lastDirectTick: internals.state.tick,
        confidenceBps: 10_000,
        sourceGroupId: attacker.id,
      });
    }

    expect(internals.chooseDirectTarget(attacker)?.id).toBe(routingSquad.id);
  });

  it("uses observed target profiles without reading stale contacts' live state", () => {
    const simulation = createSimulation(
      createDemoBattleSetup(
        createDemoScenarioOptions("vehicle-skirmish", "known-target-suitability"),
      ),
    );
    const internals = simulation as unknown as {
      readonly state: {
        readonly tick: number;
        readonly groupsById: Map<
          string,
          {
            readonly id: string;
            cell: { x: number; z: number };
            readonly platforms: { disposition: string }[];
            readonly searchedContacts: Map<string, number>;
          }
        >;
        readonly factionKnowledge: Map<
          string,
          { readonly contacts: Map<string, unknown> }
        >;
      };
      chooseBestKnownContact(group: unknown):
        | { readonly targetGroupId: string }
        | undefined;
    };
    const attacker = internals.state.groupsById.get("azure-squad-3")!;
    const vehicle = internals.state.groupsById.get("ember-wheeled-1")!;
    const infantry = internals.state.groupsById.get("ember-squad-3")!;
    const contacts = internals.state.factionKnowledge.get("azure")!.contacts;
    contacts.clear();
    attacker.searchedContacts.clear();
    contacts.set(vehicle.id, {
      targetGroupId: vehicle.id,
      targetFactionId: "ember",
      targetProfile: "platform",
      lastKnown: { x: 14, z: 10 },
      observedAt: internals.state.tick,
      lastDirectTick: -100,
      confidenceBps: 10_000,
      sourceGroupId: "azure-squad-1",
    });
    contacts.set(infantry.id, {
      targetGroupId: infantry.id,
      targetFactionId: "ember",
      targetProfile: "personnel",
      lastKnown: { x: 22, z: 10 },
      observedAt: internals.state.tick,
      lastDirectTick: -100,
      confidenceBps: 9_900,
      sourceGroupId: "azure-squad-1",
    });

    expect(internals.chooseBestKnownContact(attacker)?.targetGroupId).toBe(infantry.id);
    expect((simulation.inspect(attacker.id) as GroupInspection).targetEvaluation).toMatchObject({
      selectedTargetId: infantry.id,
      candidates: [
        { targetGroupId: infantry.id, targetProfile: "personnel", compatible: true },
        { targetGroupId: vehicle.id, targetProfile: "platform", compatible: false, score: 0 },
      ],
    });

    vehicle.cell = { x: 40, z: 30 };
    vehicle.platforms[0]!.disposition = "destroyed";
    infantry.cell = { x: 1, z: 1 };

    expect(internals.chooseBestKnownContact(attacker)?.targetGroupId).toBe(infantry.id);
  });

  it("holds a valid firing position and turns frontal armor toward direct contact", () => {
    const setup = createVehicleDuelSetup({
      kind: "platform-damage",
      penetrationRating: 110,
      componentDamageBps: 4_000,
      crewDamageBps: 8_000,
      externalDamageBps: 1_500,
      attackTags: [],
    });
    const simulation = createSimulation({
      ...setup,
      groups: setup.groups.map((group) =>
        group.id === "azure-vehicle"
          ? { ...group, spawn: { x: 7, z: 10 }, evacuation: { x: 7, z: 10 } }
          : group,
      ),
    });
    primeDirectVehicleDuel(simulation);
    const internals = simulation as unknown as {
      readonly state: {
        readonly groupsById: Map<
          string,
          {
            readonly cell: { x: number; z: number };
            action: string;
            decisionReason: string;
            turnTicksRemaining: number;
            readonly platforms: { facing: number }[];
          }
        >;
      };
      decideForGroup(group: unknown): void;
      advanceMovement(): void;
    };
    const group = internals.state.groupsById.get("ember-vehicle")!;
    const initialCell = { ...group.cell };

    internals.decideForGroup(group);

    expect(group).toMatchObject({
      cell: initialCell,
      action: "moving-to-contact",
      decisionReason: "orient-armor",
    });
    expect(group.turnTicksRemaining).toBeGreaterThan(0);
    expect((simulation.inspect("ember-vehicle") as GroupInspection).vehicleEngagement).toMatchObject({
      targetGroupId: "azure-vehicle",
      reason: "orient-armor",
      selectedCell: initialCell,
      desiredFacing: 2,
    });

    while (group.turnTicksRemaining > 0) {
      internals.advanceMovement();
    }
    internals.decideForGroup(group);

    expect(group.cell).toEqual(initialCell);
    expect(group.platforms[0]?.facing).toBe(2);
    expect(group.action).toBe("engaging");
  });

  it("keeps an in-flight vehicle engagement move through an AI refresh", () => {
    const base = createVehicleDuelSetup({
      kind: "platform-damage",
      penetrationRating: 110,
      componentDamageBps: 4_000,
      crewDamageBps: 8_000,
      externalDamageBps: 1_500,
      attackTags: [],
    });
    const simulation = createSimulation({
      ...base,
      groups: base.groups.map((group) => {
        if (group.id === "ember-vehicle") {
          return {
            ...group,
            platforms: group.platforms.map((platform) => ({ ...platform, initialFacing: 2 })),
          };
        }
        if (group.id === "azure-vehicle") {
          return {
            ...group,
            spawn: { x: 15, z: 10 },
            evacuation: { x: 21, z: 10 },
          };
        }
        return group;
      }),
    });
    primeDirectVehicleDuel(simulation);
    const internals = simulation as unknown as {
      readonly state: {
        readonly groupsById: Map<
          string,
          {
            readonly cell: { x: number; z: number };
            movingTo?: { x: number; z: number };
            moveProgress: number;
            readonly moveCost: number;
            readonly decisionReason: string;
            readonly platforms: readonly unknown[];
          }
        >;
      };
      decideForGroup(group: unknown): void;
      findVehicleEngagementOption(
        group: unknown,
        target: unknown,
        platform: unknown,
      ): { readonly path: readonly { x: number; z: number }[] } | undefined;
      advanceMovement(): void;
    };
    const group = internals.state.groupsById.get("ember-vehicle")!;
    const target = internals.state.groupsById.get("azure-vehicle")!;
    const initialCell = { ...group.cell };

    internals.decideForGroup(group);
    expect(group.decisionReason).toBe("vehicle-engagement-position");
    internals.advanceMovement();
    internals.advanceMovement();

    const inFlightCell = { ...group.movingTo! };
    const progressBeforeRefresh = group.moveProgress;
    expect(progressBeforeRefresh).toBeGreaterThan(0);
    expect(progressBeforeRefresh).toBeLessThan(group.moveCost);
    expect(
      internals.findVehicleEngagementOption(group, target, group.platforms[0])?.path[0],
    ).toEqual(initialCell);

    internals.decideForGroup(group);

    expect(group.movingTo).toEqual(inFlightCell);
    expect(group.moveProgress).toBe(progressBeforeRefresh);

    for (let tick = 0; tick < 30; tick += 1) {
      internals.advanceMovement();
    }

    expect(group.cell).not.toEqual(initialCell);
    expect(group.cell).toEqual(inFlightCell);
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

function createVehicleDuelSetup(
  platformDamage: Extract<
    BattleContentBundle["weaponTemplates"][string]["damageEffects"][number],
    { kind: "platform-damage" }
  >,
): BattleSetup {
  const base = createVehicleSetup("tracked");
  const content = cloneBattleContent(base.content);
  const weapon = content.weaponTemplates[DEFAULT_PLATFORM_WEAPON_TEMPLATE_ID]!;
  const tunedContent: BattleContentBundle = {
    ...content,
    weaponTemplates: {
      ...content.weaponTemplates,
      [weapon.id]: {
        ...weapon,
        magazineSize: 500,
        reloadTicks: 1,
        shotIntervalTicks: 1,
        damageEffects: [
          { kind: "damage", amountBps: 12_000 },
          { kind: "suppression", amountBps: 180 },
          platformDamage,
        ],
      },
    },
  };
  return {
    ...base,
    battleId: "vehicle-damage-duel",
    seed: "vehicle-damage-duel",
    content: tunedContent,
    groups: [createVehicleGroup("tracked"), createAzureVehicleGroup()],
    rules: {
      ...base.rules,
      maximumDurationTicks: 800,
      stalemateTicks: 700,
    },
  };
}

function createAzureVehicleGroup(): GroupSpawn {
  return {
    id: "azure-vehicle",
    factionId: "azure",
    groupTemplateId: DEFAULT_TRACKED_GROUP_TEMPLATE_ID,
    spawn: { x: 9, z: 10 },
    evacuation: { x: 21, z: 10 },
    members: [
      {
        id: "azure-vehicle-driver",
        memberTemplateId: DEFAULT_CREW_MEMBER_TEMPLATE_ID,
      },
      {
        id: "azure-vehicle-gunner",
        memberTemplateId: DEFAULT_GUNNER_MEMBER_TEMPLATE_ID,
      },
      {
        id: "azure-vehicle-relief",
        memberTemplateId: DEFAULT_RELIEF_CREW_MEMBER_TEMPLATE_ID,
      },
    ],
    platforms: [
      {
        id: "azure-vehicle-platform",
        platformTemplateId: DEFAULT_TRACKED_PLATFORM_TEMPLATE_ID,
        initialFacing: 4,
        crewAssignments: [
          { stationId: "driver", memberId: "azure-vehicle-driver" },
          { stationId: "gunner", memberId: "azure-vehicle-gunner" },
          { stationId: "relief", memberId: "azure-vehicle-relief" },
        ],
      },
    ],
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

function setPlatformComponent(
  simulation: ReturnType<typeof createSimulation>,
  platformId: string,
  componentId: string,
  integrityBps: number,
  state: "operational" | "damaged" | "disabled" | "destroyed",
): void {
  const internals = simulation as unknown as {
    readonly state: {
      readonly platformsById: Map<
        string,
        { readonly components: { id: string; integrityBps: number; state: string }[] }
      >;
    };
  };
  const component = internals.state.platformsById
    .get(platformId)!
    .components.find((candidate) => candidate.id === componentId)!;
  component.integrityBps = integrityBps;
  component.state = state;
}

function refreshPlatform(
  simulation: ReturnType<typeof createSimulation>,
  platformId: string,
): void {
  const internals = simulation as unknown as {
    readonly state: { readonly platformsById: Map<string, unknown> };
    refreshPlatformState(platform: unknown, emitEvent: boolean): void;
  };
  internals.refreshPlatformState(internals.state.platformsById.get(platformId), false);
}

function primeDirectVehicleDuel(
  simulation: ReturnType<typeof createSimulation>,
): void {
  const internals = simulation as unknown as {
    readonly state: {
      readonly groupsById: Map<
        string,
        {
          readonly id: string;
          readonly cell: { x: number; z: number };
          action: string;
          currentTargetId?: string;
          readonly localContacts: Map<string, unknown>;
        }
      >;
    };
  };
  for (const [shooterId, targetId] of [
    ["ember-vehicle", "azure-vehicle"],
    ["azure-vehicle", "ember-vehicle"],
  ] as const) {
    const shooter = internals.state.groupsById.get(shooterId)!;
    const target = internals.state.groupsById.get(targetId)!;
    shooter.action = "engaging";
    shooter.currentTargetId = target.id;
    shooter.localContacts.set(target.id, {
      targetGroupId: target.id,
      lastKnown: { ...target.cell },
      observedAt: 0,
      lastDirectTick: 0,
      confidenceBps: 10_000,
      sourceGroupId: shooter.id,
    });
  }
}

function invokeWeaponUpdate(
  simulation: ReturnType<typeof createSimulation>,
): void {
  const internals = simulation as unknown as { updateWeapons(): unknown };
  internals.updateWeapons();
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
    weaponTemplates: Object.fromEntries(
      Object.entries(content.weaponTemplates).map(([id, weapon]) => {
        const mode = weapon.fireModes[0]!;
        const { fireModes: _fireModes, ...legacyWeapon } = weapon;
        return [id, {
          ...legacyWeapon,
          minimumRangeMm: mode.minimumRangeMm,
          optimalRangeMm: mode.optimalRangeMm,
          maximumRangeMm: mode.maximumRangeMm,
          aimTicks: mode.aimTicks,
          trajectory: mode.trajectory,
        }];
      }),
    ),
    sensorTemplates: content.sensorTemplates,
    abilityTemplates: content.abilityTemplates,
    statusTemplates: content.statusTemplates,
    terrainCatalog: content.terrainCatalog,
  };
}
