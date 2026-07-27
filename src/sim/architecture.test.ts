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
      conflict: ["5fbeefc0", "6a0ea600", "dd7c0c01", "b95d34c3", "5913c19c"],
      defense: ["d38a94fd", "b1771542", "9360c7a1", "deee0d29", "3c2c6e29"],
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
