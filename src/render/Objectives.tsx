import { useEffect, useMemo } from "react";
import {
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Uint32BufferAttribute,
} from "three";
import type { BattleMap, RenderObjective } from "../sim/types";

interface ObjectivesProps {
  readonly map: BattleMap;
  readonly objectives: readonly RenderObjective[];
  readonly factionColors: Readonly<Record<string, string>>;
}

const SEGMENTS = 64;

function sampleTerrainHeight(map: BattleMap, worldX: number, worldZ: number): number {
  const cellSize = map.cellSizeMm / 1_000;
  const heightUnit = map.heightUnitMm / 1_000;
  const gridX = Math.min(map.width - 1, Math.max(0, worldX / cellSize));
  const gridZ = Math.min(map.height - 1, Math.max(0, worldZ / cellSize));
  const x0 = Math.floor(gridX);
  const z0 = Math.floor(gridZ);
  const x1 = Math.min(map.width - 1, x0 + 1);
  const z1 = Math.min(map.height - 1, z0 + 1);
  const tx = gridX - x0;
  const tz = gridZ - z0;
  const heightAt = (x: number, z: number) =>
    (map.layers.heightUnits[z * map.width + x] ?? 0) * heightUnit;
  const top = heightAt(x0, z0) * (1 - tx) + heightAt(x1, z0) * tx;
  const bottom = heightAt(x0, z1) * (1 - tx) + heightAt(x1, z1) * tx;
  return top * (1 - tz) + bottom * tz;
}

function buildDiscGeometry(map: BattleMap, objective: RenderObjective): BufferGeometry {
  const radialSteps = 4;
  const vertices: number[] = [
    objective.worldX,
    sampleTerrainHeight(map, objective.worldX, objective.worldZ) + 0.14,
    objective.worldZ,
  ];
  const indices: number[] = [];

  for (let ring = 1; ring <= radialSteps; ring += 1) {
    const radius = (objective.radiusMeters * ring) / radialSteps;
    for (let segment = 0; segment < SEGMENTS; segment += 1) {
      const angle = (segment / SEGMENTS) * Math.PI * 2;
      const worldX = objective.worldX + Math.cos(angle) * radius;
      const worldZ = objective.worldZ + Math.sin(angle) * radius;
      vertices.push(worldX, sampleTerrainHeight(map, worldX, worldZ) + 0.14, worldZ);
    }
  }

  for (let segment = 0; segment < SEGMENTS; segment += 1) {
    indices.push(0, 1 + segment, 1 + ((segment + 1) % SEGMENTS));
  }

  for (let ring = 1; ring < radialSteps; ring += 1) {
    const innerStart = 1 + (ring - 1) * SEGMENTS;
    const outerStart = 1 + ring * SEGMENTS;
    for (let segment = 0; segment < SEGMENTS; segment += 1) {
      const next = (segment + 1) % SEGMENTS;
      indices.push(
        innerStart + segment,
        outerStart + segment,
        innerStart + next,
        innerStart + next,
        outerStart + segment,
        outerStart + next,
      );
    }
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(vertices, 3));
  geometry.setIndex(new Uint32BufferAttribute(indices, 1));
  geometry.computeBoundingSphere();
  return geometry;
}

