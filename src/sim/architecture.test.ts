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
      conflict: ["060da456", "9e956a98", "62bc6bb7", "0cfe41cd", "11fb9faf"],
      defense: ["1aa2ec41", "f80b75e6", "2fbebc11", "9da20221", "ade7ebaf"],
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
