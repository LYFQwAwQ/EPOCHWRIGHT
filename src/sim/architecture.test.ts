import { describe, expect, it } from "vitest";
import { createDemoBattleSetup } from "../demo";
import { createSimulation } from "./index";

const HASH_TICKS = [0, 1, 25, 100, 300] as const;

describe("simulation architecture boundaries", () => {
  it("preserves fixed-seed hashes across extracted rule domains", () => {
    expect({
      conflict: collectHashes("arch-001-conflict", "conflict"),
      defense: collectHashes("arch-001-defense", "defense"),
    }).toEqual({
      conflict: ["c7b98f10", "7f86192a", "f5cd407d", "2a0624f7", "7a453d7d"],
      defense: ["f3dd6a71", "14f44356", "5fb9afc1", "deb05651", "3559d29f"],
    });
  });
});

function collectHashes(seed: string, mode: "conflict" | "defense"): string[] {
  const simulation = createSimulation(
    createDemoBattleSetup({
      seed,
      width: 40,
      height: 28,
      groupsPerFaction: 3,
      mode,
      maximumDurationSeconds: 30,
      stalemateSeconds: 20,
    }),
  );
  const hashes: string[] = [];
  let previousTick = 0;
  for (const tick of HASH_TICKS) {
    simulation.step(tick - previousTick);
    hashes.push(simulation.getStateHash());
    previousTick = tick;
  }
  return hashes;
}
