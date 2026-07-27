import { squaredGridDistance } from "./map";
import type { GroupState, MemberState } from "./internal";
import type {
  MoraleState,
  PlatformDamageEffectDefinition,
  WeaponTemplate,
} from "./types";

type FightingMemberState = Pick<MemberState, "health" | "presence">;
type GroupMemberState = { readonly members: readonly FightingMemberState[] };
type SpatialGroupState = Pick<GroupState, "action"> & {
  readonly platforms?: readonly Pick<GroupState["platforms"][number], "disposition">[];
  readonly members: readonly (Pick<MemberState, "health" | "presence"> &
    Partial<Pick<MemberState, "placement">>)[];
};

export function updateWeaponTimer(
  member: Pick<
    MemberState,
    "magazineRounds" | "reloadTicksRemaining" | "shotCooldownTicks"
  >,
  weapon: Pick<WeaponTemplate, "magazineSize">,
): void {
  if (member.shotCooldownTicks > 0) {
    member.shotCooldownTicks -= 1;
  }
  if (member.reloadTicksRemaining > 0) {
    member.reloadTicksRemaining -= 1;
    if (member.reloadTicksRemaining === 0) {
      member.magazineRounds = weapon.magazineSize;
    }
  }
}

export function firstEffectAmount(
  weapon: Pick<WeaponTemplate, "damageEffects">,
  kind: "damage" | "suppression",
  fallback: number,
): number {
  const effect = weapon.damageEffects.find(
    (candidate): candidate is Extract<typeof candidate, { kind: "damage" | "suppression" }> =>
      candidate.kind === kind,
  );
  return effect?.amountBps ?? fallback;
}

export function firstPlatformDamageEffect(
  weapon: Pick<WeaponTemplate, "damageEffects">,
): PlatformDamageEffectDefinition | undefined {
  return weapon.damageEffects.find(
    (effect): effect is PlatformDamageEffectDefinition => effect.kind === "platform-damage",
  );
}

export function calculateHitChance(
  shooter: Pick<GroupState, "cell" | "suppressionBps">,
  member: Pick<MemberState, "health">,
  target: Pick<GroupState, "cell">,
  preferredRange: number,
): number {
  const distance = Math.round(Math.sqrt(squaredGridDistance(shooter.cell, target.cell)) * 100);
  const preferred = preferredRange * 100;
  const distancePenalty = Math.max(0, distance - preferred) * 2;
  const suppressionPenalty = Math.floor(shooter.suppressionBps / 35);
  const woundPenalty = member.health === "wounded" ? 70 : 0;
  return Math.max(60, Math.min(360, 275 - distancePenalty - suppressionPenalty - woundPenalty));
}

export function nextMoraleState(
  previous: MoraleState,
  moraleBps: number,
): MoraleState {
  if (previous === "routing" && moraleBps < 4_800) {
    return "routing";
  }
  if (moraleBps <= 2_600) {
    return "routing";
  }
  return moraleBps <= 6_000 ? "shaken" : "steady";
}

export function activeMemberCount(group: GroupMemberState): number {
  return group.members.filter(canMemberFight).length;
}

export function canMemberFight(member: FightingMemberState): boolean {
  return (
    member.presence === "deployed" &&
    (member.health === "healthy" || member.health === "wounded")
  );
}

export function hasEvacuatedMembers(group: GroupMemberState): boolean {
  return group.members.some((member) => member.presence === "evacuated");
}

export function isGroupSpatiallyActive(
  group: SpatialGroupState,
): boolean {
  return (
    group.action !== "evacuated" &&
    (group.members.some(
      (member) =>
        canMemberFight(member) &&
        (member.placement === undefined || member.placement.kind === "dismounted"),
    ) || group.platforms?.some((platform) => platform.disposition === "crewed") === true)
  );
}

export function isGroupCombatEffective(
  group: Pick<GroupState, "action" | "moraleState"> & {
    readonly platforms?: readonly Pick<GroupState["platforms"][number], "disposition">[];
    readonly members: readonly (Pick<MemberState, "health" | "presence"> &
      Partial<Pick<MemberState, "placement">>)[];
  },
): boolean {
  return isGroupSpatiallyActive(group) && group.moraleState !== "routing";
}
