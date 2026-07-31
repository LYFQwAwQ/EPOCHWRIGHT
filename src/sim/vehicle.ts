import type {
  ArmorFace,
  CrewAssignment,
  CrewReassignment,
  CrewStationRule,
  GridCoord,
  MemberId,
  PlatformCapabilityInspection,
  PlatformComponentRule,
  PlatformComponentState,
  PlatformTemplate,
  StaticObjectFacing,
  VehicleEngagementScoreComponentsInspection,
} from "./types";

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export interface CrewCapabilityMember {
  readonly id: MemberId;
  readonly roleTags: readonly string[];
  readonly active: boolean;
}

export interface CrewStationCapability {
  readonly stationId: string;
  readonly memberId?: MemberId;
  readonly efficiencyBps: number;
  readonly reassigning: boolean;
}

export interface PlatformComponentCapability extends PlatformCapabilityInspection {
  readonly componentId: string;
}

export interface PlatformCapabilitySnapshot {
  readonly mobility: PlatformCapabilityInspection;
  readonly observation: PlatformCapabilityInspection;
  readonly weapons: readonly PlatformComponentCapability[];
  readonly components: readonly PlatformComponentCapability[];
  readonly disposition: "crewed" | "abandoned" | "destroyed";
  readonly stations: readonly CrewStationCapability[];
}

export interface CrewReassignmentProposal {
  readonly memberId: MemberId;
  readonly fromStationId: string;
  readonly toStationId: string;
  readonly efficiencyBps: number;
}

export interface VehicleEngagementScoreInput {
  readonly rangeCells: number;
  readonly preferredRangeCells: number;
  readonly pathCost: number;
  readonly facingSteps: number;
  readonly retainedPosition: boolean;
}

export interface VehicleEngagementScore {
  readonly score: number;
  readonly components: VehicleEngagementScoreComponentsInspection;
}

export function scoreVehicleEngagementPosition(
  input: VehicleEngagementScoreInput,
): VehicleEngagementScore {
  const components = {
    range: Math.max(
      0,
      4_000 - Math.abs(input.rangeCells - input.preferredRangeCells) * 800,
    ),
    route: Math.max(0, 2_400 - Math.floor(input.pathCost / 5)),
    facing: Math.max(0, 1_600 - input.facingSteps * 400),
    retention: input.retainedPosition ? 600 : 0,
  };
  return {
    score: components.range + components.route + components.facing + components.retention,
    components,
  };
}

interface ComponentStateInput {
  readonly id: string;
  readonly state: PlatformComponentState;
}

export function armorFaceForAttack(
  targetFacing: StaticObjectFacing,
  targetCell: GridCoord,
  attackerCell: GridCoord,
  topAttack: boolean,
): ArmorFace {
  if (topAttack) {
    return "top";
  }
  const bearing = facingToward(targetCell, attackerCell);
  const difference = circularFacingDifference(targetFacing, bearing);
  if (difference <= 1) {
    return "front";
  }
  if (difference >= 3) {
    return "rear";
  }
  return "side";
}

export function penetrationChanceBps(
  penetrationRating: number,
  armorRating: number,
): number {
  if (penetrationRating <= 0) {
    return 0;
  }
  if (armorRating <= 0) {
    return 10_000;
  }
  return Math.max(
    500,
    Math.min(9_500, 5_000 + (penetrationRating - armorRating) * 50),
  );
}

export function componentStateForIntegrity(
  integrityBps: number,
  disabledAtBps: number,
): PlatformComponentState {
  if (integrityBps <= 0) {
    return "destroyed";
  }
  if (integrityBps <= disabledAtBps) {
    return "disabled";
  }
  return integrityBps < 10_000 ? "damaged" : "operational";
}

export function selectWeightedPlatformComponent(
  componentRules: readonly PlatformComponentRule[],
  roll: number,
  externalOnly = false,
): PlatformComponentRule | undefined {
  const eligible = componentRules
    .filter((component) => !externalOnly || component.external)
    .sort((a, b) => compareIds(a.id, b.id));
  const totalWeight = eligible.reduce((sum, component) => sum + component.hitWeight, 0);
  if (totalWeight <= 0) {
    return undefined;
  }
  let cursor = Math.abs(Math.trunc(roll)) % totalWeight;
  for (const component of eligible) {
    if (cursor < component.hitWeight) {
      return component;
    }
    cursor -= component.hitWeight;
  }
  return eligible[eligible.length - 1];
}

