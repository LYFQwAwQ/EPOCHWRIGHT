import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { InstancedMesh, Object3D, Quaternion, Vector3 } from "three";
import type { BattleEvent, RenderFrame } from "../sim/types";
import { visualWorldY } from "./elevation";

interface ShotEffectsProps {
  readonly events: readonly BattleEvent[];
  readonly frame: RenderFrame;
  readonly maxTracers: number;
}

interface Tracer {
  readonly key: string;
  readonly from: Vector3;
  readonly to: Vector3;
  readonly startedAt: number;
  readonly durationMs: number;
}

const tracerAxis = new Vector3(0, 0, 1);
const hiddenScale = new Vector3(0, 0, 0);

function deterministicUnit(value: number): number {
  let hash = Math.imul(value ^ 0x9e3779b9, 0x85ebca6b);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35);
  return ((hash ^ (hash >>> 16)) >>> 0) / 0x1_0000_0000;
}

export function ShotEffects({ events, frame, maxTracers }: ShotEffectsProps) {
  const tracerMeshRef = useRef<InstancedMesh>(null);
  const impactMeshRef = useRef<InstancedMesh>(null);
  const tracersRef = useRef<Tracer[]>([]);
  const seenEventsRef = useRef(new Set<string>());
  const dummy = useMemo(() => new Object3D(), []);
  const direction = useMemo(() => new Vector3(), []);
  const midpoint = useMemo(() => new Vector3(), []);
  const tail = useMemo(() => new Vector3(), []);
  const head = useMemo(() => new Vector3(), []);
  const perpendicular = useMemo(() => new Vector3(), []);
  const rotation = useMemo(() => new Quaternion(), []);

  useEffect(() => {
    const groups = new Map(frame.groups.map((group) => [group.id, group]));
    const now = performance.now();
    const additions: Tracer[] = [];

    for (const event of events) {
      if (event.type !== "weapon-fired") {
        continue;
      }
      if (event.projectileIds?.length) {
        continue;
      }
      const eventKey = `${event.tick}:${event.sequence}`;
      if (seenEventsRef.current.has(eventKey)) {
        continue;
      }
      seenEventsRef.current.add(eventKey);
      const shooter = groups.get(event.groupId);
      const target = groups.get(event.targetGroupId);
      if (!shooter || !target) {
        continue;
      }

      const visualCount = Math.min(
        3,
        Math.max(1, Math.ceil(event.shotCount / 4)),
      );
      for (let visualIndex = 0; visualIndex < visualCount; visualIndex += 1) {
        const seed = event.tick * 131 + event.sequence * 17 + visualIndex * 911;
        const lateral = (deterministicUnit(seed) - 0.5) * 2.6;
        const vertical = (deterministicUnit(seed + 1) - 0.5) * 1.1;
        const from = new Vector3(
          shooter.worldX,
          visualWorldY(shooter.worldY) + 1.75,
          shooter.worldZ,
        );
        const to = new Vector3(
          target.worldX,
          visualWorldY(target.worldY) + 1.15 + vertical,
          target.worldZ,
        );
        perpendicular.set(-(to.z - from.z), 0, to.x - from.x).normalize();
        from.addScaledVector(perpendicular, lateral * 0.22);
        to.addScaledVector(perpendicular, lateral);
        additions.push({
          key: `${eventKey}:${visualIndex}`,
          from,
          to,
          startedAt: now + visualIndex * 24,
          durationMs: 210 + Math.min(170, from.distanceTo(to) * 0.65),
        });
      }
    }

    if (additions.length > 0) {
      tracersRef.current = [...tracersRef.current, ...additions].slice(-maxTracers);
    }
    if (seenEventsRef.current.size > 4_096) {
      seenEventsRef.current = new Set(
        events.slice(-256).map((event) => `${event.tick}:${event.sequence}`),
      );
    }
  }, [events, frame.groups, maxTracers, perpendicular]);

  useFrame(() => {
    const tracerMesh = tracerMeshRef.current;
    const impactMesh = impactMeshRef.current;
    if (!tracerMesh || !impactMesh) {
      return;
    }

    const now = performance.now();
    const active = tracersRef.current.filter(
      (tracer) => now <= tracer.startedAt + tracer.durationMs * 1.16,
    );
    tracersRef.current = active;

    for (let index = 0; index < maxTracers; index += 1) {
      const tracer = active[index];
      if (!tracer || now < tracer.startedAt) {
        dummy.position.set(0, 0, 0);
        dummy.quaternion.identity();
        dummy.scale.copy(hiddenScale);
        dummy.updateMatrix();
        tracerMesh.setMatrixAt(index, dummy.matrix);
        impactMesh.setMatrixAt(index, dummy.matrix);
        continue;
      }

      const progress = (now - tracer.startedAt) / tracer.durationMs;
      const headProgress = Math.min(1, progress);
      const tailProgress = Math.max(0, headProgress - 0.19);
      tail.lerpVectors(tracer.from, tracer.to, tailProgress);
      head.lerpVectors(tracer.from, tracer.to, headProgress);
      direction.subVectors(head, tail);
      const streakLength = Math.max(0.01, direction.length());
      midpoint.addVectors(head, tail).multiplyScalar(0.5);
      rotation.setFromUnitVectors(tracerAxis, direction.normalize());

      dummy.position.copy(midpoint);
      dummy.quaternion.copy(rotation);
      dummy.scale.set(1, 1, streakLength);
      dummy.updateMatrix();
      tracerMesh.setMatrixAt(index, dummy.matrix);

      const impactStrength = Math.max(0, 1 - Math.abs(progress - 1) / 0.16);
      dummy.position.copy(tracer.to);
      dummy.quaternion.identity();
      dummy.scale.setScalar(impactStrength * 0.9);
      dummy.updateMatrix();
      impactMesh.setMatrixAt(index, dummy.matrix);
    }

    tracerMesh.instanceMatrix.needsUpdate = true;
    impactMesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <group>
      <instancedMesh
        ref={tracerMeshRef}
        key={`tracer-mesh-${maxTracers}`}
        args={[undefined, undefined, maxTracers]}
        frustumCulled={false}
      >
        <boxGeometry args={[0.18, 0.18, 1]} />
        <meshBasicMaterial color="#ffd36b" toneMapped={false} />
      </instancedMesh>
      <instancedMesh
        ref={impactMeshRef}
        key={`impact-mesh-${maxTracers}`}
        args={[undefined, undefined, maxTracers]}
        frustumCulled={false}
      >
        <octahedronGeometry args={[0.75, 0]} />
        <meshBasicMaterial color="#fff0b0" toneMapped={false} />
      </instancedMesh>
    </group>
  );
}
