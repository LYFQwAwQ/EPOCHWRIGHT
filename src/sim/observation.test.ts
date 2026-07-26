import { describe, expect, it } from "vitest";
import { createDemoBattleSetup } from "../demo";
import { createSimulation, type GroupInspection } from "./index";

describe("observation projections", () => {
  it("keeps unknown enemy groups and members out of a faction view", () => {
    const setup = createDemoBattleSetup({
      seed: "observation-view",
      width: 36,
      height: 24,
      groupsPerFaction: 1,
      maximumDurationSeconds: 120,
      stalemateSeconds: 90,
    });
    const simulation = createSimulation(setup);
    const ownGroup = setup.groups.find((group) => group.factionId === "ember");
    const enemyGroup = setup.groups.find((group) => group.factionId === "azure");
    if (!ownGroup || !enemyGroup) {
      throw new Error("Expected default ember and azure groups.");
    }

    const fullFrame = simulation.getRenderFrame();
    const factionFrame = simulation.getRenderFrame("ember");
    expect(fullFrame.groups.map((group) => group.id)).toContain(enemyGroup.id);
    expect(factionFrame.groups.map((group) => group.id)).toContain(ownGroup.id);
    expect(factionFrame.groups.map((group) => group.id)).not.toContain(enemyGroup.id);
    expect(factionFrame.members.every((member) => member.factionId === "ember")).toBe(true);
    expect(simulation.inspect(enemyGroup.id, "ember")).toBeUndefined();

    const hash = simulation.getStateHash();
    simulation.getRenderFrame("ember");
    simulation.inspect(ownGroup.id, "ember");
    expect(simulation.getStateHash()).toBe(hash);
  });

  it("projects a known contact without exposing combat details", () => {
    const setup = createDemoBattleSetup({
      seed: "observation-contact",
      width: 36,
      height: 24,
      groupsPerFaction: 1,
      maximumDurationSeconds: 120,
      stalemateSeconds: 90,
    });
    const simulation = createSimulation(setup);
    const enemyGroup = setup.groups.find((group) => group.factionId === "azure");
    if (!enemyGroup) {
      throw new Error("Expected default azure group.");
    }

    for (let index = 0; index < 240; index += 1) {
      simulation.step();
      const known = simulation.getRenderFrame("ember").groups.find(
        (group) => group.id === enemyGroup.id,
      );
      if (known) {
        expect(known.visibility).toBe("known");
        expect(known.activeMembers).toBe(0);
        expect(simulation.getRenderFrame("ember").members.some((member) => member.groupId === enemyGroup.id)).toBe(false);
        const inspection = simulation.inspect(enemyGroup.id, "ember") as GroupInspection;
        expect(inspection.visibility).toBe("known");
        expect(inspection.path).toEqual([]);
        expect(inspection.activeMembers).toBe(0);
        return;
      }
      if (simulation.status === "finished") {
        break;
      }
    }

    throw new Error("Expected ember to receive a deterministic enemy contact.");
  });

  it("does not let view projection affect deterministic progression", () => {
    const setup = createDemoBattleSetup({
      seed: "observation-hash",
      width: 36,
      height: 24,
      groupsPerFaction: 1,
      maximumDurationSeconds: 120,
      stalemateSeconds: 90,
    });
    const projected = createSimulation(setup);
    const reference = createSimulation(setup);
    projected.getRenderFrame("ember");
    projected.inspect("ember-squad-1", "ember");
    projected.step(80);
    reference.step(80);
    expect(projected.getStateHash()).toBe(reference.getStateHash());
  });
});
