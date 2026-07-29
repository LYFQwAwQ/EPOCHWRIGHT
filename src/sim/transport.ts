import { getMemberTemplate } from "./content";
import type {
  GroupState,
  PlatformState,
  TransportAssignmentState,
} from "./internal";
import { cellIndex, isWalkable, squaredGridDistance } from "./map";
import { compareById } from "./ordering";
import type {
  BattleContentBundle,
  BattleMap,
  BattleSetup,
  GridCoord,
  GroupId,
  PlatformId,
  TransportDismountScoreComponentsInspection,
  TransportKnownThreatInspection,
} from "./types";

const ADJACENT_OFFSETS: readonly (readonly [number, number])[] = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
];

export interface TransportRuntimeCollections {
  readonly assignments: TransportAssignmentState[];
  readonly byPassengerGroupId: Map<GroupId, TransportAssignmentState>;
  readonly byPlatformId: Map<PlatformId, TransportAssignmentState[]>;
}

export interface TransportCellOccupancy {
  readonly groups: ReadonlyMap<number, GroupId>;
  readonly staticPlatforms: ReadonlyMap<number, PlatformId>;
  readonly reservations: ReadonlyMap<number, GroupId>;
}

export interface TransportDismountContext {
  readonly knownThreats: readonly TransportKnownThreatInspection[];
  readonly objectiveCell?: GridCoord;
}

export interface TransportDismountSelection {
  readonly cell: GridCoord;
  readonly score: number;
  readonly components: TransportDismountScoreComponentsInspection;
}

export function createTransportRuntimeCollections(
  setup: BattleSetup,
  groupsById: ReadonlyMap<GroupId, GroupState>,
  platformsById: ReadonlyMap<PlatformId, PlatformState>,
): TransportRuntimeCollections {
  const assignments = setup.transportAssignments
    .map<TransportAssignmentState>((assignment) => ({
      ...assignment,
      status: "pending",
      ticksRemaining: 0,
      lastTransitionTick: 0,
      passengerDamageResolved: false,
      dismountEvaluation: undefined,
    }))
    .sort(compareById);
  const byPassengerGroupId = new Map(
    assignments.map((assignment) => [assignment.passengerGroupId, assignment]),
  );
  const byPlatformId = new Map<PlatformId, TransportAssignmentState[]>();
  for (const assignment of assignments) {
    const platformAssignments = byPlatformId.get(assignment.platformId) ?? [];
    platformAssignments.push(assignment);
    byPlatformId.set(assignment.platformId, platformAssignments);
    activateTransportAssignment(
      assignment,
      groupsById,
      platformsById,
      0,
    );
  }
  return { assignments, byPassengerGroupId, byPlatformId };
}

export function activateTransportAssignment(
  assignment: TransportAssignmentState,
  groupsById: ReadonlyMap<GroupId, GroupState>,
  platformsById: ReadonlyMap<PlatformId, PlatformState>,
  tick: number,
): boolean {
  if (assignment.status !== "pending") {
    return true;
  }
  const passengerGroup = groupsById.get(assignment.passengerGroupId);
  const platform = platformsById.get(assignment.platformId);
  if (!passengerGroup || !platform) {
    return false;
  }
  assignment.status = assignment.initiallyEmbarked ? "embarked" : "dismounted";
  assignment.lastTransitionTick = tick;
  if (assignment.initiallyEmbarked) {
    embarkPassengerGroup(passengerGroup, platform);
  }
  return true;
}

export function embarkPassengerGroup(
  passengerGroup: GroupState,
  platform: PlatformState,
): void {
  passengerGroup.cell = { ...platform.cell };
  passengerGroup.movingTo = undefined;
  passengerGroup.moveProgress = 0;
  passengerGroup.moveCost = 0;
  passengerGroup.turnTicksRemaining = 0;
  passengerGroup.path = [];
  passengerGroup.pathGoal = undefined;
  passengerGroup.goal = undefined;
  for (const member of passengerGroup.members) {
    if (member.presence === "deployed") {
      member.placement = { kind: "passenger", platformId: platform.id };
    }
  }
  if (!platform.passengerGroupIds.includes(passengerGroup.id)) {
    platform.passengerGroupIds.push(passengerGroup.id);
    platform.passengerGroupIds.sort();
  }
}

export function dismountPassengerGroup(
  passengerGroup: GroupState,
  platform: PlatformState,
  destination: GridCoord,
): void {
  passengerGroup.cell = { ...destination };
  passengerGroup.movingTo = undefined;
  passengerGroup.moveProgress = 0;
  passengerGroup.moveCost = 0;
  passengerGroup.turnTicksRemaining = 0;
  passengerGroup.path = [];
  passengerGroup.pathGoal = undefined;
  passengerGroup.goal = undefined;
  for (const member of passengerGroup.members) {
    if (
      member.presence === "deployed" &&
      member.placement.kind === "passenger" &&
      member.placement.platformId === platform.id
    ) {
      member.placement = { kind: "dismounted" };
    }
  }
  const passengerIndex = platform.passengerGroupIds.indexOf(passengerGroup.id);
  if (passengerIndex >= 0) {
    platform.passengerGroupIds.splice(passengerIndex, 1);
  }
}

