import {
  cellIndex,
  hasLineOfSight,
  heightAt,
  isInsideMap,
  isWalkable,
  movementCostAtIndex,
  squaredGridDistance,
} from "./map";
import {
  applyBasisPointReduction,
  buildCoverSlots,
  claimCoverSlot,
  releaseCoverSlot,
  resolveDirectionalCoverEffect,
} from "./cover";
import {
  activeMemberCount,
  calculateHitChance,
  canMemberFight,
  firstEffectAmount,
  hasEvacuatedMembers,
  isGroupCombatEffective,
  isGroupSpatiallyActive,
  nextMoraleState,
  updateWeaponTimer,
} from "./combat";
import type {
  ContactState,
  CoverDecisionState,
  CoverThreatState,
  DetectionState,
  GroupState,
  HitIntent,
  IntelMessage,
  MemberState,
  ObjectiveRuntimeState,
  PlatformState,
  ReinforcementRuntimeState,
  RuntimeState,
  ShotIntent,
} from "./internal";
import {
  canTraverseStep,
  createPathfinder,
  movementStepCost,
  type Pathfinder,
} from "./pathfinder";
import { resolveObjectiveTick } from "./objective";
import {
  compareByFactionId,
  compareById,
  compareIntelMessages,
  compareStrings,
  sortedContacts,
} from "./ordering";
import { areHostile, findRelation } from "./relations";
import { deterministicBps, deterministicUint32, StateHasher } from "./rng";
import {
  getGroupTemplate,
  getMemberTemplate,
  getPlatformTemplate,
  getWeaponTemplate,
} from "./content";
import {
  hashBattleSetup,
  migrateBattleSetup,
  movementTypeForGroup,
  validateBattleSetup,
} from "./setup";
import {
  cloneBattleSetup,
  countSpawnActiveMembers,
  createGroupState,
  createRuntimeState,
} from "./runtime";
import {
  buildCrewStationCapabilities,
  derivePlatformCapabilities,
  selectCrewReassignment,
} from "./vehicle";
import type {
  BattleEvent,
  BattleResult,
  BattleSetup,
  BattleSetupInput,
  BattleSimulation,
  BattleTerminationReason,
  CoverEvaluationReason,
  CoverSlot,
  DirectionalCoverEffect,
  EntityInspection,
  FactionId,
  GridCoord,
  GroupId,
  GroupInspection,
  HealthState,
  MemberInspection,
  MemberPlacement,
  MovementType,
  ObjectiveInspection,
  PlatformInspection,
  PlatformCapabilityInspection,
  PlatformWeaponInspection,
  PlatformSummaryInspection,
  RenderFrame,
  RenderGroup,
  RenderMember,
  RenderObjective,
  RenderPlatform,
  SimulationStatus,
  StaticObjectFacing,
} from "./types";

const MOVE_POINTS_PER_TICK = 52;
const ROUTING_MOVE_POINTS_PER_TICK = 68;
const AI_INTERVAL_TICKS = 5;
const MOVEMENT_REPATH_WAIT_TICKS = 5;
const MOVEMENT_REPATH_RETRY_TICKS = 20;
const DETECTION_THRESHOLD_BPS = 10_000;
const DIRECT_CONTACT_FRESH_TICKS = 0;
const HIGH_SUPPRESSION_COVER_THRESHOLD_BPS = 7_200;
const COVER_SEARCH_RADIUS_CELLS = 6;
const COVER_CURRENT_SLOT_BONUS = 900;
const COVER_SELECTED_SLOT_BONUS = 450;
const GROUP_SLOT_OFFSETS: readonly (readonly [number, number])[] = [
  [-0.27, -0.25],
  [0, -0.29],
  [0.27, -0.25],
  [-0.3, 0],
  [0.3, 0],
  [-0.27, 0.25],
  [0, 0.29],
  [0.27, 0.25],
];
const WALKABLE_NEIGHBOR_OFFSETS: readonly (readonly [number, number])[] = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
];
const CARDINAL_NEIGHBOR_OFFSETS: readonly (readonly [number, number])[] = [
  [0, -1],
  [-1, 0],
  [1, 0],
  [0, 1],
];

interface MovementProposal {
  readonly group: GroupState;
  readonly destination: GridCoord;
}

interface SuppressionImpact {
  suppressionBps: number;
  hitSuppressionBps: number;
}

interface CoverOption {
  readonly slot: CoverSlot;
  readonly path: readonly GridCoord[];
  readonly pathCost: number;
  readonly score: number;
  readonly effect: DirectionalCoverEffect;
}

type PendingBattleEvent = BattleEvent extends infer Event
  ? Event extends BattleEvent
    ? Omit<Event, "tick" | "sequence">
    : never
  : never;

export function createSimulation(setup: BattleSetupInput): BattleSimulation {
  return new StageOneBattleSimulation(setup);
}

export const createBattleSimulation = createSimulation;

class StageOneBattleSimulation implements BattleSimulation {
  private readonly setup: BattleSetup;
  private readonly state: RuntimeState;
  private readonly coverSlots: readonly CoverSlot[];
  private readonly coverSlotsByCell: ReadonlyMap<number, CoverSlot>;
  /** Foot pathfinder compatibility alias for focused simulation tests. */
  private readonly pathfinder: Pathfinder;
  private readonly pathfinders: ReadonlyMap<MovementType, Pathfinder>;
  private readonly walkableComponentIds: ReadonlyMap<MovementType, Int32Array>;
  private readonly setupHash: string;

  constructor(inputSetup: BattleSetupInput) {
    const normalizedSetup = migrateBattleSetup(inputSetup);
    validateBattleSetup(normalizedSetup);
    this.setup = cloneBattleSetup(normalizedSetup);
    this.setupHash = hashBattleSetup(this.setup);
    this.coverSlots = buildCoverSlots(this.setup.map);
    this.coverSlotsByCell = new Map(
      this.coverSlots.map((slot) => [cellIndex(this.setup.map, slot.cell), slot]),
    );
    this.state = createRuntimeState(this.setup, this.coverSlotsByCell);
    this.pathfinder = createPathfinder(this.setup.map, "foot");
    const movementTypes: readonly MovementType[] = ["foot", "wheeled", "tracked"];
    this.pathfinders = new Map(
      movementTypes.map((movementType) => [
        movementType,
        movementType === "foot"
          ? this.pathfinder
          : createPathfinder(this.setup.map, movementType),
      ]),
    );
    this.walkableComponentIds = new Map(
      movementTypes.map((movementType) => [
        movementType,
        buildWalkableComponentIds(this.setup.map, movementType),
      ]),
    );
    this.assignDefenseSlots();
    this.initializePaths();
  }

  get tick(): number {
    return this.state.tick;
  }

  get status(): SimulationStatus {
    return this.state.result ? "finished" : "active";
  }

  getSetup(): BattleSetup {
    return cloneBattleSetup(this.setup);
  }

  step(count = 1): void {
    if (!Number.isInteger(count) || count < 0) {
      throw new Error("step count must be a non-negative integer.");
    }
    for (let index = 0; index < count && !this.state.result; index += 1) {
      this.stepOnce();
    }
  }

  getRenderFrame(observerFactionId?: FactionId): RenderFrame {
    const groups: RenderGroup[] = [];
    const members: RenderMember[] = [];
    const platforms: RenderPlatform[] = [];
    const objectives: RenderObjective[] = [];
    const cellSizeMeters = this.setup.map.cellSizeMm / 1_000;
    const heightUnitMeters = this.setup.map.heightUnitMm / 1_000;

    for (const group of this.state.groups) {
      const ownGroup = observerFactionId === undefined || group.factionId === observerFactionId;
      const contact = ownGroup ? undefined : this.getFactionContact(observerFactionId, group.id);
      if (observerFactionId !== undefined && !ownGroup && !contact) {
        continue;
      }
      if (group.action === "evacuated") {
        continue;
      }
      const renderPosition = contact
        ? {
            x: contact.lastKnown.x,
            z: contact.lastKnown.z,
            height: heightAt(this.setup.map, contact.lastKnown),
          }
        : getGroupRenderPosition(group, this.setup.map);
      groups.push({
        id: group.id,
        factionId: group.factionId,
        ...(observerFactionId === undefined
          ? {}
          : { visibility: ownGroup ? ("own" as const) : ("known" as const) }),
        ...(contact ? { observedAt: contact.observedAt } : {}),
        worldX: renderPosition.x * cellSizeMeters,
        worldY: renderPosition.height * heightUnitMeters,
        worldZ: renderPosition.z * cellSizeMeters,
        headingRadians: group.headingRadians,
        action: contact ? "searching" : group.action,
        moraleBps: contact ? 0 : group.moraleBps,
        suppressionBps: contact ? 0 : group.suppressionBps,
        activeMembers: contact ? 0 : activeMemberCount(group),
      });

      for (const platform of group.platforms) {
        platforms.push({
          id: platform.id,
          groupId: group.id,
          factionId: group.factionId,
          ...(observerFactionId === undefined
            ? {}
            : { visibility: ownGroup ? ("own" as const) : ("known" as const) }),
          ...(contact ? { observedAt: contact.observedAt } : {}),
          worldX: renderPosition.x * cellSizeMeters,
          worldY: renderPosition.height * heightUnitMeters,
          worldZ: renderPosition.z * cellSizeMeters,
          headingRadians: contact ? 0 : group.headingRadians,
          mobility: platform.mobility,
          combat: platform.combat,
          disposition: platform.disposition,
          damaged: platform.components.some((component) => component.integrityBps < 10_000),
          visualTypeId: platform.visualTypeId,
        });
      }

      if (contact) {
        continue;
      }
      const memberStates = [...group.members].sort(compareById);
      memberStates.forEach((member, memberIndex) => {
        if (member.presence === "evacuated" || member.placement.kind !== "dismounted") {
          return;
        }
        const offset = GROUP_SLOT_OFFSETS[memberIndex % GROUP_SLOT_OFFSETS.length] ?? [0, 0];
        members.push({
          id: member.id,
          groupId: group.id,
          factionId: group.factionId,
          worldX: (renderPosition.x + offset[0]) * cellSizeMeters,
          worldY: renderPosition.height * heightUnitMeters,
          worldZ: (renderPosition.z + offset[1]) * cellSizeMeters,
          health: member.health,
          presence: member.presence,
        });
      });
    }

    for (const objective of this.state.objectives) {
      objectives.push({
        id: objective.id,
        worldX: objective.center.x * cellSizeMeters,
        worldY: heightAt(this.setup.map, objective.center) * heightUnitMeters,
        worldZ: objective.center.z * cellSizeMeters,
        radiusMeters: objective.radiusCells * cellSizeMeters,
        state: objective.state,
        progressBps: objective.progressBps,
        attackerPower: objective.attackerPower,
        defenderPower: objective.defenderPower,
        attackerFactionId: objective.attackerFactionId,
        defenderFactionId: objective.defenderFactionId,
        unlocked: objective.unlocked,
      });
    }

    return { tick: this.state.tick, groups, members, platforms, objectives };
  }

  inspect(entityId: string, observerFactionId?: FactionId): EntityInspection | undefined {
    const group = this.state.groupsById.get(entityId);
    if (group) {
      if (observerFactionId !== undefined && group.factionId !== observerFactionId) {
        const contact = this.getFactionContact(observerFactionId, group.id);
        return contact ? this.inspectKnownGroup(group, contact) : undefined;
      }
      const inspection = this.inspectGroup(group);
      return observerFactionId === undefined
        ? inspection
        : { ...inspection, visibility: "own" };
    }
    const objective = this.state.objectives.find((candidate) => candidate.id === entityId);
    if (objective) {
      return this.inspectObjective(objective);
    }
    const platform = this.state.platformsById.get(entityId);
    if (platform) {
      if (observerFactionId !== undefined && platform.factionId !== observerFactionId) {
        return undefined;
      }
      const group = this.state.groupsById.get(platform.groupId);
      if (!group) {
        return undefined;
      }
      const inspection: PlatformInspection = {
        kind: "platform",
        ...this.platformSummary(platform),
        groupId: platform.groupId,
        factionId: platform.factionId,
        cell: { ...group.cell },
        visualTypeId: platform.visualTypeId,
        crewAssignments: platform.crewAssignments.map((assignment) => ({ ...assignment })),
        crewReassignments: platform.crewReassignments.map((action) => ({ ...action })),
        stations: this.platformStationInspections(platform),
        components: platform.components.map((component) => ({ ...component })),
        mobilityCapability: { ...this.platformCapabilities(platform).mobility },
        observation: { ...this.platformCapabilities(platform).observation },
        weapons: this.platformWeaponInspections(platform),
      };
      return inspection;
    }
    const member = this.state.membersById.get(entityId);
    if (!member || (observerFactionId !== undefined && member.factionId !== observerFactionId)) {
      return undefined;
    }
    const inspection: MemberInspection = {
      kind: "member",
      id: member.id,
      groupId: member.groupId,
      factionId: member.factionId,
      health: member.health,
      presence: member.presence,
      placement: { ...member.placement },
      magazineRounds: member.magazineRounds,
      reloadTicksRemaining: member.reloadTicksRemaining,
      shotCooldownTicks: member.shotCooldownTicks,
    };
    return inspection;
  }

  private getFactionContact(
    observerFactionId: FactionId | undefined,
    targetGroupId: GroupId,
  ): ContactState | undefined {
    if (observerFactionId === undefined) {
      return undefined;
    }
    let latest: ContactState | undefined = this.state.factionKnowledge
      .get(observerFactionId)
      ?.contacts.get(targetGroupId);
    for (const group of this.state.groups) {
      if (group.factionId !== observerFactionId) {
        continue;
      }
      const local = group.localContacts.get(targetGroupId);
      if (local && (!latest || local.observedAt > latest.observedAt)) {
        latest = local;
      }
    }
    if (!latest) {
      return undefined;
    }
    const confidence = confidenceAtAge(
      this.state.tick - latest.observedAt,
      this.setup.rules.contactForgetTicks,
    );
    return confidence > 0 ? { ...latest, confidenceBps: confidence } : undefined;
  }

  getResult(): BattleResult | undefined {
    return this.state.result;
  }

  drainEvents(): readonly BattleEvent[] {
    return this.state.events.splice(0, this.state.events.length);
  }

