import { useLayoutEffect, useMemo, useRef } from "react";
import {
  BufferGeometry,
  Color,
  Float32BufferAttribute,
  InstancedMesh,
  Object3D,
  Uint32BufferAttribute,
} from "three";
import {
  MAP_CELL_FLAGS,
  SURFACE_TYPE_IDS,
  WATER_DEPTH_UNITS,
  type BattleMap,
} from "../sim";

interface TerrainProps {
  readonly map: BattleMap;
}

const ROCK_COLOR = "#66706e";
const SHRUB_COLOR = "#4f6b4f";
const DEEP_WATER_GROUND = new Color(0.1, 0.24, 0.3);
const SHALLOW_WATER_GROUND = new Color(0.3, 0.47, 0.43);
const WETLAND_WATER_GROUND = new Color(0.32, 0.4, 0.31);

function terrainColor(
  height: number,
  surfaceTypeId: number,
  waterDepthUnits: number,
  cellFlags: number,
): Color {
  let color: Color;
  if ((cellFlags & MAP_CELL_FLAGS.groundBlocked) !== 0) {
    const shade = 0.32 + Math.min(0.16, height * 0.006);
    color = new Color(shade * 0.92, shade, shade * 0.98);
  } else {
    const lift = Math.min(0.12, height * 0.004);
    switch (surfaceTypeId) {
      case SURFACE_TYPE_IDS.sand:
        color = new Color(0.48 + lift, 0.43 + lift, 0.27 + lift * 0.5);
        break;
      case SURFACE_TYPE_IDS.mud:
        color = new Color(0.3 + lift, 0.29 + lift * 0.7, 0.21 + lift * 0.4);
        break;
      case SURFACE_TYPE_IDS.rock:
        color = new Color(0.36 + lift, 0.39 + lift, 0.38 + lift);
        break;
      case SURFACE_TYPE_IDS.paved:
        color = new Color(0.33 + lift, 0.35 + lift, 0.34 + lift);
        break;
      default:
        color = new Color(0.25 + lift, 0.39 + lift, 0.27 + lift);
    }
  }

  if (waterDepthUnits === WATER_DEPTH_UNITS.deep) {
    return color.lerp(DEEP_WATER_GROUND, 0.72);
  }
  if (waterDepthUnits === WATER_DEPTH_UNITS.shallow) {
    return color.lerp(
      surfaceTypeId === SURFACE_TYPE_IDS.mud
        ? WETLAND_WATER_GROUND
        : SHALLOW_WATER_GROUND,
      surfaceTypeId === SURFACE_TYPE_IDS.mud ? 0.22 : 0.42,
    );
  }
  return color;
}

