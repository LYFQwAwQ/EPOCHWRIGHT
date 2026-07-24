import { createNoise2D } from "simplex-noise";
import { createSeededRandom } from "./rng";
import type { BattleMap, GridCoord } from "./types";

export interface MapGenerationOptions {
  readonly seed: string;
  readonly width: number;
  readonly height: number;
  readonly mountainDensity: number;
  readonly roughness: number;
}

const CELL_SIZE_MM = 4_000;
const HEIGHT_UNIT_MM = 500;

export function cellIndex(map: Pick<BattleMap, "width">, coord: GridCoord): number {
  return coord.z * map.width + coord.x;
}

export function coordFromIndex(
  map: Pick<BattleMap, "width">,
  index: number,
): GridCoord {
  return { x: index % map.width, z: Math.floor(index / map.width) };
}

export function isInsideMap(
  map: Pick<BattleMap, "width" | "height">,
  coord: GridCoord,
): boolean {
  return (
    Number.isInteger(coord.x) &&
    Number.isInteger(coord.z) &&
    coord.x >= 0 &&
    coord.x < map.width &&
    coord.z >= 0 &&
    coord.z < map.height
  );
}

export function isWalkable(map: BattleMap, coord: GridCoord): boolean {
  return isInsideMap(map, coord) && map.walkable[cellIndex(map, coord)] === 1;
}

export function heightAt(map: BattleMap, coord: GridCoord): number {
  if (!isInsideMap(map, coord)) {
    return 0;
  }
  return map.heightUnits[cellIndex(map, coord)] ?? 0;
}

export function generateBattleMap(options: MapGenerationOptions): BattleMap {
  const { width, height } = options;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 24 || height < 20) {
    throw new Error("Battle maps must be at least 24 x 20 cells.");
  }

  const density = clamp(options.mountainDensity, 0, 1);
  const roughness = clamp(options.roughness, 0, 1);
  const primary = createNoise2D(createSeededRandom(`${options.seed}:height:primary`));
  const detail = createNoise2D(createSeededRandom(`${options.seed}:height:detail`));
  const ridge = createNoise2D(createSeededRandom(`${options.seed}:height:ridge`));
  const cellCount = width * height;
  const heightUnits = new Int16Array(cellCount);
  const walkable = new Uint8Array(cellCount);
  const movementCosts = new Uint8Array(cellCount);
  const mountainThreshold = 0.76 - density * 0.3;

  for (let z = 0; z < height; z += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = z * width + x;
      const broad = primary(x / 19, z / 19);
      const fine = detail(x / 7, z / 7);
      const ridgeValue = 1 - Math.abs(ridge(x / 25, z / 25));
      const combined = broad * 0.58 + fine * (0.12 + roughness * 0.18) + ridgeValue * 0.3;
      const quantizedHeight = Math.round(8 + combined * (5 + roughness * 5));
      heightUnits[index] = Math.max(0, quantizedHeight);

      const edgeSafe = x < 5 || x >= width - 5;
      const normalizedZ = z / Math.max(1, height - 1);
      const corridorCenter =
        height / 2 + Math.sin((x / Math.max(1, width - 1)) * Math.PI * 2) * height * 0.08;
      const corridorSafe = Math.abs(z - corridorCenter) <= 2;
      const mountain = combined > mountainThreshold && !edgeSafe && !corridorSafe;
      walkable[index] = mountain ? 0 : 1;

      const roughCost = Math.round(Math.abs(fine) * 4 + Math.max(0, combined) * 3);
      movementCosts[index] = mountain ? 0 : Math.min(20, 10 + roughCost);

      // Keep the top and bottom corners from becoming accidental alternate spawn lanes.
      if ((normalizedZ < 0.02 || normalizedZ > 0.98) && !edgeSafe) {
        movementCosts[index] = mountain ? 0 : Math.max(12, movementCosts[index] ?? 12);
      }
    }
  }

  return {
    width,
    height,
    cellSizeMm: CELL_SIZE_MM,
    heightUnitMm: HEIGHT_UNIT_MM,
    heightUnits,
    walkable,
    movementCosts,
  };
}

export function hasLineOfSight(
  map: BattleMap,
  from: GridCoord,
  to: GridCoord,
): boolean {
  if (!isInsideMap(map, from) || !isInsideMap(map, to)) {
    return false;
  }

  const deltaX = to.x - from.x;
  const deltaZ = to.z - from.z;
  const steps = Math.max(Math.abs(deltaX), Math.abs(deltaZ));
  if (steps <= 1) {
    return true;
  }

  const observerHeight = heightAt(map, from) + 4;
  const targetHeight = heightAt(map, to) + 3;
  let previousIndex = cellIndex(map, from);

  for (let step = 1; step < steps; step += 1) {
    const x = from.x + Math.round((deltaX * step) / steps);
    const z = from.z + Math.round((deltaZ * step) / steps);
    const coord = { x, z };
    const index = cellIndex(map, coord);
    if (index === previousIndex) {
      continue;
    }
    previousIndex = index;

    const terrainHeight = heightAt(map, coord) + (map.walkable[index] === 0 ? 2 : 0);
    const sightHeightNumerator =
      observerHeight * (steps - step) + targetHeight * step;
    if (terrainHeight * steps > sightHeightNumerator) {
      return false;
    }
  }
  return true;
}

export function squaredGridDistance(a: GridCoord, b: GridCoord): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return dx * dx + dz * dz;
}

export function octileCost(a: GridCoord, b: GridCoord): number {
  const dx = Math.abs(a.x - b.x);
  const dz = Math.abs(a.z - b.z);
  const diagonal = Math.min(dx, dz);
  return diagonal * 1_414 + (Math.max(dx, dz) - diagonal) * 1_000;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
