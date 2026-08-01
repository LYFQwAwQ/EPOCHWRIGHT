import { describe, expect, it } from "vitest";
import { createDemoBattleSetup } from "../demo/setup";
import { createDemoScenarioOptions } from "../demo/scenarios";
import {
  DEFAULT_ACTIVE_ABILITY_TEMPLATE_ID,
  DEFAULT_ACTIVE_GROUP_TEMPLATE_ID,
  DEFAULT_ACTIVE_MEMBER_TEMPLATE_ID,
  cloneBattleContent,
  createSimulation,
  validateBattleContent,
} from "./index";
import type { GroupInspection } from "./types";
import type { GroupState } from "./internal";

function activeSetup(seed: string) {
  return createDemoBattleSetup({
    ...createDemoScenarioOptions("active-ability", seed),
    groupsPerFaction: 2,
    width: 30,
    height: 20,
  });
}

function runtime(simulation: ReturnType<typeof createSimulation>) {
  return simulation as unknown as {
    state: {
      groups: GroupState[];
      groupsById: Map<string, GroupState>;
    };
  };
}

function activeSource(simulation: ReturnType<typeof createSimulation>): GroupState {
  return [...runtime(simulation).state.groups].find(
    (group) => group.groupTemplateId === DEFAULT_ACTIVE_GROUP_TEMPLATE_ID,
  )!;
}

