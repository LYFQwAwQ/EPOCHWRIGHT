import {
  DEFAULT_GROUP_TEMPLATE_ID,
  DEFAULT_MEMBER_TEMPLATE_ID,
  defaultRelation,
  primaryAttackRouteCenterZ,
} from "../sim";
import type {
  BattleModeKind,
  DefenseModeSetupInput,
  DefenseObjectiveSetup,
  FactionSetup,
  GroupSpawn,
  ReinforcementEntranceSetup,
  ReinforcementWaveSetup,
} from "../sim/types";
import type { DemoBattleSetupOptions } from "./setup";

export type DemoScenarioId =
  | "alliance-conflict"
  | "duel-conflict"
  | "passive-ability"
  | "artillery-observation"
  | "air-recon"
  | "air-operations"
  | "vehicle-skirmish"
  | "vehicle-defense"
  | "single-defense"
  | "sequence-defense"
  | "reinforcement-conflict";

export interface DemoScenarioDefinition {
  readonly id: DemoScenarioId;
  readonly label: string;
  readonly mode: BattleModeKind;
}

const TWO_FACTIONS: readonly FactionSetup[] = [
  { id: "ember", displayName: "赤焰", color: "#e45f62" },
  { id: "azure", displayName: "苍蓝", color: "#3e8fd1" },
];

const THREE_FACTIONS: readonly FactionSetup[] = [
  ...TWO_FACTIONS,
  { id: "olive", displayName: "橄榄", color: "#7c9a52" },
];

const ALLIANCE_RELATIONS = [
  defaultRelation("ember", "azure", "hostile"),
  defaultRelation("ember", "olive", "hostile"),
  defaultRelation("azure", "olive", "allied", 60, 40),
] as const;

export const DEMO_SCENARIOS: readonly DemoScenarioDefinition[] = [
  { id: "alliance-conflict", label: "三方同盟冲突", mode: "conflict" },
  { id: "duel-conflict", label: "双边正面冲突", mode: "conflict" },
  { id: "passive-ability", label: "被动能力对抗", mode: "conflict" },
  { id: "artillery-observation", label: "自行火炮观察", mode: "conflict" },
  { id: "air-recon", label: "低空侦察", mode: "conflict" },
  { id: "air-operations", label: "空中行动", mode: "conflict" },
  { id: "vehicle-skirmish", label: "车辆遭遇战", mode: "conflict" },
  { id: "vehicle-defense", label: "合成兵种防守", mode: "defense" },
  { id: "single-defense", label: "单目标防守", mode: "defense" },
  { id: "sequence-defense", label: "三段纵深防守", mode: "defense" },
  { id: "reinforcement-conflict", label: "增援波次冲突", mode: "conflict" },
];

const SCENARIO_IDS = new Set<DemoScenarioId>(
  DEMO_SCENARIOS.map((scenario) => scenario.id),
);

export function isDemoScenarioId(value: string | null): value is DemoScenarioId {
  return value !== null && SCENARIO_IDS.has(value as DemoScenarioId);
}

export function getDemoScenario(id: DemoScenarioId): DemoScenarioDefinition {
  return DEMO_SCENARIOS.find((scenario) => scenario.id === id)!;
}

export function defaultDemoScenarioForMode(mode: BattleModeKind): DemoScenarioId {
  return mode === "defense" ? "single-defense" : "alliance-conflict";
}

