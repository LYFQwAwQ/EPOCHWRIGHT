import { describe, expect, it } from "vitest";
import { createDemoBattleSetup } from "../demo/setup";
import {
  BATTLE_CONTENT_VERSION,
  BATTLE_RULES_VERSION,
  BATTLE_SETUP_SCHEMA_VERSION,
  DEFAULT_ARTILLERY_GROUP_TEMPLATE_ID,
  DEFAULT_ARTILLERY_PLATFORM_TEMPLATE_ID,
  DEFAULT_ARTILLERY_WEAPON_TEMPLATE_ID,
  DEFAULT_CREW_MEMBER_TEMPLATE_ID,
  DEFAULT_GUNNER_MEMBER_TEMPLATE_ID,
  DEFAULT_GROUP_TEMPLATE_ID,
  DEFAULT_MEMBER_TEMPLATE_ID,
  DEFAULT_RELIEF_CREW_MEMBER_TEMPLATE_ID,
  PRE_ARTILLERY_BATTLE_RULES_VERSION,
  PRE_ARTILLERY_BATTLE_SETUP_SCHEMA_VERSION,
  cloneBattleContent,
  createDefaultBattleContent,
  createSimulation,
  migrateBattleSetup,
  validateBattleContent,
  validateBattleSetup,
} from "./index";
import type {
  BattleContentBundle,
  BattleSetup,
  BattleSetupInput,
  GroupSpawn,
  PlatformDeploymentState,
  PreArtilleryBattleContentBundle,
} from "./types";

describe("artillery content contract", () => {
  it("migrates content-2 range fields into one equivalent direct fire mode", () => {
    const current = createDemoBattleSetup({
      seed: "artillery-content-migration",
      groupsPerFaction: 1,
    });
    const preArtilleryContent = downgradeToContent2(current.content);
    const oldRifle = preArtilleryContent.weaponTemplates["rifle-standard-v1"]!;

    const migrated = migrateBattleSetup({
      ...current,
      schemaVersion: PRE_ARTILLERY_BATTLE_SETUP_SCHEMA_VERSION,
      rulesVersion: PRE_ARTILLERY_BATTLE_RULES_VERSION,
      content: preArtilleryContent,
    } satisfies BattleSetupInput);

    const rifle = migrated.content.weaponTemplates[oldRifle.id]!;
    expect(migrated.schemaVersion).toBe(BATTLE_SETUP_SCHEMA_VERSION);
    expect(migrated.rulesVersion).toBe(BATTLE_RULES_VERSION);
    expect(migrated.content.contentVersion).toBe(BATTLE_CONTENT_VERSION);
    expect(rifle.fireModes).toEqual([
      {
        id: "direct",
        targeting: "direct",
        trajectory: "resolved",
        minimumRangeMm: oldRifle.minimumRangeMm,
        optimalRangeMm: oldRifle.optimalRangeMm,
        maximumRangeMm: oldRifle.maximumRangeMm,
        aimTicks: oldRifle.aimTicks,
        requiresDeployedPlatform: false,
      },
    ]);
    expect(() => validateBattleSetup(migrated)).not.toThrow();
  });

  it("provides a validated self-propelled artillery group behind explicit deployment capability", () => {
    const content = createDefaultBattleContent();
    const group = content.groupTemplates[DEFAULT_ARTILLERY_GROUP_TEMPLATE_ID]!;
    const platform = content.platformTemplates[DEFAULT_ARTILLERY_PLATFORM_TEMPLATE_ID]!;
    const weapon = content.weaponTemplates[DEFAULT_ARTILLERY_WEAPON_TEMPLATE_ID]!;

    expect(group.platformSlotRules).toEqual([
      expect.objectContaining({ platformTemplateId: platform.id, count: 1 }),
    ]);
    expect(platform.deploymentRule).toEqual({
      deployTicks: 20,
      packTicks: 16,
      requiredStationIds: ["gunner"],
      requiredComponentIds: ["primary-weapon"],
    });
    expect(weapon.fireModes).toEqual([
      expect.objectContaining({
        id: "direct",
        targeting: "direct",
        trajectory: "resolved",
        requiresDeployedPlatform: true,
      }),
    ]);
    expect(() => validateBattleContent(content)).not.toThrow();
  });

  it("rejects premature projectile modes and invalid deployment references", () => {
    const projectileBase = cloneBattleContent(createDefaultBattleContent());
    const artilleryWeapon = projectileBase.weaponTemplates[DEFAULT_ARTILLERY_WEAPON_TEMPLATE_ID]!;
    const projectileContent: BattleContentBundle = {
      ...projectileBase,
      weaponTemplates: {
        ...projectileBase.weaponTemplates,
        [artilleryWeapon.id]: {
          ...artilleryWeapon,
          fireModes: [
            {
              ...artilleryWeapon.fireModes[0]!,
              trajectory: "logical-projectile",
              projectileSpeedMmPerTick: 1_000,
              muzzleHeightMm: 2_000,
              apexHeightMm: 8_000,
              blastRadiusMm: 4_000,
              visualTypeId: "shell-test",
            },
          ],
        },
      },
    };
    expect(() => validateBattleContent(projectileContent)).toThrow(/not supported/i);

    const invalidDeploymentBase = cloneBattleContent(createDefaultBattleContent());
    const platform = invalidDeploymentBase.platformTemplates[DEFAULT_ARTILLERY_PLATFORM_TEMPLATE_ID]!;
    const invalidDeployment: BattleContentBundle = {
      ...invalidDeploymentBase,
      platformTemplates: {
        ...invalidDeploymentBase.platformTemplates,
        [platform.id]: {
          ...platform,
          deploymentRule: {
            ...platform.deploymentRule!,
            requiredStationIds: ["missing-station"],
          },
        },
      },
    };
    expect(() => validateBattleContent(invalidDeployment)).toThrow(/deployment/i);

    const invalidMemberWeaponBase = cloneBattleContent(createDefaultBattleContent());
    const rifle = invalidMemberWeaponBase.weaponTemplates["rifle-standard-v1"]!;
    const invalidMemberWeapon: BattleContentBundle = {
      ...invalidMemberWeaponBase,
      weaponTemplates: {
        ...invalidMemberWeaponBase.weaponTemplates,
        [rifle.id]: {
          ...rifle,
          fireModes: rifle.fireModes.map((mode) => ({
            ...mode,
            requiresDeployedPlatform: true,
          })),
        },
      },
    };
    expect(() => validateBattleContent(invalidMemberWeapon)).toThrow(/member weapon/i);
  });
});

