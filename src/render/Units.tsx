import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import { InstancedMesh, Object3D, Quaternion, Vector3 } from "three";
import type { RenderFrame, RenderMember } from "../sim/types";
import { visualWorldY } from "./elevation";

interface UnitsProps {
  readonly frame: RenderFrame;
  readonly factionColors: Readonly<Record<string, string>>;
  readonly selectedGroupId?: string;
  readonly onSelectGroup: (groupId: string) => void;
}

const uprightQuaternion = new Quaternion();
const proneQuaternion = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 2);

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

  useFrame(() => {
    const mesh = meshRef.current;
    if (!mesh) {
      return;
    }

    members.forEach((member, index) => {
      const groundY = visualWorldY(member.worldY);
      const target = new Vector3(member.worldX, groundY + 1.05, member.worldZ);
      let current = currentPositions.current.get(member.id);
      if (!current) {
        current = target.clone();
        currentPositions.current.set(member.id, current);
      } else {
        current.lerp(target, 0.16);
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

export function Units({ frame, factionColors, selectedGroupId, onSelectGroup }: UnitsProps) {
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
    </group>
  );
}

interface SquadMarkersProps {
  readonly frame: RenderFrame;
  readonly selectedGroupId?: string;
  readonly factionColors: Readonly<Record<string, string>>;
  readonly onSelectGroup: (groupId: string) => void;
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
        const routed = group.action === "routing";
        const factionColor = factionColors[group.factionId] ?? "#ffffff";
        return (
          <group
            key={group.id}
            position={[group.worldX, visualWorldY(group.worldY), group.worldZ]}
          >
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
                color={selected ? "#f3c969" : factionColor}
                transparent
                opacity={selected ? 0.95 : routed ? 0.55 : 0.32}
                depthWrite={false}
                toneMapped={false}
              />
            </mesh>
            <mesh position={[0, 2.8, 0]} rotation={[0, group.headingRadians, 0]}>
              <octahedronGeometry args={[0.72, 0]} />
              <meshBasicMaterial color={selected ? "#f3c969" : factionColor} toneMapped={false} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}