function buildRingGeometry(
  map: BattleMap,
  objective: RenderObjective,
  innerRadius: number,
  outerRadius: number,
  fraction = 1,
): BufferGeometry {
  const segmentCount = Math.max(1, Math.ceil(SEGMENTS * Math.min(1, Math.max(0, fraction))));
  const vertices: number[] = [];
  const indices: number[] = [];
  const pointCount = fraction >= 1 ? segmentCount : segmentCount + 1;

  for (let segment = 0; segment <= pointCount; segment += 1) {
    const normalized = Math.min(1, segment / SEGMENTS);
    const angle = -Math.PI / 2 + normalized * Math.PI * 2;
    for (const radius of [innerRadius, outerRadius]) {
      const worldX = objective.worldX + Math.cos(angle) * radius;
      const worldZ = objective.worldZ + Math.sin(angle) * radius;
      vertices.push(worldX, sampleTerrainHeight(map, worldX, worldZ) + 0.2, worldZ);
    }
  }

  const quads = fraction >= 1 ? pointCount : Math.min(segmentCount, pointCount - 1);
  for (let segment = 0; segment < quads; segment += 1) {
    const current = segment * 2;
    const next = ((segment + 1) % pointCount) * 2;
    indices.push(current, next, current + 1, current + 1, next, next + 1);
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(vertices, 3));
  geometry.setIndex(new Uint32BufferAttribute(indices, 1));
  geometry.computeBoundingSphere();
  return geometry;
}

function stateColor(
  objective: RenderObjective,
  factionColors: Readonly<Record<string, string>>,
): string {
  switch (objective.state) {
    case "attacker-controlled":
      return factionColors[objective.attackerFactionId] ?? "#e45f62";
    case "defender-controlled":
      return factionColors[objective.defenderFactionId] ?? "#3e8fd1";
    case "capturing":
      return "#e4b95f";
    case "contested":
      return "#df705f";
    case "recovering":
      return "#69b894";
    default:
      return "#89949c";
  }
}

interface ObjectiveZoneProps {
  readonly map: BattleMap;
  readonly objective: RenderObjective;
  readonly factionColors: Readonly<Record<string, string>>;
}

function ObjectiveZone({ map, objective, factionColors }: ObjectiveZoneProps) {
  const disc = useMemo(() => buildDiscGeometry(map, objective), [map, objective]);
  const border = useMemo(
    () =>
      buildRingGeometry(
        map,
        objective,
        Math.max(0.1, objective.radiusMeters - 0.55),
        objective.radiusMeters,
      ),
    [map, objective],
  );
  const progress = useMemo(
    () =>
      buildRingGeometry(
        map,
        objective,
        objective.radiusMeters + 0.45,
        objective.radiusMeters + 1.15,
        objective.progressBps / 10_000,
      ),
    [map, objective],
  );
  const color = stateColor(objective, factionColors);

  useEffect(
    () => () => {
      disc.dispose();
      border.dispose();
      progress.dispose();
    },
    [border, disc, progress],
  );

  return (
    <group>
      <mesh geometry={disc} renderOrder={3}>
        <meshBasicMaterial
          color={color}
          transparent
          opacity={objective.state === "contested" ? 0.22 : 0.14}
          depthWrite={false}
          side={DoubleSide}
          toneMapped={false}
        />
      </mesh>
      <mesh geometry={border} renderOrder={4}>
        <meshBasicMaterial
          color="#f0c765"
          transparent
          opacity={0.94}
          depthWrite={false}
          side={DoubleSide}
          toneMapped={false}
        />
      </mesh>
      {objective.progressBps > 0 && (
        <mesh geometry={progress} renderOrder={5}>
          <meshBasicMaterial
            color="#fff0aa"
            depthWrite={false}
            side={DoubleSide}
            toneMapped={false}
          />
        </mesh>
      )}
      <mesh position={[objective.worldX, objective.worldY + 3.3, objective.worldZ]}>
        <octahedronGeometry args={[1.05, 0]} />
        <meshBasicMaterial color={color} toneMapped={false} />
      </mesh>
      <mesh position={[objective.worldX, objective.worldY + 1.55, objective.worldZ]}>
        <cylinderGeometry args={[0.12, 0.12, 3.1, 8]} />
        <meshBasicMaterial color="#f0c765" toneMapped={false} />
      </mesh>
    </group>
  );
}

export function Objectives({ map, objectives, factionColors }: ObjectivesProps) {
  return (
    <group>
      {objectives.map((objective) => (
        <ObjectiveZone
          key={objective.id}
          map={map}
          objective={objective}
          factionColors={factionColors}
        />
      ))}
    </group>
  );
}
