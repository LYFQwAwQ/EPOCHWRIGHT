import { activeMemberCount, canMemberFight } from "./combat";
import {
  cloneBattleContent,
  getGroupTemplate,
  getMemberTemplate,
  getPlatformTemplate,
  getPrimaryWeaponTemplate,
} from "./content";
import { claimCoverSlot } from "./cover";
import type {
  GroupState,
  MemberState,
  PlatformState,
  ReinforcementRuntimeState,
  RuntimeState,
} from "./internal";
import { cellIndex } from "./map";
import { compareById, compareStrings } from "./ordering";
import {
  defenseObjectives,
  reinforcementEntranceIds,
} from "./setup";
import type { BattleSetup, CoverSlot, GridCoord, GroupId } from "./types";
import { derivePlatformCapabilities } from "./vehicle";

export function createRuntimeState(
  setup: BattleSetup,
  coverSlotsByCell: ReadonlyMap<number, CoverSlot>,
): RuntimeState {
  const groups = [...setup.groups]
    .sort(compareById)
    .map((spawn) => createGroupState(spawn, spawn.spawn, setup.content));
  const groupsById = new Map(groups.map((group) => [group.id, group]));
  const membersById = new Map(
    groups.flatMap((group) => group.members.map((member) => [member.id, member] as const)),
  );
  const platformsById = new Map(
    groups.flatMap((group) =>
      group.platforms.map((platform) => [platform.id, platform] as const),
    ),
  );
  const coverOccupancy = new Map<string, GroupId>();
  for (const group of groups) {
    const slot = coverSlotsByCell.get(cellIndex(setup.map, group.cell));
    if (slot && activeMemberCount(group) > 0 && group.platforms.length === 0) {
      claimCoverSlot(coverOccupancy, slot, group.id);
    }
  }
  const defenseMode = setup.mode.kind === "defense" ? setup.mode : undefined;
  const objectives = defenseMode
    ? defenseObjectives(defenseMode).map((objective, index) => ({
        id: objective.id,
        center: { ...objective.center },
        radiusCells: objective.radiusCells,
        attackerFactionId: defenseMode.attackerFactionId,
        defenderFactionId: defenseMode.defenderFactionId,
        state: "defender-controlled" as const,
        progressBps: 0,
        attackerPower: 0,
        defenderPower: 0,
        unlocked: (defenseMode.objectiveRule ?? "all") !== "sequence" || index === 0,
      }))
    : [];
  const reinforcementWaves: ReinforcementRuntimeState[] = setup.reinforcements
    .slice()
    .sort((a, b) => a.arrivalTick - b.arrivalTick || compareStrings(a.id, b.id))
    .map((wave) => ({
      id: wave.id,
      factionId: wave.factionId,
      arrivalTick: wave.arrivalTick,
      entranceIds: reinforcementEntranceIds(wave).slice(),
      groups: wave.groups.map((group) => ({
        ...group,
        spawn: { ...group.spawn },
        evacuation: { ...group.evacuation },
        members: group.members.map((member) => ({ ...member })),
        platforms: group.platforms.map(clonePlatformSpawn),
      })),
      blockedPolicy: wave.blockedPolicy,
      status: "pending",
      deployedGroupIds: [],
    }));
  return {
    setup,
    groups,
    groupsById,
    membersById,
    platformsById,
    factionKnowledge: new Map(
      setup.factions.map((faction) => [
        faction.id,
        { factionId: faction.id, contacts: new Map() },
      ]),
    ),
    intelQueue: [],
    events: [],
    occupancy: new Map(groups.map((group) => [cellIndex(setup.map, group.cell), group.id])),
    reservations: new Map(),
    coverOccupancy,
    objectives,
    objective: objectives[0],
    reinforcementWaves,
    tick: 0,
    eventSequence: 0,
    intelSequence: 0,
    lastMeaningfulProgressTick: 0,
  };
}