describe("active abilities", () => {
  it("registers a bounded suppression recovery handler and validates its contract", () => {
    const setup = activeSetup("active-contract");
    const ability = setup.content.abilityTemplates[DEFAULT_ACTIVE_ABILITY_TEMPLATE_ID]!;
    const member = setup.content.memberTemplates[DEFAULT_ACTIVE_MEMBER_TEMPLATE_ID]!;
    expect(ability).toMatchObject({
      kind: "active",
      targetRule: "nearby-friendly-groups",
      rangeCells: 8,
      cooldownTicks: 40,
      maxCharges: 2,
      triggerConditions: [{ kind: "target-suppression", minimumBps: 200 }],
      effects: [{ kind: "suppression-recovery", amountBps: 2_500 }],
    });
    expect(member.abilityTemplateIds).toEqual([DEFAULT_ACTIVE_ABILITY_TEMPLATE_ID]);
    expect(() => validateBattleContent(setup.content)).not.toThrow();
  });

  it("rejects invalid cooldown, charges, trigger, and active effect fields", () => {
    const content = cloneBattleContent(activeSetup("active-validation").content);
    const ability = content.abilityTemplates[DEFAULT_ACTIVE_ABILITY_TEMPLATE_ID]!;
    if (ability.kind !== "active") {
      throw new Error("Expected active ability template.");
    }
    const validateMutation = (mutated: typeof ability) =>
      validateBattleContent({
        ...content,
        abilityTemplates: { ...content.abilityTemplates, [ability.id]: mutated },
      });
    expect(() => validateMutation({ ...ability, cooldownTicks: -1 })).toThrow(/cooldown/i);
    expect(() => validateMutation({ ...ability, maxCharges: 0 })).toThrow(/charges/i);
    expect(() => validateMutation({
      ...ability,
      triggerConditions: [{ kind: "target-suppression", minimumBps: 0 }],
    })).toThrow(/trigger/i);
    expect(() => validateMutation({
      ...ability,
      effects: [{ kind: "suppression-recovery", amountBps: 0 }],
    })).toThrow(/active effect/i);
  });

  it("uses only legal friendly targets, records cooldown and exhausts charges", () => {
    const simulation = createSimulation(activeSetup("active-runtime"));
    const source = activeSource(simulation);
    source.suppressionBps = 7_000;

    simulation.step();
    const firstUse = simulation.drainEvents().find((event) => event.type === "ability-used");
    expect(firstUse).toMatchObject({
      type: "ability-used",
      sourceGroupId: source.id,
      targetGroupId: source.id,
      useSequence: 1,
      chargesRemaining: 1,
      suppressionRecoveredBps: 2_500,
    });
    const sourceAfterFirst = runtime(simulation).state.groupsById.get(source.id)!;
    const activeState = sourceAfterFirst.members
      .flatMap((member) => member.activeAbilities)
      .find((ability) => ability.abilityTemplateId === DEFAULT_ACTIVE_ABILITY_TEMPLATE_ID)!;
    expect(sourceAfterFirst.suppressionBps).toBeLessThanOrEqual(4_500);
    expect(activeState.cooldownUntilTick).toBe(40);
    expect(activeState.useCount).toBe(1);
    expect((simulation.inspect(source.id) as GroupInspection).activeAbilities).toMatchObject([
      {
        abilityTemplateId: DEFAULT_ACTIVE_ABILITY_TEMPLATE_ID,
        chargesRemaining: 1,
        useCount: 1,
        evaluation: {
          reason: "used",
          selectedTargetGroupId: source.id,
        },
      },
    ]);

    simulation.step(39);
    expect(
      runtime(simulation).state.groupsById
        .get(source.id)!
        .members.flatMap((member) => member.activeAbilities)
        .find((ability) => ability.abilityTemplateId === DEFAULT_ACTIVE_ABILITY_TEMPLATE_ID)
        ?.useCount,
    ).toBe(1);
    runtime(simulation).state.groupsById.get(source.id)!.suppressionBps = 7_000;
    simulation.step();
    const secondUse = simulation.drainEvents().find((event) => event.type === "ability-used");
    expect(secondUse).toMatchObject({
      type: "ability-used",
      useSequence: 2,
      chargesRemaining: 0,
    });
    const exhausted = runtime(simulation).state.groupsById
      .get(source.id)!
      .members.flatMap((member) => member.activeAbilities)
      .find((ability) => ability.abilityTemplateId === DEFAULT_ACTIVE_ABILITY_TEMPLATE_ID)!;
    expect(exhausted.useCount).toBe(2);
    expect(exhausted.chargesRemaining).toBe(0);
    simulation.step();
    expect(
      runtime(simulation).state.groupsById
        .get(source.id)!
        .members.flatMap((member) => member.activeAbilities)
        .find((ability) => ability.abilityTemplateId === DEFAULT_ACTIVE_ABILITY_TEMPLATE_ID)
        ?.useCount,
    ).toBe(2);
  });

  it("explains trigger rejection and does not leak active details to an enemy observer", () => {
    const simulation = createSimulation(activeSetup("active-observer"));
    const source = activeSource(simulation);
    simulation.step();
    const inspection = simulation.inspect(source.id) as GroupInspection;
    expect(inspection.activeAbilities).toMatchObject([
      {
        evaluation: {
          reason: "trigger-unmet",
          candidates: expect.arrayContaining([
            expect.objectContaining({
              targetGroupId: source.id,
              rejectionReason: "trigger-unmet",
            }),
          ]),
        },
      },
    ]);
    const enemyFactionId = source.factionId === "ember" ? "azure" : "ember";
    expect(simulation.inspect(source.id, enemyFactionId)).toBeUndefined();
    expect(simulation.drainEvents(enemyFactionId)).not.toContainEqual(
      expect.objectContaining({ type: "ability-used" }),
    );
  });

  it("rejects an incapacitated source before target scoring", () => {
    const simulation = createSimulation(activeSetup("active-source-condition"));
    const source = activeSource(simulation);
    source.suppressionBps = 7_000;
    source.members.find((member) => member.activeAbilities.length > 0)!.health = "incapacitated";
    simulation.step();
    expect((simulation.inspect(source.id) as GroupInspection).activeAbilities).toMatchObject([
      { evaluation: { reason: "source-condition-unmet", candidates: [] } },
    ]);
    expect(simulation.drainEvents()).not.toContainEqual(
      expect.objectContaining({ type: "ability-used" }),
    );
  });

  it("keeps active scoring independent from hidden hostile truth", () => {
    const first = createSimulation(activeSetup("active-hidden-truth"));
    const second = createSimulation(activeSetup("active-hidden-truth"));
    const firstSource = activeSource(first);
    const secondSource = activeSource(second);
    firstSource.suppressionBps = 7_000;
    secondSource.suppressionBps = 7_000;
    const hiddenSecond = runtime(second).state.groups.find(
      (group) => group.factionId !== secondSource.factionId,
    )!;
    hiddenSecond.cell = {
      ...hiddenSecond.cell,
      x: Math.max(0, hiddenSecond.cell.x - 10),
    };
    hiddenSecond.suppressionBps = 9_000;
    hiddenSecond.members[0]!.health = "dead";
    first.step();
    second.step();
    const firstUse = first.drainEvents().find((event) => event.type === "ability-used");
    const secondUse = second.drainEvents().find((event) => event.type === "ability-used");
    expect(secondUse).toEqual(firstUse);
    expect(
      (first.inspect(firstSource.id) as GroupInspection).activeAbilities,
    ).toEqual((second.inspect(secondSource.id) as GroupInspection).activeAbilities);
  });

  it("replays stable ability use order and per-tick hashes", () => {
    const setup = activeSetup("active-hash-order");
    const first = createSimulation(setup);
    const second = createSimulation(setup);
    for (const simulation of [first, second]) {
      for (const group of runtime(simulation).state.groups.filter(
        (candidate) => candidate.groupTemplateId === DEFAULT_ACTIVE_GROUP_TEMPLATE_ID,
      )) {
        group.suppressionBps = 7_000;
      }
    }
    expect(first.getStateHash()).toBe(second.getStateHash());
    first.step();
    second.step();
    const firstUses = first.drainEvents().filter((event) => event.type === "ability-used");
    const secondUses = second.drainEvents().filter((event) => event.type === "ability-used");
    expect(secondUses).toEqual(firstUses);
    expect(firstUses.map((event) => event.sourceGroupId)).toEqual(
      [...firstUses.map((event) => event.sourceGroupId)].sort(),
    );
    for (let tick = 0; tick < 100; tick += 1) {
      first.step();
      second.step();
      expect(first.getStateHash()).toBe(second.getStateHash());
    }
  });

  it("uses the default active ability naturally in the demo scenario", () => {
    const simulation = createSimulation(activeSetup("active-natural-use"));
    let useTick: number | undefined;
    for (let tick = 0; tick < 1_500 && simulation.status === "active"; tick += 1) {
      simulation.step();
      const event = simulation.drainEvents().find((candidate) => candidate.type === "ability-used");
      if (event?.type === "ability-used") {
        useTick = event.tick;
        break;
      }
    }
    expect(useTick).toBeDefined();
  });

  it("freezes active ability state after battle termination", () => {
    const setup = createDemoBattleSetup({
      ...createDemoScenarioOptions("active-ability", "active-finish"),
      groupsPerFaction: 1,
      maximumDurationSeconds: 1,
      stalemateSeconds: 1,
    });
    const simulation = createSimulation(setup);
    const source = activeSource(simulation);
    source.suppressionBps = 7_000;
    simulation.step(100);
    const result = simulation.getResult();
    expect(result).toBeDefined();
    const hash = simulation.getStateHash();
    const state = runtime(simulation).state.groupsById.get(source.id)!
      .members.flatMap((member) => member.activeAbilities)
      .find((ability) => ability.abilityTemplateId === DEFAULT_ACTIVE_ABILITY_TEMPLATE_ID)!;
    simulation.step(100);
    expect(simulation.getStateHash()).toBe(hash);
    expect(
      runtime(simulation).state.groupsById.get(source.id)!
        .members.flatMap((member) => member.activeAbilities)
        .find((ability) => ability.abilityTemplateId === DEFAULT_ACTIVE_ABILITY_TEMPLATE_ID),
    ).toEqual(state);
    expect(result?.groups.find((group) => group.id === source.id)?.activeAbilities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          abilityTemplateId: DEFAULT_ACTIVE_ABILITY_TEMPLATE_ID,
          useCount: state.useCount,
        }),
      ]),
    );
  });
});
