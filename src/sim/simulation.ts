import {
  artilleryScatterCandidates,
  blastFalloffBps,
  calculateArtilleryUncertainty,
  firstProjectileCollision,
  projectileFlightTicks,
  projectilePositionAtElapsed,
} from "./artillery";
import {
  altitudeBandIndex,
  altitudeBandModifiers,
  altitudeBandsBetweenInclusive,
  altitudeTransitionTicks,
  flightHeightUnits,
  flightStepHasTerrainClearance,
  flightTransitionClearanceMm,
  hasAirspaceConflict,
  isAirMovementType,
  scoreFlightAltitudeCandidates,
  type AirspaceOccupant,
  type FlightAltitudeCandidateInput,
} from "./air";
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
  firstPlatformDamageEffect,
  hasEvacuatedMembers,
  isGroupCombatEffective,
  isGroupSpatiallyActive,
  nextMoraleState,
  updateWeaponTimer,
} from "./combat";
import type {
  ArtilleryFireMissionState,
  ContactState,
  CoverDecisionState,
  CoverThreatState,
  DetectionState,
  GroupState,
  HitIntent,
  IntelMessage,
  LogicalProjectileState,
  MemberState,
  ObjectiveRuntimeState,
  PlatformState,
  PlatformDamageIntent,
  ProjectileImpactIntent,
  ReinforcementRuntimeState,
  RuntimeState,
  ShotIntent,
  TransportAssignmentState,
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
  getPrimaryFireMode,
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
  armorFaceForAttack,
  buildCrewStationCapabilities,
  componentStateForIntegrity,
  derivePlatformCapabilities,
  penetrationChanceBps,
  scoreVehicleEngagementPosition,
  selectWeightedPlatformComponent,
  selectCrewReassignment,
} from "./vehicle";
import {
  activateTransportAssignment,
  areTransportCellsAdjacent,
  dismountPassengerGroup,
  embarkPassengerGroup,
  isTransportDestinationAvailable,
  runtimeTransportOccupancyUnits,
  selectTransportAdjacentCell,
  selectTransportDismountCell,
} from "./transport";
import {
  scoreTargetCandidates,
  weaponTargetEffectivenessBps,
  type TargetCandidateScoreInput,
} from "./targeting";
import type {
  BattleEvent,
  BattleResult,
  BattleSetup,
  BattleSetupInput,
  BattleSimulation,
  BattleTerminationReason,
  AirAltitudeBand,
  CoverEvaluationReason,
  CoverSlot,
  DirectionalCoverEffect,
  EffectDefinition,
  EntityInspection,
  FactionId,
  FireMissionEvaluationCandidateInspection,
  FireMissionIntelSource,
  FlightAltitudeEvaluationReason,
  GridCoord,
  GroupId,
  GroupInspection,
  HealthState,
  MemberInspection,
  MemberPlacement,
  MemberEffectDefinition,
  MovementType,
  ObjectiveInspection,
  PlatformInspection,
  PlatformDamageEffectDefinition,
  PlatformCapabilityInspection,
  PlatformWeaponInspection,
  PlatformSummaryInspection,
  PlatformFlightInspection,
  PlatformFlightControlInspection,
  RenderFrame,
  RenderGroup,
  RenderMember,
  RenderObjective,
  RenderPlatform,
  RenderProjectile,
  SimulationStatus,
  StaticObjectFacing,
  TargetProfile,
  TransportDismountReason,
  TransportKnownThreatInspection,
  VehicleEngagementReason,
  WeaponFireModeDefinition,
  WeaponTemplate,
  WeaponTargetDomain,
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
const TRANSPORT_REEMBARK_DELAY_TICKS = 40;
const VEHICLE_ENGAGEMENT_PATH_CANDIDATE_LIMIT = 12;
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

interface VehicleEngagementOption {
  readonly cell: GridCoord;
  readonly path: readonly GridCoord[];
  readonly pathCost: number;
  readonly desiredFacing: StaticObjectFacing;
  readonly score: number;
  readonly components: {
    readonly range: number;
    readonly route: number;
    readonly facing: number;
    readonly retention: number;
  };
}

type IndirectFireMode = Extract<
  WeaponFireModeDefinition,
  { targeting: "indirect" }
>;

interface ArtilleryMissionOption {
  readonly contact: ContactState;
  readonly weapon: WeaponTemplate;
  readonly weaponComponentId: string;
  readonly fireMode: IndirectFireMode;
  readonly missionId: string;
  readonly uncertaintyRadiusMm: number;
  readonly selectedOffset: { readonly dx: number; readonly dz: number };
  readonly plannedImpactCell: GridCoord;
  readonly score: number;
  readonly evaluation: FireMissionEvaluationCandidateInspection;
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
    const movementTypes: readonly MovementType[] = ["foot", "wheeled", "tracked", "hover"];
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
    const projectiles: RenderProjectile[] = [];
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
      const transportState = this.state.transportByPassengerGroupId.get(group.id);
      const transportPlatform = transportState
        ? this.state.platformsById.get(transportState.platformId)
        : undefined;
      const transportOwner = transportPlatform
        ? this.state.groupsById.get(transportPlatform.groupId)
        : undefined;
      const renderPosition = contact
        ? {
            x: contact.lastKnown.x,
            z: contact.lastKnown.z,
            height: contact.targetFlight
              ? flightHeightUnits(this.setup.map, contact.lastKnown, contact.targetFlight)
              : heightAt(this.setup.map, contact.lastKnown),
          }
        : transportOwner &&
            (transportState?.status === "embarked" ||
              transportState?.status === "disembarking" ||
              transportState?.status === "trapped")
          ? getGroupRenderPosition(transportOwner, this.setup.map)
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
        headingRadians:
          transportOwner &&
          (transportState?.status === "embarked" ||
            transportState?.status === "disembarking" ||
            transportState?.status === "trapped")
            ? transportOwner.headingRadians
            : group.headingRadians,
        action: contact ? "searching" : group.action,
        moraleBps: contact ? 0 : group.moraleBps,
        suppressionBps: contact ? 0 : group.suppressionBps,
        activeMembers: contact ? 0 : activeMemberCount(group),
      });

      for (const platform of group.platforms) {
        const platformPosition =
          contact || platform.disposition === "crewed"
            ? renderPosition
            : {
                x: platform.cell.x,
                z: platform.cell.z,
                height: heightAt(this.setup.map, platform.cell),
              };
        platforms.push({
          id: platform.id,
          groupId: group.id,
          factionId: group.factionId,
          ...(observerFactionId === undefined
            ? {}
            : { visibility: ownGroup ? ("own" as const) : ("known" as const) }),
          ...(contact ? { observedAt: contact.observedAt } : {}),
          worldX: platformPosition.x * cellSizeMeters,
          worldY: platformPosition.height * heightUnitMeters,
          worldZ: platformPosition.z * cellSizeMeters,
          headingRadians: contact ? 0 : platform.facing * (Math.PI / 4),
          mobility: platform.mobility,
          combat: platform.combat,
          disposition: platform.disposition,
          damaged: platform.components.some((component) => component.integrityBps < 10_000),
          visualTypeId: platform.visualTypeId,
          flight: contact
            ? contact.targetFlight
              ? { ...contact.targetFlight }
              : undefined
            : this.flightSnapshotForPlatform(platform),
          ...(!contact && platform.deployment
            ? { deployment: platform.deployment.state }
            : {}),
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

    for (const projectile of [...this.state.projectiles].sort(compareById)) {
      const position = projectilePositionAtElapsed(
        this.setup.map,
        projectile.origin,
        projectile.plannedImpactCell,
        projectile.muzzleHeightMm,
        projectile.apexHeightMm,
        projectile.totalFlightTicks,
        projectile.flightTicksElapsed,
      );
      const projectileCell = {
        x: Math.floor(position.xMm / this.setup.map.cellSizeMm),
        z: Math.floor(position.zMm / this.setup.map.cellSizeMm),
      };
      if (
        observerFactionId !== undefined &&
        projectile.sourceFactionId !== observerFactionId &&
        !this.isCellVisibleToFaction(observerFactionId, projectileCell)
      ) {
        continue;
      }
      projectiles.push({
        id: projectile.id,
        sourceFactionId: projectile.sourceFactionId,
        worldX: position.xMm / 1_000,
        worldY: position.heightMm / 1_000,
        worldZ: position.zMm / 1_000,
        visualTypeId: projectile.visualTypeId,
      });
    }

    return {
      tick: this.state.tick,
      phase: this.state.settlement ? "settling" : "running",
      groups,
      members,
      platforms,
      projectiles,
      objectives,
    };
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
        cell: { ...platform.cell },
        visualTypeId: platform.visualTypeId,
        armorRatingByFace: {
          ...getPlatformTemplate(this.setup.content, platform.platformTemplateId).armorRatingByFace,
        },
        crewAssignments: platform.crewAssignments.map((assignment) => ({ ...assignment })),
        crewReassignments: platform.crewReassignments.map((action) => ({ ...action })),
        stations: this.platformStationInspections(platform),
        components: platform.components.map((component) => ({ ...component })),
        mobilityCapability: { ...this.platformCapabilities(platform).mobility },
        observation: { ...this.platformCapabilities(platform).observation },
        weapons: this.platformWeaponInspections(platform),
        transportAssignments: (
          this.state.transportAssignmentsByPlatformId.get(platform.id) ?? []
        ).map((assignment) => this.transportInspection(assignment)),
        flightControl: this.flightControlInspection(platform),
        artillery: platform.deployment
          ? {
              deployment: platform.deployment.state,
              deploymentTicksRemaining: platform.deployment.ticksRemaining,
              mission: platform.fireMission
                ? {
                    id: platform.fireMission.id,
                    fireModeId: platform.fireMission.fireModeId,
                    targetGroupId: platform.fireMission.snapshot.targetGroupId,
                    source: platform.fireMission.snapshot.source,
                    observedAt: platform.fireMission.snapshot.observedAt,
                    deliveredAt: platform.fireMission.snapshot.deliveredAt,
                    confidenceBps: platform.fireMission.snapshot.confidenceBps,
                    uncertaintyRadiusMm: platform.fireMission.uncertaintyRadiusMm,
                    selectedOffset: { ...platform.fireMission.selectedOffset },
                    plannedImpactCell: { ...platform.fireMission.plannedImpactCell },
                    aimTicksRemaining: platform.fireMission.aimTicksRemaining,
                  }
                : undefined,
              evaluation: platform.fireMissionEvaluation
                ? {
                    ...platform.fireMissionEvaluation,
                    candidates: platform.fireMissionEvaluation.candidates.map(
                      (candidate) => ({ ...candidate }),
                    ),
                  }
                : undefined,
            }
          : undefined,
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

  private isCellVisibleToFaction(observerFactionId: FactionId, cell: GridCoord): boolean {
    return this.state.groups.some((observer) => {
      if (observer.factionId !== observerFactionId || !isGroupSpatiallyActive(observer)) {
        return false;
      }
      const sightRange = this.groupSightRangeCells(observer);
      return (
        squaredGridDistance(observer.cell, cell) <= sightRange * sightRange &&
        hasLineOfSight(this.setup.map, observer.cell, cell)
      );
    });
  }

  private isGroupDirectlyObservedByFaction(
    observerFactionId: FactionId,
    targetGroupId: GroupId,
  ): boolean {
    return this.state.groups.some(
      (observer) =>
        observer.factionId === observerFactionId &&
        observer.localContacts.get(targetGroupId)?.lastDirectTick === this.state.tick,
    );
  }

  private isOwnGroup(observerFactionId: FactionId, groupId: GroupId): boolean {
    return this.state.groupsById.get(groupId)?.factionId === observerFactionId;
  }

  getResult(): BattleResult | undefined {
    return this.state.result;
  }

  drainEvents(observerFactionId?: FactionId): readonly BattleEvent[] {
    const events = this.state.events.splice(0, this.state.events.length);
    if (observerFactionId === undefined) {
      return events;
    }
    return events.flatMap((event) => {
      const projected = this.projectEventForObserver(event, observerFactionId);
      return projected ? [projected] : [];
    });
  }

  private projectEventForObserver(
    event: BattleEvent,
    observerFactionId: FactionId,
  ): BattleEvent | undefined {
    switch (event.type) {
      case "contact-spotted":
        return this.isOwnGroup(observerFactionId, event.observerGroupId)
          ? event
          : undefined;
      case "intel-delivered":
        return event.factionId === observerFactionId ? event : undefined;
      case "artillery-mission-changed":
      case "platform-deployment-changed":
      case "member-health-changed":
      case "crew-station-changed":
      case "platform-component-changed":
      case "morale-changed":
      case "group-evacuated":
        return this.isOwnGroup(observerFactionId, event.groupId) ? event : undefined;
      case "platform-state-changed":
        return this.isOwnGroup(observerFactionId, event.groupId) ||
          this.isGroupDirectlyObservedByFaction(observerFactionId, event.groupId)
          ? event
          : undefined;
      case "weapon-fired": {
        const sourceOwn = this.isOwnGroup(observerFactionId, event.groupId);
        if (event.projectileIds?.length) {
          return sourceOwn ? event : undefined;
        }
        return sourceOwn ||
          (this.isGroupDirectlyObservedByFaction(observerFactionId, event.groupId) &&
            (this.isOwnGroup(observerFactionId, event.targetGroupId) ||
              this.isGroupDirectlyObservedByFaction(
                observerFactionId,
                event.targetGroupId,
              )))
          ? event
          : undefined;
      }
      case "projectile-impacted": {
        const sourceFactionId = this.state.groupsById.get(event.sourceGroupId)?.factionId;
        if (
          sourceFactionId !== observerFactionId &&
          !this.isCellVisibleToFaction(observerFactionId, event.impactCell)
        ) {
          return undefined;
        }
        return {
          ...event,
          affectedGroupIds: event.affectedGroupIds.filter((groupId) => {
            const group = this.state.groupsById.get(groupId);
            return group?.factionId === observerFactionId;
          }),
        };
      }
      case "embarkation-changed": {
        const platformGroupId = this.state.platformsById.get(event.platformId)?.groupId;
        return this.isOwnGroup(observerFactionId, event.passengerGroupId) ||
          (platformGroupId !== undefined && this.isOwnGroup(observerFactionId, platformGroupId))
          ? event
          : undefined;
      }
      case "reinforcement-triggered":
        return event.factionId === observerFactionId ? event : undefined;
      case "reinforcement-waiting":
      case "reinforcement-deployed":
      case "reinforcement-cancelled":
        return this.state.reinforcementWaves.find((wave) => wave.id === event.waveId)
          ?.factionId === observerFactionId
          ? event
          : undefined;
      case "objective-state-changed":
      case "battle-ended":
        return event;
    }
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
      hasher.addNumber(group.turnGoalFacing ?? -1);
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
      hasher.addNumber(group.targetEvaluation?.evaluatedAt ?? -1);
      hasher.addString(group.targetEvaluation?.selectedTargetId ?? "");
      for (const candidate of group.targetEvaluation?.candidates ?? []) {
        hasher.addString(candidate.targetGroupId);
        hasher.addString(candidate.targetProfile);
        hasher.addString(candidate.targetDomain ?? "ground");
        hasher.addNumber(candidate.lastKnown.x);
        hasher.addNumber(candidate.lastKnown.z);
        hasher.addNumber(candidate.observedAt);
        hasher.addNumber(candidate.confidenceBps);
        hasher.addString(candidate.source);
        hasher.addNumber(candidate.compatible ? 1 : 0);
        hasher.addNumber(candidate.score);
        hasher.addNumber(candidate.components.effect);
        hasher.addNumber(candidate.components.confidence);
        hasher.addNumber(candidate.components.recency);
        hasher.addNumber(candidate.components.distance);
        hasher.addNumber(candidate.components.task);
        hasher.addNumber(candidate.components.retention);
        hasher.addNumber(candidate.components.direct);
      }
      hasher.addString(group.vehicleEngagement?.targetGroupId ?? "");
      hasher.addString(group.vehicleEngagement?.reason ?? "");
      hasher.addNumber(group.vehicleEngagement?.evaluatedAt ?? -1);
      hasher.addNumber(group.vehicleEngagement?.selectedCell?.x ?? -1);
      hasher.addNumber(group.vehicleEngagement?.selectedCell?.z ?? -1);
      hasher.addNumber(group.vehicleEngagement?.desiredFacing ?? -1);
      hasher.addNumber(group.vehicleEngagement?.score ?? 0);
      hasher.addNumber(group.vehicleEngagement?.components.range ?? 0);
      hasher.addNumber(group.vehicleEngagement?.components.route ?? 0);
      hasher.addNumber(group.vehicleEngagement?.components.facing ?? 0);
      hasher.addNumber(group.vehicleEngagement?.components.retention ?? 0);
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
        hasher.addNumber(platform.cell.x);
        hasher.addNumber(platform.cell.z);
        hasher.addNumber(platform.facing);
        hasher.addString(platform.mobility);
        hasher.addString(platform.combat);
        hasher.addString(platform.disposition);
        hasher.addString(platform.flight?.altitudeBand ?? "");
        hasher.addNumber(platform.flight?.clearanceMm ?? 0);
        hasher.addString(platform.flight?.transition?.fromBand ?? "");
        hasher.addString(platform.flight?.transition?.toBand ?? "");
        hasher.addNumber(platform.flight?.transition?.startedAt ?? -1);
        hasher.addNumber(platform.flight?.transition?.totalTicks ?? 0);
        hasher.addNumber(platform.flight?.transition?.ticksRemaining ?? 0);
        hasher.addNumber(platform.flight?.transition?.startClearanceMm ?? 0);
        hasher.addNumber(platform.flight?.transition?.targetClearanceMm ?? 0);
        const altitudeEvaluation = platform.flight?.evaluation;
        hasher.addNumber(altitudeEvaluation?.evaluatedAt ?? -1);
        hasher.addString(altitudeEvaluation?.reason ?? "");
        hasher.addString(altitudeEvaluation?.selectedAltitudeBand ?? "");
        for (const candidate of altitudeEvaluation?.candidates ?? []) {
          hasher.addString(candidate.altitudeBand);
          hasher.addNumber(candidate.clearanceMm);
          hasher.addNumber(candidate.visibleInterestCount);
          hasher.addNumber(candidate.routeClear ? 1 : 0);
          hasher.addNumber(candidate.score);
          hasher.addNumber(candidate.components.observation);
          hasher.addNumber(candidate.components.sensor);
          hasher.addNumber(candidate.components.exposure);
          hasher.addNumber(candidate.components.terrain);
          hasher.addNumber(candidate.components.retention);
          hasher.addNumber(candidate.components.transition);
          hasher.addString(candidate.rejectionReason ?? "");
        }
        hasher.addString(platform.deployment?.state ?? "");
        hasher.addNumber(platform.deployment?.ticksRemaining ?? 0);
        hasher.addNumber(platform.deployment?.startedAt ?? -1);
        hasher.addString(platform.deployment?.returnState ?? "");
        hasher.addNumber(platform.deployment?.directRoundsFired ?? 0);
        hasher.addNumber(platform.deployment?.indirectRoundsFired ?? 0);
        hasher.addNumber(platform.deployment?.missionsAssigned ?? 0);
        const mission = platform.fireMission;
        hasher.addString(mission?.id ?? "");
        hasher.addString(mission?.platformId ?? "");
        hasher.addString(mission?.weaponComponentId ?? "");
        hasher.addString(mission?.fireModeId ?? "");
        hasher.addNumber(mission?.assignedAt ?? -1);
        hasher.addString(mission?.snapshot.targetGroupId ?? "");
        hasher.addString(mission?.snapshot.targetFactionId ?? "");
        hasher.addString(mission?.snapshot.targetProfile ?? "");
        hasher.addString(mission?.snapshot.targetDomain ?? "");
        hasher.addNumber(mission?.snapshot.lastKnown.x ?? -1);
        hasher.addNumber(mission?.snapshot.lastKnown.z ?? -1);
        hasher.addNumber(mission?.snapshot.observedAt ?? -1);
        hasher.addNumber(mission?.snapshot.deliveredAt ?? -1);
        hasher.addString(mission?.snapshot.source ?? "");
        hasher.addNumber(mission?.snapshot.confidenceBps ?? 0);
        hasher.addNumber(mission?.uncertaintyRadiusMm ?? 0);
        hasher.addNumber(mission?.selectedOffset.dx ?? 0);
        hasher.addNumber(mission?.selectedOffset.dz ?? 0);
        hasher.addNumber(mission?.plannedImpactCell.x ?? -1);
        hasher.addNumber(mission?.plannedImpactCell.z ?? -1);
        hasher.addString(mission?.status ?? "");
        hasher.addNumber(mission?.aimTicksRemaining ?? 0);
        const missionEvaluation = platform.fireMissionEvaluation;
        hasher.addNumber(missionEvaluation?.evaluatedAt ?? -1);
        hasher.addString(missionEvaluation?.reason ?? "");
        hasher.addString(missionEvaluation?.selectedTargetGroupId ?? "");
        for (const candidate of missionEvaluation?.candidates ?? []) {
          hasher.addString(candidate.targetGroupId);
          hasher.addString(candidate.source);
          hasher.addNumber(candidate.ageTicks);
          hasher.addNumber(candidate.uncertaintyRadiusMm);
          hasher.addNumber(candidate.weaponCompatible ? 1 : 0);
          hasher.addNumber(candidate.dangerClose ? 1 : 0);
          hasher.addNumber(candidate.score);
          hasher.addString(candidate.rejectionReason ?? "");
        }
        for (const passengerGroupId of [...platform.passengerGroupIds].sort(compareStrings)) {
          hasher.addString(passengerGroupId);
        }
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

    for (const assignment of this.state.transportAssignments) {
      hasher.addString(assignment.id);
      hasher.addString(assignment.platformId);
      hasher.addString(assignment.passengerGroupId);
      hasher.addString(assignment.status);
      hasher.addNumber(assignment.ticksRemaining);
      hasher.addNumber(assignment.destination?.x ?? -1);
      hasher.addNumber(assignment.destination?.z ?? -1);
      hasher.addNumber(assignment.lastTransitionTick);
      hasher.addNumber(assignment.passengerDamageResolved ? 1 : 0);
      const dismountEvaluation = assignment.dismountEvaluation;
      hasher.addString(dismountEvaluation?.reason ?? "");
      hasher.addNumber(dismountEvaluation?.evaluatedAt ?? -1);
      hasher.addNumber(dismountEvaluation?.selectedCell?.x ?? -1);
      hasher.addNumber(dismountEvaluation?.selectedCell?.z ?? -1);
      hasher.addNumber(dismountEvaluation?.score ?? 0);
      hasher.addNumber(dismountEvaluation?.components.threatSeparation ?? 0);
      hasher.addNumber(dismountEvaluation?.components.platformShielding ?? 0);
      hasher.addNumber(dismountEvaluation?.components.objectiveProximity ?? 0);
      for (const threat of dismountEvaluation?.knownThreats ?? []) {
        hasher.addString(threat.targetGroupId);
        hasher.addString(threat.targetFactionId);
        hasher.addString(threat.targetProfile);
        hasher.addNumber(threat.lastKnown.x);
        hasher.addNumber(threat.lastKnown.z);
        hasher.addNumber(threat.observedAt);
        hasher.addNumber(threat.confidenceBps);
      }
    }

    for (const [slotId, groupId] of [...this.state.coverOccupancy].sort(([a], [b]) =>
      compareStrings(a, b),
    )) {
      hasher.addString(slotId);
      hasher.addString(groupId);
    }

    for (const [groupId, cell] of [...this.state.airspaceReservations].sort(([a], [b]) =>
      compareStrings(a, b),
    )) {
      hasher.addString(groupId);
      hasher.addNumber(cell.x);
      hasher.addNumber(cell.z);
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
      hasher.addString(message.targetFactionId);
      hasher.addString(message.targetProfile);
      hasher.addString(message.targetDomain ?? "ground");
      hasher.addString(message.targetFlight?.altitudeBand ?? "");
      hasher.addNumber(message.targetFlight?.clearanceMm ?? 0);
      hasher.addNumber(message.observedAt);
      hasher.addNumber(message.deliveryAt);
      hasher.addNumber(message.lastKnown.x);
      hasher.addNumber(message.lastKnown.z);
      hasher.addNumber(message.confidenceBps);
      hasher.addString(message.intelSource);
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
    for (const projectile of [...this.state.projectiles].sort(compareById)) {
      hasher.addString(projectile.id);
      hasher.addString(projectile.sourceFactionId);
      hasher.addString(projectile.sourceGroupId);
      hasher.addString(projectile.sourcePlatformId ?? "");
      hasher.addString(projectile.weaponTemplateId);
      hasher.addString(projectile.fireModeId);
      hasher.addNumber(projectile.launchedAt);
      hasher.addNumber(projectile.scheduledGroundImpactAt);
      hasher.addNumber(projectile.origin.x);
      hasher.addNumber(projectile.origin.z);
      hasher.addNumber(projectile.intendedAimCell.x);
      hasher.addNumber(projectile.intendedAimCell.z);
      hasher.addNumber(projectile.plannedImpactCell.x);
      hasher.addNumber(projectile.plannedImpactCell.z);
      hasher.addNumber(projectile.totalFlightTicks);
      hasher.addNumber(projectile.flightTicksElapsed);
      hasher.addNumber(projectile.muzzleHeightMm);
      hasher.addNumber(projectile.apexHeightMm);
      hasher.addNumber(projectile.blastRadiusMm);
      hasher.addString(projectile.visualTypeId);
      for (const effect of projectile.damageEffects) {
        hashEffectDefinition(hasher, effect);
      }
      hasher.addNumber(projectile.suppressionBps);
    }
    hasher.addNumber(this.state.lastMeaningfulProgressTick);
    hasher.addString(this.state.resolutionCandidateKey ?? "");
    hasher.addNumber(this.state.resolutionCandidateSince ?? -1);
    hasher.addNumber(this.state.settlement?.triggeredAt ?? -1);
    hasher.addString(this.state.settlement?.terminationReason ?? "");
    hasher.addNumber(this.state.settlement?.projectileCountAtTrigger ?? 0);
    for (const factionId of this.state.settlement?.winnerFactionIds ?? []) {
      hasher.addString(factionId);
    }
    return hasher.digest();
  }

  private stepOnce(): void {
    if (this.state.settlement) {
      const impacts = this.updateWeapons(this.advanceLogicalProjectiles(), false);
      this.updateMorale(impacts, true);
      this.state.tick += 1;
      if (this.state.projectiles.length === 0) {
        const settlement = this.state.settlement;
        this.completeBattle(
          settlement.terminationReason,
          settlement.winnerFactionIds,
          settlement.triggeredAt,
          settlement.projectileCountAtTrigger,
        );
      }
      return;
    }
    this.updateReinforcements();
    this.updateCrewStations();
    this.updateTransportAssignments();
    this.deliverIntelMessages();
    this.updateSensing();
    this.updateDecisions();
    this.updateFlightAltitudeActions();
    this.updateArtilleryMissions();
    this.updatePlatformDeployments();
    this.advanceMovement();
    const impacts = this.updateWeapons(this.advanceLogicalProjectiles(), true);
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
          ).some((cell) => this.canDeployAirSpawn(group, cell, [])),
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
    const bundledGroupIds = new Set<GroupId>();
    let deploymentSlotsUsed = 0;
    for (const spawn of remainingGroups) {
      if (
        deploymentSlotsUsed >= selected.capacityPerTick ||
        bundledGroupIds.has(spawn.id)
      ) {
        if (deploymentSlotsUsed >= selected.capacityPerTick) {
          break;
        }
        continue;
      }
      const bundle = this.initialTransportReinforcementBundle(
        spawn,
        remainingGroups,
      );
      const anchorSpawn = bundle.find((candidate) => candidate.platforms.length > 0) ?? spawn;
      if (bundle.some((candidate) => bundledGroupIds.has(candidate.id))) {
        break;
      }
      const openCell = this.openEntranceCells(
        selected,
        movementTypeForGroup(this.setup, anchorSpawn),
      ).find(
        (cell) =>
          (isAirMovementType(movementTypeForGroup(this.setup, anchorSpawn)) ||
            !usedCells.has(cellIndex(this.setup.map, cell))) &&
          this.canDeployAirSpawn(anchorSpawn, cell, deployedGroups),
      );
      if (!openCell) {
        continue;
      }
      if (!isAirMovementType(movementTypeForGroup(this.setup, anchorSpawn))) {
        usedCells.add(cellIndex(this.setup.map, openCell));
      }
      deploymentSlotsUsed += 1;
      const groups = bundle.map((candidate) =>
        createGroupState(candidate, openCell, this.setup.content),
      );
      for (const group of groups) {
        bundledGroupIds.add(group.id);
        deployedGroups.push(group);
        wave.deployedGroupIds.push(group.id);
        this.state.groupsById.set(group.id, group);
        for (const member of group.members) {
          this.state.membersById.set(member.id, member);
        }
        for (const platform of group.platforms) {
          this.state.platformsById.set(platform.id, platform);
        }
      }
      for (const assignment of this.state.transportAssignments) {
        activateTransportAssignment(
          assignment,
          this.state.groupsById,
          this.state.platformsById,
          this.state.tick,
        );
      }
      for (const group of groups) {
        const transportState = this.state.transportByPassengerGroupId.get(group.id);
        if (transportState?.status === "embarked") {
          continue;
        }
        if (isAirMovementType(group.movementType)) {
          continue;
        }
        this.state.occupancy.set(cellIndex(this.setup.map, group.cell), group.id);
        const coverSlot = this.coverSlotsByCell.get(cellIndex(this.setup.map, group.cell));
        if (
          coverSlot &&
          activeMemberCount(group) > 0 &&
          !group.platforms.some((platform) => platform.disposition === "crewed")
        ) {
          claimCoverSlot(this.state.coverOccupancy, coverSlot, group.id);
        }
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

  private initialTransportReinforcementBundle(
    spawn: BattleSetup["groups"][number],
    remainingGroups: readonly BattleSetup["groups"][number][],
  ): readonly BattleSetup["groups"][number][] {
    const related = this.state.transportAssignments.find(
      (assignment) =>
        assignment.initiallyEmbarked &&
        (assignment.passengerGroupId === spawn.id ||
          spawn.platforms.some((platform) => platform.id === assignment.platformId)),
    );
    if (!related) {
      return [spawn];
    }
    const platformId = related.platformId;
    const passengerGroupIds = new Set(
      this.state.transportAssignments
        .filter(
          (assignment) =>
            assignment.initiallyEmbarked && assignment.platformId === platformId,
        )
        .map((assignment) => assignment.passengerGroupId),
    );
    const bundle = remainingGroups.filter(
      (candidate) =>
        passengerGroupIds.has(candidate.id) ||
        candidate.platforms.some((platform) => platform.id === platformId),
    );
    return bundle.length > 0 ? bundle.sort(compareById) : [spawn];
  }

  private openEntranceCells(
    entrance: BattleSetup["reinforcementEntrances"][number],
    movementType: MovementType = "foot",
  ): readonly GridCoord[] {
    return entrance.cells
      .filter((cell) => {
        const index = cellIndex(this.setup.map, cell);
        if (isAirMovementType(movementType)) {
          return isWalkable(this.setup.map, cell, movementType);
        }
        return (
          isWalkable(this.setup.map, cell, movementType) &&
          !this.state.occupancy.has(index) &&
          !this.state.staticPlatformOccupancy.has(index) &&
          !this.state.reservations.has(index)
        );
      })
      .sort((a, b) => cellIndex(this.setup.map, a) - cellIndex(this.setup.map, b));
  }

  private canDeployAirSpawn(
    spawn: BattleSetup["groups"][number],
    cell: GridCoord,
    pendingGroups: readonly GroupState[],
  ): boolean {
    if (!isAirMovementType(movementTypeForGroup(this.setup, spawn))) {
      return true;
    }
    const platform = spawn.platforms[0];
    const template = platform
      ? getPlatformTemplate(this.setup.content, platform.platformTemplateId)
      : undefined;
    const altitudeBand = platform?.initialAltitudeBand;
    const safetyRadiusMm = template?.flightRule?.safetyRadiusMm;
    if (!platform || !altitudeBand || safetyRadiusMm === undefined) {
      return false;
    }
    const candidate: AirspaceOccupant = {
      id: spawn.id,
      cell: { ...cell },
      altitudeBand,
      safetyRadiusMm,
    };
    const occupants = [...this.state.groups, ...pendingGroups].flatMap((group) =>
      this.airspaceOccupantsForGroup(group, group.cell),
    );
    return !hasAirspaceConflict(this.setup.map.cellSizeMm, candidate, occupants);
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
      if (platform.disposition !== "crewed") {
        this.abandonPlatform(platform);
        continue;
      }
      if (platform.crewReassignments.length > 0) {
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

  private updateArtilleryMissions(): void {
    const groupIndexById = new Map(
      this.state.groups.map((group, index) => [group.id, index] as const),
    );
    for (const platform of [...this.state.platformsById.values()].sort(compareById)) {
      const group = this.state.groupsById.get(platform.groupId);
      const configurations = this.indirectWeaponConfigurations(platform);
      if (!group || configurations.length === 0) {
        continue;
      }
      if (platform.fireMission?.status === "released") {
        platform.fireMission = undefined;
      }

      if (this.hasCurrentArtillerySelfDefenseContact(group)) {
        if (platform.fireMission) {
          this.cancelArtilleryMission(platform, "contact-replaced");
        }
        platform.fireMissionEvaluation = {
          evaluatedAt: this.state.tick,
          reason: "ARTILLERY_DIRECT_SELF_DEFENSE",
          candidates: [],
        };
        continue;
      }

      const mission = platform.fireMission;
      if (mission) {
        const configuration = configurations.find(
          (candidate) =>
            candidate.weaponState.componentId === mission.weaponComponentId &&
            candidate.fireMode.id === mission.fireModeId,
        );
        if (!configuration?.available) {
          this.cancelArtilleryMission(platform, "capability-lost");
        } else if (
          !this.isHostile(group.factionId, mission.snapshot.targetFactionId) ||
          this.state.tick - mission.snapshot.observedAt >
            configuration.fireMode.uncertainty.maximumContactAgeTicks
        ) {
          this.cancelArtilleryMission(platform, "contact-expired");
        } else if (
          this.isArtilleryDangerClose(
            group,
            mission.plannedImpactCell,
            configuration.fireMode.blastRadiusMm,
          )
        ) {
          this.cancelArtilleryMission(platform, "danger-close");
        } else {
          if (
            mission.status === "aiming" &&
            platform.deployment?.state === "deployed"
          ) {
            mission.aimTicksRemaining = Math.max(0, mission.aimTicksRemaining - 1);
            if (mission.aimTicksRemaining === 0) {
              mission.status = "ready";
            }
          }
          this.holdGroupForArtilleryMission(group, platform, mission);
        }
      }

      const groupIndex = groupIndexById.get(group.id) ?? 0;
      if ((this.state.tick + groupIndex) % AI_INTERVAL_TICKS !== 0) {
        continue;
      }
      const { options, candidates } = this.evaluateArtilleryMissionOptions(
        group,
        platform,
        configurations,
      );
      const selected = options[0];
      const retainedMission = platform.fireMission;
      if (retainedMission) {
        platform.fireMissionEvaluation = {
          evaluatedAt: this.state.tick,
          reason: retainedMission.status === "ready"
            ? "ARTILLERY_AIM_INDIRECT_MISSION"
            : platform.deployment?.state === "deployed"
              ? "ARTILLERY_AIM_INDIRECT_MISSION"
              : "ARTILLERY_DEPLOY_FOR_MISSION",
          selectedTargetGroupId: retainedMission.snapshot.targetGroupId,
          candidates,
        };
        continue;
      }
      if (!selected) {
        platform.fireMissionEvaluation = {
          evaluatedAt: this.state.tick,
          reason: candidates.some((candidate) => candidate.dangerClose)
            ? "ARTILLERY_HOLD_DANGER_CLOSE"
            : "ARTILLERY_HOLD_NO_LEGAL_CONTACT",
          candidates,
        };
        continue;
      }

      const assigned = this.assignArtilleryMission(platform, selected);
      platform.fireMissionEvaluation = {
        evaluatedAt: this.state.tick,
        reason: platform.deployment?.state === "deployed"
          ? "ARTILLERY_AIM_INDIRECT_MISSION"
          : "ARTILLERY_DEPLOY_FOR_MISSION",
        selectedTargetGroupId: selected.contact.targetGroupId,
        candidates,
      };
      this.holdGroupForArtilleryMission(group, platform, assigned);
    }
  }

  private indirectWeaponConfigurations(platform: PlatformState) {
    const capabilities = this.platformCapabilities(platform);
    return [...platform.weaponStates]
      .sort((a, b) => compareStrings(a.componentId, b.componentId))
      .flatMap((weaponState) => {
        const weapon = getWeaponTemplate(this.setup.content, weaponState.weaponTemplateId);
        const capability = capabilities.weapons.find(
          (candidate) => candidate.componentId === weaponState.componentId,
        );
        const available = Boolean(
          capability?.available &&
            this.platformWeaponOperator(platform, weaponState.componentId),
        );
        return weapon.fireModes
          .filter((mode): mode is IndirectFireMode => mode.targeting === "indirect")
          .map((fireMode) => ({ weaponState, weapon, fireMode, available }));
      });
  }

  private evaluateArtilleryMissionOptions(
    group: GroupState,
    platform: PlatformState,
    configurations: ReturnType<StageOneBattleSimulation["indirectWeaponConfigurations"]>,
  ): {
    readonly options: readonly ArtilleryMissionOption[];
    readonly candidates: readonly FireMissionEvaluationCandidateInspection[];
  } {
    const options: ArtilleryMissionOption[] = [];
    const candidates: FireMissionEvaluationCandidateInspection[] = [];
    const missionSequence = platform.deployment?.missionsAssigned ?? 0;
    const contacts = this.artilleryMissionContacts(group);

    for (const contact of contacts) {
      let bestOption: ArtilleryMissionOption | undefined;
      let fallbackEvaluation: FireMissionEvaluationCandidateInspection | undefined;
      let fallbackFireModeId: string | undefined;
      for (const configuration of configurations) {
        const { weapon, weaponState, fireMode, available } = configuration;
        const ageTicks = Math.max(0, this.state.tick - contact.observedAt);
        const effectivenessBps = weaponTargetEffectivenessBps(
          weapon,
          contact.targetProfile,
          contact.targetDomain,
        );
        const weaponCompatible = effectivenessBps > 0;
        const uncertainty = calculateArtilleryUncertainty(
          fireMode.uncertainty,
          contact.intelSource,
          this.state.tick,
          contact.observedAt,
          contact.confidenceBps,
        );
        const missionId = `${platform.id}:${weaponState.componentId}:${this.state.tick}:${missionSequence}`;
        const scatter = this.selectArtilleryScatter(
          missionId,
          `${platform.id}:${weaponState.componentId}`,
          contact.lastKnown,
          uncertainty.radiusMm,
          this.state.tick,
        );
        const dangerClose = this.isArtilleryDangerClose(
          group,
          scatter.cell,
          fireMode.blastRadiusMm,
        );
        const distanceSquaredMm = this.gridDistanceSquaredMm(
          platform.cell,
          contact.lastKnown,
        );
        const inRange =
          distanceSquaredMm >= fireMode.minimumRangeMm ** 2 &&
          distanceSquaredMm <= fireMode.maximumRangeMm ** 2;
        const hostile = this.isHostile(group.factionId, contact.targetFactionId);
        const fresh = ageTicks <= fireMode.uncertainty.maximumContactAgeTicks;
        const rejectionReason = !hostile
          ? "CONTACT_NOT_HOSTILE"
          : !fresh || contact.confidenceBps <= 0
            ? "CONTACT_EXPIRED"
            : !available
              ? "CAPABILITY_UNAVAILABLE"
              : !weaponCompatible
                ? "WEAPON_INCOMPATIBLE"
                : !inRange
                  ? "OUT_OF_RANGE"
                  : dangerClose
                    ? "DANGER_CLOSE"
                    : undefined;
        const baseScore = scoreTargetCandidates([{
          targetGroupId: contact.targetGroupId,
          targetProfile: contact.targetProfile,
          targetDomain: contact.targetDomain,
          lastKnown: { ...contact.lastKnown },
          observedAt: contact.observedAt,
          confidenceBps: contact.confidenceBps,
          source: contact.intelSource === "local-direct"
            ? "direct-contact"
            : "shared-contact",
          distanceSquared: squaredGridDistance(platform.cell, contact.lastKnown),
          effectivenessBps,
          taskRelevanceBps: this.targetTaskRelevanceBps(group, contact.lastKnown),
          retained: platform.fireMission?.snapshot.targetGroupId === contact.targetGroupId,
        }], this.state.tick)[0]?.score ?? 0;
        const score = rejectionReason
          ? 0
          : Math.max(1, baseScore - Math.floor(uncertainty.radiusMm / 1_000));
        const evaluation: FireMissionEvaluationCandidateInspection = {
          targetGroupId: contact.targetGroupId,
          source: contact.intelSource,
          ageTicks,
          uncertaintyRadiusMm: uncertainty.radiusMm,
          weaponCompatible,
          dangerClose,
          score,
          ...(rejectionReason ? { rejectionReason } : {}),
        };
        if (
          !fallbackEvaluation ||
          score > fallbackEvaluation.score ||
          (score === fallbackEvaluation.score &&
            compareStrings(fireMode.id, fallbackFireModeId ?? "\uffff") < 0)
        ) {
          fallbackEvaluation = evaluation;
          fallbackFireModeId = fireMode.id;
        }
        if (!rejectionReason) {
          const option: ArtilleryMissionOption = {
            contact,
            weapon,
            weaponComponentId: weaponState.componentId,
            fireMode,
            missionId,
            uncertaintyRadiusMm: uncertainty.radiusMm,
            selectedOffset: { ...scatter.offset },
            plannedImpactCell: { ...scatter.cell },
            score,
            evaluation,
          };
          if (
            !bestOption ||
            option.score > bestOption.score ||
            (option.score === bestOption.score &&
              compareStrings(option.fireMode.id, bestOption.fireMode.id) < 0)
          ) {
            bestOption = option;
          }
        }
      }
      if (fallbackEvaluation) {
        candidates.push(bestOption?.evaluation ?? fallbackEvaluation);
      }
      if (bestOption) {
        options.push(bestOption);
      }
    }

    options.sort(
      (a, b) =>
        b.score - a.score ||
        b.contact.observedAt - a.contact.observedAt ||
        compareStrings(a.contact.targetGroupId, b.contact.targetGroupId) ||
        compareStrings(a.weaponComponentId, b.weaponComponentId) ||
        compareStrings(a.fireMode.id, b.fireMode.id),
    );
    candidates.sort(
      (a, b) =>
        b.score - a.score ||
        compareStrings(a.targetGroupId, b.targetGroupId),
    );
    return { options, candidates };
  }

  private artilleryMissionContacts(group: GroupState): readonly ContactState[] {
    const contacts = new Map<GroupId, ContactState>();
    const addContact = (contact: ContactState): void => {
      const known = contacts.get(contact.targetGroupId);
      if (
        !known ||
        contact.observedAt > known.observedAt ||
        (contact.observedAt === known.observedAt &&
          this.fireMissionSourceRank(contact.intelSource) <
            this.fireMissionSourceRank(known.intelSource)) ||
        (contact.observedAt === known.observedAt &&
          contact.intelSource === known.intelSource &&
          contact.deliveredAt > known.deliveredAt)
      ) {
        contacts.set(contact.targetGroupId, contact);
      }
    };
    sortedContacts(this.state.factionKnowledge.get(group.factionId)?.contacts ?? new Map())
      .forEach(addContact);
    sortedContacts(group.localContacts).forEach(addContact);
    return [...contacts.values()].sort((a, b) =>
      compareStrings(a.targetGroupId, b.targetGroupId),
    );
  }

  private fireMissionSourceRank(source: FireMissionIntelSource): number {
    return source === "local-direct" ? 0 : source === "same-faction" ? 1 : 2;
  }

  private selectArtilleryScatter(
    missionId: string,
    weaponEntityId: string,
    aimCell: GridCoord,
    radiusMm: number,
    assignedAt: number,
  ) {
    const candidates = artilleryScatterCandidates(this.setup.map, aimCell, radiusMm);
    const index = candidates.length === 0
      ? 0
      : deterministicUint32(
          this.setup.seed,
          "artillery-scatter-cell",
          assignedAt,
          `${missionId}:${weaponEntityId}`,
          0,
        ) % candidates.length;
    return candidates[index] ?? {
      cell: { ...aimCell },
      offset: { dx: 0, dz: 0 },
      distanceSquared: 0,
    };
  }

  private isArtilleryDangerClose(
    group: GroupState,
    impactCell: GridCoord,
    blastRadiusMm: number,
  ): boolean {
    for (const friendly of this.state.groups) {
      if (
        friendly.factionId === group.factionId &&
        isGroupSpatiallyActive(friendly) &&
        activeMemberCount(friendly) > 0 &&
        blastFalloffBps(
          impactCell,
          friendly.cell,
          this.setup.map.cellSizeMm,
          blastRadiusMm,
        ) > 0
      ) {
        return true;
      }
    }
    for (const contact of this.artilleryMissionContacts(group)) {
      if (
        !this.isHostile(group.factionId, contact.targetFactionId) &&
        contact.confidenceBps > 0 &&
        blastFalloffBps(
          impactCell,
          contact.lastKnown,
          this.setup.map.cellSizeMm,
          blastRadiusMm,
        ) > 0
      ) {
        return true;
      }
    }
    return false;
  }

  private gridDistanceSquaredMm(a: GridCoord, b: GridCoord): number {
    const dxMm = (a.x - b.x) * this.setup.map.cellSizeMm;
    const dzMm = (a.z - b.z) * this.setup.map.cellSizeMm;
    return dxMm * dxMm + dzMm * dzMm;
  }

  private hasCurrentArtillerySelfDefenseContact(group: GroupState): boolean {
    return sortedContacts(group.localContacts).some(
      (contact) => {
        if (
          contact.lastDirectTick !== this.state.tick ||
          !this.isHostile(group.factionId, contact.targetFactionId)
        ) {
          return false;
        }
        const rangeBand = this.groupTargetRangeBand(
          group,
          contact.targetProfile,
          contact.targetDomain,
        );
        if (!rangeBand) {
          return false;
        }
        const distanceSquared = squaredGridDistance(group.cell, contact.lastKnown);
        return (
          distanceSquared >= rangeBand.minimum ** 2 &&
          distanceSquared <= rangeBand.maximum ** 2
        );
      },
    );
  }

  private assignArtilleryMission(
    platform: PlatformState,
    option: ArtilleryMissionOption,
  ): ArtilleryFireMissionState {
    const mission: ArtilleryFireMissionState = {
      id: option.missionId,
      platformId: platform.id,
      weaponComponentId: option.weaponComponentId,
      fireModeId: option.fireMode.id,
      assignedAt: this.state.tick,
      snapshot: {
        targetGroupId: option.contact.targetGroupId,
        targetFactionId: option.contact.targetFactionId,
        targetProfile: option.contact.targetProfile,
        targetDomain: option.contact.targetDomain,
        lastKnown: { ...option.contact.lastKnown },
        observedAt: option.contact.observedAt,
        deliveredAt: option.contact.deliveredAt,
        source: option.contact.intelSource,
        confidenceBps: option.contact.confidenceBps,
      },
      uncertaintyRadiusMm: option.uncertaintyRadiusMm,
      selectedOffset: { ...option.selectedOffset },
      plannedImpactCell: { ...option.plannedImpactCell },
      status: option.fireMode.aimTicks === 0 ? "ready" : "aiming",
      aimTicksRemaining: option.fireMode.aimTicks,
    };
    platform.fireMission = mission;
    if (platform.deployment) {
      platform.deployment.missionsAssigned += 1;
    }
    this.emit({
      type: "artillery-mission-changed",
      missionId: mission.id,
      platformId: platform.id,
      groupId: platform.groupId,
      phase: "assigned",
    });
    this.markMeaningfulProgress();
    return mission;
  }

  private cancelArtilleryMission(
    platform: PlatformState,
    reason: "contact-expired" | "contact-replaced" | "danger-close" | "capability-lost",
  ): void {
    const mission = platform.fireMission;
    if (!mission) {
      return;
    }
    mission.status = "cancelled";
    this.emit({
      type: "artillery-mission-changed",
      missionId: mission.id,
      platformId: platform.id,
      groupId: platform.groupId,
      phase: "cancelled",
      reason,
    });
    platform.fireMissionEvaluation = {
      evaluatedAt: this.state.tick,
      reason: reason === "danger-close"
        ? "ARTILLERY_HOLD_DANGER_CLOSE"
        : "ARTILLERY_HOLD_NO_LEGAL_CONTACT",
      candidates: platform.fireMissionEvaluation?.candidates ?? [],
    };
    platform.fireMission = undefined;
    this.markMeaningfulProgress();
  }

  private holdGroupForArtilleryMission(
    group: GroupState,
    platform: PlatformState,
    mission: ArtilleryFireMissionState,
  ): void {
    this.cancelMovement(group);
    group.action = "engaging";
    group.decisionReason = platform.deployment?.state === "deployed"
      ? "ARTILLERY_AIM_INDIRECT_MISSION"
      : "ARTILLERY_DEPLOY_FOR_MISSION";
    group.currentTargetId = mission.snapshot.targetGroupId;
    group.goal = undefined;
  }

  private updatePlatformDeployments(): void {
    for (const platform of [...this.state.platformsById.values()].sort(compareById)) {
      const deployment = platform.deployment;
      if (!deployment) {
        continue;
      }
      const group = this.state.groupsById.get(platform.groupId);
      const template = getPlatformTemplate(this.setup.content, platform.platformTemplateId);
      const rule = template.deploymentRule;
      if (!group || !rule) {
        continue;
      }
      const movementRequested = this.groupRequestsPlatformMovement(group);
      const unavailableReason =
        platform.disposition === "crewed"
          ? this.platformCanChangeDeployment(platform)
            ? undefined
            : "capability-lost" as const
          : "platform-unavailable" as const;

      if (deployment.state === "deploying" || deployment.state === "packing") {
        if (unavailableReason || (movementRequested && deployment.state === "deploying")) {
          this.cancelPlatformDeployment(
            platform,
            unavailableReason ?? "move-requested",
          );
          continue;
        }
        deployment.ticksRemaining = Math.max(0, deployment.ticksRemaining - 1);
        if (deployment.ticksRemaining === 0) {
          const from = deployment.state;
          const to = from === "deploying" ? "deployed" : "packed";
          deployment.state = to;
          deployment.startedAt = undefined;
          deployment.returnState = undefined;
          this.emit({
            type: "platform-deployment-changed",
            platformId: platform.id,
            groupId: platform.groupId,
            from,
            to,
            phase: "completed",
          });
          this.markMeaningfulProgress();
        }
        continue;
      }

      if (deployment.state === "deployed" && movementRequested && !unavailableReason) {
        this.startPlatformDeploymentTransition(platform, "packing", rule.packTicks);
        continue;
      }
      if (
        deployment.state === "packed" &&
        !movementRequested &&
        !unavailableReason &&
        this.groupNeedsDeployedWeapon(group, platform)
      ) {
        this.startPlatformDeploymentTransition(platform, "deploying", rule.deployTicks);
      }
    }
  }

  private startPlatformDeploymentTransition(
    platform: PlatformState,
    to: "deploying" | "packing",
    ticks: number,
  ): void {
    const deployment = platform.deployment;
    if (!deployment) {
      return;
    }
    const from = deployment.state;
    deployment.state = to;
    deployment.ticksRemaining = ticks;
    deployment.startedAt = this.state.tick;
    deployment.returnState = from === "deployed" ? "deployed" : "packed";
    this.emit({
      type: "platform-deployment-changed",
      platformId: platform.id,
      groupId: platform.groupId,
      from,
      to,
      phase: "started",
      reason: to === "packing" ? "move-requested" : undefined,
    });
    this.markMeaningfulProgress();
  }

  private cancelPlatformDeployment(
    platform: PlatformState,
    reason: "move-requested" | "capability-lost" | "platform-unavailable",
  ): void {
    const deployment = platform.deployment;
    if (!deployment || (deployment.state !== "deploying" && deployment.state !== "packing")) {
      return;
    }
    const from = deployment.state;
    const to = deployment.returnState ?? (from === "deploying" ? "packed" : "deployed");
    deployment.state = to;
    deployment.ticksRemaining = 0;
    deployment.startedAt = undefined;
    deployment.returnState = undefined;
    this.emit({
      type: "platform-deployment-changed",
      platformId: platform.id,
      groupId: platform.groupId,
      from,
      to,
      phase: "cancelled",
      reason,
    });
    this.markMeaningfulProgress();
  }

  private platformCanChangeDeployment(platform: PlatformState): boolean {
    const template = getPlatformTemplate(this.setup.content, platform.platformTemplateId);
    const rule = template.deploymentRule;
    if (!rule) {
      return false;
    }
    const capabilities = this.platformCapabilities(platform);
    return (
      rule.requiredStationIds.every(
        (stationId) =>
          (capabilities.stations.find((station) => station.stationId === stationId)
            ?.efficiencyBps ?? 0) > 0,
      ) &&
      rule.requiredComponentIds.every(
        (componentId) =>
          capabilities.components.find((component) => component.componentId === componentId)
            ?.available === true,
      )
    );
  }

  private groupRequestsPlatformMovement(group: GroupState): boolean {
    return Boolean(
      group.movingTo ||
        group.turnGoalFacing !== undefined ||
        (group.path.length > 0 && group.action !== "engaging"),
    );
  }

  private groupNeedsDeployedWeapon(group: GroupState, platform: PlatformState): boolean {
    if (
      platform.fireMission &&
      (platform.fireMission.status === "aiming" || platform.fireMission.status === "ready")
    ) {
      const configuration = this.indirectWeaponConfigurations(platform).find(
        (candidate) =>
          candidate.weaponState.componentId === platform.fireMission?.weaponComponentId &&
          candidate.fireMode.id === platform.fireMission?.fireModeId,
      );
      if (configuration?.available && configuration.fireMode.requiresDeployedPlatform) {
        return true;
      }
    }
    if (group.action !== "engaging" || !group.currentTargetId) {
      return false;
    }
    const target = this.state.groupsById.get(group.currentTargetId);
    if (!target || !this.hasFreshDirectContact(group, target)) {
      return false;
    }
    const distanceSquared = squaredGridDistance(group.cell, target.cell);
    const capabilities = this.platformCapabilities(platform);
    return platform.weaponStates.some((weaponState) => {
      const available = capabilities.weapons.find(
        (capability) => capability.componentId === weaponState.componentId,
      )?.available;
      const weapon = getWeaponTemplate(this.setup.content, weaponState.weaponTemplateId);
      const mode = weapon.fireModes.find((candidate) => candidate.targeting === "direct");
      return (
        available &&
        mode !== undefined &&
        mode.requiresDeployedPlatform &&
        distanceSquared >= this.fireModeMinimumRangeCells(mode) ** 2 &&
        distanceSquared <= this.fireModeRangeCells(mode) ** 2
      );
    });
  }

  private activeTargetPlatform(group: GroupState): PlatformState | undefined {
    return [...group.platforms]
      .filter((platform) => platform.disposition === "crewed")
      .sort(compareById)[0];
  }

  private abandonPlatform(platform: PlatformState): void {
    const group = this.state.groupsById.get(platform.groupId);
    if (!group) {
      return;
    }
    const platformIndex = cellIndex(this.setup.map, platform.cell);
    if (
      this.state.staticPlatformOccupancy.get(platformIndex) === platform.id &&
      platform.crewAssignments.length === 0 &&
      platform.crewReassignments.length === 0
    ) {
      return;
    }
    this.cancelMovement(group);
    this.cancelPlatformDeployment(platform, "platform-unavailable");
    for (const action of [...platform.crewReassignments].sort((a, b) =>
      compareStrings(a.memberId, b.memberId),
    )) {
      this.emit({
        type: "crew-station-changed",
        platformId: platform.id,
        groupId: platform.groupId,
        memberId: action.memberId,
        fromStationId: action.fromStationId,
        toStationId: action.toStationId,
        phase: "cancelled",
      });
    }
    platform.crewReassignments.splice(0, platform.crewReassignments.length);
    for (const assignment of [...platform.crewAssignments].sort((a, b) =>
      compareStrings(a.memberId, b.memberId),
    )) {
      const member = this.state.membersById.get(assignment.memberId);
      if (
        member?.placement.kind === "crew" &&
        member.placement.platformId === platform.id
      ) {
        member.placement = { kind: "dismounted" };
      }
    }
    platform.crewAssignments.splice(0, platform.crewAssignments.length);
    group.movementType = "foot";
    group.headingRadians = platform.facing * (Math.PI / 4);
    this.state.staticPlatformOccupancy.set(platformIndex, platform.id);
    this.refreshPlatformState(platform, true);
    this.markMeaningfulProgress();
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

  private updateTransportAssignments(): void {
    for (const assignment of this.state.transportAssignments) {
      if (assignment.status === "pending") {
        if (
          activateTransportAssignment(
            assignment,
            this.state.groupsById,
            this.state.platformsById,
            this.state.tick,
          ) &&
          assignment.initiallyEmbarked
        ) {
          const passengerGroup = this.state.groupsById.get(assignment.passengerGroupId);
          if (passengerGroup) {
            this.cancelMovement(passengerGroup);
            this.releaseCover(passengerGroup);
            const passengerIndex = cellIndex(this.setup.map, passengerGroup.cell);
            if (this.state.occupancy.get(passengerIndex) === passengerGroup.id) {
              this.state.occupancy.delete(passengerIndex);
            }
          }
        }
        continue;
      }

      const passengerGroup = this.state.groupsById.get(assignment.passengerGroupId);
      const platform = this.state.platformsById.get(assignment.platformId);
      const platformGroup = platform
        ? this.state.groupsById.get(platform.groupId)
        : undefined;
      if (!passengerGroup || !platform || !platformGroup) {
        continue;
      }

      if (assignment.status === "embarking") {
        if (
          platform.disposition !== "crewed" ||
          platform.mobility !== "mobile" ||
          platformGroup.movingTo ||
          passengerGroup.movingTo ||
          !areTransportCellsAdjacent(passengerGroup.cell, platform.cell)
        ) {
          this.cancelTransportAction(
            assignment,
            platformGroup.movingTo || passengerGroup.movingTo
              ? "platform-moved"
              : "platform-unavailable",
          );
          continue;
        }
        assignment.ticksRemaining = Math.max(0, assignment.ticksRemaining - 1);
        if (assignment.ticksRemaining === 0) {
          this.completeEmbarkation(assignment, passengerGroup, platform);
        }
        continue;
      }

      if (assignment.status === "disembarking") {
        const destination = assignment.destination;
        if (platform.disposition !== "crewed") {
          this.cancelTransportAction(assignment, "platform-unavailable");
          this.forcePassengerDismount(assignment, passengerGroup, platform);
          continue;
        }
        if (
          !destination ||
          platformGroup.movingTo ||
          !areTransportCellsAdjacent(destination, platform.cell)
        ) {
          this.cancelTransportAction(assignment, "platform-moved");
          continue;
        }
        if (
          !isTransportDestinationAvailable(
            this.setup.map,
            destination,
            this.transportCellOccupancy(),
            passengerGroup.id,
          )
        ) {
          this.cancelTransportAction(assignment, "destination-blocked");
          continue;
        }
        assignment.ticksRemaining = Math.max(0, assignment.ticksRemaining - 1);
        if (assignment.ticksRemaining === 0) {
          this.completeDisembarkation(
            assignment,
            passengerGroup,
            platform,
            destination,
            "completed",
          );
        }
        continue;
      }

      if (assignment.status === "embarked") {
        passengerGroup.cell = { ...platform.cell };
        if (platform.disposition !== "crewed") {
          this.forcePassengerDismount(assignment, passengerGroup, platform);
          continue;
        }
        const dismountReason = this.transportDismountReason(
          passengerGroup,
          platform,
        );
        if (dismountReason) {
          this.startDisembarkation(
            assignment,
            passengerGroup,
            platform,
            dismountReason,
          );
        }
        continue;
      }

      if (assignment.status === "trapped") {
        passengerGroup.cell = { ...platform.cell };
        this.forcePassengerDismount(assignment, passengerGroup, platform);
        continue;
      }

      if (
        assignment.status === "dismounted" &&
        this.shouldEmbarkTransport(assignment, passengerGroup, platform) &&
        areTransportCellsAdjacent(passengerGroup.cell, platform.cell) &&
        !passengerGroup.movingTo &&
        !platformGroup.movingTo &&
        !this.platformHasActiveTransportAction(platform.id)
      ) {
        this.startEmbarkation(assignment, passengerGroup, platform);
      }
    }
  }

  private startEmbarkation(
    assignment: TransportAssignmentState,
    passengerGroup: GroupState,
    platform: PlatformState,
  ): void {
    const platformGroup = this.state.groupsById.get(platform.groupId);
    if (!platformGroup) {
      return;
    }
    this.cancelMovement(passengerGroup);
    this.cancelMovement(platformGroup);
    assignment.status = "embarking";
    assignment.ticksRemaining = getPlatformTemplate(
      this.setup.content,
      platform.platformTemplateId,
    ).embarkTicks;
    assignment.destination = undefined;
    passengerGroup.action = "searching";
    passengerGroup.decisionReason = "transport-embarking";
    platformGroup.action = "searching";
    platformGroup.decisionReason = "transport-embarking";
    this.emit({
      type: "embarkation-changed",
      assignmentId: assignment.id,
      platformId: platform.id,
      passengerGroupId: passengerGroup.id,
      action: "embark",
      phase: "started",
      reason: "automatic",
    });
    this.markMeaningfulProgress();
  }

  private completeEmbarkation(
    assignment: TransportAssignmentState,
    passengerGroup: GroupState,
    platform: PlatformState,
  ): void {
    this.cancelMovement(passengerGroup);
    this.releaseCover(passengerGroup);
    const passengerIndex = cellIndex(this.setup.map, passengerGroup.cell);
    if (this.state.occupancy.get(passengerIndex) === passengerGroup.id) {
      this.state.occupancy.delete(passengerIndex);
    }
    embarkPassengerGroup(passengerGroup, platform);
    assignment.status = "embarked";
    assignment.ticksRemaining = 0;
    assignment.destination = undefined;
    assignment.dismountEvaluation = undefined;
    assignment.lastTransitionTick = this.state.tick;
    passengerGroup.action = "searching";
    passengerGroup.decisionReason = "transport-embarked";
    this.emit({
      type: "embarkation-changed",
      assignmentId: assignment.id,
      platformId: platform.id,
      passengerGroupId: passengerGroup.id,
      action: "embark",
      phase: "completed",
    });
    this.markMeaningfulProgress();
  }

  private startDisembarkation(
    assignment: TransportAssignmentState,
    passengerGroup: GroupState,
    platform: PlatformState,
    reason: TransportDismountReason,
  ): void {
    if (this.platformHasActiveTransportAction(platform.id)) {
      return;
    }
    const destination = this.selectAndRecordTransportDismount(
      assignment,
      passengerGroup,
      platform,
      reason,
    );
    if (!destination) {
      return;
    }
    const platformGroup = this.state.groupsById.get(platform.groupId);
    if (!platformGroup) {
      return;
    }
    this.cancelMovement(platformGroup);
    assignment.status = "disembarking";
    assignment.ticksRemaining = getPlatformTemplate(
      this.setup.content,
      platform.platformTemplateId,
    ).disembarkTicks;
    assignment.destination = { ...destination };
    this.state.reservations.set(
      cellIndex(this.setup.map, destination),
      passengerGroup.id,
    );
    passengerGroup.action = "searching";
    passengerGroup.decisionReason = "transport-disembarking";
    platformGroup.action = "searching";
    platformGroup.decisionReason = "transport-disembarking";
    this.emit({
      type: "embarkation-changed",
      assignmentId: assignment.id,
      platformId: platform.id,
      passengerGroupId: passengerGroup.id,
      action: "disembark",
      phase: "started",
      reason: "automatic",
    });
    this.markMeaningfulProgress();
  }

  private completeDisembarkation(
    assignment: TransportAssignmentState,
    passengerGroup: GroupState,
    platform: PlatformState,
    destination: GridCoord,
    phase: "completed" | "forced",
  ): void {
    this.state.reservations.delete(cellIndex(this.setup.map, destination));
    dismountPassengerGroup(passengerGroup, platform, destination);
    assignment.status = "dismounted";
    assignment.ticksRemaining = 0;
    assignment.destination = undefined;
    assignment.lastTransitionTick = this.state.tick;
    passengerGroup.action = "searching";
    passengerGroup.decisionReason =
      phase === "forced" ? "transport-forced-dismount" : "transport-dismounted";
    if (activeMemberCount(passengerGroup) > 0) {
      this.state.occupancy.set(
        cellIndex(this.setup.map, passengerGroup.cell),
        passengerGroup.id,
      );
      this.claimCover(passengerGroup);
    }
    this.emit({
      type: "embarkation-changed",
      assignmentId: assignment.id,
      platformId: platform.id,
      passengerGroupId: passengerGroup.id,
      action: "disembark",
      phase,
      ...(phase === "forced"
        ? {
            reason:
              platform.disposition === "destroyed"
                ? ("platform-destroyed" as const)
                : ("platform-unavailable" as const),
          }
        : {}),
    });
    this.markMeaningfulProgress();
  }

  private cancelTransportAction(
    assignment: TransportAssignmentState,
    reason: "platform-moved" | "platform-unavailable" | "destination-blocked",
  ): void {
    const action = assignment.status === "embarking" ? "embark" : "disembark";
    if (assignment.destination) {
      this.state.reservations.delete(
        cellIndex(this.setup.map, assignment.destination),
      );
    }
    assignment.status = action === "embark" ? "dismounted" : "embarked";
    assignment.ticksRemaining = 0;
    assignment.destination = undefined;
    this.emit({
      type: "embarkation-changed",
      assignmentId: assignment.id,
      platformId: assignment.platformId,
      passengerGroupId: assignment.passengerGroupId,
      action,
      phase: "cancelled",
      reason,
    });
    this.markMeaningfulProgress();
  }

  private forcePassengerDismount(
    assignment: TransportAssignmentState,
    passengerGroup: GroupState,
    platform: PlatformState,
  ): void {
    if (platform.disposition === "destroyed" && !assignment.passengerDamageResolved) {
      assignment.passengerDamageResolved = true;
      [...passengerGroup.members].sort(compareById).forEach((member, ordinal) => {
        if (!canMemberFight(member)) {
          return;
        }
        this.applyHit(member, passengerGroup, {
          shooterGroupId: platform.groupId,
          shooterEntityId: `platform-destruction:${platform.id}`,
          targetGroupId: passengerGroup.id,
          targetMemberId: member.id,
          shotOrdinal: ordinal,
          damageBps: 10_000,
          hitSuppressionBps: 0,
        });
      });
    }
    const destination = this.selectAndRecordTransportDismount(
      assignment,
      passengerGroup,
      platform,
      "forced",
    );
    if (destination) {
      this.completeDisembarkation(
        assignment,
        passengerGroup,
        platform,
        destination,
        "forced",
      );
      return;
    }
    if (assignment.status !== "trapped") {
      if (assignment.destination) {
        this.state.reservations.delete(
          cellIndex(this.setup.map, assignment.destination),
        );
      }
      assignment.status = "trapped";
      assignment.ticksRemaining = 0;
      assignment.destination = undefined;
      assignment.lastTransitionTick = this.state.tick;
      passengerGroup.action = "combat-ineffective";
      passengerGroup.decisionReason = "transport-trapped";
      this.emit({
        type: "embarkation-changed",
        assignmentId: assignment.id,
        platformId: platform.id,
        passengerGroupId: passengerGroup.id,
        action: "disembark",
        phase: "started",
        reason:
          platform.disposition === "destroyed"
            ? "platform-destroyed"
            : "platform-unavailable",
      });
      this.markMeaningfulProgress();
    }
  }

  private transportDismountReason(
    passengerGroup: GroupState,
    platform: PlatformState,
  ): TransportDismountReason | undefined {
    if (passengerGroup.moraleState === "routing") {
      return "routing";
    }
    const platformGroup = this.state.groupsById.get(platform.groupId);
    if (!platformGroup) {
      return undefined;
    }
    if (
      platform.mobility === "immobilized" ||
      platform.combat === "ineffective" ||
      platform.components.some((component) => component.integrityBps < 10_000)
    ) {
      return "platform-risk";
    }
    if (this.hasFreshHostileContact(platformGroup)) {
      return "direct-contact";
    }
    return this.state.objectives.some(
      (objective) =>
        objective.unlocked &&
        (platformGroup.factionId === objective.attackerFactionId ||
          platformGroup.factionId === objective.defenderFactionId) &&
        squaredGridDistance(platform.cell, objective.center) <=
          (objective.radiusCells + 4) ** 2,
    )
      ? "objective-proximity"
      : undefined;
  }

  private selectAndRecordTransportDismount(
    assignment: TransportAssignmentState,
    passengerGroup: GroupState,
    platform: PlatformState,
    reason: TransportDismountReason,
  ): GridCoord | undefined {
    const platformGroup = this.state.groupsById.get(platform.groupId);
    const knownThreats = platformGroup
      ? this.transportKnownThreats(platformGroup)
      : [];
    const objective = platformGroup
      ? this.transportObjective(platformGroup, platform.cell)
      : undefined;
    const selection = selectTransportDismountCell(
      this.setup.map,
      platform.cell,
      this.transportCellOccupancy(),
      passengerGroup.id,
      { knownThreats, objectiveCell: objective?.center },
    );
    assignment.dismountEvaluation = {
      reason,
      evaluatedAt: this.state.tick,
      selectedCell: selection ? { ...selection.cell } : undefined,
      score: selection?.score ?? 0,
      components: selection
        ? { ...selection.components }
        : { threatSeparation: 0, platformShielding: 0, objectiveProximity: 0 },
      knownThreats: knownThreats.map((threat) => ({
        ...threat,
        lastKnown: { ...threat.lastKnown },
      })),
    };
    return selection ? { ...selection.cell } : undefined;
  }

  private transportKnownThreats(
    group: GroupState,
  ): TransportKnownThreatInspection[] {
    const contacts = new Map<GroupId, ContactState>();
    const addContact = (contact: ContactState) => {
      if (
        contact.confidenceBps <= 0 ||
        !this.isHostile(group.factionId, contact.targetFactionId)
      ) {
        return;
      }
      const previous = contacts.get(contact.targetGroupId);
      if (
        !previous ||
        contact.observedAt > previous.observedAt ||
        (contact.observedAt === previous.observedAt &&
          compareStrings(contact.sourceGroupId, previous.sourceGroupId) < 0)
      ) {
        contacts.set(contact.targetGroupId, contact);
      }
    };
    sortedContacts(group.localContacts).forEach(addContact);
    const factionContacts = this.state.factionKnowledge.get(group.factionId)?.contacts;
    if (factionContacts) {
      sortedContacts(factionContacts).forEach(addContact);
    }
    return [...contacts.values()]
      .sort((a, b) => compareStrings(a.targetGroupId, b.targetGroupId))
      .map((contact) => ({
        targetGroupId: contact.targetGroupId,
        targetFactionId: contact.targetFactionId,
        targetProfile: contact.targetProfile,
        lastKnown: { ...contact.lastKnown },
        observedAt: contact.observedAt,
        confidenceBps: contact.confidenceBps,
      }));
  }

  private transportObjective(
    group: GroupState,
    cell: GridCoord,
  ): ObjectiveRuntimeState | undefined {
    return this.state.objectives
      .filter(
        (objective) =>
          objective.unlocked &&
          (group.factionId === objective.attackerFactionId ||
            group.factionId === objective.defenderFactionId),
      )
      .sort(
        (a, b) =>
          squaredGridDistance(cell, a.center) - squaredGridDistance(cell, b.center) ||
          compareStrings(a.id, b.id),
      )[0];
  }

  private shouldEmbarkTransport(
    assignment: TransportAssignmentState,
    passengerGroup: GroupState,
    platform: PlatformState,
  ): boolean {
    const platformGroup = this.state.groupsById.get(platform.groupId);
    if (
      !platformGroup ||
      platform.disposition !== "crewed" ||
      platform.mobility !== "mobile" ||
      passengerGroup.moraleState === "routing" ||
      platformGroup.moraleState === "routing" ||
      activeMemberCount(passengerGroup) === 0 ||
      this.state.tick - assignment.lastTransitionTick < TRANSPORT_REEMBARK_DELAY_TICKS ||
      this.hasFreshHostileContact(passengerGroup) ||
      this.hasFreshHostileContact(platformGroup)
    ) {
      return false;
    }
    const template = getPlatformTemplate(this.setup.content, platform.platformTemplateId);
    const occupiedCapacity = platform.passengerGroupIds.reduce((sum, groupId) => {
      const group = this.state.groupsById.get(groupId);
      return group
        ? sum + runtimeTransportOccupancyUnits(group, this.setup.content)
        : sum;
    }, 0);
    if (
      occupiedCapacity + runtimeTransportOccupancyUnits(passengerGroup, this.setup.content) >
      template.transportCapacityUnits
    ) {
      return false;
    }
    return !this.state.objectives.some(
      (objective) =>
        objective.unlocked &&
        (passengerGroup.factionId === objective.attackerFactionId ||
          passengerGroup.factionId === objective.defenderFactionId) &&
        squaredGridDistance(passengerGroup.cell, objective.center) <=
          (objective.radiusCells + 5) ** 2,
    );
  }

  private hasFreshHostileContact(group: GroupState): boolean {
    return [...group.localContacts.values()].some((contact) => {
      return (
        this.isHostile(group.factionId, contact.targetFactionId) &&
        this.state.tick - contact.lastDirectTick <= DIRECT_CONTACT_FRESH_TICKS + 1
      );
    });
  }

  private platformHasActiveTransportAction(platformId: string): boolean {
    return (this.state.transportAssignmentsByPlatformId.get(platformId) ?? []).some(
      (assignment) =>
        assignment.status === "embarking" || assignment.status === "disembarking",
    );
  }

  private transportCellOccupancy() {
    return {
      groups: this.state.occupancy,
      staticPlatforms: this.state.staticPlatformOccupancy,
      reservations: this.state.reservations,
    };
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
          targetFactionId: message.targetFactionId,
          targetProfile: message.targetProfile,
          targetDomain: message.targetDomain,
          targetFlight: message.targetFlight ? { ...message.targetFlight } : undefined,
          lastKnown: { ...message.lastKnown },
          observedAt: message.observedAt,
          deliveredAt: message.deliveryAt,
          lastDirectTick: -1,
          confidenceBps: message.confidenceBps,
          sourceGroupId: message.sourceGroupId,
          intelSource: message.intelSource,
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
            observerHeightUnits: this.groupSightHeightUnits(observer),
            targetHeightUnits: this.groupSightHeightUnits(target, target.cell, 3),
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
          const targetFlight = this.flightForGroup(target);
          const altitudeExposureBonus = targetFlight
            ? altitudeBandModifiers(targetFlight.altitudeBand).exposureBps
            : 0;
          const distanceBonus = Math.max(0, sightRangeSquared - distanceSquared) * 7;
          const detectionGain = applyBasisPointReduction(
            480 + distanceBonus + exposureBonus + altitudeExposureBonus,
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
              targetFactionId: target.factionId,
              targetProfile: this.targetProfileForGroup(target),
              targetDomain: this.targetDomainForGroup(target),
              targetFlight: this.flightForGroup(target),
              lastKnown: { ...target.cell },
              observedAt: this.state.tick,
              deliveredAt: this.state.tick,
              lastDirectTick: this.state.tick,
              confidenceBps: 10_000,
              sourceGroupId: observer.id,
              intelSource: "local-direct",
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
        targetFactionId: target.factionId,
        targetProfile: this.targetProfileForGroup(target),
        targetDomain: this.targetDomainForGroup(target),
        targetFlight: this.flightForGroup(target),
        observedAt: this.state.tick,
        deliveryAt: this.state.tick + recipient.deliveryDelayTicks,
        lastKnown: { ...target.cell },
        confidenceBps: 10_000,
        intelSource: recipient.factionId === observer.factionId
          ? "same-faction"
          : "allied",
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
      this.evaluateFlightAltitude(group);
    });
  }

  private evaluateFlightAltitude(group: GroupState): void {
    const platform = group.platforms.find(
      (candidate) => candidate.flight && candidate.disposition === "crewed",
    );
    const flight = platform?.flight;
    if (!platform || !flight || !isGroupSpatiallyActive(group)) {
      return;
    }
    const template = getPlatformTemplate(this.setup.content, platform.platformTemplateId);
    const flightRule = template.flightRule;
    if (!flightRule) {
      return;
    }
    const interestPoints = this.flightAltitudeInterestPoints(group);
    const routeDestination = group.movingTo ?? group.path.find(
      (cell) => !sameCoord(cell, group.cell),
    );
    const candidates = (["low", "medium", "high"] as const).flatMap(
      (altitudeBand): readonly FlightAltitudeCandidateInput[] => {
        const clearanceMm = flightRule.clearanceMmByBand[altitudeBand];
        if (clearanceMm === undefined) {
          return [];
        }
        const observerHeightUnits =
          heightAt(this.setup.map, group.cell) + clearanceMm / this.setup.map.heightUnitMm;
        return [{
          altitudeBand,
          clearanceMm,
          visibleInterestCount: interestPoints.filter((point) =>
            hasLineOfSight(this.setup.map, group.cell, point.cell, {
              observerHeightUnits,
              targetHeightUnits: point.targetHeightUnits,
            }),
          ).length,
          routeClear:
            !routeDestination ||
            flightStepHasTerrainClearance(
              this.setup.map,
              group.cell,
              routeDestination,
              clearanceMm,
            ),
        }];
      },
    );
    const scored = scoreFlightAltitudeCandidates(flight.altitudeBand, candidates);
    const selected =
      scored.find((candidate) => !candidate.rejectionReason) ??
      scored.find((candidate) => candidate.altitudeBand === flight.altitudeBand);
    if (!selected) {
      return;
    }
    flight.evaluation = {
      evaluatedAt: this.state.tick,
      reason: this.flightAltitudeEvaluationReason(
        flight.altitudeBand,
        selected.altitudeBand,
        scored,
      ),
      selectedAltitudeBand: selected.altitudeBand,
      candidates: scored,
    };
  }

  private flightAltitudeInterestPoints(group: GroupState): readonly {
    readonly cell: GridCoord;
    readonly targetHeightUnits: number;
  }[] {
    const contacts = new Map<GroupId, ContactState>();
    for (const contact of this.state.factionKnowledge.get(group.factionId)?.contacts.values() ?? []) {
      if (contact.confidenceBps > 0 && this.isHostile(group.factionId, contact.targetFactionId)) {
        contacts.set(contact.targetGroupId, contact);
      }
    }
    for (const contact of group.localContacts.values()) {
      const current = contacts.get(contact.targetGroupId);
      if (
        contact.confidenceBps > 0 &&
        this.isHostile(group.factionId, contact.targetFactionId) &&
        (!current || contact.observedAt >= current.observedAt)
      ) {
        contacts.set(contact.targetGroupId, contact);
      }
    }
    const points = [...contacts.values()]
      .sort((a, b) => compareStrings(a.targetGroupId, b.targetGroupId))
      .map((contact) => ({
        cell: { ...contact.lastKnown },
        targetHeightUnits: contact.targetFlight
          ? flightHeightUnits(this.setup.map, contact.lastKnown, contact.targetFlight)
          : heightAt(this.setup.map, contact.lastKnown) + 3,
      }));
    if (group.goal) {
      points.push({
        cell: { ...group.goal },
        targetHeightUnits: heightAt(this.setup.map, group.goal) + 3,
      });
    }
    if (this.setup.mode.kind === "defense") {
      for (const objective of this.state.objectives) {
        if (
          objective.unlocked &&
          (objective.attackerFactionId === group.factionId ||
            objective.defenderFactionId === group.factionId)
        ) {
          points.push({
            cell: { ...objective.center },
            targetHeightUnits: heightAt(this.setup.map, objective.center) + 3,
          });
        }
      }
    }
    const unique = new Map<string, (typeof points)[number]>();
    for (const point of points) {
      unique.set(`${point.cell.x},${point.cell.z}`, point);
    }
    return [...unique.values()].sort(
      (a, b) => cellIndex(this.setup.map, a.cell) - cellIndex(this.setup.map, b.cell),
    );
  }

  private flightAltitudeEvaluationReason(
    currentBand: AirAltitudeBand,
    selectedBand: AirAltitudeBand,
    candidates: readonly ReturnType<typeof scoreFlightAltitudeCandidates>[number][],
  ): FlightAltitudeEvaluationReason {
    if (currentBand === selectedBand) {
      return "hold-altitude";
    }
    if (altitudeBandIndex(selectedBand) < altitudeBandIndex(currentBand)) {
      return "reduce-exposure";
    }
    const current = candidates.find((candidate) => candidate.altitudeBand === currentBand);
    return current?.routeClear === false ? "terrain-clearance" : "improve-observation";
  }

  private updateFlightAltitudeActions(): void {
    const platforms = [...this.state.platformsById.values()].sort(compareById);
    for (const platform of platforms) {
      const flight = platform.flight;
      const transition = flight?.transition;
      if (!flight || !transition) {
        continue;
      }
      if (!this.canPlatformChangeAltitude(platform)) {
        flight.altitudeBand = transition.fromBand;
        flight.clearanceMm = transition.startClearanceMm;
        flight.transition = undefined;
        if (flight.evaluation) {
          flight.evaluation = {
            ...flight.evaluation,
            reason: "capability-unavailable",
          };
        }
        continue;
      }
      transition.ticksRemaining = Math.max(0, transition.ticksRemaining - 1);
      flight.clearanceMm = flightTransitionClearanceMm(
        transition.startClearanceMm,
        transition.targetClearanceMm,
        transition.totalTicks,
        transition.ticksRemaining,
        this.setup.map.heightUnitMm,
      );
      if (transition.ticksRemaining === 0) {
        flight.altitudeBand = transition.toBand;
        flight.clearanceMm = transition.targetClearanceMm;
        flight.transition = undefined;
      }
    }

    for (const platform of platforms) {
      const flight = platform.flight;
      const evaluation = flight?.evaluation;
      if (
        !flight ||
        flight.transition ||
        !evaluation ||
        evaluation.selectedAltitudeBand === flight.altitudeBand
      ) {
        continue;
      }
      if (!this.canPlatformChangeAltitude(platform)) {
        flight.evaluation = { ...evaluation, reason: "capability-unavailable" };
        continue;
      }
      const group = this.state.groupsById.get(platform.groupId);
      const template = getPlatformTemplate(this.setup.content, platform.platformTemplateId);
      const targetClearanceMm =
        template.flightRule?.clearanceMmByBand[evaluation.selectedAltitudeBand];
      if (!group || targetClearanceMm === undefined) {
        continue;
      }
      if (!this.canOccupyFlightAltitudeBand(group, evaluation.selectedAltitudeBand)) {
        flight.evaluation = { ...evaluation, reason: "target-band-occupied" };
        continue;
      }
      const totalTicks = altitudeTransitionTicks(
        flight.altitudeBand,
        evaluation.selectedAltitudeBand,
      );
      if (totalTicks <= 0) {
        continue;
      }
      this.cancelMovement(group);
      flight.transition = {
        fromBand: flight.altitudeBand,
        toBand: evaluation.selectedAltitudeBand,
        startedAt: this.state.tick,
        totalTicks,
        ticksRemaining: totalTicks,
        startClearanceMm: flight.clearanceMm,
        targetClearanceMm,
      };
    }
  }

  private canPlatformChangeAltitude(platform: PlatformState): boolean {
    return (
      platform.disposition === "crewed" &&
      this.platformCapabilities(platform).mobility.available &&
      getPlatformTemplate(this.setup.content, platform.platformTemplateId).flightRule !== undefined
    );
  }

  private decideForGroup(group: GroupState): void {
    if (activeMemberCount(group) === 0) {
      this.cancelMovement(group);
      this.releaseCover(group);
      const groupIndex = cellIndex(this.setup.map, group.cell);
      if (this.state.occupancy.get(groupIndex) === group.id) {
        this.state.occupancy.delete(groupIndex);
      }
      group.action = hasEvacuatedMembers(group) ? "evacuated" : "combat-ineffective";
      group.decisionReason = "no-active-members";
      group.goal = undefined;
      group.path = [];
      group.currentTargetId = undefined;
      group.coverDecision = undefined;
      return;
    }
    if (this.decideTransportForGroup(group)) {
      return;
    }
    const crewedPlatform = this.activeTargetPlatform(group);
    const abandonedVehicleGroup = !crewedPlatform && group.platforms.length > 0;
    if (abandonedVehicleGroup) {
      group.action = "routing";
      group.decisionReason = "platform-abandoned";
      group.currentTargetId = this.chooseDirectTarget(group)?.id;
      group.coverDecision = undefined;
      this.assignGoal(group, group.evacuation);
      return;
    }
    if (
      crewedPlatform?.combat === "ineffective" &&
      crewedPlatform.crewReassignments.length === 0 &&
      !this.isUnarmedObservationPlatform(crewedPlatform)
    ) {
      if (crewedPlatform.mobility === "immobilized") {
        this.abandonPlatform(crewedPlatform);
      }
      group.action = "routing";
      group.decisionReason = crewedPlatform.mobility === "mobile"
        ? "platform-combat-ineffective"
        : "platform-abandoned";
      group.currentTargetId = undefined;
      group.coverDecision = undefined;
      this.assignGoal(group, group.evacuation);
      return;
    }
    if (group.moraleState === "routing") {
      group.action = "routing";
      group.decisionReason = "low-morale";
      group.currentTargetId = this.chooseDirectTarget(group)?.id;
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
      const activePlatform = this.activeTargetPlatform(group);
      if (activePlatform?.combat === "effective") {
        if (this.shouldHoldIndirectFirePosition(group, directTarget, activePlatform)) {
          this.cancelMovement(group);
          group.action = "engaging";
          group.decisionReason = "ARTILLERY_HOLD_INDIRECT_RANGE";
          group.currentTargetId = directTarget.id;
          group.goal = undefined;
          group.path = [];
          group.vehicleEngagement = undefined;
          return;
        }
        if (this.decideVehicleEngagement(group, directTarget)) {
          return;
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
      if (
        isAttacker &&
        objective &&
        !isInsideObjective(group.cell, objective) &&
        this.groupCapturePower(group) > 0
      ) {
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

  private decideTransportForGroup(group: GroupState): boolean {
    const passengerAssignment = this.state.transportByPassengerGroupId.get(group.id);
    if (passengerAssignment) {
      const platform = this.state.platformsById.get(passengerAssignment.platformId);
      if (!platform) {
        return false;
      }
      if (passengerAssignment.status !== "dismounted") {
        this.cancelMovement(group);
        group.currentTargetId = undefined;
        group.goal = undefined;
        group.path = [];
        group.action =
          passengerAssignment.status === "trapped"
            ? "combat-ineffective"
            : "searching";
        group.decisionReason = `transport-${passengerAssignment.status}`;
        return true;
      }
      if (this.shouldEmbarkTransport(passengerAssignment, group, platform)) {
        group.currentTargetId = undefined;
        const rendezvous = selectTransportAdjacentCell(
          this.setup.map,
          platform.cell,
          this.transportCellOccupancy(),
          group.id,
        );
        if (!rendezvous || areTransportCellsAdjacent(group.cell, platform.cell)) {
          this.cancelMovement(group);
          group.action = "searching";
          group.decisionReason = "transport-rendezvous";
          group.goal = undefined;
          group.path = [];
        } else {
          group.action = "moving-to-contact";
          group.decisionReason = "transport-rendezvous";
          this.assignGoal(group, rendezvous);
        }
        return true;
      }
    }

    const platformAssignments = group.platforms.flatMap(
      (platform) => this.state.transportAssignmentsByPlatformId.get(platform.id) ?? [],
    );
    const activeAction = platformAssignments.find(
      (assignment) =>
        assignment.status === "embarking" || assignment.status === "disembarking",
    );
    const rendezvous = platformAssignments.find((assignment) => {
      if (assignment.status !== "dismounted") {
        return false;
      }
      const passengerGroup = this.state.groupsById.get(assignment.passengerGroupId);
      const platform = this.state.platformsById.get(assignment.platformId);
      return Boolean(
        passengerGroup &&
          platform &&
          this.shouldEmbarkTransport(assignment, passengerGroup, platform),
      );
    });
    if (!activeAction && !rendezvous) {
      return false;
    }
    this.cancelMovement(group);
    group.currentTargetId = undefined;
    group.goal = undefined;
    group.path = [];
    group.action = "searching";
    group.decisionReason = activeAction
      ? `transport-${activeAction.status}`
      : "transport-rendezvous";
    return true;
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
    const targetsById = new Map<GroupId, GroupState>();
    const candidateInputs: TargetCandidateScoreInput[] = [];
    for (const contact of sortedContacts(group.localContacts)) {
      if (this.state.tick - contact.lastDirectTick > DIRECT_CONTACT_FRESH_TICKS) {
        continue;
      }
      const target = this.state.groupsById.get(contact.targetGroupId);
      if (
        !target ||
        activeMemberCount(target) === 0 ||
        !isGroupSpatiallyActive(target) ||
        !this.isHostile(group.factionId, target.factionId)
      ) {
        continue;
      }
      const observedContact: ContactState = {
        ...contact,
        targetFactionId: contact.targetFactionId ?? target.factionId,
        targetProfile: contact.targetProfile ?? this.targetProfileForGroup(target),
        targetDomain: contact.targetDomain ?? this.targetDomainForGroup(target),
        targetFlight: contact.targetFlight ?? this.flightForGroup(target),
        lastKnown: { ...target.cell },
      };
      targetsById.set(target.id, target);
      candidateInputs.push(
        this.targetCandidateScoreInput(group, observedContact, "direct-contact"),
      );
    }
    const selectedTargetId = this.recordTargetEvaluation(group, candidateInputs);
    return selectedTargetId ? targetsById.get(selectedTargetId) : undefined;
  }

  private chooseBestKnownContact(group: GroupState): ContactState | undefined {
    const merged = new Map<
      GroupId,
      { readonly contact: ContactState; readonly source: "local-contact" | "shared-contact" }
    >();
    const factionContacts = this.state.factionKnowledge.get(group.factionId)?.contacts;
    for (const contact of factionContacts?.values() ?? []) {
      merged.set(contact.targetGroupId, { contact, source: "shared-contact" });
    }
    for (const contact of group.localContacts.values()) {
      const known = merged.get(contact.targetGroupId)?.contact;
      if (!known || contact.observedAt >= known.observedAt) {
        merged.set(contact.targetGroupId, { contact, source: "local-contact" });
      }
    }
    const candidates = [...merged.values()].filter(
      ({ contact }) =>
        contact.confidenceBps > 0 &&
        contact.observedAt > (group.searchedContacts.get(contact.targetGroupId) ?? -1) &&
        this.isHostile(group.factionId, contact.targetFactionId),
    );
    const selectedTargetId = this.recordTargetEvaluation(
      group,
      candidates.map(({ contact, source }) =>
        this.targetCandidateScoreInput(group, contact, source),
      ),
    );
    return selectedTargetId ? merged.get(selectedTargetId)?.contact : undefined;
  }

  private targetCandidateScoreInput(
    group: GroupState,
    contact: ContactState,
    source: "direct-contact" | "local-contact" | "shared-contact",
  ): TargetCandidateScoreInput {
    return {
      targetGroupId: contact.targetGroupId,
      targetProfile: contact.targetProfile,
      targetDomain: contact.targetDomain,
      lastKnown: { ...contact.lastKnown },
      observedAt: contact.observedAt,
      confidenceBps: contact.confidenceBps,
      source,
      distanceSquared: squaredGridDistance(group.cell, contact.lastKnown),
      effectivenessBps: this.groupTargetEffectivenessBps(
        group,
        contact.targetProfile,
        contact.targetDomain,
      ),
      taskRelevanceBps: this.targetTaskRelevanceBps(group, contact.lastKnown),
      retained: group.currentTargetId === contact.targetGroupId,
    };
  }

  private recordTargetEvaluation(
    group: GroupState,
    candidateInputs: readonly TargetCandidateScoreInput[],
  ): GroupId | undefined {
    const candidates = scoreTargetCandidates(candidateInputs, this.state.tick);
    const selectedTargetId = candidates.find((candidate) => candidate.compatible)?.targetGroupId;
    group.targetEvaluation = {
      evaluatedAt: this.state.tick,
      selectedTargetId,
      candidates,
    };
    return selectedTargetId;
  }

  private groupTargetEffectivenessBps(
    group: GroupState,
    targetProfile: TargetProfile,
    targetDomain: WeaponTargetDomain,
  ): number {
    let effectivenessBps = 0;
    for (const member of group.members) {
      if (!canMemberFight(member) || member.placement.kind !== "dismounted") {
        continue;
      }
      effectivenessBps += weaponTargetEffectivenessBps(
        this.weaponForMember(member),
        targetProfile,
        targetDomain,
      );
    }
    for (const platform of group.platforms) {
      if (platform.disposition !== "crewed") {
        continue;
      }
      const capabilities = this.platformCapabilities(platform);
      for (const weaponState of platform.weaponStates) {
        const available = capabilities.weapons.find(
          (capability) => capability.componentId === weaponState.componentId,
        )?.available;
        if (!available || !this.platformWeaponOperator(platform, weaponState.componentId)) {
          continue;
        }
        effectivenessBps += weaponTargetEffectivenessBps(
          getWeaponTemplate(this.setup.content, weaponState.weaponTemplateId),
          targetProfile,
          targetDomain,
        );
      }
    }
    return Math.min(40_000, effectivenessBps);
  }

  private targetTaskRelevanceBps(group: GroupState, targetCell: GridCoord): number {
    if (this.setup.mode.kind !== "defense") {
      return 0;
    }
    const objectives = this.state.objectives
      .filter(
        (objective) =>
          objective.unlocked &&
          (objective.attackerFactionId === group.factionId ||
            objective.defenderFactionId === group.factionId),
      )
      .sort((a, b) => {
        if (a.id === group.assignedObjectiveId) {
          return -1;
        }
        if (b.id === group.assignedObjectiveId) {
          return 1;
        }
        return compareStrings(a.id, b.id);
      });
    const objective = objectives[0];
    if (!objective) {
      return 0;
    }
    const relevanceRadius = objective.radiusCells + 8;
    const relevanceRadiusSquared = relevanceRadius ** 2;
    const distanceSquared = squaredGridDistance(targetCell, objective.center);
    return distanceSquared >= relevanceRadiusSquared
      ? 0
      : Math.floor(
          ((relevanceRadiusSquared - distanceSquared) * 10_000) /
            relevanceRadiusSquared,
        );
  }

  private targetProfileForGroup(group: GroupState): TargetProfile {
    return this.activeTargetPlatform(group) ? "platform" : "personnel";
  }

  private isUnarmedObservationPlatform(platform: PlatformState): boolean {
    return (
      isAirMovementType(platform.movementType) &&
      platform.weaponStates.length === 0 &&
      this.platformCapabilities(platform).observation.available
    );
  }

  private targetDomainForGroup(group: GroupState): WeaponTargetDomain {
    return isAirMovementType(group.movementType) ? "air" : "ground";
  }

  private flightForGroup(group: GroupState) {
    const platform = group.platforms.find(
      (candidate) => candidate.flight && candidate.disposition === "crewed",
    );
    return platform ? this.flightSnapshotForPlatform(platform) : undefined;
  }

  private flightSnapshotForPlatform(
    platform: PlatformState,
  ): PlatformFlightInspection | undefined {
    return platform.flight
      ? {
          altitudeBand: platform.flight.altitudeBand,
          clearanceMm: platform.flight.clearanceMm,
        }
      : undefined;
  }

  private flightControlInspection(
    platform: PlatformState,
  ): PlatformFlightControlInspection | undefined {
    const flight = platform.flight;
    if (!flight) {
      return undefined;
    }
    const transition = flight.transition;
    return {
      action: transition
        ? altitudeBandIndex(transition.toBand) > altitudeBandIndex(transition.fromBand)
          ? "climbing"
          : "descending"
        : "holding",
      targetAltitudeBand: transition?.toBand,
      ticksRemaining: transition?.ticksRemaining ?? 0,
      evaluation: flight.evaluation
        ? {
            ...flight.evaluation,
            candidates: flight.evaluation.candidates.map((candidate) => ({
              ...candidate,
              components: { ...candidate.components },
            })),
          }
        : undefined,
    };
  }

  private groupSightHeightUnits(
    group: GroupState,
    cell: GridCoord = group.cell,
    groundOffset = 4,
  ): number {
    const flight = this.flightForGroup(group);
    return flight
      ? flightHeightUnits(this.setup.map, cell, flight)
      : heightAt(this.setup.map, cell) + groundOffset;
  }

  private decideVehicleEngagement(group: GroupState, target: GroupState): boolean {
    const platform = this.activeTargetPlatform(group);
    if (!platform || platform.combat !== "effective" || platform.mobility !== "mobile") {
      return false;
    }
    if (this.hasInFlightVehicleEngagementPlan(group)) {
      return true;
    }
    const option = this.findVehicleEngagementOption(group, target, platform);
    if (!option) {
      this.recordVehicleEngagement(group, target.id, "no-firing-position");
      return false;
    }

    if (!sameCoord(option.cell, group.cell)) {
      this.cancelMovement(group);
      group.action = "moving-to-contact";
      group.decisionReason = "vehicle-engagement-position";
      group.currentTargetId = target.id;
      group.goal = { ...option.cell };
      group.pathGoal = { ...option.cell };
      group.path = option.path.map((coord) => ({ ...coord }));
      group.waitAge = 0;
      this.recordVehicleEngagement(
        group,
        target.id,
        "move-to-firing-position",
        option,
      );
      return true;
    }

    if (platform.facing !== option.desiredFacing) {
      if (group.turnGoalFacing !== option.desiredFacing) {
        this.cancelMovement(group);
        group.turnGoalFacing = option.desiredFacing;
        const template = getPlatformTemplate(
          this.setup.content,
          platform.platformTemplateId,
        );
        group.turnTicksRemaining =
          shortestFacingSteps(platform.facing, option.desiredFacing) *
          template.turnTicksPer45Degrees;
        if (group.turnTicksRemaining === 0) {
          this.applyFacing(group, option.desiredFacing);
          group.turnGoalFacing = undefined;
        }
      }
      if (platform.facing !== option.desiredFacing) {
        group.action = "moving-to-contact";
        group.decisionReason = "orient-armor";
        group.currentTargetId = target.id;
        group.goal = undefined;
        group.path = [];
        this.recordVehicleEngagement(group, target.id, "orient-armor", option);
        return true;
      }
    }

    this.cancelMovement(group);
    group.action = "engaging";
    group.decisionReason = "preferred-range";
    group.currentTargetId = target.id;
    group.goal = undefined;
    group.path = [];
    this.recordVehicleEngagement(group, target.id, "hold-firing-position", option);
    return true;
  }

  private shouldHoldIndirectFirePosition(
    group: GroupState,
    target: GroupState,
    platform: PlatformState,
  ): boolean {
    if (this.hasCurrentArtillerySelfDefenseContact(group)) {
      return false;
    }
    const targetProfile = this.targetProfileForGroup(target);
    const targetDomain = this.targetDomainForGroup(target);
    const directRange = this.groupTargetRangeBand(group, targetProfile, targetDomain);
    const distanceSquared = squaredGridDistance(group.cell, target.cell);
    if (
      directRange &&
      distanceSquared >= directRange.minimum ** 2 &&
      distanceSquared <= directRange.maximum ** 2
    ) {
      return false;
    }
    const distanceSquaredMm = this.gridDistanceSquaredMm(platform.cell, target.cell);
    return this.indirectWeaponConfigurations(platform).some(
      ({ weapon, fireMode, available }) =>
        available &&
        weaponTargetEffectivenessBps(weapon, targetProfile, targetDomain) > 0 &&
        distanceSquaredMm >= fireMode.minimumRangeMm ** 2 &&
        distanceSquaredMm <= fireMode.maximumRangeMm ** 2,
    );
  }

  private hasInFlightVehicleEngagementPlan(group: GroupState): boolean {
    const engagement = group.vehicleEngagement;
    if (!engagement) {
      return false;
    }
    if (
      group.decisionReason === "vehicle-engagement-position" &&
      engagement.reason === "move-to-firing-position"
    ) {
      return group.movingTo !== undefined || group.turnGoalFacing !== undefined;
    }
    return (
      group.decisionReason === "orient-armor" &&
      engagement.reason === "orient-armor" &&
      group.turnGoalFacing !== undefined
    );
  }

  private findVehicleEngagementOption(
    group: GroupState,
    target: GroupState,
    platform: PlatformState,
  ): VehicleEngagementOption | undefined {
    const targetProfile = this.targetProfileForGroup(target);
    const targetDomain = this.targetDomainForGroup(target);
    const rangeBand = this.groupTargetRangeBand(group, targetProfile, targetDomain);
    if (!rangeBand) {
      return undefined;
    }
    const blocked = this.getStationaryFriendlyBlockedCellIndices(group);
    const pathStart = group.cell;
    const searchRadius = 6;
    const isLegalFiringCell = (candidate: GridCoord): boolean => {
      const candidateIndex = cellIndex(this.setup.map, candidate);
      const occupyingGroupId = this.state.occupancy.get(candidateIndex);
      const occupyingPlatformId = this.state.staticPlatformOccupancy.get(candidateIndex);
      const reservingGroupId = this.state.reservations.get(candidateIndex);
      const rangeCells = Math.max(
        Math.abs(candidate.x - target.cell.x),
        Math.abs(candidate.z - target.cell.z),
      );
      return (
        isWalkable(this.setup.map, candidate, group.movementType) &&
        (occupyingGroupId === undefined || occupyingGroupId === group.id) &&
        (occupyingPlatformId === undefined || occupyingPlatformId === platform.id) &&
        (reservingGroupId === undefined || reservingGroupId === group.id) &&
        rangeCells >= rangeBand.minimum &&
        rangeCells <= rangeBand.maximum &&
        hasLineOfSight(this.setup.map, candidate, target.cell) &&
        !this.hasFriendlyBlockerFrom(group, candidate, target)
      );
    };

    if (isLegalFiringCell(group.cell)) {
      const rangeCells = Math.max(
        Math.abs(group.cell.x - target.cell.x),
        Math.abs(group.cell.z - target.cell.z),
      );
      const desiredFacing = facingForStep(group.cell, target.cell);
      const scored = scoreVehicleEngagementPosition({
        rangeCells,
        preferredRangeCells: rangeBand.preferred,
        pathCost: 0,
        facingSteps: shortestFacingSteps(platform.facing, desiredFacing),
        retainedPosition: true,
      });
      return {
        cell: { ...group.cell },
        path: [{ ...group.cell }],
        pathCost: 0,
        desiredFacing,
        score: scored.score,
        components: scored.components,
      };
    }

    const candidates: {
      readonly cell: GridCoord;
      readonly rangeCells: number;
      readonly desiredFacing: StaticObjectFacing;
      readonly estimatedScore: number;
    }[] = [];

    for (let dz = -searchRadius; dz <= searchRadius; dz += 1) {
      for (let dx = -searchRadius; dx <= searchRadius; dx += 1) {
        if (dx === 0 && dz === 0) {
          continue;
        }
        const candidate = { x: group.cell.x + dx, z: group.cell.z + dz };
        const rangeCells = Math.max(
          Math.abs(candidate.x - target.cell.x),
          Math.abs(candidate.z - target.cell.z),
        );
        if (!isLegalFiringCell(candidate)) {
          continue;
        }
        const desiredFacing = facingForStep(candidate, target.cell);
        const estimatedArrivalFacing = facingForStep(group.cell, candidate);
        const estimatedPathCost =
          (Math.max(Math.abs(dx), Math.abs(dz)) + Math.min(Math.abs(dx), Math.abs(dz))) *
          500;
        const estimated = scoreVehicleEngagementPosition({
          rangeCells,
          preferredRangeCells: rangeBand.preferred,
          pathCost: estimatedPathCost,
          facingSteps: shortestFacingSteps(estimatedArrivalFacing, desiredFacing),
          retainedPosition: false,
        });
        candidates.push({
          cell: candidate,
          rangeCells,
          desiredFacing,
          estimatedScore: estimated.score,
        });
      }
    }

    const options: VehicleEngagementOption[] = [];
    for (const candidate of candidates
      .sort(
        (a, b) =>
          b.estimatedScore - a.estimatedScore ||
          cellIndex(this.setup.map, a.cell) - cellIndex(this.setup.map, b.cell),
      )
      .slice(0, VEHICLE_ENGAGEMENT_PATH_CANDIDATE_LIMIT)) {
        const path = this.pathfinderFor(group).findPath(pathStart, candidate.cell, blocked);
        if (path.length === 0) {
          continue;
        }
        const pathCost = pathMovementCost(this.setup.map, path, group.movementType);
        const arrivalFacing = path.length >= 2
          ? facingForStep(path[path.length - 2]!, candidate.cell)
          : platform.facing;
        const scored = scoreVehicleEngagementPosition({
          rangeCells: candidate.rangeCells,
          preferredRangeCells: rangeBand.preferred,
          pathCost,
          facingSteps: shortestFacingSteps(arrivalFacing, candidate.desiredFacing),
          retainedPosition: false,
        });
        options.push({
          cell: candidate.cell,
          path,
          pathCost,
          desiredFacing: candidate.desiredFacing,
          score: scored.score,
          components: scored.components,
        });
    }

    return options.sort(
      (a, b) =>
        b.score - a.score ||
        a.pathCost - b.pathCost ||
        cellIndex(this.setup.map, a.cell) - cellIndex(this.setup.map, b.cell),
    )[0];
  }

  private recordVehicleEngagement(
    group: GroupState,
    targetGroupId: GroupId,
    reason: VehicleEngagementReason,
    option?: VehicleEngagementOption,
  ): void {
    group.vehicleEngagement = {
      targetGroupId,
      reason,
      evaluatedAt: this.state.tick,
      selectedCell: option ? { ...option.cell } : undefined,
      desiredFacing: option?.desiredFacing,
      score: option?.score ?? 0,
      components: option
        ? { ...option.components }
        : { range: 0, route: 0, facing: 0, retention: 0 },
    };
  }

  private groupTargetRangeBand(
    group: GroupState,
    targetProfile: TargetProfile,
    targetDomain: WeaponTargetDomain,
  ): { readonly minimum: number; readonly preferred: number; readonly maximum: number } | undefined {
    const weapons: ReturnType<typeof getWeaponTemplate>[] = [];
    for (const member of group.members) {
      if (!canMemberFight(member) || member.placement.kind !== "dismounted") {
        continue;
      }
      const weapon = this.weaponForMember(member);
      if (weaponTargetEffectivenessBps(weapon, targetProfile, targetDomain) > 0) {
        weapons.push(weapon);
      }
    }
    for (const platform of group.platforms) {
      if (platform.disposition !== "crewed") {
        continue;
      }
      const capabilities = this.platformCapabilities(platform);
      for (const weaponState of platform.weaponStates) {
        const available = capabilities.weapons.find(
          (capability) => capability.componentId === weaponState.componentId,
        )?.available;
        const weapon = getWeaponTemplate(this.setup.content, weaponState.weaponTemplateId);
        if (
          available &&
          this.platformWeaponOperator(platform, weaponState.componentId) &&
          weaponTargetEffectivenessBps(weapon, targetProfile, targetDomain) > 0
        ) {
          weapons.push(weapon);
        }
      }
    }
    if (weapons.length === 0) {
      return undefined;
    }
    return {
      minimum: Math.min(...weapons.map((weapon) => this.weaponMinimumRangeCells(weapon))),
      preferred: Math.min(
        this.setup.rules.preferredRangeCells,
        Math.max(...weapons.map((weapon) => this.weaponPreferredRangeCells(weapon))),
      ),
      maximum: Math.min(
        this.setup.rules.weaponRangeCells,
        Math.max(...weapons.map((weapon) => this.weaponRangeCells(weapon))),
      ),
    };
  }

  private markContactSearched(group: GroupState, contact: ContactState): void {
    group.searchedContacts.set(contact.targetGroupId, contact.observedAt);
    const local = group.localContacts.get(contact.targetGroupId);
    if (local && local.observedAt <= contact.observedAt) {
      group.localContacts.delete(contact.targetGroupId);
    }
  }

  private assignGoal(group: GroupState, desiredGoal: GridCoord): void {
    const terrainGoal = this.findNearestWalkable(
      desiredGoal,
      group.cell,
      group.movementType,
    );
    const blocked = this.staticPlatformBlockedCellIndices(group);
    const terrainGoalBlocked = blocked.has(cellIndex(this.setup.map, terrainGoal));
    const terrainGoalChanged = !group.goal || !sameCoord(group.goal, terrainGoal);
    if (!terrainGoalChanged && group.path.length > 0 && !terrainGoalBlocked) {
      group.goal = terrainGoal;
      return;
    }
    const { goal, path } = terrainGoalBlocked
      ? this.findReachableGoalPath(group, terrainGoal, blocked)
      : {
          goal: terrainGoal,
          path: this.pathfinderFor(group).findPath(
            group.movingTo ?? group.cell,
            terrainGoal,
            blocked,
          ),
        };
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
    group.path = path.map((coord) => ({ ...coord }));
  }

  private findReachableGoalPath(
    group: GroupState,
    terrainGoal: GridCoord,
    blocked: ReadonlySet<number>,
  ): { readonly goal: GridCoord; readonly path: readonly GridCoord[] } {
    const pathStart = group.movingTo ?? group.cell;
    const pathfinder = this.pathfinderFor(group);
    const componentIds = this.walkableComponentIds.get(group.movementType)!;
    const reachableComponent =
      componentIds[cellIndex(this.setup.map, group.cell)] ?? -1;
    const maximumRadius = Math.max(this.setup.map.width, this.setup.map.height);
    for (let radius = 1; radius < maximumRadius; radius += 1) {
      const options: {
        readonly goal: GridCoord;
        readonly path: readonly GridCoord[];
        readonly distanceSquared: number;
        readonly cost: number;
      }[] = [];
      for (let dz = -radius; dz <= radius; dz += 1) {
        for (let dx = -radius; dx <= radius; dx += 1) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== radius) {
            continue;
          }
          const candidate = { x: terrainGoal.x + dx, z: terrainGoal.z + dz };
          const candidateIndex = cellIndex(this.setup.map, candidate);
          const occupyingGroupId = this.state.occupancy.get(candidateIndex);
          const reservingGroupId = this.state.reservations.get(candidateIndex);
          if (
            !isWalkable(this.setup.map, candidate, group.movementType) ||
            componentIds[candidateIndex] !== reachableComponent ||
            blocked.has(candidateIndex) ||
            (occupyingGroupId !== undefined && occupyingGroupId !== group.id) ||
            (reservingGroupId !== undefined && reservingGroupId !== group.id)
          ) {
            continue;
          }
          const path = sameCoord(pathStart, candidate)
            ? [{ ...candidate }]
            : pathfinder.findPath(pathStart, candidate, blocked);
          if (path.length === 0) {
            continue;
          }
          options.push({
            goal: candidate,
            path,
            distanceSquared: squaredGridDistance(candidate, terrainGoal),
            cost: path.length === 1
              ? 0
              : pathMovementCost(this.setup.map, path, group.movementType),
          });
        }
      }
      const best = options.sort(
        (a, b) =>
          a.distanceSquared - b.distanceSquared ||
          a.cost - b.cost ||
          cellIndex(this.setup.map, a.goal) - cellIndex(this.setup.map, b.goal),
      )[0];
      if (best) {
        return { goal: best.goal, path: best.path };
      }
    }

    return { goal: terrainGoal, path: [] };
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
    if (isAirMovementType(group.movementType)) {
      return new Set();
    }
    const blocked = new Set<number>();
    for (const [index, groupId] of this.state.occupancy) {
      if (this.isStationaryFriendlyBlocker(group, groupId)) {
        blocked.add(index);
      }
    }
    for (const index of this.staticPlatformBlockedCellIndices(group)) {
      blocked.add(index);
    }
    return blocked;
  }

  private staticPlatformBlockedCellIndices(group: GroupState): ReadonlySet<number> {
    const currentIndex = cellIndex(this.setup.map, group.cell);
    return new Set(
      [...this.state.staticPlatformOccupancy.keys()].filter(
        (index) => index !== currentIndex,
      ),
    );
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
            !this.state.staticPlatformOccupancy.has(cellIndex(this.setup.map, candidate)) &&
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
          const occupyingPlatformId = this.state.staticPlatformOccupancy.get(candidateIndex);
          const reservingGroupId = this.state.reservations.get(candidateIndex);
          if (
            !isWalkable(this.setup.map, candidate, group.movementType) ||
            (occupyingGroupId !== undefined && occupyingGroupId !== group.id) ||
            occupyingPlatformId !== undefined ||
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
          !this.state.staticPlatformOccupancy.has(cellIndex(this.setup.map, candidate)) &&
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
      if (
        group.platforms.some((platform) => platform.flight?.transition) ||
        group.platforms.some(
          (platform) =>
            platform.disposition === "crewed" &&
            platform.deployment !== undefined &&
            platform.deployment.state !== "packed",
        )
      ) {
        continue;
      }
      if (!group.movingTo && group.turnGoalFacing !== undefined) {
        const platform = this.activeTargetPlatform(group);
        if (!platform || platform.mobility !== "mobile") {
          group.turnGoalFacing = undefined;
          group.turnTicksRemaining = 0;
          continue;
        }
        if (group.turnTicksRemaining > 0) {
          group.turnTicksRemaining -= 1;
        }
        if (group.turnTicksRemaining === 0) {
          this.applyFacing(group, group.turnGoalFacing);
          group.turnGoalFacing = undefined;
        }
        continue;
      }
      if (!group.movingTo) {
        continue;
      }
      if (
        group.platforms.some(
          (platform) => platform.disposition === "crewed" && platform.mobility !== "mobile",
        )
      ) {
        continue;
      }
      if (group.turnTicksRemaining > 0) {
        group.turnTicksRemaining -= 1;
        if (group.turnTicksRemaining === 0) {
          this.applyMovementFacing(group, group.movingTo);
          group.turnGoalFacing = undefined;
        }
        continue;
      }
      const baseMovePoints =
        group.action === "routing" ? ROUTING_MOVE_POINTS_PER_TICK : MOVE_POINTS_PER_TICK;
      const movementPlatform = this.activeTargetPlatform(group);
      const movementEfficiencyBps = movementPlatform
        ? this.platformCapabilities(movementPlatform).mobility.efficiencyBps
        : 10_000;
      group.moveProgress += Math.floor(
        (baseMovePoints * movementEfficiencyBps) / 10_000,
      );
      if (group.moveProgress < group.moveCost) {
        continue;
      }
      const oldIndex = cellIndex(this.setup.map, group.cell);
      const destinationIndex = cellIndex(this.setup.map, group.movingTo);
      const airborne = isAirMovementType(group.movementType);
      if (airborne) {
        this.state.airspaceReservations.delete(group.id);
      } else {
        this.releaseCover(group);
        this.state.occupancy.delete(oldIndex);
        this.state.reservations.delete(destinationIndex);
      }
      if (!movementPlatform) {
        group.headingRadians = Math.atan2(
          group.movingTo.x - group.cell.x,
          group.movingTo.z - group.cell.z,
        );
      }
      group.cell = group.movingTo;
      for (const platform of group.platforms) {
        if (platform.disposition === "crewed") {
          platform.cell = { ...group.cell };
          for (const passengerGroupId of platform.passengerGroupIds) {
            const passengerGroup = this.state.groupsById.get(passengerGroupId);
            if (passengerGroup) {
              passengerGroup.cell = { ...platform.cell };
            }
          }
        }
      }
      group.movingTo = undefined;
      group.moveProgress = 0;
      group.moveCost = 0;
      if (!airborne) {
        this.state.occupancy.set(destinationIndex, group.id);
        this.claimCover(group);
      }
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
          (platform) => platform.disposition === "crewed" && platform.mobility !== "mobile",
        ) ||
        group.platforms.some(
          (platform) =>
            platform.disposition === "crewed" &&
            platform.deployment !== undefined &&
            platform.deployment.state !== "packed",
        ) ||
        group.platforms.some((platform) => platform.flight?.transition) ||
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
      const flight = group.platforms.find(
        (platform) => platform.flight && platform.disposition === "crewed",
      )?.flight;
      if (
        flight &&
        !flightStepHasTerrainClearance(
          this.setup.map,
          group.cell,
          destination,
          flight.clearanceMm,
        )
      ) {
        group.waitAge += 1;
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
      if (isAirMovementType(proposal.group.movementType)) {
        if (!this.canReserveAirspace(proposal.group, proposal.destination)) {
          proposal.group.waitAge += 1;
          continue;
        }
        this.startMovementProposal(proposal);
        this.state.airspaceReservations.set(proposal.group.id, {
          ...proposal.destination,
        });
        continue;
      }
      const occupyingGroupId = this.state.occupancy.get(destinationIndex);
      const reservingGroupId = this.state.reservations.get(destinationIndex);
      const occupyingPlatformId = this.state.staticPlatformOccupancy.get(destinationIndex);
      if (occupyingGroupId || reservingGroupId || occupyingPlatformId) {
        proposal.group.waitAge += 1;
        if (
          shouldRetryMovementPath(proposal.group.waitAge) &&
          (this.isStationaryFriendlyBlocker(proposal.group, occupyingGroupId) ||
            occupyingPlatformId !== undefined)
        ) {
          this.tryRepathAroundFriendlyGroups(proposal.group);
        }
        continue;
      }
      this.startMovementProposal(proposal);
      this.state.reservations.set(destinationIndex, proposal.group.id);
    }
  }

  private startMovementProposal(proposal: MovementProposal): void {
    proposal.group.movingTo = { ...proposal.destination };
    proposal.group.moveProgress = 0;
    proposal.group.moveCost = movementStepCost(
      this.setup.map,
      proposal.group.cell,
      proposal.destination,
      proposal.group.movementType,
    );
    const platform = this.activeTargetPlatform(proposal.group);
    if (platform) {
      const desiredFacing = facingForStep(proposal.group.cell, proposal.destination);
      const turnSteps = shortestFacingSteps(platform.facing, desiredFacing);
      const template = getPlatformTemplate(
        this.setup.content,
        platform.platformTemplateId,
      );
      proposal.group.turnTicksRemaining = turnSteps * template.turnTicksPer45Degrees;
      proposal.group.turnGoalFacing = desiredFacing;
      if (proposal.group.turnTicksRemaining === 0) {
        this.applyMovementFacing(proposal.group, proposal.destination);
        proposal.group.turnGoalFacing = undefined;
      }
    }
    proposal.group.waitAge = 0;
  }

  private createLogicalProjectile(
    group: GroupState,
    shooterEntityId: string,
    sourcePlatformId: string | undefined,
    origin: GridCoord,
    weapon: WeaponTemplate,
    fireMode: Extract<WeaponFireModeDefinition, { trajectory: "logical-projectile" }>,
    intendedAimCell: GridCoord,
    plannedImpactCell: GridCoord,
    shotOrdinal: number,
  ): LogicalProjectileState {
    const totalFlightTicks = projectileFlightTicks(
      origin,
      plannedImpactCell,
      this.setup.map.cellSizeMm,
      fireMode.projectileSpeedMmPerTick,
    );
    return {
      id: `${shooterEntityId}:projectile:${this.state.tick}:${shotOrdinal}`,
      sourceFactionId: group.factionId,
      sourceGroupId: group.id,
      sourcePlatformId,
      weaponTemplateId: weapon.id,
      fireModeId: fireMode.id,
      launchedAt: this.state.tick,
      scheduledGroundImpactAt: this.state.tick + totalFlightTicks,
      origin: { ...origin },
      intendedAimCell: { ...intendedAimCell },
      plannedImpactCell: { ...plannedImpactCell },
      totalFlightTicks,
      flightTicksElapsed: 0,
      muzzleHeightMm: fireMode.muzzleHeightMm,
      apexHeightMm: fireMode.apexHeightMm,
      blastRadiusMm: fireMode.blastRadiusMm,
      visualTypeId: fireMode.visualTypeId,
      damageEffects: weapon.damageEffects.map((effect) =>
        effect.kind === "platform-damage"
          ? { ...effect, attackTags: [...effect.attackTags] }
          : { ...effect },
      ),
      suppressionBps: weapon.suppressionBps,
    };
  }

  private releaseReadyArtilleryMission(
    group: GroupState,
    platform: PlatformState,
    shotCounts: Map<string, number>,
    projectileIdsByShotKey: Map<string, string[]>,
    fireModeIdByShotKey: Map<string, string>,
  ): boolean {
    const mission = platform.fireMission;
    if (!mission || mission.status !== "ready") {
      return false;
    }
    const configuration = this.indirectWeaponConfigurations(platform).find(
      (candidate) =>
        candidate.weaponState.componentId === mission.weaponComponentId &&
        candidate.fireMode.id === mission.fireModeId,
    );
    if (!configuration?.available) {
      this.cancelArtilleryMission(platform, "capability-lost");
      return false;
    }
    const { weaponState, weapon, fireMode } = configuration;
    if (
      fireMode.requiresDeployedPlatform &&
      platform.deployment?.state !== "deployed"
    ) {
      return false;
    }
    if (
      !this.isHostile(group.factionId, mission.snapshot.targetFactionId) ||
      this.state.tick - mission.snapshot.observedAt >
        fireMode.uncertainty.maximumContactAgeTicks
    ) {
      this.cancelArtilleryMission(platform, "contact-expired");
      return false;
    }
    if (weaponState.magazineRounds === 0) {
      if (weaponState.reloadTicksRemaining === 0) {
        weaponState.reloadTicksRemaining = weapon.reloadTicks;
      }
      return false;
    }
    if (weaponState.reloadTicksRemaining > 0 || weaponState.shotCooldownTicks > 0) {
      return false;
    }

    const uncertainty = calculateArtilleryUncertainty(
      fireMode.uncertainty,
      mission.snapshot.source,
      this.state.tick,
      mission.snapshot.observedAt,
      mission.snapshot.confidenceBps,
    );
    const scatter = this.selectArtilleryScatter(
      mission.id,
      `${platform.id}:${weaponState.componentId}`,
      mission.snapshot.lastKnown,
      uncertainty.radiusMm,
      mission.assignedAt,
    );
    mission.uncertaintyRadiusMm = uncertainty.radiusMm;
    mission.selectedOffset = { ...scatter.offset };
    mission.plannedImpactCell = { ...scatter.cell };
    if (this.isArtilleryDangerClose(group, scatter.cell, fireMode.blastRadiusMm)) {
      platform.fireMissionEvaluation = {
        evaluatedAt: this.state.tick,
        reason: "ARTILLERY_HOLD_DANGER_CLOSE",
        selectedTargetGroupId: mission.snapshot.targetGroupId,
        candidates: platform.fireMissionEvaluation?.candidates ?? [],
      };
      this.cancelArtilleryMission(platform, "danger-close");
      return false;
    }

    weaponState.magazineRounds -= 1;
    weaponState.shotCooldownTicks = weapon.shotIntervalTicks;
    if (platform.deployment) {
      platform.deployment.indirectRoundsFired += 1;
    }
    mission.status = "released";
    this.emit({
      type: "artillery-mission-changed",
      missionId: mission.id,
      platformId: platform.id,
      groupId: platform.groupId,
      phase: "released",
    });
    const projectile = this.createLogicalProjectile(
      group,
      `${platform.id}:${weaponState.componentId}`,
      platform.id,
      platform.cell,
      weapon,
      fireMode,
      mission.snapshot.lastKnown,
      scatter.cell,
      0,
    );
    this.state.projectiles.push(projectile);
    const shotKey = `${group.id}\u0000${mission.snapshot.targetGroupId}`;
    shotCounts.set(shotKey, (shotCounts.get(shotKey) ?? 0) + 1);
    projectileIdsByShotKey.set(shotKey, [
      ...(projectileIdsByShotKey.get(shotKey) ?? []),
      projectile.id,
    ]);
    fireModeIdByShotKey.set(shotKey, fireMode.id);
    group.lastFiredTick = this.state.tick;
    return true;
  }

  private advanceLogicalProjectiles(): ProjectileImpactIntent[] {
    const impacts: ProjectileImpactIntent[] = [];
    const remaining: LogicalProjectileState[] = [];
    for (const projectile of [...this.state.projectiles].sort(compareById)) {
      const previousPosition = projectilePositionAtElapsed(
        this.setup.map,
        projectile.origin,
        projectile.plannedImpactCell,
        projectile.muzzleHeightMm,
        projectile.apexHeightMm,
        projectile.totalFlightTicks,
        projectile.flightTicksElapsed,
      );
      const nextElapsed = Math.min(
        projectile.totalFlightTicks,
        projectile.flightTicksElapsed + 1,
      );
      const nextPosition = projectilePositionAtElapsed(
        this.setup.map,
        projectile.origin,
        projectile.plannedImpactCell,
        projectile.muzzleHeightMm,
        projectile.apexHeightMm,
        projectile.totalFlightTicks,
        nextElapsed,
      );
      projectile.flightTicksElapsed = nextElapsed;
      const collision = firstProjectileCollision(
        this.setup.map,
        previousPosition,
        nextPosition,
      ) ?? (nextElapsed === projectile.totalFlightTicks
        ? projectile.plannedImpactCell
        : undefined);
      if (collision) {
        impacts.push({ projectile, impactCell: { ...collision } });
      } else {
        remaining.push(projectile);
      }
    }
    this.state.projectiles.splice(0, this.state.projectiles.length, ...remaining);
    return impacts;
  }

  private updateWeapons(
    projectileImpacts: readonly ProjectileImpactIntent[] = [],
    allowFiring = true,
  ): Map<GroupId, SuppressionImpact> {
    const shotIntents: ShotIntent[] = [];
    const shotCounts = new Map<string, number>();
    const projectileIdsByShotKey = new Map<string, string[]>();
    const fireModeIdByShotKey = new Map<string, string>();
    let logicalProjectilesCreated = 0;
    const indirectReleasedPlatformIds = new Set<string>();
    const firingGroups = allowFiring ? this.state.groups : [];
    for (const group of firingGroups) {
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
      for (const platform of [...group.platforms].sort(compareById)) {
        if (
          this.releaseReadyArtilleryMission(
            group,
            platform,
            shotCounts,
            projectileIdsByShotKey,
            fireModeIdByShotKey,
          )
        ) {
          indirectReleasedPlatformIds.add(platform.id);
          logicalProjectilesCreated += 1;
        }
      }
      const advancingAttacker =
        this.setup.mode.kind === "defense" &&
        this.setup.mode.attackerFactionId === group.factionId &&
        group.action === "moving-to-contact";
      const withdrawingDismounted =
        group.action === "routing" && !this.activeTargetPlatform(group);
      if (
        (group.action !== "engaging" && !advancingAttacker && !withdrawingDismounted) ||
        !group.currentTargetId
      ) {
        continue;
      }
      const target = this.state.groupsById.get(group.currentTargetId);
      const targetPlatform = target ? this.activeTargetPlatform(target) : undefined;
      if (
        !target ||
        !this.isHostile(group.factionId, target.factionId) ||
        activeMemberCount(target) === 0 ||
        !isGroupSpatiallyActive(target) ||
        !this.hasFreshDirectContact(group, target)
      ) {
        continue;
      }
      const distanceSquared = squaredGridDistance(group.cell, target.cell);
      const cover = targetPlatform ? undefined : this.getDirectionalCover(target, group.cell);
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

      const shotKey = `${group.id}\u0000${target.id}`;
      let shotOrdinal = 0;
      for (const member of group.members) {
        if (!canMemberFight(member) || member.placement.kind !== "dismounted") {
          continue;
        }
        const weapon = this.weaponForMember(member);
        const fireMode = getPrimaryFireMode(weapon);
        const platformDamage = firstPlatformDamageEffect(weapon);
        if (targetPlatform && !platformDamage) {
          continue;
        }
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
        if (fireMode.trajectory === "logical-projectile") {
          const projectile = this.createLogicalProjectile(
            group,
            member.id,
            undefined,
            group.cell,
            weapon,
            fireMode,
            target.cell,
            target.cell,
            shotOrdinal,
          );
          this.state.projectiles.push(projectile);
          const ids = projectileIdsByShotKey.get(shotKey) ?? [];
          ids.push(projectile.id);
          projectileIdsByShotKey.set(shotKey, ids);
          fireModeIdByShotKey.set(shotKey, fireMode.id);
          logicalProjectilesCreated += 1;
        } else {
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
            platformDamage,
          });
        }
        shotOrdinal += 1;
      }
      for (const platform of group.platforms) {
        if (indirectReleasedPlatformIds.has(platform.id)) {
          continue;
        }
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
          const fireMode = weapon.fireModes.find(
            (candidate) => candidate.targeting === "direct",
          );
          if (!fireMode) {
            continue;
          }
          if (
            fireMode.requiresDeployedPlatform &&
            platform.deployment?.state !== "deployed"
          ) {
            continue;
          }
          const platformDamage = firstPlatformDamageEffect(weapon);
          if (targetPlatform && !platformDamage) {
            continue;
          }
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
          if (platform.deployment) {
            if (fireMode.targeting === "direct") {
              platform.deployment.directRoundsFired += 1;
            } else {
              platform.deployment.indirectRoundsFired += 1;
            }
          }
          const baseHitChance = calculateHitChance(
            group,
            operator.member,
            target,
            this.weaponPreferredRangeCells(weapon),
          );
          const shooterEntityId = `${platform.id}:${weaponState.componentId}`;
          if (fireMode.trajectory === "logical-projectile") {
            const projectile = this.createLogicalProjectile(
              group,
              shooterEntityId,
              platform.id,
              platform.cell,
              weapon,
              fireMode,
              target.cell,
              target.cell,
              shotOrdinal,
            );
            this.state.projectiles.push(projectile);
            const ids = projectileIdsByShotKey.get(shotKey) ?? [];
            ids.push(projectile.id);
            projectileIdsByShotKey.set(shotKey, ids);
            fireModeIdByShotKey.set(shotKey, fireMode.id);
            logicalProjectilesCreated += 1;
          } else {
            shotIntents.push({
              shooterGroupId: group.id,
              shooterEntityId,
              targetGroupId: target.id,
              shotOrdinal,
              hitChanceBps: applyBasisPointReduction(
                Math.floor((baseHitChance * operator.efficiencyBps) / 10_000),
                cover?.effect.protectionBps ?? 0,
              ),
              damageBps: firstEffectAmount(weapon, "damage", 0),
              suppressionBps: weapon.suppressionBps,
              hitSuppressionBps: firstEffectAmount(weapon, "suppression", 0),
              platformDamage,
            });
          }
          shotOrdinal += 1;
        }
      }
      if (shotOrdinal > 0) {
        group.lastFiredTick = this.state.tick;
        shotCounts.set(shotKey, (shotCounts.get(shotKey) ?? 0) + shotOrdinal);
      }
    }

    const hits: HitIntent[] = [];
    const platformHits: PlatformDamageIntent[] = [];
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
      const targetPlatform = this.activeTargetPlatform(target);
      if (targetPlatform) {
        if (shot.platformDamage) {
          platformHits.push(
            this.resolvePlatformDamageIntent(shot, target, targetPlatform),
          );
        }
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
    const projectileImpactEvents = projectileImpacts.map((projectileImpact) => ({
      projectileImpact,
      affectedGroupIds: this.collectProjectileBlast(
        projectileImpact,
        hits,
        platformHits,
        impacts,
      ),
    }));
    for (const hit of platformHits) {
      const impact = impacts.get(hit.targetGroupId) ?? {
        suppressionBps: 0,
        hitSuppressionBps: 0,
      };
      impact.hitSuppressionBps += hit.hitSuppressionBps;
      impacts.set(hit.targetGroupId, impact);
      if (hit.targetCrewMemberId) {
        hits.push({
          shooterGroupId: hit.shooterGroupId,
          shooterEntityId: hit.shooterEntityId,
          targetGroupId: hit.targetGroupId,
          targetMemberId: hit.targetCrewMemberId,
          shotOrdinal: hit.shotOrdinal,
          damageBps: hit.crewDamageBps,
          hitSuppressionBps: 0,
          ...(hit.sourceProjectileId
            ? {
                randomStream: "blast-member-effect" as const,
                randomEntityKey: `${hit.sourceProjectileId}:${hit.targetCrewMemberId}`,
                randomOrdinal: 0,
              }
            : {}),
        });
      }
    }
    for (const [key, shotCount] of [...shotCounts].sort(([a], [b]) => compareStrings(a, b))) {
      const [groupId, targetGroupId] = key.split("\u0000") as [GroupId, GroupId];
      const fireModeId = fireModeIdByShotKey.get(key);
      const projectileIds = projectileIdsByShotKey.get(key)?.slice().sort(compareStrings);
      this.emit({
        type: "weapon-fired",
        groupId,
        targetGroupId,
        shotCount,
        ...(fireModeId ? { fireModeId } : {}),
        ...(projectileIds ? { projectileIds } : {}),
      });
    }
    for (const { projectileImpact, affectedGroupIds } of projectileImpactEvents) {
      const projectile = projectileImpact.projectile;
      this.emit({
        type: "projectile-impacted",
        projectileId: projectile.id,
        sourceGroupId: projectile.sourceGroupId,
        ...(projectile.sourcePlatformId
          ? { sourcePlatformId: projectile.sourcePlatformId }
          : {}),
        impactCell: { ...projectileImpact.impactCell },
        affectedGroupIds,
      });
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

    const damagedPlatformIds = new Set<string>();
    platformHits.sort(
      (a, b) =>
        compareStrings(a.targetPlatformId, b.targetPlatformId) ||
        compareStrings(a.targetComponentId ?? "", b.targetComponentId ?? "") ||
        compareStrings(a.shooterEntityId, b.shooterEntityId) ||
        a.shotOrdinal - b.shotOrdinal,
    );
    for (const hit of platformHits) {
      const platform = this.state.platformsById.get(hit.targetPlatformId);
      if (!platform) {
        continue;
      }
      damagedPlatformIds.add(platform.id);
      this.applyPlatformComponentDamage(platform, hit);
    }
    for (const platformId of [...damagedPlatformIds].sort(compareStrings)) {
      const platform = this.state.platformsById.get(platformId);
      if (!platform) {
        continue;
      }
      this.refreshPlatformState(platform, true);
      if (platform.disposition === "destroyed") {
        this.abandonPlatform(platform);
      }
    }

    if (
      shotIntents.length > 0 ||
      logicalProjectilesCreated > 0 ||
      projectileImpacts.length > 0
    ) {
      this.markMeaningfulProgress();
    }
    return impacts;
  }

  private collectProjectileBlast(
    impactIntent: ProjectileImpactIntent,
    hits: HitIntent[],
    platformHits: PlatformDamageIntent[],
    impacts: Map<GroupId, SuppressionImpact>,
  ): readonly GroupId[] {
    const { projectile, impactCell } = impactIntent;
    const memberDamage = projectile.damageEffects.find(
      (effect): effect is MemberEffectDefinition => effect.kind === "damage",
    );
    const hitSuppression = projectile.damageEffects.find(
      (effect): effect is MemberEffectDefinition => effect.kind === "suppression",
    );
    const platformDamage = projectile.damageEffects.find(
      (effect): effect is PlatformDamageEffectDefinition => effect.kind === "platform-damage",
    );
    const affectedGroupIds: GroupId[] = [];
    const targets = [...this.state.groups].sort(
      (a, b) =>
        cellIndex(this.setup.map, a.cell) - cellIndex(this.setup.map, b.cell) ||
        compareStrings(a.id, b.id),
    );

    for (const target of targets) {
      if (!this.isHostile(projectile.sourceFactionId, target.factionId)) {
        continue;
      }
      let maximumFalloffBps = 0;
      const dismountedTargets = target.members
        .filter(
          (member) => canMemberFight(member) && member.placement.kind === "dismounted",
        )
        .sort(compareById);
      if (dismountedTargets.length > 0 && isGroupSpatiallyActive(target)) {
        const falloffBps = blastFalloffBps(
          impactCell,
          target.cell,
          this.setup.map.cellSizeMm,
          projectile.blastRadiusMm,
        );
        maximumFalloffBps = Math.max(maximumFalloffBps, falloffBps);
        if (memberDamage && falloffBps > 0) {
          const damageBps = Math.floor((memberDamage.amountBps * falloffBps) / 10_000);
          for (const [memberIndex, member] of dismountedTargets.entries()) {
            hits.push({
              shooterGroupId: projectile.sourceGroupId,
              shooterEntityId: projectile.id,
              targetGroupId: target.id,
              targetMemberId: member.id,
              shotOrdinal: memberIndex,
              damageBps,
              hitSuppressionBps: 0,
              randomStream: "blast-member-effect",
              randomEntityKey: `${projectile.id}:${member.id}`,
              randomOrdinal: 0,
            });
          }
        }
      }

      for (const platform of [...target.platforms].sort(compareById)) {
        if (platform.disposition === "destroyed") {
          continue;
        }
        const falloffBps = blastFalloffBps(
          impactCell,
          platform.cell,
          this.setup.map.cellSizeMm,
          projectile.blastRadiusMm,
        );
        maximumFalloffBps = Math.max(maximumFalloffBps, falloffBps);
        if (platformDamage && falloffBps > 0) {
          platformHits.push(
            this.resolveBlastPlatformDamageIntent(
              projectile,
              target,
              platform,
              platformDamage,
              impactCell,
              falloffBps,
            ),
          );
        }
      }

      if (maximumFalloffBps === 0) {
        continue;
      }
      affectedGroupIds.push(target.id);
      const suppression = impacts.get(target.id) ?? {
        suppressionBps: 0,
        hitSuppressionBps: 0,
      };
      suppression.suppressionBps += Math.floor(
        (projectile.suppressionBps * maximumFalloffBps) / 10_000,
      );
      suppression.hitSuppressionBps += Math.floor(
        ((hitSuppression?.amountBps ?? 0) * maximumFalloffBps) / 10_000,
      );
      impacts.set(target.id, suppression);
    }

    return affectedGroupIds.sort(compareStrings);
  }

  private resolveBlastPlatformDamageIntent(
    projectile: LogicalProjectileState,
    targetGroup: GroupState,
    targetPlatform: PlatformState,
    effect: PlatformDamageEffectDefinition,
    impactCell: GridCoord,
    falloffBps: number,
  ): PlatformDamageIntent {
    const template = getPlatformTemplate(
      this.setup.content,
      targetPlatform.platformTemplateId,
    );
    const armorFace = armorFaceForAttack(
      targetPlatform.facing,
      targetPlatform.cell,
      impactCell,
      effect.attackTags.includes("top-attack"),
    );
    const penetrationRating = Math.floor(
      (effect.penetrationRating * falloffBps) / 10_000,
    );
    const penetrated = deterministicBps(
      this.setup.seed,
      "blast-platform-effect",
      0,
      `${projectile.id}:${targetPlatform.id}`,
      0,
    ) < penetrationChanceBps(
      penetrationRating,
      template.armorRatingByFace[armorFace],
    );
    const eligibleRules = template.componentRules.filter((rule) =>
      targetPlatform.components.some(
        (component) => component.id === rule.id && component.integrityBps > 0,
      ),
    );
    const targetComponent = selectWeightedPlatformComponent(
      eligibleRules,
      deterministicUint32(
        this.setup.seed,
        "blast-platform-effect",
        0,
        `${projectile.id}:${targetPlatform.id}`,
        1,
      ),
      !penetrated,
    );
    const eligibleCrew = targetPlatform.crewAssignments
      .map((assignment) => this.state.membersById.get(assignment.memberId))
      .filter(
        (member): member is MemberState =>
          Boolean(member && this.isActiveCrewMember(member, targetPlatform)),
      )
      .sort(compareById);
    const crewRoll = deterministicUint32(
      this.setup.seed,
      "blast-platform-effect",
      0,
      `${projectile.id}:${targetPlatform.id}`,
      2,
    );
    const targetCrew = penetrated && eligibleCrew.length > 0
      ? eligibleCrew[crewRoll % eligibleCrew.length]
      : undefined;

    return {
      shooterGroupId: projectile.sourceGroupId,
      shooterEntityId: projectile.id,
      targetGroupId: targetGroup.id,
      targetPlatformId: targetPlatform.id,
      targetComponentId: targetComponent?.id,
      targetCrewMemberId: targetCrew?.id,
      shotOrdinal: 0,
      armorFace,
      penetrated,
      componentDamageBps: Math.floor(
        ((penetrated ? effect.componentDamageBps : (effect.externalDamageBps ?? 0)) *
          falloffBps) /
          10_000,
      ),
      crewDamageBps: penetrated
        ? Math.floor((effect.crewDamageBps * falloffBps) / 10_000)
        : 0,
      hitSuppressionBps: 0,
      sourceProjectileId: projectile.id,
    };
  }

  private resolvePlatformDamageIntent(
    shot: ShotIntent,
    targetGroup: GroupState,
    targetPlatform: PlatformState,
  ): PlatformDamageIntent {
    const effect = shot.platformDamage!;
    const template = getPlatformTemplate(
      this.setup.content,
      targetPlatform.platformTemplateId,
    );
    const armorFace = armorFaceForAttack(
      targetPlatform.facing,
      targetPlatform.cell,
      this.state.groupsById.get(shot.shooterGroupId)?.cell ?? targetGroup.cell,
      effect.attackTags.includes("top-attack"),
    );
    const penetrationRoll = deterministicBps(
      this.setup.seed,
      "armor-penetration",
      this.state.tick,
      `${shot.shooterEntityId}:${targetPlatform.id}`,
      shot.shotOrdinal,
    );
    const penetrated = penetrationRoll < penetrationChanceBps(
      effect.penetrationRating,
      template.armorRatingByFace[armorFace],
    );
    const eligibleRules = template.componentRules.filter((rule) =>
      targetPlatform.components.some(
        (component) => component.id === rule.id && component.integrityBps > 0,
      ),
    );
    const componentRoll = deterministicUint32(
      this.setup.seed,
      "platform-component-target",
      this.state.tick,
      `${shot.shooterEntityId}:${targetPlatform.id}`,
      shot.shotOrdinal,
    );
    const targetComponent = selectWeightedPlatformComponent(
      eligibleRules,
      componentRoll,
      !penetrated,
    );
    const eligibleCrew = targetPlatform.crewAssignments
      .map((assignment) => this.state.membersById.get(assignment.memberId))
      .filter(
        (member): member is MemberState =>
          Boolean(member && this.isActiveCrewMember(member, targetPlatform)),
      )
      .sort(compareById);
    const crewRoll = deterministicUint32(
      this.setup.seed,
      "platform-crew-target",
      this.state.tick,
      `${shot.shooterEntityId}:${targetPlatform.id}`,
      shot.shotOrdinal,
    );
    const targetCrew = penetrated && eligibleCrew.length > 0
      ? eligibleCrew[crewRoll % eligibleCrew.length]
      : undefined;

    return {
      shooterGroupId: shot.shooterGroupId,
      shooterEntityId: shot.shooterEntityId,
      targetGroupId: targetGroup.id,
      targetPlatformId: targetPlatform.id,
      targetComponentId: targetComponent?.id,
      targetCrewMemberId: targetCrew?.id,
      shotOrdinal: shot.shotOrdinal,
      armorFace,
      penetrated,
      componentDamageBps: penetrated
        ? effect.componentDamageBps
        : (effect.externalDamageBps ?? 0),
      crewDamageBps: penetrated ? effect.crewDamageBps : 0,
      hitSuppressionBps: shot.hitSuppressionBps,
    };
  }

  private applyPlatformComponentDamage(
    platform: PlatformState,
    hit: PlatformDamageIntent,
  ): void {
    if (!hit.targetComponentId || hit.componentDamageBps <= 0) {
      return;
    }
    const component = platform.components.find(
      (candidate) => candidate.id === hit.targetComponentId,
    );
    const rule = getPlatformTemplate(
      this.setup.content,
      platform.platformTemplateId,
    ).componentRules.find((candidate) => candidate.id === hit.targetComponentId);
    if (!component || !rule) {
      return;
    }
    const previous = {
      integrityBps: component.integrityBps,
      state: component.state,
    };
    component.integrityBps = Math.max(0, component.integrityBps - hit.componentDamageBps);
    component.state = componentStateForIntegrity(
      component.integrityBps,
      rule.disabledAtBps,
    );
    if (
      previous.integrityBps === component.integrityBps &&
      previous.state === component.state
    ) {
      return;
    }
    this.emit({
      type: "platform-component-changed",
      platformId: platform.id,
      groupId: platform.groupId,
      componentId: component.id,
      armorFace: hit.armorFace,
      penetrated: hit.penetrated,
      from: previous,
      to: {
        integrityBps: component.integrityBps,
        state: component.state,
      },
    });
    this.markMeaningfulProgress();
  }

  private applyHit(member: MemberState, targetGroup: GroupState, hit: HitIntent): void {
    const previous = member.health;
    const severityRoll = deterministicBps(
      this.setup.seed,
      hit.randomStream ?? "wound-severity",
      hit.randomStream ? 0 : this.state.tick,
      hit.randomEntityKey ?? `${hit.shooterGroupId}:${member.id}`,
      hit.randomOrdinal ?? hit.shotOrdinal,
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

  private updateMorale(
    impacts: Map<GroupId, SuppressionImpact>,
    impactsOnly = false,
  ): void {
    for (const group of this.state.groups) {
      const impact = impacts.get(group.id);
      if (impactsOnly && !impact) {
        continue;
      }
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
      if (!impactsOnly) {
        group.suppressionBps = Math.max(
          0,
          group.suppressionBps - (impact ? 5 : 28),
        );
      }

      if (group.suppressionBps >= 6_500) {
        group.moraleBps = Math.max(0, group.moraleBps - 10);
      } else if (!impactsOnly && !impact && group.suppressionBps < 2_500) {
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
      for (const platform of [...group.platforms].sort(compareById)) {
        for (const passengerGroupId of [...platform.passengerGroupIds].sort(compareStrings)) {
          const passengerGroup = this.state.groupsById.get(passengerGroupId);
          if (!passengerGroup) {
            continue;
          }
          let passengerEvacuated = false;
          for (const member of passengerGroup.members) {
            if (canMemberFight(member)) {
              member.presence = "evacuated";
              passengerEvacuated = true;
            }
          }
          if (passengerEvacuated) {
            passengerGroup.action = "evacuated";
            passengerGroup.decisionReason = "transport-evacuated";
            passengerGroup.path = [];
            passengerGroup.goal = undefined;
            this.emit({ type: "group-evacuated", groupId: passengerGroup.id });
          }
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
      const evacuationIndex = cellIndex(this.setup.map, group.cell);
      if (this.state.occupancy.get(evacuationIndex) === group.id) {
        this.state.occupancy.delete(evacuationIndex);
      }
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
        if (!this.isGroupModeEffective(group) || !isInsideObjective(group.cell, objective)) {
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
        group.factionId === mode.attackerFactionId && this.isGroupModeEffective(group),
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
          (group) => group.factionId === faction.id && this.isGroupModeEffective(group),
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
    if (this.state.projectiles.length > 0) {
      if (isHardTerminationReason(terminationReason) && !this.state.settlement) {
        this.state.settlement = {
          triggeredAt: this.state.tick,
          terminationReason,
          winnerFactionIds: [...winnerFactionIds],
          projectileCountAtTrigger: this.state.projectiles.length,
        };
      }
      return;
    }
    this.completeBattle(terminationReason, winnerFactionIds, this.state.tick, 0);
  }

  private completeBattle(
    terminationReason: BattleTerminationReason,
    winnerFactionIds: readonly FactionId[],
    triggeredAt: number,
    projectileCountAtTrigger: number,
  ): void {
    if (this.state.result || this.state.projectiles.length > 0) {
      return;
    }
    const resultTick = this.state.tick;
    const stateHash = this.getStateHash();
    this.state.result = {
      battleId: this.setup.battleId,
      rulesVersion: this.setup.rulesVersion,
      finalTick: resultTick,
      settlement: {
        triggeredAt,
        completedAt: resultTick,
        projectileCountAtTrigger,
      },
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
          finalFlight: this.flightSnapshotForPlatform(platform),
          artillery: platform.deployment
            ? {
                finalDeploymentState: platform.deployment.state,
                directRoundsFired: platform.deployment.directRoundsFired,
                indirectRoundsFired: platform.deployment.indirectRoundsFired,
                missionsAssigned: platform.deployment.missionsAssigned,
              }
            : undefined,
          finalPassengerGroupIds: [...platform.passengerGroupIds].sort(compareStrings),
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
      const occupyingPlatformId = this.state.staticPlatformOccupancy.get(slotIndex);
      const reservingGroupId = this.state.reservations.get(slotIndex);
      const coverOccupantId = this.state.coverOccupancy.get(slot.id);
      if (
        sameCoord(slot.cell, threat.lastKnown) ||
        occupyingPlatformId !== undefined ||
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
    if (
      activeMemberCount(group) === 0 ||
      group.platforms.some((platform) => platform.disposition === "crewed")
    ) {
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
      if (isAirMovementType(group.movementType)) {
        this.state.airspaceReservations.delete(group.id);
      } else {
        this.state.reservations.delete(cellIndex(this.setup.map, group.movingTo));
      }
    }
    group.movingTo = undefined;
    group.moveProgress = 0;
    group.moveCost = 0;
    group.turnTicksRemaining = 0;
    group.turnGoalFacing = undefined;
    group.waitAge = 0;
    group.path = [];
    group.pathGoal = undefined;
  }

  private airspaceOccupantsForGroup(
    group: GroupState,
    cell: GridCoord,
  ): readonly AirspaceOccupant[] {
    const platform = group.platforms.find((candidate) => candidate.flight);
    if (!platform?.flight || platform.disposition !== "crewed") {
      return [];
    }
    const template = getPlatformTemplate(this.setup.content, platform.platformTemplateId);
    const safetyRadiusMm = template.flightRule?.safetyRadiusMm;
    if (safetyRadiusMm === undefined) {
      return [];
    }
    const altitudeBands = platform.flight.transition
      ? altitudeBandsBetweenInclusive(
          platform.flight.transition.fromBand,
          platform.flight.transition.toBand,
        )
      : [platform.flight.altitudeBand];
    return altitudeBands.map((altitudeBand) => ({
      id: group.id,
      cell: { ...cell },
      altitudeBand,
      safetyRadiusMm,
    }));
  }

  private canOccupyFlightAltitudeBand(
    group: GroupState,
    altitudeBand: AirAltitudeBand,
  ): boolean {
    const platform = group.platforms.find((candidate) => candidate.flight);
    const template = platform
      ? getPlatformTemplate(this.setup.content, platform.platformTemplateId)
      : undefined;
    const safetyRadiusMm = template?.flightRule?.safetyRadiusMm;
    if (!platform || safetyRadiusMm === undefined) {
      return false;
    }
    const currentBand = platform.flight?.altitudeBand;
    if (!currentBand) {
      return false;
    }
    const candidates = altitudeBandsBetweenInclusive(currentBand, altitudeBand).map(
      (candidateBand): AirspaceOccupant => ({
        id: group.id,
        cell: { ...group.cell },
        altitudeBand: candidateBand,
        safetyRadiusMm,
      }),
    );
    const occupants = this.state.groups.flatMap((other) => {
      if (!isGroupSpatiallyActive(other) || !isAirMovementType(other.movementType)) {
        return [];
      }
      const current = this.airspaceOccupantsForGroup(other, other.cell);
      const reservedCell = this.state.airspaceReservations.get(other.id);
      const reserved = reservedCell
        ? this.airspaceOccupantsForGroup(other, reservedCell)
        : [];
      return [...current, ...reserved];
    });
    return candidates.every(
      (candidate) =>
        !hasAirspaceConflict(this.setup.map.cellSizeMm, candidate, occupants),
    );
  }

  private canReserveAirspace(group: GroupState, destination: GridCoord): boolean {
    const candidate = this.airspaceOccupantsForGroup(group, destination)[0];
    if (!candidate) {
      return false;
    }
    const occupants = this.state.groups.flatMap((other) => {
      if (!isGroupSpatiallyActive(other) || !isAirMovementType(other.movementType)) {
        return [];
      }
      const current = this.airspaceOccupantsForGroup(other, other.cell);
      const reservedCell = this.state.airspaceReservations.get(other.id);
      const reserved = reservedCell
        ? this.airspaceOccupantsForGroup(other, reservedCell)
        : [];
      return [...current, ...reserved];
    });
    return !hasAirspaceConflict(this.setup.map.cellSizeMm, candidate, occupants);
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
      modeEffective: this.isGroupModeEffective(group),
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
          targetFactionId: contact.targetFactionId,
          targetProfile: contact.targetProfile,
          targetDomain: contact.targetDomain,
          targetFlight: contact.targetFlight ? { ...contact.targetFlight } : undefined,
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
      targetEvaluation: group.targetEvaluation
        ? {
            evaluatedAt: group.targetEvaluation.evaluatedAt,
            selectedTargetId: group.targetEvaluation.selectedTargetId,
            candidates: group.targetEvaluation.candidates.map((candidate) => ({
              ...candidate,
              lastKnown: { ...candidate.lastKnown },
              components: { ...candidate.components },
            })),
          }
        : undefined,
      vehicleEngagement: group.vehicleEngagement
        ? {
            ...group.vehicleEngagement,
            selectedCell: group.vehicleEngagement.selectedCell
              ? { ...group.vehicleEngagement.selectedCell }
              : undefined,
            components: { ...group.vehicleEngagement.components },
          }
        : undefined,
      platforms: group.platforms.map((platform) => this.platformSummary(platform)),
      transport: this.state.transportByPassengerGroupId.has(group.id)
        ? this.transportInspection(this.state.transportByPassengerGroupId.get(group.id)!)
        : undefined,
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
      damaged: platform.components.some((component) => component.integrityBps < 10_000),
      crewCount: platform.crewAssignments.filter((assignment) => {
        const member = this.state.membersById.get(assignment.memberId);
        return member ? this.isActiveCrewMember(member, platform) : false;
      }).length,
      passengerGroupIds: [...platform.passengerGroupIds].sort(compareStrings),
      flight: this.flightSnapshotForPlatform(platform),
    };
  }

  private transportInspection(assignment: TransportAssignmentState) {
    return {
      assignmentId: assignment.id,
      platformId: assignment.platformId,
      passengerGroupId: assignment.passengerGroupId,
      status: assignment.status,
      ticksRemaining: assignment.ticksRemaining,
      destination: assignment.destination
        ? { ...assignment.destination }
        : undefined,
      dismountEvaluation: assignment.dismountEvaluation
        ? {
            ...assignment.dismountEvaluation,
            selectedCell: assignment.dismountEvaluation.selectedCell
              ? { ...assignment.dismountEvaluation.selectedCell }
              : undefined,
            components: { ...assignment.dismountEvaluation.components },
            knownThreats: assignment.dismountEvaluation.knownThreats.map(
              (threat) => ({ ...threat, lastKnown: { ...threat.lastKnown } }),
            ),
          }
        : undefined,
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
    const mode = weapon.fireModes.find((candidate) => candidate.targeting === "direct");
    return mode ? this.fireModeRangeCells(mode) : 0;
  }

  private weaponMinimumRangeCells(weapon: ReturnType<typeof getWeaponTemplate>): number {
    const mode = weapon.fireModes.find((candidate) => candidate.targeting === "direct");
    return mode ? this.fireModeMinimumRangeCells(mode) : 0;
  }

  private weaponPreferredRangeCells(weapon: ReturnType<typeof getWeaponTemplate>): number {
    const mode = weapon.fireModes.find((candidate) => candidate.targeting === "direct");
    if (!mode) {
      return 0;
    }
    return Math.min(
      this.setup.rules.preferredRangeCells,
      Math.max(
        0,
        Math.floor(mode.optimalRangeMm / this.setup.map.cellSizeMm),
      ),
    );
  }

  private fireModeRangeCells(mode: WeaponFireModeDefinition): number {
    return Math.max(0, Math.floor(mode.maximumRangeMm / this.setup.map.cellSizeMm));
  }

  private fireModeMinimumRangeCells(mode: WeaponFireModeDefinition): number {
    return Math.max(0, Math.ceil(mode.minimumRangeMm / this.setup.map.cellSizeMm));
  }

  private groupWeaponRangeCells(group: GroupState): number {
    const crewedPlatforms = group.platforms.filter(
      (platform) => platform.disposition === "crewed",
    );
    if (crewedPlatforms.length > 0) {
      const maximum = crewedPlatforms.reduce((range, platform) => {
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
    const crewedPlatforms = group.platforms.filter(
      (platform) => platform.disposition === "crewed",
    );
    if (crewedPlatforms.length > 0) {
      const maximum = crewedPlatforms.reduce((range, platform) => {
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
      const flight = crewedPlatforms.find((platform) => platform.flight)?.flight;
      if (!flight) {
        return Math.min(this.setup.rules.sightRangeCells, maximum);
      }
      const sensorRangeBps = altitudeBandModifiers(flight.altitudeBand).sensorRangeBps;
      return Math.min(
        Math.floor((this.setup.rules.sightRangeCells * sensorRangeBps) / 10_000),
        Math.floor((maximum * sensorRangeBps) / 10_000),
      );
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
    if (isAirMovementType(group.movementType)) {
      return 0;
    }
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

  private isGroupModeEffective(group: GroupState): boolean {
    if (
      group.action === "routing" ||
      group.action === "combat-ineffective" ||
      !isGroupCombatEffective(group)
    ) {
      return false;
    }
    const crewedPlatforms = group.platforms.filter(
      (platform) => platform.disposition === "crewed",
    );
    return crewedPlatforms.length === 0 || crewedPlatforms.some(
      (platform) => platform.combat === "effective",
    );
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
    this.applyFacing(group, facing);
  }

  private applyFacing(group: GroupState, facing: StaticObjectFacing): void {
    group.headingRadians = facing * (Math.PI / 4);
    for (const platform of group.platforms) {
      if (platform.disposition === "crewed") {
        platform.facing = facing;
      }
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
  hasher.addString(contact.targetFactionId);
  hasher.addString(contact.targetProfile);
  hasher.addString(contact.targetDomain ?? "ground");
  hasher.addString(contact.targetFlight?.altitudeBand ?? "");
  hasher.addNumber(contact.targetFlight?.clearanceMm ?? 0);
  hasher.addNumber(contact.lastKnown.x);
  hasher.addNumber(contact.lastKnown.z);
  hasher.addNumber(contact.observedAt);
  hasher.addNumber(contact.deliveredAt ?? contact.observedAt);
  hasher.addNumber(contact.lastDirectTick);
  hasher.addNumber(contact.confidenceBps);
  hasher.addString(contact.sourceGroupId);
  hasher.addString(contact.intelSource ?? "local-direct");
}

function hashEffectDefinition(hasher: StateHasher, effect: EffectDefinition): void {
  hasher.addString(effect.kind);
  if (effect.kind === "platform-damage") {
    hasher.addNumber(effect.penetrationRating);
    hasher.addNumber(effect.componentDamageBps);
    hasher.addNumber(effect.crewDamageBps);
    hasher.addNumber(effect.externalDamageBps ?? 0);
    for (const tag of [...effect.attackTags].sort(compareStrings)) {
      hasher.addString(tag);
    }
    return;
  }
  hasher.addNumber(effect.amountBps);
}

function isHardTerminationReason(reason: BattleTerminationReason): boolean {
  return (
    reason === "objective-captured" ||
    reason === "defense-time-expired" ||
    reason === "maximum-duration" ||
    reason === "stalemate"
  );
}

function getGroupRenderPosition(
  group: GroupState,
  map: BattleSetup["map"],
): { x: number; z: number; height: number } {
  const flight = group.platforms.find((platform) => platform.flight)?.flight;
  const clearanceHeightUnits = flight ? flight.clearanceMm / map.heightUnitMm : 0;
  if (!group.movingTo || group.moveCost <= 0) {
    return {
      x: group.cell.x,
      z: group.cell.z,
      height: heightAt(map, group.cell) + clearanceHeightUnits,
    };
  }
  const progress = Math.min(1, group.moveProgress / group.moveCost);
  return {
    x: group.cell.x + (group.movingTo.x - group.cell.x) * progress,
    z: group.cell.z + (group.movingTo.z - group.cell.z) * progress,
    height:
      heightAt(map, group.cell) +
      (heightAt(map, group.movingTo) - heightAt(map, group.cell)) * progress +
      clearanceHeightUnits,
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