  getStateHash(): string {
    const hasher = new StateHasher();
    hasher.addString(this.setupHash);
    hasher.addNumber(this.state.tick);

    for (const group of this.state.groups) {
      hasher.addString(group.id);
      hasher.addString(group.groupTemplateId);
      hasher.addNumber(group.cell.x);
      hasher.addNumber(group.cell.z);
      hasher.addNumber(group.movingTo?.x ?? -1);
      hasher.addNumber(group.movingTo?.z ?? -1);
      hasher.addNumber(group.moveProgress);
      hasher.addNumber(group.moveCost);
      hasher.addNumber(group.turnTicksRemaining);
      hasher.addString(group.movementType);
      hasher.addString(group.action);
      hasher.addNumber(group.moraleBps);
      hasher.addString(group.moraleState);
      hasher.addNumber(group.suppressionBps);
      hasher.addNumber(group.waitAge);
      hasher.addNumber(group.patrolIndex);
      hasher.addNumber(group.lastFiredTick);
      hasher.addNumber(group.lastDecisionTick);
      hasher.addNumber(group.goal?.x ?? -1);
      hasher.addNumber(group.goal?.z ?? -1);
      hasher.addNumber(group.pathGoal?.x ?? -1);
      hasher.addNumber(group.pathGoal?.z ?? -1);
      hasher.addNumber(group.defenseSlot?.x ?? -1);
      hasher.addNumber(group.defenseSlot?.z ?? -1);
      hasher.addString(group.defenseRole ?? "");
      hasher.addString(group.assignedObjectiveId ?? "");
      hasher.addString(group.currentTargetId ?? "");
      hasher.addString(group.decisionReason);
      hasher.addString(group.coverDecision?.reason ?? "");
      hasher.addString(group.coverDecision?.selectedSlotId ?? "");
      hasher.addNumber(group.coverDecision?.score ?? 0);
      hasher.addNumber(group.coverDecision?.evaluatedAt ?? -1);
      hasher.addString(group.coverDecision?.threat?.targetGroupId ?? "");
      hasher.addNumber(group.coverDecision?.threat?.lastKnown.x ?? -1);
      hasher.addNumber(group.coverDecision?.threat?.lastKnown.z ?? -1);
      hasher.addNumber(group.coverDecision?.threat?.observedAt ?? -1);
      hasher.addString(group.coverDecision?.threat?.source ?? "");
      for (const member of group.members) {
        hasher.addString(member.id);
        hasher.addString(member.memberTemplateId);
        hasher.addString(member.weaponTemplateId);
        hasher.addString(member.health);
        hasher.addString(member.presence);
        hasher.addString(member.placement.kind);
        hasher.addString(member.placement.kind === "dismounted" ? "" : member.placement.platformId);
        hasher.addString(member.placement.kind === "crew" ? member.placement.stationId : "");
        hasher.addNumber(member.magazineRounds);
        hasher.addNumber(member.reloadTicksRemaining);
        hasher.addNumber(member.shotCooldownTicks);
      }
      for (const platform of group.platforms) {
        hasher.addString(platform.id);
        hasher.addString(platform.platformTemplateId);
        hasher.addString(platform.persistentPlatformId ?? "");
        hasher.addNumber(platform.facing);
        hasher.addString(platform.mobility);
        hasher.addString(platform.combat);
        hasher.addString(platform.disposition);
        for (const assignment of platform.crewAssignments) {
          hasher.addString(assignment.stationId);
          hasher.addString(assignment.memberId);
        }
        for (const reassignment of platform.crewReassignments) {
          hasher.addString(reassignment.memberId);
          hasher.addString(reassignment.fromStationId);
          hasher.addString(reassignment.toStationId);
          hasher.addNumber(reassignment.startedAt);
          hasher.addNumber(reassignment.ticksRemaining);
        }
        for (const component of platform.components) {
          hasher.addString(component.id);
          hasher.addString(component.kind);
          hasher.addNumber(component.integrityBps);
          hasher.addString(component.state);
        }
        for (const weapon of platform.weaponStates) {
          hasher.addString(weapon.componentId);
          hasher.addString(weapon.weaponTemplateId);
          hasher.addNumber(weapon.magazineRounds);
          hasher.addNumber(weapon.reloadTicksRemaining);
          hasher.addNumber(weapon.shotCooldownTicks);
        }
      }
      for (const contact of sortedContacts(group.localContacts)) {
        addContactToHash(hasher, contact);
      }
      for (const [targetId, observedAt] of [...group.searchedContacts].sort(([a], [b]) =>
        compareStrings(a, b),
      )) {
        hasher.addString(targetId);
        hasher.addNumber(observedAt);
      }
      for (const [targetId, detection] of [...group.localDetections].sort(([a], [b]) =>
        compareStrings(a, b),
      )) {
        hasher.addString(targetId);
        hasher.addNumber(detection.progressBps);
        hasher.addNumber(detection.lastCandidateTick);
        hasher.addNumber(detection.lastSentTick);
        for (const [factionId, sentTick] of [...(detection.lastSentTickByFaction ?? new Map())].sort(
          ([a], [b]) => compareStrings(a, b),
        )) {
          hasher.addString(factionId);
          hasher.addNumber(sentTick);
        }
        hasher.addNumber(detection.confirmed ? 1 : 0);
      }
      for (const pathCell of group.path) {
        hasher.addNumber(pathCell.x);
        hasher.addNumber(pathCell.z);
      }
    }

    for (const [slotId, groupId] of [...this.state.coverOccupancy].sort(([a], [b]) =>
      compareStrings(a, b),
    )) {
      hasher.addString(slotId);
      hasher.addString(groupId);
    }

    for (const faction of [...this.state.factionKnowledge.values()].sort(compareByFactionId)) {
      hasher.addString(faction.factionId);
      for (const contact of sortedContacts(faction.contacts)) {
        addContactToHash(hasher, contact);
      }
    }
    for (const message of [...this.state.intelQueue].sort(compareIntelMessages)) {
      hasher.addNumber(message.sequence);
      hasher.addString(message.factionId);
      hasher.addString(message.sourceGroupId);
      hasher.addString(message.targetGroupId);
      hasher.addNumber(message.observedAt);
      hasher.addNumber(message.deliveryAt);
      hasher.addNumber(message.lastKnown.x);
      hasher.addNumber(message.lastKnown.z);
      hasher.addNumber(message.confidenceBps);
    }
    for (const objective of this.state.objectives) {
      hasher.addString(objective.id);
      hasher.addString(objective.state);
      hasher.addNumber(objective.progressBps);
      hasher.addNumber(objective.attackerPower);
      hasher.addNumber(objective.defenderPower);
      hasher.addNumber(objective.unlocked ? 1 : 0);
    }
    for (const wave of this.state.reinforcementWaves) {
      hasher.addString(wave.id);
      hasher.addString(wave.status);
      hasher.addNumber(wave.lastWaitingEventTick ?? -1);
      for (const groupId of [...wave.deployedGroupIds].sort(compareStrings)) {
        hasher.addString(groupId);
      }
    }
    hasher.addNumber(this.state.lastMeaningfulProgressTick);
    hasher.addString(this.state.resolutionCandidateKey ?? "");
    hasher.addNumber(this.state.resolutionCandidateSince ?? -1);
    return hasher.digest();
  }

  private stepOnce(): void {
    this.updateReinforcements();
    this.updateCrewStations();
    this.deliverIntelMessages();
    this.updateSensing();
    this.updateDecisions();
    this.advanceMovement();
    const impacts = this.updateWeapons();
    this.updateMorale(impacts);
    this.updateEvacuation();
    this.updateObjective();
    this.state.tick += 1;
    this.updateTermination();
  }

  private initializePaths(): void {
    this.updateDecisions(true);
  }

  private assignDefenseSlots(): void {
    if (this.setup.mode.kind !== "defense" || this.state.objectives.length === 0) {
      return;
    }
    const defenderFactionId = this.setup.mode.defenderFactionId;
    const uniqueDefenders = [
      ...new Map(
        this.state.groups
          .filter((group) => group.factionId === defenderFactionId)
          .map((group) => [group.id, group]),
      ).values(),
    ]
      .sort((a, b) => compareStrings(a.id, b.id));
    const reserveRatioBps = this.setup.mode.reserveRatioBps ?? 0;
    const reserveCount = reserveRatioBps > 0
      ? Math.min(
          Math.max(1, Math.ceil((uniqueDefenders.length * reserveRatioBps) / 10_000)),
          Math.max(0, uniqueDefenders.length - 1),
        )
      : 0;
    const frontlineCount = uniqueDefenders.length - reserveCount;
    const assigned: GridCoord[] = [];
    uniqueDefenders.forEach((group, groupIndex) => {
      const role = groupIndex >= frontlineCount ? "reserve" : "frontline";
      const objectiveIndex = role === "reserve"
        ? (groupIndex - frontlineCount) % this.state.objectives.length
        : groupIndex % this.state.objectives.length;
      const objective = this.state.objectives[objectiveIndex] ?? this.state.objectives[0]!;
      group.defenseRole = role;
      group.assignedObjectiveId = objective.id;
      const maximumRadius = objective.radiusCells + (role === "reserve" ? 7 : 4);
      const candidates: GridCoord[] = [];
      for (
        let z = objective.center.z - maximumRadius;
        z <= objective.center.z + maximumRadius;
        z += 1
      ) {
        for (
          let x = objective.center.x - maximumRadius;
          x <= objective.center.x + maximumRadius;
          x += 1
        ) {
          const candidate = { x, z };
          const distance = squaredGridDistance(candidate, objective.center);
          if (
            isWalkable(this.setup.map, candidate, group.movementType) &&
            distance <= maximumRadius ** 2 &&
            (role !== "reserve" || distance >= (objective.radiusCells + 1) ** 2)
          ) {
            candidates.push(candidate);
          }
        }
      }
      candidates.sort((a, b) => cellIndex(this.setup.map, a) - cellIndex(this.setup.map, b));
      const preferredRadius = role === "reserve"
        ? objective.radiusCells + 5
        : groupIndex % 2 === 0
          ? Math.max(1, objective.radiusCells - 1)
          : objective.radiusCells + 2;
      const reachable = candidates.filter((candidate) => {
        if (assigned.some((slot) => sameCoord(slot, candidate))) {
          return false;
        }
        if (
          role === "frontline" &&
          groupIndex === 0 &&
          squaredGridDistance(candidate, objective.center) > objective.radiusCells ** 2
        ) {
          return false;
        }
        return this.pathfinderFor(group).findPath(group.cell, candidate).length > 0;
      });
      reachable.sort((a, b) => {
        const scoreDifference =
          defenseSlotScore(
            this.setup.map,
            b,
            objective.center,
            preferredRadius,
            assigned,
            this.coverSlotsByCell.get(cellIndex(this.setup.map, b)),
            activeMemberCount(group),
          ) -
          defenseSlotScore(
            this.setup.map,
            a,
            objective.center,
            preferredRadius,
            assigned,
            this.coverSlotsByCell.get(cellIndex(this.setup.map, a)),
            activeMemberCount(group),
          );
        return scoreDifference || cellIndex(this.setup.map, a) - cellIndex(this.setup.map, b);
      });
      const slot = reachable[0] ?? objective.center;
      group.defenseSlot = { ...slot };
      assigned.push({ ...slot });
      const coverSlot = this.coverSlotsByCell.get(cellIndex(this.setup.map, slot));
      group.coverDecision = coverSlot
        ? {
            reason: "defend-objective-cover",
            selectedSlotId: coverSlot.id,
            score: coverTacticalScore(
              undirectedCoverEffect(coverSlot, activeMemberCount(group)),
              0,
              false,
              false,
            ),
            evaluatedAt: this.state.tick,
          }
        : {
            reason: "no-cover-available",
            score: 0,
            evaluatedAt: this.state.tick,
          };
    });
  }

  private updateReinforcements(): void {
    for (const wave of this.state.reinforcementWaves) {
      if (wave.status === "deployed" || wave.status === "cancelled" || this.state.tick < wave.arrivalTick) {
        continue;
      }
      if (wave.status === "pending") {
        wave.status = "waiting";
        this.emit({
          type: "reinforcement-triggered",
          waveId: wave.id,
          factionId: wave.factionId,
        });
      }
      this.tryDeployReinforcementWave(wave);
    }
  }

  private tryDeployReinforcementWave(wave: ReinforcementRuntimeState): void {
    const deployed = new Set(wave.deployedGroupIds);
    const remainingGroups = wave.groups
      .filter((group) => !deployed.has(group.id))
      .sort(compareById);
    if (remainingGroups.length === 0) {
      wave.status = "deployed";
      return;
    }

    const entranceCandidates = wave.blockedPolicy === "try-alternate"
      ? wave.entranceIds
      : wave.entranceIds.slice(0, 1);
    const entrances = entranceCandidates
      .map((id) => this.setup.reinforcementEntrances.find((entrance) => entrance.id === id))
      .filter((entrance): entrance is BattleSetup["reinforcementEntrances"][number] => Boolean(entrance));
    const selected = entrances.find((entrance) => {
      if (this.isEnemyControlledEntrance(entrance)) {
        return false;
      }
      return remainingGroups.some(
        (group) =>
          this.openEntranceCells(
            entrance,
            movementTypeForGroup(this.setup, group),
          ).length > 0,
      );
    });
    if (!selected) {
      if (wave.blockedPolicy === "cancel") {
        wave.status = "cancelled";
        this.emit({
          type: "reinforcement-cancelled",
          waveId: wave.id,
          remainingGroupIds: remainingGroups.map((group) => group.id),
          reason: entrances.length === 0 ? "invalid-entrance" : "entrance-blocked",
        });
      } else if (
        wave.lastWaitingEventTick === undefined ||
        this.state.tick - wave.lastWaitingEventTick >= this.setup.rules.ticksPerSecond
      ) {
        wave.lastWaitingEventTick = this.state.tick;
        this.emit({
          type: "reinforcement-waiting",
          waveId: wave.id,
          remainingGroupCount: remainingGroups.length,
          reason: entrances.length > 0 && entrances.some((entrance) => !this.isEnemyControlledEntrance(entrance))
            ? "capacity"
            : "entrance-blocked",
        });
      }
      return;
    }

    const deployedGroups: GroupState[] = [];
    const usedCells = new Set<number>();
    for (const spawn of remainingGroups) {
      if (deployedGroups.length >= selected.capacityPerTick) {
        break;
      }
      const openCell = this.openEntranceCells(
        selected,
        movementTypeForGroup(this.setup, spawn),
      ).find((cell) => !usedCells.has(cellIndex(this.setup.map, cell)));
      if (!openCell) {
        continue;
      }
      usedCells.add(cellIndex(this.setup.map, openCell));
      const group = createGroupState(spawn, openCell, this.setup.content!);
      deployedGroups.push(group);
      wave.deployedGroupIds.push(group.id);
      this.state.groupsById.set(group.id, group);
      for (const member of group.members) {
        this.state.membersById.set(member.id, member);
      }
      for (const platform of group.platforms) {
        this.state.platformsById.set(platform.id, platform);
      }
      this.state.occupancy.set(cellIndex(this.setup.map, group.cell), group.id);
      const coverSlot = this.coverSlotsByCell.get(cellIndex(this.setup.map, group.cell));
      if (coverSlot && activeMemberCount(group) > 0 && group.platforms.length === 0) {
        claimCoverSlot(this.state.coverOccupancy, coverSlot, group.id);
      }
    }
    this.state.groups.push(...deployedGroups);
    this.state.groups.sort(compareById);
    this.assignDefenseSlots();
    for (const group of deployedGroups.sort(compareById)) {
      this.decideForGroup(group);
    }
    this.emit({
      type: "reinforcement-deployed",
      waveId: wave.id,
      groupIds: deployedGroups.map((group) => group.id).sort(compareStrings),
      entranceId: selected.id,
    });
    this.markMeaningfulProgress();
    if (wave.deployedGroupIds.length === wave.groups.length) {
      wave.status = "deployed";
    } else {
      wave.status = "waiting";
      this.emit({
        type: "reinforcement-waiting",
        waveId: wave.id,
        remainingGroupCount: wave.groups.length - wave.deployedGroupIds.length,
        reason: "capacity",
      });
    }
  }

  private openEntranceCells(
    entrance: BattleSetup["reinforcementEntrances"][number],
    movementType: MovementType = "foot",
  ): readonly GridCoord[] {
    return entrance.cells
      .filter((cell) => {
        const index = cellIndex(this.setup.map, cell);
        return (
          isWalkable(this.setup.map, cell, movementType) &&
          !this.state.occupancy.has(index) &&
          !this.state.reservations.has(index)
        );
      })
      .sort((a, b) => cellIndex(this.setup.map, a) - cellIndex(this.setup.map, b));
  }

  private isEnemyControlledEntrance(
    entrance: BattleSetup["reinforcementEntrances"][number],
  ): boolean {
    return this.state.groups.some(
      (group) =>
        activeMemberCount(group) > 0 &&
        this.isHostile(group.factionId, entrance.factionId) &&
        entrance.cells.some((cell) => sameCoord(group.cell, cell)),
    );
  }

