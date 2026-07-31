import { describe, expect, it } from "vitest";
import { createDemoScenarioOptions } from "../demo/scenarios";
import { createDemoBattleSetup } from "../demo/setup";
import {
  DEFAULT_PASSIVE_ABILITY_TEMPLATE_ID,
  DEFAULT_PASSIVE_GROUP_TEMPLATE_ID,
  DEFAULT_PASSIVE_MEMBER_TEMPLATE_ID,
  cloneBattleContent,
  createSimulation,
  validateBattleContent,
} from "./index";
import type { GroupInspection, MemberInspection } from "./types";

describe("passive abilities", () => {
  it("registers a data-driven own-group passive in default content", () => {
    const setup = createAbilityScenario("ability-default-content");
    const ability = setup.content.abilityTemplates[DEFAULT_PASSIVE_ABILITY_TEMPLATE_ID];
    const leader = setup.content.memberTemplates[DEFAULT_PASSIVE_MEMBER_TEMPLATE_ID];
    const group = setup.content.groupTemplates[DEFAULT_PASSIVE_GROUP_TEMPLATE_ID];

    expect(ability).toMatchObject({
      kind: "passive",
      targetRule: "own-group",
      conditions: [
        { kind: "health", states: ["healthy", "wounded"] },
        { kind: "presence", states: ["deployed"] },
      ],
      effects: [
        {
          kind: "attribute-modifier",
          attribute: "suppression-resistance-bps",
          modifierBps: 2_000,
        },
      ],
    });
    expect(leader?.abilityTemplateIds).toEqual([DEFAULT_PASSIVE_ABILITY_TEMPLATE_ID]);
    expect(group?.memberSlotRules).toEqual([
      expect.objectContaining({ memberTemplateId: DEFAULT_PASSIVE_MEMBER_TEMPLATE_ID, count: 1 }),
      expect.objectContaining({ count: 7 }),
    ]);
    expect(() => validateBattleContent(setup.content)).not.toThrow();
  });

  it("changes derived battle facts and removes the modifier when source conditions fail", () => {
    const setup = createAbilityScenario("ability-fact-contrast");
    const group = setup.groups.find((candidate) => candidate.factionId === "ember")!;
    const leader = group.members.find(
      (member) => member.memberTemplateId === DEFAULT_PASSIVE_MEMBER_TEMPLATE_ID,
    )!;
    const withAbility = createSimulation(setup);
    const withInspection = withAbility.inspect(group.id) as GroupInspection;

    const contentWithoutAbility = cloneBattleContent(setup.content);
    const leaderTemplate = contentWithoutAbility.memberTemplates[DEFAULT_PASSIVE_MEMBER_TEMPLATE_ID]!;
    const withoutAbilityContent = {
      ...contentWithoutAbility,
      memberTemplates: {
        ...contentWithoutAbility.memberTemplates,
        [leaderTemplate.id]: {
          ...leaderTemplate,
          abilityTemplateIds: [],
        },
      },
    };
    const withoutAbility = createSimulation({ ...setup, content: withoutAbilityContent });
    const withoutInspection = withoutAbility.inspect(group.id) as GroupInspection;

    expect(withInspection.suppressionResistanceBps).toBe(2_000);
    expect(withInspection.passiveAbilities).toEqual([
      expect.objectContaining({
        sourceMemberId: leader.id,
        abilityTemplateId: DEFAULT_PASSIVE_ABILITY_TEMPLATE_ID,
        active: true,
      }),
    ]);
    expect(withoutInspection.suppressionResistanceBps).toBe(0);
    expect(withAbility.getStateHash()).not.toBe(withoutAbility.getStateHash());

    const failedConditionSetup = {
      ...setup,
      groups: setup.groups.map((candidate) =>
        candidate.id === group.id
          ? {
              ...candidate,
              members: candidate.members.map((member) =>
                member.id === leader.id ? { ...member, initialHealth: "incapacitated" as const } : member,
              ),
            }
          : candidate,
      ),
    };
    const failedCondition = createSimulation(failedConditionSetup);
    expect(failedCondition.inspect(group.id)).toMatchObject({
      suppressionResistanceBps: 0,
      passiveAbilities: [
        {
          sourceMemberId: leader.id,
          abilityTemplateId: DEFAULT_PASSIVE_ABILITY_TEMPLATE_ID,
          active: false,
          unmetCondition: "health",
        },
      ],
    });
  });

  it("applies self modifiers to the source member without changing group aggregates", () => {
    const setup = createAbilityScenario("ability-self-modifier");
    const content = cloneBattleContent(setup.content);
    const ability = content.abilityTemplates[DEFAULT_PASSIVE_ABILITY_TEMPLATE_ID]!;
    const selfAbilityContent = {
      ...content,
      abilityTemplates: {
        ...content.abilityTemplates,
        [ability.id]: {
          ...ability,
          targetRule: "self" as const,
          effects: [
            {
              kind: "attribute-modifier" as const,
              attribute: "protection-bps" as const,
              modifierBps: 2_500,
            },
          ],
        },
      },
    };
    const group = setup.groups.find((candidate) => candidate.factionId === "ember")!;
    const leader = group.members.find(
      (member) => member.memberTemplateId === DEFAULT_PASSIVE_MEMBER_TEMPLATE_ID,
    )!;
    const simulation = createSimulation({ ...setup, content: selfAbilityContent });

    expect(simulation.inspect(leader.id)).toMatchObject({
      attributes: {
        protectionBps: 2_500,
        suppressionResistanceBps: 0,
        capturePowerBps: 10_000,
      },
      passiveAbilities: [expect.objectContaining({ active: true, targetRule: "self" })],
    } satisfies Partial<MemberInspection>);
    expect(simulation.inspect(group.id)).toMatchObject({ suppressionResistanceBps: 0 });
  });

  it("replays passive ability scenarios with identical per-tick hashes", () => {
    const setup = createAbilityScenario("ability-hash-replay");
    const first = createSimulation(setup);
    const second = createSimulation(setup);

    expect(first.getStateHash()).toBe(second.getStateHash());
    for (let tick = 0; tick < 160; tick += 1) {
      first.step();
      second.step();
      expect(first.getStateHash()).toBe(second.getStateHash());
    }
  });

  it("does not expose enemy ability details through known contacts or member inspection", () => {
    const base = createAbilityScenario("ability-observer-boundary");
    const ember = base.groups.find((group) => group.factionId === "ember")!;
    const azure = base.groups.find((group) => group.factionId === "azure")!;
    const setup = {
      ...base,
      groups: base.groups.map((group) =>
        group.id === azure.id
          ? {
              ...group,
              spawn: { x: ember.spawn.x + 2, z: ember.spawn.z },
              evacuation: { x: ember.spawn.x + 2, z: ember.spawn.z },
            }
          : group,
      ),
    };
    const simulation = createSimulation(setup);
    let known: GroupInspection | undefined;
    for (let tick = 0; tick < 20 && !known; tick += 1) {
      simulation.step();
      known = simulation.inspect(azure.id, "ember") as GroupInspection | undefined;
    }

    expect(known).toMatchObject({ kind: "group", visibility: "known" });
    expect(known?.passiveAbilities).toBeUndefined();
    expect(known?.suppressionResistanceBps).toBeUndefined();
    expect(known?.capturePower).toBeUndefined();
    expect(simulation.inspect(azure.members[0]!.id, "ember")).toBeUndefined();
    expect(simulation.inspect(ember.id, "ember")).toMatchObject({
      passiveAbilities: [expect.objectContaining({ active: true })],
    });
  });
});

function createAbilityScenario(seed: string) {
  return createDemoBattleSetup({
    ...createDemoScenarioOptions("passive-ability", seed),
    groupsPerFaction: 1,
    width: 30,
    height: 20,
  });
}
