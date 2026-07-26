import { describe, expect, it } from "vitest";
import {
  BATTLE_RULES_VERSION,
  BATTLE_SETUP_SCHEMA_VERSION,
  createSimulation,
  hashBattleSetup,
  validateBattleSetup,
} from "../sim";
import type { WorkerCommand } from "../worker/protocol";
import { createDemoBattleSetup } from "./setup";

describe("demo battle setup boundary", () => {
  it("produces deterministic, validated standard input for the worker", () => {
    const options = {
      seed: "demo-standard-input",
      width: 36,
      height: 24,
      groupsPerFaction: 1,
      mountainDensity: 0,
      roughness: 0,
      waterCoverage: 0,
      wetlandCoverage: 0,
      treeCoverage: 0,
      rockCoverage: 0,
      wallCoverage: 0,
    } as const;
    const first = createDemoBattleSetup(options);
    const second = createDemoBattleSetup(options);

    expect(first.schemaVersion).toBe(BATTLE_SETUP_SCHEMA_VERSION);
    expect(first.rulesVersion).toBe(BATTLE_RULES_VERSION);
    expect(() => validateBattleSetup(first)).not.toThrow();
    expect(hashBattleSetup(first)).toBe(hashBattleSetup(second));

    const initialize = {
      type: "initialize",
      sessionId: "test-session",
      setup: structuredClone(first),
      autostart: false,
    } satisfies Extract<WorkerCommand, { type: "initialize" }>;

    expect(initialize.setup.battleId).toBe(first.battleId);
    expect("options" in initialize).toBe(false);
  });

  it("keeps validation at the simulation boundary for external setup sources", () => {
    const setup = createDemoBattleSetup({
      seed: "external-setup-validation",
      groupsPerFaction: 1,
    });
    const invalid = {
      ...setup,
      relations: [],
    };

    expect(() => createSimulation(invalid)).toThrow(/relations/i);
  });
});
