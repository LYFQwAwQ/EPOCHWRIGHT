import { CameraControls, OrthographicCamera } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Suspense, useCallback, useEffect, useMemo, useRef } from "react";
import type CameraControlsImpl from "camera-controls";
import { Vector3 } from "three";
import type { DirectorHotspot } from "../client/director";
import type { BattleEvent, BattleMap, RenderFrame } from "../sim/types";
import { visualWorldY } from "./elevation";
import { getRenderQualitySettings, type RenderQuality } from "./quality";
import { ProjectileEffects } from "./ProjectileEffects";
import { ShotEffects } from "./ShotEffects";
import { Objectives } from "./Objectives";
import { Terrain } from "./Terrain";
import { SquadMarkers, Units } from "./Units";

export type CameraMode = "free" | "follow" | "director";

export interface CameraViewSnapshot {
  readonly positionX: number;
  readonly positionY: number;
  readonly positionZ: number;
  readonly targetX: number;
  readonly targetY: number;
  readonly targetZ: number;
  readonly zoom: number;
  readonly directorMoveCount: number;
}

interface CameraRigProps {
  readonly map: BattleMap;
  readonly frame: RenderFrame;
  readonly selectedGroupId?: string;
  readonly mode: CameraMode;
  readonly directorTarget?: DirectorHotspot;
  readonly resetSignal: number;
  readonly onManualControl: () => void;
  readonly onCameraViewChange?: (snapshot: CameraViewSnapshot) => void;
}

