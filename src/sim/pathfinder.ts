import * as EasyStar from "easystarjs";
import { cellIndex, isWalkable } from "./map";
import type { BattleMap, GridCoord } from "./types";

export interface Pathfinder {
  findPath(start: GridCoord, goal: GridCoord): readonly GridCoord[];
}

export function createPathfinder(map: BattleMap): Pathfinder {
  return new EasyStarPathfinder(map);
}

export function canTraverseStep(
  map: BattleMap,
  from: GridCoord,
  to: GridCoord,
): boolean {
  const dx = Math.abs(to.x - from.x);
  const dz = Math.abs(to.z - from.z);
  if (dx > 1 || dz > 1 || (dx === 0 && dz === 0) || !isWalkable(map, to)) {
    return false;
  }
  if (dx === 1 && dz === 1) {
    return (
      isWalkable(map, { x: from.x, z: to.z }) &&
      isWalkable(map, { x: to.x, z: from.z })
    );
  }
  return true;
}

export function movementStepCost(
  map: BattleMap,
  from: GridCoord,
  to: GridCoord,
): number {
  const diagonal = from.x !== to.x && from.z !== to.z;
  const destinationCost = map.movementCosts[cellIndex(map, to)] ?? 10;
  const fromHeight = map.heightUnits[cellIndex(map, from)] ?? 0;
  const toHeight = map.heightUnits[cellIndex(map, to)] ?? 0;
  const slopeCost = Math.abs(toHeight - fromHeight) * 45;
  return Math.round((diagonal ? 1_414 : 1_000) * (destinationCost / 10)) + slopeCost;
}

class EasyStarPathfinder implements Pathfinder {
  private readonly easyStar = new EasyStar.js();

  constructor(private readonly map: BattleMap) {
    const grid: number[][] = [];
    const acceptableTiles = new Set<number>();
    for (let z = 0; z < map.height; z += 1) {
      const row: number[] = [];
      for (let x = 0; x < map.width; x += 1) {
        const index = z * map.width + x;
        const tile = map.walkable[index] === 1 ? (map.movementCosts[index] ?? 10) : 0;
        row.push(tile);
        if (tile > 0) {
          acceptableTiles.add(tile);
        }
      }
      grid.push(row);
    }

    this.easyStar.setGrid(grid);
    this.easyStar.setAcceptableTiles([...acceptableTiles].sort((a, b) => a - b));
    for (const tile of [...acceptableTiles].sort((a, b) => a - b)) {
      this.easyStar.setTileCost(tile, tile / 10);
    }
    this.easyStar.enableDiagonals();
    this.easyStar.disableCornerCutting();
    this.easyStar.enableSync();
  }

  findPath(start: GridCoord, goal: GridCoord): readonly GridCoord[] {
    if (!isWalkable(this.map, start) || !isWalkable(this.map, goal)) {
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
