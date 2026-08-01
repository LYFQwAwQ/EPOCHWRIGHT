import type {
  BattleEvent,
  HealthState,
  RenderFrame,
  RenderGroup,
} from "../sim/types";

export type DirectorHotspotReason =
  | "engagement"
  | "objective"
  | "casualty"
  | "platform-loss"
  | "ability"
  | "reinforcement"
  | "contact"
  | "artillery"
  | "movement";

export interface DirectorHotspot {
  readonly id: string;
  readonly worldX: number;
  readonly worldY: number;
  readonly worldZ: number;
  readonly score: number;
  readonly reason: DirectorHotspotReason;
}

export interface DirectorState {
  readonly contextKey: string;
  readonly hotspot?: DirectorHotspot;
  readonly selectedAtTick?: number;
  readonly lastSwitchAtTick?: number;
}

export interface DirectorInput {
  readonly contextKey: string;
  readonly frame: RenderFrame;
  readonly events: readonly BattleEvent[];
  readonly cellSizeMeters: number;
}

export interface DirectorConfig {
  readonly regionSizeMeters: number;
  readonly recentEventTicks: number;
  readonly minimumDwellTicks: number;
  readonly switchCooldownTicks: number;
  readonly minimumSwitchDistanceMeters: number;
  readonly switchScoreMargin: number;
}

export const DEFAULT_DIRECTOR_CONFIG: DirectorConfig = {
  regionSizeMeters: 28,
  recentEventTicks: 80,
  minimumDwellTicks: 70,
  switchCooldownTicks: 50,
  minimumSwitchDistanceMeters: 18,
  switchScoreMargin: 100,
};

interface FocusPoint {
  readonly worldX: number;
  readonly worldY: number;
  readonly worldZ: number;
}

interface HotspotContribution extends FocusPoint {
  readonly sourceId: string;
  readonly score: number;
  readonly reason: DirectorHotspotReason;
}

interface HotspotAccumulator {
  readonly id: string;
  score: number;
  weightedX: number;
  weightedY: number;
  weightedZ: number;
  primary: HotspotContribution;
}

const HEALTH_EVENT_SCORES: Readonly<Record<HealthState, number>> = {
  healthy: 0,
  wounded: 150,
  incapacitated: 300,
  dead: 430,
};

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function roundCoordinate(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}

function midpoint(left: FocusPoint, right: FocusPoint): FocusPoint {
  return {
    worldX: (left.worldX + right.worldX) / 2,
    worldY: (left.worldY + right.worldY) / 2,
    worldZ: (left.worldZ + right.worldZ) / 2,
  };
}

function averagePoints(points: readonly FocusPoint[]): FocusPoint | undefined {
  if (points.length === 0) {
    return undefined;
  }
  return {
    worldX: points.reduce((sum, point) => sum + point.worldX, 0) / points.length,
    worldY: points.reduce((sum, point) => sum + point.worldY, 0) / points.length,
    worldZ: points.reduce((sum, point) => sum + point.worldZ, 0) / points.length,
  };
}

function contribution(
  sourceId: string,
  point: FocusPoint | undefined,
  score: number,
  reason: DirectorHotspotReason,
): HotspotContribution | undefined {
  if (!point || score <= 0) {
    return undefined;
  }
  return { sourceId, ...point, score, reason };
}

function groupActionContribution(group: RenderGroup): HotspotContribution | undefined {
  const point = {
    worldX: group.worldX,
    worldY: group.worldY,
    worldZ: group.worldZ,
  };
  switch (group.action) {
    case "engaging":
      return contribution(
        `frame:engaging:${group.id}`,
        point,
        260 + Math.min(group.activeMembers, 24) * 12 + Math.floor(group.suppressionBps / 100),
        "engagement",
      );
    case "routing":
      return contribution(
        `frame:routing:${group.id}`,
        point,
        190 + Math.min(group.activeMembers, 24) * 8,
        "casualty",
      );
    case "moving-to-contact":
      return contribution(
        `frame:moving:${group.id}`,
        point,
        55 + Math.min(group.activeMembers, 24) * 5,
        "movement",
      );
    case "searching":
      return contribution(
        `frame:searching:${group.id}`,
        point,
        30 + Math.min(group.activeMembers, 24) * 3,
        "movement",
      );
    case "evacuated":
    case "combat-ineffective":
      return undefined;
  }
}

function recentScore(baseScore: number, ageTicks: number, windowTicks: number): number {
  const remainingTicks = Math.max(0, windowTicks - ageTicks);
  return Math.max(1, Math.round((baseScore * remainingTicks) / Math.max(1, windowTicks)));
}

