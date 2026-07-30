import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { InstancedMesh, Object3D, Quaternion, Vector3 } from "three";
import type { BattleEvent, BattleMap, RenderFrame } from "../sim/types";
import { visualCellGroundHeight, visualWorldY } from "./elevation";
import { artilleryMuzzleWorldPosition } from "./platformVisuals";

interface ProjectileEffectsProps {
  readonly map: BattleMap;
  readonly frame: RenderFrame;
  readonly events: readonly BattleEvent[];
  readonly maxTracers: number;
  readonly maxBursts: number;
}

interface ImpactBurst {
  readonly key: string;
  readonly position: Vector3;
  readonly startedAt: number;
  readonly durationMs: number;
}

interface LaunchCue {
  readonly key: string;
  readonly position: Vector3;
  readonly startedAt: number;
  readonly durationMs: number;
}

const POSITION_SMOOTHING_RATE = 10;
const TRACER_LENGTH_METERS = 4.2;
const shellAxis = new Vector3(0, 1, 0);
const tracerAxis = new Vector3(0, 0, 1);
const horizontalQuaternion = new Quaternion().setFromAxisAngle(
  new Vector3(1, 0, 0),
  -Math.PI / 2,
);
const hiddenScale = new Vector3(0, 0, 0);

function smoothingAlpha(deltaSeconds: number): number {
  return 1 - Math.exp(-POSITION_SMOOTHING_RATE * Math.max(0, deltaSeconds));
}

