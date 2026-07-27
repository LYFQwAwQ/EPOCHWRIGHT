import { describe, expect, it } from "vitest";
import {
  activeMemberCount,
  calculateHitChance,
  canMemberFight,
  firstEffectAmount,
  hasEvacuatedMembers,
  isGroupCombatEffective,
  isGroupSpatiallyActive,
  nextMoraleState,
  updateWeaponTimer,
} from "./combat";

describe("combat rules", () => {
  it("advances weapon cooldowns and refills a completed reload", () => {
    const member = {
      magazineRounds: 0,
      reloadTicksRemaining: 2,
      shotCooldownTicks: 2,
    };

    updateWeaponTimer(member, { magazineSize: 6 });
    expect(member).toEqual({
      magazineRounds: 0,
      reloadTicksRemaining: 1,
      shotCooldownTicks: 1,
    });

    updateWeaponTimer(member, { magazineSize: 6 });
    expect(member).toEqual({
      magazineRounds: 6,
      reloadTicksRemaining: 0,
      shotCooldownTicks: 0,
    });
  });

  it("resolves effect amounts and bounded hit chance from explicit inputs", () => {
    const weapon = {
      damageEffects: [
        { kind: "damage" as const, amountBps: 3_200 },
        { kind: "suppression" as const, amountBps: 1_400 },
      ],
    };
    expect(firstEffectAmount(weapon, "damage", 0)).toBe(3_200);
    expect(firstEffectAmount(weapon, "suppression", 0)).toBe(1_400);
    expect(firstEffectAmount({ damageEffects: [] }, "damage", 750)).toBe(750);

    const target = { cell: { x: 4, z: 0 } };
    expect(
      calculateHitChance(
        { cell: { x: 0, z: 0 }, suppressionBps: 0 },
        { health: "healthy" },
        target,
        4,
      ),
    ).toBe(275);
    expect(
      calculateHitChance(
        { cell: { x: 0, z: 0 }, suppressionBps: 3_500 },
        { health: "wounded" },
        target,
        4,
      ),
    ).toBe(105);
    expect(
      calculateHitChance(
        { cell: { x: 0, z: 0 }, suppressionBps: 0 },
        { health: "healthy" },
        { cell: { x: 10, z: 0 } },
        4,
      ),
    ).toBe(60);
  });

  it("keeps health, presence, morale, and spatial effectiveness on separate axes", () => {
    const members = [
      { health: "healthy" as const, presence: "deployed" as const },
      { health: "wounded" as const, presence: "deployed" as const },
      { health: "incapacitated" as const, presence: "deployed" as const },
      { health: "healthy" as const, presence: "evacuated" as const },
    ];
    expect(members.map(canMemberFight)).toEqual([true, true, false, false]);
    expect(activeMemberCount({ members })).toBe(2);
    expect(hasEvacuatedMembers({ members })).toBe(true);
    expect(
      isGroupSpatiallyActive({ action: "searching", members }),
    ).toBe(true);
    expect(
      isGroupSpatiallyActive({ action: "evacuated", members }),
    ).toBe(false);
    expect(
      isGroupCombatEffective({ action: "searching", moraleState: "routing", members }),
    ).toBe(false);

    expect(nextMoraleState("steady", 2_600)).toBe("routing");
    expect(nextMoraleState("routing", 4_799)).toBe("routing");
    expect(nextMoraleState("routing", 4_800)).toBe("shaken");
    expect(nextMoraleState("shaken", 6_001)).toBe("steady");
  });
});