function eventContribution(
  event: BattleEvent,
  groupPoints: ReadonlyMap<string, FocusPoint>,
  heroMemberIds: ReadonlySet<string>,
  frame: RenderFrame,
  cellSizeMeters: number,
  recentEventTicks: number,
): HotspotContribution | undefined {
  const ageTicks = frame.tick - event.tick;
  if (ageTicks < 0 || ageTicks > recentEventTicks) {
    return undefined;
  }
  const sourceId = `event:${event.tick}:${event.sequence}:${event.type}`;
  const score = (baseScore: number) => recentScore(baseScore, ageTicks, recentEventTicks);
  const groupPoint = (groupId: string) => groupPoints.get(groupId);
  const pairPoint = (leftId: string, rightId: string) => {
    const left = groupPoint(leftId);
    const right = groupPoint(rightId);
    return left && right ? midpoint(left, right) : left ?? right;
  };

  switch (event.type) {
    case "contact-spotted":
      return contribution(
        sourceId,
        pairPoint(event.observerGroupId, event.targetGroupId),
        score(150),
        "contact",
      );
    case "intel-delivered":
      return contribution(sourceId, groupPoint(event.targetGroupId), score(90), "contact");
    case "ability-used": {
      const heroSource = heroMemberIds.has(event.sourceMemberId);
      return contribution(
        sourceId,
        pairPoint(event.sourceGroupId, event.targetGroupId),
        score(390 + (heroSource ? 210 : 0)),
        "ability",
      );
    }
    case "weapon-fired":
      return contribution(
        sourceId,
        pairPoint(event.groupId, event.targetGroupId),
        score(165 + Math.min(event.shotCount, 12) * 14),
        "engagement",
      );
    case "projectile-impacted": {
      const affectedPoint = averagePoints(
        event.affectedGroupIds.flatMap((groupId) => {
          const point = groupPoint(groupId);
          return point ? [point] : [];
        }),
      );
      return contribution(
        sourceId,
        affectedPoint ?? {
          worldX: event.impactCell.x * cellSizeMeters,
          worldY: 0,
          worldZ: event.impactCell.z * cellSizeMeters,
        },
        score(500 + event.affectedGroupIds.length * 60),
        "artillery",
      );
    }
    case "member-health-changed":
      return contribution(
        sourceId,
        groupPoint(event.groupId),
        score(HEALTH_EVENT_SCORES[event.to]),
        "casualty",
      );
    case "crew-station-changed":
      return contribution(sourceId, groupPoint(event.groupId), score(45), "movement");
    case "platform-state-changed": {
      const baseScore =
        event.to.disposition === "destroyed"
          ? 570
          : event.to.disposition === "abandoned"
            ? 410
            : event.to.mobility === "immobilized" || event.to.combat === "ineffective"
              ? 280
              : 100;
      return contribution(sourceId, groupPoint(event.groupId), score(baseScore), "platform-loss");
    }
    case "platform-component-changed": {
      const baseScore =
        event.to.state === "destroyed"
          ? 300
          : event.to.state === "disabled"
            ? 230
            : event.to.state === "damaged"
              ? 120
              : 0;
      return contribution(sourceId, groupPoint(event.groupId), score(baseScore), "platform-loss");
    }
    case "platform-flight-resolved":
      return contribution(sourceId, groupPoint(event.groupId), score(620), "platform-loss");
    case "platform-deployment-changed":
      return contribution(sourceId, groupPoint(event.groupId), score(80), "artillery");
    case "artillery-mission-changed":
      return contribution(sourceId, groupPoint(event.groupId), score(140), "artillery");
    case "embarkation-changed":
      return contribution(
        sourceId,
        groupPoint(event.passengerGroupId),
        score(event.phase === "forced" ? 240 : 70),
        event.phase === "forced" ? "platform-loss" : "movement",
      );
    case "morale-changed":
      return contribution(
        sourceId,
        groupPoint(event.groupId),
        score(event.to === "routing" ? 240 : event.to === "shaken" ? 110 : 40),
        "casualty",
      );
    case "group-evacuated":
      return contribution(sourceId, groupPoint(event.groupId), score(220), "casualty");
    case "reinforcement-deployed":
      return contribution(
        sourceId,
        averagePoints(
          event.groupIds.flatMap((groupId) => {
            const point = groupPoint(groupId);
            return point ? [point] : [];
          }),
        ),
        score(300 + event.groupIds.length * 35),
        "reinforcement",
      );
    case "objective-state-changed": {
      const objective = frame.objectives.find((candidate) => candidate.id === event.objectiveId);
      return contribution(sourceId, objective, score(530), "objective");
    }
    case "reinforcement-triggered":
    case "reinforcement-waiting":
    case "reinforcement-cancelled":
    case "battle-ended":
      return undefined;
  }
}

function isPrimaryContribution(
  candidate: HotspotContribution,
  current: HotspotContribution,
): boolean {
  if (candidate.score !== current.score) {
    return candidate.score > current.score;
  }
  const reasonOrder = compareStrings(candidate.reason, current.reason);
  return reasonOrder < 0 || (reasonOrder === 0 && candidate.sourceId < current.sourceId);
}