export function createDemoScenarioOptions(
  scenarioId: DemoScenarioId,
  seed: string,
): DemoBattleSetupOptions {
  const shared = {
    seed,
    battleId: `demo-${scenarioId}-${seed}`,
    mountainDensity: 0.12,
    roughness: 0.46,
    waterCoverage: 0.1,
    wetlandCoverage: 0.08,
    maximumDurationSeconds: 180,
    stalemateSeconds: 70,
  } satisfies DemoBattleSetupOptions;

  switch (scenarioId) {
    case "alliance-conflict":
      return {
        ...shared,
        width: 56,
        height: 42,
        groupsPerFaction: 4,
        factions: THREE_FACTIONS,
        relations: ALLIANCE_RELATIONS,
        mode: "conflict",
      };
    case "duel-conflict":
      return {
        ...shared,
        width: 52,
        height: 38,
        groupsPerFaction: 5,
        factions: TWO_FACTIONS,
        mode: "conflict",
      };
    case "passive-ability":
      return {
        ...shared,
        width: 44,
        height: 30,
        groupsPerFaction: 3,
        passiveAbilityGroupsPerFaction: 1,
        factions: TWO_FACTIONS,
        mountainDensity: 0,
        roughness: 0,
        waterCoverage: 0,
        wetlandCoverage: 0,
        treeCoverage: 0,
        rockCoverage: 0,
        wallCoverage: 0,
        maximumDurationSeconds: 100,
        stalemateSeconds: 60,
        mode: "conflict",
      };
    case "artillery-observation":
      return {
        ...shared,
        width: 44,
        height: 30,
        groupsPerFaction: 4,
        artilleryGroupsPerFaction: 1,
        factions: TWO_FACTIONS,
        mountainDensity: 0,
        roughness: 0,
        waterCoverage: 0,
        wetlandCoverage: 0,
        treeCoverage: 0,
        rockCoverage: 0,
        wallCoverage: 0,
        maximumDurationSeconds: 100,
        stalemateSeconds: 70,
        mode: "conflict",
      };
    case "air-recon":
      return {
        ...shared,
        width: 52,
        height: 36,
        groupsPerFaction: 4,
        airGroupsPerFaction: 1,
        factions: TWO_FACTIONS,
        mountainDensity: 0.2,
        roughness: 0.52,
        waterCoverage: 0.08,
        wetlandCoverage: 0.04,
        treeCoverage: 0.02,
        rockCoverage: 0.005,
        wallCoverage: 0,
        maximumDurationSeconds: 120,
        stalemateSeconds: 70,
        mode: "conflict",
      };
    case "air-operations":
      return {
        ...shared,
        width: 56,
        height: 40,
        groupsPerFaction: 6,
        airGroupsPerFaction: 3,
        airGroupTypes: ["recon-helicopter", "attack-helicopter", "scout-drone"],
        factions: TWO_FACTIONS,
        mountainDensity: 0.16,
        roughness: 0.5,
        waterCoverage: 0.04,
        wetlandCoverage: 0.02,
        treeCoverage: 0.015,
        rockCoverage: 0.004,
        wallCoverage: 0,
        maximumDurationSeconds: 140,
        stalemateSeconds: 80,
        mode: "conflict",
      };
    case "vehicle-skirmish":
      return {
        ...shared,
        width: 56,
        height: 36,
        groupsPerFaction: 3,
        vehicleGroupsPerFaction: 1,
        transportPairsPerFaction: 1,
        factions: TWO_FACTIONS,
        mountainDensity: 0,
        roughness: 0,
        waterCoverage: 0,
        wetlandCoverage: 0,
        treeCoverage: 0,
        rockCoverage: 0,
        wallCoverage: 0,
        mode: "conflict",
      };
    case "vehicle-defense":
      return {
        ...shared,
        maximumDurationSeconds: 60,
        stalemateSeconds: 35,
        width: 56,
        height: 36,
        groupsPerFaction: 3,
        vehicleGroupsPerFaction: 1,
        transportPairsPerFaction: 1,
        factions: TWO_FACTIONS,
        mountainDensity: 0,
        roughness: 0,
        waterCoverage: 0,
        wetlandCoverage: 0,
        treeCoverage: 0,
        rockCoverage: 0,
        wallCoverage: 0,
        mode: "defense",
      };
    case "single-defense":
      return {
        ...shared,
        width: 56,
        height: 42,
        groupsPerFaction: 4,
        factions: THREE_FACTIONS,
        relations: ALLIANCE_RELATIONS,
        mode: "defense",
      };
    case "sequence-defense": {
      const width = 64;
      const height = 42;
      return {
        ...shared,
        width,
        height,
        groupsPerFaction: 6,
        factions: TWO_FACTIONS,
        treeCoverage: 0.035,
        rockCoverage: 0.012,
        wallCoverage: 0.008,
        mode: createSequenceDefenseMode(width, height),
      };
    }
    case "reinforcement-conflict": {
      const width = 58;
      const height = 38;
      const { entrances, waves } = createReinforcementScenario(width, height);
      return {
        ...shared,
        width,
        height,
        groupsPerFaction: 2,
        factions: TWO_FACTIONS,
        mode: "conflict",
        reinforcementEntrances: entrances,
        reinforcements: waves,
      };
    }
  }
}

