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
