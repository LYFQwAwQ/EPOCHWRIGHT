import { describe, expect, it } from "vitest";
import { createDemoBattleSetup, createDemoScenarioOptions } from "../demo";
import {
  BATTLE_CONTENT_VERSION,
  DEFAULT_ACTIVE_ABILITY_TEMPLATE_ID,
  DEFAULT_AURA_ABILITY_TEMPLATE_ID,
  DEFAULT_HERO_GROUP_TEMPLATE_ID,
  DEFAULT_HERO_MEMBER_TEMPLATE_ID,
  DEFAULT_HERO_SQUAD_GROUP_TEMPLATE_ID,
  DEFAULT_PASSIVE_ABILITY_TEMPLATE_ID,
  createDefaultBattleContent,
  createSimulation,
  hashBattleSetup,
  validateBattleContent,
  validateBattleSetup,
} from "./index";
import type {
  BattleSetup,
  GroupSpawn,
  HealthState,
  MemberSpawn,
  PresenceState,
} from "./types";

function createHeroSetup(seed: string): BattleSetup {
  return createDemoBattleSetup(createDemoScenarioOptions("hero-showcase", seed));
}

function replaceMember(
  setup: BattleSetup,
  memberId: string,
  replace: (member: MemberSpawn) => MemberSpawn,
): BattleSetup {
  return {
    ...setup,
    groups: setup.groups.map((group) => ({
      ...group,
      members: group.members.map((member) =>
        member.id === memberId ? replace(member) : member,
      ),
    })),
  };
}

function heroMember(group: GroupSpawn): MemberSpawn {
  const member = group.members.find((candidate) => candidate.hero !== undefined);
  if (!member) {
    throw new Error(`Group ${group.id} has no hero member.`);
  }
  return member;
}

