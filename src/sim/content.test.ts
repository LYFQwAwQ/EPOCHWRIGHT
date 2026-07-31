import { describe, expect, it } from "vitest";
import { createDemoBattleSetup } from "../demo/setup";
import {
  BATTLE_SETUP_SCHEMA_VERSION,
  DEFAULT_AIR_ATTACK_GROUP_TEMPLATE_ID,
  DEFAULT_AIR_ATTACK_PLATFORM_TEMPLATE_ID,
  DEFAULT_AIR_DRONE_GROUP_TEMPLATE_ID,
  DEFAULT_AIR_DRONE_PLATFORM_TEMPLATE_ID,
  DEFAULT_AIR_TO_AIR_WEAPON_TEMPLATE_ID,
  DEFAULT_AIR_TO_GROUND_WEAPON_TEMPLATE_ID,
  DEFAULT_DRONE_OPERATOR_MEMBER_TEMPLATE_ID,
  DEFAULT_GROUP_TEMPLATE_ID,
  DEFAULT_MEMBER_TEMPLATE_ID,
  DEFAULT_PASSIVE_ABILITY_TEMPLATE_ID,
  DEFAULT_PASSIVE_MEMBER_TEMPLATE_ID,
  DEFAULT_PLATFORM_WEAPON_TEMPLATE_ID,
  DEFAULT_WEAPON_TEMPLATE_ID,
  PRE_AIR_UNITS_BATTLE_CONTENT_VERSION,
  PRE_PASSIVE_ABILITY_BATTLE_CONTENT_VERSION,
  PRE_PLATFORM_BATTLE_RULES_VERSION,
  cloneBattleContent,
  createDefaultBattleContent,
  createSimulation,
  hashBattleContent,
  migrateBattleSetup,
  validateBattleContent,
  validateBattleSetup,
} from "./index";
import type { BattleSetupInput, MemberInspection } from "./types";

