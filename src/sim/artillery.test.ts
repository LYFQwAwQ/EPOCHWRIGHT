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
  PRE_PROJECTILE_BATTLE_RULES_VERSION,
  STATIC_OBJECT_DEFINITIONS,
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
  WeaponFireModeDefinition,
} from "./types";
import {
  firstProjectileCollision,
  projectileFlightTicks,
  projectilePositionAtElapsed,
} from "./artillery";

describe("artillery trajectory rules", () => {
  it("uses integer flight timing, fixed arc sampling, and first-cell static collision", () => {
    const map = createArtillerySetup().map;
    expect(projectileFlightTicks({ x: 0, z: 0 }, { x: 3, z: 4 }, 4_000, 5_000)).toBe(4);
    const midpoint = projectilePositionAtElapsed(
      map,
      { x: 4, z: 10 },
      { x: 8, z: 10 },
      2_000,
      8_000,
      4,
      2,
    );
    const originHeightMm =
      map.layers.heightUnits[10 * map.width + 4]! * map.heightUnitMm + 2_000;
    const targetHeightMm = map.layers.heightUnits[10 * map.width + 8]! * map.heightUnitMm;
    expect(midpoint).toEqual({
      xMm: 26_000,
      zMm: 42_000,
      heightMm: originHeightMm + Math.trunc((targetHeightMm - originHeightMm) / 2) + 8_000,
    });

    const staticOccupancy = new Uint8Array(map.layers.staticOccupancy);
    const heightUnits = new Int16Array(map.layers.heightUnits.length);
    staticOccupancy[10 * map.width + 6] = STATIC_OBJECT_DEFINITIONS.wall.typeId;
    const collisionMap = {
      ...map,
      layers: { ...map.layers, heightUnits, staticOccupancy },
    };
    expect(firstProjectileCollision(
      collisionMap,
      { xMm: 18_000, zMm: 42_000, heightMm: 2_000 },
      { xMm: 34_000, zMm: 42_000, heightMm: 2_000 },
    )).toEqual({ x: 6, z: 10 });
  });
});

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

  it("migrates the deployment-only rules contract to stage-3.7", () => {
    const current = createArtillerySetup();
    const migrated = migrateBattleSetup({
      ...current,
      rulesVersion: PRE_PROJECTILE_BATTLE_RULES_VERSION,
    });

    expect(migrated.rulesVersion).toBe(BATTLE_RULES_VERSION);
    expect(() => validateBattleSetup(migrated)).not.toThrow();
  });

  it("rejects map scales that exceed logical projectile arithmetic bounds", () => {
    const setup = createArtillerySetup();
    expect(() => validateBattleSetup({
      ...setup,
      map: { ...setup.map, cellSizeMm: 1_000_000_000 },
    })).toThrow(/projectile arithmetic bounds/i);
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
        trajectory: "logical-projectile",
        requiresDeployedPlatform: true,
        projectileSpeedMmPerTick: expect.any(Number),
        blastRadiusMm: expect.any(Number),
      }),
    ]);
    expect(() => validateBattleContent(content)).not.toThrow();
  });

  it("accepts direct logical projectiles but rejects indirect fire and invalid deployment references", () => {
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
    expect(() => validateBattleContent(projectileContent)).not.toThrow();

    const indirectMode = projectileContent.weaponTemplates[artilleryWeapon.id]!.fireModes[0]!;
    if (indirectMode.trajectory !== "logical-projectile") {
      throw new Error("Expected a logical projectile mode.");
    }
    const indirectContent: BattleContentBundle = {
      ...projectileContent,
      weaponTemplates: {
        ...projectileContent.weaponTemplates,
        [artilleryWeapon.id]: {
          ...projectileContent.weaponTemplates[artilleryWeapon.id]!,
          fireModes: [{
            ...indirectMode,
            targeting: "indirect",
            uncertainty: {
              baseScatterMm: 0,
              ageScatterMmPerSecond: 0,
              sameFactionRelayPenaltyMm: 0,
              alliedRelayPenaltyMm: 0,
              zeroConfidencePenaltyMm: 0,
              maximumScatterMm: 0,
              maximumContactAgeTicks: 20,
            },
          } satisfies WeaponFireModeDefinition],
        },
      },
    };
    expect(() => validateBattleContent(indirectContent)).toThrow(/not supported/i);

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

describe("artillery-direct-002", () => {
  it("launches no earlier than direct contact and keeps the shell after the firing platform fails", () => {
    const simulation = createSimulation(createArtillerySetup());
    let firedEvent: Extract<ReturnType<typeof simulation.drainEvents>[number], {
      type: "weapon-fired";
    }> | undefined;

    for (let tick = 0; tick < 80 && !firedEvent; tick += 1) {
      simulation.step();
      const events = simulation.drainEvents();
      firedEvent = events.find(
        (event): event is Extract<typeof event, { type: "weapon-fired" }> =>
          event.type === "weapon-fired" && event.groupId === "ember-artillery",
      );
      if (firedEvent) {
        expect(firedEvent.fireModeId).toBe("direct");
        expect(firedEvent.projectileIds).toHaveLength(1);
        expect(events.some((event) => event.type === "projectile-impacted")).toBe(false);
        expect(artilleryInternals(simulation).state.projectiles).toHaveLength(1);
        expect(targetHealthStates(simulation)).toEqual(Array(8).fill("healthy"));
      }
    }

    expect(firedEvent).toBeDefined();
    const launchedAt = firedEvent!.tick;
    const internals = artilleryInternals(simulation);
    internals.state.membersById.get("ember-artillery-driver")!.health = "incapacitated";
    internals.state.membersById.get("ember-artillery-gunner")!.health = "incapacitated";
    internals.state.membersById.get("ember-artillery-relief")!.health = "incapacitated";

    let impactEvent: Extract<ReturnType<typeof simulation.drainEvents>[number], {
      type: "projectile-impacted";
    }> | undefined;
    for (let tick = 0; tick < 20 && !impactEvent; tick += 1) {
      simulation.step();
      impactEvent = simulation.drainEvents().find(
        (event): event is Extract<typeof event, { type: "projectile-impacted" }> =>
          event.type === "projectile-impacted",
      );
    }

    expect(impactEvent).toMatchObject({
      sourceGroupId: "ember-artillery",
      sourcePlatformId: "ember-artillery-platform",
      affectedGroupIds: ["azure-target"],
    });
    expect(impactEvent!.tick).toBeGreaterThan(launchedAt);
    expect(artilleryInternals(simulation).state.projectiles).toHaveLength(0);
    expect(targetHealthStates(simulation).some((health) => health !== "healthy")).toBe(true);
  });
});

describe("artillery-impact-005", () => {
  it("collects same-tick direct fire before stable hostile-only blast damage", () => {
    const base = createArtillerySetup();
    const content = cloneBattleContent(base.content);
    const rifle = content.weaponTemplates["rifle-standard-v1"]!;
    const howitzer = content.weaponTemplates[DEFAULT_ARTILLERY_WEAPON_TEMPLATE_ID]!;
    const setup: BattleSetup = {
      ...base,
      content: {
        ...content,
        weaponTemplates: {
          ...content.weaponTemplates,
          [rifle.id]: { ...rifle, shotIntervalTicks: 1 },
          [howitzer.id]: {
            ...howitzer,
            damageEffects: howitzer.damageEffects.map((effect) =>
              effect.kind === "damage" ? { ...effect, amountBps: 20_000 } : effect,
            ),
          },
        },
      },
      groups: [createArtilleryGroup(), createTargetGroup(), createFriendlyGroup()],
    };
    const simulation = createSimulation(setup);
    const first = createSimulation(setup);
    let simultaneousTick: number | undefined;
    let affectedGroupIds: readonly string[] | undefined;

    for (let tick = 0; tick < 100 && simultaneousTick === undefined; tick += 1) {
      const forceImpact = prepareAzureDirectFireOnNextImpact(simulation);
      expect(prepareAzureDirectFireOnNextImpact(first)).toBe(forceImpact);
      if (forceImpact) {
        resolvePreparedImpact(simulation);
        resolvePreparedImpact(first);
      } else {
        simulation.step();
        first.step();
      }
      expect(simulation.getStateHash()).toBe(first.getStateHash());
      const events = simulation.drainEvents();
      expect(first.drainEvents()).toEqual(events);
      const impact = events.find((event) => event.type === "projectile-impacted");
      if (!impact) {
        continue;
      }
      expect(
        events.some(
          (event) => event.type === "weapon-fired" && event.groupId === "azure-target",
        ),
      ).toBe(true);
      expect(
        events.findIndex((event) => event.type === "weapon-fired")
      ).toBeLessThan(events.findIndex((event) => event.type === "projectile-impacted"));
      simultaneousTick = impact.tick;
      affectedGroupIds = impact.affectedGroupIds;
    }

    expect(simultaneousTick).toBeDefined();
    expect(affectedGroupIds).toEqual(["azure-target"]);
  });
});

describe("artillery-finish-006", () => {
  it("settles pre-cutoff shells without allowing new fire and freezes with no projectile residue", () => {
    const base = createArtillerySetup();
    const content = cloneBattleContent(base.content);
    const howitzer = content.weaponTemplates[DEFAULT_ARTILLERY_WEAPON_TEMPLATE_ID]!;
    const directMode = howitzer.fireModes[0]!;
    if (directMode.trajectory !== "logical-projectile") {
      throw new Error("Expected the default howitzer to use a logical projectile.");
    }
    const maximumDurationTicks = 45;
    const simulation = createSimulation({
      ...base,
      content: {
        ...content,
        weaponTemplates: {
          ...content.weaponTemplates,
          [howitzer.id]: {
            ...howitzer,
            fireModes: [{ ...directMode, projectileSpeedMmPerTick: 1_000 }],
          },
        },
      },
      rules: {
        ...base.rules,
        maximumDurationTicks,
        stalemateTicks: 500,
      },
    });

    simulation.step(200);
    const result = simulation.getResult();
    const events = simulation.drainEvents();

    expect(result?.terminationReason).toBe("maximum-duration");
    expect(result?.settlement.triggeredAt).toBe(maximumDurationTicks);
    expect(result?.settlement.completedAt).toBeGreaterThan(maximumDurationTicks);
    expect(result?.settlement.projectileCountAtTrigger).toBeGreaterThan(0);
    expect(result?.finalTick).toBe(result?.settlement.completedAt);
    expect(artilleryInternals(simulation).state.projectiles).toEqual([]);
    expect(
      events.some(
        (event) => event.type === "weapon-fired" && event.tick >= maximumDurationTicks,
      ),
    ).toBe(false);
    expect(events.filter((event) => event.type === "battle-ended")).toHaveLength(1);
    const frozenHash = simulation.getStateHash();
    const frozenResult = simulation.getResult();
    simulation.step(20);
    expect(simulation.getStateHash()).toBe(frozenHash);
    expect(simulation.getResult()).toEqual(frozenResult);
    expect(simulation.drainEvents()).toEqual([]);
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

function createFriendlyGroup(): GroupSpawn {
  return {
    id: "ember-friendly",
    factionId: "ember",
    groupTemplateId: DEFAULT_GROUP_TEMPLATE_ID,
    spawn: { x: 12, z: 10 },
    evacuation: { x: 1, z: 11 },
    members: Array.from({ length: 8 }, (_, index) => ({
      id: `ember-friendly-member-${index + 1}`,
      memberTemplateId: DEFAULT_MEMBER_TEMPLATE_ID,
    })),
    platforms: [],
  };
}

function targetHealthStates(
  simulation: ReturnType<typeof createSimulation>,
): string[] {
  return Array.from({ length: 8 }, (_, index) =>
    simulation.inspect(`azure-target-member-${index + 1}`, "azure"),
  ).map((inspection) => inspection?.kind === "member" ? inspection.health : "missing");
}

function prepareAzureDirectFireOnNextImpact(
  simulation: ReturnType<typeof createSimulation>,
): boolean {
  const internals = artilleryInternals(simulation);
  if (!internals.state.projectiles.some(
    (projectile) => projectile.totalFlightTicks - projectile.flightTicksElapsed === 1,
  )) {
    return false;
  }
  const shooter = internals.state.groupsById.get("azure-target")!;
  const target = internals.state.groupsById.get("ember-friendly")!;
  shooter.cell.x = 10;
  shooter.cell.z = 9;
  target.cell.x = 12;
  target.cell.z = 9;
  shooter.action = "engaging";
  shooter.currentTargetId = target.id;
  shooter.lastDecisionTick = internals.state.tick;
  for (const member of shooter.members) {
    member.health = "healthy";
    member.placement = { kind: "dismounted" };
    member.magazineRounds = Math.max(1, member.magazineRounds);
    member.reloadTicksRemaining = 0;
    member.shotCooldownTicks = 0;
  }
  shooter.localContacts.set(target.id, {
    targetGroupId: target.id,
    targetFactionId: "ember",
    targetProfile: "personnel",
    lastKnown: { ...target.cell },
    observedAt: internals.state.tick,
    lastDirectTick: internals.state.tick,
    confidenceBps: 10_000,
    sourceGroupId: shooter.id,
  });
  return true;
}

function resolvePreparedImpact(
  simulation: ReturnType<typeof createSimulation>,
): void {
  const internals = artilleryInternals(simulation);
  internals.updateWeapons(internals.advanceLogicalProjectiles(), true);
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
        readonly id: string;
        readonly cell: { x: number; z: number };
        action: string;
        currentTargetId?: string;
        lastDecisionTick: number;
        readonly localContacts: Map<string, {
          targetGroupId: string;
          targetFactionId: string;
          targetProfile: "personnel" | "platform";
          lastKnown: { x: number; z: number };
          observedAt: number;
          lastDirectTick: number;
          confidenceBps: number;
          sourceGroupId: string;
        }>;
        readonly members: {
          health: string;
          placement: { kind: string };
          magazineRounds: number;
          reloadTicksRemaining: number;
          shotCooldownTicks: number;
        }[];
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
      readonly projectiles: readonly {
        readonly id: string;
        readonly totalFlightTicks: number;
        readonly flightTicksElapsed: number;
      }[];
      readonly tick: number;
    };
    updatePlatformDeployments(): void;
    advanceMovement(): void;
    advanceLogicalProjectiles(): readonly unknown[];
    updateWeapons(projectileImpacts: readonly unknown[], allowFiring: boolean): unknown;
  };
}
