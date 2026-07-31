import { useFrame } from "@react-three/fiber";
import { useMemo, useRef, type RefObject } from "react";
import { Group, InstancedMesh, Object3D, Quaternion, Vector3 } from "three";
import type { RenderFrame, RenderGroup, RenderMember, RenderPlatform } from "../sim/types";
import { visualWorldY } from "./elevation";
import {
  AIR_PLATFORM_MODEL_YAW_OFFSET_RADIANS,
  ARTILLERY_BARREL_CENTER_Z,
  ARTILLERY_BARREL_LENGTH,
  ARTILLERY_DEPLOYED_ELEVATION_RADIANS,
  ARTILLERY_PACKED_ELEVATION_RADIANS,
  ARTILLERY_SPADE_CENTER_Z,
  platformStateColor,
} from "./platformVisuals";

interface UnitsProps {
  readonly frame: RenderFrame;
  readonly factionColors: Readonly<Record<string, string>>;
  readonly selectedGroupId?: string;
  readonly selectedEntityId?: string;
  readonly onSelectGroup: (groupId: string) => void;
  readonly onSelectPlatform: (platformId: string, groupId: string) => void;
}

const uprightQuaternion = new Quaternion();
const proneQuaternion = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 2);
const POSITION_SMOOTHING_RATE = 12;

function positionSmoothingAlpha(deltaSeconds: number): number {
  return 1 - Math.exp(-POSITION_SMOOTHING_RATE * Math.max(0, deltaSeconds));
}

interface FactionUnitsProps {
  readonly members: readonly RenderMember[];
  readonly color: string;
  readonly selectedGroupId?: string;
  readonly onSelectGroup: (groupId: string) => void;
}