function CameraRig({
  map,
  frame,
  selectedGroupId,
  mode,
  directorTarget,
  resetSignal,
  onManualControl,
  onCameraViewChange,
}: CameraRigProps) {
  const controlsRef = useRef<CameraControlsImpl>(null);
  const lastDirectorCommandRef = useRef<DirectorHotspot | undefined>(undefined);
  const directorMoveCountRef = useRef(0);
  const viewPosition = useMemo(() => new Vector3(), []);
  const viewTarget = useMemo(() => new Vector3(), []);
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
  const directorZoom = Math.min(5.2, Math.max(2.4, fitZoom * 1.4));
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

  useEffect(() => {
    if (mode !== "director") {
      if (lastDirectorCommandRef.current) {
        controlsRef.current?.stop();
      }
      lastDirectorCommandRef.current = undefined;
      return;
    }
    if (!directorTarget) {
      controlsRef.current?.stop();
      lastDirectorCommandRef.current = undefined;
      return;
    }
    if (!controlsRef.current) {
      lastDirectorCommandRef.current = undefined;
      return;
    }
    const previous = lastDirectorCommandRef.current;
    const dx = directorTarget.worldX - (previous?.worldX ?? Number.POSITIVE_INFINITY);
    const dz = directorTarget.worldZ - (previous?.worldZ ?? Number.POSITIVE_INFINITY);
    if (previous?.id === directorTarget.id && dx * dx + dz * dz < 2.25) {
      return;
    }
    lastDirectorCommandRef.current = directorTarget;
    directorMoveCountRef.current += 1;
    void controlsRef.current.moveTo(
      directorTarget.worldX,
      visualWorldY(directorTarget.worldY),
      directorTarget.worldZ,
      true,
    );
    void controlsRef.current.zoomTo(directorZoom, true);
  }, [directorTarget, directorZoom, mode]);

  useFrame((state) => {
    if (mode === "follow" && selectedGroupId) {
      const selected = frame.groups.find((group) => group.id === selectedGroupId);
      if (selected) {
        controlsRef.current?.setTarget(
          selected.worldX,
          visualWorldY(selected.worldY),
          selected.worldZ,
          true,
        );
      }
    }
    if (onCameraViewChange && controlsRef.current) {
      controlsRef.current.getPosition(viewPosition);
      controlsRef.current.getTarget(viewTarget);
      onCameraViewChange({
        positionX: viewPosition.x,
        positionY: viewPosition.y,
        positionZ: viewPosition.z,
        targetX: viewTarget.x,
        targetY: viewTarget.y,
        targetZ: viewTarget.z,
        zoom: "zoom" in state.camera ? state.camera.zoom : 1,
        directorMoveCount: directorMoveCountRef.current,
      });
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
        smoothTime={mode === "director" ? 0.7 : 0.18}
        onControl={onManualControl}
      />
    </>
  );
}

interface BattlefieldProps {
  readonly map: BattleMap;
  readonly frame: RenderFrame;
  readonly events: readonly BattleEvent[];
  readonly factionColors: Readonly<Record<string, string>>;
  readonly showObjectives: boolean;
  readonly selectedGroupId?: string;
  readonly selectedEntityId?: string;
  readonly cameraMode: CameraMode;
  readonly directorTarget?: DirectorHotspot;
  readonly resetSignal: number;
  readonly onManualCameraControl: () => void;
  readonly onCameraViewChange?: (snapshot: CameraViewSnapshot) => void;
  readonly onSelectGroup: (groupId?: string) => void;
  readonly onSelectPlatform: (platformId: string, groupId: string) => void;
  readonly quality: RenderQuality;
}

export function Battlefield({
  map,
  frame,
  events,
  factionColors,
  showObjectives,
  selectedGroupId,
  selectedEntityId,
  cameraMode,
  directorTarget,
  resetSignal,
  onManualCameraControl,
  onCameraViewChange,
  onSelectGroup,
  onSelectPlatform,
  quality,
}: BattlefieldProps) {
  const qualitySettings = getRenderQualitySettings(quality);

  return (
    <Canvas
      className="battle-canvas"
      dpr={qualitySettings.dpr}
      shadows={qualitySettings.shadows}
      gl={{ antialias: true, alpha: false, powerPreference: "high-performance" }}
      onPointerMissed={() => onSelectGroup(undefined)}
    >
      <color attach="background" args={["#a8b1b1"]} />
      <fog attach="fog" args={["#a8b1b1", 190, 620]} />
      <hemisphereLight args={["#dce5e3", "#343a3b", 1.75]} />
      <directionalLight
        castShadow={qualitySettings.shadows}
        color="#fff1d6"
        intensity={2.2}
        position={[120, 180, 80]}
        shadow-mapSize-width={qualitySettings.shadowMapSize}
        shadow-mapSize-height={qualitySettings.shadowMapSize}
        shadow-camera-near={10}
        shadow-camera-far={500}
        shadow-camera-left={-180}
        shadow-camera-right={180}
        shadow-camera-top={180}
        shadow-camera-bottom={-180}
      />
      <Suspense fallback={null}>
        <Terrain map={map} />
        {showObjectives && (
          <Objectives
            map={map}
            objectives={frame.objectives}
            factionColors={factionColors}
          />
        )}
        <Units
          frame={frame}
          factionColors={factionColors}
          selectedGroupId={selectedGroupId}
          selectedEntityId={selectedEntityId}
          onSelectGroup={onSelectGroup}
          onSelectPlatform={onSelectPlatform}
        />
        <SquadMarkers
          frame={frame}
          factionColors={factionColors}
          selectedGroupId={selectedGroupId}
          onSelectGroup={onSelectGroup}
        />
        <ShotEffects
          events={events}
          frame={frame}
          maxTracers={qualitySettings.maxTracers}
        />
        <ProjectileEffects
          map={map}
          frame={frame}
          events={events}
          maxTracers={qualitySettings.maxProjectileTracers}
          maxBursts={qualitySettings.maxImpactBursts}
        />
      </Suspense>
      <CameraRig
        map={map}
        frame={frame}
        selectedGroupId={selectedGroupId}
        mode={cameraMode}
        directorTarget={directorTarget}
        resetSignal={resetSignal}
        onManualControl={onManualCameraControl}
        onCameraViewChange={onCameraViewChange}
      />
    </Canvas>
  );
}
