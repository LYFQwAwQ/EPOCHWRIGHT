import { createNoise2D } from "simplex-noise";
import { createSeededRandom, StateHasher } from "./rng";
import {
  BATTLE_MAP_SCHEMA_VERSION,
  MAP_CELL_FLAGS,
  SURFACE_TYPE_IDS,
  WATER_DEPTH_UNITS,
  type BattleMap,
  type GridCoord,
  type MovementType,
} from "./types";

export interface MapGenerationOptions {
  readonly seed: string;
  readonly width: number;
  readonly height: number;
  readonly mountainDensity: number;
  readonly roughness: number;
}

const CELL_SIZE_MM = 4_000;
const HEIGHT_UNIT_MM = 500;
const KNOWN_CELL_FLAGS = MAP_CELL_FLAGS.groundBlocked;

export const FOOT_MOVEMENT_COST_MATRIX = [
  // Rows use SURFACE_TYPE_IDS; columns use WATER_DEPTH_UNITS. Zero is impassable.
  [10, 16, 0],
  [13, 19, 0],
  [16, 24, 0],
  [12, 18, 0],
  [8, 14, 0],
] as const;

const MOVEMENT_COST_MATRICES = {
  foot: FOOT_MOVEMENT_COST_MATRIX,
} as const satisfies Readonly<Record<MovementType, readonly (readonly number[])[]>>;

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

export function movementCostAtIndex(
  map: BattleMap,
  index: number,
  movementType: MovementType = "foot",
): number {
  if (
    !Number.isInteger(index) ||
    index < 0 ||
    index >= map.width * map.height ||
    ((map.layers.cellFlags[index] ?? 0) & MAP_CELL_FLAGS.groundBlocked) !== 0
  ) {
    return 0;
  }
  const surfaceTypeId = map.layers.surfaceTypeIds[index];
  const waterDepthUnits = map.layers.waterDepthUnits[index];
  if (surfaceTypeId === undefined || waterDepthUnits === undefined) {
    return 0;
  }
  return MOVEMENT_COST_MATRICES[movementType][surfaceTypeId]?.[waterDepthUnits] ?? 0;
}

export function movementCostAt(
  map: BattleMap,
  coord: GridCoord,
  movementType: MovementType = "foot",
): number {
  return isInsideMap(map, coord)
    ? movementCostAtIndex(map, cellIndex(map, coord), movementType)
    : 0;
}

export function isWalkable(
  map: BattleMap,
  coord: GridCoord,
  movementType: MovementType = "foot",
): boolean {
  return movementCostAt(map, coord, movementType) > 0;
}

export function heightAt(map: BattleMap, coord: GridCoord): number {
  if (!isInsideMap(map, coord)) {
    return 0;
  }
  return map.layers.heightUnits[cellIndex(map, coord)] ?? 0;
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
  const surfaceTypeIds = new Uint16Array(cellCount);
  const waterDepthUnits = new Uint8Array(cellCount);
  const cellFlags = new Uint16Array(cellCount);
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
      const roughCost = Math.round(Math.abs(fine) * 4 + Math.max(0, combined) * 3);
      if (mountain) {
        surfaceTypeIds[index] = SURFACE_TYPE_IDS.rock;
        cellFlags[index] = MAP_CELL_FLAGS.groundBlocked;
      } else if (roughCost >= 5) {
        surfaceTypeIds[index] = SURFACE_TYPE_IDS.mud;
      } else if (roughCost >= 3 || ((normalizedZ < 0.02 || normalizedZ > 0.98) && !edgeSafe)) {
        surfaceTypeIds[index] = SURFACE_TYPE_IDS.sand;
      } else {
        surfaceTypeIds[index] = SURFACE_TYPE_IDS.grass;
      }
    }
  }

  return {
    schemaVersion: BATTLE_MAP_SCHEMA_VERSION,
    width,
    height,
    cellSizeMm: CELL_SIZE_MM,
    heightUnitMm: HEIGHT_UNIT_MM,
    layers: {
      heightUnits,
      surfaceTypeIds,
      waterDepthUnits,
      cellFlags,
    },
  };
}

export function validateBattleMap(map: BattleMap): void {
  if (map.schemaVersion !== BATTLE_MAP_SCHEMA_VERSION) {
    throw new Error(`Unsupported battle map schema version: ${String(map.schemaVersion)}.`);
  }
  if (
    !Number.isInteger(map.width) ||
    !Number.isInteger(map.height) ||
    map.width <= 0 ||
    map.height <= 0
  ) {
    throw new Error("Map dimensions must be positive integers.");
  }
  if (
    !Number.isInteger(map.cellSizeMm) ||
    !Number.isInteger(map.heightUnitMm) ||
    map.cellSizeMm <= 0 ||
    map.heightUnitMm <= 0
  ) {
    throw new Error("Map scale values must be positive integers.");
  }

  if (!map.layers) {
    throw new Error("Battle maps must define standard terrain layers.");
  }
  const { heightUnits, surfaceTypeIds, waterDepthUnits, cellFlags } = map.layers;
  if (
    !(heightUnits instanceof Int16Array) ||
    !(surfaceTypeIds instanceof Uint16Array) ||
    !(waterDepthUnits instanceof Uint8Array) ||
    !(cellFlags instanceof Uint16Array)
  ) {
    throw new Error("Map layers must use their declared TypedArray types.");
  }
  const expectedLength = map.width * map.height;
  if (
    heightUnits.length !== expectedLength ||
    surfaceTypeIds.length !== expectedLength ||
    waterDepthUnits.length !== expectedLength ||
    cellFlags.length !== expectedLength
  ) {
    throw new Error("Every fixed map layer must have width * height entries.");
  }

  for (let index = 0; index < expectedLength; index += 1) {
    const surfaceTypeId = surfaceTypeIds[index] ?? -1;
    if (surfaceTypeId < SURFACE_TYPE_IDS.grass || surfaceTypeId > SURFACE_TYPE_IDS.paved) {
      throw new Error(`Map cell ${index} has an invalid surface type ID.`);
    }
    const waterDepth = waterDepthUnits[index] ?? -1;
    if (waterDepth < WATER_DEPTH_UNITS.none || waterDepth > WATER_DEPTH_UNITS.deep) {
      throw new Error(`Map cell ${index} has an invalid water depth.`);
    }
    const flags = cellFlags[index] ?? 0;
    if ((flags & ~KNOWN_CELL_FLAGS) !== 0) {
      throw new Error(`Map cell ${index} has unsupported cell flags.`);
    }
  }
}

export function hashBattleMap(map: BattleMap): string {
  const hasher = new StateHasher();
  hasher.addString(map.schemaVersion);
  hasher.addNumber(map.width);
  hasher.addNumber(map.height);
  hasher.addNumber(map.cellSizeMm);
  hasher.addNumber(map.heightUnitMm);
  addLayerToHash(hasher, "height", map.layers.heightUnits);
  addLayerToHash(hasher, "surface", map.layers.surfaceTypeIds);
  addLayerToHash(hasher, "water", map.layers.waterDepthUnits);
  addLayerToHash(hasher, "flags", map.layers.cellFlags);
  return hasher.digest();
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

    const terrainHeight =
      heightAt(map, coord) +
      (((map.layers.cellFlags[index] ?? 0) & MAP_CELL_FLAGS.groundBlocked) !== 0 ? 2 : 0);
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

function addLayerToHash(
  hasher: StateHasher,
  name: string,
  values: Int16Array | Uint8Array | Uint16Array,
): void {
  hasher.addString(name);
  hasher.addNumber(values.length);
  for (const value of values) {
    hasher.addNumber(value);
  }
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}