describe("artillery-deploy-001", () => {
  it("deploys before firing and reproduces deployment state tick by tick", () => {
    const first = createSimulation(createArtillerySetup());
    const second = createSimulation(createArtillerySetup());
    const firstEvents: ReturnType<typeof first.drainEvents>[number][] = [];

    expect(first.inspect("ember-artillery-platform", "ember")).toMatchObject({
      artillery: { deployment: "packed", deploymentTicksRemaining: 0 },
    });

    let deployed = false;
    for (let tick = 0; tick < 60; tick += 1) {
      first.step();
      second.step();
      expect(first.getStateHash(), `deployment hash at tick ${tick + 1}`).toBe(
        second.getStateHash(),
      );
      const firstTickEvents = first.drainEvents();
      const secondTickEvents = second.drainEvents();
      firstEvents.push(...firstTickEvents);
      expect(secondTickEvents).toEqual(firstTickEvents);
      const inspection = first.inspect("ember-artillery-platform", "ember");
      deployed =
        inspection?.kind === "platform" &&
        inspection.artillery?.deployment === "deployed";
      if (!deployed) {
        expect(
          firstTickEvents.some(
            (event) => event.type === "weapon-fired" && event.groupId === "ember-artillery",
          ),
        ).toBe(false);
      }
      if (deployed) {
        break;
      }
    }

    expect(deployed).toBe(true);
    expect(first.inspect("ember-artillery-platform", "ember")).toMatchObject({
      artillery: { deployment: "deployed", deploymentTicksRemaining: 0 },
    });
    expect(firstEvents).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "platform-deployment-changed",
        platformId: "ember-artillery-platform",
        from: "packed",
        to: "deploying",
        phase: "started",
      }),
      expect.objectContaining({
        type: "platform-deployment-changed",
        platformId: "ember-artillery-platform",
        from: "deploying",
        to: "deployed",
        phase: "completed",
      }),
      expect.objectContaining({
        type: "weapon-fired",
        groupId: "ember-artillery",
      }),
    ]));
    const deploymentStarted = firstEvents.find(
      (event) => event.type === "platform-deployment-changed" && event.phase === "started",
    );
    const deploymentCompleted = firstEvents.find(
      (event) => event.type === "platform-deployment-changed" && event.phase === "completed",
    );
    expect(deploymentCompleted!.tick - deploymentStarted!.tick).toBe(20);
  });

  it("projects artillery counters into the frozen battle result", () => {
    const simulation = createSimulation(createArtillerySetup());

    simulation.step(300);

    expect(simulation.status).toBe("finished");
    expect(simulation.getResult()?.settlement).toEqual({
      triggeredAt: simulation.tick,
      completedAt: simulation.tick,
      projectileCountAtTrigger: 0,
    });
    expect(simulation.getResult()?.platforms).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "ember-artillery-platform",
        artillery: expect.objectContaining({
          finalDeploymentState: expect.stringMatching(/^(packed|deploying|deployed|packing)$/),
          directRoundsFired: expect.any(Number),
          indirectRoundsFired: 0,
          missionsAssigned: 0,
        }),
      }),
    ]));
    const artillery = simulation.getResult()?.platforms.find(
      (platform) => platform.id === "ember-artillery-platform",
    )?.artillery;
    expect(artillery?.directRoundsFired).toBeGreaterThan(0);
    const frozenHash = simulation.getStateHash();
    const frozenResult = simulation.getResult();
    simulation.drainEvents();

    simulation.step(20);

    expect(simulation.getStateHash()).toBe(frozenHash);
    expect(simulation.getResult()).toEqual(frozenResult);
    expect(simulation.drainEvents()).toEqual([]);
  });

  it("packs before starting a requested move", () => {
    const simulation = createSimulation(createArtillerySetup());
    const internals = artilleryInternals(simulation);
    const group = internals.state.groupsById.get("ember-artillery")!;
    const platform = internals.state.platformsById.get("ember-artillery-platform")!;
    platform.deployment!.state = "deployed";
    group.path = [{ x: 5, z: 10 }];
    group.action = "moving-to-contact";

    internals.updatePlatformDeployments();
    internals.advanceMovement();
    expect(platform.deployment).toMatchObject({ state: "packing", ticksRemaining: 16 });
    expect(group.movingTo).toBeUndefined();

    for (let tick = 0; tick < 16; tick += 1) {
      internals.updatePlatformDeployments();
      internals.advanceMovement();
    }

    expect(platform.deployment).toMatchObject({ state: "packed", ticksRemaining: 0 });
    expect(group.movingTo).toEqual({ x: 5, z: 10 });
  });

  it("cancels deployment when a required station becomes unavailable", () => {
    const simulation = createSimulation(createArtillerySetup());
    for (let tick = 0; tick < 20; tick += 1) {
      simulation.step();
      const inspection = simulation.inspect("ember-artillery-platform", "ember");
      if (inspection?.kind === "platform" && inspection.artillery?.deployment === "deploying") {
        break;
      }
    }
    simulation.drainEvents();
    artilleryInternals(simulation).state.membersById.get("ember-artillery-gunner")!.health =
      "incapacitated";
    artilleryInternals(simulation).state.membersById.get("ember-artillery-relief")!.health =
      "incapacitated";

    simulation.step();

    expect(simulation.inspect("ember-artillery-platform", "ember")).toMatchObject({
      artillery: { deployment: "packed", deploymentTicksRemaining: 0 },
    });
    expect(simulation.drainEvents()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "platform-deployment-changed",
        platformId: "ember-artillery-platform",
        from: "deploying",
        to: "packed",
        phase: "cancelled",
        reason: "capability-lost",
      }),
    ]));
  });
});

