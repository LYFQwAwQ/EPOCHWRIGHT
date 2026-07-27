import * as EasyStar from "easystarjs";
import {
  cellIndex,
  isInsideMap,
  isWalkable,
  MOVEMENT_SLOPE_LIMIT_HEIGHT_UNITS,
  movementCostAtIndex,
} from "./map";
import type { BattleMap, GridCoord, MovementType } from "./types";

type EasyStarDirection = Parameters<EasyStar.js["setDirectionalCondition"]>[2][number];

const MOVEMENT_DIRECTIONS: readonly {
  readonly sourceDx: number;
  readonly sourceDz: number;
  readonly direction: EasyStarDirection;
}[] = [
  { sourceDx: 0, sourceDz: -1, direction: EasyStar.TOP },
  { sourceDx: 1, sourceDz: -1, direction: EasyStar.TOP_RIGHT },
  { sourceDx: 1, sourceDz: 0, direction: EasyStar.RIGHT },
  { sourceDx: 1, sourceDz: 1, direction: EasyStar.BOTTOM_RIGHT },
  { sourceDx: 0, sourceDz: 1, direction: EasyStar.BOTTOM },
  { sourceDx: -1, sourceDz: 1, direction: EasyStar.BOTTOM_LEFT },
  { sourceDx: -1, sourceDz: 0, direction: EasyStar.LEFT },
  { sourceDx: -1, sourceDz: -1, direction: EasyStar.TOP_LEFT },
] as const;

export interface Pathfinder {
  findPath(
    start: GridCoord,
    goal: GridCoord,
    blockedCellIndices?: ReadonlySet<number>,
  ): readonly GridCoord[];
}

export function createPathfinder(
  map: BattleMap,
  movementType: MovementType = "foot",
): Pathfinder {
  return new EasyStarPathfinder(map, movementType);
}

export function canTraverseStep(
  map: BattleMap,
  from: GridCoord,
  to: GridCoord,
  movementType: MovementType = "foot",
): boolean {
  const dx = Math.abs(to.x - from.x);
  const dz = Math.abs(to.z - from.z);
  if (
    dx > 1 ||
    dz > 1 ||
    (dx === 0 && dz === 0) ||
    !isWalkable(map, from, movementType) ||
    !isWalkable(map, to, movementType) ||
    !isWithinSlopeLimit(map, from, to, movementType)
  ) {
    return false;
  }
  if (dx === 1 && dz === 1) {
    return (
      isWalkable(map, { x: from.x, z: to.z }, movementType) &&
      isWalkable(map, { x: to.x, z: from.z }, movementType)
    );
  }
  return true;
}

export function movementStepCost(
  map: BattleMap,
  from: GridCoord,
  to: GridCoord,
  movementType: MovementType = "foot",
): number {
  if (!canTraverseStep(map, from, to, movementType)) {
    throw new Error("Cannot calculate an illegal movement step.");
  }
  const diagonal = from.x !== to.x && from.z !== to.z;
  const destinationCost = movementCostAtIndex(map, cellIndex(map, to), movementType);
  if (destinationCost <= 0) {
    throw new Error("Cannot calculate a movement step into impassable terrain.");
  }
  const fromHeight = map.layers.heightUnits[cellIndex(map, from)] ?? 0;
  const toHeight = map.layers.heightUnits[cellIndex(map, to)] ?? 0;
  const slopeCost = Math.abs(toHeight - fromHeight) * 45;
  return Math.round((diagonal ? 1_414 : 1_000) * (destinationCost / 10)) + slopeCost;
}

class EasyStarPathfinder implements Pathfinder {
  private readonly easyStar: EasyStar.js;

  constructor(
    private readonly map: BattleMap,
    private readonly movementType: MovementType,
  ) {
    this.easyStar = this.createEasyStar();
  }

  findPath(
    start: GridCoord,
    goal: GridCoord,
    blockedCellIndices?: ReadonlySet<number>,
  ): readonly GridCoord[] {
    if (
      !isWalkable(this.map, start, this.movementType) ||
      !isWalkable(this.map, goal, this.movementType) ||
      blockedCellIndices?.has(cellIndex(this.map, goal))
    ) {
      return [];
    }
    const easyStar =
      blockedCellIndices && blockedCellIndices.size > 0
        ? this.createEasyStar(blockedCellIndices, cellIndex(this.map, start))
        : this.easyStar;
    let result: readonly GridCoord[] = [];
    easyStar.findPath(start.x, start.z, goal.x, goal.z, (rawPath) => {
      const path = rawPath as { x: number; y: number }[] | null;
      result = path?.map((point) => ({ x: point.x, z: point.y })) ?? [];
    });
    easyStar.calculate();
    return result;
  }

  private createEasyStar(
    blockedCellIndices?: ReadonlySet<number>,
    startIndex?: number,
  ): EasyStar.js {
    const easyStar = new EasyStar.js();
    const grid: number[][] = [];
    const acceptableTiles = new Set<number>();
    for (let z = 0; z < this.map.height; z += 1) {
      const row: number[] = [];
      for (let x = 0; x < this.map.width; x += 1) {
        const index = z * this.map.width + x;
        const dynamicallyBlocked =
          index !== startIndex && blockedCellIndices?.has(index) === true;
        const tile = dynamicallyBlocked
          ? 0
          : movementCostAtIndex(this.map, index, this.movementType);
        row.push(tile);
        if (tile > 0) {
          acceptableTiles.add(tile);
        }
      }
      grid.push(row);
    }

    easyStar.setGrid(grid);
    const sortedTiles = [...acceptableTiles].sort((a, b) => a - b);
    const minimumCost = sortedTiles[0] ?? 1;
    easyStar.setAcceptableTiles(sortedTiles);
    for (const tile of sortedTiles) {
      easyStar.setTileCost(tile, tile / minimumCost);
    }
    this.applySlopeConditions(easyStar, grid);
    easyStar.enableDiagonals();
    easyStar.disableCornerCutting();
    easyStar.enableSync();
    return easyStar;
  }

  private applySlopeConditions(easyStar: EasyStar.js, grid: readonly number[][]): void {
    if (!Number.isFinite(MOVEMENT_SLOPE_LIMIT_HEIGHT_UNITS[this.movementType])) {
      return;
    }
    for (let z = 0; z < this.map.height; z += 1) {
      for (let x = 0; x < this.map.width; x += 1) {
        if ((grid[z]?.[x] ?? 0) <= 0) {
          continue;
        }
        const destination = { x, z };
        const allowedDirections: EasyStarDirection[] = [];
        for (const candidate of MOVEMENT_DIRECTIONS) {
          const source = {
            x: x + candidate.sourceDx,
            z: z + candidate.sourceDz,
          };
          if (
            isInsideMap(this.map, source) &&
            (grid[source.z]?.[source.x] ?? 0) > 0 &&
            isWithinSlopeLimit(this.map, source, destination, this.movementType)
          ) {
            allowedDirections.push(candidate.direction);
          }
        }
        easyStar.setDirectionalCondition(x, z, allowedDirections);
      }
    }
  }
}

function isWithinSlopeLimit(
  map: BattleMap,
  from: GridCoord,
  to: GridCoord,
  movementType: MovementType,
): boolean {
  const fromHeight = map.layers.heightUnits[cellIndex(map, from)] ?? 0;
  const toHeight = map.layers.heightUnits[cellIndex(map, to)] ?? 0;
  return (
    Math.abs(toHeight - fromHeight) <= MOVEMENT_SLOPE_LIMIT_HEIGHT_UNITS[movementType]
  );
}
