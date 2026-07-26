import type { DemoBattleSetupOptions } from "../demo";

export type PerformanceProfile = "medium" | "large";

export interface PerformanceProfileDefinition {
  readonly width: number;
  readonly height: number;
  readonly groupsPerFaction: number;
  readonly expectedFactionCount: number;
  readonly expectedGroupCount: number;
  readonly expectedMemberCount: number;
  readonly benchmarkTicks: number;
}

export const PERFORMANCE_PROFILES: Readonly<
  Record<PerformanceProfile, PerformanceProfileDefinition>
> = {
  medium: {
    width: 256,
    height: 256,
    groupsPerFaction: 25,
    expectedFactionCount: 3,
    expectedGroupCount: 75,
    expectedMemberCount: 600,
    benchmarkTicks: 120,
  },
  large: {
    width: 512,
    height: 512,
    groupsPerFaction: 84,
    expectedFactionCount: 3,
    expectedGroupCount: 252,
    expectedMemberCount: 2_016,
    benchmarkTicks: 120,
  },
};

export function parsePerformanceProfile(value: string | null): PerformanceProfile | undefined {
  return value === "medium" || value === "large" ? value : undefined;
}

export function applyPerformanceProfile(
  options: DemoBattleSetupOptions,
  profile: PerformanceProfile | undefined,
): DemoBattleSetupOptions {
  if (!profile) {
    return options;
  }
  const definition = PERFORMANCE_PROFILES[profile];
  return {
    ...options,
    width: definition.width,
    height: definition.height,
    groupsPerFaction: definition.groupsPerFaction,
  };
}
