import type {
  AbilityAttribute,
  AbilityCondition,
  AbilityTemplate,
  BattleContentBundle,
  HealthState,
  MemberAttributeInspection,
  MemberId,
  PassiveAbilityInspection,
  PresenceState,
  TemplateId,
} from "./types";

export interface AbilityMemberContext {
  readonly id: MemberId;
  readonly memberTemplateId: TemplateId;
  readonly health: HealthState;
  readonly presence: PresenceState;
}

export function memberAbilityAttributes(
  content: BattleContentBundle,
  member: AbilityMemberContext,
): MemberAttributeInspection {
  return {
    protectionBps: memberAbilityAttributeBps(content, member, "protection-bps"),
    suppressionResistanceBps: memberAbilityAttributeBps(
      content,
      member,
      "suppression-resistance-bps",
    ),
    capturePowerBps: memberAbilityAttributeBps(content, member, "capture-power-bps"),
  };
}

export function memberAbilityAttributeBps(
  content: BattleContentBundle,
  member: AbilityMemberContext,
  attribute: AbilityAttribute,
): number {
  const memberTemplate = content.memberTemplates[member.memberTemplateId];
  if (!memberTemplate) {
    throw new Error(`Unknown member template: ${member.memberTemplateId}.`);
  }
  const base = attributeBaseValue(memberTemplate, attribute);
  const modifier = abilityTemplatesForMember(content, member.memberTemplateId)
    .filter(
      (ability) =>
        ability.targetRule === "self" && evaluatePassiveAbility(ability, member).active,
    )
    .flatMap((ability) => ability.effects)
    .filter((effect) => effect.attribute === attribute)
    .reduce((sum, effect) => sum + effect.modifierBps, 0);
  return clampBasisPoints(base + modifier);
}

export function ownGroupAbilityModifierBps(
  content: BattleContentBundle,
  members: readonly AbilityMemberContext[],
  attribute: Exclude<AbilityAttribute, "protection-bps">,
): number {
  return [...members]
    .sort((a, b) => compareStrings(a.id, b.id))
    .flatMap((member) =>
      abilityTemplatesForMember(content, member.memberTemplateId)
        .filter(
          (ability) =>
            ability.targetRule === "own-group" &&
            evaluatePassiveAbility(ability, member).active,
        )
        .flatMap((ability) => ability.effects)
        .filter((effect) => effect.attribute === attribute),
    )
    .reduce((sum, effect) => sum + effect.modifierBps, 0);
}

export function passiveAbilityInspections(
  content: BattleContentBundle,
  members: readonly AbilityMemberContext[],
): readonly PassiveAbilityInspection[] {
  return [...members]
    .sort((a, b) => compareStrings(a.id, b.id))
    .flatMap((member) =>
      abilityTemplatesForMember(content, member.memberTemplateId).map((ability) => {
        const evaluation = evaluatePassiveAbility(ability, member);
        return {
          sourceMemberId: member.id,
          abilityTemplateId: ability.id,
          displayName: ability.displayName,
          targetRule: ability.targetRule,
          active: evaluation.active,
          unmetCondition: evaluation.unmetCondition,
          effects: ability.effects.map((effect) => ({ ...effect })),
        } satisfies PassiveAbilityInspection;
      }),
    );
}

export function evaluatePassiveAbility(
  ability: AbilityTemplate,
  member: AbilityMemberContext,
): { readonly active: boolean; readonly unmetCondition?: AbilityCondition["kind"] } {
  const health = ability.conditions.find((condition) => condition.kind === "health");
  if (health?.kind === "health" && !health.states.includes(member.health)) {
    return { active: false, unmetCondition: "health" };
  }
  const presence = ability.conditions.find((condition) => condition.kind === "presence");
  if (presence?.kind === "presence" && !presence.states.includes(member.presence)) {
    return { active: false, unmetCondition: "presence" };
  }
  return { active: true };
}

export function clampBasisPoints(value: number): number {
  return Math.max(0, Math.min(10_000, value));
}

function abilityTemplatesForMember(
  content: BattleContentBundle,
  memberTemplateId: TemplateId,
): readonly AbilityTemplate[] {
  const memberTemplate = content.memberTemplates[memberTemplateId];
  if (!memberTemplate) {
    throw new Error(`Unknown member template: ${memberTemplateId}.`);
  }
  return [...memberTemplate.abilityTemplateIds]
    .sort(compareStrings)
    .map((abilityId) => {
      const ability = content.abilityTemplates[abilityId];
      if (!ability) {
        throw new Error(`Unknown ability template: ${abilityId}.`);
      }
      return ability;
    });
}

function attributeBaseValue(
  template: BattleContentBundle["memberTemplates"][string],
  attribute: AbilityAttribute,
): number {
  switch (attribute) {
    case "protection-bps":
      return template.protectionBps;
    case "suppression-resistance-bps":
      return template.suppressionResistanceBps;
    case "capture-power-bps":
      return template.capturePowerBps;
  }
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
