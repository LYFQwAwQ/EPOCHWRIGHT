import { CameraControls, OrthographicCamera } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Suspense, useCallback, useEffect, useMemo, useRef } from "react";
import type CameraControlsImpl from "camera-controls";
import { Vector3 } from "three";
import type { BattleEvent, BattleMap, RenderFrame } from "../sim/types";
import { ShotEffects } from "./ShotEffects";
import { Objectives } from "./Objectives";
import { Terrain } from "./Terrain";
import { SquadMarkers, Units } from "./Units";

export type CameraMode = "free" | "follow";

interface CameraRigProps {
  readonly map: BattleMap;
  readonly frame: RenderFrame;
  readonly selectedGroupId?: string;
  readonly mode: CameraMode;
  readonly resetSignal: number;
}

function CameraRig({ map, frame, selectedGroupId, mode, resetSignal }: CameraRigProps) {
  const controlsRef = useRef<CameraControlsImpl>(null);
  const canvasWidth = useThree((state) => state.size.width);
  const cellSize = map.cellSizeMm / 1_000;
  const worldWidth = (map.width - 1) * cellSize;
  const worldHeight = (map.height - 1) * cellSize;
  const center = useMemo(
    () => new Vector3(((map.width - 1) * cellSize) / 2, 0, ((map.height - 1) * cellSize) / 2),
    [cellSize, map.height, map.width],
  );
  const span = Math.max(map.width, map.height) * cellSize;
  const fitZoom = Math.min(
    3.2,
    Math.max(1, canvasWidth / (Math.hypot(worldWidth, worldHeight) * 1.08)),
  );
  const initialPosition = useMemo(
    () => [center.x + span * 0.56, span * 0.67, center.z + span * 0.62] as const,
    [center, span],
  );

  const connectControls = useCallback(
    (controls: CameraControlsImpl | null) => {
      controlsRef.current = controls;
      if (controls) {
        void controls.zoomTo(fitZoom, false);
        void controls.setLookAt(
          initialPosition[0],
          initialPosition[1],
          initialPosition[2],
          center.x,
          0,
          center.z,
          false,
        );
      }
    },
    [center, fitZoom, initialPosition],
  );

  useEffect(() => {
    void controlsRef.current?.zoomTo(fitZoom, false);
    void controlsRef.current?.setLookAt(
      initialPosition[0],
      initialPosition[1],
      initialPosition[2],
      center.x,
      0,
      center.z,
      false,
    );
  }, [center, fitZoom, initialPosition, resetSignal]);

  useFrame(() => {
    if (mode !== "follow" || !selectedGroupId) {
      return;
    }
    const selected = frame.groups.find((group) => group.id === selectedGroupId);
    if (selected) {
      controlsRef.current?.setTarget(selected.worldX, selected.worldY, selected.worldZ, true);
    }
  });

  return (
    <>
      <OrthographicCamera
        makeDefault
        near={0.1}
        far={2_000}
        zoom={fitZoom}
        position={initialPosition}
        onUpdate={(camera) => {
          camera.lookAt(center);
          camera.updateProjectionMatrix();
        }}
      />
      <CameraControls
        ref={connectControls}
        makeDefault
        dollyToCursor
        minZoom={0.9}
        maxZoom={12}
        maxPolarAngle={Math.PI / 2.25}
        minPolarAngle={Math.PI / 7}
        smoothTime={0.18}
      />
    </>
  );
}

interface BattlefieldProps {
  readonly map: BattleMap;
  readonly frame: RenderFrame;
  readonly events: readonly BattleEvent[];
  readonly factionColors: Readonly<Record<string, string>>;
  readonly selectedGroupId?: string;
  readonly cameraMode: CameraMode;
  readonly resetSignal: number;
  readonly onSelectGroup: (groupId?: string) => void;
}

export function Battlefield({
  map,
  frame,
  events,
  factionColors,
  selectedGroupId,
  cameraMode,
  resetSignal,
  onSelectGroup,
}: BattlefieldProps) {
  return (
    <Canvas
      className="battle-canvas"
      dpr={[1, 1.7]}
      shadows
      gl={{ antialias: true, alpha: false, powerPreference: "high-performance" }}
      onPointerMissed={() => onSelectGroup(undefined)}
    >
      <color attach="background" args={["#a8b1b1"]} />
      <fog attach="fog" args={["#a8b1b1", 190, 620]} />
      <hemisphereLight args={["#dce5e3", "#343a3b", 1.75]} />
      <directionalLight
        castShadow
        color="#fff1d6"
        intensity={2.2}
        position={[120, 180, 80]}
        shadow-mapSize-width={1_024}
        shadow-mapSize-height={1_024}
        shadow-camera-near={10}
        shadow-camera-far={500}
        shadow-camera-left={-180}
        shadow-camera-right={180}
        shadow-camera-top={180}
        shadow-camera-bottom={-180}
      />
      <Suspense fallback={null}>
        <Terrain map={map} />
        <Objectives
          map={map}
          objectives={frame.objectives}
          factionColors={factionColors}
        />
        <Units
          frame={frame}
          factionColors={factionColors}
          selectedGroupId={selectedGroupId}
          onSelectGroup={onSelectGroup}
        />
        <SquadMarkers
          frame={frame}
          factionColors={factionColors}
          selectedGroupId={selectedGroupId}
          onSelectGroup={onSelectGroup}
        />
        <ShotEffects events={events} frame={frame} />
      </Suspense>
      <CameraRig
        map={map}
        frame={frame}
        selectedGroupId={selectedGroupId}
        mode={cameraMode}
        resetSignal={resetSignal}
      />
    </Canvas>
  );
}
