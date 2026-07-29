import { cellIndex, heightAt, isInsideMap } from "./map";
import { STATIC_OBJECT_DEFINITIONS } from "./types";
import type {
  BattleMap,
  FireMissionIntelSource,
  GridCoord,
  IndirectFireUncertaintyRule,
} from "./types";

export const MAX_LOGICAL_PROJECTILE_FLIGHT_TICKS = 10_000;
export const MAX_ARTILLERY_SCATTER_MM = 1_000_000;

export interface ProjectilePositionMm {
  readonly xMm: number;
  readonly zMm: number;
  readonly heightMm: number;
}

export interface ArtilleryUncertaintyBreakdown {
  readonly ageTicks: number;
  readonly baseScatterMm: number;
  readonly ageScatterMm: number;
  readonly relayPenaltyMm: number;
  readonly confidencePenaltyMm: number;
  readonly radiusMm: number;
}

export interface ArtilleryScatterCandidate {
  readonly cell: GridCoord;
  readonly offset: { readonly dx: number; readonly dz: number };
  readonly distanceSquared: number;
}

export function calculateArtilleryUncertainty(
  rule: IndirectFireUncertaintyRule,
  source: FireMissionIntelSource,
  firingTick: number,
  observedAt: number,
  confidenceBps: number,
): ArtilleryUncertaintyBreakdown {
  const ageTicks = Math.max(0, firingTick - observedAt);
  const ageScatterMm = Math.floor((ageTicks * rule.ageScatterMmPerSecond) / 20);
  const relayPenaltyMm = source === "same-faction"
    ? rule.sameFactionRelayPenaltyMm
    : source === "allied"
      ? rule.alliedRelayPenaltyMm
      : 0;
  const confidencePenaltyMm = Math.floor(
    (Math.max(0, 10_000 - confidenceBps) * rule.zeroConfidencePenaltyMm) / 10_000,
  );
  const radiusMm = Math.max(
    0,
    Math.min(
      rule.maximumScatterMm,
      rule.baseScatterMm + ageScatterMm + relayPenaltyMm + confidencePenaltyMm,
    ),
  );
  return {
    ageTicks,
    baseScatterMm: rule.baseScatterMm,
    ageScatterMm,
    relayPenaltyMm,
    confidencePenaltyMm,
    radiusMm,
  };
}

export function artilleryScatterCandidates(
  map: BattleMap,
  aimCell: GridCoord,
  radiusMm: number,
): readonly ArtilleryScatterCandidate[] {
  const radiusCells = Math.floor(radiusMm / map.cellSizeMm);
  const candidates: ArtilleryScatterCandidate[] = [];
  const minimumDz = Math.max(-radiusCells, -aimCell.z);
  const maximumDz = Math.min(radiusCells, map.height - 1 - aimCell.z);
  const minimumDx = Math.max(-radiusCells, -aimCell.x);
  const maximumDx = Math.min(radiusCells, map.width - 1 - aimCell.x);
  for (let dz = minimumDz; dz <= maximumDz; dz += 1) {
    for (let dx = minimumDx; dx <= maximumDx; dx += 1) {
      const distanceSquared = dx * dx + dz * dz;
      if (distanceSquared * map.cellSizeMm * map.cellSizeMm > radiusMm * radiusMm) {
        continue;
      }
      const cell = { x: aimCell.x + dx, z: aimCell.z + dz };
      candidates.push({ cell, offset: { dx, dz }, distanceSquared });
    }
  }
  return candidates.sort(
    (a, b) =>
      a.distanceSquared - b.distanceSquared ||
      a.cell.z - b.cell.z ||
      a.cell.x - b.cell.x,
  );
}

export function projectileFlightTicks(
  origin: GridCoord,
  target: GridCoord,
  cellSizeMm: number,
  projectileSpeedMmPerTick: number,
): number {
  const dxMm = (target.x - origin.x) * cellSizeMm;
  const dzMm = (target.z - origin.z) * cellSizeMm;
  const distanceMm = integerSquareRootCeil(dxMm * dxMm + dzMm * dzMm);
  return Math.max(1, Math.ceil(distanceMm / projectileSpeedMmPerTick));
}

export function projectilePositionAtElapsed(
  map: BattleMap,
  origin: GridCoord,
  target: GridCoord,
  muzzleHeightMm: number,
  apexHeightMm: number,
  totalFlightTicks: number,
  elapsedTicks: number,
): ProjectilePositionMm {
  const elapsed = Math.max(0, Math.min(totalFlightTicks, elapsedTicks));
  const halfCellMm = Math.floor(map.cellSizeMm / 2);
  const originX = origin.x * map.cellSizeMm + halfCellMm;
  const originZ = origin.z * map.cellSizeMm + halfCellMm;
  const targetX = target.x * map.cellSizeMm + halfCellMm;
  const targetZ = target.z * map.cellSizeMm + halfCellMm;
  const originHeight = heightAt(map, origin) * map.heightUnitMm + muzzleHeightMm;
  const targetHeight = heightAt(map, target) * map.heightUnitMm;
  const linearHeight = originHeight + Math.trunc(
    ((targetHeight - originHeight) * elapsed) / totalFlightTicks,
  );
  const arcHeight = Math.floor(
    (4 * apexHeightMm * elapsed * (totalFlightTicks - elapsed)) /
      (totalFlightTicks * totalFlightTicks),
  );
  return {
    xMm: originX + Math.trunc(((targetX - originX) * elapsed) / totalFlightTicks),
    zMm: originZ + Math.trunc(((targetZ - originZ) * elapsed) / totalFlightTicks),
    heightMm: linearHeight + arcHeight,
  };
}

