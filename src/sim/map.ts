import { createNoise2D } from "simplex-noise";
import { createSeededRandom, deterministicUint32, StateHasher } from "./rng";
import {
  BATTLE_MAP_SCHEMA_VERSION,
  MAP_CELL_FLAGS,
  STATIC_OBJECT_DEFINITIONS,
  SURFACE_TYPE_IDS,
  WATER_DEPTH_UNITS,
  type BattleMap,
  type GridCoord,
  type MovementType,
  type StaticMapObject,
  type StaticObjectFacing,
  type StaticObjectKind,
} from "./types";

export interface MapGenerationOptions {
  readonly seed: string;
  readonly width: number;
  readonly height: number;
  /** Mountain share of all cells. */
  readonly mountainDensity: number;
  readonly roughness: number;
  /** Open shallow/deep water share of all cells, excluding wetlands. */
  readonly waterCoverage?: number;
  /** Additional mud-and-shallow-water share of all cells. */
  readonly wetlandCoverage?: number;
  /** Movement-blocking tree objects as a share of all cells. */
  readonly treeCoverage?: number;
  /** Movement-blocking rock objects as a share of all cells. */
  readonly rockCoverage?: number;
  /** Movement-blocking wall objects as a share of all cells. */
  readonly wallCoverage?: number;
}

interface RankedCell {
  readonly index: number;
  readonly score: number;
}

interface StaticObjectPlacement {
  readonly seed: string;
  readonly width: number;
  readonly height: number;
  readonly kind: StaticObjectKind;
  readonly coverage: number;
  readonly surfaceTypeIds: Uint16Array;
  readonly waterDepthUnits: Uint8Array;
  readonly cellFlags: Uint16Array;
  readonly staticOccupancy: Uint8Array;
  readonly staticObjects: StaticMapObject[];
}

const CELL_SIZE_MM = 4_000;
const HEIGHT_UNIT_MM = 500;
const KNOWN_CELL_FLAGS = MAP_CELL_FLAGS.groundBlocked;
const DEPLOYMENT_BAND_WIDTH = 5;
const PRIMARY_ROUTE_HALF_WIDTH = 2.5;
const MAX_MAP_CELL_COUNT = 512 * 512;
const MAX_MAP_ASPECT_RATIO = 4;
const STATIC_OBJECT_DEFINITIONS_BY_TYPE_ID = [
  undefined,
  STATIC_OBJECT_DEFINITIONS.tree,
  STATIC_OBJECT_DEFINITIONS.rock,
  STATIC_OBJECT_DEFINITIONS.wall,
] as const;

export const FOOT_MOVEMENT_COST_MATRIX = [
  // Rows use SURFACE_TYPE_IDS; columns use WATER_DEPTH_UNITS. Zero is impassable.
  [10, 16, 0],
  [13, 19, 0],
  [16, 24, 0],
  [12, 18, 0],
  [8, 14, 0],
] as const;

export const WHEELED_MOVEMENT_COST_MATRIX = [
  // Wheeled vehicles strongly prefer paved ground and cannot cross wetlands.
  [12, 24, 0],
  [18, 28, 0],
  [30, 0, 0],
  [20, 0, 0],
  [6, 16, 0],
] as const;

export const TRACKED_MOVEMENT_COST_MATRIX = [
  // Tracked vehicles trade road speed for broader rough-terrain access.
  [11, 16, 0],
  [12, 17, 0],
  [14, 20, 0],
  [14, 19, 0],
  [8, 14, 0],
] as const;

export const HOVER_MOVEMENT_COST_MATRIX = [
  // Hover movement ignores ground composition while remaining grid-bounded.
  [10, 10, 10],
  [10, 10, 10],
  [10, 10, 10],
  [10, 10, 10],
  [10, 10, 10],
] as const;

export const MOVEMENT_SLOPE_LIMIT_HEIGHT_UNITS = {
  // Foot keeps the stage-2 behavior; vehicle limits apply per adjacent step.
  foot: Number.POSITIVE_INFINITY,
  wheeled: 2,
  tracked: 4,
  hover: Number.POSITIVE_INFINITY,
} as const satisfies Readonly<Record<MovementType, number>>;