describe("battle content templates", () => {
  it("migrates pre-content setup input to stage-3 with explicit template references", () => {
    const current = createDemoBattleSetup({ seed: "content-migration", groupsPerFaction: 1 });
    const legacy = {
      ...current,
      schemaVersion: "stage-2.1",
      rulesVersion: PRE_PLATFORM_BATTLE_RULES_VERSION,
      content: undefined,
      groups: current.groups.map((group) => ({
        ...group,
        groupTemplateId: undefined,
        members: group.members.map((member) => ({
          ...member,
          memberTemplateId: undefined,
        })),
      })),
    } satisfies BattleSetupInput;

    const migrated = migrateBattleSetup(legacy);

    expect(migrated.schemaVersion).toBe(BATTLE_SETUP_SCHEMA_VERSION);
    expect(migrated.content?.contentVersion).toBe("content-7");
    expect(migrated.groups.every((group) => group.groupTemplateId === DEFAULT_GROUP_TEMPLATE_ID))
      .toBe(true);
    expect(
      migrated.groups.every((group) =>
        group.members.every((member) => member.memberTemplateId === DEFAULT_MEMBER_TEMPLATE_ID),
      ),
    ).toBe(true);
    expect(() => validateBattleSetup(migrated)).not.toThrow();
  });

  it("registers armed helicopter and scout drone content with explicit hover capabilities", () => {
    const content = createDefaultBattleContent();
    const attackGroup = content.groupTemplates[DEFAULT_AIR_ATTACK_GROUP_TEMPLATE_ID]!;
    const attackPlatform = content.platformTemplates[DEFAULT_AIR_ATTACK_PLATFORM_TEMPLATE_ID]!;
    const droneGroup = content.groupTemplates[DEFAULT_AIR_DRONE_GROUP_TEMPLATE_ID]!;
    const dronePlatform = content.platformTemplates[DEFAULT_AIR_DRONE_PLATFORM_TEMPLATE_ID]!;

    expect(attackGroup.behaviorProfileId).toBe("air-combat");
    expect(
      attackPlatform.componentRules
        .filter((component) => component.kind === "weapon")
        .map((component) => component.weaponTemplateId)
        .sort(),
    ).toEqual([
      DEFAULT_AIR_TO_AIR_WEAPON_TEMPLATE_ID,
      DEFAULT_AIR_TO_GROUND_WEAPON_TEMPLATE_ID,
    ].sort());
    expect(attackPlatform).toMatchObject({
      movementType: "hover",
      visualTypeId: "air-attack-helicopter",
    });
    expect(droneGroup.memberSlotRules).toHaveLength(1);
    expect(dronePlatform).toMatchObject({
      movementType: "hover",
      visualTypeId: "air-scout-drone",
    });
    expect(dronePlatform.componentRules.some((component) => component.kind === "weapon"))
      .toBe(false);
    expect(() => validateBattleContent(content)).not.toThrow();
  });

  it("migrates content-5 snapshots to content-7 without changing setup rules", () => {
    const current = createDemoBattleSetup({ seed: "air-units-content-migration", groupsPerFaction: 1 });
    const era = current.content.eraTemplates[current.content.eraId]!;
    const groupTemplates = Object.fromEntries(
      Object.entries(current.content.groupTemplates).filter(
        ([id]) =>
          id !== DEFAULT_AIR_ATTACK_GROUP_TEMPLATE_ID &&
          id !== DEFAULT_AIR_DRONE_GROUP_TEMPLATE_ID,
      ),
    );
    const memberTemplates = Object.fromEntries(
      Object.entries(current.content.memberTemplates).filter(
        ([id]) => id !== DEFAULT_DRONE_OPERATOR_MEMBER_TEMPLATE_ID,
      ),
    );
    const platformTemplates = Object.fromEntries(
      Object.entries(current.content.platformTemplates).filter(
        ([id]) =>
          id !== DEFAULT_AIR_ATTACK_PLATFORM_TEMPLATE_ID &&
          id !== DEFAULT_AIR_DRONE_PLATFORM_TEMPLATE_ID,
      ),
    );
    const migrated = migrateBattleSetup({
      ...current,
      content: {
        ...current.content,
        contentVersion: PRE_AIR_UNITS_BATTLE_CONTENT_VERSION,
        eraTemplates: {
          ...current.content.eraTemplates,
          [era.id]: {
            ...era,
            allowedGroupTemplateIds: era.allowedGroupTemplateIds.filter(
              (id) =>
                id !== DEFAULT_AIR_ATTACK_GROUP_TEMPLATE_ID &&
                id !== DEFAULT_AIR_DRONE_GROUP_TEMPLATE_ID,
            ),
            allowedMemberTemplateIds: era.allowedMemberTemplateIds.filter(
              (id) => id !== DEFAULT_DRONE_OPERATOR_MEMBER_TEMPLATE_ID,
            ),
            allowedPlatformTemplateIds: era.allowedPlatformTemplateIds.filter(
              (id) =>
                id !== DEFAULT_AIR_ATTACK_PLATFORM_TEMPLATE_ID &&
                id !== DEFAULT_AIR_DRONE_PLATFORM_TEMPLATE_ID,
            ),
          },
        },
        groupTemplates,
        memberTemplates,
        platformTemplates,
      },
    } satisfies BattleSetupInput);

    expect(migrated.rulesVersion).toBe(current.rulesVersion);
    expect(migrated.content.contentVersion).toBe("content-7");
    expect(migrated.content.groupTemplates[DEFAULT_AIR_ATTACK_GROUP_TEMPLATE_ID]).toBeUndefined();
    expect(migrated.content.groupTemplates[DEFAULT_AIR_DRONE_GROUP_TEMPLATE_ID]).toBeUndefined();
    expect(() => validateBattleSetup(migrated)).not.toThrow();
  });

  it("migrates content-6 snapshots with empty member ability references", () => {
    const current = createDemoBattleSetup({ seed: "passive-content-migration", groupsPerFaction: 1 });
    const migrated = migrateBattleSetup({
      ...current,
      content: {
        ...current.content,
        contentVersion: PRE_PASSIVE_ABILITY_BATTLE_CONTENT_VERSION,
      },
    } satisfies BattleSetupInput);

    expect(migrated.rulesVersion).toBe(current.rulesVersion);
    expect(migrated.content.contentVersion).toBe("content-7");
    expect(
      Object.values(migrated.content.memberTemplates).every(
        (member) => member.abilityTemplateIds.length === 0,
      ),
    ).toBe(true);
    expect(migrated.content.abilityTemplates).toEqual({});
    expect(() => validateBattleSetup(migrated)).not.toThrow();
  });

  it("rejects missing template references and roster mismatches before runtime state exists", () => {
    const setup = createDemoBattleSetup({ seed: "invalid-content-reference", groupsPerFaction: 1 });
    expect(() =>
      validateBattleSetup({ ...setup, content: undefined } satisfies BattleSetupInput),
    ).toThrow(/content bundle/i);

    const missingGroupTemplate = {
      ...setup,
      groups: setup.groups.map((group, index) =>
        index === 0 ? { ...group, groupTemplateId: undefined } : group,
      ),
    } satisfies BattleSetupInput;
    expect(() => validateBattleSetup(missingGroupTemplate)).toThrow(/requires a group template ID/i);

    const missingMember = {
      ...setup,
      groups: setup.groups.map((group, groupIndex) =>
        groupIndex === 0
          ? {
              ...group,
              members: group.members.map((member, memberIndex) =>
                memberIndex === 0
                  ? { ...member, memberTemplateId: "missing-member-template" }
                  : member,
              ),
            }
          : group,
      ),
    };
    expect(() => validateBattleSetup(missingMember)).toThrow(/unknown member template/i);

    const baseContent = cloneBattleContent(setup.content!);
    const groupTemplate = baseContent.groupTemplates[DEFAULT_GROUP_TEMPLATE_ID]!;
    const content = {
      ...baseContent,
      groupTemplates: {
        ...baseContent.groupTemplates,
        [groupTemplate.id]: {
          ...groupTemplate,
          memberSlotRules: groupTemplate.memberSlotRules.map((slot, index) =>
            index === 0 ? { ...slot, count: 7 } : slot,
          ),
        },
      },
    };
    expect(() => validateBattleSetup({ ...setup, content })).toThrow(/roster size/i);
  });

  it("rejects unsupported referenced capabilities and malformed weapon references", () => {
    const defaultContent = cloneBattleContent(createDefaultBattleContent());
    const memberTemplate = defaultContent.memberTemplates[DEFAULT_MEMBER_TEMPLATE_ID]!;
    const missingWeapon = {
      ...defaultContent,
      memberTemplates: {
        ...defaultContent.memberTemplates,
        [memberTemplate.id]: {
          ...memberTemplate,
          weaponSlotRules: memberTemplate.weaponSlotRules.map((slot, index) =>
            index === 0 ? { ...slot, weaponTemplateId: "missing-weapon-template" } : slot,
          ),
        },
      },
    };
    expect(() => validateBattleContent(missingWeapon)).toThrow(/weapon/i);

    const trajectoryBase = cloneBattleContent(createDefaultBattleContent());
    const trajectoryWeapon = trajectoryBase.weaponTemplates[DEFAULT_WEAPON_TEMPLATE_ID]!;
    const invalidProjectile = {
      ...trajectoryBase,
      weaponTemplates: {
        ...trajectoryBase.weaponTemplates,
        [trajectoryWeapon.id]: {
          ...trajectoryWeapon,
          fireModes: [{
            ...trajectoryWeapon.fireModes[0]!,
            trajectory: "logical-projectile" as const,
            projectileSpeedMmPerTick: 0,
            muzzleHeightMm: 1_000,
            apexHeightMm: 2_000,
            blastRadiusMm: 0,
            visualTypeId: "test-projectile",
          }],
        },
      },
    };
    expect(() => validateBattleContent(invalidProjectile)).toThrow(/projectile speed/i);

    const platformEffectBase = cloneBattleContent(createDefaultBattleContent());
    const platformWeapon =
      platformEffectBase.weaponTemplates[DEFAULT_PLATFORM_WEAPON_TEMPLATE_ID]!;
    const malformedPlatformEffect = {
      ...platformEffectBase,
      weaponTemplates: {
        ...platformEffectBase.weaponTemplates,
        [platformWeapon.id]: {
          ...platformWeapon,
          damageEffects: platformWeapon.damageEffects.map((effect) =>
            effect.kind === "platform-damage"
              ? { ...effect, penetrationRating: -1 }
              : effect,
          ),
        },
      },
    };
    expect(() => validateBattleContent(malformedPlatformEffect)).toThrow(/platform effect/i);

    const missingAbilityBase = cloneBattleContent(createDefaultBattleContent());
    const passiveMember = missingAbilityBase.memberTemplates[DEFAULT_PASSIVE_MEMBER_TEMPLATE_ID]!;
    const missingAbility = {
      ...missingAbilityBase,
      memberTemplates: {
        ...missingAbilityBase.memberTemplates,
        [passiveMember.id]: {
          ...passiveMember,
          abilityTemplateIds: ["missing-ability-template"],
        },
      },
    };
    expect(() => validateBattleContent(missingAbility)).toThrow(/unknown ability/i);

    const invalidGroupAbilityBase = cloneBattleContent(createDefaultBattleContent());
    const passiveAbility =
      invalidGroupAbilityBase.abilityTemplates[DEFAULT_PASSIVE_ABILITY_TEMPLATE_ID]!;
    const invalidGroupAbility = {
      ...invalidGroupAbilityBase,
      abilityTemplates: {
        ...invalidGroupAbilityBase.abilityTemplates,
        [passiveAbility.id]: {
          ...passiveAbility,
          effects: [{
            kind: "attribute-modifier" as const,
            attribute: "protection-bps" as const,
            modifierBps: 1_000,
          }],
        },
      },
    };
    expect(() => validateBattleContent(invalidGroupAbility)).toThrow(/group protection/i);

    const invalidCondition = {
      ...invalidGroupAbilityBase,
      abilityTemplates: {
        ...invalidGroupAbilityBase.abilityTemplates,
        [passiveAbility.id]: {
          ...passiveAbility,
          conditions: [{ kind: "health" as const, states: [] }],
        },
      },
    };
    expect(() => validateBattleContent(invalidCondition)).toThrow(/health condition/i);
  });

  it("hashes content canonically while excluding observation-only era labels", () => {
    const hashBase = cloneBattleContent(createDefaultBattleContent());
    const era = hashBase.eraTemplates[hashBase.eraId]!;
    const first = {
      ...hashBase,
      eraTemplates: {
        ...hashBase.eraTemplates,
        [era.id]: { ...era, displayName: "观察名称 A", tags: ["second", "first"] },
      },
      statusTemplates: {
        beta: { id: "beta", tags: ["second", "first"] },
        alpha: { id: "alpha", tags: [] },
      },
    };

    const second = {
      ...first,
      eraTemplates: {
        ...first.eraTemplates,
        [era.id]: { ...era, displayName: "观察名称 B", tags: ["first", "second"] },
      },
      statusTemplates: {
        alpha: { id: "alpha", tags: [] },
        beta: { id: "beta", tags: ["first", "second"] },
      },
    };

    expect(hashBattleContent(first)).toBe(hashBattleContent(second));

    const platformWeapon = first.weaponTemplates[DEFAULT_PLATFORM_WEAPON_TEMPLATE_ID]!;
    const changedPenetration = {
      ...first,
      weaponTemplates: {
        ...first.weaponTemplates,
        [platformWeapon.id]: {
          ...platformWeapon,
          damageEffects: platformWeapon.damageEffects.map((effect) =>
            effect.kind === "platform-damage"
              ? { ...effect, penetrationRating: effect.penetrationRating + 1 }
              : effect,
          ),
        },
      },
    };
    expect(hashBattleContent(changedPenetration)).not.toBe(hashBattleContent(first));

    const passiveAbility = first.abilityTemplates[DEFAULT_PASSIVE_ABILITY_TEMPLATE_ID]!;
    const renamedAbility = {
      ...first,
      abilityTemplates: {
        ...first.abilityTemplates,
        [passiveAbility.id]: { ...passiveAbility, displayName: "仅观察名称" },
      },
    };
    expect(hashBattleContent(renamedAbility)).toBe(hashBattleContent(first));

    const changedAbility = {
      ...first,
      abilityTemplates: {
        ...first.abilityTemplates,
        [passiveAbility.id]: {
          ...passiveAbility,
          effects: passiveAbility.effects.map((effect) => ({
            ...effect,
            modifierBps: effect.modifierBps + 1,
          })),
        },
      },
    };
    expect(hashBattleContent(changedAbility)).not.toBe(hashBattleContent(first));
  });

  it("initializes member weapon state from content data", () => {
    const setup = createDemoBattleSetup({ seed: "content-runtime", groupsPerFaction: 1 });
    const baseContent = cloneBattleContent(setup.content!);
    const weapon = baseContent.weaponTemplates[DEFAULT_WEAPON_TEMPLATE_ID]!;
    const content = {
      ...baseContent,
      weaponTemplates: {
        ...baseContent.weaponTemplates,
        [weapon.id]: { ...weapon, magazineSize: 3 },
      },
    };
    const simulation = createSimulation({ ...setup, content });
    const memberId = setup.groups[0]!.members[0]!.id;

    expect(simulation.inspect(memberId)).toMatchObject({
      kind: "member",
      magazineRounds: 3,
    } satisfies Partial<MemberInspection>);
  });
});