describe("persistent hero members", () => {
  it("registers explicit independent and embedded hero slots in content-10", () => {
    const content = createDefaultBattleContent();
    const independent = content.groupTemplates[DEFAULT_HERO_GROUP_TEMPLATE_ID]!;
    const embedded = content.groupTemplates[DEFAULT_HERO_SQUAD_GROUP_TEMPLATE_ID]!;
    const member = content.memberTemplates[DEFAULT_HERO_MEMBER_TEMPLATE_ID]!;

    expect(content.contentVersion).toBe(BATTLE_CONTENT_VERSION);
    expect(independent.memberSlotRules).toEqual([
      expect.objectContaining({
        memberTemplateId: DEFAULT_HERO_MEMBER_TEMPLATE_ID,
        count: 1,
        hero: true,
      }),
    ]);
    expect(embedded.memberSlotRules).toEqual([
      expect.objectContaining({
        memberTemplateId: DEFAULT_HERO_MEMBER_TEMPLATE_ID,
        count: 1,
        hero: true,
      }),
      expect.objectContaining({ count: 7, hero: false }),
    ]);
    expect(member.tags).toContain("hero");
    expect(member.abilityTemplateIds).toEqual([]);
    expect(() => validateBattleContent(content)).not.toThrow();
  });

  it("validates hero slots, persistent IDs, importance, and instance abilities", () => {
    const setup = createHeroSetup("hero-validation");
    const independent = setup.groups.find(
      (group) => group.id === "ember-hero-independent-1",
    )!;
    const independentHero = heroMember(independent);
    const ordinary = setup.groups.find((group) => group.id === "ember-squad-3")!;
    const ordinaryMember = ordinary.members[0]!;

    expect(() => validateBattleSetup(setup)).not.toThrow();
    expect(() =>
      validateBattleSetup(
        replaceMember(setup, independentHero.id, (member) => ({
          ...member,
          persistentId: undefined,
        })),
      ),
    ).toThrow(/persistent ID/i);
    expect(() =>
      validateBattleSetup(
        replaceMember(setup, independentHero.id, (member) => ({
          ...member,
          hero: { ...member.hero!, importanceBps: 0 },
        })),
      ),
    ).toThrow(/importance/i);
    expect(() =>
      validateBattleSetup(
        replaceMember(setup, independentHero.id, (member) => ({
          ...member,
          hero: { ...member.hero!, abilityTemplateIds: ["missing-ability"] },
        })),
      ),
    ).toThrow(/ability references/i);
    expect(() =>
      validateBattleSetup(
        replaceMember(setup, independentHero.id, (member) => ({
          ...member,
          hero: {
            ...member.hero!,
            abilityTemplateIds: [
              DEFAULT_PASSIVE_ABILITY_TEMPLATE_ID,
              DEFAULT_PASSIVE_ABILITY_TEMPLATE_ID,
            ],
          },
        })),
      ),
    ).toThrow(/ability references/i);
    expect(() =>
      validateBattleSetup(
        replaceMember(setup, independentHero.id, (member) => ({
          ...member,
          hero: undefined,
        })),
      ),
    ).toThrow(/hero slot count/i);
    expect(() =>
      validateBattleSetup(
        replaceMember(setup, ordinaryMember.id, (member) => ({
          ...member,
          persistentId: "campaign:ember:invalid-slot",
          hero: {
            importanceBps: 5_000,
            abilityTemplateIds: [DEFAULT_PASSIVE_ABILITY_TEMPLATE_ID],
          },
        })),
      ),
    ).toThrow(/hero slot count/i);

    const embeddedHero = heroMember(
      setup.groups.find((group) => group.id === "ember-hero-embedded-1")!,
    );
    expect(() =>
      validateBattleSetup(
        replaceMember(setup, embeddedHero.id, (member) => ({
          ...member,
          persistentId: independentHero.persistentId,
        })),
      ),
    ).toThrow(/globally unique/i);
  });

  it("hashes hero metadata canonically and deep-clones external profiles", () => {
    const setup = createHeroSetup("hero-hash-clone");
    const group = setup.groups.find((candidate) => candidate.id === "ember-hero-independent-1")!;
    const member = heroMember(group);
    const reordered = replaceMember(setup, member.id, (candidate) => ({
      ...candidate,
      hero: {
        ...candidate.hero!,
        abilityTemplateIds: [...candidate.hero!.abilityTemplateIds].reverse(),
      },
    }));
    const changedImportance = replaceMember(setup, member.id, (candidate) => ({
      ...candidate,
      hero: { ...candidate.hero!, importanceBps: candidate.hero!.importanceBps - 1 },
    }));
    const changedPersistentId = replaceMember(setup, member.id, (candidate) => ({
      ...candidate,
      persistentId: `${candidate.persistentId}:changed`,
    }));

    expect(hashBattleSetup(reordered)).toBe(hashBattleSetup(setup));
    expect(hashBattleSetup(changedImportance)).not.toBe(hashBattleSetup(setup));
    expect(hashBattleSetup(changedPersistentId)).not.toBe(hashBattleSetup(setup));
    expect(createSimulation(reordered).getStateHash()).toBe(createSimulation(setup).getStateHash());

    const simulation = createSimulation(setup);
    const firstSnapshot = simulation.getSetup();
    const snapshotHero = heroMember(
      firstSnapshot.groups.find((candidate) => candidate.id === group.id)!,
    );
    (snapshotHero.hero!.abilityTemplateIds as string[]).push("mutated-outside");
    const secondSnapshotHero = heroMember(
      simulation.getSetup().groups.find((candidate) => candidate.id === group.id)!,
    );
    expect(secondSnapshotHero.hero!.abilityTemplateIds).not.toContain("mutated-outside");
  });

  it("reuses ordinary passive, aura, and active handlers for hero instance abilities", () => {
    const setup = createHeroSetup("hero-ability-reuse");
    const simulation = createSimulation(setup);
    const groupId = "ember-hero-independent-1";
    const groupSpawn = setup.groups.find((group) => group.id === groupId)!;
    const member = heroMember(groupSpawn);
    const group = simulation.inspect(groupId);
    const memberInspection = simulation.inspect(member.id);
    const renderedHero = simulation.getRenderFrame().members.find(
      (candidate) => candidate.id === member.id,
    );

    expect(group).toMatchObject({
      kind: "group",
      heroes: [
        {
          memberId: member.id,
          persistentId: member.persistentId,
          importanceBps: 9_000,
        },
      ],
      suppressionResistanceBps: 3_500,
    });
    expect(group?.kind === "group" ? group.passiveAbilities : []).toEqual([
      expect.objectContaining({
        sourceMemberId: member.id,
        abilityTemplateId: DEFAULT_PASSIVE_ABILITY_TEMPLATE_ID,
      }),
    ]);
    expect(group?.kind === "group" ? group.activeAuras : []).toContainEqual(
      expect.objectContaining({
        sourceMemberId: member.id,
        abilityTemplateId: DEFAULT_AURA_ABILITY_TEMPLATE_ID,
        targetGroupId: groupId,
      }),
    );
    expect(group?.kind === "group" ? group.activeAbilities : []).toEqual([
      expect.objectContaining({
        sourceMemberId: member.id,
        abilityTemplateId: DEFAULT_ACTIVE_ABILITY_TEMPLATE_ID,
      }),
    ]);
    expect(memberInspection).toMatchObject({
      kind: "member",
      persistentId: member.persistentId,
      hero: {
        importanceBps: 9_000,
        abilityTemplateIds: member.hero!.abilityTemplateIds,
      },
    });
    expect(renderedHero?.hero).toBe(true);
  });

  it("keeps hero identity and profiles out of hostile known-contact inspection", () => {
    const setup = createHeroSetup("hero-observer-boundary");
    const simulation = createSimulation(setup);
    const groupId = "ember-hero-independent-1";
    const memberId = heroMember(setup.groups.find((group) => group.id === groupId)!).id;
    let known = simulation.inspect(groupId, "azure");

    while (!known && !simulation.getResult() && simulation.tick < 1_200) {
      simulation.step();
      known = simulation.inspect(groupId, "azure");
    }

    expect(known).toMatchObject({ kind: "group", visibility: "known" });
    expect(known?.kind === "group" ? known.heroes : undefined).toBeUndefined();
    expect(known?.kind === "group" ? known.passiveAbilities : undefined).toBeUndefined();
    expect(known?.kind === "group" ? known.activeAuras : undefined).toBeUndefined();
    expect(known?.kind === "group" ? known.activeAbilities : undefined).toBeUndefined();
    expect(simulation.inspect(memberId, "azure")).toBeUndefined();
    expect(
      simulation.getRenderFrame("azure").members.every(
        (member) => member.factionId === "azure",
      ),
    ).toBe(true);
  }, 20_000);

  it("keeps hero simulations deterministic across health and ability lifecycle changes", () => {
    const setup = createHeroSetup("hero-determinism");
    const first = createSimulation(setup);
    const second = createSimulation(setup);

    for (let tick = 0; tick < 360 && !first.getResult(); tick += 1) {
      first.step();
      second.step();
      expect(second.getStateHash()).toBe(first.getStateHash());
    }
    expect(second.getResult()).toEqual(first.getResult());
  }, 20_000);

  it("returns killed, evacuated, and undeployed heroes without changing member state axes", () => {
    const source = createHeroSetup("hero-result-projection");
    const deferredGroup = source.groups.find(
      (group) => group.id === "azure-hero-embedded-1",
    )!;
    const setup: BattleSetup = {
      ...source,
      groups: source.groups.filter((group) => group.id !== deferredGroup.id),
      reinforcementEntrances: [
        {
          id: "azure-hero-entrance",
          factionId: "azure",
          cells: [{ x: source.map.width - 1, z: deferredGroup.spawn.z }],
          capacityPerTick: 1,
        },
      ],
      reinforcements: [
        {
          id: "azure-hero-wave",
          factionId: "azure",
          arrivalTick: 100,
          entranceIds: ["azure-hero-entrance"],
          groups: [deferredGroup],
          blockedPolicy: "wait",
        },
      ],
      rules: {
        ...source.rules,
        maximumDurationTicks: 1,
      },
    };
    validateBattleSetup(setup);
    const simulation = createSimulation(setup);
    const killedId = heroMember(
      setup.groups.find((group) => group.id === "ember-hero-independent-1")!,
    ).id;
    const evacuatedId = heroMember(
      setup.groups.find((group) => group.id === "ember-hero-embedded-1")!,
    ).id;
    const undeployedHero = heroMember(deferredGroup);
    const internals = simulation as unknown as {
      readonly state: {
        readonly membersById: Map<
          string,
          { health: HealthState; presence: PresenceState }
        >;
      };
    };
    internals.state.membersById.get(killedId)!.health = "dead";
    internals.state.membersById.get(evacuatedId)!.health = "wounded";
    internals.state.membersById.get(evacuatedId)!.presence = "evacuated";

    simulation.step(4);
    const result = simulation.getResult();
    const killed = result?.members.find((member) => member.id === killedId);
    const evacuated = result?.members.find((member) => member.id === evacuatedId);
    const undeployed = result?.members.find((member) => member.id === undeployedHero.id);

    expect(killed).toMatchObject({
      health: "dead",
      presence: "deployed",
      disposition: "present",
      deployment: "deployed",
      persistentId: expect.stringContaining("campaign:"),
      hero: expect.objectContaining({ importanceBps: 9_000 }),
    });
    expect(evacuated).toMatchObject({
      health: "wounded",
      presence: "evacuated",
      disposition: "evacuated",
      deployment: "evacuated",
      hero: expect.objectContaining({ importanceBps: 7_500 }),
    });
    expect(undeployed).toMatchObject({
      health: "healthy",
      presence: "undeployed",
      disposition: "undeployed",
      deployment: "undeployed",
      persistentId: undeployedHero.persistentId,
      hero: undeployedHero.hero,
    });

    const finalHash = simulation.getStateHash();
    const finalResult = structuredClone(result);
    simulation.step(20);
    expect(simulation.getStateHash()).toBe(finalHash);
    expect(simulation.getResult()).toEqual(finalResult);
  });
});
