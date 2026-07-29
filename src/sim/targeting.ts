import type {
  CoverThreatSource,
  GridCoord,
  GroupId,
  TargetCandidateInspection,
  TargetProfile,
  Tick,
  WeaponTemplate,
} from "./types";

const MAX_EFFECTIVENESS_BPS = 40_000;

export interface TargetCandidateScoreInput {
  readonly targetGroupId: GroupId;
  readonly targetProfile: TargetProfile;
  readonly lastKnown: GridCoord;
  readonly observedAt: Tick;
  readonly confidenceBps: number;
  readonly source: CoverThreatSource;
  readonly distanceSquared: number;
  readonly effectivenessBps: number;
  readonly taskRelevanceBps: number;
  readonly retained: boolean;
}

export function weaponTargetEffectivenessBps(
  weapon: Pick<WeaponTemplate, "targetDomains" | "damageEffects" | "suppressionBps">,
  targetProfile: TargetProfile,
): number {
  if (!weapon.targetDomains.includes("ground")) {
    return 0;
  }
  if (targetProfile === "platform") {
    const effect = weapon.damageEffects.find(
      (candidate) => candidate.kind === "platform-damage",
    );
    if (!effect || effect.kind !== "platform-damage") {
      return 0;
    }
    return Math.min(
      MAX_EFFECTIVENESS_BPS,
      effect.componentDamageBps +
        effect.crewDamageBps +
        (effect.externalDamageBps ?? 0) +
        effect.penetrationRating * 20,
    );
  }

  const memberEffects = weapon.damageEffects.reduce(
    (sum, effect) => sum + (effect.kind === "platform-damage" ? 0 : effect.amountBps),
    0,
  );
  return Math.min(MAX_EFFECTIVENESS_BPS, memberEffects + weapon.suppressionBps);
}

export function scoreTargetCandidates(
  candidates: readonly TargetCandidateScoreInput[],
  tick: Tick,
): TargetCandidateInspection[] {
  return candidates
    .map((candidate): TargetCandidateInspection => {
      const compatible = candidate.effectivenessBps > 0;
      const components = {
        effect: compatible
          ? Math.min(4_000, Math.floor(candidate.effectivenessBps / 5))
          : 0,
        confidence: Math.floor(Math.max(0, candidate.confidenceBps) / 10),
        recency: Math.max(0, 1_200 - Math.max(0, tick - candidate.observedAt) * 30),
        distance: Math.max(0, 1_800 - Math.min(1_800, candidate.distanceSquared * 4)),
        task: Math.floor(Math.max(0, candidate.taskRelevanceBps) * 1_600 / 10_000),
        retention: candidate.retained ? 1_200 : 0,
        direct: candidate.source === "direct-contact" ? 2_000 : 0,
      };
      return {
        targetGroupId: candidate.targetGroupId,
        targetProfile: candidate.targetProfile,
        lastKnown: { ...candidate.lastKnown },
        observedAt: candidate.observedAt,
        confidenceBps: candidate.confidenceBps,
        source: candidate.source,
        compatible,
        score: compatible
          ? components.effect +
            components.confidence +
            components.recency +
            components.distance +
            components.task +
            components.retention +
            components.direct
          : 0,
        components,
      };
    })
    .sort((a, b) =>
      Number(b.compatible) - Number(a.compatible) ||
      b.score - a.score ||
      b.observedAt - a.observedAt ||
      compareStrings(a.targetGroupId, b.targetGroupId),
    );
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
