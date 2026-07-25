import { cellIndex, isWalkable } from "./map";
import {
  STATIC_OBJECT_DEFINITIONS,
  type BattleMap,
  type CoverSlot,
  type CoverSlotId,
  type DirectionalCoverEffect,
  type GridCoord,
  type GroupId,
  type StaticObjectFacing,
} from "./types";

const FACING_OFFSETS: Readonly<Record<StaticObjectFacing, readonly [number, number]>> = {
  0: [0, 1],
  1: [1, 1],
  2: [1, 0],
  3: [1, -1],
  4: [0, -1],
  5: [-1, -1],
  6: [-1, 0],
  7: [-1, 1],
};

export function buildCoverSlots(map: BattleMap): readonly CoverSlot[] {
  const slots: CoverSlot[] = [];
  const claimedCells = new Set<number>();
  const objects = [...map.staticObjects].sort((a, b) => compareStrings(a.id, b.id));

  for (const object of objects) {
    const [facingX, facingZ] = FACING_OFFSETS[object.facing];
    const cell = {
      x: object.cell.x - facingX,
      z: object.cell.z - facingZ,
    };
    if (!isWalkable(map, cell)) {
      continue;
    }
    const index = cellIndex(map, cell);
    if (claimedCells.has(index)) {
      continue;
    }
    claimedCells.add(index);
    const definition = STATIC_OBJECT_DEFINITIONS[object.kind].cover;
    slots.push({
      id: `${object.id}:cover-0`,
      staticObjectId: object.id,
      staticObjectKind: object.kind,
      objectCell: { ...object.cell },
      cell,
      facing: object.facing,
      capacity: definition.capacity,
      protectionBps: definition.protectionBps,
      concealmentBps: definition.concealmentBps,
    });
  }

  return slots;
}

export function resolveDirectionalCoverEffect(
  slot: CoverSlot,
  activeMembers: number,
  threat: GridCoord,
): DirectionalCoverEffect {
  const threatFacing = facingToward(slot.cell, threat);
  const facingDifference = circularFacingDifference(slot.facing, threatFacing);
  const aspect = facingDifference <= 1 ? "front" : facingDifference === 2 ? "flank" : "rear";
  const directionScaleBps = aspect === "front" ? 10_000 : aspect === "flank" ? 5_000 : 0;
  const coveredMembers = Math.min(slot.capacity, Math.max(0, activeMembers));
  const capacityScaleBps =
    activeMembers > 0 ? Math.round((coveredMembers * 10_000) / activeMembers) : 0;

  return {
    aspect,
    coveredMembers,
    protectionBps: scaleEffect(slot.protectionBps, capacityScaleBps, directionScaleBps),
    concealmentBps: scaleEffect(
      slot.concealmentBps,
      capacityScaleBps,
      directionScaleBps,
    ),
  };
}

export function applyBasisPointReduction(value: number, reductionBps: number): number {
  const clampedReduction = Math.min(10_000, Math.max(0, reductionBps));
  return Math.max(0, Math.round((value * (10_000 - clampedReduction)) / 10_000));
}

export function claimCoverSlot(
  occupancy: Map<CoverSlotId, GroupId>,
  slot: CoverSlot,
  groupId: GroupId,
): boolean {
  const occupant = occupancy.get(slot.id);
  if (occupant !== undefined && occupant !== groupId) {
    return false;
  }
  occupancy.set(slot.id, groupId);
  return true;
}

export function releaseCoverSlot(
  occupancy: Map<CoverSlotId, GroupId>,
  slotId: CoverSlotId,
  groupId: GroupId,
): boolean {
  if (occupancy.get(slotId) !== groupId) {
    return false;
  }
  occupancy.delete(slotId);
  return true;
}

function facingToward(from: GridCoord, to: GridCoord): StaticObjectFacing {
  const angle = Math.atan2(to.x - from.x, to.z - from.z);
  return ((Math.round(angle / (Math.PI / 4)) % 8 + 8) % 8) as StaticObjectFacing;
}

function circularFacingDifference(a: StaticObjectFacing, b: StaticObjectFacing): number {
  const difference = Math.abs(a - b);
  return Math.min(difference, 8 - difference);
}

function scaleEffect(value: number, capacityScaleBps: number, directionScaleBps: number): number {
  return Math.round((value * capacityScaleBps * directionScaleBps) / 100_000_000);
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