function facingToward(from: GridCoord, to: GridCoord): StaticObjectFacing {
  const octant = Math.round(
    Math.atan2(to.x - from.x, to.z - from.z) / (Math.PI / 4),
  );
  return ((octant + 8) % 8) as StaticObjectFacing;
}

function circularFacingDifference(
  a: StaticObjectFacing,
  b: StaticObjectFacing,
): number {
  const difference = Math.abs(a - b);
  return Math.min(difference, 8 - difference);
}

export function crewEfficiencyForStation(
  station: Pick<CrewStationRule, "requiredRoleTags" | "substituteEfficiencyBps">,
  roleTags: readonly string[],
): number {
  return station.requiredRoleTags.every((tag) => roleTags.includes(tag))
    ? 10_000
    : station.substituteEfficiencyBps;
}

export function buildCrewStationCapabilities(
  stationRules: readonly CrewStationRule[],
  assignments: readonly CrewAssignment[],
  members: readonly CrewCapabilityMember[],
  reassignments: readonly Pick<
    CrewReassignment,
    "memberId" | "fromStationId" | "toStationId"
  >[],
): readonly CrewStationCapability[] {
  const membersById = new Map(members.map((member) => [member.id, member]));
  const assignmentsByStation = new Map(
    assignments.map((assignment) => [assignment.stationId, assignment]),
  );
  const transitioningMembers = new Set(reassignments.map((action) => action.memberId));
  const transitioningStations = new Set(
    reassignments.flatMap((action) => [action.fromStationId, action.toStationId]),
  );

  return [...stationRules]
    .sort((a, b) => compareIds(a.id, b.id))
    .map((station) => {
      const assignment = assignmentsByStation.get(station.id);
      const member = assignment ? membersById.get(assignment.memberId) : undefined;
      const reassigning =
        transitioningStations.has(station.id) ||
        Boolean(assignment && transitioningMembers.has(assignment.memberId));
      return {
        stationId: station.id,
        memberId: assignment?.memberId,
        efficiencyBps:
          member?.active && !reassigning
            ? crewEfficiencyForStation(station, member.roleTags)
            : 0,
        reassigning,
      };
    });
}

export function selectCrewReassignment(
  template: Pick<PlatformTemplate, "componentRules" | "crewStationRules">,
  assignments: readonly CrewAssignment[],
  members: readonly CrewCapabilityMember[],
  reassignments: readonly Pick<
    CrewReassignment,
    "memberId" | "fromStationId" | "toStationId"
  >[],
): CrewReassignmentProposal | undefined {
  if (reassignments.length > 0) {
    return undefined;
  }
  const stations = buildCrewStationCapabilities(
    template.crewStationRules,
    assignments,
    members,
    reassignments,
  );
  const stationsById = new Map(stations.map((station) => [station.stationId, station]));
  const stationRulesById = new Map(
    template.crewStationRules.map((station) => [station.id, station]),
  );
  const membersById = new Map(members.map((member) => [member.id, member]));
  const requiredStationIds = [
    ...new Set(template.componentRules.flatMap((component) => component.requiredStationIds)),
  ].sort();
  const requiredStationIdSet = new Set(requiredStationIds);

  for (const toStationId of requiredStationIds) {
    if ((stationsById.get(toStationId)?.efficiencyBps ?? 0) > 0) {
      continue;
    }
    const targetRule = stationRulesById.get(toStationId);
    if (!targetRule) {
      continue;
    }
    const candidates = assignments
      .filter(
        (assignment) =>
          assignment.stationId !== toStationId &&
          (!requiredStationIdSet.has(assignment.stationId) ||
            (stationsById.get(assignment.stationId)?.efficiencyBps ?? 0) === 0),
      )
      .map((assignment) => {
        const member = membersById.get(assignment.memberId);
        return {
          assignment,
          member,
          efficiencyBps:
            member?.active
              ? crewEfficiencyForStation(targetRule, member.roleTags)
              : 0,
        };
      })
      .filter(
        (candidate): candidate is typeof candidate & { member: CrewCapabilityMember } =>
          Boolean(candidate.member && candidate.efficiencyBps > 0),
      )
      .sort(
        (a, b) =>
          b.efficiencyBps - a.efficiencyBps ||
          compareIds(a.member.id, b.member.id),
      );
    const selected = candidates[0];
    if (selected) {
      return {
        memberId: selected.member.id,
        fromStationId: selected.assignment.stationId,
        toStationId,
        efficiencyBps: selected.efficiencyBps,
      };
    }
  }
  return undefined;
}