export function ProjectileEffects({
  map,
  frame,
  events,
  maxTracers,
  maxBursts,
}: ProjectileEffectsProps) {
  const shellMeshRef = useRef<InstancedMesh>(null);
  const shellGlowMeshRef = useRef<InstancedMesh>(null);
  const tracerMeshRef = useRef<InstancedMesh>(null);
  const tracerGlowMeshRef = useRef<InstancedMesh>(null);
  const launchMeshRef = useRef<InstancedMesh>(null);
  const blastMeshRef = useRef<InstancedMesh>(null);
  const shockwaveMeshRef = useRef<InstancedMesh>(null);
  const currentPositionsRef = useRef(new Map<string, Vector3>());
  const projectedPositionsRef = useRef(new Map<string, Vector3>());
  const motionDirectionsRef = useRef(new Map<string, Vector3>());
  const launchOriginsRef = useRef(new Map<string, Vector3>());
  const launchCuesRef = useRef<LaunchCue[]>([]);
  const burstsRef = useRef<ImpactBurst[]>([]);
  const seenEventsRef = useRef(new Set<string>());
  const dummy = useMemo(() => new Object3D(), []);
  const target = useMemo(() => new Vector3(), []);
  const direction = useMemo(() => new Vector3(), []);
  const rotation = useMemo(() => new Quaternion(), []);
  const projectileCapacity = Math.max(1, frame.projectiles.length);

  useEffect(() => {
    const now = performance.now();
    const cellSizeMeters = map.cellSizeMm / 1_000;
    const impactAdditions: ImpactBurst[] = [];
    const launchAdditions: LaunchCue[] = [];
    const platformsByGroupId = new Map(
      frame.platforms.map((platform) => [platform.groupId, platform]),
    );
    for (const event of events) {
      const key = `${event.type}:${event.tick}:${event.sequence}`;
      if (seenEventsRef.current.has(key)) {
        continue;
      }
      seenEventsRef.current.add(key);
      if (event.type === "weapon-fired" && event.projectileIds?.length) {
        const platform = platformsByGroupId.get(event.groupId);
        if (platform) {
          const position = artilleryMuzzleWorldPosition(platform);
          launchAdditions.push({ key, position, startedAt: now, durationMs: 850 });
          for (const projectileId of event.projectileIds) {
            launchOriginsRef.current.set(projectileId, position.clone());
          }
        }
      } else if (event.type === "projectile-impacted") {
        const cellIndex = event.impactCell.z * map.width + event.impactCell.x;
        const impactPosition = new Vector3(
          (event.impactCell.x + 0.5) * cellSizeMeters,
          visualCellGroundHeight(map, cellIndex) + 0.55,
          (event.impactCell.z + 0.5) * cellSizeMeters,
        );
        impactAdditions.push({
          key,
          position: impactPosition,
          startedAt: now,
          durationMs: 1_050,
        });
        currentPositionsRef.current.delete(event.projectileId);
        projectedPositionsRef.current.delete(event.projectileId);
        motionDirectionsRef.current.delete(event.projectileId);
        launchOriginsRef.current.delete(event.projectileId);
      }
    }
    if (launchAdditions.length > 0) {
      launchCuesRef.current = [...launchCuesRef.current, ...launchAdditions].slice(-maxBursts);
    }
    if (impactAdditions.length > 0) {
      burstsRef.current = [...burstsRef.current, ...impactAdditions].slice(-maxBursts);
    }

    const activeIds = new Set<string>();
    for (const projectile of frame.projectiles) {
      activeIds.add(projectile.id);
      const position = new Vector3(
        projectile.worldX,
        visualWorldY(projectile.worldY),
        projectile.worldZ,
      );
      const previous = projectedPositionsRef.current.get(projectile.id) ??
        launchOriginsRef.current.get(projectile.id);
      if (previous && previous.distanceToSquared(position) > 0.001) {
        const motionDirection = motionDirectionsRef.current.get(projectile.id) ??
          new Vector3();
        motionDirection.subVectors(position, previous).normalize();
        motionDirectionsRef.current.set(projectile.id, motionDirection);
      }
      projectedPositionsRef.current.set(projectile.id, position);
    }
    for (const id of projectedPositionsRef.current.keys()) {
      if (!activeIds.has(id)) {
        currentPositionsRef.current.delete(id);
        projectedPositionsRef.current.delete(id);
        motionDirectionsRef.current.delete(id);
        launchOriginsRef.current.delete(id);
      }
    }
    if (seenEventsRef.current.size > 4_096) {
      seenEventsRef.current = new Set(
        events.slice(-256).map((event) => `${event.type}:${event.tick}:${event.sequence}`),
      );
    }
  }, [events, frame.platforms, frame.projectiles, map, maxBursts]);

  useFrame((_, delta) => {
    const shellMesh = shellMeshRef.current;
    const shellGlowMesh = shellGlowMeshRef.current;
    const tracerMesh = tracerMeshRef.current;
    const tracerGlowMesh = tracerGlowMeshRef.current;
    const launchMesh = launchMeshRef.current;
    const blastMesh = blastMeshRef.current;
    const shockwaveMesh = shockwaveMeshRef.current;
    if (
      !shellMesh ||
      !shellGlowMesh ||
      !tracerMesh ||
      !tracerGlowMesh ||
      !launchMesh ||
      !blastMesh ||
      !shockwaveMesh
    ) {
      return;
    }

    const alpha = smoothingAlpha(delta);
    frame.projectiles.forEach((projectile, index) => {
      target.set(
        projectile.worldX,
        visualWorldY(projectile.worldY),
        projectile.worldZ,
      );
      let current = currentPositionsRef.current.get(projectile.id);
      if (!current) {
        current = launchOriginsRef.current.get(projectile.id)?.clone() ?? target.clone();
        currentPositionsRef.current.set(projectile.id, current);
        launchOriginsRef.current.delete(projectile.id);
      }
      direction.subVectors(target, current);
      if (direction.lengthSq() > 0.0001) {
        const motionDirection = motionDirectionsRef.current.get(projectile.id) ??
          new Vector3();
        motionDirection.copy(direction).normalize();
        motionDirectionsRef.current.set(projectile.id, motionDirection);
      }
      current.lerp(target, alpha);

      const motionDirection = motionDirectionsRef.current.get(projectile.id);
      if (motionDirection) {
        rotation.setFromUnitVectors(shellAxis, motionDirection);
      } else {
        rotation.identity();
      }

      dummy.position.copy(current);
      dummy.quaternion.copy(rotation);
      dummy.scale.set(0.75, 1.55, 0.75);
      dummy.updateMatrix();
      shellMesh.setMatrixAt(index, dummy.matrix);

      dummy.quaternion.identity();
      dummy.scale.setScalar(1.35);
      dummy.updateMatrix();
      shellGlowMesh.setMatrixAt(index, dummy.matrix);

      if (index < maxTracers && motionDirection) {
        rotation.setFromUnitVectors(tracerAxis, motionDirection);
        dummy.position.copy(current).addScaledVector(
          motionDirection,
          -TRACER_LENGTH_METERS / 2,
        );
        dummy.quaternion.copy(rotation);
        dummy.scale.set(1, 1, TRACER_LENGTH_METERS);
      } else {
        dummy.position.set(0, 0, 0);
        dummy.quaternion.identity();
        dummy.scale.copy(hiddenScale);
      }
      dummy.updateMatrix();
      tracerMesh.setMatrixAt(index, dummy.matrix);
      tracerGlowMesh.setMatrixAt(index, dummy.matrix);
    });
    for (let index = frame.projectiles.length; index < projectileCapacity; index += 1) {
      dummy.position.set(0, 0, 0);
      dummy.quaternion.identity();
      dummy.scale.copy(hiddenScale);
      dummy.updateMatrix();
      shellMesh.setMatrixAt(index, dummy.matrix);
      shellGlowMesh.setMatrixAt(index, dummy.matrix);
      tracerMesh.setMatrixAt(index, dummy.matrix);
      tracerGlowMesh.setMatrixAt(index, dummy.matrix);
    }
    shellMesh.instanceMatrix.needsUpdate = true;
    shellGlowMesh.instanceMatrix.needsUpdate = true;
    tracerMesh.instanceMatrix.needsUpdate = true;
    tracerGlowMesh.instanceMatrix.needsUpdate = true;

    const now = performance.now();

    const activeLaunchCues = launchCuesRef.current.filter(
      (cue) => now <= cue.startedAt + cue.durationMs,
    );
    launchCuesRef.current = activeLaunchCues;
    for (let index = 0; index < maxBursts; index += 1) {
      const cue = activeLaunchCues[index];
      if (!cue) {
        dummy.position.set(0, 0, 0);
        dummy.quaternion.identity();
        dummy.scale.copy(hiddenScale);
        dummy.updateMatrix();
        launchMesh.setMatrixAt(index, dummy.matrix);
        continue;
      }
      const progress = Math.min(1, (now - cue.startedAt) / cue.durationMs);
      const flashScale = Math.max(0.01, Math.sin(Math.PI * Math.min(1, progress * 1.8)) * 1.45);
      dummy.position.copy(cue.position);
      dummy.quaternion.identity();
      dummy.scale.setScalar(flashScale);
      dummy.updateMatrix();
      launchMesh.setMatrixAt(index, dummy.matrix);
    }
    launchMesh.instanceMatrix.needsUpdate = true;

    const activeBursts = burstsRef.current.filter(
      (burst) => now <= burst.startedAt + burst.durationMs,
    );
    burstsRef.current = activeBursts;
    for (let index = 0; index < maxBursts; index += 1) {
      const burst = activeBursts[index];
      if (!burst) {
        dummy.position.set(0, 0, 0);
        dummy.quaternion.identity();
        dummy.scale.copy(hiddenScale);
        dummy.updateMatrix();
        blastMesh.setMatrixAt(index, dummy.matrix);
        shockwaveMesh.setMatrixAt(index, dummy.matrix);
        continue;
      }
      const progress = Math.min(1, Math.max(0, (now - burst.startedAt) / burst.durationMs));
      const blastScale = Math.sin(Math.PI * Math.min(1, progress * 1.2)) * 3.4;
      dummy.position.copy(burst.position);
      dummy.position.y += progress * 2.4;
      dummy.quaternion.identity();
      dummy.scale.setScalar(Math.max(0.01, blastScale));
      dummy.updateMatrix();
      blastMesh.setMatrixAt(index, dummy.matrix);

      dummy.position.copy(burst.position);
      dummy.position.y += 0.08;
      dummy.quaternion.copy(horizontalQuaternion);
      dummy.scale.setScalar(0.5 + progress * 7.5);
      dummy.updateMatrix();
      shockwaveMesh.setMatrixAt(index, dummy.matrix);
    }
    blastMesh.instanceMatrix.needsUpdate = true;
    shockwaveMesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <group>
      <instancedMesh
        ref={tracerGlowMeshRef}
        key={`projectile-tracer-glow-${projectileCapacity}`}
        args={[undefined, undefined, projectileCapacity]}
        frustumCulled={false}
      >
        <boxGeometry args={[0.4, 0.4, 1]} />
        <meshBasicMaterial
          color="#ff9a45"
          transparent
          opacity={0.42}
          depthWrite={false}
          toneMapped={false}
        />
      </instancedMesh>
      <instancedMesh
        ref={tracerMeshRef}
        key={`projectile-tracer-${projectileCapacity}`}
        args={[undefined, undefined, projectileCapacity]}
        frustumCulled={false}
      >
        <boxGeometry args={[0.26, 0.26, 1]} />
        <meshBasicMaterial
          color="#fffbe8"
          transparent
          opacity={0.96}
          depthWrite={false}
          toneMapped={false}
        />
      </instancedMesh>
      <instancedMesh
        ref={shellMeshRef}
        key={`projectile-shells-${projectileCapacity}`}
        args={[undefined, undefined, projectileCapacity]}
        frustumCulled={false}
      >
        <cylinderGeometry args={[0.13, 0.18, 0.75, 8]} />
        <meshBasicMaterial color="#fff3b0" toneMapped={false} />
      </instancedMesh>
      <instancedMesh
        ref={launchMeshRef}
        args={[undefined, undefined, maxBursts]}
        frustumCulled={false}
      >
        <icosahedronGeometry args={[0.7, 0]} />
        <meshBasicMaterial
          color="#fff1a8"
          transparent
          opacity={0.92}
          depthWrite={false}
          toneMapped={false}
        />
      </instancedMesh>
      <instancedMesh
        ref={shellGlowMeshRef}
        key={`projectile-glow-${projectileCapacity}`}
        args={[undefined, undefined, projectileCapacity]}
        frustumCulled={false}
      >
        <sphereGeometry args={[0.28, 8, 6]} />
        <meshBasicMaterial
          color="#ff7a38"
          transparent
          opacity={0.62}
          depthWrite={false}
          toneMapped={false}
        />
      </instancedMesh>
      <instancedMesh
        ref={blastMeshRef}
        args={[undefined, undefined, maxBursts]}
        frustumCulled={false}
      >
        <icosahedronGeometry args={[1, 1]} />
        <meshBasicMaterial
          color="#ff6b2c"
          transparent
          opacity={0.82}
          depthWrite={false}
          toneMapped={false}
        />
      </instancedMesh>
      <instancedMesh
        ref={shockwaveMeshRef}
        args={[undefined, undefined, maxBursts]}
        frustumCulled={false}
      >
        <ringGeometry args={[0.78, 1, 28]} />
        <meshBasicMaterial
          color="#ffe08a"
          transparent
          opacity={0.58}
          depthWrite={false}
          toneMapped={false}
        />
      </instancedMesh>
    </group>
  );
}
