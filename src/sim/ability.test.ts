import { describe, expect, it } from "vitest";
import { createDemoScenarioOptions } from "../demo/scenarios";
import { createDemoBattleSetup } from "../demo/setup";
import {
  DEFAULT_AURA_ABILITY_TEMPLATE_ID,
  DEFAULT_AURA_GROUP_TEMPLATE_ID,
  DEFAULT_AURA_MEMBER_TEMPLATE_ID,
  DEFAULT_MEMBER_TEMPLATE_ID,
  DEFAULT_PASSIVE_ABILITY_TEMPLATE_ID,
  DEFAULT_PASSIVE_GROUP_TEMPLATE_ID,
  DEFAULT_PASSIVE_MEMBER_TEMPLATE_ID,
  cloneBattleContent,
  createSimulation,
  validateBattleContent,
} from "./index";
import {
  auraModifierBps,
  auraSourceId,
  resolveActiveAuras,
} from "./ability";
import type { AuraGroupContext } from "./ability";
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
    if (ability.kind !== "passive") {
      throw new Error("Expected passive ability template.");
    }
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

describe("aura abilities", () => {
  it("registers a ranged group aura in default content", () => {
    const setup = createAuraScenario("aura-default-content");
    const ability = setup.content.abilityTemplates[DEFAULT_AURA_ABILITY_TEMPLATE_ID];
    const leader = setup.content.memberTemplates[DEFAULT_AURA_MEMBER_TEMPLATE_ID];
    const group = setup.content.groupTemplates[DEFAULT_AURA_GROUP_TEMPLATE_ID];

    expect(ability).toMatchObject({
      kind: "aura",
      targetRule: "nearby-friendly-groups",
      rangeCells: 3,
      stacking: "stack",
      effects: [
        {
          kind: "attribute-modifier",
          attribute: "suppression-resistance-bps",
          modifierBps: 1_500,
        },
      ],
    });
    expect(leader?.abilityTemplateIds).toEqual([DEFAULT_AURA_ABILITY_TEMPLATE_ID]);
    expect(group?.memberSlotRules[0]).toMatchObject({
      memberTemplateId: DEFAULT_AURA_MEMBER_TEMPLATE_ID,
      count: 1,
    });
  });

  it("rejects unsupported aura range and stacking fields", () => {
    const content = cloneBattleContent(createAuraScenario("aura-validation").content);
    const aura = content.abilityTemplates[DEFAULT_AURA_ABILITY_TEMPLATE_ID]!;
    if (aura.kind !== "aura") {
      throw new Error("Expected aura ability template.");
    }

    expect(() =>
      validateBattleContent({
        ...content,
        abilityTemplates: {
          ...content.abilityTemplates,
          [aura.id]: { ...aura, rangeCells: 65 },
        },
      }),
    ).toThrow(/range or stacking/i);
    expect(() =>
      validateBattleContent({
        ...content,
        abilityTemplates: {
          ...content.abilityTemplates,
          [aura.id]: { ...aura, stacking: "replace" as never },
        },
      }),
    ).toThrow(/range or stacking/i);
  });

  it("uses an inclusive integer radius and removes applications at the fixed refresh", () => {
    const content = createAuraScenario("aura-range-boundary").content;
    const source = auraGroup("source", "ember", 0, 0, DEFAULT_AURA_MEMBER_TEMPLATE_ID);
    const boundary = auraGroup("boundary", "ember", 3, 0, DEFAULT_MEMBER_TEMPLATE_ID);
    const outside = auraGroup("outside", "ember", 3, 1, DEFAULT_MEMBER_TEMPLATE_ID);
    const initial = resolveActiveAuras(content, [outside, boundary, source], 7);

    expect(initial.filter((aura) => aura.targetGroupId === boundary.id)).toHaveLength(1);
    expect(initial.filter((aura) => aura.targetGroupId === outside.id)).toHaveLength(0);
    expect(initial.find((aura) => aura.targetGroupId === boundary.id)).toMatchObject({
      sourceId: auraSourceId("source-member", DEFAULT_AURA_ABILITY_TEMPLATE_ID),
      distanceSquared: 9,
      appliedAt: 7,
    });

    const movedOutside = { ...boundary, cell: { x: 4, z: 0 } };
    const refreshed = resolveActiveAuras(content, [source, movedOutside], 8, initial);
    expect(refreshed.filter((aura) => aura.targetGroupId === boundary.id)).toHaveLength(0);
  });

  it("stacks unique sources or selects the strongest source by stable ID", () => {
    const baseContent = cloneBattleContent(createAuraScenario("aura-stacking").content);
    const sourceA = auraGroup("source-a", "ember", 0, 0, DEFAULT_AURA_MEMBER_TEMPLATE_ID);
    const sourceB = auraGroup("source-b", "ember", 0, 1, DEFAULT_AURA_MEMBER_TEMPLATE_ID);
    const target = auraGroup("target", "ember", 2, 0, DEFAULT_MEMBER_TEMPLATE_ID);
    const stacked = resolveActiveAuras(baseContent, [sourceB, target, sourceA], 4);

    expect(stacked.filter((aura) => aura.targetGroupId === target.id)).toHaveLength(2);
    expect(auraModifierBps(stacked, target.id, "suppression-resistance-bps")).toBe(3_000);

    const aura = baseContent.abilityTemplates[DEFAULT_AURA_ABILITY_TEMPLATE_ID]!;
    if (aura.kind !== "aura") {
      throw new Error("Expected aura ability template.");
    }
    const strongestContent = {
      ...baseContent,
      abilityTemplates: {
        ...baseContent.abilityTemplates,
        [aura.id]: { ...aura, stacking: "strongest" as const },
      },
    };
    const strongest = resolveActiveAuras(strongestContent, [sourceB, target, sourceA], 4);
    const targetAuras = strongest.filter((application) => application.targetGroupId === target.id);

    expect(targetAuras).toHaveLength(1);
    expect(targetAuras[0]?.sourceMemberId).toBe("source-a-member");
    expect(auraModifierBps(strongest, target.id, "suppression-resistance-bps")).toBe(1_500);
  });

  it("preserves application age and removes incapacitated, dead, or evacuated sources", () => {
    const content = createAuraScenario("aura-source-lifecycle").content;
    const target = auraGroup("target", "ember", 1, 0, DEFAULT_MEMBER_TEMPLATE_ID);
    const source = auraGroup("source", "ember", 0, 0, DEFAULT_AURA_MEMBER_TEMPLATE_ID);
    const initial = resolveActiveAuras(content, [source, target], 12);
    const stable = resolveActiveAuras(content, [source, target], 13, initial);

    expect(stable.find((aura) => aura.targetGroupId === target.id)?.appliedAt).toBe(12);
    for (const memberState of [
      { health: "incapacitated" as const, presence: "deployed" as const },
      { health: "dead" as const, presence: "deployed" as const },
      { health: "healthy" as const, presence: "evacuated" as const },
    ]) {
      const unavailableSource = {
        ...source,
        members: source.members.map((member) => ({ ...member, ...memberState })),
      };
      expect(resolveActiveAuras(content, [unavailableSource, target], 14, stable)).toEqual([]);
    }
  });

  it("applies aura state to group facts and replays identical per-tick hashes", () => {
    const base = createAuraScenario("aura-runtime-hash");
    const source = base.groups.find(
      (group) =>
        group.factionId === "ember" &&
        group.groupTemplateId === DEFAULT_AURA_GROUP_TEMPLATE_ID,
    )!;
    const target = base.groups.find(
      (group) => group.factionId === "ember" && group.id !== source.id,
    )!;
    const setup = {
      ...base,
      groups: base.groups.map((group) =>
        group.id === target.id
          ? { ...group, spawn: { x: source.spawn.x, z: source.spawn.z + 2 } }
          : group,
      ),
    };
    const first = createSimulation(setup);
    const second = createSimulation(setup);
    const inspection = first.inspect(target.id) as GroupInspection;

    expect(inspection.suppressionResistanceBps).toBe(1_500);
    expect(inspection.activeAuras).toEqual([
      expect.objectContaining({
        sourceGroupId: source.id,
        targetGroupId: target.id,
        abilityTemplateId: DEFAULT_AURA_ABILITY_TEMPLATE_ID,
        distanceSquared: 4,
      }),
    ]);
    expect(first.getStateHash()).toBe(second.getStateHash());
    for (let tick = 0; tick < 80; tick += 1) {
      first.step();
      second.step();
      expect(first.getStateHash()).toBe(second.getStateHash());
    }
  });

  it("does not expose active aura sources through enemy known contacts", () => {
    const base = createAuraScenario("aura-observer-boundary", 1);
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
    expect(known?.activeAuras).toBeUndefined();
    expect(known?.passiveAbilities).toBeUndefined();
    expect(known?.suppressionResistanceBps).toBeUndefined();
    expect(simulation.inspect(azure.members[0]!.id, "ember")).toBeUndefined();
    expect(simulation.inspect(ember.id, "ember")).toMatchObject({
      activeAuras: [expect.objectContaining({ sourceGroupId: ember.id })],
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

function createAuraScenario(seed: string, groupsPerFaction = 2) {
  return createDemoBattleSetup({
    ...createDemoScenarioOptions("aura-ability", seed),
    groupsPerFaction,
    width: 30,
    height: 20,
  });
}

function auraGroup(
  id: string,
  factionId: string,
  x: number,
  z: number,
  memberTemplateId: string,
): AuraGroupContext {
  return {
    id,
    factionId,
    cell: { x, z },
    members: [
      {
        id: `${id}-member`,
        memberTemplateId,
        health: "healthy",
        presence: "deployed",
      },
    ],
  };
}