export function createGroupState(
  spawn: BattleSetup["groups"][number],
  cell: GridCoord,
  content: BattleSetup["content"],
): GroupState {
  const groupTemplate = getGroupTemplate(content, spawn.groupTemplateId);
  const platforms = spawn.platforms.map<PlatformState>((platform) => {
    const template = getPlatformTemplate(content, platform.platformTemplateId);
    return {
      id: platform.id,
      groupId: spawn.id,
      factionId: spawn.factionId,
      platformTemplateId: template.id,
      persistentPlatformId: platform.persistentId,
      movementType: template.movementType,
      visualTypeId: template.visualTypeId,
      facing: platform.initialFacing,
      mobility: "immobilized",
      combat: "ineffective",
      disposition: platform.crewAssignments.length > 0 ? "crewed" : "abandoned",
      crewAssignments: platform.crewAssignments.map((assignment) => ({ ...assignment })),
      crewReassignments: [],
      components: template.componentRules.map((component) => ({
        id: component.id,
        kind: component.kind,
        integrityBps: 10_000,
        state: "operational",
      })),
      weaponStates: template.componentRules.flatMap((component) => {
        if (component.kind !== "weapon" || !component.weaponTemplateId) {
          return [];
        }
        const weapon = content.weaponTemplates[component.weaponTemplateId];
        return weapon
          ? [{
              componentId: component.id,
              weaponTemplateId: weapon.id,
              magazineRounds: weapon.magazineSize,
              reloadTicksRemaining: 0,
              shotCooldownTicks: 0,
            }]
          : [];
      }),
    };
  });
  const crewPlacementByMemberId = new Map(
    platforms.flatMap((platform) =>
      platform.crewAssignments.map((assignment) => [
        assignment.memberId,
        {
          kind: "crew" as const,
          platformId: platform.id,
          stationId: assignment.stationId,
        },
      ]),
    ),
  );
  const group: GroupState = {
    id: spawn.id,
    factionId: spawn.factionId,
    groupTemplateId: groupTemplate.id,
    movementType: platforms[0]?.movementType ?? "foot",
    evacuation: { ...spawn.evacuation },
    members: [...spawn.members]
      .sort(compareById)
      .map<MemberState>((member) => {
        const memberTemplate = getMemberTemplate(content, member.memberTemplateId);
        const weapon = getPrimaryWeaponTemplate(content, memberTemplate.id);
        return {
          id: member.id,
          groupId: spawn.id,
          factionId: spawn.factionId,
          memberTemplateId: memberTemplate.id,
          weaponTemplateId: weapon.id,
          health: member.initialHealth ?? "healthy",
          presence: "deployed",
          magazineRounds: weapon.magazineSize,
          reloadTicksRemaining: 0,
          shotCooldownTicks: 0,
          placement: crewPlacementByMemberId.get(member.id) ?? { kind: "dismounted" },
        };
      }),
    platforms,
    cell: { ...cell },
    moveProgress: 0,
    moveCost: 0,
    turnTicksRemaining: 0,
    waitAge: 0,
    headingRadians: platforms[0] ? platforms[0].facing * (Math.PI / 4) : 0,
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
  };
  for (const platform of group.platforms) {
    const template = getPlatformTemplate(content, platform.platformTemplateId);
    const capabilities = derivePlatformCapabilities(
      template,
      platform.components,
      platform.crewAssignments,
      group.members.map((member) => ({
        id: member.id,
        roleTags: getMemberTemplate(content, member.memberTemplateId).roleTags,
        active: canMemberFight(member),
      })),
      platform.crewReassignments,
    );
    platform.mobility = capabilities.mobility.available ? "mobile" : "immobilized";
    platform.combat = capabilities.weapons.some((weapon) => weapon.available)
      ? "effective"
      : "ineffective";
    platform.disposition = capabilities.disposition;
  }
  return group;
}

export function countSpawnActiveMembers(group: BattleSetup["groups"][number]): number {
  return group.members.filter(
    (member) => member.initialHealth !== "incapacitated" && member.initialHealth !== "dead",
  ).length;
}

export function cloneBattleSetup(setup: BattleSetup): BattleSetup {
  return {
    ...setup,
    content: cloneBattleContent(setup.content),
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
      platforms: group.platforms.map(clonePlatformSpawn),
    })),
    reinforcementEntrances: setup.reinforcementEntrances.map((entrance) => ({
      ...entrance,
      cells: entrance.cells.map((cell) => ({ ...cell })),
    })),
    reinforcements: setup.reinforcements.map((wave) => ({
      ...wave,
      entranceIds: wave.entranceIds ? [...wave.entranceIds] : undefined,
      entranceZoneIds: wave.entranceZoneIds ? [...wave.entranceZoneIds] : undefined,
      groups: wave.groups.map((group) => ({
        ...group,
        spawn: { ...group.spawn },
        evacuation: { ...group.evacuation },
        members: group.members.map((member) => ({ ...member })),
        platforms: group.platforms.map(clonePlatformSpawn),
      })),
    })),
    mode:
      setup.mode.kind === "defense"
        ? {
            ...setup.mode,
            objective: {
              ...setup.mode.objective,
              center: { ...setup.mode.objective.center },
            },
            objectives: defenseObjectives(setup.mode).map((objective) => ({
              ...objective,
              center: { ...objective.center },
            })),
          }
        : { kind: "conflict" },
    rules: { ...setup.rules },
    transportAssignments: setup.transportAssignments.map((assignment) => ({
      ...assignment,
    })),
  };
}

function clonePlatformSpawn(
  platform: BattleSetup["groups"][number]["platforms"][number],
): BattleSetup["groups"][number]["platforms"][number] {
  return {
    ...platform,
    crewAssignments: platform.crewAssignments.map((assignment) => ({ ...assignment })),
  };
}