export function buildDirectorHotspots(
  frame: RenderFrame,
  events: readonly BattleEvent[],
  cellSizeMeters: number,
  configOverrides: Partial<DirectorConfig> = {},
): readonly DirectorHotspot[] {
  const config = { ...DEFAULT_DIRECTOR_CONFIG, ...configOverrides };
  const groupPoints = new Map(
    frame.groups.map((group) => [
      group.id,
      { worldX: group.worldX, worldY: group.worldY, worldZ: group.worldZ },
    ]),
  );
  const heroMemberIds = new Set(
    frame.members.filter((member) => member.hero).map((member) => member.id),
  );
  const contributions: HotspotContribution[] = [];
  for (const group of frame.groups) {
    const groupContribution = groupActionContribution(group);
    if (groupContribution) contributions.push(groupContribution);
  }
  for (const objective of frame.objectives) {
    const baseScore =
      objective.state === "contested"
        ? 720
        : objective.state === "capturing"
          ? 500
          : objective.state === "recovering"
            ? 190
            : 0;
    const objectiveContribution = contribution(
      `frame:objective:${objective.id}`,
      objective,
      baseScore + Math.min(240, (objective.attackerPower + objective.defenderPower) * 6),
      "objective",
    );
    if (objectiveContribution) contributions.push(objectiveContribution);
  }
  for (const event of events) {
    const recentContribution = eventContribution(
      event,
      groupPoints,
      heroMemberIds,
      frame,
      cellSizeMeters,
      config.recentEventTicks,
    );
    if (recentContribution) contributions.push(recentContribution);
  }

  contributions.sort((left, right) => compareStrings(left.sourceId, right.sourceId));
  const regions = new Map<string, HotspotAccumulator>();
  for (const item of contributions) {
    const regionX = Math.floor(item.worldX / config.regionSizeMeters);
    const regionZ = Math.floor(item.worldZ / config.regionSizeMeters);
    const id = `region:${regionX}:${regionZ}`;
    const existing = regions.get(id);
    if (existing) {
      existing.score += item.score;
      existing.weightedX += item.worldX * item.score;
      existing.weightedY += item.worldY * item.score;
      existing.weightedZ += item.worldZ * item.score;
      if (isPrimaryContribution(item, existing.primary)) {
        existing.primary = item;
      }
    } else {
      regions.set(id, {
        id,
        score: item.score,
        weightedX: item.worldX * item.score,
        weightedY: item.worldY * item.score,
        weightedZ: item.worldZ * item.score,
        primary: item,
      });
    }
  }

  return [...regions.values()]
    .map((region) => ({
      id: region.id,
      worldX: roundCoordinate(region.weightedX / region.score),
      worldY: roundCoordinate(region.weightedY / region.score),
      worldZ: roundCoordinate(region.weightedZ / region.score),
      score: region.score,
      reason: region.primary.reason,
    }))
    .sort((left, right) => right.score - left.score || compareStrings(left.id, right.id));
}

export function createDirectorState(contextKey = ""): DirectorState {
  return { contextKey };
}

function selectHotspot(
  contextKey: string,
  hotspot: DirectorHotspot | undefined,
  tick: number,
): DirectorState {
  return hotspot
    ? {
        contextKey,
        hotspot,
        selectedAtTick: tick,
        lastSwitchAtTick: tick,
      }
    : { contextKey };
}

export function advanceDirector(
  state: DirectorState,
  input: DirectorInput,
  configOverrides: Partial<DirectorConfig> = {},
): DirectorState {
  const config = { ...DEFAULT_DIRECTOR_CONFIG, ...configOverrides };
  const candidates = buildDirectorHotspots(
    input.frame,
    input.events,
    input.cellSizeMeters,
    config,
  );
  const best = candidates[0];

  if (state.contextKey !== input.contextKey || input.frame.tick < (state.selectedAtTick ?? 0)) {
    return selectHotspot(input.contextKey, best, input.frame.tick);
  }
  if (!state.hotspot) {
    return selectHotspot(input.contextKey, best, input.frame.tick);
  }
  if (!best) {
    return state;
  }

  const currentCandidate = candidates.find((candidate) => candidate.id === state.hotspot?.id);
  if (best.id === state.hotspot.id) {
    return { ...state, hotspot: best };
  }

  const selectedAtTick = state.selectedAtTick ?? input.frame.tick;
  const lastSwitchAtTick = state.lastSwitchAtTick ?? selectedAtTick;
  if (
    input.frame.tick - selectedAtTick < config.minimumDwellTicks ||
    input.frame.tick - lastSwitchAtTick < config.switchCooldownTicks
  ) {
    return currentCandidate ? { ...state, hotspot: currentCandidate } : state;
  }

  const dx = best.worldX - state.hotspot.worldX;
  const dz = best.worldZ - state.hotspot.worldZ;
  if (dx * dx + dz * dz < config.minimumSwitchDistanceMeters ** 2) {
    return currentCandidate ? { ...state, hotspot: currentCandidate } : state;
  }
  if (currentCandidate && best.score < currentCandidate.score + config.switchScoreMargin) {
    return { ...state, hotspot: currentCandidate };
  }

  return selectHotspot(input.contextKey, best, input.frame.tick);
}