export function derivePlatformCapabilities(
  template: Pick<PlatformTemplate, "componentRules" | "crewStationRules" | "movementType">,
  components: readonly ComponentStateInput[],
  assignments: readonly CrewAssignment[],
  members: readonly CrewCapabilityMember[],
  reassignments: readonly Pick<
    CrewReassignment,
    "memberId" | "fromStationId" | "toStationId"
  >[],
): PlatformCapabilitySnapshot {
  const stations = buildCrewStationCapabilities(
    template.crewStationRules,
    assignments,
    members,
    reassignments,
  );
  const stationEfficiencyById = new Map(
    stations.map((station) => [station.stationId, station.efficiencyBps]),
  );
  const componentsById = new Map(components.map((component) => [component.id, component]));
  const capabilities = template.componentRules.map((rule) =>
    componentCapability(rule, componentsById.get(rule.id)?.state, stationEfficiencyById),
  );
  const capabilityById = new Map(
    capabilities.map((capability) => [capability.componentId, capability]),
  );
  const forKind = (kind: PlatformComponentRule["kind"]) =>
    template.componentRules
      .filter((rule) => rule.kind === kind)
      .map((rule) => capabilityById.get(rule.id)!);
  const structure = forKind("structure");
  const destroyed = structure.some(
    (capability) =>
      componentsById.get(capability.componentId)?.state === "destroyed",
  );
  const activeCrew = members.some(
    (member) =>
      member.active && assignments.some((assignment) => assignment.memberId === member.id),
  );
  const powertrain = forKind("powertrain");
  const runningGear = forKind("running-gear");
  const lift = forKind("lift");
  const secondaryMobility = template.movementType === "hover" ? lift : runningGear;
  const mobilityParts = [...powertrain, ...secondaryMobility];
  const mobilityEfficiencyBps = Math.min(
    maximumCapabilityEfficiency(powertrain),
    maximumCapabilityEfficiency(secondaryMobility),
  );
  const sensors = forKind("sensor");
  const weapons = forKind("weapon");

  return {
    mobility: aggregateCapability(mobilityParts, mobilityEfficiencyBps),
    observation: aggregateCapability(
      sensors,
      maximumCapabilityEfficiency(sensors),
    ),
    weapons,
    components: capabilities,
    disposition: destroyed ? "destroyed" : activeCrew ? "crewed" : "abandoned",
    stations,
  };
}

function componentCapability(
  rule: PlatformComponentRule,
  state: PlatformComponentState | undefined,
  stationEfficiencyById: ReadonlyMap<string, number>,
): PlatformComponentCapability {
  if (state !== "operational" && state !== "damaged") {
    return {
      componentId: rule.id,
      available: false,
      reason: "component-unavailable",
      efficiencyBps: 0,
    };
  }
  if (
    rule.requiredStationIds.some(
      (stationId) => (stationEfficiencyById.get(stationId) ?? 0) === 0,
    )
  ) {
    return {
      componentId: rule.id,
      available: false,
      reason: "crew-unavailable",
      efficiencyBps: 0,
    };
  }
  return {
    componentId: rule.id,
    available: true,
    reason: "available",
    efficiencyBps: rule.requiredStationIds.length > 0
      ? Math.min(
          ...rule.requiredStationIds.map(
            (stationId) => stationEfficiencyById.get(stationId) ?? 0,
          ),
        )
      : 10_000,
  };
}

function aggregateCapability(
  capabilities: readonly PlatformComponentCapability[],
  efficiencyBps: number,
): PlatformCapabilityInspection {
  if (capabilities.length === 0) {
    return { available: false, reason: "no-component", efficiencyBps: 0 };
  }
  if (efficiencyBps > 0) {
    return { available: true, reason: "available", efficiencyBps };
  }
  return {
    available: false,
    reason: capabilities.some((capability) => capability.reason === "crew-unavailable")
      ? "crew-unavailable"
      : "component-unavailable",
    efficiencyBps: 0,
  };
}

function maximumCapabilityEfficiency(
  capabilities: readonly PlatformComponentCapability[],
): number {
  return capabilities.reduce(
    (maximum, capability) => Math.max(maximum, capability.efficiencyBps),
    0,
  );
}