  private updateCrewStations(): void {
    const platforms = [...this.state.platformsById.values()].sort(compareById);
    for (const platform of platforms) {
      const activeAction = platform.crewReassignments[0];
      if (activeAction) {
        const member = this.state.membersById.get(activeAction.memberId);
        const assignment = platform.crewAssignments.find(
          (candidate) =>
            candidate.memberId === activeAction.memberId &&
            candidate.stationId === activeAction.fromStationId,
        );
        if (!member || !assignment || !this.isActiveCrewMember(member, platform)) {
          platform.crewReassignments.splice(0, 1);
          this.emit({
            type: "crew-station-changed",
            platformId: platform.id,
            groupId: platform.groupId,
            memberId: activeAction.memberId,
            fromStationId: activeAction.fromStationId,
            toStationId: activeAction.toStationId,
            phase: "cancelled",
          });
        } else {
          activeAction.ticksRemaining = Math.max(0, activeAction.ticksRemaining - 1);
          if (activeAction.ticksRemaining === 0) {
            this.completeCrewReassignment(platform, activeAction);
          }
        }
      }

      this.refreshPlatformState(platform, true);
      if (platform.crewReassignments.length > 0 || platform.disposition !== "crewed") {
        continue;
      }
      const template = getPlatformTemplate(this.setup.content, platform.platformTemplateId);
      const proposal = selectCrewReassignment(
        template,
        platform.crewAssignments,
        this.crewCapabilityMembers(platform),
        platform.crewReassignments,
      );
      if (!proposal) {
        continue;
      }
      const targetStation = template.crewStationRules.find(
        (station) => station.id === proposal.toStationId,
      );
      if (!targetStation) {
        continue;
      }
      const action = {
        memberId: proposal.memberId,
        fromStationId: proposal.fromStationId,
        toStationId: proposal.toStationId,
        startedAt: this.state.tick,
        ticksRemaining: targetStation.replacementTicks,
      };
      platform.crewReassignments.push(action);
      this.emit({
        type: "crew-station-changed",
        platformId: platform.id,
        groupId: platform.groupId,
        memberId: action.memberId,
        fromStationId: action.fromStationId,
        toStationId: action.toStationId,
        phase: "started",
      });
      if (action.ticksRemaining === 0) {
        this.completeCrewReassignment(platform, action);
      }
      this.refreshPlatformState(platform, true);
      this.markMeaningfulProgress();
    }
  }

  private completeCrewReassignment(
    platform: PlatformState,
    action: PlatformState["crewReassignments"][number],
  ): void {
    const sourceIndex = platform.crewAssignments.findIndex(
      (assignment) =>
        assignment.memberId === action.memberId &&
        assignment.stationId === action.fromStationId,
    );
    if (sourceIndex < 0) {
      platform.crewReassignments.splice(0, 1);
      return;
    }
    const targetIndex = platform.crewAssignments.findIndex(
      (assignment) => assignment.stationId === action.toStationId,
    );
    const displaced = targetIndex >= 0 ? platform.crewAssignments[targetIndex] : undefined;
    platform.crewAssignments[sourceIndex] = {
      stationId: action.toStationId,
      memberId: action.memberId,
    };
    if (targetIndex >= 0 && targetIndex !== sourceIndex && displaced) {
      platform.crewAssignments[targetIndex] = {
        stationId: action.fromStationId,
        memberId: displaced.memberId,
      };
      const displacedMember = this.state.membersById.get(displaced.memberId);
      if (displacedMember) {
        displacedMember.placement = {
          kind: "crew",
          platformId: platform.id,
          stationId: action.fromStationId,
        };
      }
    }
    const member = this.state.membersById.get(action.memberId);
    if (member) {
      member.placement = {
        kind: "crew",
        platformId: platform.id,
        stationId: action.toStationId,
      };
    }
    platform.crewReassignments.splice(0, 1);
    this.emit({
      type: "crew-station-changed",
      platformId: platform.id,
      groupId: platform.groupId,
      memberId: action.memberId,
      fromStationId: action.fromStationId,
      toStationId: action.toStationId,
      phase: "completed",
    });
    this.markMeaningfulProgress();
  }

  private refreshPlatformState(platform: PlatformState, emitEvent: boolean): void {
    const previous = {
      mobility: platform.mobility,
      combat: platform.combat,
      disposition: platform.disposition,
    };
    const capabilities = this.platformCapabilities(platform);
    platform.mobility = capabilities.mobility.available ? "mobile" : "immobilized";
    platform.combat = capabilities.weapons.some((weapon) => weapon.available)
      ? "effective"
      : "ineffective";
    platform.disposition = capabilities.disposition;
    if (
      emitEvent &&
      (previous.mobility !== platform.mobility ||
        previous.combat !== platform.combat ||
        previous.disposition !== platform.disposition)
    ) {
      this.emit({
        type: "platform-state-changed",
        platformId: platform.id,
        groupId: platform.groupId,
        from: previous,
        to: {
          mobility: platform.mobility,
          combat: platform.combat,
          disposition: platform.disposition,
        },
      });
      this.markMeaningfulProgress();
    }
  }

  private platformCapabilities(platform: PlatformState) {
    const template = getPlatformTemplate(this.setup.content, platform.platformTemplateId);
    return derivePlatformCapabilities(
      template,
      platform.components,
      platform.crewAssignments,
      this.crewCapabilityMembers(platform),
      platform.crewReassignments,
    );
  }

  private crewCapabilityMembers(platform: PlatformState) {
    const group = this.state.groupsById.get(platform.groupId);
    return (group?.members ?? []).map((member) => ({
      id: member.id,
      roleTags: getMemberTemplate(this.setup.content, member.memberTemplateId).roleTags,
      active: this.isActiveCrewMember(member, platform),
    }));
  }

  private isActiveCrewMember(member: MemberState, platform: PlatformState): boolean {
    return (
      canMemberFight(member) &&
      member.placement.kind === "crew" &&
      member.placement.platformId === platform.id
    );
  }

  private deliverIntelMessages(): void {
    this.state.intelQueue.sort(compareIntelMessages);
    let deliveredCount = 0;
    for (const message of this.state.intelQueue) {
      if (message.deliveryAt > this.state.tick) {
        break;
      }
      deliveredCount += 1;
      const knowledge = this.state.factionKnowledge.get(message.factionId);
      if (!knowledge) {
        continue;
      }
      const current = knowledge.contacts.get(message.targetGroupId);
      if (!current || message.observedAt > current.observedAt) {
        knowledge.contacts.set(message.targetGroupId, {
          targetGroupId: message.targetGroupId,
          lastKnown: { ...message.lastKnown },
          observedAt: message.observedAt,
          lastDirectTick: -1,
          confidenceBps: message.confidenceBps,
          sourceGroupId: message.sourceGroupId,
        });
        this.emit({
          type: "intel-delivered",
          factionId: message.factionId,
          targetGroupId: message.targetGroupId,
        });
      }
    }
    if (deliveredCount > 0) {
      this.state.intelQueue.splice(0, deliveredCount);
    }
  }

  private updateSensing(): void {
    for (const observer of this.state.groups) {
      if (!isGroupSpatiallyActive(observer)) {
        continue;
      }
      const sightRangeSquared = this.groupSightRangeCells(observer) ** 2;
      for (const target of this.state.groups) {
        if (
          observer.factionId === target.factionId ||
          !isGroupSpatiallyActive(target) ||
          activeMemberCount(target) === 0
        ) {
          continue;
        }

        const distanceSquared = squaredGridDistance(observer.cell, target.cell);
        const cover = this.getDirectionalCover(target, observer.cell);
        const observerCover = this.getDirectionalCover(observer, target.cell);
        const candidate =
          distanceSquared <= sightRangeSquared &&
          hasLineOfSight(this.setup.map, observer.cell, target.cell, {
            ignoredStaticObjectCells: this.activeCoverObjectCells(observerCover, cover),
          });
        const detection = observer.localDetections.get(target.id) ?? {
          progressBps: 0,
          lastCandidateTick: -1,
          lastSentTick: -this.setup.rules.intelUpdateIntervalTicks,
          lastSentTickByFaction: new Map(),
          confirmed: false,
        };

        if (candidate) {
          const exposureBonus =
            this.state.tick - target.lastFiredTick <= this.setup.rules.ticksPerSecond
              ? this.groupExposureOnFireBps(target)
              : 0;
          const distanceBonus = Math.max(0, sightRangeSquared - distanceSquared) * 7;
          const detectionGain = applyBasisPointReduction(
            480 + distanceBonus + exposureBonus,
            cover?.effect.concealmentBps ?? 0,
          );
          detection.progressBps = Math.min(
            DETECTION_THRESHOLD_BPS,
            detection.progressBps + Math.max(1, detectionGain),
          );
          detection.lastCandidateTick = this.state.tick;
          if (detection.progressBps >= DETECTION_THRESHOLD_BPS) {
            if (!detection.confirmed) {
              detection.confirmed = true;
              this.emit({
                type: "contact-spotted",
                observerGroupId: observer.id,
                targetGroupId: target.id,
              });
              if (this.isHostile(observer.factionId, target.factionId)) {
                this.markMeaningfulProgress();
              }
            }
            observer.localContacts.set(target.id, {
              targetGroupId: target.id,
              lastKnown: { ...target.cell },
              observedAt: this.state.tick,
              lastDirectTick: this.state.tick,
              confidenceBps: 10_000,
              sourceGroupId: observer.id,
            });
            this.queueIntel(observer, target, detection);
          }
        } else {
          detection.progressBps = Math.max(0, detection.progressBps - 160);
        }
        observer.localDetections.set(target.id, detection);
      }

      for (const [targetId, contact] of observer.localContacts) {
        const age = this.state.tick - contact.observedAt;
        contact.confidenceBps = confidenceAtAge(age, this.setup.rules.contactForgetTicks);
        if (age > this.setup.rules.contactForgetTicks) {
          observer.localContacts.delete(targetId);
          observer.localDetections.delete(targetId);
        }
      }
    }

    for (const knowledge of this.state.factionKnowledge.values()) {
      for (const [targetId, contact] of knowledge.contacts) {
        const age = this.state.tick - contact.observedAt;
        contact.confidenceBps = confidenceAtAge(age, this.setup.rules.contactForgetTicks);
        if (age > this.setup.rules.contactForgetTicks) {
          knowledge.contacts.delete(targetId);
        }
      }
    }
  }

  private queueIntel(
    observer: GroupState,
    target: GroupState,
    detection: DetectionState,
  ): void {
    const lastSentTickByFaction =
      detection.lastSentTickByFaction ?? new Map<FactionId, number>();
    detection.lastSentTickByFaction = lastSentTickByFaction;
    const recipients = this.setup.factions
      .map((faction) => {
        if (faction.id === observer.factionId) {
          return {
            factionId: faction.id,
            deliveryDelayTicks: this.setup.rules.sameFactionIntelDelayTicks,
            updateIntervalTicks: this.setup.rules.intelUpdateIntervalTicks,
          };
        }
        const relation = findRelation(this.setup.relations, observer.factionId, faction.id);
        if (!relation || relation.kind !== "allied" || !relation.shareIntel) {
          return undefined;
        }
        return {
          factionId: faction.id,
          deliveryDelayTicks: relation.minimumIntelDelayTicks,
          updateIntervalTicks: relation.intelUpdateIntervalTicks,
        };
      })
      .filter(
        (
          recipient,
        ): recipient is {
          factionId: FactionId;
          deliveryDelayTicks: number;
          updateIntervalTicks: number;
        } => Boolean(recipient),
      )
      .sort((a, b) => compareStrings(a.factionId, b.factionId));

    for (const recipient of recipients) {
      const lastSentTick =
        recipient.factionId === observer.factionId
          ? detection.lastSentTick
          : (lastSentTickByFaction.get(recipient.factionId) ??
            -recipient.updateIntervalTicks);
      if (this.state.tick - lastSentTick < recipient.updateIntervalTicks) {
        continue;
      }
      this.state.intelQueue.push({
        sequence: this.state.intelSequence,
        factionId: recipient.factionId,
        sourceGroupId: observer.id,
        targetGroupId: target.id,
        observedAt: this.state.tick,
        deliveryAt: this.state.tick + recipient.deliveryDelayTicks,
        lastKnown: { ...target.cell },
        confidenceBps: 10_000,
      });
      this.state.intelSequence += 1;
      if (recipient.factionId === observer.factionId) {
        detection.lastSentTick = this.state.tick;
      } else {
        lastSentTickByFaction.set(recipient.factionId, this.state.tick);
      }
    }
  }

  private updateDecisions(force = false): void {
    this.state.groups.forEach((group, groupIndex) => {
      if (
        !force &&
        (this.state.tick + groupIndex) % AI_INTERVAL_TICKS !== 0
      ) {
        return;
      }
      group.lastDecisionTick = this.state.tick;
      this.decideForGroup(group);
    });
  }

