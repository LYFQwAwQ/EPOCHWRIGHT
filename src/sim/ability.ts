import { squaredGridDistance } from "./map";
import type {
  AbilityAttribute,
  AbilityCondition,
  AttributeModifierAbilityEffect,
  AbilityTemplate,
  ActiveAbilityCandidateInspection,
  ActiveAbilityEvaluationInspection,
  ActiveAbilityEvaluationReason,
  ActiveAbilityInspection,
  ActiveAbilityTemplate,
  AuraAbilityTemplate,
  AuraApplicationInspection,
  BattleContentBundle,
  FactionId,
  GridCoord,
  GroupId,
  HealthState,
  MemberAttributeInspection,
  MemberId,
  PassiveAbilityInspection,
  PassiveAbilityTemplate,
  PresenceState,
  TemplateId,
  Tick,
} from "./types";

export interface AbilityMemberContext {
  readonly id: MemberId;
  readonly memberTemplateId: TemplateId;
  readonly health: HealthState;
  readonly presence: PresenceState;
}

export interface AuraGroupContext {
  readonly id: GroupId;
  readonly factionId: FactionId;
  readonly cell: GridCoord;
  readonly members: readonly AbilityMemberContext[];
}

export interface ActiveAuraApplication {
  readonly id: string;
  readonly sourceId: string;
  readonly sourceMemberId: MemberId;
  readonly sourceGroupId: GroupId;
  readonly abilityTemplateId: TemplateId;
  readonly targetGroupId: GroupId;
  readonly distanceSquared: number;
  readonly appliedAt: Tick;
  readonly effects: readonly AttributeModifierAbilityEffect[];
}

export interface ActiveAbilityRuntimeState {
  readonly id: string;
  readonly sourceMemberId: MemberId;
  readonly sourceGroupId: GroupId;
  readonly abilityTemplateId: TemplateId;
  chargesRemaining: number;
  cooldownUntilTick: Tick;
  useCount: number;
  lastUsedAt?: Tick;
  evaluation?: ActiveAbilityEvaluationInspection;
}

export interface ActiveAbilityGroupContext {
  readonly id: GroupId;
  readonly factionId: FactionId;
  readonly cell: GridCoord;
  readonly suppressionBps: number;
  readonly members: readonly AbilityMemberContext[];
}

interface AuraCandidate extends Omit<ActiveAuraApplication, "appliedAt"> {
  readonly ability: AuraAbilityTemplate;
}