export function transportOccupancyUnits(
  group: Pick<BattleSetup["groups"][number], "members">,
  content: BattleContentBundle,
): number {
  return group.members.reduce(
    (sum, member) =>
      sum + getMemberTemplate(content, member.memberTemplateId).transportOccupancyUnits,
    0,
  );
}

export function runtimeTransportOccupancyUnits(
  group: GroupState,
  content: BattleContentBundle,
): number {
  return group.members
    .filter((member) => member.presence === "deployed")
    .reduce(
      (sum, member) =>
        sum + getMemberTemplate(content, member.memberTemplateId).transportOccupancyUnits,
      0,
    );
}

export function areTransportCellsAdjacent(a: GridCoord, b: GridCoord): boolean {
  const dx = Math.abs(a.x - b.x);
  const dz = Math.abs(a.z - b.z);
  return Math.max(dx, dz) === 1;
}

export function selectTransportAdjacentCell(
  map: BattleMap,
  platformCell: GridCoord,
  occupancy: TransportCellOccupancy,
  passengerGroupId: GroupId,
): GridCoord | undefined {
  return transportAdjacentCandidates(
    map,
    platformCell,
    occupancy,
    passengerGroupId,
  )[0];
}

export function selectTransportDismountCell(
  map: BattleMap,
  platformCell: GridCoord,
  occupancy: TransportCellOccupancy,
  passengerGroupId: GroupId,
  context: TransportDismountContext,
): TransportDismountSelection | undefined {
  return transportAdjacentCandidates(
    map,
    platformCell,
    occupancy,
    passengerGroupId,
  )
    .map((cell) => {
      const components = scoreTransportDismountCell(
        cell,
        platformCell,
        context,
      );
      return {
        cell,
        score:
          components.threatSeparation +
          components.platformShielding +
          components.objectiveProximity,
        components,
      };
    })
    .sort(
      (a, b) =>
        b.score - a.score || cellIndex(map, a.cell) - cellIndex(map, b.cell),
    )[0];
}

function transportAdjacentCandidates(
  map: BattleMap,
  platformCell: GridCoord,
  occupancy: TransportCellOccupancy,
  passengerGroupId: GroupId,
): GridCoord[] {
  return ADJACENT_OFFSETS
    .map(([dx, dz]) => ({ x: platformCell.x + dx, z: platformCell.z + dz }))
    .filter((candidate) => {
      if (!isWalkable(map, candidate, "foot")) {
        return false;
      }
      const index = cellIndex(map, candidate);
      const occupyingGroupId = occupancy.groups.get(index);
      const reservingGroupId = occupancy.reservations.get(index);
      return (
        (occupyingGroupId === undefined || occupyingGroupId === passengerGroupId) &&
        occupancy.staticPlatforms.get(index) === undefined &&
        (reservingGroupId === undefined || reservingGroupId === passengerGroupId)
      );
    })
    .sort((a, b) => cellIndex(map, a) - cellIndex(map, b));
}

function scoreTransportDismountCell(
  candidate: GridCoord,
  platformCell: GridCoord,
  context: TransportDismountContext,
): TransportDismountScoreComponentsInspection {
  const threatDistances = context.knownThreats.map((threat) =>
    squaredGridDistance(candidate, threat.lastKnown),
  );
  const threatSeparation = threatDistances.length > 0
    ? Math.min(6_000, Math.min(...threatDistances) * 300)
    : 0;
  const platformShielding = context.knownThreats.reduce((best, threat) => {
    const platformDistance = squaredGridDistance(platformCell, threat.lastKnown);
    const candidateDistance = squaredGridDistance(candidate, threat.lastKnown);
    return Math.max(best, Math.min(1_500, Math.max(0, candidateDistance - platformDistance) * 150));
  }, 0);
  const objectiveProximity = context.objectiveCell
    ? Math.max(0, 2_400 - squaredGridDistance(candidate, context.objectiveCell) * 40)
    : 0;
  return { threatSeparation, platformShielding, objectiveProximity };
}

export function isTransportDestinationAvailable(
  map: BattleMap,
  destination: GridCoord,
  occupancy: TransportCellOccupancy,
  passengerGroupId: GroupId,
): boolean {
  if (!isWalkable(map, destination, "foot")) {
    return false;
  }
  const index = cellIndex(map, destination);
  const occupyingGroupId = occupancy.groups.get(index);
  const reservingGroupId = occupancy.reservations.get(index);
  return (
    (occupyingGroupId === undefined || occupyingGroupId === passengerGroupId) &&
    occupancy.staticPlatforms.get(index) === undefined &&
    (reservingGroupId === undefined || reservingGroupId === passengerGroupId)
  );
}
