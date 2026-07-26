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
import { areHostile, findRelation } from "./relations";
import { deterministicBps, deterministicUint32, StateHasher } from "./rng";
import { hashBattleSetup, migrateBattleSetup, validateBattleSetup } from "./setup";
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
  MoraleState,
  ObjectiveInspection,
  RenderFrame,
  RenderGroup,
  RenderMember,
  RenderObjective,
  SimulationStatus,
} from "./types";

const MAGAZINE_SIZE = 12;
const RELOAD_TICKS = 36;
const SHOT_COOLDOWN_TICKS = 7;
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
  shots: number;
  hits: number;
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
  private readonly pathfinder: Pathfinder;
  private readonly walkableComponentIds: Int32Array;
  private readonly setupHash: string;

  constructor(inputSetup: BattleSetupInput) {
    const normalizedSetup = migrateBattleSetup(inputSetup);
    validateBattleSetup(normalizedSetup);
    this.setup = cloneSetup(normalizedSetup);
    this.setupHash = hashBattleSetup(this.setup);
    this.coverSlots = buildCoverSlots(this.setup.map);
    this.coverSlotsByCell = new Map(
      this.coverSlots.map((slot) => [cellIndex(this.setup.map, slot.cell), slot]),
    );
    this.state = createRuntimeState(this.setup, this.coverSlotsByCell);
    this.pathfinder = createPathfinder(this.setup.map);
    this.walkableComponentIds = buildWalkableComponentIds(this.setup.map);
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
    return cloneSetup(this.setup);
  }

  step(count = 1): void {
    if (!Number.isInteger(count) || count < 0) {
      throw new Error("step count must be a non-negative integer.");
    }
    for (let index = 0; index < count && !this.state.result; index += 1) {
      this.stepOnce();
    }
  }

  getRenderFrame(): RenderFrame {
    const groups: RenderGroup[] = [];
    const members: RenderMember[] = [];
    const objectives: RenderObjective[] = [];
    const cellSizeMeters = this.setup.map.cellSizeMm / 1_000;
    const heightUnitMeters = this.setup.map.heightUnitMm / 1_000;

    for (const group of this.state.groups) {
      const renderPosition = getGroupRenderPosition(group, this.setup.map);
      if (group.action !== "evacuated") {
        groups.push({
          id: group.id,
          factionId: group.factionId,
          worldX: renderPosition.x * cellSizeMeters,
          worldY: renderPosition.height * heightUnitMeters,
          worldZ: renderPosition.z * cellSizeMeters,
          headingRadians: group.headingRadians,
          action: group.action,
          moraleBps: group.moraleBps,
          suppressionBps: group.suppressionBps,
          activeMembers: activeMemberCount(group),
        });
      }

      const memberStates = [...group.members].sort(compareById);
      memberStates.forEach((member, memberIndex) => {
        if (member.presence === "evacuated") {
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

    const objective = this.state.objective;
    if (objective) {
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
      });
    }

    return { tick: this.state.tick, groups, members, objectives };
  }

  inspect(entityId: string): EntityInspection | undefined {
    const group = this.state.groupsById.get(entityId);
    if (group) {
      return this.inspectGroup(group);
    }
    if (this.state.objective?.id === entityId) {
      return this.inspectObjective(this.state.objective);
    }
    const member = this.state.membersById.get(entityId);
    if (!member) {
      return undefined;
    }
    const inspection: MemberInspection = {
      kind: "member",
      id: member.id,
      groupId: member.groupId,
      factionId: member.factionId,
      health: member.health,
      presence: member.presence,
      magazineRounds: member.magazineRounds,
      reloadTicksRemaining: member.reloadTicksRemaining,
      shotCooldownTicks: member.shotCooldownTicks,
    };
    return inspection;
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
      hasher.addNumber(group.cell.x);
      hasher.addNumber(group.cell.z);
      hasher.addNumber(group.movingTo?.x ?? -1);
      hasher.addNumber(group.movingTo?.z ?? -1);
      hasher.addNumber(group.moveProgress);
      hasher.addNumber(group.moveCost);
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
        hasher.addString(member.health);
        hasher.addString(member.presence);
        hasher.addNumber(member.magazineRounds);
        hasher.addNumber(member.reloadTicksRemaining);
        hasher.addNumber(member.shotCooldownTicks);
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
    if (this.state.objective) {
      hasher.addString(this.state.objective.id);
      hasher.addString(this.state.objective.state);
      hasher.addNumber(this.state.objective.progressBps);
      hasher.addNumber(this.state.objective.attackerPower);
      hasher.addNumber(this.state.objective.defenderPower);
    }
    hasher.addNumber(this.state.lastMeaningfulProgressTick);
    hasher.addString(this.state.resolutionCandidateKey ?? "");
    hasher.addNumber(this.state.resolutionCandidateSince ?? -1);
    return hasher.digest();
  }

  private stepOnce(): void {
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
    const objective = this.state.objective;
    if (!objective) {
      return;
    }
    const defenders = this.state.groups.filter(
      (group) => group.factionId === objective.defenderFactionId,
    );
    const maximumRadius = objective.radiusCells + 4;
    const candidates: GridCoord[] = [];
    for (let z = objective.center.z - maximumRadius; z <= objective.center.z + maximumRadius; z += 1) {
      for (let x = objective.center.x - maximumRadius; x <= objective.center.x + maximumRadius; x += 1) {
        const candidate = { x, z };
        if (
          isWalkable(this.setup.map, candidate) &&
          squaredGridDistance(candidate, objective.center) <= maximumRadius ** 2
        ) {
          candidates.push(candidate);
        }
      }
    }
    candidates.sort(
      (a, b) => cellIndex(this.setup.map, a) - cellIndex(this.setup.map, b),
    );

    const assigned: GridCoord[] = [];
    defenders.forEach((group, groupIndex) => {
      const preferredRadius =
        groupIndex % 2 === 0
          ? Math.max(1, objective.radiusCells - 1)
          : objective.radiusCells + 2;
      const reachable = candidates.filter((candidate) => {
        if (assigned.some((slot) => sameCoord(slot, candidate))) {
          return false;
        }
        if (
          groupIndex === 0 &&
          squaredGridDistance(candidate, objective.center) > objective.radiusCells ** 2
        ) {
          return false;
        }
        return this.pathfinder.findPath(group.cell, candidate).length > 0;
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
    const sightRangeSquared = this.setup.rules.sightRangeCells ** 2;
    for (const observer of this.state.groups) {
      if (!isGroupSpatiallyActive(observer)) {
        continue;
      }
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
            this.state.tick - target.lastFiredTick <= this.setup.rules.ticksPerSecond ? 1_100 : 0;
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

    const objective = this.state.objective;
    const isDefender = objective?.defenderFactionId === group.factionId;
    const isAttacker = objective?.attackerFactionId === group.factionId;
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
      if (distanceSquared <= this.setup.rules.weaponRangeCells ** 2) {
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
    const goal = this.findNearestWalkable(desiredGoal, group.cell);
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
    const path = this.pathfinder.findPath(group.movingTo ?? group.cell, goal);
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

  private findNearestWalkable(origin: GridCoord, reachableFrom: GridCoord): GridCoord {
    const clamped = {
      x: Math.min(this.setup.map.width - 1, Math.max(0, Math.round(origin.x))),
      z: Math.min(this.setup.map.height - 1, Math.max(0, Math.round(origin.z))),
    };
    const reachableComponent =
      this.walkableComponentIds[cellIndex(this.setup.map, reachableFrom)] ?? -1;
    const isReachable = (candidate: GridCoord): boolean =>
      isWalkable(this.setup.map, candidate) &&
      this.walkableComponentIds[cellIndex(this.setup.map, candidate)] === reachableComponent;
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
            isWalkable(this.setup.map, candidate) &&
            !sameCoord(candidate, group.cell) &&
            !this.state.occupancy.has(cellIndex(this.setup.map, candidate)) &&
            !this.state.reservations.has(cellIndex(this.setup.map, candidate)),
        )
      : [desiredGoal];
    const options = candidateGoals
      .map((goal) => ({
        goal,
        path: this.pathfinder.findPath(group.cell, goal, blocked),
      }))
      .filter((option) => option.path.length > 1)
      .map((option) => ({
        ...option,
        cost: pathMovementCost(this.setup.map, option.path),
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
            !isWalkable(this.setup.map, candidate) ||
            (occupyingGroupId !== undefined && occupyingGroupId !== group.id) ||
            (reservingGroupId !== undefined && reservingGroupId !== group.id) ||
            squaredGridDistance(candidate, target.cell) >
              this.setup.rules.weaponRangeCells ** 2 ||
            !hasLineOfSight(this.setup.map, candidate, target.cell) ||
            this.hasFriendlyBlockerFrom(group, candidate, target)
          ) {
            continue;
          }
          const path = sameCoord(pathStart, candidate)
            ? [{ ...candidate }]
            : this.pathfinder.findPath(pathStart, candidate, blocked);
          if (path.length === 0) {
            continue;
          }
          options.push({
            goal: candidate,
            path,
            cost: path.length === 1 ? 0 : pathMovementCost(this.setup.map, path),
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
          canTraverseStep(this.setup.map, group.cell, candidate) &&
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
      group.moveProgress +=
        group.action === "routing" ? ROUTING_MOVE_POINTS_PER_TICK : MOVE_POINTS_PER_TICK;
      if (group.moveProgress < group.moveCost) {
        continue;
      }
      const oldIndex = cellIndex(this.setup.map, group.cell);
      const destinationIndex = cellIndex(this.setup.map, group.movingTo);
      this.releaseCover(group);
      this.state.occupancy.delete(oldIndex);
      this.state.reservations.delete(destinationIndex);
      group.headingRadians = Math.atan2(
        group.movingTo.x - group.cell.x,
        group.movingTo.z - group.cell.z,
      );
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
      if (!canTraverseStep(this.setup.map, group.cell, destination)) {
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
      );
      proposal.group.waitAge = 0;
      this.state.reservations.set(destinationIndex, proposal.group.id);
    }
  }

  private updateWeapons(): Map<GroupId, SuppressionImpact> {
    const shotIntents: ShotIntent[] = [];
    const shotCounts = new Map<string, number>();
    for (const group of this.state.groups) {
      for (const member of group.members) {
        updateWeaponTimer(member);
      }
      const advancingAttacker =
        this.state.objective?.attackerFactionId === group.factionId &&
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
        distanceSquared > this.setup.rules.weaponRangeCells ** 2 ||
        !hasLineOfSight(this.setup.map, group.cell, target.cell, {
          ignoredStaticObjectCells: this.activeCoverObjectCells(shooterCover, cover),
        }) ||
        this.hasFriendlyBlocker(group, target)
      ) {
        continue;
      }

      let shotOrdinal = 0;
      for (const member of group.members) {
        if (!canMemberFight(member)) {
          continue;
        }
        if (member.magazineRounds === 0) {
          if (member.reloadTicksRemaining === 0) {
            member.reloadTicksRemaining = RELOAD_TICKS;
          }
          continue;
        }
        if (member.reloadTicksRemaining > 0 || member.shotCooldownTicks > 0) {
          continue;
        }
        member.magazineRounds -= 1;
        member.shotCooldownTicks = SHOT_COOLDOWN_TICKS;
        shotIntents.push({
          shooterGroupId: group.id,
          shooterMemberId: member.id,
          targetGroupId: target.id,
          shotOrdinal,
          hitChanceBps: applyBasisPointReduction(
            calculateHitChance(group, member, target, this.setup.rules.preferredRangeCells),
            cover?.effect.protectionBps ?? 0,
          ),
        });
        shotOrdinal += 1;
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
        `${shot.shooterMemberId}:${shot.targetGroupId}`,
        shot.shotOrdinal,
      );
      if (roll >= shot.hitChanceBps) {
        continue;
      }
      const target = this.state.groupsById.get(shot.targetGroupId);
      if (!target) {
        continue;
      }
      const eligibleTargets = target.members.filter(canMemberFight).sort(compareById);
      if (eligibleTargets.length === 0) {
        continue;
      }
      const targetIndex =
        deterministicUint32(
          this.setup.seed,
          "weapon-target",
          this.state.tick,
          `${shot.shooterMemberId}:${shot.targetGroupId}`,
          shot.shotOrdinal,
        ) % eligibleTargets.length;
      const targetMember = eligibleTargets[targetIndex];
      if (targetMember) {
        hits.push({
          shooterGroupId: shot.shooterGroupId,
          targetGroupId: shot.targetGroupId,
          targetMemberId: targetMember.id,
          shotOrdinal: shot.shotOrdinal,
        });
      }
    }

    const impacts = new Map<GroupId, SuppressionImpact>();
    for (const shot of shotIntents) {
      const impact = impacts.get(shot.targetGroupId) ?? { shots: 0, hits: 0 };
      impact.shots += 1;
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
      const impact = impacts.get(hit.targetGroupId) ?? { shots: 0, hits: 0 };
      impact.hits += 1;
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
    let next: HealthState = previous;
    if (previous === "healthy") {
      next = severityRoll < 1_200 ? "dead" : severityRoll < 3_800 ? "incapacitated" : "wounded";
    } else if (previous === "wounded") {
      next = severityRoll < 2_600 ? "dead" : severityRoll < 7_200 ? "incapacitated" : "wounded";
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
        group.suppressionBps = Math.min(
          10_000,
          group.suppressionBps + impact.shots * 22 + impact.hits * 90,
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
    const objective = this.state.objective;
    if (!objective || objective.state === "attacker-controlled") {
      return;
    }
    let attackerPower = 0;
    let defenderPower = 0;
    for (const group of this.state.groups) {
      if (!isGroupCombatEffective(group) || !isInsideObjective(group.cell, objective)) {
        continue;
      }
      if (group.factionId === objective.attackerFactionId) {
        attackerPower += activeMemberCount(group);
      } else if (group.factionId === objective.defenderFactionId) {
        defenderPower += activeMemberCount(group);
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
  }

  private updateTermination(): void {
    if (this.state.objective) {
      this.updateDefenseTermination(this.state.objective);
      return;
    }
    this.updateConflictTermination();
  }

  private updateDefenseTermination(objective: ObjectiveRuntimeState): void {
    if (objective.state === "attacker-controlled") {
      this.finishBattle("objective-captured", [objective.attackerFactionId]);
      return;
    }
    if (this.state.tick >= this.setup.rules.maximumDurationTicks) {
      this.finishBattle("defense-time-expired", [objective.defenderFactionId]);
      return;
    }

    const attackersEffective = this.state.groups.some(
      (group) =>
        group.factionId === objective.attackerFactionId && isGroupCombatEffective(group),
    );
    if (attackersEffective) {
      this.state.resolutionCandidateKey = undefined;
      this.state.resolutionCandidateSince = undefined;
      return;
    }
    const candidateKey = `attackers-eliminated:${objective.attackerFactionId}`;
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
      this.finishBattle("attackers-eliminated", [objective.defenderFactionId]);
    }
  }

  private updateConflictTermination(): void {
    if (this.state.tick >= this.setup.rules.maximumDurationTicks) {
      this.finishBattle("maximum-duration", []);
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
      finalTick: resultTick,
      outcome: winnerFactionIds.length > 0 ? "win" : "draw",
      terminationReason,
      winnerFactionIds: [...winnerFactionIds],
      groups: this.state.groups.map((group) => ({
        id: group.id,
        factionId: group.factionId,
        evacuated: hasEvacuatedMembers(group),
        moraleState: group.moraleState,
        activeMembers: activeMemberCount(group),
      })),
      members: this.state.groups.flatMap((group) =>
        group.members.map((member) => ({
          id: member.id,
          groupId: group.id,
          factionId: group.factionId,
          health: member.health,
          presence: member.presence,
          disposition:
            member.presence === "evacuated"
              ? "evacuated"
              : group.moraleState === "routing" && canMemberFight(member)
                ? "missing"
                : "present",
        })),
      ),
      objectives: this.state.objective
        ? [
            {
              id: this.state.objective.id,
              state: this.state.objective.state,
              progressBps: this.state.objective.progressBps,
              attackerFactionId: this.state.objective.attackerFactionId,
              defenderFactionId: this.state.objective.defenderFactionId,
            },
          ]
        : [],
      stateHash,
    };
    this.emit({
      type: "battle-ended",
      reason: terminationReason,
      winnerFactionIds: [...winnerFactionIds],
    });
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
          this.setup.rules.weaponRangeCells ** 2 ||
          !hasLineOfSight(this.setup.map, slot.cell, threat.lastKnown, {
            ignoredStaticObjectCells: [slot.objectCell],
          }))
      ) {
        continue;
      }

      const path = sameCoord(pathStart, slot.cell)
        ? [{ ...slot.cell }]
        : this.pathfinder.findPath(pathStart, slot.cell, blocked);
      if (path.length === 0) {
        continue;
      }
      const pathCost = path.length === 1 ? 0 : pathMovementCost(this.setup.map, path);
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
    if (activeMemberCount(group) === 0) {
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
    };
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
    };
  }

  private markMeaningfulProgress(): void {
    this.state.lastMeaningfulProgressTick = this.state.tick;
  }

  private isHostile(a: FactionId, b: FactionId): boolean {
    return areHostile(this.setup.relations, a, b);
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

function createRuntimeState(
  setup: BattleSetup,
  coverSlotsByCell: ReadonlyMap<number, CoverSlot>,
): RuntimeState {
  const groups = [...setup.groups]
    .sort(compareById)
    .map<GroupState>((spawn) => ({
      id: spawn.id,
      factionId: spawn.factionId,
      evacuation: { ...spawn.evacuation },
      members: [...spawn.members]
        .sort(compareById)
        .map<MemberState>((member) => ({
          id: member.id,
          groupId: spawn.id,
          factionId: spawn.factionId,
          health: member.initialHealth ?? "healthy",
          presence: "deployed",
          magazineRounds: MAGAZINE_SIZE,
          reloadTicksRemaining: 0,
          shotCooldownTicks: 0,
        })),
      cell: { ...spawn.spawn },
      moveProgress: 0,
      moveCost: 0,
      waitAge: 0,
      headingRadians: 0,
      path: [],
      action: "searching",
      decisionReason: "search-sector",
      moraleBps: 10_000,
      moraleState: "steady",
      suppressionBps: 0,
      patrolIndex: 0,
      lastFiredTick: -1_000_000,
      lastDecisionTick: -1,
      localDetections: new Map(),
      localContacts: new Map(),
      searchedContacts: new Map(),
    }));
  const groupsById = new Map(groups.map((group) => [group.id, group]));
  const membersById = new Map(
    groups.flatMap((group) => group.members.map((member) => [member.id, member] as const)),
  );
  const coverOccupancy = new Map<string, GroupId>();
  for (const group of groups) {
    const slot = coverSlotsByCell.get(cellIndex(setup.map, group.cell));
    if (slot && activeMemberCount(group) > 0) {
      claimCoverSlot(coverOccupancy, slot, group.id);
    }
  }
  return {
    setup,
    groups,
    groupsById,
    membersById,
    factionKnowledge: new Map(
      setup.factions.map((faction) => [
        faction.id,
        { factionId: faction.id, contacts: new Map() },
      ]),
    ),
    intelQueue: [],
    events: [],
    occupancy: new Map(
      groups.map((group) => [cellIndex(setup.map, group.cell), group.id]),
    ),
    reservations: new Map(),
    coverOccupancy,
    objective:
      setup.mode.kind === "defense"
        ? {
            id: setup.mode.objective.id,
            center: { ...setup.mode.objective.center },
            radiusCells: setup.mode.objective.radiusCells,
            attackerFactionId: setup.mode.attackerFactionId,
            defenderFactionId: setup.mode.defenderFactionId,
            state: "defender-controlled",
            progressBps: 0,
            attackerPower: 0,
            defenderPower: 0,
          }
        : undefined,
    tick: 0,
    eventSequence: 0,
    intelSequence: 0,
    lastMeaningfulProgressTick: 0,
  };
}

function cloneSetup(setup: BattleSetup): BattleSetup {
  return {
    ...setup,
    map: {
      ...setup.map,
      layers: {
        heightUnits: setup.map.layers.heightUnits.slice(),
        surfaceTypeIds: setup.map.layers.surfaceTypeIds.slice(),
        waterDepthUnits: setup.map.layers.waterDepthUnits.slice(),
        cellFlags: setup.map.layers.cellFlags.slice(),
        staticOccupancy: setup.map.layers.staticOccupancy.slice(),
      },
      staticObjects: setup.map.staticObjects.map((object) => ({
        ...object,
        cell: { ...object.cell },
      })),
    },
    factions: setup.factions.map((faction) => ({ ...faction })),
    relations: setup.relations.map((relation) => ({ ...relation })),
    groups: setup.groups.map((group) => ({
      ...group,
      spawn: { ...group.spawn },
      evacuation: { ...group.evacuation },
      members: group.members.map((member) => ({ ...member })),
    })),
    mode:
      setup.mode.kind === "defense"
        ? {
            ...setup.mode,
            objective: {
              ...setup.mode.objective,
              center: { ...setup.mode.objective.center },
            },
          }
        : { kind: "conflict" },
    rules: { ...setup.rules },
  };
}

function updateWeaponTimer(member: MemberState): void {
  if (member.shotCooldownTicks > 0) {
    member.shotCooldownTicks -= 1;
  }
  if (member.reloadTicksRemaining > 0) {
    member.reloadTicksRemaining -= 1;
    if (member.reloadTicksRemaining === 0) {
      member.magazineRounds = MAGAZINE_SIZE;
    }
  }
}

function calculateHitChance(
  shooter: GroupState,
  member: MemberState,
  target: GroupState,
  preferredRange: number,
): number {
  const distance = Math.round(Math.sqrt(squaredGridDistance(shooter.cell, target.cell)) * 100);
  const preferred = preferredRange * 100;
  const distancePenalty = Math.max(0, distance - preferred) * 2;
  const suppressionPenalty = Math.floor(shooter.suppressionBps / 35);
  const woundPenalty = member.health === "wounded" ? 70 : 0;
  return Math.max(60, Math.min(360, 275 - distancePenalty - suppressionPenalty - woundPenalty));
}

function nextMoraleState(previous: MoraleState, moraleBps: number): MoraleState {
  if (previous === "routing" && moraleBps < 4_800) {
    return "routing";
  }
  if (moraleBps <= 2_600) {
    return "routing";
  }
  return moraleBps <= 6_000 ? "shaken" : "steady";
}

function activeMemberCount(group: GroupState): number {
  return group.members.filter(canMemberFight).length;
}

function canMemberFight(member: MemberState): boolean {
  return (
    member.presence === "deployed" &&
    (member.health === "healthy" || member.health === "wounded")
  );
}

function hasEvacuatedMembers(group: GroupState): boolean {
  return group.members.some((member) => member.presence === "evacuated");
}

function isGroupSpatiallyActive(group: GroupState): boolean {
  return group.action !== "evacuated" && activeMemberCount(group) > 0;
}

function isGroupCombatEffective(group: GroupState): boolean {
  return isGroupSpatiallyActive(group) && group.moraleState !== "routing";
}

function confidenceAtAge(age: number, forgetTicks: number): number {
  if (age <= 0) {
    return 10_000;
  }
  return Math.max(0, Math.round(10_000 * (1 - age / forgetTicks)));
}

function pathMovementCost(
  map: BattleSetup["map"],
  path: readonly GridCoord[],
): number {
  let cost = 0;
  for (let index = 1; index < path.length; index += 1) {
    cost += movementStepCost(map, path[index - 1]!, path[index]!);
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

function buildWalkableComponentIds(map: BattleSetup["map"]): Int32Array {
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
    if (!isWalkable(map, start)) {
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
          !canTraverseStep(map, current, neighbor)
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

function compareById<T extends { readonly id: string }>(a: T, b: T): number {
  return compareStrings(a.id, b.id);
}

function compareByFactionId(
  a: { readonly factionId: string },
  b: { readonly factionId: string },
): number {
  return compareStrings(a.factionId, b.factionId);
}

function compareIntelMessages(a: IntelMessage, b: IntelMessage): number {
  return a.deliveryAt - b.deliveryAt || a.sequence - b.sequence;
}

function sortedContacts(contacts: Map<GroupId, ContactState>): ContactState[] {
  return [...contacts.values()].sort((a, b) =>
    compareStrings(a.targetGroupId, b.targetGroupId),
  );
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
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