export function memberAbilityAttributes(
  content: BattleContentBundle,
  member: AbilityMemberContext,
  auraProtectionModifierBps = 0,
): MemberAttributeInspection {
  return {
    protectionBps: clampBasisPoints(
      memberAbilityAttributeBps(content, member, "protection-bps") +
        auraProtectionModifierBps,
    ),
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
  const modifier = passiveAbilitiesForMember(content, member.memberTemplateId)
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
      passiveAbilitiesForMember(content, member.memberTemplateId)
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

export function resolveActiveAuras(
  content: BattleContentBundle,
  groups: readonly AuraGroupContext[],
  tick: Tick,
  previous: readonly ActiveAuraApplication[] = [],
): readonly ActiveAuraApplication[] {
  const sortedGroups = [...groups].sort((a, b) => compareStrings(a.id, b.id));
  const candidates: AuraCandidate[] = [];

  for (const sourceGroup of sortedGroups) {
    for (const member of [...sourceGroup.members].sort((a, b) => compareStrings(a.id, b.id))) {
      if (!isAuraSourceActive(member)) {
        continue;
      }
      for (const ability of auraAbilitiesForMember(content, member.memberTemplateId)) {
        if (!evaluateAbilityConditions(ability, member).active) {
          continue;
        }
        const sourceId = auraSourceId(member.id, ability.id);
        for (const targetGroup of sortedGroups) {
          if (
            targetGroup.factionId !== sourceGroup.factionId ||
            !targetGroup.members.some(isAuraTargetMemberActive)
          ) {
            continue;
          }
          const distanceSquared = squaredGridDistance(sourceGroup.cell, targetGroup.cell);
          if (
            (ability.targetRule === "own-group" && targetGroup.id !== sourceGroup.id) ||
            (ability.targetRule === "nearby-friendly-groups" &&
              distanceSquared > ability.rangeCells ** 2)
          ) {
            continue;
          }
          candidates.push({
            id: auraApplicationId(sourceId, targetGroup.id),
            sourceId,
            sourceMemberId: member.id,
            sourceGroupId: sourceGroup.id,
            abilityTemplateId: ability.id,
            targetGroupId: targetGroup.id,
            distanceSquared,
            effects: ability.effects.map((effect) => ({ ...effect })),
            ability,
          });
        }
      }
    }
  }

  const selected = selectStackedAuraCandidates(candidates);
  const previousById = new Map(previous.map((application) => [application.id, application]));
  return selected.map((candidate) => {
    const prior = previousById.get(candidate.id);
    return {
      id: candidate.id,
      sourceId: candidate.sourceId,
      sourceMemberId: candidate.sourceMemberId,
      sourceGroupId: candidate.sourceGroupId,
      abilityTemplateId: candidate.abilityTemplateId,
      targetGroupId: candidate.targetGroupId,
      distanceSquared: candidate.distanceSquared,
      appliedAt:
        prior && effectsEqual(prior.effects, candidate.effects) ? prior.appliedAt : tick,
      effects: candidate.effects.map((effect) => ({ ...effect })),
    };
  });
}

export function createActiveAbilityStates(
  content: BattleContentBundle,
  sourceMemberId: MemberId,
  sourceGroupId: GroupId,
  memberTemplateId: TemplateId,
): readonly ActiveAbilityRuntimeState[] {
  return abilityTemplatesForMember(content, memberTemplateId)
    .filter((ability): ability is ActiveAbilityTemplate => ability.kind === "active")
    .map((ability) => ({
      id: activeAbilityId(sourceMemberId, ability.id),
      sourceMemberId,
      sourceGroupId,
      abilityTemplateId: ability.id,
      chargesRemaining: ability.maxCharges,
      cooldownUntilTick: 0,
      useCount: 0,
    }));
}

export function evaluateActiveAbility(
  content: BattleContentBundle,
  state: ActiveAbilityRuntimeState,
  sourceMember: AbilityMemberContext,
  sourceGroup: ActiveAbilityGroupContext,
  groups: readonly ActiveAbilityGroupContext[],
  tick: Tick,
): { readonly evaluation: ActiveAbilityEvaluationInspection; readonly selectedTarget?: GroupId } {
  const ability = content.abilityTemplates[state.abilityTemplateId];
  if (!ability || ability.kind !== "active") {
    throw new Error(`Unknown active ability template: ${state.abilityTemplateId}.`);
  }
  const sourceCondition = evaluateAbilityConditions(ability, sourceMember);
  if (!sourceCondition.active) {
    return {
      evaluation: activeEvaluation(tick, "source-condition-unmet", []),
    };
  }
  if (state.chargesRemaining <= 0) {
    return { evaluation: activeEvaluation(tick, "charges-depleted", []) };
  }
  if (tick < state.cooldownUntilTick) {
    return { evaluation: activeEvaluation(tick, "cooldown-active", []) };
  }

  const candidates = [...groups]
    .filter((group) => group.factionId === sourceGroup.factionId)
    .filter((group) =>
      ability.targetRule === "own-group" ? group.id === sourceGroup.id : true,
    )
    .sort((a, b) => compareStrings(a.id, b.id))
    .map((group): ActiveAbilityCandidateInspection => {
      const distanceSquared = squaredGridDistance(sourceGroup.cell, group.cell);
      const isAvailable = group.members.some(isAuraTargetMemberActive);
      const inRange =
        ability.targetRule === "own-group" || distanceSquared <= ability.rangeCells ** 2;
      const trigger = ability.triggerConditions.find(
        (condition) => condition.kind === "target-suppression",
      );
      const recoverableSuppressionBps = Math.min(
        group.suppressionBps,
        activeAbilityRecoveryBps(ability),
      );
      const rejectionReason = !isAvailable
        ? "target-unavailable"
        : !inRange
          ? "out-of-range"
          : trigger && group.suppressionBps < trigger.minimumBps
            ? "trigger-unmet"
            : recoverableSuppressionBps <= 0
              ? "no-effect"
              : undefined;
      return {
        targetGroupId: group.id,
        distanceSquared,
        suppressionBps: group.suppressionBps,
        recoverableSuppressionBps,
        score: rejectionReason ? 0 : recoverableSuppressionBps,
        rejectionReason,
      };
    });
  const selected = candidates
    .filter((candidate) => !candidate.rejectionReason)
    .sort((a, b) => b.score - a.score || compareStrings(a.targetGroupId, b.targetGroupId))[0];
  if (selected) {
    return {
      evaluation: activeEvaluation(tick, "ready", candidates, selected.targetGroupId),
      selectedTarget: selected.targetGroupId,
    };
  }
  const hasLegalTarget = candidates.some(
    (candidate) =>
      candidate.rejectionReason === "trigger-unmet" ||
      candidate.rejectionReason === "no-effect",
  );
  return {
    evaluation: activeEvaluation(
      tick,
      hasLegalTarget ? "trigger-unmet" : "no-legal-target",
      candidates,
    ),
  };
}

export function activeAbilityInspections(
  content: BattleContentBundle,
  states: readonly ActiveAbilityRuntimeState[],
): readonly ActiveAbilityInspection[] {
  return [...states]
    .sort((a, b) => compareStrings(a.id, b.id))
    .map((state) => {
      const ability = content.abilityTemplates[state.abilityTemplateId];
      if (!ability || ability.kind !== "active") {
        throw new Error(`Unknown active ability template: ${state.abilityTemplateId}.`);
      }
      return {
        id: state.id,
        sourceMemberId: state.sourceMemberId,
        sourceGroupId: state.sourceGroupId,
        abilityTemplateId: state.abilityTemplateId,
        displayName: ability.displayName,
        targetRule: ability.targetRule,
        rangeCells: ability.rangeCells,
        cooldownTicks: ability.cooldownTicks,
        maxCharges: ability.maxCharges,
        chargesRemaining: state.chargesRemaining,
        cooldownUntilTick: state.cooldownUntilTick,
        useCount: state.useCount,
        lastUsedAt: state.lastUsedAt,
        triggerConditions: ability.triggerConditions.map((condition) => ({ ...condition })),
        effects: ability.effects.map((effect) => ({ ...effect })),
        evaluation: state.evaluation
          ? {
              ...state.evaluation,
              candidates: state.evaluation.candidates.map((candidate) => ({ ...candidate })),
            }
          : undefined,
      } satisfies ActiveAbilityInspection;
    });
}

export function activeAbilityRecoveryBps(ability: ActiveAbilityTemplate): number {
  return ability.effects.reduce((sum, effect) => sum + effect.amountBps, 0);
}

export function activeAbilityId(memberId: MemberId, abilityTemplateId: TemplateId): string {
  return `active:${memberId.length}:${memberId}:${abilityTemplateId.length}:${abilityTemplateId}`;
}

export function auraModifierBps(
  applications: readonly ActiveAuraApplication[],
  targetGroupId: GroupId,
  attribute: AbilityAttribute,
): number {
  return applications
    .filter((application) => application.targetGroupId === targetGroupId)
    .flatMap((application) => application.effects)
    .filter((effect) => effect.attribute === attribute)
    .reduce((sum, effect) => sum + effect.modifierBps, 0);
}

export function auraApplicationInspections(
  content: BattleContentBundle,
  applications: readonly ActiveAuraApplication[],
  targetGroupId: GroupId,
): readonly AuraApplicationInspection[] {
  return applications
    .filter((application) => application.targetGroupId === targetGroupId)
    .map((application) => {
      const ability = content.abilityTemplates[application.abilityTemplateId];
      if (!ability || ability.kind !== "aura") {
        throw new Error(`Unknown aura ability template: ${application.abilityTemplateId}.`);
      }
      return {
        ...application,
        displayName: ability.displayName,
        targetRule: ability.targetRule,
        rangeCells: ability.rangeCells,
        stacking: ability.stacking,
        effects: application.effects.map((effect) => ({ ...effect })),
      };
    });
}

export function passiveAbilityInspections(
  content: BattleContentBundle,
  members: readonly AbilityMemberContext[],
): readonly PassiveAbilityInspection[] {
  return [...members]
    .sort((a, b) => compareStrings(a.id, b.id))
    .flatMap((member) =>
      passiveAbilitiesForMember(content, member.memberTemplateId).map((ability) => {
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
  ability: PassiveAbilityTemplate,
  member: AbilityMemberContext,
): { readonly active: boolean; readonly unmetCondition?: AbilityCondition["kind"] } {
  return evaluateAbilityConditions(ability, member);
}

export function auraSourceId(memberId: MemberId, abilityTemplateId: TemplateId): string {
  return `aura:${memberId.length}:${memberId}:${abilityTemplateId.length}:${abilityTemplateId}`;
}

export function clampBasisPoints(value: number): number {
  return Math.max(0, Math.min(10_000, value));
}

function selectStackedAuraCandidates(
  candidates: readonly AuraCandidate[],
): readonly AuraCandidate[] {
  const stacked = candidates.filter((candidate) => candidate.ability.stacking === "stack");
  const strongestEffects = new Map<
    string,
    { readonly candidate: AuraCandidate; readonly effect: AttributeModifierAbilityEffect }
  >();

  for (const candidate of candidates.filter(
    (entry) => entry.ability.stacking === "strongest",
  )) {
    for (const effect of candidate.effects) {
      const key = `${candidate.targetGroupId}\u0000${candidate.abilityTemplateId}\u0000${effect.attribute}`;
      const current = strongestEffects.get(key);
      if (
        !current ||
        Math.abs(effect.modifierBps) > Math.abs(current.effect.modifierBps) ||
        (Math.abs(effect.modifierBps) === Math.abs(current.effect.modifierBps) &&
          compareStrings(candidate.sourceId, current.candidate.sourceId) < 0)
      ) {
        strongestEffects.set(key, { candidate, effect });
      }
    }
  }

  const strongestByApplication = new Map<string, AuraCandidate>();
  for (const { candidate, effect } of strongestEffects.values()) {
    const existing = strongestByApplication.get(candidate.id);
    strongestByApplication.set(candidate.id, {
      ...candidate,
      effects: [...(existing?.effects ?? []), { ...effect }].sort((a, b) =>
        compareStrings(a.attribute, b.attribute),
      ),
    });
  }

  return [...stacked, ...strongestByApplication.values()].sort((a, b) =>
    compareStrings(a.id, b.id),
  );
}

function evaluateAbilityConditions(
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

function activeEvaluation(
  evaluatedAt: Tick,
  reason: ActiveAbilityEvaluationReason,
  candidates: readonly ActiveAbilityCandidateInspection[],
  selectedTargetGroupId?: GroupId,
): ActiveAbilityEvaluationInspection {
  return {
    evaluatedAt,
    reason,
    selectedTargetGroupId,
    candidates: candidates.map((candidate) => ({ ...candidate })),
  };
}

function isAuraSourceActive(member: AbilityMemberContext): boolean {
  return isAuraTargetMemberActive(member);
}

function isAuraTargetMemberActive(member: AbilityMemberContext): boolean {
  return (
    member.presence === "deployed" &&
    (member.health === "healthy" || member.health === "wounded")
  );
}

function auraApplicationId(sourceId: string, targetGroupId: GroupId): string {
  return `${sourceId}:${targetGroupId.length}:${targetGroupId}`;
}

function passiveAbilitiesForMember(
  content: BattleContentBundle,
  memberTemplateId: TemplateId,
): readonly PassiveAbilityTemplate[] {
  return abilityTemplatesForMember(content, memberTemplateId).filter(
    (ability): ability is PassiveAbilityTemplate => ability.kind === "passive",
  );
}

function auraAbilitiesForMember(
  content: BattleContentBundle,
  memberTemplateId: TemplateId,
): readonly AuraAbilityTemplate[] {
  return abilityTemplatesForMember(content, memberTemplateId).filter(
    (ability): ability is AuraAbilityTemplate => ability.kind === "aura",
  );
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

function effectsEqual(
  left: readonly AttributeModifierAbilityEffect[],
  right: readonly AttributeModifierAbilityEffect[],
): boolean {
  return (
    left.length === right.length &&
    left.every(
      (effect, index) =>
        effect.attribute === right[index]?.attribute &&
        effect.modifierBps === right[index]?.modifierBps,
    )
  );
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
