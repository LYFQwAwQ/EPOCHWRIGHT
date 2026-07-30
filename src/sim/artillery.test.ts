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
  PRE_INDIRECT_BATTLE_RULES_VERSION,
  PRE_ARTILLERY_BATTLE_RULES_VERSION,
  PRE_ARTILLERY_BATTLE_SETUP_SCHEMA_VERSION,
  STATIC_OBJECT_DEFINITIONS,
  cloneBattleContent,
  createDefaultBattleContent,
  createSimulation,
  defaultRelation,
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
  artilleryScatterCandidates,
  calculateArtilleryUncertainty,
  firstProjectileCollision,
  projectileFlightTicks,
  projectilePositionAtElapsed,
  supercoverCellsBetween,
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

  it("stops an axis that already reached its end cell at an exact grid boundary", () => {
    const map = createArtillerySetup().map;

    expect(supercoverCellsBetween(
      map,
      { xMm: 74_000, zMm: 62_000, heightMm: 6_000 },
      { xMm: 80_000, zMm: 60_000, heightMm: 14_500 },
    )).toEqual([
      { x: 18, z: 15 },
      { x: 19, z: 15 },
      { x: 20, z: 15 },
    ]);
  });

  it("derives source-aware uncertainty and stable in-bounds scatter candidates", () => {
    const rule = {
      baseScatterMm: 4_000,
      ageScatterMmPerSecond: 1_000,
      sameFactionRelayPenaltyMm: 2_000,
      alliedRelayPenaltyMm: 6_000,
      zeroConfidencePenaltyMm: 12_000,
      maximumScatterMm: 40_000,
      maximumContactAgeTicks: 200,
    };
    expect(calculateArtilleryUncertainty(rule, "local-direct", 100, 60, 7_500)).toEqual({
      ageTicks: 40,
      baseScatterMm: 4_000,
      ageScatterMm: 2_000,
      relayPenaltyMm: 0,
      confidencePenaltyMm: 3_000,
      radiusMm: 9_000,
    });
    expect(calculateArtilleryUncertainty(rule, "same-faction", 100, 60, 7_500).radiusMm)
      .toBe(11_000);
    expect(calculateArtilleryUncertainty(rule, "allied", 100, 60, 7_500).radiusMm)
      .toBe(15_000);

    const map = createArtillerySetup().map;
    expect(artilleryScatterCandidates(map, { x: 10, z: 10 }, 4_000)).toEqual([
      { cell: { x: 10, z: 10 }, offset: { dx: 0, dz: 0 }, distanceSquared: 0 },
      { cell: { x: 10, z: 9 }, offset: { dx: 0, dz: -1 }, distanceSquared: 1 },
      { cell: { x: 9, z: 10 }, offset: { dx: -1, dz: 0 }, distanceSquared: 1 },
      { cell: { x: 11, z: 10 }, offset: { dx: 1, dz: 0 }, distanceSquared: 1 },
      { cell: { x: 10, z: 11 }, offset: { dx: 0, dz: 1 }, distanceSquared: 1 },
    ]);
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

  it("migrates the direct-projectile rules contract to stage-3.8", () => {
    const current = createArtillerySetup();
    const migrated = migrateBattleSetup({
      ...current,
      rulesVersion: PRE_INDIRECT_BATTLE_RULES_VERSION,
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

  it("accepts the maximum supported map scale with the default artillery content", () => {
    expect(() => createDemoBattleSetup({
      seed: "artillery-maximum-map-bounds",
      width: 512,
      height: 512,
      groupsPerFaction: 1,
      mountainDensity: 0,
      roughness: 0,
      waterCoverage: 0,
      wetlandCoverage: 0,
      treeCoverage: 0,
      rockCoverage: 0,
      wallCoverage: 0,
    })).not.toThrow();
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
    expect(weapon.fireModes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "direct",
        targeting: "direct",
        trajectory: "logical-projectile",
        requiresDeployedPlatform: true,
        projectileSpeedMmPerTick: expect.any(Number),
        blastRadiusMm: expect.any(Number),
      }),
      expect.objectContaining({
        id: "indirect",
        targeting: "indirect",
        trajectory: "logical-projectile",
        requiresDeployedPlatform: true,
        uncertainty: expect.objectContaining({ maximumContactAgeTicks: expect.any(Number) }),
      }),
    ]));
    expect(() => validateBattleContent(content)).not.toThrow();
  });

  it("accepts indirect logical fire but rejects invalid uncertainty and deployment references", () => {
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
    expect(() => validateBattleContent(indirectContent)).not.toThrow();

    const invalidUncertainty: BattleContentBundle = {
      ...indirectContent,
      weaponTemplates: {
        ...indirectContent.weaponTemplates,
        [artilleryWeapon.id]: {
          ...indirectContent.weaponTemplates[artilleryWeapon.id]!,
          fireModes: [{
            ...(indirectContent.weaponTemplates[artilleryWeapon.id]!.fireModes[0] as Extract<
              WeaponFireModeDefinition,
              { targeting: "indirect" }
            >),
            uncertainty: {
              ...(indirectContent.weaponTemplates[artilleryWeapon.id]!.fireModes[0] as Extract<
                WeaponFireModeDefinition,
                { targeting: "indirect" }
              >).uncertainty,
              maximumContactAgeTicks: 0,
            },
          }],
        },
      },
    };
    expect(() => validateBattleContent(invalidUncertainty)).toThrow(/uncertainty/i);

    const invalidUndeployedIndirect: BattleContentBundle = {
      ...indirectContent,
      weaponTemplates: {
        ...indirectContent.weaponTemplates,
        [artilleryWeapon.id]: {
          ...indirectContent.weaponTemplates[artilleryWeapon.id]!,
          fireModes: indirectContent.weaponTemplates[artilleryWeapon.id]!.fireModes.map(
            (mode) => ({ ...mode, requiresDeployedPlatform: false }),
          ),
        },
      },
    };
    expect(() => validateBattleContent(invalidUndeployedIndirect)).toThrow(/not supported/i);

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

describe("artillery-intel-003", () => {
  it("preserves same-faction source and delivery tick through the intel queue", () => {
    const base = createIndirectArtillerySetup();
    const simulation = createSimulation({
      ...base,
      battleId: "artillery-intel-relay",
      groups: [...base.groups, createObserverGroup()],
    });
    const observer = artilleryInternals(simulation).state.groupsById.get("ember-observer")!;
    for (const member of observer.members) {
      member.shotCooldownTicks = 1_000;
    }
    let deliveredAt: number | undefined;
    let mission: {
      readonly source: string;
      readonly observedAt: number;
      readonly deliveredAt: number;
    } | undefined;

    for (let tick = 0; tick < 80 && !mission; tick += 1) {
      simulation.step();
      const events = simulation.drainEvents();
      deliveredAt ??= events.find(
        (event) =>
          event.type === "intel-delivered" &&
          event.factionId === "ember" &&
          event.targetGroupId === "azure-target",
      )?.tick;
      const inspection = simulation.inspect("ember-artillery-platform", "ember");
      if (inspection?.kind === "platform" && inspection.artillery?.mission) {
        mission = inspection.artillery.mission;
      }
    }

    expect(deliveredAt).toBeDefined();
    expect(mission).toMatchObject({
      source: "same-faction",
      deliveredAt,
    });
    expect(mission!.deliveredAt).toBeGreaterThan(mission!.observedAt);
  });

  it("binds delivered intel to one deterministic indirect mission and freezes the snapshot", () => {
    const setup = createIndirectArtillerySetup();
    const simulation = createSimulation(setup);
    seedFactionContact(simulation, {
      targetGroupId: "azure-target",
      targetFactionId: "azure",
      lastKnown: { x: 18, z: 10 },
      observedAt: 0,
      deliveredAt: 0,
      intelSource: "same-faction",
    });
    const events: ReturnType<typeof simulation.drainEvents>[number][] = [];
    let assignedMissionId: string | undefined;
    let releasedAt: number | undefined;

    for (let tick = 0; tick < 100 && releasedAt === undefined; tick += 1) {
      simulation.step();
      const inspection = simulation.inspect("ember-artillery-platform", "ember");
      if (inspection?.kind === "platform" && inspection.artillery?.mission) {
        assignedMissionId ??= inspection.artillery.mission.id;
        expect(inspection.artillery.mission).toMatchObject({
          fireModeId: "indirect",
          targetGroupId: "azure-target",
          source: "same-faction",
          observedAt: 0,
          deliveredAt: 0,
        });
        seedFactionContact(simulation, {
          targetGroupId: "azure-target",
          targetFactionId: "azure",
          lastKnown: { x: 16, z: 8 },
          observedAt: simulation.tick,
          deliveredAt: simulation.tick,
          intelSource: "same-faction",
        });
      }
      const tickEvents = simulation.drainEvents();
      events.push(...tickEvents);
      releasedAt = tickEvents.find(
        (event) =>
          event.type === "weapon-fired" &&
          event.groupId === "ember-artillery" &&
          event.fireModeId === "indirect",
      )?.tick;
    }

    expect(assignedMissionId).toBeDefined();
    expect(releasedAt).toBeDefined();
    const assignedIndex = events.findIndex(
      (event) => event.type === "artillery-mission-changed" && event.phase === "assigned",
    );
    const releasedIndex = events.findIndex(
      (event) => event.type === "artillery-mission-changed" && event.phase === "released",
    );
    const firedIndex = events.findIndex(
      (event) => event.type === "weapon-fired" && event.fireModeId === "indirect",
    );
    expect(assignedIndex).toBeGreaterThanOrEqual(0);
    expect(releasedIndex).toBeGreaterThan(assignedIndex);
    expect(firedIndex).toBeGreaterThan(releasedIndex);

    const projectile = artilleryInternals(simulation).state.projectiles[0]!;
    expect(projectile).toMatchObject({
      fireModeId: "indirect",
      intendedAimCell: { x: 18, z: 10 },
      launchedAt: releasedAt,
    });
    const mode = setup.content.weaponTemplates[DEFAULT_ARTILLERY_WEAPON_TEMPLATE_ID]!
      .fireModes.find(
        (candidate): candidate is Extract<WeaponFireModeDefinition, { targeting: "indirect" }> =>
          candidate.targeting === "indirect",
      )!;
    const releasedInspection = simulation.inspect("ember-artillery-platform", "ember");
    if (releasedInspection?.kind !== "platform" || !releasedInspection.artillery?.mission) {
      throw new Error("Expected the released mission to remain inspectable for one tick.");
    }
    const expectedUncertainty = calculateArtilleryUncertainty(
      mode.uncertainty,
      "same-faction",
      releasedAt!,
      0,
      releasedInspection.artillery.mission.confidenceBps,
    );
    expect(releasedInspection).toMatchObject({
      artillery: {
        mission: {
          id: assignedMissionId,
          uncertaintyRadiusMm: expectedUncertainty.radiusMm,
          plannedImpactCell: projectile.plannedImpactCell,
        },
      },
    });
    const dxMm = (projectile.plannedImpactCell.x - 18) * setup.map.cellSizeMm;
    const dzMm = (projectile.plannedImpactCell.z - 10) * setup.map.cellSizeMm;
    expect(dxMm * dxMm + dzMm * dzMm).toBeLessThanOrEqual(
      expectedUncertainty.radiusMm ** 2,
    );
  });

  it("artillery-no-leak-004: keeps mission decisions and scatter independent from hidden target truth", () => {
    const setup = createIndirectArtillerySetup();
    const first = createSimulation(setup);
    const second = createSimulation(setup);
    for (const simulation of [first, second]) {
      seedFactionContact(simulation, {
        targetGroupId: "azure-target",
        targetFactionId: "azure",
        lastKnown: { x: 18, z: 10 },
        observedAt: 0,
        deliveredAt: 0,
        intelSource: "same-faction",
      });
    }
    const hiddenTarget = artilleryInternals(second).state.groupsById.get("azure-target")!;
    hiddenTarget.cell.x = 22;
    hiddenTarget.cell.z = 4;

    let fired = false;
    for (let tick = 0; tick < 100 && !fired; tick += 1) {
      first.step();
      second.step();
      expect(first.inspect("ember-artillery-platform", "ember")?.kind).toBe("platform");
      expect(second.inspect("ember-artillery-platform", "ember")?.kind).toBe("platform");
      const firstInspection = first.inspect("ember-artillery-platform", "ember");
      const secondInspection = second.inspect("ember-artillery-platform", "ember");
      if (firstInspection?.kind === "platform" && secondInspection?.kind === "platform") {
        expect(secondInspection.artillery).toEqual(firstInspection.artillery);
      }
      const firstEvents = first.drainEvents().filter(isArtilleryDecisionEvent);
      const secondEvents = second.drainEvents().filter(isArtilleryDecisionEvent);
      expect(secondEvents).toEqual(firstEvents);
      fired = firstEvents.some(
        (event) => event.type === "weapon-fired" && event.fireModeId === "indirect",
      );
    }

    expect(fired).toBe(true);
    const firstProjectile = artilleryInternals(first).state.projectiles[0]!;
    const secondProjectile = artilleryInternals(second).state.projectiles[0]!;
    expect({
      intendedAimCell: secondProjectile.intendedAimCell,
      plannedImpactCell: secondProjectile.plannedImpactCell,
      launchedAt: secondProjectile.launchedAt,
      scheduledGroundImpactAt: secondProjectile.scheduledGroundImpactAt,
    }).toEqual({
      intendedAimCell: firstProjectile.intendedAimCell,
      plannedImpactCell: firstProjectile.plannedImpactCell,
      launchedAt: firstProjectile.launchedAt,
      scheduledGroundImpactAt: firstProjectile.scheduledGroundImpactAt,
    });
  });

  it("rejects known danger close and neutral contacts without consulting hidden neutral truth", () => {
    const dangerSetup = createIndirectArtillerySetup(true);
    const danger = createSimulation(dangerSetup);
    seedFactionContact(danger, {
      targetGroupId: "azure-target",
      targetFactionId: "azure",
      lastKnown: { x: 18, z: 10 },
      observedAt: 0,
      deliveredAt: 0,
      intelSource: "same-faction",
    });
    danger.step(5);
    expect(danger.inspect("ember-artillery-platform", "ember")).toMatchObject({
      artillery: {
        mission: undefined,
        evaluation: { reason: "ARTILLERY_HOLD_DANGER_CLOSE" },
      },
    });
    expect(danger.drainEvents().some(
      (event) => event.type === "artillery-mission-changed" && event.phase === "assigned",
    )).toBe(false);

    const multiFactionSetup = createMultiFactionIndirectSetup();
    const hiddenNeutral = createSimulation(multiFactionSetup);
    seedFactionContact(hiddenNeutral, {
      targetGroupId: "azure-target",
      targetFactionId: "azure",
      lastKnown: { x: 18, z: 10 },
      observedAt: 0,
      deliveredAt: 0,
      intelSource: "same-faction",
    });
    seedFactionContact(hiddenNeutral, {
      targetGroupId: "olive-neutral",
      targetFactionId: "olive",
      lastKnown: { x: 2, z: 2 },
      observedAt: 0,
      deliveredAt: 0,
      intelSource: "allied",
    });
    hiddenNeutral.step(5);
    const inspection = hiddenNeutral.inspect("ember-artillery-platform", "ember");
    expect(inspection).toMatchObject({
      artillery: {
        mission: { targetGroupId: "azure-target" },
        evaluation: { selectedTargetGroupId: "azure-target" },
      },
    });
    if (inspection?.kind === "platform") {
      expect(inspection.artillery?.evaluation?.candidates).toEqual(expect.arrayContaining([
        expect.objectContaining({
          targetGroupId: "olive-neutral",
          rejectionReason: "CONTACT_NOT_HOSTILE",
        }),
      ]));
    }
  });
});

describe("artillery-observation-007", () => {
  it("projects stable authoritative shell positions without changing the battle hash", () => {
    const simulation = createSimulation(createIndirectArtillerySetup());
    seedFactionContact(simulation, {
      targetGroupId: "azure-target",
      targetFactionId: "azure",
      lastKnown: { x: 18, z: 10 },
      observedAt: 0,
      deliveredAt: 0,
      intelSource: "same-faction",
    });
    const projectedX: number[] = [];
    let projectileId: string | undefined;
    let sawEnemyVisibleShell = false;

    for (let tick = 0; tick < 140; tick += 1) {
      simulation.step();
      const hashBeforeProjection = simulation.getStateHash();
      const omniscient = simulation.getRenderFrame();
      const ember = simulation.getRenderFrame("ember");
      const azure = simulation.getRenderFrame("azure");
      expect(simulation.getStateHash()).toBe(hashBeforeProjection);

      const projectile = omniscient.projectiles[0];
      if (projectile) {
        projectileId ??= projectile.id;
        projectedX.push(projectile.worldX);
        expect(projectile).toMatchObject({
          id: projectileId,
          sourceFactionId: "ember",
          visualTypeId: "shell-medium-v1",
        });
        expect(projectile.worldY).toBeGreaterThan(0);
        expect(ember.projectiles.map((candidate) => candidate.id)).toContain(projectile.id);
        if (projectedX.length === 1) {
          expect(azure.projectiles).toEqual([]);
        }
        sawEnemyVisibleShell ||= azure.projectiles.some(
          (candidate) => candidate.id === projectile.id,
        );
      }
      simulation.drainEvents();
      if (projectileId && omniscient.projectiles.length === 0) {
        break;
      }
    }

    expect(projectileId).toBeDefined();
    expect(new Set(projectedX).size).toBeGreaterThan(2);
    expect(sawEnemyVisibleShell).toBe(true);
  });

  it("keeps missions and logical firing details out of an enemy event projection", () => {
    const setup = createIndirectArtillerySetup();
    const emberView = createSimulation(setup);
    const azureView = createSimulation(setup);
    for (const simulation of [emberView, azureView]) {
      seedFactionContact(simulation, {
        targetGroupId: "azure-target",
        targetFactionId: "azure",
        lastKnown: { x: 18, z: 10 },
        observedAt: 0,
        deliveredAt: 0,
        intelSource: "same-faction",
      });
    }
    const emberEvents: ReturnType<typeof emberView.drainEvents>[number][] = [];
    const azureEvents: ReturnType<typeof azureView.drainEvents>[number][] = [];
    let fired = false;

    for (let tick = 0; tick < 140; tick += 1) {
      emberView.step();
      azureView.step();
      const sourceEvents = emberView.drainEvents("ember");
      const enemyEvents = azureView.drainEvents("azure");
      emberEvents.push(...sourceEvents);
      azureEvents.push(...enemyEvents);
      expect(azureView.getStateHash()).toBe(emberView.getStateHash());
      fired ||= sourceEvents.some(
        (event) => event.type === "weapon-fired" && Boolean(event.projectileIds?.length),
      );
      if (
        fired &&
        emberView.getRenderFrame().projectiles.length === 0 &&
        sourceEvents.some((event) => event.type === "projectile-impacted")
      ) {
        break;
      }
    }

    expect(emberEvents.some((event) => event.type === "artillery-mission-changed")).toBe(true);
    expect(emberEvents.some(
      (event) => event.type === "weapon-fired" && Boolean(event.projectileIds?.length),
    )).toBe(true);
    expect(azureEvents.some((event) => event.type === "artillery-mission-changed")).toBe(false);
    expect(azureEvents.some(
      (event) => event.type === "weapon-fired" && Boolean(event.projectileIds?.length),
    )).toBe(false);
  });

  it("does not expose enemy member health facts through a directly observed impact", () => {
    const setup = createArtillerySetup();
    const emberView = createSimulation(setup);
    const azureView = createSimulation(setup);
    const emberEvents: ReturnType<typeof emberView.drainEvents>[number][] = [];
    const azureEvents: ReturnType<typeof azureView.drainEvents>[number][] = [];

    for (let tick = 0; tick < 140; tick += 1) {
      emberView.step();
      azureView.step();
      emberEvents.push(...emberView.drainEvents("ember"));
      azureEvents.push(...azureView.drainEvents("azure"));
      expect(azureView.getStateHash()).toBe(emberView.getStateHash());
      if (azureEvents.some((event) => event.type === "member-health-changed")) {
        break;
      }
    }

    expect(azureEvents.some(
      (event) => event.type === "member-health-changed" && event.groupId === "azure-target",
    )).toBe(true);
    expect(emberEvents.some(
      (event) => event.type === "member-health-changed" && event.groupId === "azure-target",
    )).toBe(false);
  });
});

describe("artillery long scenarios", () => {
  it.each(["conflict", "defense"] as const)(
    "finishes a deterministic %s battle after indirect missions",
    (mode) => {
      const base = createIndirectArtillerySetup();
      const setup: BattleSetup = {
        ...base,
        battleId: `artillery-long-${mode}`,
        mode: mode === "conflict"
          ? { kind: "conflict" }
          : {
              kind: "defense",
              attackerFactionId: "azure",
              defenderFactionId: "ember",
              objective: {
                id: "artillery-objective",
                center: { x: 12, z: 10 },
                radiusCells: 2,
              },
            },
      };
      const first = createSimulation(setup);
      const second = createSimulation(setup);
      for (const simulation of [first, second]) {
        seedFactionContact(simulation, {
          targetGroupId: "azure-target",
          targetFactionId: "azure",
          lastKnown: { x: 18, z: 10 },
          observedAt: 0,
          deliveredAt: 0,
          intelSource: "same-faction",
        });
        simulation.step(500);
      }

      expect(second.getStateHash()).toBe(first.getStateHash());
      expect(second.drainEvents()).toEqual(first.drainEvents());
      expect(second.getResult()).toEqual(first.getResult());
      expect(first.status).toBe("finished");
      const artillery = first.getResult()?.platforms.find(
        (platform) => platform.id === "ember-artillery-platform",
      )?.artillery;
      expect(artillery?.missionsAssigned).toBeGreaterThan(0);
      expect(artillery?.indirectRoundsFired).toBeGreaterThan(0);
      expect(artilleryInternals(first).state.projectiles).toEqual([]);
    },
  );
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

function createIndirectArtillerySetup(dangerClose = false): BattleSetup {
  const base = createArtillerySetup();
  const target = createTargetGroup();
  const groups: GroupSpawn[] = [
    createArtilleryGroup(),
    {
      ...target,
      spawn: { x: 20, z: 10 },
      evacuation: { x: 22, z: 10 },
    },
  ];
  if (dangerClose) {
    groups.push({
      ...createFriendlyGroup(),
      spawn: { x: 18, z: 10 },
      evacuation: { x: 1, z: 11 },
    });
  }
  return {
    ...base,
    battleId: dangerClose ? "artillery-danger-close" : "artillery-intel-003",
    groups,
  };
}

function createMultiFactionIndirectSetup(): BattleSetup {
  const base = createIndirectArtillerySetup();
  return {
    ...base,
    battleId: "artillery-multi-faction-negative",
    factions: [
      ...base.factions,
      { id: "olive", displayName: "Olive", color: "#71824a" },
    ],
    relations: [
      defaultRelation("ember", "azure", "hostile"),
      defaultRelation("ember", "olive", "neutral"),
      defaultRelation("azure", "olive", "neutral"),
    ],
    groups: [
      ...base.groups,
      {
        ...createTargetGroup(),
        id: "olive-neutral",
        factionId: "olive",
        spawn: { x: 18, z: 10 },
        evacuation: { x: 22, z: 12 },
        members: Array.from({ length: 8 }, (_, index) => ({
          id: `olive-neutral-member-${index + 1}`,
          memberTemplateId: DEFAULT_MEMBER_TEMPLATE_ID,
        })),
      },
    ],
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

function createObserverGroup(): GroupSpawn {
  return {
    id: "ember-observer",
    factionId: "ember",
    groupTemplateId: DEFAULT_GROUP_TEMPLATE_ID,
    spawn: { x: 14, z: 10 },
    evacuation: { x: 1, z: 8 },
    members: Array.from({ length: 8 }, (_, index) => ({
      id: `ember-observer-member-${index + 1}`,
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
    deliveredAt: internals.state.tick,
    lastDirectTick: internals.state.tick,
    confidenceBps: 10_000,
    sourceGroupId: shooter.id,
    intelSource: "local-direct",
  });
  return true;
}

function seedFactionContact(
  simulation: ReturnType<typeof createSimulation>,
  contact: {
    readonly targetGroupId: string;
    readonly targetFactionId: string;
    readonly lastKnown: { readonly x: number; readonly z: number };
    readonly observedAt: number;
    readonly deliveredAt: number;
    readonly intelSource: "local-direct" | "same-faction" | "allied";
  },
): void {
  artilleryInternals(simulation).state.factionKnowledge.get("ember")!.contacts.set(
    contact.targetGroupId,
    {
      ...contact,
      targetProfile: "personnel",
      lastKnown: { ...contact.lastKnown },
      lastDirectTick: -1,
      confidenceBps: 10_000,
      sourceGroupId: "ember-observer",
    },
  );
}

function isArtilleryDecisionEvent(
  event: ReturnType<ReturnType<typeof createSimulation>["drainEvents"]>[number],
): boolean {
  return (
    event.type === "artillery-mission-changed" ||
    event.type === "platform-deployment-changed" ||
    (event.type === "weapon-fired" && event.groupId === "ember-artillery")
  );
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
          deliveredAt: number;
          lastDirectTick: number;
          confidenceBps: number;
          sourceGroupId: string;
          intelSource: "local-direct" | "same-faction" | "allied";
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
      readonly factionKnowledge: Map<string, {
        readonly contacts: Map<string, {
          targetGroupId: string;
          targetFactionId: string;
          targetProfile: "personnel" | "platform";
          lastKnown: { x: number; z: number };
          observedAt: number;
          deliveredAt: number;
          lastDirectTick: number;
          confidenceBps: number;
          sourceGroupId: string;
          intelSource: "local-direct" | "same-faction" | "allied";
        }>;
      }>;
      readonly membersById: Map<string, { health: string }>;
      readonly projectiles: readonly {
        readonly id: string;
        readonly fireModeId: string;
        readonly launchedAt: number;
        readonly scheduledGroundImpactAt: number;
        readonly intendedAimCell: { readonly x: number; readonly z: number };
        readonly plannedImpactCell: { readonly x: number; readonly z: number };
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