function createArtillerySetup(): BattleSetup {
  const base = createDemoBattleSetup({
    seed: "artillery-deploy-001",
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
    battleId: "artillery-deploy-001",
    groups: [createArtilleryGroup(), createTargetGroup()],
    rules: {
      ...base.rules,
      maximumDurationTicks: 300,
      stalemateTicks: 250,
    },
  };
}

function createArtilleryGroup(): GroupSpawn {
  return {
    id: "ember-artillery",
    factionId: "ember",
    groupTemplateId: DEFAULT_ARTILLERY_GROUP_TEMPLATE_ID,
    spawn: { x: 4, z: 10 },
    evacuation: { x: 1, z: 10 },
    members: [
      { id: "ember-artillery-driver", memberTemplateId: DEFAULT_CREW_MEMBER_TEMPLATE_ID },
      { id: "ember-artillery-gunner", memberTemplateId: DEFAULT_GUNNER_MEMBER_TEMPLATE_ID },
      { id: "ember-artillery-relief", memberTemplateId: DEFAULT_RELIEF_CREW_MEMBER_TEMPLATE_ID },
    ],
    platforms: [
      {
        id: "ember-artillery-platform",
        platformTemplateId: DEFAULT_ARTILLERY_PLATFORM_TEMPLATE_ID,
        initialFacing: 2,
        crewAssignments: [
          { stationId: "driver", memberId: "ember-artillery-driver" },
          { stationId: "gunner", memberId: "ember-artillery-gunner" },
          { stationId: "relief", memberId: "ember-artillery-relief" },
        ],
      },
    ],
  };
}

function createTargetGroup(): GroupSpawn {
  return {
    id: "azure-target",
    factionId: "azure",
    groupTemplateId: DEFAULT_GROUP_TEMPLATE_ID,
    spawn: { x: 10, z: 10 },
    evacuation: { x: 22, z: 10 },
    members: Array.from({ length: 8 }, (_, index) => ({
      id: `azure-target-member-${index + 1}`,
      memberTemplateId: DEFAULT_MEMBER_TEMPLATE_ID,
    })),
    platforms: [],
  };
}

function downgradeToContent2(content: BattleContentBundle): PreArtilleryBattleContentBundle {
  const groupTemplates = Object.fromEntries(
    Object.entries(content.groupTemplates).filter(
      ([id]) => id !== DEFAULT_ARTILLERY_GROUP_TEMPLATE_ID,
    ),
  );
  const platformTemplates = Object.fromEntries(
    Object.entries(content.platformTemplates)
      .filter(([id]) => id !== DEFAULT_ARTILLERY_PLATFORM_TEMPLATE_ID)
      .map(([id, template]) => {
        const { deploymentRule: _deploymentRule, ...legacyTemplate } = template;
        return [id, legacyTemplate];
      }),
  );
  const weaponTemplates = Object.fromEntries(
    Object.entries(content.weaponTemplates)
      .filter(([id]) => id !== DEFAULT_ARTILLERY_WEAPON_TEMPLATE_ID)
      .map(([id, weapon]) => {
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
  );
  const eraTemplates = Object.fromEntries(
    Object.entries(content.eraTemplates).map(([id, era]) => [id, {
      ...era,
      allowedGroupTemplateIds: era.allowedGroupTemplateIds.filter(
        (templateId) => templateId !== DEFAULT_ARTILLERY_GROUP_TEMPLATE_ID,
      ),
      allowedPlatformTemplateIds: era.allowedPlatformTemplateIds.filter(
        (templateId) => templateId !== DEFAULT_ARTILLERY_PLATFORM_TEMPLATE_ID,
      ),
      allowedWeaponTemplateIds: era.allowedWeaponTemplateIds.filter(
        (templateId) => templateId !== DEFAULT_ARTILLERY_WEAPON_TEMPLATE_ID,
      ),
    }]),
  );
  return {
    ...content,
    contentVersion: "content-2",
    eraTemplates,
    groupTemplates,
    platformTemplates,
    weaponTemplates,
  } as PreArtilleryBattleContentBundle;
}

function artilleryInternals(simulation: ReturnType<typeof createSimulation>) {
  return simulation as unknown as {
    readonly state: {
      readonly groupsById: Map<string, {
        action: string;
        path: { x: number; z: number }[];
        movingTo?: { x: number; z: number };
      }>;
      readonly platformsById: Map<string, {
        deployment?: {
          state: PlatformDeploymentState;
          ticksRemaining: number;
        };
      }>;
      readonly membersById: Map<string, { health: string }>;
    };
    updatePlatformDeployments(): void;
    advanceMovement(): void;
  };
}
