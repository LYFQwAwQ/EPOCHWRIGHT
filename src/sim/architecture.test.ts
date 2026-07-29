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
      conflict: ["e2dad9da", "15c52412", "b837336f", "2b476727", "2737dcf6"],
      defense: ["72440531", "e24961d6", "c3f1cdab", "e2d9f2af", "36bc1a9f"],
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
