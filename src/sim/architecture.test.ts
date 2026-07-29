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
      conflict: ["4a08c15d", "7e772d6b", "1728f624", "cdcb68a2", "6ce3a67f"],
      defense: ["88de6aac", "2611a713", "aefb3b1c", "4ea4808c", "8d5a3b5c"],
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
