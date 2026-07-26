import { useLayoutEffect, useMemo, useRef } from "react";
import { InstancedMesh, Object3D } from "three";
import {
  STATIC_OBJECT_DEFINITIONS,
  type BattleMap,
  type StaticMapObject,
  type StaticObjectKind,
} from "../sim";
import { visualCellGroundHeight } from "./elevation";

interface StaticObjectsProps {
  readonly map: BattleMap;
}

interface StaticObjectGroups {
  readonly tree: readonly StaticMapObject[];
  readonly rock: readonly StaticMapObject[];
  readonly wall: readonly StaticMapObject[];
}

const TREE_TRUNK_COLOR = "#5b4939";
const TREE_CANOPY_COLOR = "#1f623d";
const ROCK_COLOR = "#66706e";
const WALL_COLOR = "#77766f";
const FACING_STEP_RADIANS = Math.PI / 4;

function compareStaticObjectIds(a: StaticMapObject, b: StaticMapObject): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function groupStaticObjects(objects: readonly StaticMapObject[]): StaticObjectGroups {
  const groups: Record<StaticObjectKind, StaticMapObject[]> = {
    tree: [],
    rock: [],
    wall: [],
  };
  for (const object of objects) {
    groups[object.kind].push(object);
  }
  groups.tree.sort(compareStaticObjectIds);
  groups.rock.sort(compareStaticObjectIds);
  groups.wall.sort(compareStaticObjectIds);
  return groups;
}

function groundHeightMeters(map: BattleMap, object: StaticMapObject): number {
  const index = object.cell.z * map.width + object.cell.x;
  return visualCellGroundHeight(map, index);
}

function objectHeightMeters(map: BattleMap, object: StaticMapObject): number {
  return STATIC_OBJECT_DEFINITIONS[object.kind].heightUnits * (map.heightUnitMm / 1_000);
}

function facingYawRadians(object: StaticMapObject): number {
  return object.facing * FACING_STEP_RADIANS;
}

function finishMatrices(mesh: InstancedMesh | null, count: number): void {
  if (!mesh) {
    return;
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (count > 0) {
    mesh.computeBoundingSphere();
  }
}

export function StaticObjects({ map }: StaticObjectsProps) {
  const treeTrunksRef = useRef<InstancedMesh>(null);
  const treeCanopiesRef = useRef<InstancedMesh>(null);
  const rocksRef = useRef<InstancedMesh>(null);
  const wallsRef = useRef<InstancedMesh>(null);
  const groups = useMemo(() => groupStaticObjects(map.staticObjects), [map.staticObjects]);
  const cellSize = map.cellSizeMm / 1_000;

  useLayoutEffect(() => {
    const dummy = new Object3D();

    groups.tree.forEach((object, index) => {
      const groundY = groundHeightMeters(map, object);
      const height = objectHeightMeters(map, object);
      const trunkHeight = height * 0.5;
      const canopyHeight = height * 0.65;
      const yaw = facingYawRadians(object);

      dummy.position.set(
        object.cell.x * cellSize,
        groundY + trunkHeight / 2,
        object.cell.z * cellSize,
      );
      dummy.rotation.set(0, yaw, 0);
      dummy.scale.set(cellSize * 0.1, trunkHeight, cellSize * 0.1);
      dummy.updateMatrix();
      treeTrunksRef.current?.setMatrixAt(index, dummy.matrix);

      dummy.position.y = groundY + height - canopyHeight / 2;
      dummy.scale.set(cellSize * 0.34, canopyHeight, cellSize * 0.34);
      dummy.updateMatrix();
      treeCanopiesRef.current?.setMatrixAt(index, dummy.matrix);
    });

    groups.rock.forEach((object, index) => {
      const groundY = groundHeightMeters(map, object);
      const height = objectHeightMeters(map, object);
      dummy.position.set(
        object.cell.x * cellSize,
        groundY + height / 2,
        object.cell.z * cellSize,
      );
      dummy.rotation.set(0, facingYawRadians(object), 0);
      dummy.scale.set(cellSize * 0.36, height / 2, cellSize * 0.3);
      dummy.updateMatrix();
      rocksRef.current?.setMatrixAt(index, dummy.matrix);
    });

    groups.wall.forEach((object, index) => {
      const groundY = groundHeightMeters(map, object);
      const height = objectHeightMeters(map, object);
      dummy.position.set(
        object.cell.x * cellSize,
        groundY + height / 2,
        object.cell.z * cellSize,
      );
      // The box extends along local X, perpendicular to the facing normal.
      dummy.rotation.set(0, facingYawRadians(object), 0);
      dummy.scale.set(cellSize * 0.9, height, cellSize * 0.16);
      dummy.updateMatrix();
      wallsRef.current?.setMatrixAt(index, dummy.matrix);
    });

    finishMatrices(treeTrunksRef.current, groups.tree.length);
    finishMatrices(treeCanopiesRef.current, groups.tree.length);
    finishMatrices(rocksRef.current, groups.rock.length);
    finishMatrices(wallsRef.current, groups.wall.length);
  }, [cellSize, groups, map]);

  return (
    <group>
      <instancedMesh
        key={`tree-trunks-${groups.tree.length}`}
        ref={treeTrunksRef}
        args={[undefined, undefined, groups.tree.length]}
        castShadow
        receiveShadow
      >
        <cylinderGeometry args={[1, 1, 1, 8]} />
        <meshStandardMaterial color={TREE_TRUNK_COLOR} roughness={1} />
      </instancedMesh>
      <instancedMesh
        key={`tree-canopies-${groups.tree.length}`}
        ref={treeCanopiesRef}
        args={[undefined, undefined, groups.tree.length]}
        castShadow
      >
        <coneGeometry args={[1, 1, 8]} />
        <meshStandardMaterial
          color={TREE_CANOPY_COLOR}
          emissive="#0a2515"
          emissiveIntensity={0.18}
          roughness={0.96}
        />
      </instancedMesh>
      <instancedMesh
        key={`rocks-${groups.rock.length}`}
        ref={rocksRef}
        args={[undefined, undefined, groups.rock.length]}
        castShadow
        receiveShadow
      >
        <dodecahedronGeometry args={[1, 0]} />
        <meshStandardMaterial color={ROCK_COLOR} roughness={0.96} />
      </instancedMesh>
      <instancedMesh
        key={`walls-${groups.wall.length}`}
        ref={wallsRef}
        args={[undefined, undefined, groups.wall.length]}
        castShadow
        receiveShadow
      >
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial color={WALL_COLOR} roughness={0.92} />
      </instancedMesh>
    </group>
  );
}