  private decideForGroup(group: GroupState): void {
    if (activeMemberCount(group) === 0) {
      this.cancelMovement(group);
      this.releaseCover(group);
      this.state.occupancy.delete(cellIndex(this.setup.map, group.cell));
      group.action = hasEvacuatedMembers(group) ? "evacuated" : "combat-ineffective";
      group.decisionReason = "no-active-members";
      group.goal = undefined;
      group.path = [];
      group.currentTargetId = undefined;
      group.coverDecision = undefined;
      return;
    }
    if (group.moraleState === "routing") {
      group.action = "routing";
      group.decisionReason = "low-morale";
      group.currentTargetId = undefined;
      group.coverDecision = undefined;
      this.assignGoal(group, group.evacuation);
      return;
    }

    const defenseMode = this.setup.mode.kind === "defense" ? this.setup.mode : undefined;
    const isDefender = defenseMode?.defenderFactionId === group.factionId;
    const isAttacker = defenseMode?.attackerFactionId === group.factionId;
    const objective = isDefender
      ? this.state.objectives.find(
          (candidate) => candidate.id === group.assignedObjectiveId,
        ) ?? this.state.objectives[0]
      : isAttacker
        ? this.chooseObjectiveForAttacker(group)
        : undefined;
    const directTarget = this.chooseDirectTarget(group);
    const directContact = directTarget
      ? group.localContacts.get(directTarget.id)
      : undefined;
    const bestContact = directContact ?? this.chooseBestKnownContact(group);
    const coverThreat = bestContact
      ? this.createCoverThreat(group, bestContact)
      : undefined;
    const defenseConstraint =
      isDefender && objective
        ? { center: objective.center, radiusCells: objective.radiusCells + 5 }
        : undefined;
    let holdingSuppressionCover = false;

    if (
      group.suppressionBps >= HIGH_SUPPRESSION_COVER_THRESHOLD_BPS &&
      coverThreat
    ) {
      const coverOption = this.findBestCoverOption(
        group,
        coverThreat,
        defenseConstraint,
        COVER_SEARCH_RADIUS_CELLS,
        false,
      );
      if (coverOption) {
        if (this.isCurrentCoverOption(group, coverOption)) {
          this.recordCoverDecision(group, "hold-cover", coverOption, coverThreat);
          holdingSuppressionCover = true;
        } else {
          this.moveToCover(
            group,
            coverOption,
            "seek-cover-high-suppression",
            coverThreat,
          );
          return;
        }
      } else {
        this.recordCoverDecision(group, "no-cover-available", undefined, coverThreat);
      }
    }

    if (directTarget) {
      const distanceSquared = squaredGridDistance(group.cell, directTarget.cell);
      if (
        group.suppressionBps < HIGH_SUPPRESSION_COVER_THRESHOLD_BPS &&
        isDefender &&
        coverThreat
      ) {
        const currentCover = this.getDirectionalCover(group, coverThreat.lastKnown);
        if (!currentCover || currentCover.effect.protectionBps < 1_000) {
          const coverOption = this.findBestCoverOption(
            group,
            coverThreat,
            defenseConstraint,
            COVER_SEARCH_RADIUS_CELLS,
            true,
          );
          if (coverOption) {
            if (this.isCurrentCoverOption(group, coverOption)) {
              this.recordCoverDecision(group, "hold-cover", coverOption, coverThreat);
            } else {
              this.moveToCover(group, coverOption, "seek-cover-defense", coverThreat);
              return;
            }
          } else {
            this.recordCoverDecision(group, "no-cover-available", undefined, coverThreat);
          }
        } else {
          const currentOption = this.coverOptionAtCurrentCell(group, coverThreat);
          if (currentOption) {
            this.recordCoverDecision(group, "hold-cover", currentOption, coverThreat);
          }
        }
      }
      if (
        group.suppressionBps >= HIGH_SUPPRESSION_COVER_THRESHOLD_BPS &&
        !holdingSuppressionCover
      ) {
        const saferCell = this.findSaferAdjacentCell(
          group,
          coverThreat?.lastKnown ?? directTarget.cell,
          defenseConstraint,
        );
        if (saferCell) {
          group.action = "moving-to-contact";
          group.decisionReason = "avoid-threat-high-suppression";
          group.currentTargetId = directTarget.id;
          this.assignGoal(group, saferCell);
          return;
        }
      }
      if (isAttacker && objective && !isInsideObjective(group.cell, objective)) {
        group.action = "moving-to-contact";
        group.decisionReason = "assault-objective";
        group.currentTargetId = directTarget.id;
        this.assignGoal(group, objective.center);
        return;
      }
      if (distanceSquared <= this.groupWeaponRangeCells(group) ** 2) {
        if (this.hasFriendlyBlocker(group, directTarget)) {
          const firingOption = this.findClearFiringOption(group, directTarget);
          if (firingOption) {
            group.action = "moving-to-contact";
            group.decisionReason = "clear-line-of-fire";
            group.currentTargetId = directTarget.id;
            group.goal = { ...firingOption.goal };
            group.pathGoal = { ...firingOption.goal };
            group.path = firingOption.path.map((coord) => ({ ...coord }));
            group.waitAge = 0;
            return;
          }
        }
        if (isDefender && !group.movingTo) {
          this.cancelMovement(group);
        }
        group.action = "engaging";
        group.decisionReason = "direct-contact";
        group.currentTargetId = directTarget.id;
        group.goal = undefined;
        group.path = [];
        return;
      }
    }

    if (isDefender && objective) {
      this.holdDefensePosition(group, objective);
      return;
    }

    const contactSupportsObjective =
      !bestContact ||
      !isAttacker ||
      !objective ||
      squaredGridDistance(bestContact.lastKnown, objective.center) <=
        (objective.radiusCells + 8) ** 2;
    if (bestContact && contactSupportsObjective) {
      if (squaredGridDistance(group.cell, bestContact.lastKnown) <= 1) {
        this.markContactSearched(group, bestContact);
      } else {
        group.action = "moving-to-contact";
        group.decisionReason =
          bestContact.sourceGroupId === group.id ? "direct-contact" : "shared-contact";
        group.currentTargetId = bestContact.targetGroupId;
        this.assignGoal(group, bestContact.lastKnown);
        return;
      }
    }

    if (isAttacker && objective) {
      group.currentTargetId = undefined;
      if (isInsideObjective(group.cell, objective)) {
        group.action = "searching";
        group.decisionReason = "capture-objective";
        group.goal = undefined;
        group.path = [];
      } else {
        group.action = "moving-to-contact";
        group.decisionReason = "advance-objective";
        this.assignGoal(group, objective.center);
      }
      return;
    }

    group.action = "searching";
    group.decisionReason = "search-sector";
    group.currentTargetId = undefined;
    const patrolGoal = this.getPatrolGoal(group);
    if (squaredGridDistance(group.cell, patrolGoal) <= 1) {
      group.patrolIndex += 1;
      this.assignGoal(group, this.getPatrolGoal(group));
    } else {
      this.assignGoal(group, patrolGoal);
    }
  }

  private holdDefensePosition(
    group: GroupState,
    objective: ObjectiveRuntimeState,
  ): void {
    const slot = group.defenseSlot ?? objective.center;
    group.currentTargetId = undefined;
    const assignedCover = this.coverSlotsByCell.get(cellIndex(this.setup.map, slot));
    const reachedSlot = assignedCover
      ? sameCoord(group.cell, slot)
      : squaredGridDistance(group.cell, slot) <= 1;
    if (reachedSlot) {
      group.action = "searching";
      group.decisionReason = "defend-objective";
      group.goal = undefined;
      group.path = [];
      return;
    }
    group.action = "moving-to-contact";
    group.decisionReason = "defend-objective";
    this.assignGoal(group, slot);
  }

  private chooseObjectiveForAttacker(group: GroupState): ObjectiveRuntimeState | undefined {
    const candidates = this.state.objectives
      .filter((objective) => objective.unlocked && objective.state !== "attacker-controlled")
      .map((objective) => ({
        objective,
        pathLength: this.pathfinderFor(group).findPath(group.cell, objective.center).length ||
          Number.MAX_SAFE_INTEGER,
      }))
      .sort((a, b) => {
        if (this.setup.mode.kind === "defense" && this.setup.mode.objectiveRule === "sequence") {
          return this.state.objectives.indexOf(a.objective) -
            this.state.objectives.indexOf(b.objective);
        }
        return (
          a.pathLength - b.pathLength ||
          squaredGridDistance(group.cell, a.objective.center) -
            squaredGridDistance(group.cell, b.objective.center) ||
          compareStrings(a.objective.id, b.objective.id)
        );
      });
    const objective = candidates[0]?.objective;
    if (objective) {
      group.assignedObjectiveId = objective.id;
    }
    return objective;
  }

  private chooseDirectTarget(group: GroupState): GroupState | undefined {
    const candidates = [...group.localContacts.values()]
      .filter(
        (contact) =>
          this.state.tick - contact.lastDirectTick <= DIRECT_CONTACT_FRESH_TICKS,
      )
      .map((contact) => this.state.groupsById.get(contact.targetGroupId))
      .filter(
        (target): target is GroupState =>
          Boolean(
            target &&
              activeMemberCount(target) > 0 &&
              this.isHostile(group.factionId, target.factionId),
          ),
      )
      .sort((a, b) => {
        const distanceDifference =
          squaredGridDistance(group.cell, a.cell) - squaredGridDistance(group.cell, b.cell);
        return distanceDifference || compareStrings(a.id, b.id);
      });
    return candidates[0];
  }

  private chooseBestKnownContact(group: GroupState): ContactState | undefined {
    const merged = new Map<GroupId, ContactState>();
    const factionContacts = this.state.factionKnowledge.get(group.factionId)?.contacts;
    for (const contact of factionContacts?.values() ?? []) {
      merged.set(contact.targetGroupId, contact);
    }
    for (const contact of group.localContacts.values()) {
      const known = merged.get(contact.targetGroupId);
      if (!known || contact.observedAt >= known.observedAt) {
        merged.set(contact.targetGroupId, contact);
      }
    }
    return [...merged.values()]
      .filter(
        (contact) =>
          contact.confidenceBps > 0 &&
          contact.observedAt > (group.searchedContacts.get(contact.targetGroupId) ?? -1) &&
          this.state.groupsById.get(contact.targetGroupId) !== undefined &&
          this.isHostile(
            group.factionId,
            this.state.groupsById.get(contact.targetGroupId)!.factionId,
          ),
      )
      .sort((a, b) => {
        const recency = b.observedAt - a.observedAt;
        if (recency !== 0) {
          return recency;
        }
        const distance =
          squaredGridDistance(group.cell, a.lastKnown) -
          squaredGridDistance(group.cell, b.lastKnown);
        return distance || compareStrings(a.targetGroupId, b.targetGroupId);
      })[0];
  }

  private markContactSearched(group: GroupState, contact: ContactState): void {
    group.searchedContacts.set(contact.targetGroupId, contact.observedAt);
    const local = group.localContacts.get(contact.targetGroupId);
    if (local && local.observedAt <= contact.observedAt) {
      group.localContacts.delete(contact.targetGroupId);
    }
  }

  private assignGoal(group: GroupState, desiredGoal: GridCoord): void {
    const goal = this.findNearestWalkable(desiredGoal, group.cell, group.movementType);
    const goalChanged = !group.goal || !sameCoord(group.goal, goal);
    if (!goalChanged && group.path.length > 0) {
      group.goal = goal;
      return;
    }
    if (goalChanged) {
      group.waitAge = 0;
    }
    group.goal = goal;
    group.pathGoal = goal;
    const path = this.pathfinderFor(group).findPath(group.movingTo ?? group.cell, goal);
    group.path = path.map((coord) => ({ ...coord }));
  }

  private getPatrolGoal(group: GroupState): GridCoord {
    const factionIndex = this.setup.factions.findIndex(
      (faction) => faction.id === group.factionId,
    );
    const hash = deterministicUint32(
      this.setup.seed,
      "patrol",
      group.patrolIndex,
      group.id,
      0,
    );
    const laneCount = Math.max(3, Math.floor(this.setup.map.height / 8));
    const lane = hash % laneCount;
    const z = Math.round(((lane + 1) * (this.setup.map.height - 4)) / (laneCount + 1)) + 2;
    const phase = group.patrolIndex % 4;
    const fractions = this.setup.factions.length === 2
      ? factionIndex === 0
        ? [0.62, 0.78, 0.48, 0.7]
        : [0.38, 0.22, 0.52, 0.3]
      : [0.04, -0.04, 0.03, -0.03].map(
          (offset) => this.getFactionPatrolSectorFraction(group.factionId) + offset,
        );
    const fraction = Math.min(0.92, Math.max(0.08, fractions[phase] ?? 0.5));
    const x = Math.round((this.setup.map.width - 1) * fraction);
    return this.findNearestWalkable(
      { x, z: Math.min(this.setup.map.height - 2, z) },
      group.cell,
      group.movementType,
    );
  }

  private getFactionPatrolSectorFraction(factionId: FactionId): number {
    const factionSpawns = this.setup.groups.filter(
      (spawn) => spawn.factionId === factionId,
    );
    const averageSpawnX =
      factionSpawns.reduce((sum, spawn) => sum + spawn.spawn.x, 0) /
      Math.max(1, factionSpawns.length);
    const deploymentFraction = averageSpawnX / Math.max(1, this.setup.map.width - 1);
    return 0.12 + deploymentFraction * 0.76;
  }

