import { describe, expect, it } from "vitest";
import { createSimulation, validateBattleSetup } from "../sim";
import {
  DEMO_SCENARIOS,
  createDemoBattleSetup,
  createDemoScenarioOptions,
} from "./index";

describe("manual demo scenarios", () => {
  it.each(DEMO_SCENARIOS)("creates validated setup for $id", ({ id, mode }) => {
    const setup = createDemoBattleSetup(
      createDemoScenarioOptions(id, `scenario-${id}`),
    );

    expect(setup.battleId).toBe(`demo-${id}-scenario-${id}`);
    expect(setup.mode.kind).toBe(mode);
    expect(() => validateBattleSetup(setup)).not.toThrow();
  });

  it("exposes sequence objectives and a defender reserve", () => {
    const setup = createDemoBattleSetup(
      createDemoScenarioOptions("sequence-defense", "scenario-sequence"),
    );

    expect(setup.mode).toMatchObject({
      kind: "defense",
      objectiveRule: "sequence",
      reserveRatioBps: 3_300,
    });
    expect(setup.mode.kind === "defense" ? setup.mode.objectives : []).toHaveLength(3);
  });

  it("exposes one wheeled and one tracked platform in the vehicle scenario", () => {
    const setup = createDemoBattleSetup(
      createDemoScenarioOptions("vehicle-skirmish", "scenario-vehicles"),
    );
    const movementTypes = setup.groups.flatMap((group) =>
      group.platforms.map(
        (platform) => setup.content.platformTemplates[platform.platformTemplateId]!.movementType,
      ),
    );

    expect(movementTypes.sort()).toEqual(["tracked", "wheeled"]);
    expect(setup.transportAssignments).toHaveLength(2);
    expect(setup.transportAssignments.every((assignment) => assignment.initiallyEmbarked)).toBe(
      true,
    );
  });

  it("exposes one validated self-propelled artillery group per faction", () => {
    const setup = createDemoBattleSetup(
      createDemoScenarioOptions("artillery-observation", "scenario-artillery"),
    );
    const artilleryGroups = setup.groups.filter((group) =>
      setup.content.groupTemplates[group.groupTemplateId]?.tags.includes("artillery"),
    );

    expect(artilleryGroups.map((group) => group.id)).toEqual([
      "ember-artillery-1",
      "azure-artillery-1",
    ]);
    expect(artilleryGroups.every((group) => group.platforms.length === 1)).toBe(true);
    expect(setup.transportAssignments).toEqual([]);
  });

  it("exposes one unarmed low-altitude recon platform per faction", () => {
    const setup = createDemoBattleSetup(
      createDemoScenarioOptions("air-recon", "scenario-air"),
    );
    const airGroups = setup.groups.filter((group) =>
      group.platforms.some(
        (platform) =>
          setup.content.platformTemplates[platform.platformTemplateId]?.movementType === "hover",
      ),
    );

    expect(airGroups.map((group) => group.id)).toEqual([
      "ember-air-recon-1",
      "azure-air-recon-1",
    ]);
    expect(
      airGroups.every((group) => group.platforms[0]?.initialAltitudeBand === "low"),
    ).toBe(true);
    expect(
      airGroups.every((group) => {
        const template = setup.content.platformTemplates[group.platforms[0]!.platformTemplateId]!;
        return template.componentRules.every((component) => component.kind !== "weapon");
      }),
    ).toBe(true);
    expect(setup.transportAssignments).toEqual([]);
  });

  it("exposes recon, attack, and drone hover platforms in the air operations scenario", () => {
    const setup = createDemoBattleSetup(
      createDemoScenarioOptions("air-operations", "scenario-air-operations"),
    );
    const airGroups = setup.groups.filter((group) =>
      group.platforms.some(
        (platform) =>
          setup.content.platformTemplates[platform.platformTemplateId]?.movementType === "hover",
      ),
    );
    const visualTypes = airGroups.map((group) =>
      setup.content.platformTemplates[group.platforms[0]!.platformTemplateId]!.visualTypeId,
    );

    expect(airGroups.map((group) => group.id)).toEqual([
      "ember-air-recon-1",
      "ember-air-attack-1",
      "ember-air-drone-1",
      "azure-air-recon-1",
      "azure-air-attack-1",
      "azure-air-drone-1",
    ]);
    expect(visualTypes).toEqual([
      "air-recon-helicopter",
      "air-attack-helicopter",
      "air-scout-drone",
      "air-recon-helicopter",
      "air-attack-helicopter",
      "air-scout-drone",
    ]);
    expect(
      airGroups.map((group) => group.platforms[0]!.initialAltitudeBand),
    ).toEqual(["low", "medium", "high", "low", "medium", "high"]);
    expect(
      airGroups
        .filter((group) => group.id.includes("air-attack"))
        .every((group) => {
          const template = setup.content.platformTemplates[group.platforms[0]!.platformTemplateId]!;
          return template.componentRules.filter((component) => component.kind === "weapon").length === 2;
        }),
    ).toBe(true);
    expect(setup.transportAssignments).toEqual([]);
  });

  it("runs air operations deterministically with continuous altitude actions and armed fire", () => {
    const setup = createDemoBattleSetup(
      createDemoScenarioOptions("air-operations", "scenario-air-operations-runtime"),
    );
    const first = createSimulation(setup);
    const second = createSimulation(setup);
    let sawIntermediateClearance = false;
    let sawAttackHelicopterFire = false;

    for (let tick = 0; tick < 1_200 && !first.getResult(); tick += 1) {
      first.step();
      second.step();
      expect(second.getStateHash()).toBe(first.getStateHash());
      sawIntermediateClearance ||= first.getRenderFrame().platforms.some((platform) => {
        if (!platform.flight) return false;
        const template = setup.content.platformTemplates[
          setup.groups
            .flatMap((group) => group.platforms)
            .find((spawn) => spawn.id === platform.id)!.platformTemplateId
        ]!;
        return !Object.values(template.flightRule!.clearanceMmByBand)
          .includes(platform.flight.clearanceMm);
      });
      sawAttackHelicopterFire ||= first.drainEvents().some(
        (event) => event.type === "weapon-fired" && event.groupId.includes("air-attack"),
      );
    }

    expect(sawIntermediateClearance).toBe(true);
    expect(sawAttackHelicopterFire).toBe(true);
  }, 30_000);

  it("drives the artillery observation scenario through a natural indirect mission", () => {
    const setup = createDemoBattleSetup(
      createDemoScenarioOptions("artillery-observation", "scenario-artillery-mission"),
    );
    const simulation = createSimulation(setup);
    let assigned = false;
    let firedIndirect = false;
    let sawProjectile = false;

    while (!simulation.getResult() && simulation.tick < 1_200 && !firedIndirect) {
      simulation.step();
      sawProjectile ||= simulation.getRenderFrame().projectiles.length > 0;
      const events = simulation.drainEvents();
      assigned ||= events.some(
        (event) => event.type === "artillery-mission-changed" && event.phase === "assigned",
      );
      firedIndirect ||= events.some(
        (event) => event.type === "weapon-fired" && event.fireModeId === "indirect",
      );
    }

    expect(assigned).toBe(true);
    expect(firedIndirect).toBe(true);
    expect(sawProjectile).toBe(true);
  }, 20_000);

  it("advances the default artillery seed past its grid-boundary projectile step", () => {
    const setup = createDemoBattleSetup(
      createDemoScenarioOptions("artillery-observation", "ridge-0712"),
    );
    const simulation = createSimulation(setup);

    simulation.step(600);

    expect(simulation.tick).toBe(600);
    expect(simulation.getResult()).toBeUndefined();
  }, 20_000);

  it("keeps the default-seed artillery at standoff range after its first barrage", () => {
    const setup = createDemoBattleSetup(
      createDemoScenarioOptions("artillery-observation", "ridge-0712"),
    );
    const simulation = createSimulation(setup);
    const indirectProjectileIds = new Set<string>();
    let sawIndirectImpact = false;
    let closestApproach: {
      readonly tick: number;
      readonly distanceCells: number;
      readonly ember: { readonly cell: { readonly x: number; readonly z: number }; readonly reason: string };
      readonly azure: { readonly cell: { readonly x: number; readonly z: number }; readonly reason: string };
    } | undefined;

    while (!simulation.getResult() && simulation.tick < 1_200) {
      simulation.step();
      for (const event of simulation.drainEvents()) {
        if (event.type === "weapon-fired" && event.fireModeId === "indirect") {
          for (const projectileId of event.projectileIds ?? []) {
            indirectProjectileIds.add(projectileId);
          }
        } else if (
          event.type === "projectile-impacted" &&
          indirectProjectileIds.has(event.projectileId)
        ) {
          sawIndirectImpact = true;
        }
      }
      if (!sawIndirectImpact) {
        continue;
      }
      const ember = simulation.inspect("ember-artillery-1");
      const azure = simulation.inspect("azure-artillery-1");
      if (
        ember?.kind !== "group" ||
        azure?.kind !== "group" ||
        ember.platforms[0]?.disposition !== "crewed" ||
        azure.platforms[0]?.disposition !== "crewed"
      ) {
        continue;
      }
      const distanceCells = Math.max(
        Math.abs(ember.cell.x - azure.cell.x),
        Math.abs(ember.cell.z - azure.cell.z),
      );
      if (!closestApproach || distanceCells < closestApproach.distanceCells) {
        closestApproach = {
          tick: simulation.tick,
          distanceCells,
          ember: { cell: ember.cell, reason: ember.decisionReason },
          azure: { cell: azure.cell, reason: azure.decisionReason },
        };
      }
    }

    expect(sawIndirectImpact).toBe(true);
    expect(closestApproach).toBeDefined();
    expect(
      closestApproach!.distanceCells,
      JSON.stringify(closestApproach),
    ).toBeGreaterThanOrEqual(10);
  }, 20_000);

  it("exposes vehicles and paired passengers in the combined-arms defense scenario", () => {
    const setup = createDemoBattleSetup(
      createDemoScenarioOptions("vehicle-defense", "scenario-vehicle-defense"),
    );

    expect(setup.mode.kind).toBe("defense");
    expect(setup.groups.flatMap((group) => group.platforms)).toHaveLength(2);
    expect(setup.transportAssignments).toHaveLength(2);
  });

  it.each([
    {
      id: "vehicle-skirmish",
      reasons: [
        "hostiles-eliminated",
        "hostiles-routed",
        "stalemate",
        "maximum-duration",
      ],
    },
    {
      id: "vehicle-defense",
      reasons: ["objective-captured", "attackers-eliminated", "defense-time-expired"],
    },
  ] as const)("replays $id decisions and terminates with an explicit mode reason", ({ id, reasons }) => {
    const setup = createDemoBattleSetup(
      createDemoScenarioOptions(id, `termination-${id}`),
    );
    const first = createSimulation(setup);
    const second = createSimulation(setup);
    const replayTicks = Math.min(400, setup.rules.maximumDurationTicks);

    while (!first.getResult() && first.tick < setup.rules.maximumDurationTicks) {
      first.step();
      if (first.tick <= replayTicks) {
        second.step();
        expect(second.getStateHash()).toBe(first.getStateHash());
      }
    }

    expect(first.getResult()).toBeDefined();
    expect(reasons).toContain(first.getResult()!.terminationReason);
    expect(second.tick).toBe(replayTicks);
  }, 30_000);

  it("keeps pursuing groups mobile after a rout in the default vehicle scenario", () => {
    const setup = createDemoBattleSetup(
      createDemoScenarioOptions("vehicle-skirmish", "ridge-0712"),
    );
    const simulation = createSimulation(setup);
    const internals = simulation as unknown as {
      readonly state: {
        readonly groups: readonly {
          readonly id: string;
          readonly action: string;
          readonly path: readonly unknown[];
          readonly movingTo?: unknown;
        }[];
      };
    };
    const stalledTicksByGroupId = new Map<string, number>();
    const persistentlyStalled = new Set<string>();
    let observedRout = false;

    while (!simulation.getResult() && simulation.tick < setup.rules.maximumDurationTicks) {
      simulation.step();
      for (const group of internals.state.groups) {
        observedRout ||= group.action === "routing";
        const stalled =
          group.action === "moving-to-contact" &&
          group.movingTo === undefined &&
          group.path.length === 0;
        const stalledTicks = stalled
          ? (stalledTicksByGroupId.get(group.id) ?? 0) + 1
          : 0;
        stalledTicksByGroupId.set(group.id, stalledTicks);
        if (stalledTicks > 20) {
          persistentlyStalled.add(group.id);
        }
      }
    }

    expect(observedRout).toBe(true);
    expect([...persistentlyStalled]).toEqual([]);
  });

  it("does not leave a rifle squad engaging an intact vehicle it cannot damage", () => {
    const setup = createDemoBattleSetup(
      createDemoScenarioOptions("vehicle-skirmish", "ridge-0712"),
    );
    const simulation = createSimulation(setup);
    const internals = simulation as unknown as {
      readonly state: {
        readonly groupsById: ReadonlyMap<
          string,
          {
            readonly cell: { readonly x: number; readonly z: number };
            readonly action: string;
            readonly currentTargetId?: string;
            readonly path: readonly unknown[];
            readonly movingTo?: unknown;
          }
        >;
      };
    };
    let observedRout = false;
    let ticksAfterRout = 0;
    let incompatibleTargetTicks = 0;
    let longestIncompatibleTargetRun = 0;
    let attackerStartCell: { readonly x: number; readonly z: number } | undefined;
    let attackerActed = false;

    while (!simulation.getResult() && simulation.tick < setup.rules.maximumDurationTicks) {
      simulation.step();
      const events = simulation.drainEvents();
      const routed = internals.state.groupsById.get("ember-squad-3")!;
      const attacker = internals.state.groupsById.get("azure-squad-3")!;
      if (!observedRout && routed.action === "routing") {
        observedRout = true;
        attackerStartCell = { ...attacker.cell };
      }
      if (!observedRout) {
        continue;
      }

      ticksAfterRout += 1;
      const incompatibleTarget =
        attacker.action === "engaging" &&
        attacker.currentTargetId === "ember-wheeled-1" &&
        attacker.path.length === 0 &&
        attacker.movingTo === undefined;
      incompatibleTargetTicks = incompatibleTarget ? incompatibleTargetTicks + 1 : 0;
      longestIncompatibleTargetRun = Math.max(
        longestIncompatibleTargetRun,
        incompatibleTargetTicks,
      );
      attackerActed ||=
        attacker.cell.x !== attackerStartCell!.x ||
        attacker.cell.z !== attackerStartCell!.z ||
        events.some(
          (event) => event.type === "weapon-fired" && event.groupId === "azure-squad-3",
        );
      if (ticksAfterRout >= 40) {
        break;
      }
    }

    expect(observedRout).toBe(true);
    expect(longestIncompatibleTargetRun).toBeLessThanOrEqual(5);
    expect(attackerActed).toBe(true);
  });

  it("drives both reinforcement waves through the normal simulation events", () => {
    const setup = createDemoBattleSetup(
      createDemoScenarioOptions("reinforcement-conflict", "scenario-reinforcement"),
    );
    const simulation = createSimulation(setup);

    simulation.step(100);
    const events = simulation.drainEvents();
    expect(events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "reinforcement-triggered", waveId: "ember-wave-1" }),
        expect.objectContaining({ type: "reinforcement-deployed", waveId: "ember-wave-1" }),
        expect.objectContaining({ type: "reinforcement-triggered", waveId: "azure-wave-1" }),
        expect.objectContaining({ type: "reinforcement-deployed", waveId: "azure-wave-1" }),
      ]),
    );
  });
});
