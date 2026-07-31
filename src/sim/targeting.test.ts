import { describe, expect, it } from "vitest";
import {
  DEFAULT_PLATFORM_WEAPON_TEMPLATE_ID,
  DEFAULT_WEAPON_TEMPLATE_ID,
  createDefaultBattleContent,
} from "./content";
import {
  scoreTargetCandidates,
  weaponTargetEffectivenessBps,
  type TargetCandidateScoreInput,
} from "./targeting";

describe("combined-arms target utility", () => {
  it("derives personnel and platform suitability from target domains and effects", () => {
    const content = createDefaultBattleContent({ cellSizeMm: 4_000 });
    const rifle = content.weaponTemplates[DEFAULT_WEAPON_TEMPLATE_ID]!;
    const platformWeapon = content.weaponTemplates[DEFAULT_PLATFORM_WEAPON_TEMPLATE_ID]!;

    expect(weaponTargetEffectivenessBps(rifle, "personnel")).toBeGreaterThan(0);
    expect(weaponTargetEffectivenessBps(rifle, "platform")).toBe(0);
    expect(weaponTargetEffectivenessBps(platformWeapon, "personnel")).toBeGreaterThan(0);
    expect(weaponTargetEffectivenessBps(platformWeapon, "platform")).toBeGreaterThan(0);
    expect(weaponTargetEffectivenessBps(rifle, "personnel", "air")).toBe(0);
    expect(weaponTargetEffectivenessBps(platformWeapon, "platform", "air")).toBe(0);
    expect(
      weaponTargetEffectivenessBps(
        { ...platformWeapon, targetDomains: ["air"] },
        "platform",
      ),
    ).toBe(0);
  });

  it("uses retention and stable IDs to resolve otherwise equal candidates", () => {
    const base = candidate("bravo");
    const tied = scoreTargetCandidates([base, candidate("alpha")], 20);
    expect(tied.map((entry) => entry.targetGroupId)).toEqual(["alpha", "bravo"]);

    const retained = scoreTargetCandidates(
      [base, { ...candidate("alpha"), retained: true }],
      20,
    );
    expect(retained[0]).toMatchObject({
      targetGroupId: "alpha",
      compatible: true,
      components: { retention: 1_200 },
    });
  });

  it("keeps incompatible contacts visible in the evaluation but below valid targets", () => {
    const candidates = scoreTargetCandidates(
      [
        { ...candidate("near-platform"), effectivenessBps: 0, distanceSquared: 1 },
        { ...candidate("far-personnel"), distanceSquared: 100 },
      ],
      20,
    );

    expect(candidates.map((entry) => entry.targetGroupId)).toEqual([
      "far-personnel",
      "near-platform",
    ]);
    expect(candidates[1]).toMatchObject({ compatible: false, score: 0 });
  });
});

function candidate(targetGroupId: string): TargetCandidateScoreInput {
  return {
    targetGroupId,
    targetProfile: "personnel",
    targetDomain: "ground",
    lastKnown: { x: 8, z: 8 },
    observedAt: 20,
    confidenceBps: 10_000,
    source: "local-contact",
    distanceSquared: 16,
    effectivenessBps: 10_000,
    taskRelevanceBps: 0,
    retained: false,
  };
}