const MOVEMENT_COST_MATRICES = {
  foot: FOOT_MOVEMENT_COST_MATRIX,
  wheeled: WHEELED_MOVEMENT_COST_MATRIX,
  tracked: TRACKED_MOVEMENT_COST_MATRIX,
  hover: HOVER_MOVEMENT_COST_MATRIX,
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

export function primaryAttackRouteCenterZ(
  width: number,
  height: number,
  x: number,
): number {
  return (
    height / 2 +
    Math.sin((x / Math.max(1, width - 1)) * Math.PI * 2) * height * 0.08
  );
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
  if (!Number.isInteger(index) || index < 0 || index >= map.width * map.height) {
    return 0;
  }
  const staticObjectDefinition =
    STATIC_OBJECT_DEFINITIONS_BY_TYPE_ID[map.layers.staticOccupancy[index] ?? 0];
  if (
    movementType !== "hover" &&
    (((map.layers.cellFlags[index] ?? 0) & MAP_CELL_FLAGS.groundBlocked) !== 0 ||
      staticObjectDefinition?.blocksMovement)
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
  if (width * height > MAX_MAP_CELL_COUNT) {
    throw new Error(`Battle maps cannot exceed ${MAX_MAP_CELL_COUNT} cells.`);
  }
  if (Math.max(width / height, height / width) > MAX_MAP_ASPECT_RATIO) {
    throw new Error(`Battle map aspect ratio cannot exceed ${MAX_MAP_ASPECT_RATIO}:1.`);
  }

  const density = validateRatio("mountainDensity", options.mountainDensity);
  const roughness = validateRatio("roughness", options.roughness);
  const waterCoverage = validateRatio("waterCoverage", options.waterCoverage ?? 0);
  const wetlandCoverage = validateRatio("wetlandCoverage", options.wetlandCoverage ?? 0);
  const treeCoverage = validateRatio("treeCoverage", options.treeCoverage ?? 0);
  const rockCoverage = validateRatio("rockCoverage", options.rockCoverage ?? 0);
  const wallCoverage = validateRatio("wallCoverage", options.wallCoverage ?? 0);
  const primary = createNoise2D(createSeededRandom(`${options.seed}:height:primary`));
  const detail = createNoise2D(createSeededRandom(`${options.seed}:height:detail`));
  const ridge = createNoise2D(createSeededRandom(`${options.seed}:height:ridge`));
  const waterPrimary = createNoise2D(createSeededRandom(`${options.seed}:water:primary`));
  const waterDetail = createNoise2D(createSeededRandom(`${options.seed}:water:detail`));
  const wetlandPrimary = createNoise2D(createSeededRandom(`${options.seed}:wetland:primary`));
  const wetlandDetail = createNoise2D(createSeededRandom(`${options.seed}:wetland:detail`));
  const cellCount = width * height;
  const heightUnits = new Int16Array(cellCount);
  const surfaceTypeIds = new Uint16Array(cellCount);
  const waterDepthUnits = new Uint8Array(cellCount);
  const cellFlags = new Uint16Array(cellCount);
  const staticOccupancy = new Uint8Array(cellCount);
  const mountainCandidates: RankedCell[] = [];

  for (let z = 0; z < height; z += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = z * width + x;
      const broad = primary(x / 19, z / 19);
      const fine = detail(x / 7, z / 7);
      const ridgeValue = 1 - Math.abs(ridge(x / 25, z / 25));
      const combined = broad * 0.58 + fine * (0.12 + roughness * 0.18) + ridgeValue * 0.3;
      const quantizedHeight = Math.round(8 + combined * (5 + roughness * 5));
      heightUnits[index] = Math.max(0, quantizedHeight);

      const routeSafe = isProtectedRouteCell(width, height, x, z);
      const normalizedZ = z / Math.max(1, height - 1);
      const roughCost = Math.round(Math.abs(fine) * 4 + Math.max(0, combined) * 3);
      if (!routeSafe) {
        mountainCandidates.push({ index, score: combined });
      }
      if (roughCost >= 5) {
        surfaceTypeIds[index] = SURFACE_TYPE_IDS.mud;
      } else if (
        roughCost >= 3 ||
        ((normalizedZ < 0.02 || normalizedZ > 0.98) && !routeSafe)
      ) {
        surfaceTypeIds[index] = SURFACE_TYPE_IDS.sand;
      } else {
        surfaceTypeIds[index] = SURFACE_TYPE_IDS.grass;
      }
    }
  }

  mountainCandidates.sort((a, b) => b.score - a.score || a.index - b.index);
  const mountainCellCount = Math.round(cellCount * density);
  assertCoverageAvailable("mountainDensity", mountainCellCount, mountainCandidates.length);
  for (let rank = 0; rank < mountainCellCount; rank += 1) {
    const index = mountainCandidates[rank]?.index;
    if (index === undefined) {
      break;
    }
    surfaceTypeIds[index] = SURFACE_TYPE_IDS.rock;
    cellFlags[index] = MAP_CELL_FLAGS.groundBlocked;
  }

  const waterCandidates: RankedCell[] = [];
  for (let index = 0; index < cellCount; index += 1) {
    const x = index % width;
    const z = Math.floor(index / width);
    if (
      isProtectedRouteCell(width, height, x, z) ||
      ((cellFlags[index] ?? 0) & MAP_CELL_FLAGS.groundBlocked) !== 0
    ) {
      continue;
    }
    const score =
      waterPrimary(x / 21, z / 21) * 0.68 +
      waterDetail(x / 7, z / 7) * 0.2 +
      (heightUnits[index] ?? 0) * 0.025;
    waterCandidates.push({ index, score });
  }
  waterCandidates.sort((a, b) => a.score - b.score || a.index - b.index);
  const waterCellCount = Math.round(cellCount * waterCoverage);
  assertCoverageAvailable("waterCoverage", waterCellCount, waterCandidates.length);
  const deepWaterCellCount = Math.round(waterCellCount * 0.55);
  for (let rank = 0; rank < waterCellCount; rank += 1) {
    const index = waterCandidates[rank]?.index;
    if (index === undefined) {
      break;
    }
    waterDepthUnits[index] =
      rank < deepWaterCellCount ? WATER_DEPTH_UNITS.deep : WATER_DEPTH_UNITS.shallow;
    surfaceTypeIds[index] = SURFACE_TYPE_IDS.sand;
  }

  const wetlandCandidates: RankedCell[] = [];
  for (let index = 0; index < cellCount; index += 1) {
    const x = index % width;
    const z = Math.floor(index / width);
    if (
      isProtectedRouteCell(width, height, x, z) ||
      waterDepthUnits[index] !== WATER_DEPTH_UNITS.none ||
      ((cellFlags[index] ?? 0) & MAP_CELL_FLAGS.groundBlocked) !== 0
    ) {
      continue;
    }
    const adjacentWater = countAdjacentWater(width, height, waterDepthUnits, x, z);
    const score =
      wetlandPrimary(x / 17, z / 17) * 0.62 +
      wetlandDetail(x / 6, z / 6) * 0.18 +
      adjacentWater * 0.22 -
      (heightUnits[index] ?? 0) * 0.018;
    wetlandCandidates.push({ index, score });
  }
  wetlandCandidates.sort((a, b) => b.score - a.score || a.index - b.index);
  const wetlandCellCount = Math.round(cellCount * wetlandCoverage);
  assertCoverageAvailable("wetlandCoverage", wetlandCellCount, wetlandCandidates.length);
  for (let rank = 0; rank < wetlandCellCount; rank += 1) {
    const index = wetlandCandidates[rank]?.index;
    if (index === undefined) {
      break;
    }
    surfaceTypeIds[index] = SURFACE_TYPE_IDS.mud;
    waterDepthUnits[index] = WATER_DEPTH_UNITS.shallow;
  }

  const staticObjects: StaticMapObject[] = [];
  placeStaticObjects({
    seed: options.seed,
    width,
    height,
    kind: "tree",
    coverage: treeCoverage,
    surfaceTypeIds,
    waterDepthUnits,
    cellFlags,
    staticOccupancy,
    staticObjects,
  });
  placeStaticObjects({
    seed: options.seed,
    width,
    height,
    kind: "rock",
    coverage: rockCoverage,
    surfaceTypeIds,
    waterDepthUnits,
    cellFlags,
    staticOccupancy,
    staticObjects,
  });
  placeStaticObjects({
    seed: options.seed,
    width,
    height,
    kind: "wall",
    coverage: wallCoverage,
    surfaceTypeIds,
    waterDepthUnits,
    cellFlags,
    staticOccupancy,
    staticObjects,
  });
  staticObjects.sort((a, b) => compareStrings(a.id, b.id));

  const map: BattleMap = {
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
      staticOccupancy,
    },
    staticObjects,
  };
  validateBattleMap(map);
  return map;
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
  const {
    heightUnits,
    surfaceTypeIds,
    waterDepthUnits,
    cellFlags,
    staticOccupancy,
  } = map.layers;
  if (
    !(heightUnits instanceof Int16Array) ||
    !(surfaceTypeIds instanceof Uint16Array) ||
    !(waterDepthUnits instanceof Uint8Array) ||
    !(cellFlags instanceof Uint16Array) ||
    !(staticOccupancy instanceof Uint8Array)
  ) {
    throw new Error("Map layers must use their declared TypedArray types.");
  }
  const expectedLength = map.width * map.height;
  if (
    heightUnits.length !== expectedLength ||
    surfaceTypeIds.length !== expectedLength ||
    waterDepthUnits.length !== expectedLength ||
    cellFlags.length !== expectedLength ||
    staticOccupancy.length !== expectedLength
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
    const staticTypeId = staticOccupancy[index] ?? 0;
    if (
      staticTypeId !== 0 &&
      STATIC_OBJECT_DEFINITIONS_BY_TYPE_ID[staticTypeId] === undefined
    ) {
      throw new Error(`Map cell ${index} has an unsupported static occupancy type.`);
    }
  }

  if (!Array.isArray(map.staticObjects)) {
    throw new Error("Battle maps must define a static object list.");
  }
  const objectIds = new Set<string>();
  const objectCells = new Set<number>();
  for (const rawObject of map.staticObjects as readonly unknown[]) {
    if (!rawObject || typeof rawObject !== "object") {
      throw new Error("Static objects must be structured object records.");
    }
    const object = rawObject as StaticMapObject;
    if (typeof object.id !== "string" || !object.id || objectIds.has(object.id)) {
      throw new Error(`Static object ID must be non-empty and unique: ${object.id}.`);
    }
    objectIds.add(object.id);
    if (
      typeof object.kind !== "string" ||
      !Object.prototype.hasOwnProperty.call(STATIC_OBJECT_DEFINITIONS, object.kind)
    ) {
      throw new Error(`Static object ${object.id} has an unsupported kind.`);
    }
    const definition = STATIC_OBJECT_DEFINITIONS[object.kind as StaticObjectKind];
    if (
      !Number.isInteger(object.facing) ||
      object.facing < 0 ||
      object.facing > 7
    ) {
      throw new Error(`Static object ${object.id} has an invalid facing.`);
    }
    if (!object.cell || !isInsideMap(map, object.cell)) {
      throw new Error(`Static object ${object.id} has an out-of-bounds cell.`);
    }
    const index = cellIndex(map, object.cell);
    if (objectCells.has(index)) {
      throw new Error(`Multiple static objects cannot occupy map cell ${index}.`);
    }
    objectCells.add(index);
    if (staticOccupancy[index] !== definition.typeId) {
      throw new Error(`Static object type does not match occupancy at map cell ${index}.`);
    }
    if (waterDepthUnits[index] !== WATER_DEPTH_UNITS.none) {
      throw new Error(`Static object ${object.id} cannot overlap water.`);
    }
    if (((cellFlags[index] ?? 0) & MAP_CELL_FLAGS.groundBlocked) !== 0) {
      throw new Error(`Static object ${object.id} cannot overlap blocked ground.`);
    }
  }
  for (let index = 0; index < expectedLength; index += 1) {
    if ((staticOccupancy[index] ?? 0) !== 0 && !objectCells.has(index)) {
      throw new Error(`Static occupancy at map cell ${index} has no static object.`);
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
  addLayerToHash(hasher, "static-occupancy", map.layers.staticOccupancy);
  for (const object of [...map.staticObjects].sort((a, b) => compareStrings(a.id, b.id))) {
    hasher.addString(object.id);
    hasher.addString(object.kind);
    hasher.addNumber(object.cell.x);
    hasher.addNumber(object.cell.z);
    hasher.addNumber(object.facing);
  }
  return hasher.digest();
}

export function hasLineOfSight(
  map: BattleMap,
  from: GridCoord,
  to: GridCoord,
  options: {
    readonly ignoredStaticObjectCells?: readonly GridCoord[];
    readonly observerHeightUnits?: number;
    readonly targetHeightUnits?: number;
  } = {},
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

  const observerHeight = options.observerHeightUnits ?? heightAt(map, from) + 4;
  const targetHeight = options.targetHeightUnits ?? heightAt(map, to) + 3;
  const ignoredStaticObjectIndices = (options.ignoredStaticObjectCells ?? [])
    .filter((coord) => isInsideMap(map, coord))
    .map((coord) => cellIndex(map, coord));
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

    const staticObjectDefinition =
      ignoredStaticObjectIndices.includes(index)
        ? undefined
        : STATIC_OBJECT_DEFINITIONS_BY_TYPE_ID[map.layers.staticOccupancy[index] ?? 0];
    const terrainHeight =
      heightAt(map, coord) +
      Math.max(
        ((map.layers.cellFlags[index] ?? 0) & MAP_CELL_FLAGS.groundBlocked) !== 0
          ? 2
          : 0,
        staticObjectDefinition?.blocksSight ? staticObjectDefinition.heightUnits : 0,
      );
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

function isProtectedRouteCell(
  width: number,
  height: number,
  x: number,
  z: number,
): boolean {
  if (x < DEPLOYMENT_BAND_WIDTH || x >= width - DEPLOYMENT_BAND_WIDTH) {
    return true;
  }
  const corridorCenter = primaryAttackRouteCenterZ(width, height, x);
  return Math.abs(z - corridorCenter) <= PRIMARY_ROUTE_HALF_WIDTH;
}

function countAdjacentWater(
  width: number,
  height: number,
  waterDepthUnits: Uint8Array,
  x: number,
  z: number,
): number {
  let count = 0;
  for (let dz = -1; dz <= 1; dz += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      if (
        (dx === 0 && dz === 0) ||
        x + dx < 0 ||
        x + dx >= width ||
        z + dz < 0 ||
        z + dz >= height
      ) {
        continue;
      }
      const index = (z + dz) * width + x + dx;
      if ((waterDepthUnits[index] ?? WATER_DEPTH_UNITS.none) !== WATER_DEPTH_UNITS.none) {
        count += 1;
      }
    }
  }
  return count;
}

function placeStaticObjects(placement: StaticObjectPlacement): void {
  const {
    seed,
    width,
    height,
    kind,
    coverage,
    surfaceTypeIds,
    waterDepthUnits,
    cellFlags,
    staticOccupancy,
    staticObjects,
  } = placement;
  const candidates: RankedCell[] = [];
  for (let index = 0; index < width * height; index += 1) {
    const x = index % width;
    const z = Math.floor(index / width);
    if (
      isProtectedRouteCell(width, height, x, z) ||
      waterDepthUnits[index] !== WATER_DEPTH_UNITS.none ||
      ((cellFlags[index] ?? 0) & MAP_CELL_FLAGS.groundBlocked) !== 0 ||
      staticOccupancy[index] !== 0 ||
      (kind === "tree" && surfaceTypeIds[index] !== SURFACE_TYPE_IDS.grass)
    ) {
      continue;
    }
    candidates.push({
      index,
      score: deterministicUint32(seed, `map-static-${kind}`, 0, String(index), 0),
    });
  }
  candidates.sort((a, b) => a.score - b.score || a.index - b.index);

  const requestedCells = Math.round(width * height * coverage);
  assertCoverageAvailable(`${kind}Coverage`, requestedCells, candidates.length);
  const definition = STATIC_OBJECT_DEFINITIONS[kind];
  for (let rank = 0; rank < requestedCells; rank += 1) {
    const index = candidates[rank]?.index;
    if (index === undefined) {
      break;
    }
    staticOccupancy[index] = definition.typeId;
    staticObjects.push({
      id: `static-${kind}-${index.toString().padStart(6, "0")}`,
      kind,
      cell: { x: index % width, z: Math.floor(index / width) },
      facing: (deterministicUint32(
        seed,
        `map-static-${kind}-facing`,
        0,
        String(index),
        0,
      ) % 8) as StaticObjectFacing,
    });
  }
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function validateRatio(name: string, value: number): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${name} must be a finite number from 0 to 1.`);
  }
  return value;
}

function assertCoverageAvailable(
  name: string,
  requestedCells: number,
  availableCells: number,
): void {
  if (requestedCells > availableCells) {
    throw new Error(
      `${name} cannot be satisfied: requested ${requestedCells} cells but only ${availableCells} are eligible.`,
    );
  }
}