function buildTerrainGeometry(map: BattleMap): BufferGeometry {
  const geometry = new BufferGeometry();
  const cellSize = map.cellSizeMm / 1_000;
  const heightUnit = map.heightUnitMm / 1_000;
  const positions = new Float32Array(map.width * map.height * 3);
  const colors = new Float32Array(map.width * map.height * 3);
  const indices = new Uint32Array((map.width - 1) * (map.height - 1) * 6);

  for (let z = 0; z < map.height; z += 1) {
    for (let x = 0; x < map.width; x += 1) {
      const index = z * map.width + x;
      const offset = index * 3;
      const height = map.layers.heightUnits[index] ?? 0;
      const color = terrainColor(
        height,
        map.layers.surfaceTypeIds[index] ?? SURFACE_TYPE_IDS.grass,
        map.layers.waterDepthUnits[index] ?? WATER_DEPTH_UNITS.none,
        map.layers.cellFlags[index] ?? 0,
      );

      positions[offset] = x * cellSize;
      positions[offset + 1] = height * heightUnit;
      positions[offset + 2] = z * cellSize;
      colors[offset] = color.r;
      colors[offset + 1] = color.g;
      colors[offset + 2] = color.b;
    }
  }

  let indexOffset = 0;
  for (let z = 0; z < map.height - 1; z += 1) {
    for (let x = 0; x < map.width - 1; x += 1) {
      const topLeft = z * map.width + x;
      const topRight = topLeft + 1;
      const bottomLeft = topLeft + map.width;
      const bottomRight = bottomLeft + 1;
      indices[indexOffset] = topLeft;
      indices[indexOffset + 1] = bottomLeft;
      indices[indexOffset + 2] = topRight;
      indices[indexOffset + 3] = topRight;
      indices[indexOffset + 4] = bottomLeft;
      indices[indexOffset + 5] = bottomRight;
      indexOffset += 6;
    }
  }

  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
  geometry.setIndex(new Uint32BufferAttribute(indices, 1));
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function sampleDecorationCells(
  map: BattleMap,
  kind: "rock" | "shrub",
  divisor: number,
): number[] {
  const cells: number[] = [];
  const cellCount = map.width * map.height;
  for (let index = 0; index < cellCount; index += 1) {
    if (
      (map.layers.waterDepthUnits[index] ?? WATER_DEPTH_UNITS.none) !==
      WATER_DEPTH_UNITS.none
    ) {
      continue;
    }
    const cellFlags = map.layers.cellFlags[index] ?? 0;
    const matchesKind =
      kind === "rock"
        ? (cellFlags & MAP_CELL_FLAGS.groundBlocked) !== 0
        : (cellFlags & MAP_CELL_FLAGS.groundBlocked) === 0 &&
          map.layers.surfaceTypeIds[index] === SURFACE_TYPE_IDS.grass;
    if (!matchesKind) {
      continue;
    }
    const hash = Math.imul(index + 17, 2_654_435_761) >>> 0;
    if (hash % divisor === 0) {
      cells.push(index);
    }
  }
  return cells;
}

interface DecorationsProps {
  readonly map: BattleMap;
}

interface WaterCellGroups {
  readonly deep: readonly number[];
  readonly shallow: readonly number[];
  readonly wetland: readonly number[];
}

function collectWaterCells(map: BattleMap): WaterCellGroups {
  const deep: number[] = [];
  const shallow: number[] = [];
  const wetland: number[] = [];
  for (let index = 0; index < map.width * map.height; index += 1) {
    const waterDepth = map.layers.waterDepthUnits[index];
    if (waterDepth === WATER_DEPTH_UNITS.deep) {
      deep.push(index);
    } else if (waterDepth === WATER_DEPTH_UNITS.shallow) {
      if (map.layers.surfaceTypeIds[index] === SURFACE_TYPE_IDS.mud) {
        wetland.push(index);
      } else {
        shallow.push(index);
      }
    }
  }
  return { deep, shallow, wetland };
}

function applyWaterMatrices(
  mesh: InstancedMesh | null,
  map: BattleMap,
  cells: readonly number[],
  elevation: number,
  irregular: boolean,
): void {
  if (!mesh) {
    return;
  }
  const dummy = new Object3D();
  const cellSize = map.cellSizeMm / 1_000;
  const heightUnit = map.heightUnitMm / 1_000;
  cells.forEach((cellIndex, instanceIndex) => {
    const hash = Math.imul(cellIndex + 71, 2_246_822_519) >>> 0;
    dummy.position.set(
      (cellIndex % map.width) * cellSize,
      (map.layers.heightUnits[cellIndex] ?? 0) * heightUnit + elevation,
      Math.floor(cellIndex / map.width) * cellSize,
    );
    dummy.rotation.set(0, irregular ? (hash % 314) / 100 : 0, 0);
    if (irregular) {
      const stretch = 0.88 + (hash % 17) / 100;
      dummy.scale.set(stretch, 1, 1 / stretch);
    } else {
      dummy.scale.set(1, 1, 1);
    }
    dummy.updateMatrix();
    mesh.setMatrixAt(instanceIndex, dummy.matrix);
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
}

function WaterSurfaces({ map }: TerrainProps) {
  const deepRef = useRef<InstancedMesh>(null);
  const shallowRef = useRef<InstancedMesh>(null);
  const wetlandRef = useRef<InstancedMesh>(null);
  const cells = useMemo(() => collectWaterCells(map), [map]);
  const cellSize = map.cellSizeMm / 1_000;

  useLayoutEffect(() => {
    applyWaterMatrices(deepRef.current, map, cells.deep, 0.11, false);
    applyWaterMatrices(shallowRef.current, map, cells.shallow, 0.08, false);
    applyWaterMatrices(wetlandRef.current, map, cells.wetland, 0.065, true);
  }, [cells, map]);

  return (
    <>
      <instancedMesh ref={deepRef} args={[undefined, undefined, cells.deep.length]}>
        <boxGeometry args={[cellSize * 0.98, 0.16, cellSize * 0.98]} />
        <meshStandardMaterial
          color="#28677c"
          emissive="#102f3a"
          emissiveIntensity={0.28}
          roughness={0.22}
        />
      </instancedMesh>
      <instancedMesh ref={shallowRef} args={[undefined, undefined, cells.shallow.length]}>
        <boxGeometry args={[cellSize * 0.98, 0.1, cellSize * 0.98]} />
        <meshStandardMaterial
          color="#66a5a0"
          emissive="#183b3a"
          emissiveIntensity={0.2}
          transparent
          opacity={0.78}
          depthWrite={false}
          roughness={0.38}
        />
      </instancedMesh>
      <instancedMesh ref={wetlandRef} args={[undefined, undefined, cells.wetland.length]}>
        <boxGeometry args={[cellSize * 0.72, 0.08, cellSize * 0.48]} />
        <meshStandardMaterial
          color="#789b89"
          emissive="#253b31"
          emissiveIntensity={0.12}
          transparent
          opacity={0.64}
          depthWrite={false}
          roughness={0.68}
        />
      </instancedMesh>
    </>
  );
}

function Decorations({ map }: DecorationsProps) {
  const rocksRef = useRef<InstancedMesh>(null);
  const shrubsRef = useRef<InstancedMesh>(null);
  const rockCells = useMemo(() => sampleDecorationCells(map, "rock", 3), [map]);
  const shrubCells = useMemo(() => sampleDecorationCells(map, "shrub", 31), [map]);

  useLayoutEffect(() => {
    const dummy = new Object3D();
    const cellSize = map.cellSizeMm / 1_000;
    const heightUnit = map.heightUnitMm / 1_000;

    rockCells.forEach((cellIndex, instanceIndex) => {
      const x = cellIndex % map.width;
      const z = Math.floor(cellIndex / map.width);
      const hash = Math.imul(cellIndex + 31, 1_597_334_677) >>> 0;
      const scale = 1.1 + (hash % 100) / 85;
      dummy.position.set(
        x * cellSize,
        (map.layers.heightUnits[cellIndex] ?? 0) * heightUnit + scale * 0.55,
        z * cellSize,
      );
      dummy.rotation.set(0.08, (hash % 628) / 100, -0.05);
      dummy.scale.set(scale * 1.2, scale, scale);
      dummy.updateMatrix();
      rocksRef.current?.setMatrixAt(instanceIndex, dummy.matrix);
    });

    shrubCells.forEach((cellIndex, instanceIndex) => {
      const x = cellIndex % map.width;
      const z = Math.floor(cellIndex / map.width);
      const hash = Math.imul(cellIndex + 53, 1_103_515_245) >>> 0;
      const scale = 0.7 + (hash % 70) / 100;
      dummy.position.set(
        x * cellSize,
        (map.layers.heightUnits[cellIndex] ?? 0) * heightUnit + scale,
        z * cellSize,
      );
      dummy.rotation.set(0, (hash % 628) / 100, 0);
      dummy.scale.set(scale, scale * 1.4, scale);
      dummy.updateMatrix();
      shrubsRef.current?.setMatrixAt(instanceIndex, dummy.matrix);
    });

    if (rocksRef.current) {
      rocksRef.current.instanceMatrix.needsUpdate = true;
      rocksRef.current.computeBoundingSphere();
    }
    if (shrubsRef.current) {
      shrubsRef.current.instanceMatrix.needsUpdate = true;
      shrubsRef.current.computeBoundingSphere();
    }
  }, [map, rockCells, shrubCells]);

  return (
    <>
      <instancedMesh ref={rocksRef} args={[undefined, undefined, rockCells.length]} castShadow>
        <dodecahedronGeometry args={[0.9, 0]} />
        <meshStandardMaterial color={ROCK_COLOR} roughness={0.96} />
      </instancedMesh>
      <instancedMesh ref={shrubsRef} args={[undefined, undefined, shrubCells.length]} castShadow>
        <coneGeometry args={[0.7, 1.8, 6]} />
        <meshStandardMaterial color={SHRUB_COLOR} roughness={1} />
      </instancedMesh>
    </>
  );
}

export function Terrain({ map }: TerrainProps) {
  const geometry = useMemo(() => buildTerrainGeometry(map), [map]);
  const worldWidth = (map.width - 1) * (map.cellSizeMm / 1_000);
  const worldHeight = (map.height - 1) * (map.cellSizeMm / 1_000);

  return (
    <group>
      <mesh geometry={geometry} receiveShadow>
        <meshStandardMaterial vertexColors roughness={0.94} metalness={0} />
      </mesh>
      <mesh position={[worldWidth / 2, -1.25, worldHeight / 2]} receiveShadow>
        <boxGeometry args={[worldWidth + 10, 2.5, worldHeight + 10]} />
        <meshStandardMaterial color="#343b3a" roughness={1} />
      </mesh>
      <WaterSurfaces map={map} />
      <Decorations map={map} />
    </group>
  );
}