  private findNearestWalkable(
    origin: GridCoord,
    reachableFrom: GridCoord,
    movementType: MovementType,
  ): GridCoord {
    const clamped = {
      x: Math.min(this.setup.map.width - 1, Math.max(0, Math.round(origin.x))),
      z: Math.min(this.setup.map.height - 1, Math.max(0, Math.round(origin.z))),
    };
    const componentIds = this.walkableComponentIds.get(movementType)!;
    const reachableComponent = componentIds[cellIndex(this.setup.map, reachableFrom)] ?? -1;
    const isReachable = (candidate: GridCoord): boolean =>
      isWalkable(this.setup.map, candidate, movementType) &&
      componentIds[cellIndex(this.setup.map, candidate)] === reachableComponent;
    if (isReachable(clamped)) {
      return clamped;
    }
    for (let radius = 1; radius < Math.max(this.setup.map.width, this.setup.map.height); radius += 1) {
      const candidates: GridCoord[] = [];
      for (let dz = -radius; dz <= radius; dz += 1) {
        for (let dx = -radius; dx <= radius; dx += 1) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== radius) {
            continue;
          }
          const candidate = { x: clamped.x + dx, z: clamped.z + dz };
          if (isReachable(candidate)) {
            candidates.push(candidate);
          }
        }
      }
      candidates.sort((a, b) => cellIndex(this.setup.map, a) - cellIndex(this.setup.map, b));
      if (candidates[0]) {
        return candidates[0];
      }
    }
    return { ...reachableFrom };
  }

  private isStationaryFriendlyBlocker(
    group: GroupState,
    blockerId: GroupId | undefined,
  ): boolean {
    const blocker = blockerId ? this.state.groupsById.get(blockerId) : undefined;
    return Boolean(
      blocker &&
        blocker.id !== group.id &&
        isGroupSpatiallyActive(blocker) &&
        (blocker.factionId === group.factionId ||
          !this.isHostile(group.factionId, blocker.factionId)) &&
        !blocker.movingTo,
    );
  }

  private getStationaryFriendlyBlockedCellIndices(
    group: GroupState,
  ): ReadonlySet<number> {
    const blocked = new Set<number>();
    for (const [index, groupId] of this.state.occupancy) {
      if (this.isStationaryFriendlyBlocker(group, groupId)) {
        blocked.add(index);
      }
    }
    return blocked;
  }

  private tryRepathAroundFriendlyGroups(group: GroupState): boolean {
    const desiredGoal = group.goal ?? group.pathGoal;
    if (!desiredGoal) {
      return false;
    }
    const blocked = this.getStationaryFriendlyBlockedCellIndices(group);
    const desiredIndex = cellIndex(this.setup.map, desiredGoal);
    const candidateGoals = blocked.has(desiredIndex)
      ? CARDINAL_NEIGHBOR_OFFSETS.map(([dx, dz]) => ({
          x: desiredGoal.x + dx,
          z: desiredGoal.z + dz,
        })).filter(
          (candidate) =>
            isWalkable(this.setup.map, candidate, group.movementType) &&
            !sameCoord(candidate, group.cell) &&
            !this.state.occupancy.has(cellIndex(this.setup.map, candidate)) &&
            !this.state.reservations.has(cellIndex(this.setup.map, candidate)),
        )
      : [desiredGoal];
    const options = candidateGoals
      .map((goal) => ({
        goal,
        path: this.pathfinderFor(group).findPath(group.cell, goal, blocked),
      }))
      .filter((option) => option.path.length > 1)
      .map((option) => ({
        ...option,
        cost: pathMovementCost(this.setup.map, option.path, group.movementType),
      }))
      .sort(
        (a, b) =>
          a.cost - b.cost ||
          cellIndex(this.setup.map, a.goal) - cellIndex(this.setup.map, b.goal),
      );
    const best = options[0];
    if (!best) {
      return false;
    }
    group.path = best.path.map((coord) => ({ ...coord }));
    group.pathGoal = { ...best.goal };
    group.waitAge = 0;
    return true;
  }

  private findClearFiringOption(
    group: GroupState,
    target: GroupState,
  ): { readonly goal: GridCoord; readonly path: readonly GridCoord[] } | undefined {
    const blocked = this.getStationaryFriendlyBlockedCellIndices(group);
    const pathStart = group.movingTo ?? group.cell;
    const options: {
      readonly goal: GridCoord;
      readonly path: readonly GridCoord[];
      readonly cost: number;
    }[] = [];
    const maximumRadius = 3;

    for (let radius = 1; radius <= maximumRadius; radius += 1) {
      for (let dz = -radius; dz <= radius; dz += 1) {
        for (let dx = -radius; dx <= radius; dx += 1) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== radius) {
            continue;
          }
          const candidate = { x: group.cell.x + dx, z: group.cell.z + dz };
          const candidateIndex = cellIndex(this.setup.map, candidate);
          const occupyingGroupId = this.state.occupancy.get(candidateIndex);
          const reservingGroupId = this.state.reservations.get(candidateIndex);
          if (
            !isWalkable(this.setup.map, candidate, group.movementType) ||
            (occupyingGroupId !== undefined && occupyingGroupId !== group.id) ||
            (reservingGroupId !== undefined && reservingGroupId !== group.id) ||
            squaredGridDistance(candidate, target.cell) >
              this.groupWeaponRangeCells(group) ** 2 ||
            !hasLineOfSight(this.setup.map, candidate, target.cell) ||
            this.hasFriendlyBlockerFrom(group, candidate, target)
          ) {
            continue;
          }
          const path = sameCoord(pathStart, candidate)
            ? [{ ...candidate }]
            : this.pathfinderFor(group).findPath(pathStart, candidate, blocked);
          if (path.length === 0) {
            continue;
          }
          options.push({
            goal: candidate,
            path,
            cost: path.length === 1
              ? 0
              : pathMovementCost(this.setup.map, path, group.movementType),
          });
        }
      }
    }

    return options.sort(
      (a, b) =>
        a.cost - b.cost ||
        cellIndex(this.setup.map, a.goal) - cellIndex(this.setup.map, b.goal),
    )[0];
  }

  private findSaferAdjacentCell(
    group: GroupState,
    threat: GridCoord,
    constraint?: { readonly center: GridCoord; readonly radiusCells: number },
  ): GridCoord | undefined {
    const candidates: GridCoord[] = [];
    for (let dz = -1; dz <= 1; dz += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        const candidate = { x: group.cell.x + dx, z: group.cell.z + dz };
        if (
          (dx !== 0 || dz !== 0) &&
          canTraverseStep(this.setup.map, group.cell, candidate, group.movementType) &&
          !this.state.occupancy.has(cellIndex(this.setup.map, candidate)) &&
          (!constraint ||
            squaredGridDistance(candidate, constraint.center) <= constraint.radiusCells ** 2)
        ) {
          candidates.push(candidate);
        }
      }
    }
    candidates.sort((a, b) => {
      const safety = squaredGridDistance(b, threat) - squaredGridDistance(a, threat);
      return safety || cellIndex(this.setup.map, a) - cellIndex(this.setup.map, b);
    });
    return candidates[0];
  }

  private advanceMovement(): void {
    for (const group of this.state.groups) {
      if (!group.movingTo) {
        continue;
      }
      if (
        group.platforms.some(
          (platform) => platform.mobility !== "mobile" || platform.disposition !== "crewed",
        )
      ) {
        continue;
      }
      if (group.turnTicksRemaining > 0) {
        group.turnTicksRemaining -= 1;
        if (group.turnTicksRemaining === 0) {
          this.applyMovementFacing(group, group.movingTo);
        }
        continue;
      }
      const baseMovePoints =
        group.action === "routing" ? ROUTING_MOVE_POINTS_PER_TICK : MOVE_POINTS_PER_TICK;
      const movementEfficiencyBps = group.platforms[0]
        ? this.platformCapabilities(group.platforms[0]).mobility.efficiencyBps
        : 10_000;
      group.moveProgress += Math.floor(
        (baseMovePoints * movementEfficiencyBps) / 10_000,
      );
      if (group.moveProgress < group.moveCost) {
        continue;
      }
      const oldIndex = cellIndex(this.setup.map, group.cell);
      const destinationIndex = cellIndex(this.setup.map, group.movingTo);
      this.releaseCover(group);
      this.state.occupancy.delete(oldIndex);
      this.state.reservations.delete(destinationIndex);
      if (group.platforms.length === 0) {
        group.headingRadians = Math.atan2(
          group.movingTo.x - group.cell.x,
          group.movingTo.z - group.cell.z,
        );
      }
      group.cell = group.movingTo;
      group.movingTo = undefined;
      group.moveProgress = 0;
      group.moveCost = 0;
      this.state.occupancy.set(destinationIndex, group.id);
      this.claimCover(group);
      if (group.path.length > 0 && sameCoord(group.path[0] ?? group.cell, group.cell)) {
        group.path.shift();
      }
    }

    const proposals: MovementProposal[] = [];
    for (const group of this.state.groups) {
      if (
        group.movingTo ||
        group.action === "engaging" ||
        group.action === "evacuated" ||
        group.action === "combat-ineffective" ||
        group.platforms.some(
          (platform) => platform.mobility !== "mobile" || platform.disposition !== "crewed",
        ) ||
        group.path.length === 0
      ) {
        continue;
      }
      while (group.path.length > 0 && sameCoord(group.path[0] ?? group.cell, group.cell)) {
        group.path.shift();
      }
      const destination = group.path[0];
      if (!destination) {
        continue;
      }
      if (!canTraverseStep(this.setup.map, group.cell, destination, group.movementType)) {
        group.path = [];
        group.pathGoal = undefined;
        continue;
      }
      proposals.push({ group, destination });
    }

    proposals.sort(
      (a, b) => b.group.waitAge - a.group.waitAge || compareStrings(a.group.id, b.group.id),
    );
    for (const proposal of proposals) {
      const destinationIndex = cellIndex(this.setup.map, proposal.destination);
      const occupyingGroupId = this.state.occupancy.get(destinationIndex);
      const reservingGroupId = this.state.reservations.get(destinationIndex);
      if (occupyingGroupId || reservingGroupId) {
        proposal.group.waitAge += 1;
        if (
          shouldRetryMovementPath(proposal.group.waitAge) &&
          this.isStationaryFriendlyBlocker(proposal.group, occupyingGroupId)
        ) {
          this.tryRepathAroundFriendlyGroups(proposal.group);
        }
        continue;
      }
      proposal.group.movingTo = { ...proposal.destination };
      proposal.group.moveProgress = 0;
      proposal.group.moveCost = movementStepCost(
        this.setup.map,
        proposal.group.cell,
        proposal.destination,
        proposal.group.movementType,
      );
      const platform = proposal.group.platforms[0];
      if (platform) {
        const desiredFacing = facingForStep(proposal.group.cell, proposal.destination);
        const turnSteps = shortestFacingSteps(platform.facing, desiredFacing);
        const template = getPlatformTemplate(
          this.setup.content,
          platform.platformTemplateId,
        );
        proposal.group.turnTicksRemaining = turnSteps * template.turnTicksPer45Degrees;
        if (proposal.group.turnTicksRemaining === 0) {
          this.applyMovementFacing(proposal.group, proposal.destination);
        }
      }
      proposal.group.waitAge = 0;
      this.state.reservations.set(destinationIndex, proposal.group.id);
    }
  }

  private updateWeapons(): Map<GroupId, SuppressionImpact> {
    const shotIntents: ShotIntent[] = [];
    const shotCounts = new Map<string, number>();
    for (const group of this.state.groups) {
      for (const member of group.members) {
        updateWeaponTimer(member, this.weaponForMember(member));
      }
      for (const platform of group.platforms) {
        const capabilities = this.platformCapabilities(platform);
        for (const weaponState of platform.weaponStates) {
          if (
            capabilities.weapons.find(
              (capability) => capability.componentId === weaponState.componentId,
            )?.available
          ) {
            updateWeaponTimer(
              weaponState,
              getWeaponTemplate(this.setup.content, weaponState.weaponTemplateId),
            );
          }
        }
      }
      const advancingAttacker =
        this.setup.mode.kind === "defense" &&
        this.setup.mode.attackerFactionId === group.factionId &&
        group.action === "moving-to-contact";
      if (
        (group.action !== "engaging" && !advancingAttacker) ||
        !group.currentTargetId
      ) {
        continue;
      }
      const target = this.state.groupsById.get(group.currentTargetId);
      if (
        !target ||
        target.platforms.length > 0 ||
        !this.isHostile(group.factionId, target.factionId) ||
        activeMemberCount(target) === 0 ||
        !this.hasFreshDirectContact(group, target)
      ) {
        continue;
      }
      const distanceSquared = squaredGridDistance(group.cell, target.cell);
      const cover = this.getDirectionalCover(target, group.cell);
      const shooterCover = this.getDirectionalCover(group, target.cell);
      if (
        distanceSquared > this.groupWeaponRangeCells(group) ** 2 ||
        !hasLineOfSight(this.setup.map, group.cell, target.cell, {
          ignoredStaticObjectCells: this.activeCoverObjectCells(shooterCover, cover),
        }) ||
        this.hasFriendlyBlocker(group, target)
      ) {
        continue;
      }

      let shotOrdinal = 0;
      for (const member of group.members) {
        if (!canMemberFight(member) || member.placement.kind !== "dismounted") {
          continue;
        }
        const weapon = this.weaponForMember(member);
        if (
          distanceSquared > this.weaponRangeCells(weapon) ** 2 ||
          distanceSquared < this.weaponMinimumRangeCells(weapon) ** 2
        ) {
          continue;
        }
        if (member.magazineRounds === 0) {
          if (member.reloadTicksRemaining === 0) {
            member.reloadTicksRemaining = weapon.reloadTicks;
          }
          continue;
        }
        if (member.reloadTicksRemaining > 0 || member.shotCooldownTicks > 0) {
          continue;
        }
        member.magazineRounds -= 1;
        member.shotCooldownTicks = weapon.shotIntervalTicks;
        const damageBps = firstEffectAmount(weapon, "damage", 0);
        const hitSuppressionBps = firstEffectAmount(weapon, "suppression", 0);
        shotIntents.push({
          shooterGroupId: group.id,
          shooterEntityId: member.id,
          targetGroupId: target.id,
          shotOrdinal,
          hitChanceBps: applyBasisPointReduction(
            calculateHitChance(group, member, target, this.weaponPreferredRangeCells(weapon)),
            cover?.effect.protectionBps ?? 0,
          ),
          damageBps,
          suppressionBps: weapon.suppressionBps,
          hitSuppressionBps,
        });
        shotOrdinal += 1;
      }
      for (const platform of group.platforms) {
        const capabilities = this.platformCapabilities(platform);
        for (const weaponState of [...platform.weaponStates].sort((a, b) =>
          compareStrings(a.componentId, b.componentId),
        )) {
          const capability = capabilities.weapons.find(
            (candidate) => candidate.componentId === weaponState.componentId,
          );
          const operator = this.platformWeaponOperator(platform, weaponState.componentId);
          if (!capability?.available || !operator) {
            continue;
          }
          const weapon = getWeaponTemplate(this.setup.content, weaponState.weaponTemplateId);
          if (
            distanceSquared > this.weaponRangeCells(weapon) ** 2 ||
            distanceSquared < this.weaponMinimumRangeCells(weapon) ** 2
          ) {
            continue;
          }
          if (weaponState.magazineRounds === 0) {
            if (weaponState.reloadTicksRemaining === 0) {
              weaponState.reloadTicksRemaining = weapon.reloadTicks;
            }
            continue;
          }
          if (weaponState.reloadTicksRemaining > 0 || weaponState.shotCooldownTicks > 0) {
            continue;
          }
          weaponState.magazineRounds -= 1;
          weaponState.shotCooldownTicks = weapon.shotIntervalTicks;
          const baseHitChance = calculateHitChance(
            group,
            operator.member,
            target,
            this.weaponPreferredRangeCells(weapon),
          );
          shotIntents.push({
            shooterGroupId: group.id,
            shooterEntityId: `${platform.id}:${weaponState.componentId}`,
            targetGroupId: target.id,
            shotOrdinal,
            hitChanceBps: applyBasisPointReduction(
              Math.floor((baseHitChance * operator.efficiencyBps) / 10_000),
              cover?.effect.protectionBps ?? 0,
            ),
            damageBps: firstEffectAmount(weapon, "damage", 0),
            suppressionBps: weapon.suppressionBps,
            hitSuppressionBps: firstEffectAmount(weapon, "suppression", 0),
          });
          shotOrdinal += 1;
        }
      }
      if (shotOrdinal > 0) {
        group.lastFiredTick = this.state.tick;
        const key = `${group.id}\u0000${target.id}`;
        shotCounts.set(key, (shotCounts.get(key) ?? 0) + shotOrdinal);
      }
    }

    const hits: HitIntent[] = [];
    for (const shot of shotIntents) {
      const roll = deterministicBps(
        this.setup.seed,
        "weapon-hit",
        this.state.tick,
        `${shot.shooterEntityId}:${shot.targetGroupId}`,
        shot.shotOrdinal,
      );
      if (roll >= shot.hitChanceBps) {
        continue;
      }
      const target = this.state.groupsById.get(shot.targetGroupId);
      if (!target) {
        continue;
      }
      const eligibleTargets = target.members
        .filter(
          (member) => canMemberFight(member) && member.placement.kind === "dismounted",
        )
        .sort(compareById);
      if (eligibleTargets.length === 0) {
        continue;
      }
      const targetIndex =
        deterministicUint32(
          this.setup.seed,
          "weapon-target",
          this.state.tick,
          `${shot.shooterEntityId}:${shot.targetGroupId}`,
          shot.shotOrdinal,
        ) % eligibleTargets.length;
      const targetMember = eligibleTargets[targetIndex];
      if (targetMember) {
        hits.push({
          shooterGroupId: shot.shooterGroupId,
          shooterEntityId: shot.shooterEntityId,
          targetGroupId: shot.targetGroupId,
          targetMemberId: targetMember.id,
          shotOrdinal: shot.shotOrdinal,
          damageBps: shot.damageBps,
          hitSuppressionBps: shot.hitSuppressionBps,
        });
      }
    }

    const impacts = new Map<GroupId, SuppressionImpact>();
    for (const shot of shotIntents) {
      const impact = impacts.get(shot.targetGroupId) ?? {
        suppressionBps: 0,
        hitSuppressionBps: 0,
      };
      impact.suppressionBps += shot.suppressionBps;
      impacts.set(shot.targetGroupId, impact);
    }
    hits.sort(
      (a, b) =>
        compareStrings(a.targetMemberId, b.targetMemberId) ||
        compareStrings(a.shooterGroupId, b.shooterGroupId) ||
        a.shotOrdinal - b.shotOrdinal,
    );
    for (const hit of hits) {
      const member = this.state.membersById.get(hit.targetMemberId);
      const targetGroup = this.state.groupsById.get(hit.targetGroupId);
      if (!member || !targetGroup || !canMemberFight(member)) {
        continue;
      }
      const impact = impacts.get(hit.targetGroupId) ?? {
        suppressionBps: 0,
        hitSuppressionBps: 0,
      };
      impact.hitSuppressionBps += hit.hitSuppressionBps;
      impacts.set(hit.targetGroupId, impact);
      this.applyHit(member, targetGroup, hit);
    }

    for (const [key, shotCount] of [...shotCounts].sort(([a], [b]) => compareStrings(a, b))) {
      const [groupId, targetGroupId] = key.split("\u0000") as [GroupId, GroupId];
      this.emit({ type: "weapon-fired", groupId, targetGroupId, shotCount });
    }
    if (shotIntents.length > 0) {
      this.markMeaningfulProgress();
    }
    return impacts;
  }

  private applyHit(member: MemberState, targetGroup: GroupState, hit: HitIntent): void {
    const previous = member.health;
    const severityRoll = deterministicBps(
      this.setup.seed,
      "wound-severity",
      this.state.tick,
      `${hit.shooterGroupId}:${member.id}`,
      hit.shotOrdinal,
    );
    const memberTemplate = getMemberTemplate(this.setup.content!, member.memberTemplateId);
    const damageScale = applyBasisPointReduction(
      Math.max(0, Math.min(20_000, hit.damageBps)),
      memberTemplate.protectionBps,
    );
    if (damageScale === 0) {
      return;
    }
    const deadThreshold = Math.floor((1_200 * damageScale) / 10_000);
    const incapacitatedThreshold = Math.floor((3_800 * damageScale) / 10_000);
    let next: HealthState = previous;
    if (previous === "healthy") {
      next = severityRoll < deadThreshold
        ? "dead"
        : severityRoll < incapacitatedThreshold
          ? "incapacitated"
          : "wounded";
    } else if (previous === "wounded") {
      const woundedDeadThreshold = Math.floor((2_600 * damageScale) / 10_000);
      const woundedIncapacitatedThreshold = Math.floor((7_200 * damageScale) / 10_000);
      next = severityRoll < woundedDeadThreshold
        ? "dead"
        : severityRoll < woundedIncapacitatedThreshold
          ? "incapacitated"
          : "wounded";
    }
    if (next === previous) {
      return;
    }
    member.health = next;
    if (activeMemberCount(targetGroup) === 0) {
      this.releaseCover(targetGroup);
    }
    targetGroup.moraleBps = Math.max(
      0,
      targetGroup.moraleBps - (next === "dead" ? 900 : next === "incapacitated" ? 650 : 220),
    );
    this.emit({
      type: "member-health-changed",
      memberId: member.id,
      groupId: member.groupId,
      from: previous,
      to: next,
    });
    this.markMeaningfulProgress();
  }

  private updateMorale(impacts: Map<GroupId, SuppressionImpact>): void {
    for (const group of this.state.groups) {
      const impact = impacts.get(group.id);
      if (impact) {
        const incomingSuppression = applyBasisPointReduction(
          impact.suppressionBps + impact.hitSuppressionBps,
          this.groupSuppressionResistanceBps(group),
        );
        group.suppressionBps = Math.min(
          10_000,
          group.suppressionBps + incomingSuppression,
        );
      }
      group.suppressionBps = Math.max(
        0,
        group.suppressionBps - (impact ? 5 : 28),
      );

      if (group.suppressionBps >= 6_500) {
        group.moraleBps = Math.max(0, group.moraleBps - 10);
      } else if (!impact && group.suppressionBps < 2_500) {
        group.moraleBps = Math.min(10_000, group.moraleBps + (group.moraleState === "routing" ? 11 : 4));
      }

      const previousState = group.moraleState;
      group.moraleState = nextMoraleState(previousState, group.moraleBps);
      if (group.moraleState !== previousState) {
        this.emit({
          type: "morale-changed",
          groupId: group.id,
          from: previousState,
          to: group.moraleState,
        });
        if (group.moraleState === "routing" || previousState === "routing") {
          this.cancelMovement(group);
          this.decideForGroup(group);
        }
      }
    }
  }

  private updateEvacuation(): void {
    for (const group of this.state.groups) {
      if (
        group.moraleState !== "routing" ||
        group.movingTo ||
        !sameCoord(group.cell, group.evacuation)
      ) {
        continue;
      }
      let evacuatedAny = false;
      for (const member of group.members) {
        if (canMemberFight(member)) {
          member.presence = "evacuated";
          evacuatedAny = true;
        }
      }
      if (!evacuatedAny) {
        continue;
      }
      group.action = "evacuated";
      group.decisionReason = "low-morale";
      group.path = [];
      group.goal = undefined;
      this.releaseCover(group);
      this.state.occupancy.delete(cellIndex(this.setup.map, group.cell));
      if (group.movingTo) {
        this.state.reservations.delete(cellIndex(this.setup.map, group.movingTo));
      }
      this.emit({ type: "group-evacuated", groupId: group.id });
      this.markMeaningfulProgress();
    }
  }

  private updateObjective(): void {
    const objectivesUnlockedAtStart = new Set(
      this.state.objectives
        .filter((objective) => objective.unlocked)
        .map((objective) => objective.id),
    );
    for (const objective of this.state.objectives) {
      if (
        !objectivesUnlockedAtStart.has(objective.id) ||
        objective.state === "attacker-controlled"
      ) {
        objective.attackerPower = 0;
        objective.defenderPower = 0;
        continue;
      }
      let attackerPower = 0;
      let defenderPower = 0;
      for (const group of this.state.groups) {
        if (!isGroupCombatEffective(group) || !isInsideObjective(group.cell, objective)) {
          continue;
        }
        if (group.factionId === objective.attackerFactionId) {
          attackerPower += this.groupCapturePower(group);
        } else if (group.factionId === objective.defenderFactionId) {
          defenderPower += this.groupCapturePower(group);
        }
      }
      objective.attackerPower = attackerPower;
      objective.defenderPower = defenderPower;
      const previousState = objective.state;
      const previousProgress = objective.progressBps;
      const resolved = resolveObjectiveTick({
        progressBps: objective.progressBps,
        attackerPower,
        defenderPower,
      });
      objective.progressBps = resolved.progressBps;
      objective.state = resolved.state;
      if (previousState !== objective.state) {
        this.emit({
          type: "objective-state-changed",
          objectiveId: objective.id,
          from: previousState,
          to: objective.state,
          progressBps: objective.progressBps,
        });
      }
      if (previousProgress !== objective.progressBps) {
        this.markMeaningfulProgress();
      }
      if (objective.state === "attacker-controlled") {
        const nextIndex = this.state.objectives.indexOf(objective) + 1;
        if (
          this.setup.mode.kind === "defense" &&
          this.setup.mode.objectiveRule === "sequence" &&
          this.state.objectives[nextIndex]
        ) {
          this.state.objectives[nextIndex]!.unlocked = true;
          this.markMeaningfulProgress();
        }
      }
    }
  }

  private updateTermination(): void {
    if (this.state.objectives.length > 0) {
      this.updateDefenseTermination();
      return;
    }
    this.updateConflictTermination();
  }

  private updateDefenseTermination(): void {
    const mode = this.setup.mode.kind === "defense" ? this.setup.mode : undefined;
    if (!mode) {
      return;
    }
    const capturedCount = this.state.objectives.filter(
      (objective) => objective.state === "attacker-controlled",
    ).length;
    const objectiveRule = mode.objectiveRule ?? "all";
    const requiredCount = objectiveRule === "count"
      ? mode.requiredCount ?? this.state.objectives.length
      : this.state.objectives.length;
    if (capturedCount >= requiredCount) {
      this.finishBattle("objective-captured", [mode.attackerFactionId]);
      return;
    }
    if (this.state.tick >= this.setup.rules.maximumDurationTicks) {
      this.finishBattle("defense-time-expired", [mode.defenderFactionId]);
      return;
    }

    const attackersEffective = this.state.groups.some(
      (group) =>
        group.factionId === mode.attackerFactionId && isGroupCombatEffective(group),
    );
    if (attackersEffective || this.hasPendingReinforcementForFaction(mode.attackerFactionId)) {
      this.state.resolutionCandidateKey = undefined;
      this.state.resolutionCandidateSince = undefined;
      return;
    }
    const candidateKey = `attackers-eliminated:${mode.attackerFactionId}`;
    if (this.state.resolutionCandidateKey !== candidateKey) {
      this.state.resolutionCandidateKey = candidateKey;
      this.state.resolutionCandidateSince = this.state.tick;
      return;
    }
    if (
      this.state.resolutionCandidateSince !== undefined &&
      this.state.tick - this.state.resolutionCandidateSince >=
        this.setup.rules.resolutionStableTicks
    ) {
      this.finishBattle("attackers-eliminated", [mode.defenderFactionId]);
    }
  }

  private updateConflictTermination(): void {
    if (this.state.tick >= this.setup.rules.maximumDurationTicks) {
      this.finishBattle("maximum-duration", []);
      return;
    }
    if (this.hasPendingReinforcements()) {
      this.state.resolutionCandidateKey = undefined;
      this.state.resolutionCandidateSince = undefined;
      return;
    }
    if (
      this.state.tick - this.state.lastMeaningfulProgressTick >=
      this.setup.rules.stalemateTicks
    ) {
      this.finishBattle("stalemate", []);
      return;
    }

    const effectiveFactions = this.setup.factions
      .filter((faction) =>
        this.state.groups.some(
          (group) => group.factionId === faction.id && isGroupCombatEffective(group),
        ),
      )
      .map((faction) => faction.id)
      .sort();
    const hasHostileEffectivePair = effectiveFactions.some((factionId, index) =>
      effectiveFactions
        .slice(index + 1)
        .some((otherFactionId) => this.isHostile(factionId, otherFactionId)),
    );
    if (hasHostileEffectivePair) {
      this.state.resolutionCandidateKey = undefined;
      this.state.resolutionCandidateSince = undefined;
      return;
    }

    const candidateKey = effectiveFactions.join(",") || "draw";
    if (candidateKey !== this.state.resolutionCandidateKey) {
      this.state.resolutionCandidateKey = candidateKey;
      this.state.resolutionCandidateSince = this.state.tick;
      return;
    }
    if (
      this.state.resolutionCandidateSince === undefined ||
      this.state.tick - this.state.resolutionCandidateSince <
        this.setup.rules.resolutionStableTicks
    ) {
      return;
    }

    const remainingFactionIds = [
      ...new Set(
        this.state.groups
          .filter((group) => activeMemberCount(group) > 0 || hasEvacuatedMembers(group))
          .map((group) => group.factionId),
      ),
    ];
    const hasRoutedOpposition = this.state.groups.some(
      (group) =>
        !effectiveFactions.includes(group.factionId) &&
        (activeMemberCount(group) > 0 || hasEvacuatedMembers(group)) &&
        remainingFactionIds.some(
          (factionId) =>
            factionId !== group.factionId && this.isHostile(factionId, group.factionId),
        ),
    );
    this.finishBattle(
      hasRoutedOpposition ? "hostiles-routed" : "hostiles-eliminated",
      effectiveFactions,
    );
  }

  private hasPendingReinforcements(): boolean {
    return this.state.reinforcementWaves.some(
      (wave) =>
        wave.status !== "deployed" &&
        wave.status !== "cancelled" &&
        wave.groups.some((group) => !wave.deployedGroupIds.includes(group.id)),
    );
  }

  private hasPendingReinforcementForFaction(factionId: FactionId): boolean {
    return this.state.reinforcementWaves.some(
      (wave) =>
        wave.factionId === factionId &&
        wave.status !== "deployed" &&
        wave.status !== "cancelled" &&
        wave.groups.some((group) => !wave.deployedGroupIds.includes(group.id)),
    );
  }

  private finishBattle(
    terminationReason: BattleTerminationReason,
    winnerFactionIds: readonly FactionId[],
  ): void {
    if (this.state.result) {
      return;
    }
    const resultTick = this.state.tick;
    const stateHash = this.getStateHash();
    this.state.result = {
      battleId: this.setup.battleId,
      rulesVersion: this.setup.rulesVersion,
      finalTick: resultTick,
      outcome: winnerFactionIds.length > 0 ? "win" : "draw",
      terminationReason,
      winnerFactionIds: [...winnerFactionIds],
      groups: this.buildGroupResults(),
      members: this.buildMemberResults(),
      platforms: this.buildPlatformResults(),
      objectives: this.state.objectives.map((objective) => ({
        id: objective.id,
        state: objective.state,
        progressBps: objective.progressBps,
        attackerFactionId: objective.attackerFactionId,
        defenderFactionId: objective.defenderFactionId,
        unlocked: objective.unlocked,
      })),
      stateHash,
    };
    this.emit({
      type: "battle-ended",
      reason: terminationReason,
      winnerFactionIds: [...winnerFactionIds],
    });
  }

  private buildGroupResults(): BattleResult["groups"] {
    const deployed = this.state.groups.map((group) => ({
      id: group.id,
      factionId: group.factionId,
      evacuated: hasEvacuatedMembers(group),
      moraleState: group.moraleState,
      activeMembers: activeMemberCount(group),
      deployment: hasEvacuatedMembers(group) ? "evacuated" as const : "deployed" as const,
    }));
    const deployedIds = new Set(this.state.groups.map((group) => group.id));
    const undeployed = this.state.reinforcementWaves.flatMap((wave) =>
      wave.groups
        .filter((group) => !deployedIds.has(group.id))
        .map((group) => ({
          id: group.id,
          factionId: group.factionId,
          evacuated: false,
          moraleState: "steady" as const,
          activeMembers: countSpawnActiveMembers(group),
          deployment: "undeployed" as const,
        })),
    );
    return [...deployed, ...undeployed].sort((a, b) => compareStrings(a.id, b.id));
  }

  private buildMemberResults(): BattleResult["members"] {
    const deployedIds = new Set(this.state.groups.map((group) => group.id));
    const deployed = this.state.groups.flatMap((group) =>
      group.members.map((member) => ({
        id: member.id,
        groupId: group.id,
        factionId: group.factionId,
        health: member.health,
        presence: member.presence,
        finalPlacement: { ...member.placement },
        disposition:
          member.presence === "evacuated"
            ? "evacuated" as const
            : group.moraleState === "routing" && canMemberFight(member)
              ? "missing" as const
              : "present" as const,
        deployment: member.presence === "evacuated" ? "evacuated" as const : "deployed" as const,
      })),
    );
    const undeployed = this.state.reinforcementWaves.flatMap((wave) =>
      wave.groups
        .filter((group) => !deployedIds.has(group.id))
        .flatMap((group) =>
          group.members.map((member) => ({
            id: member.id,
            groupId: group.id,
            factionId: group.factionId,
            health: member.initialHealth ?? "healthy" as const,
            presence: "undeployed" as const,
            finalPlacement: placementForSpawnMember(group, member.id),
            disposition: "undeployed" as const,
            deployment: "undeployed" as const,
          })),
        ),
    );
    return [...deployed, ...undeployed].sort((a, b) => compareStrings(a.id, b.id));
  }

  private buildPlatformResults(): BattleResult["platforms"] {
    return this.state.groups
      .flatMap((group) =>
        group.platforms.map((platform) => ({
          id: platform.id,
          groupId: platform.groupId,
          factionId: platform.factionId,
          persistentId: platform.persistentPlatformId,
          mobility: platform.mobility,
          combat: platform.combat,
          disposition: platform.disposition,
          damaged: platform.components.some((component) => component.integrityBps < 10_000),
          components: platform.components.map((component) => ({ ...component })),
          finalCrewAssignments: platform.crewAssignments.map((assignment) => ({
            ...assignment,
          })),
          finalCrewReassignments: platform.crewReassignments.map((action) => ({
            ...action,
          })),
          weaponStates: this.platformWeaponInspections(platform),
        })),
      )
      .sort((a, b) => compareStrings(a.id, b.id));
  }

  private hasFreshDirectContact(observer: GroupState, target: GroupState): boolean {
    const contact = observer.localContacts.get(target.id);
    return Boolean(
      contact &&
        this.state.tick - contact.lastDirectTick <= DIRECT_CONTACT_FRESH_TICKS,
    );
  }

  private createCoverThreat(
    group: GroupState,
    contact: ContactState,
  ): CoverThreatState {
    return {
      targetGroupId: contact.targetGroupId,
      lastKnown: { ...contact.lastKnown },
      observedAt: contact.observedAt,
      source:
        this.state.tick - contact.lastDirectTick <= DIRECT_CONTACT_FRESH_TICKS
          ? "direct-contact"
          : contact.sourceGroupId === group.id
            ? "local-contact"
            : "shared-contact",
    };
  }

  private findBestCoverOption(
    group: GroupState,
    threat: CoverThreatState,
    constraint: { readonly center: GridCoord; readonly radiusCells: number } | undefined,
    maximumRadius: number,
    requireWeaponRange: boolean,
  ): CoverOption | undefined {
    const pathStart = group.movingTo ?? group.cell;
    const blocked = this.getStationaryFriendlyBlockedCellIndices(group);
    const options: CoverOption[] = [];

    for (const slot of this.coverSlots) {
      if (
        squaredGridDistance(group.cell, slot.cell) > maximumRadius ** 2 ||
        (constraint &&
          squaredGridDistance(slot.cell, constraint.center) > constraint.radiusCells ** 2)
      ) {
        continue;
      }
      const slotIndex = cellIndex(this.setup.map, slot.cell);
      const occupyingGroupId = this.state.occupancy.get(slotIndex);
      const reservingGroupId = this.state.reservations.get(slotIndex);
      const coverOccupantId = this.state.coverOccupancy.get(slot.id);
      if (
        sameCoord(slot.cell, threat.lastKnown) ||
        this.isFriendlyGroupOccupant(group, occupyingGroupId) ||
        this.isFriendlyGroupOccupant(group, reservingGroupId) ||
        this.isFriendlyGroupOccupant(group, coverOccupantId)
      ) {
        continue;
      }

      const effect = resolveDirectionalCoverEffect(
        slot,
        activeMemberCount(group),
        threat.lastKnown,
      );
      if (effect.protectionBps === 0 && effect.concealmentBps === 0) {
        continue;
      }
      if (
        requireWeaponRange &&
        (squaredGridDistance(slot.cell, threat.lastKnown) >
          this.groupWeaponRangeCells(group) ** 2 ||
          !hasLineOfSight(this.setup.map, slot.cell, threat.lastKnown, {
            ignoredStaticObjectCells: [slot.objectCell],
          }))
      ) {
        continue;
      }

      const path = sameCoord(pathStart, slot.cell)
        ? [{ ...slot.cell }]
        : this.pathfinderFor(group).findPath(pathStart, slot.cell, blocked);
      if (path.length === 0) {
        continue;
      }
      const pathCost = path.length === 1
        ? 0
        : pathMovementCost(this.setup.map, path, group.movementType);
      options.push({
        slot,
        path,
        pathCost,
        effect,
        score: coverTacticalScore(
          effect,
          pathCost,
          this.getCurrentCoverSlot(group)?.id === slot.id,
          group.coverDecision?.selectedSlotId === slot.id,
        ),
      });
    }

    return options.sort(
      (a, b) =>
        b.score - a.score ||
        a.pathCost - b.pathCost ||
        compareStrings(a.slot.id, b.slot.id),
    )[0];
  }

  private coverOptionAtCurrentCell(
    group: GroupState,
    threat: CoverThreatState,
  ): CoverOption | undefined {
    const slot = this.getCurrentCoverSlot(group);
    if (!slot) {
      return undefined;
    }
    const effect = resolveDirectionalCoverEffect(
      slot,
      activeMemberCount(group),
      threat.lastKnown,
    );
    return {
      slot,
      path: [{ ...group.cell }],
      pathCost: 0,
      effect,
      score: coverTacticalScore(
        effect,
        0,
        true,
        group.coverDecision?.selectedSlotId === slot.id,
      ),
    };
  }

  private isFriendlyGroupOccupant(
    group: GroupState,
    occupantGroupId: GroupId | undefined,
  ): boolean {
    const occupant = occupantGroupId
      ? this.state.groupsById.get(occupantGroupId)
      : undefined;
    return Boolean(
      occupant &&
        occupant.id !== group.id &&
        isGroupSpatiallyActive(occupant) &&
        (occupant.factionId === group.factionId ||
          !this.isHostile(group.factionId, occupant.factionId)),
    );
  }

  private isCurrentCoverOption(group: GroupState, option: CoverOption): boolean {
    return (
      sameCoord(group.cell, option.slot.cell) &&
      this.getCurrentCoverSlot(group)?.id === option.slot.id
    );
  }

  private moveToCover(
    group: GroupState,
    option: CoverOption,
    reason: Extract<
      CoverEvaluationReason,
      "seek-cover-high-suppression" | "seek-cover-defense"
    >,
    threat: CoverThreatState,
  ): void {
    this.recordCoverDecision(group, reason, option, threat);
    group.action = "moving-to-contact";
    group.decisionReason = reason;
    group.currentTargetId = threat.targetGroupId;
    group.goal = { ...option.slot.cell };
    group.pathGoal = { ...option.slot.cell };
    group.path = option.path.map((coord) => ({ ...coord }));
    group.waitAge = 0;
  }

  private recordCoverDecision(
    group: GroupState,
    reason: CoverEvaluationReason,
    option?: CoverOption,
    threat?: CoverThreatState,
  ): void {
    const decision: CoverDecisionState = {
      reason,
      selectedSlotId: option?.slot.id,
      score: option?.score ?? 0,
      evaluatedAt: this.state.tick,
      threat: threat
        ? {
            ...threat,
            lastKnown: { ...threat.lastKnown },
          }
        : undefined,
    };
    group.coverDecision = decision;
  }

  private getCurrentCoverSlot(group: GroupState): CoverSlot | undefined {
    const slot = this.coverSlotsByCell.get(cellIndex(this.setup.map, group.cell));
    return slot && this.state.coverOccupancy.get(slot.id) === group.id ? slot : undefined;
  }

  private getDirectionalCover(
    target: GroupState,
    threat: GridCoord,
  ): { readonly slot: CoverSlot; readonly effect: DirectionalCoverEffect } | undefined {
    const slot = this.getCurrentCoverSlot(target);
    if (!slot) {
      return undefined;
    }
    return {
      slot,
      effect: resolveDirectionalCoverEffect(slot, activeMemberCount(target), threat),
    };
  }

  private activeCoverObjectCells(
    ...coverContexts: readonly (
      | { readonly slot: CoverSlot; readonly effect: DirectionalCoverEffect }
      | undefined
    )[]
  ): readonly GridCoord[] {
    const cells = new Map<number, GridCoord>();
    for (const cover of coverContexts) {
      if (
        !cover ||
        (cover.effect.protectionBps === 0 && cover.effect.concealmentBps === 0)
      ) {
        continue;
      }
      cells.set(cellIndex(this.setup.map, cover.slot.objectCell), cover.slot.objectCell);
    }
    return [...cells.values()];
  }

  private claimCover(group: GroupState): void {
    if (activeMemberCount(group) === 0 || group.platforms.length > 0) {
      return;
    }
    const slot = this.coverSlotsByCell.get(cellIndex(this.setup.map, group.cell));
    if (slot) {
      claimCoverSlot(this.state.coverOccupancy, slot, group.id);
    }
  }

  private releaseCover(group: GroupState): void {
    const slot = this.coverSlotsByCell.get(cellIndex(this.setup.map, group.cell));
    if (slot) {
      releaseCoverSlot(this.state.coverOccupancy, slot.id, group.id);
    }
  }

  private cancelMovement(group: GroupState): void {
    if (group.movingTo) {
      this.state.reservations.delete(cellIndex(this.setup.map, group.movingTo));
    }
    group.movingTo = undefined;
    group.moveProgress = 0;
    group.moveCost = 0;
    group.turnTicksRemaining = 0;
    group.waitAge = 0;
    group.path = [];
    group.pathGoal = undefined;
  }

  private hasFriendlyBlocker(shooter: GroupState, target: GroupState): boolean {
    return this.hasFriendlyBlockerFrom(shooter, shooter.cell, target);
  }

  private hasFriendlyBlockerFrom(
    shooter: GroupState,
    origin: GridCoord,
    target: GroupState,
  ): boolean {
    const lineCells = traceIntermediateCells(origin, target.cell);
    if (lineCells.length === 0) {
      return false;
    }
    const lineIndices = new Set(lineCells.map((coord) => cellIndex(this.setup.map, coord)));
    return this.state.groups.some(
      (candidate) =>
        candidate.id !== shooter.id &&
        candidate.id !== target.id &&
        isGroupSpatiallyActive(candidate) &&
        this.isKnownSpatialBlocker(shooter, candidate) &&
        lineIndices.has(cellIndex(this.setup.map, candidate.cell)),
    );
  }

  private isKnownSpatialBlocker(observer: GroupState, candidate: GroupState): boolean {
    if (
      candidate.factionId === observer.factionId ||
      !this.isHostile(observer.factionId, candidate.factionId)
    ) {
      return true;
    }
    const localContact = observer.localContacts.get(candidate.id);
    const sharedContact = this.state.factionKnowledge
      .get(observer.factionId)
      ?.contacts.get(candidate.id);
    return (localContact?.confidenceBps ?? sharedContact?.confidenceBps ?? 0) > 0;
  }

  private inspectGroup(group: GroupState): GroupInspection {
    const contacts = new Map<GroupId, ContactState>();
    const shared = this.state.factionKnowledge.get(group.factionId)?.contacts;
    for (const contact of shared?.values() ?? []) {
      contacts.set(contact.targetGroupId, contact);
    }
    for (const contact of group.localContacts.values()) {
      const current = contacts.get(contact.targetGroupId);
      if (!current || contact.observedAt >= current.observedAt) {
        contacts.set(contact.targetGroupId, contact);
      }
    }
    const currentCover = this.getCurrentCoverSlot(group);
    return {
      kind: "group",
      id: group.id,
      factionId: group.factionId,
      cell: { ...group.cell },
      destination: group.movingTo ? { ...group.movingTo } : undefined,
      action: group.action,
      decisionReason: group.decisionReason,
      moraleBps: group.moraleBps,
      moraleState: group.moraleState,
      suppressionBps: group.suppressionBps,
      activeMembers: activeMemberCount(group),
      woundedMembers: group.members.filter((member) => member.health === "wounded").length,
      incapacitatedMembers: group.members.filter(
        (member) => member.health === "incapacitated",
      ).length,
      deadMembers: group.members.filter((member) => member.health === "dead").length,
      contacts: [...contacts.values()].sort((a, b) =>
        compareStrings(a.targetGroupId, b.targetGroupId),
      ).map(
        (contact) => ({
          targetGroupId: contact.targetGroupId,
          lastKnown: { ...contact.lastKnown },
          observedAt: contact.observedAt,
          confidenceBps: confidenceAtAge(
            this.state.tick - contact.observedAt,
            this.setup.rules.contactForgetTicks,
          ),
          direct:
            this.state.tick - contact.lastDirectTick <= DIRECT_CONTACT_FRESH_TICKS + 1,
        }),
      ),
      path: group.path.map((coord) => ({ ...coord })),
      defenseSlot: group.defenseSlot ? { ...group.defenseSlot } : undefined,
      defenseRole: group.defenseRole,
      assignedObjectiveId: group.assignedObjectiveId,
      currentCover: currentCover
        ? {
            slotId: currentCover.id,
            staticObjectId: currentCover.staticObjectId,
            staticObjectKind: currentCover.staticObjectKind,
            facing: currentCover.facing,
            capacity: currentCover.capacity,
            coveredMembers: Math.min(currentCover.capacity, activeMemberCount(group)),
          }
        : undefined,
      coverEvaluation: group.coverDecision
        ? {
            reason: group.coverDecision.reason,
            selectedSlotId: group.coverDecision.selectedSlotId,
            score: group.coverDecision.score,
            evaluatedAt: group.coverDecision.evaluatedAt,
            threat: group.coverDecision.threat
              ? {
                  ...group.coverDecision.threat,
                  lastKnown: { ...group.coverDecision.threat.lastKnown },
                }
              : undefined,
          }
        : undefined,
      platforms: group.platforms.map((platform) => this.platformSummary(platform)),
    };
  }

  private inspectKnownGroup(group: GroupState, contact: ContactState): GroupInspection {
    return {
      kind: "group",
      id: group.id,
      factionId: group.factionId,
      visibility: "known",
      observedAt: contact.observedAt,
      cell: { ...contact.lastKnown },
      action: "searching",
      decisionReason: "known-contact",
      moraleBps: 0,
      moraleState: "steady",
      suppressionBps: 0,
      activeMembers: 0,
      woundedMembers: 0,
      incapacitatedMembers: 0,
      deadMembers: 0,
      contacts: [],
      path: [],
      platforms: [],
    };
  }

  private platformSummary(platform: PlatformState): PlatformSummaryInspection {
    return {
      id: platform.id,
      platformTemplateId: platform.platformTemplateId,
      movementType: platform.movementType,
      facing: platform.facing,
      mobility: platform.mobility,
      combat: platform.combat,
      disposition: platform.disposition,
      crewCount: platform.crewAssignments.filter((assignment) => {
        const member = this.state.membersById.get(assignment.memberId);
        return member ? canMemberFight(member) : false;
      }).length,
    };
  }

  private platformStationInspections(platform: PlatformState) {
    const template = getPlatformTemplate(this.setup.content, platform.platformTemplateId);
    const stationRules = new Map(
      template.crewStationRules.map((station) => [station.id, station]),
    );
    return buildCrewStationCapabilities(
      template.crewStationRules,
      platform.crewAssignments,
      this.crewCapabilityMembers(platform),
      platform.crewReassignments,
    ).map((station) => ({
      id: station.stationId,
      kind: stationRules.get(station.stationId)!.kind,
      assignedMemberId: station.memberId,
      status: station.reassigning
        ? "reassigning" as const
        : !station.memberId
          ? "vacant" as const
          : station.efficiencyBps > 0
            ? "effective" as const
            : "unavailable" as const,
      efficiencyBps: station.efficiencyBps,
    }));
  }

  private platformWeaponInspections(
    platform: PlatformState,
  ): readonly PlatformWeaponInspection[] {
    const capabilities = this.platformCapabilities(platform);
    return [...platform.weaponStates]
      .sort((a, b) => compareStrings(a.componentId, b.componentId))
      .map((weapon) => {
        const capability = capabilities.weapons.find(
          (candidate) => candidate.componentId === weapon.componentId,
        ) ?? ({
          available: false,
          reason: "component-unavailable",
          efficiencyBps: 0,
        } satisfies PlatformCapabilityInspection);
        return {
          componentId: weapon.componentId,
          weaponTemplateId: weapon.weaponTemplateId,
          available: capability.available,
          reason: capability.reason,
          efficiencyBps: capability.efficiencyBps,
          magazineRounds: weapon.magazineRounds,
          reloadTicksRemaining: weapon.reloadTicksRemaining,
          shotCooldownTicks: weapon.shotCooldownTicks,
        };
      });
  }

  private inspectObjective(objective: ObjectiveRuntimeState): ObjectiveInspection {
    return {
      kind: "objective",
      id: objective.id,
      center: { ...objective.center },
      radiusCells: objective.radiusCells,
      state: objective.state,
      progressBps: objective.progressBps,
      attackerPower: objective.attackerPower,
      defenderPower: objective.defenderPower,
      attackerFactionId: objective.attackerFactionId,
      defenderFactionId: objective.defenderFactionId,
      unlocked: objective.unlocked,
    };
  }

  private weaponForMember(member: MemberState): ReturnType<typeof getWeaponTemplate> {
    return getWeaponTemplate(this.setup.content!, member.weaponTemplateId);
  }

  private weaponRangeCells(weapon: ReturnType<typeof getWeaponTemplate>): number {
    return Math.max(0, Math.floor(weapon.maximumRangeMm / this.setup.map.cellSizeMm));
  }

  private weaponMinimumRangeCells(weapon: ReturnType<typeof getWeaponTemplate>): number {
    return Math.max(0, Math.ceil(weapon.minimumRangeMm / this.setup.map.cellSizeMm));
  }

  private weaponPreferredRangeCells(weapon: ReturnType<typeof getWeaponTemplate>): number {
    return Math.min(
      this.setup.rules.preferredRangeCells,
      Math.max(0, Math.floor(weapon.optimalRangeMm / this.setup.map.cellSizeMm)),
    );
  }

  private groupWeaponRangeCells(group: GroupState): number {
    if (group.platforms.length > 0) {
      const maximum = group.platforms.reduce((range, platform) => {
        const capabilities = this.platformCapabilities(platform);
        return platform.weaponStates.reduce((platformRange, weaponState) => {
          const available = capabilities.weapons.find(
            (capability) => capability.componentId === weaponState.componentId,
          )?.available;
          return available
            ? Math.max(
                platformRange,
                this.weaponRangeCells(
                  getWeaponTemplate(this.setup.content, weaponState.weaponTemplateId),
                ),
              )
            : platformRange;
        }, range);
      }, 0);
      return Math.min(this.setup.rules.weaponRangeCells, maximum);
    }
    const maximum = group.members
      .filter(
        (member) => canMemberFight(member) && member.placement.kind === "dismounted",
      )
      .reduce(
        (range, member) => Math.max(range, this.weaponRangeCells(this.weaponForMember(member))),
        0,
      );
    return Math.min(this.setup.rules.weaponRangeCells, maximum);
  }

  private groupSightRangeCells(group: GroupState): number {
    if (group.platforms.length > 0) {
      const maximum = group.platforms.reduce((range, platform) => {
        const template = getPlatformTemplate(this.setup.content, platform.platformTemplateId);
        const capabilities = this.platformCapabilities(platform);
        const stations = buildCrewStationCapabilities(
          template.crewStationRules,
          platform.crewAssignments,
          this.crewCapabilityMembers(platform),
          platform.crewReassignments,
        );
        const stationById = new Map(stations.map((station) => [station.stationId, station]));
        return template.componentRules
          .filter(
            (component) =>
              component.kind === "sensor" &&
              capabilities.components.find(
                (capability) => capability.componentId === component.id,
              )?.available,
          )
          .flatMap((component) => {
            const stationIds = component.requiredStationIds.length > 0
              ? component.requiredStationIds
              : stations
                  .filter((station) => station.efficiencyBps > 0)
                  .map((station) => station.stationId);
            const efficiencyBps = capabilities.components.find(
              (capability) => capability.componentId === component.id,
            )?.efficiencyBps ?? 0;
            return stationIds.map((stationId) => ({ stationId, efficiencyBps }));
          })
          .reduce((sensorRange, sensorStation) => {
            const { stationId, efficiencyBps } = sensorStation;
            const memberId = stationById.get(stationId)?.memberId;
            const member = memberId ? this.state.membersById.get(memberId) : undefined;
            if (!member) {
              return sensorRange;
            }
            const memberTemplate = getMemberTemplate(
              this.setup.content,
              member.memberTemplateId,
            );
            const sensor = this.setup.content.sensorTemplates[memberTemplate.sensorTemplateId];
            return Math.max(
              sensorRange,
              sensor
                ? Math.floor(
                    (sensor.rangeMm * efficiencyBps) /
                      10_000 /
                      this.setup.map.cellSizeMm,
                  )
                : 0,
            );
          }, range);
      }, 0);
      return Math.min(this.setup.rules.sightRangeCells, maximum);
    }
    const maximum = group.members
      .filter(
        (member) => canMemberFight(member) && member.placement.kind === "dismounted",
      )
      .reduce((range, member) => {
        const memberTemplate = getMemberTemplate(this.setup.content!, member.memberTemplateId);
        const sensor = this.setup.content!.sensorTemplates[memberTemplate.sensorTemplateId];
        return Math.max(
          range,
          sensor ? Math.floor(sensor.rangeMm / this.setup.map.cellSizeMm) : 0,
        );
      }, 0);
    return Math.min(this.setup.rules.sightRangeCells, maximum);
  }

  private groupExposureOnFireBps(group: GroupState): number {
    const memberExposure = group.members
      .filter(
        (member) => canMemberFight(member) && member.placement.kind === "dismounted",
      )
      .reduce(
        (exposure, member) => Math.max(exposure, this.weaponForMember(member).exposureOnFireBps),
        0,
      );
    return group.platforms.reduce((exposure, platform) => {
      const capabilities = this.platformCapabilities(platform);
      return platform.weaponStates.reduce((platformExposure, weaponState) => {
        const available = capabilities.weapons.find(
          (capability) => capability.componentId === weaponState.componentId,
        )?.available;
        return available
          ? Math.max(
              platformExposure,
              getWeaponTemplate(this.setup.content, weaponState.weaponTemplateId)
                .exposureOnFireBps,
            )
          : platformExposure;
      }, exposure);
    }, memberExposure);
  }

  private platformWeaponOperator(
    platform: PlatformState,
    componentId: string,
  ): { readonly member: MemberState; readonly efficiencyBps: number } | undefined {
    const template = getPlatformTemplate(this.setup.content, platform.platformTemplateId);
    const component = template.componentRules.find((rule) => rule.id === componentId);
    if (!component) {
      return undefined;
    }
    const stations = buildCrewStationCapabilities(
      template.crewStationRules,
      platform.crewAssignments,
      this.crewCapabilityMembers(platform),
      platform.crewReassignments,
    );
    const stationById = new Map(stations.map((station) => [station.stationId, station]));
    const requiredStations = component.requiredStationIds
      .map((stationId) => stationById.get(stationId))
      .filter((station): station is NonNullable<typeof station> => Boolean(station));
    const candidateStations = requiredStations.length > 0
      ? requiredStations
      : stations.filter((station) => station.efficiencyBps > 0);
    if (candidateStations.some((station) => station.efficiencyBps === 0)) {
      return undefined;
    }
    const preferred = candidateStations.find(
      (station) =>
        template.crewStationRules.find((rule) => rule.id === station.stationId)?.kind ===
        "gunner",
    ) ?? candidateStations[0];
    const member = preferred?.memberId
      ? this.state.membersById.get(preferred.memberId)
      : undefined;
    if (!member) {
      return undefined;
    }
    return {
      member,
      efficiencyBps: Math.min(
        ...candidateStations.map((station) => station.efficiencyBps),
      ),
    };
  }

  private groupSuppressionResistanceBps(group: GroupState): number {
    const activeMembers = group.members.filter(canMemberFight);
    if (activeMembers.length === 0) {
      return 0;
    }
    const total = activeMembers.reduce(
      (sum, member) =>
        sum + getMemberTemplate(this.setup.content!, member.memberTemplateId).suppressionResistanceBps,
      0,
    );
    return Math.floor(total / activeMembers.length);
  }

  private groupCapturePower(group: GroupState): number {
    const memberPowerBps = group.members
      .filter(
        (member) => canMemberFight(member) && member.placement.kind === "dismounted",
      )
      .reduce(
        (sum, member) =>
          sum + getMemberTemplate(this.setup.content!, member.memberTemplateId).capturePowerBps,
        0,
      );
    const groupScaleBps = getGroupTemplate(
      this.setup.content!,
      group.groupTemplateId,
    ).capturePowerScaleBps;
    const platformPowerBps = group.platforms.reduce(
      (sum, platform) =>
        sum +
        (platform.disposition === "crewed" && platform.mobility === "mobile"
          ? getPlatformTemplate(
              this.setup.content,
              platform.platformTemplateId,
            ).capturePowerBps
          : 0),
      0,
    );
    return Math.floor(((memberPowerBps + platformPowerBps) * groupScaleBps) / 100_000_000);
  }

  private markMeaningfulProgress(): void {
    this.state.lastMeaningfulProgressTick = this.state.tick;
  }

  private isHostile(a: FactionId, b: FactionId): boolean {
    return areHostile(this.setup.relations, a, b);
  }

  private pathfinderFor(group: GroupState): Pathfinder {
    return this.pathfinders.get(group.movementType)!;
  }

  private applyMovementFacing(group: GroupState, destination: GridCoord): void {
    const facing = facingForStep(group.cell, destination);
    group.headingRadians = facing * (Math.PI / 4);
    for (const platform of group.platforms) {
      platform.facing = facing;
    }
  }

  private emit(
    event: PendingBattleEvent,
  ): void {
    this.state.events.push({
      ...event,
      tick: this.state.tick,
      sequence: this.state.eventSequence,
    } as BattleEvent);
    this.state.eventSequence += 1;
  }
}

