import { describe, expect, it } from "vitest";
import { createDemoBattleSetup } from "../demo";
import { getPrimaryWeaponTemplate } from "./content";
import { buildCoverSlots } from "./cover";
import { cellIndex } from "./map";
import { cloneBattleSetup, createRuntimeState } from "./runtime";

describe("runtime initialization", () => {
  it("builds stable entity indexes and template-backed member state", () => {
    const generated = createDemoBattleSetup({
      seed: "runtime-ordering",
      width: 32,
      height: 24,
      groupsPerFaction: 2,
    });
    const setup = { ...generated, groups: [...generated.groups].reverse() };
    const slots = buildCoverSlots(setup.map);
    const state = createRuntimeState(
      setup,
      new Map(slots.map((slot) => [cellIndex(setup.map, slot.cell), slot])),
    );
    const sortedGroupIds = setup.groups.map((group) => group.id).sort();

    expect(state.groups.map((group) => group.id)).toEqual(sortedGroupIds);
    expect(state.groupsById.size).toBe(setup.groups.length);
    expect(state.membersById.size).toBe(
      setup.groups.reduce((count, group) => count + group.members.length, 0),
    );
    for (const group of state.groups) {
      expect(state.groupsById.get(group.id)).toBe(group);
      for (const member of group.members) {
        const weapon = getPrimaryWeaponTemplate(setup.content, member.memberTemplateId);
        expect(state.membersById.get(member.id)).toBe(member);
        expect(member.weaponTemplateId).toBe(weapon.id);
        expect(member.magazineRounds).toBe(weapon.magazineSize);
      }
    }
  });

  it("deep-clones authoritative setup data exposed by the simulation", () => {
    const setup = createDemoBattleSetup({
      seed: "runtime-clone",
      width: 32,
      height: 24,
      groupsPerFaction: 1,
      mode: "defense",
    });
    const clone = cloneBattleSetup(setup);

    expect(clone).toEqual(setup);
    expect(clone.map.layers.heightUnits).not.toBe(setup.map.layers.heightUnits);
    expect(clone.groups[0]?.spawn).not.toBe(setup.groups[0]?.spawn);
    expect(clone.content.weaponTemplates).not.toBe(setup.content.weaponTemplates);

    clone.map.layers.heightUnits[0] = clone.map.layers.heightUnits[0]! + 1;
    (clone.groups[0]!.spawn as { x: number; z: number }).x += 1;
    expect(clone.map.layers.heightUnits[0]).not.toBe(setup.map.layers.heightUnits[0]);
    expect(clone.groups[0]!.spawn).not.toEqual(setup.groups[0]!.spawn);
  });
});