function createSequenceDefenseMode(width: number, height: number): DefenseModeSetupInput {
  const objectives = [
    createRouteObjective("forward-line", width, height, 0.46),
    createRouteObjective("middle-line", width, height, 0.61),
    createRouteObjective("final-line", width, height, 0.76),
  ];
  return {
    kind: "defense",
    attackerFactionId: "ember",
    defenderFactionId: "azure",
    objectives,
    objectiveRule: "sequence",
    reserveRatioBps: 3_300,
  };
}

function createRouteObjective(
  id: string,
  width: number,
  height: number,
  progress: number,
): DefenseObjectiveSetup {
  const x = Math.round((width - 1) * progress);
  return {
    id,
    center: {
      x,
      z: Math.round(primaryAttackRouteCenterZ(width, height, x)),
    },
    radiusCells: 2,
  };
}

function createReinforcementScenario(
  width: number,
  height: number,
): {
  readonly entrances: readonly ReinforcementEntranceSetup[];
  readonly waves: readonly ReinforcementWaveSetup[];
} {
  const westZ = Math.round(height * 0.36);
  const eastNorthZ = Math.round(height * 0.32);
  const eastSouthZ = Math.round(height * 0.68);
  const entrances: readonly ReinforcementEntranceSetup[] = [
    {
      id: "ember-west-gate",
      factionId: "ember",
      cells: [{ x: 0, z: westZ }, { x: 0, z: westZ + 1 }],
      capacityPerTick: 1,
    },
    {
      id: "azure-east-north",
      factionId: "azure",
      cells: [{ x: width - 1, z: eastNorthZ }],
      capacityPerTick: 1,
    },
    {
      id: "azure-east-south",
      factionId: "azure",
      cells: [{ x: width - 1, z: eastSouthZ }],
      capacityPerTick: 1,
    },
  ];
  const waves: readonly ReinforcementWaveSetup[] = [
    {
      id: "ember-wave-1",
      factionId: "ember",
      arrivalTick: 40,
      entranceIds: ["ember-west-gate"],
      blockedPolicy: "wait",
      groups: [
        createReinforcementGroup("ember-reinforcement-1", "ember", 0, westZ),
        createReinforcementGroup("ember-reinforcement-2", "ember", 0, westZ + 1),
        createReinforcementGroup("ember-reinforcement-3", "ember", 0, westZ),
      ],
    },
    {
      id: "azure-wave-1",
      factionId: "azure",
      arrivalTick: 80,
      entranceIds: ["azure-east-north", "azure-east-south"],
      blockedPolicy: "try-alternate",
      groups: [
        createReinforcementGroup("azure-reinforcement-1", "azure", width - 1, eastNorthZ),
        createReinforcementGroup("azure-reinforcement-2", "azure", width - 1, eastSouthZ),
      ],
    },
  ];
  return { entrances, waves };
}

function createReinforcementGroup(
  id: string,
  factionId: string,
  x: number,
  z: number,
): GroupSpawn {
  return {
    id,
    factionId,
    groupTemplateId: DEFAULT_GROUP_TEMPLATE_ID,
    spawn: { x, z },
    evacuation: { x, z },
    members: Array.from({ length: 8 }, (_, index) => ({
      id: `${id}-member-${index + 1}`,
      memberTemplateId: DEFAULT_MEMBER_TEMPLATE_ID,
    })),
    platforms: [],
  };
}
