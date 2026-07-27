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