function confidenceAtAge(age: number, forgetTicks: number): number {
  if (age <= 0) {
    return 10_000;
  }
  return Math.max(0, Math.round(10_000 * (1 - age / forgetTicks)));
}

function placementForSpawnMember(
  group: BattleSetup["groups"][number],
  memberId: string,
): MemberPlacement {
  for (const platform of group.platforms) {
    const assignment = platform.crewAssignments.find(
      (candidate) => candidate.memberId === memberId,
    );
    if (assignment) {
      return {
        kind: "crew",
        platformId: platform.id,
        stationId: assignment.stationId,
      };
    }
  }
  return { kind: "dismounted" };
}

function pathMovementCost(
  map: BattleSetup["map"],
  path: readonly GridCoord[],
  movementType: MovementType,
): number {
  let cost = 0;
  for (let index = 1; index < path.length; index += 1) {
    cost += movementStepCost(map, path[index - 1]!, path[index]!, movementType);
  }
  return cost;
}

function shouldRetryMovementPath(waitAge: number): boolean {
  return (
    waitAge === MOVEMENT_REPATH_WAIT_TICKS ||
    (waitAge > MOVEMENT_REPATH_WAIT_TICKS &&
      (waitAge - MOVEMENT_REPATH_WAIT_TICKS) % MOVEMENT_REPATH_RETRY_TICKS === 0)
  );
}

