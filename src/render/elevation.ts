import type { BattleMap } from "../sim/types";

/** Presentation-only relief exaggeration. Simulation heights remain authoritative. */
export const VISUAL_HEIGHT_SCALE = 2.25;

export function visualWorldY(worldY: number): number {
  return worldY * VISUAL_HEIGHT_SCALE;
}

export function visualMapHeightMeters(map: BattleMap, heightUnits: number): number {
  return (heightUnits * map.heightUnitMm * VISUAL_HEIGHT_SCALE) / 1_000;
}

export function visualCellGroundHeight(map: BattleMap, cellIndex: number): number {
  return visualMapHeightMeters(map, map.layers.heightUnits[cellIndex] ?? 0);
}