function FactionUnits({ members, color, selectedGroupId, onSelectGroup }: FactionUnitsProps) {
  const meshRef = useRef<InstancedMesh>(null);
  const currentPositions = useRef(new Map<string, Vector3>());
  const dummy = useMemo(() => new Object3D(), []);

  useFrame((_, delta) => {
    const mesh = meshRef.current;
    if (!mesh) {
      return;
    }

    const smoothingAlpha = positionSmoothingAlpha(delta);

    members.forEach((member, index) => {
      const groundY = visualWorldY(member.worldY);
      const target = new Vector3(member.worldX, groundY + 1.05, member.worldZ);
      let current = currentPositions.current.get(member.id);
      if (!current) {
        current = target.clone();
        currentPositions.current.set(member.id, current);
      } else {
        current.lerp(target, smoothingAlpha);
      }

      const inactive = member.health === "dead" || member.health === "incapacitated";
      dummy.position.copy(current);
      if (inactive) {
        dummy.position.y = groundY + 0.48;
        dummy.quaternion.copy(proneQuaternion);
        dummy.scale.set(0.78, 0.78, 0.78);
      } else {
        dummy.quaternion.copy(uprightQuaternion);
        const selectedScale = member.groupId === selectedGroupId ? 1.15 : 1;
        const healthScale = member.health === "wounded" ? 0.88 : 1;
        dummy.scale.setScalar(selectedScale * healthScale);
      }
      dummy.updateMatrix();
      mesh.setMatrixAt(index, dummy.matrix);
    });

    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh
      key={members.length}
      ref={meshRef}
      args={[undefined, undefined, Math.max(1, members.length)]}
      castShadow
      onPointerDown={(event) => {
        event.stopPropagation();
        const member = members[event.instanceId ?? -1];
        if (member) {
          onSelectGroup(member.groupId);
        }
      }}
    >
      <capsuleGeometry args={[0.42, 0.92, 4, 8]} />
      <meshBasicMaterial color={color} toneMapped={false} />
    </instancedMesh>
  );
}

function AirPlatformVisual({
  color,
  rotorRef,
}: {
  readonly color: string;
  readonly rotorRef: RefObject<Group | null>;
}) {
  return (
    <group rotation={[0, AIR_PLATFORM_MODEL_YAW_OFFSET_RADIANS, 0]}>
      <mesh scale={[1.05, 0.72, 1.6]} castShadow>
        <sphereGeometry args={[1, 16, 10]} />
        <meshBasicMaterial color={color} toneMapped={false} />
      </mesh>
      <mesh position={[0, 0.16, -1.05]} scale={[0.82, 0.58, 0.72]} castShadow>
        <sphereGeometry args={[1, 14, 8]} />
        <meshBasicMaterial color="#28383a" toneMapped={false} />
      </mesh>
      <mesh position={[0, 0.1, 2.25]} rotation={[Math.PI / 2, 0, 0]} castShadow>
        <coneGeometry args={[0.38, 3.2, 8]} />
        <meshBasicMaterial color={color} toneMapped={false} />
      </mesh>
      <mesh position={[0, 0.62, 3.35]} castShadow>
        <boxGeometry args={[0.12, 1.18, 0.72]} />
        <meshBasicMaterial color={color} toneMapped={false} />
      </mesh>
      <group ref={rotorRef} position={[0, 1.02, 0]}>
        <mesh>
          <boxGeometry args={[7.4, 0.08, 0.16]} />
          <meshBasicMaterial color="#e0e6df" toneMapped={false} />
        </mesh>
        <mesh>
          <boxGeometry args={[0.16, 0.08, 7.4]} />
          <meshBasicMaterial color="#e0e6df" toneMapped={false} />
        </mesh>
      </group>
      <group position={[0, 0.62, 3.52]}>
        <mesh rotation={[0, 0, Math.PI / 4]}>
          <boxGeometry args={[0.12, 1.5, 0.1]} />
          <meshBasicMaterial color="#e0e6df" toneMapped={false} />
        </mesh>
        <mesh rotation={[0, 0, -Math.PI / 4]}>
          <boxGeometry args={[0.12, 1.5, 0.1]} />
          <meshBasicMaterial color="#e0e6df" toneMapped={false} />
        </mesh>
      </group>
      {[-0.72, 0.72].map((side) => (
        <group key={side} position={[side, -0.7, 0.15]}>
          <mesh>
            <boxGeometry args={[0.1, 0.12, 3.25]} />
            <meshBasicMaterial color="#252a2a" toneMapped={false} />
          </mesh>
          <mesh position={[0, 0.32, -0.92]} rotation={[0, 0, side * 0.48]}>
            <boxGeometry args={[0.1, 0.72, 0.1]} />
            <meshBasicMaterial color="#303536" toneMapped={false} />
          </mesh>
          <mesh position={[0, 0.32, 0.92]} rotation={[0, 0, side * 0.48]}>
            <boxGeometry args={[0.1, 0.72, 0.1]} />
            <meshBasicMaterial color="#303536" toneMapped={false} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function PlatformMesh({
  platform,
  color,
  selected,
  onSelectPlatform,
}: {
  readonly platform: RenderPlatform;
  readonly color: string;
  readonly selected: boolean;
  readonly onSelectPlatform: (platformId: string, groupId: string) => void;
}) {
  const groupRef = useRef<Group>(null);
  const rotorRef = useRef<Group>(null);
  const currentPosition = useRef<Vector3 | undefined>(undefined);
  const airborne = platform.flight !== undefined;
  const artillery = platform.visualTypeId.includes("artillery");
  const tracked = artillery || platform.visualTypeId.includes("tracked");
  const deployed = platform.deployment === "deployed" || platform.deployment === "deploying";
  const platformColor = platformStateColor(
    color,
    platform.disposition,
    platform.damaged,
  );

  useFrame((_, delta) => {
    const group = groupRef.current;
    if (!group) {
      return;
    }
    const target = new Vector3(
      platform.worldX,
      visualWorldY(platform.worldY) + 0.72,
      platform.worldZ,
    );
    currentPosition.current ??= target.clone();
    currentPosition.current.lerp(target, positionSmoothingAlpha(delta));
    group.position.copy(currentPosition.current);
    group.rotation.y = platform.headingRadians;
    if (rotorRef.current) {
      rotorRef.current.rotation.y = (rotorRef.current.rotation.y + delta * 10) % (Math.PI * 2);
    }
  });

  return (
    <group
      ref={groupRef}
      scale={selected ? 1.08 : 1}
      onPointerDown={(event) => {
        event.stopPropagation();
        onSelectPlatform(platform.id, platform.groupId);
      }}
    >
      {airborne ? (
        <AirPlatformVisual
          color={selected ? "#f3c969" : platformColor}
          rotorRef={rotorRef}
        />
      ) : (
        <>
          <mesh castShadow>
            <boxGeometry args={[1.9, 0.78, 3.25]} />
            <meshBasicMaterial color={selected ? "#f3c969" : platformColor} toneMapped={false} />
          </mesh>
          <mesh position={[0, 0.58, artillery ? 0.18 : -0.15]} castShadow>
            <boxGeometry args={[artillery ? 1.62 : 1.45, 0.5, artillery ? 1.9 : 1.65]} />
            <meshBasicMaterial color={selected ? "#ffe09b" : platformColor} toneMapped={false} />
          </mesh>
          {artillery && (
            <>
              <group
                position={[0, deployed ? 1.08 : 0.92, ARTILLERY_BARREL_CENTER_Z]}
                rotation={[
                  Math.PI / 2 -
                    (deployed
                      ? ARTILLERY_DEPLOYED_ELEVATION_RADIANS
                      : ARTILLERY_PACKED_ELEVATION_RADIANS),
                  0,
                  0,
                ]}
              >
                <mesh castShadow>
                  <cylinderGeometry args={[0.13, 0.19, ARTILLERY_BARREL_LENGTH, 10]} />
                  <meshBasicMaterial color={selected ? "#ffe09b" : platformColor} toneMapped={false} />
                </mesh>
                <mesh position={[0, ARTILLERY_BARREL_LENGTH / 2 + 0.08, 0]} castShadow>
                  <cylinderGeometry args={[0.24, 0.24, 0.3, 10]} />
                  <meshBasicMaterial color="#303536" toneMapped={false} />
                </mesh>
              </group>
              {deployed && (
                <>
                  <mesh position={[-0.82, -0.31, ARTILLERY_SPADE_CENTER_Z]} rotation={[-0.18, 0, 0]}>
                    <boxGeometry args={[0.22, 0.58, 1.05]} />
                    <meshBasicMaterial color="#303536" toneMapped={false} />
                  </mesh>
                  <mesh position={[0.82, -0.31, ARTILLERY_SPADE_CENTER_Z]} rotation={[-0.18, 0, 0]}>
                    <boxGeometry args={[0.22, 0.58, 1.05]} />
                    <meshBasicMaterial color="#303536" toneMapped={false} />
                  </mesh>
                </>
              )}
            </>
          )}
          {tracked ? (
            <>
              <mesh position={[-1.04, -0.23, 0]}>
                <boxGeometry args={[0.28, 0.46, 3.35]} />
                <meshBasicMaterial color="#252a2a" toneMapped={false} />
              </mesh>
              <mesh position={[1.04, -0.23, 0]}>
                <boxGeometry args={[0.28, 0.46, 3.35]} />
                <meshBasicMaterial color="#252a2a" toneMapped={false} />
              </mesh>
            </>
          ) : (
            [-1, 1].flatMap((side) =>
              [-1.08, 1.08].map((z) => (
                <mesh
                  key={`${side}:${z}`}
                  position={[side * 1.02, -0.25, z]}
                  rotation={[0, 0, Math.PI / 2]}
                >
                  <cylinderGeometry args={[0.39, 0.39, 0.28, 12]} />
                  <meshBasicMaterial color="#252a2a" toneMapped={false} />
                </mesh>
              )),
            )
          )}
        </>
      )}
    </group>
  );
}

export function Units({
  frame,
  factionColors,
  selectedGroupId,
  selectedEntityId,
  onSelectGroup,
  onSelectPlatform,
}: UnitsProps) {
  const deployedMembers = useMemo(
    () => frame.members.filter((member) => member.presence === "deployed"),
    [frame.members],
  );

  return (
    <group>
      {Object.entries(factionColors).map(([factionId, color]) => (
        <FactionUnits
          key={factionId}
          members={deployedMembers.filter((member) => member.factionId === factionId)}
          color={color}
          selectedGroupId={selectedGroupId}
          onSelectGroup={onSelectGroup}
        />
      ))}
      {frame.platforms.map((platform) => (
        <PlatformMesh
          key={platform.id}
          platform={platform}
          color={factionColors[platform.factionId] ?? "#d6d7d2"}
          selected={
            platform.id === selectedEntityId || platform.groupId === selectedEntityId
          }
          onSelectPlatform={onSelectPlatform}
        />
      ))}
    </group>
  );
}

interface SquadMarkersProps {
  readonly frame: RenderFrame;
  readonly selectedGroupId?: string;
  readonly factionColors: Readonly<Record<string, string>>;
  readonly onSelectGroup: (groupId: string) => void;
}

function SquadMarker({
  group,
  selected,
  color,
  onSelectGroup,
}: {
  readonly group: RenderGroup;
  readonly selected: boolean;
  readonly color: string;
  readonly onSelectGroup: (groupId: string) => void;
}) {
  const markerRef = useRef<Group>(null);
  const currentPosition = useRef<Vector3 | undefined>(undefined);
  const routed = group.action === "routing";

  useFrame((_, delta) => {
    const marker = markerRef.current;
    if (!marker) {
      return;
    }
    const target = new Vector3(group.worldX, visualWorldY(group.worldY), group.worldZ);
    currentPosition.current ??= target.clone();
    currentPosition.current.lerp(target, positionSmoothingAlpha(delta));
    marker.position.copy(currentPosition.current);
  });

  return (
    <group ref={markerRef}>
      <mesh
        position={[0, 0.1, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        onPointerDown={(event) => {
          event.stopPropagation();
          onSelectGroup(group.id);
        }}
      >
        <ringGeometry args={[selected ? 3.2 : 2.6, selected ? 3.5 : 2.82, 32]} />
        <meshBasicMaterial
          color={selected ? "#f3c969" : color}
          transparent
          opacity={selected ? 0.95 : routed ? 0.55 : 0.32}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
      <mesh position={[0, 2.8, 0]} rotation={[0, group.headingRadians, 0]}>
        <octahedronGeometry args={[0.72, 0]} />
        <meshBasicMaterial color={selected ? "#f3c969" : color} toneMapped={false} />
      </mesh>
    </group>
  );
}

export function SquadMarkers({
  frame,
  selectedGroupId,
  factionColors,
  onSelectGroup,
}: SquadMarkersProps) {
  return (
    <group>
      {frame.groups.map((group) => {
        const selected = group.id === selectedGroupId;
        const factionColor = factionColors[group.factionId] ?? "#ffffff";
        return (
          <SquadMarker
            key={group.id}
            group={group}
            selected={selected}
            color={factionColor}
            onSelectGroup={onSelectGroup}
          />
        );
      })}
    </group>
  );
}