function buildWalkableComponentIds(
  map: BattleSetup["map"],
  movementType: MovementType,
): Int32Array {
  const componentIds = new Int32Array(map.width * map.height).fill(-1);
  let nextComponentId = 0;

  for (let startIndex = 0; startIndex < componentIds.length; startIndex += 1) {
    if (componentIds[startIndex] !== -1) {
      continue;
    }
    const start = {
      x: startIndex % map.width,
      z: Math.floor(startIndex / map.width),
    };
    if (!isWalkable(map, start, movementType)) {
      continue;
    }

    const queue = [startIndex];
    componentIds[startIndex] = nextComponentId;
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
      const currentIndex = queue[cursor]!;
      const current = {
        x: currentIndex % map.width,
        z: Math.floor(currentIndex / map.width),
      };
      for (const [dx, dz] of WALKABLE_NEIGHBOR_OFFSETS) {
        const neighbor = { x: current.x + dx, z: current.z + dz };
        if (!isInsideMap(map, neighbor)) {
          continue;
        }
        const neighborIndex = cellIndex(map, neighbor);
        if (
          componentIds[neighborIndex] !== -1 ||
          !canTraverseStep(map, current, neighbor, movementType)
        ) {
          continue;
        }
        componentIds[neighborIndex] = nextComponentId;
        queue.push(neighborIndex);
      }
    }
    nextComponentId += 1;
  }

  return componentIds;
}

