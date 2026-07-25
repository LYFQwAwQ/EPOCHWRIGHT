import * as EasyStar from "easystarjs";
import { cellIndex, isWalkable, movementCostAtIndex } from "./map";
import type { BattleMap, GridCoord, MovementType } from "./types";

export interface Pathfinder {
  findPath(start: GridCoord, goal: GridCoord): readonly GridCoord[];
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
    !isWalkable(map, to, movementType)
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
  private readonly easyStar = new EasyStar.js();

  constructor(
    private readonly map: BattleMap,
    private readonly movementType: MovementType,
  ) {
    const grid: number[][] = [];
    const acceptableTiles = new Set<number>();
    for (let z = 0; z < map.height; z += 1) {
      const row: number[] = [];
      for (let x = 0; x < map.width; x += 1) {
        const index = z * map.width + x;
        const tile = movementCostAtIndex(map, index, movementType);
        row.push(tile);
        if (tile > 0) {
          acceptableTiles.add(tile);
        }
      }
      grid.push(row);
    }

    this.easyStar.setGrid(grid);
    const sortedTiles = [...acceptableTiles].sort((a, b) => a - b);
    const minimumCost = sortedTiles[0] ?? 1;
    this.easyStar.setAcceptableTiles(sortedTiles);
    for (const tile of sortedTiles) {
      this.easyStar.setTileCost(tile, tile / minimumCost);
    }
    this.easyStar.enableDiagonals();
    this.easyStar.disableCornerCutting();
    this.easyStar.enableSync();
  }

  findPath(start: GridCoord, goal: GridCoord): readonly GridCoord[] {
    if (
      !isWalkable(this.map, start, this.movementType) ||
      !isWalkable(this.map, goal, this.movementType)
    ) {
      return [];
    }
    let result: readonly GridCoord[] = [];
    this.easyStar.findPath(start.x, start.z, goal.x, goal.z, (rawPath) => {
      const path = rawPath as { x: number; y: number }[] | null;
      result = path?.map((point) => ({ x: point.x, z: point.y })) ?? [];
    });
    this.easyStar.calculate();
    return result;
  }
}
