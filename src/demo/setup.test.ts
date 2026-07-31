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

  it("rejects artillery and vehicle mixes that exceed generated group capacity", () => {
    expect(() => createDemoBattleSetup({
      seed: "invalid-artillery-count",
      groupsPerFaction: 1,
      artilleryGroupsPerFaction: 2,
    })).toThrow(/artilleryGroupsPerFaction/);
    expect(() => createDemoBattleSetup({
      seed: "invalid-platform-mix",
      groupsPerFaction: 1,
      artilleryGroupsPerFaction: 1,
      vehicleGroupsPerFaction: 1,
    })).toThrow(/fit within groupsPerFaction/);
    expect(() => createDemoBattleSetup({
      seed: "invalid-passive-group-count",
      groupsPerFaction: 1,
      vehicleGroupsPerFaction: 1,
      passiveAbilityGroupsPerFaction: 1,
    })).toThrow(/passiveAbilityGroupsPerFaction/);
    expect(() => createDemoBattleSetup({
      seed: "invalid-ability-group-mix",
      groupsPerFaction: 1,
      passiveAbilityGroupsPerFaction: 1,
      auraAbilityGroupsPerFaction: 1,
    })).toThrow(/auraAbilityGroupsPerFaction/);
  });

  it("keeps air group counts backward-compatible unless explicit types are supplied", () => {
    const setup = createDemoBattleSetup({
      seed: "default-air-group-types",
      groupsPerFaction: 2,
      airGroupsPerFaction: 2,
    });
    expect(
      setup.groups
        .filter((group) => group.id.startsWith("ember-air"))
        .map((group) => group.id),
    ).toEqual(["ember-air-recon-1", "ember-air-recon-2"]);
    expect(() => createDemoBattleSetup({
      seed: "invalid-air-group-types",
      groupsPerFaction: 2,
      airGroupsPerFaction: 2,
      airGroupTypes: ["scout-drone"],
    })).toThrow(/airGroupTypes/);
  });
});