export function supercoverCellsBetween(
  map: BattleMap,
  start: ProjectilePositionMm,
  end: ProjectilePositionMm,
): readonly GridCoord[] {
  let x = Math.floor(start.xMm / map.cellSizeMm);
  let z = Math.floor(start.zMm / map.cellSizeMm);
  const endX = Math.floor(end.xMm / map.cellSizeMm);
  const endZ = Math.floor(end.zMm / map.cellSizeMm);
  const dx = end.xMm - start.xMm;
  const dz = end.zMm - start.zMm;
  const absDx = Math.abs(dx);
  const absDz = Math.abs(dz);
  const stepX = Math.sign(dx);
  const stepZ = Math.sign(dz);
  let nextXDistance = stepX > 0
    ? (x + 1) * map.cellSizeMm - start.xMm
    : stepX < 0
      ? start.xMm - x * map.cellSizeMm
      : Number.POSITIVE_INFINITY;
  let nextZDistance = stepZ > 0
    ? (z + 1) * map.cellSizeMm - start.zMm
    : stepZ < 0
      ? start.zMm - z * map.cellSizeMm
      : Number.POSITIVE_INFINITY;
  const cells: GridCoord[] = [];
  const seen = new Set<number>();
  const addCell = (cell: GridCoord): void => {
    if (!isInsideMap(map, cell)) {
      return;
    }
    const index = cellIndex(map, cell);
    if (!seen.has(index)) {
      seen.add(index);
      cells.push(cell);
    }
  };
  addCell({ x, z });

  while (x !== endX || z !== endZ) {
    const xComparison = stepX === 0
      ? Number.POSITIVE_INFINITY
      : nextXDistance * absDz;
    const zComparison = stepZ === 0
      ? Number.POSITIVE_INFINITY
      : nextZDistance * absDx;
    if (xComparison < zComparison) {
      x += stepX;
      nextXDistance += map.cellSizeMm;
      addCell({ x, z });
      continue;
    }
    if (zComparison < xComparison) {
      z += stepZ;
      nextZDistance += map.cellSizeMm;
      addCell({ x, z });
      continue;
    }

    const sideCells = [
      { x: x + stepX, z },
      { x, z: z + stepZ },
    ].sort((a, b) => cellIndex(map, a) - cellIndex(map, b));
    for (const cell of sideCells) {
      addCell(cell);
    }
    x += stepX;
    z += stepZ;
    nextXDistance += map.cellSizeMm;
    nextZDistance += map.cellSizeMm;
    addCell({ x, z });
  }

  return cells;
}

export function firstProjectileCollision(
  map: BattleMap,
  start: ProjectilePositionMm,
  end: ProjectilePositionMm,
): GridCoord | undefined {
  const dx = end.xMm - start.xMm;
  const dz = end.zMm - start.zMm;
  const segmentLengthSquared = dx * dx + dz * dz;
  for (const cell of supercoverCellsBetween(map, start, end)) {
    const halfCellMm = Math.floor(map.cellSizeMm / 2);
    const centerX = cell.x * map.cellSizeMm + halfCellMm;
    const centerZ = cell.z * map.cellSizeMm + halfCellMm;
    const projectedNumerator = segmentLengthSquared === 0
      ? 0
      : Math.max(
          0,
          Math.min(
            segmentLengthSquared,
            (centerX - start.xMm) * dx + (centerZ - start.zMm) * dz,
          ),
        );
    const projectileHeight = segmentLengthSquared === 0
      ? end.heightMm
      : start.heightMm + Math.trunc(
          ((end.heightMm - start.heightMm) * projectedNumerator) /
            segmentLengthSquared,
        );
    if (projectileHeight <= collisionTopHeightMm(map, cell)) {
      return cell;
    }
  }
  return undefined;
}

export function blastFalloffBps(
  impactCell: GridCoord,
  targetCell: GridCoord,
  cellSizeMm: number,
  blastRadiusMm: number,
): number {
  const dxMm = (targetCell.x - impactCell.x) * cellSizeMm;
  const dzMm = (targetCell.z - impactCell.z) * cellSizeMm;
  const distanceMm = integerSquareRootCeil(dxMm * dxMm + dzMm * dzMm);
  if (blastRadiusMm === 0) {
    return distanceMm === 0 ? 10_000 : 0;
  }
  if (distanceMm > blastRadiusMm) {
    return 0;
  }
  return Math.max(1, Math.floor(((blastRadiusMm - distanceMm) * 10_000) / blastRadiusMm));
}

function collisionTopHeightMm(map: BattleMap, cell: GridCoord): number {
  const terrainHeight = heightAt(map, cell) * map.heightUnitMm;
  const occupancyTypeId = map.layers.staticOccupancy[cellIndex(map, cell)] ?? 0;
  const objectDefinition = Object.values(STATIC_OBJECT_DEFINITIONS).find(
    (definition) => definition.typeId === occupancyTypeId,
  );
  return terrainHeight + (objectDefinition?.heightUnits ?? 0) * map.heightUnitMm;
}

function integerSquareRootCeil(value: number): number {
  const root = Math.floor(Math.sqrt(value));
  return root * root === value ? root : root + 1;
}