function sameCoord(a: GridCoord, b: GridCoord): boolean {
  return a.x === b.x && a.z === b.z;
}

function facingForStep(from: GridCoord, to: GridCoord): StaticObjectFacing {
  const octant = Math.round(
    Math.atan2(to.x - from.x, to.z - from.z) / (Math.PI / 4),
  );
  return ((octant + 8) % 8) as StaticObjectFacing;
}

function shortestFacingSteps(
  from: StaticObjectFacing,
  to: StaticObjectFacing,
): number {
  const difference = Math.abs(from - to);
  return Math.min(difference, 8 - difference);
}

function addContactToHash(hasher: StateHasher, contact: ContactState): void {
  hasher.addString(contact.targetGroupId);
  hasher.addNumber(contact.lastKnown.x);
  hasher.addNumber(contact.lastKnown.z);
  hasher.addNumber(contact.observedAt);
  hasher.addNumber(contact.lastDirectTick);
  hasher.addNumber(contact.confidenceBps);
  hasher.addString(contact.sourceGroupId);
}

function getGroupRenderPosition(
  group: GroupState,
  map: BattleSetup["map"],
): { x: number; z: number; height: number } {
  if (!group.movingTo || group.moveCost <= 0) {
    return { x: group.cell.x, z: group.cell.z, height: heightAt(map, group.cell) };
  }
  const progress = Math.min(1, group.moveProgress / group.moveCost);
  return {
    x: group.cell.x + (group.movingTo.x - group.cell.x) * progress,
    z: group.cell.z + (group.movingTo.z - group.cell.z) * progress,
    height:
      heightAt(map, group.cell) +
      (heightAt(map, group.movingTo) - heightAt(map, group.cell)) * progress,
  };
}

function traceIntermediateCells(from: GridCoord, to: GridCoord): GridCoord[] {
  const cells: GridCoord[] = [];
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const steps = Math.max(Math.abs(dx), Math.abs(dz));
  let previousKey = `${from.x},${from.z}`;
  for (let step = 1; step < steps; step += 1) {
    const coord = {
      x: from.x + Math.round((dx * step) / steps),
      z: from.z + Math.round((dz * step) / steps),
    };
    const key = `${coord.x},${coord.z}`;
    if (key !== previousKey) {
      cells.push(coord);
      previousKey = key;
    }
  }
  return cells;
}

function isInsideObjective(
  coord: GridCoord,
  objective: Pick<ObjectiveRuntimeState, "center" | "radiusCells">,
): boolean {
  return squaredGridDistance(coord, objective.center) <= objective.radiusCells ** 2;
}

function defenseSlotScore(
  map: BattleSetup["map"],
  candidate: GridCoord,
  objectiveCenter: GridCoord,
  preferredRadius: number,
  assignedSlots: readonly GridCoord[],
  coverSlot: CoverSlot | undefined,
  activeMembers: number,
): number {
  const index = cellIndex(map, candidate);
  const elevationScore = (map.layers.heightUnits[index] ?? 0) * 180;
  const movementScore = -movementCostAtIndex(map, index) * 65;
  const radiusDifference = Math.abs(
    squaredGridDistance(candidate, objectiveCenter) - preferredRadius ** 2,
  );
  const formationScore = -radiusDifference * 35;
  const dispersionScore =
    assignedSlots.length === 0
      ? 0
      : Math.min(
          ...assignedSlots.map((slot) => squaredGridDistance(candidate, slot)),
        ) * 55;
  const coverScore = coverSlot
    ? coverTacticalScore(
        undirectedCoverEffect(coverSlot, activeMembers),
        0,
        false,
        false,
      )
    : 0;
  return elevationScore + movementScore + formationScore + dispersionScore + coverScore;
}

function undirectedCoverEffect(
  slot: CoverSlot,
  activeMembers: number,
): DirectionalCoverEffect {
  const coveredMembers = Math.min(slot.capacity, Math.max(0, activeMembers));
  const capacityScaleBps =
    activeMembers > 0 ? Math.round((coveredMembers * 10_000) / activeMembers) : 0;
  return {
    aspect: "front",
    coveredMembers,
    protectionBps: Math.round((slot.protectionBps * capacityScaleBps) / 10_000),
    concealmentBps: Math.round((slot.concealmentBps * capacityScaleBps) / 10_000),
  };
}

function coverTacticalScore(
  effect: DirectionalCoverEffect,
  pathCost: number,
  currentSlot: boolean,
  previouslySelected: boolean,
): number {
  return (
    effect.protectionBps * 2 +
    effect.concealmentBps +
    effect.coveredMembers * 180 -
    Math.floor(pathCost / 3) +
    (currentSlot ? COVER_CURRENT_SLOT_BONUS : 0) +
    (previouslySelected ? COVER_SELECTED_SLOT_BONUS : 0)
  );
}
