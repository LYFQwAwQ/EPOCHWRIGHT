import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useBattleWorker } from "./client/useBattleWorker";
import { Battlefield, type CameraMode } from "./render/Battlefield";
import { defaultRelation } from "./sim";
import {
  MAP_CELL_FLAGS,
  SURFACE_TYPE_IDS,
  WATER_DEPTH_UNITS,
  type BattleEvent,
  type BattleModeKind,
  type BattleSetup,
  type BattleSetupOptions,
  type FactionSetup,
  type GroupInspection,
} from "./sim/types";
import { EventFeed } from "./ui/EventFeed";
import { FactionSummary } from "./ui/FactionSummary";
import { Inspector } from "./ui/Inspector";
import { ObjectiveSummary } from "./ui/ObjectiveSummary";
import { ObservationControls, type ObservationLayers } from "./ui/ObservationControls";
import { Toolbar } from "./ui/Toolbar";

type BattleModeSelection = BattleModeKind;

const DEFAULT_FACTIONS: readonly FactionSetup[] = [
  { id: "ember", displayName: "赤焰", color: "#e45f62" },
  { id: "azure", displayName: "苍蓝", color: "#3e8fd1" },
  { id: "olive", displayName: "橄榄", color: "#7c9a52" },
];

const DEFAULT_OPTIONS: BattleSetupOptions = {
  width: 56,
  height: 42,
  groupsPerFaction: 4,
  factions: DEFAULT_FACTIONS,
  relations: [
    defaultRelation("ember", "azure", "hostile"),
    defaultRelation("ember", "olive", "hostile"),
    defaultRelation("azure", "olive", "allied", 60, 40),
  ],
  mountainDensity: 0.12,
  roughness: 0.46,
  waterCoverage: 0.1,
  wetlandCoverage: 0.08,
  maximumDurationSeconds: 180,
  stalemateSeconds: 70,
};

function randomSeed(): string {
  const value = new Uint32Array(1);
  crypto.getRandomValues(value);
  return `sector-${value[0]?.toString(36).padStart(6, "0")}`;
}

function initialSeed(): string {
  return new URLSearchParams(window.location.search).get("seed") ?? "ridge-0712";
}

function initialMode(): BattleModeSelection {
  return new URLSearchParams(window.location.search).get("mode") === "defense"
    ? "defense"
    : "conflict";
}

function updateBattleUrl(seed: string, mode: BattleModeSelection): void {
  const url = new URL(window.location.href);
  url.searchParams.set("seed", seed);
  url.searchParams.set("mode", mode);
  window.history.replaceState(null, "", url);
}

function terminationLabel(reason: string): string {
  const labels: Readonly<Record<string, string>> = {
    "hostiles-eliminated": "敌方有效战力已被消灭",
    "hostiles-routed": "敌方有效战力已经溃散",
    stalemate: "双方无法继续形成有效接触",
    "maximum-duration": "达到战斗时限",
    "objective-captured": "进攻方完成目标占领",
    "defense-time-expired": "防守方坚持到战斗时限",
    "attackers-eliminated": "进攻方已经失去有效战力",
  };
  return labels[reason] ?? reason;
}

function filterObservationEvents(
  events: readonly BattleEvent[],
  visibleGroupIds: ReadonlySet<string>,
  observerFactionId: string | undefined,
  setup: BattleSetup,
  layers: ObservationLayers,
): readonly BattleEvent[] {
  return events.filter((event) => {
    switch (event.type) {
      case "contact-spotted":
        return (
          layers.contacts &&
          visibleGroupIds.has(event.observerGroupId) &&
          visibleGroupIds.has(event.targetGroupId)
        );
      case "intel-delivered":
        return layers.contacts && (observerFactionId === undefined || event.factionId === observerFactionId);
      case "member-health-changed":
      case "morale-changed":
      case "group-evacuated":
        return visibleGroupIds.has(event.groupId);
      case "weapon-fired":
        return visibleGroupIds.has(event.groupId) && visibleGroupIds.has(event.targetGroupId);
      case "reinforcement-triggered":
        return observerFactionId === undefined || event.factionId === observerFactionId;
      case "reinforcement-waiting": {
        const wave = setup.reinforcements.find((candidate) => candidate.id === event.waveId);
        return observerFactionId === undefined || wave?.factionId === observerFactionId;
      }
      case "reinforcement-deployed":
        return observerFactionId === undefined || event.groupIds.some((id) => visibleGroupIds.has(id));
      case "reinforcement-cancelled": {
        const wave = setup.reinforcements.find((candidate) => candidate.id === event.waveId);
        return observerFactionId === undefined || wave?.factionId === observerFactionId;
      }
      case "objective-state-changed":
        return layers.objectives;
      case "battle-ended":
        return true;
    }
  });
}

export function App() {
  const controller = useBattleWorker();
  const { state } = controller;
  const [seed, setSeed] = useState(initialSeed);
  const [battleMode, setBattleMode] = useState<BattleModeSelection>(initialMode);
  const [selectedGroupId, setSelectedGroupId] = useState<string>();
  const [cleanView, setCleanView] = useState(false);
  const [cameraMode, setCameraMode] = useState<CameraMode>("free");
  const [cameraResetSignal, setCameraResetSignal] = useState(0);
  const [observerFactionId, setObserverFactionId] = useState<string>();
  const [observationLayers, setObservationLayers] = useState<ObservationLayers>({
    objectives: true,
    contacts: true,
    paths: true,
  });
  const initialSeedRef = useRef(seed);
  const initialModeRef = useRef(battleMode);
  const { start, pause, run, inspect, setObservation, stepDebug } = controller;
  const e2eMode = new URLSearchParams(window.location.search).get("e2e") === "1";
  const autostart = new URLSearchParams(window.location.search).get("autostart") !== "0";

  useEffect(() => {
    start(
      {
        ...DEFAULT_OPTIONS,
        seed: initialSeedRef.current,
        mode: initialModeRef.current,
      },
      autostart,
    );
  }, [autostart, start]);

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.hidden && state.status === "running") {
        pause();
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [pause, state.status]);

  const selectGroup = useCallback(
    (groupId?: string) => {
      setSelectedGroupId(groupId);
      inspect(groupId);
      if (!groupId && cameraMode === "follow") {
        setCameraMode("free");
      }
    },
    [cameraMode, inspect],
  );

  const restart = useCallback(() => {
    const nextSeed = randomSeed();
    setSeed(nextSeed);
    setSelectedGroupId(undefined);
    setObserverFactionId(undefined);
    setObservation(undefined);
    setCameraMode("free");
    setCameraResetSignal((value) => value + 1);
    updateBattleUrl(nextSeed, battleMode);
    start({ ...DEFAULT_OPTIONS, seed: nextSeed, mode: battleMode }, true);
  }, [battleMode, setObservation, start]);

  const changeBattleMode = useCallback(
    (nextMode: BattleModeSelection) => {
      if (nextMode === battleMode) {
        return;
      }
      const nextSeed = randomSeed();
      setBattleMode(nextMode);
      setSeed(nextSeed);
      setSelectedGroupId(undefined);
      setObserverFactionId(undefined);
      setObservation(undefined);
      setCameraMode("free");
      setCameraResetSignal((value) => value + 1);
      updateBattleUrl(nextSeed, nextMode);
      start({ ...DEFAULT_OPTIONS, seed: nextSeed, mode: nextMode }, true);
    },
    [battleMode, setObservation, start],
  );

  const factionColors = useMemo(
    () =>
      Object.fromEntries(
        state.setup?.factions.map((faction) => [faction.id, faction.color]) ?? [],
      ) as Readonly<Record<string, string>>,
    [state.setup],
  );
  const factionNames = useMemo(
    () =>
      Object.fromEntries(
        state.setup?.factions.map((faction) => [faction.id, faction.displayName]) ?? [],
      ) as Readonly<Record<string, string>>,
    [state.setup],
  );
  const groupInspection =
    state.inspection?.kind === "group" ? (state.inspection as GroupInspection) : undefined;
  const displayFrame = useMemo(() => {
    if (!state.frame || observationLayers.contacts || observerFactionId === undefined) {
      return state.frame;
    }
    return {
      ...state.frame,
      groups: state.frame.groups.filter((group) => group.visibility !== "known"),
    };
  }, [observationLayers.contacts, observerFactionId, state.frame]);
  const displayedInspection =
    groupInspection?.visibility === "known" && !observationLayers.contacts
      ? undefined
      : groupInspection;
  const visibleGroupIds = useMemo(
    () => new Set(displayFrame?.groups.map((group) => group.id) ?? []),
    [displayFrame],
  );
  const visibleEvents = useMemo(
    () =>
      state.setup
        ? filterObservationEvents(
            state.events,
            visibleGroupIds,
            observerFactionId,
            state.setup,
            observationLayers,
          )
        : [],
    [observerFactionId, observationLayers, state.events, state.setup, visibleGroupIds],
  );
  const tick = state.frame?.tick ?? 0;
  const anyEngagement = state.frame?.groups.some((group) => group.action === "engaging") ?? false;
  const objectiveState = state.frame?.objectives[0]?.state;
  const statusLabel =
    state.status === "finished"
      ? "战斗结束"
      : state.status === "paused"
        ? "已暂停"
        : state.status === "initializing"
          ? "部署中"
          : objectiveState === "capturing"
            ? "占领中"
            : objectiveState === "contested"
              ? "目标争夺中"
          : anyEngagement
            ? "交战中"
            : battleMode === "defense"
              ? "攻防进行中"
              : "搜索中";

  useEffect(() => {
    if (!e2eMode) {
      return;
    }
    window.__battleTest = {
      getTick: () => state.frame?.tick ?? 0,
      getStateHash: () => state.stateHash ?? "",
      getStatus: () => state.status,
      getMode: () => state.setup?.mode.kind ?? battleMode,
      getBattleId: () => state.setup?.battleId ?? "",
      getMapLayerSummary: () => {
        const map = state.setup?.map;
        if (!map) {
          return undefined;
        }
        const {
          heightUnits,
          surfaceTypeIds,
          waterDepthUnits,
          cellFlags,
          staticOccupancy,
        } = map.layers;
        let minimumHeightUnits = heightUnits[0] ?? 0;
        let maximumHeightUnits = minimumHeightUnits;
        let mountainCellCount = 0;
        let shallowWaterCellCount = 0;
        let deepWaterCellCount = 0;
        let wetlandCellCount = 0;

        for (let index = 0; index < map.width * map.height; index += 1) {
          const height = heightUnits[index] ?? 0;
          const surfaceType = surfaceTypeIds[index];
          const waterDepth = waterDepthUnits[index];
          minimumHeightUnits = Math.min(minimumHeightUnits, height);
          maximumHeightUnits = Math.max(maximumHeightUnits, height);

          if (
            surfaceType === SURFACE_TYPE_IDS.rock &&
            ((cellFlags[index] ?? 0) & MAP_CELL_FLAGS.groundBlocked) !== 0
          ) {
            mountainCellCount += 1;
          }
          if (waterDepth === WATER_DEPTH_UNITS.shallow) {
            shallowWaterCellCount += 1;
            if (surfaceType === SURFACE_TYPE_IDS.mud) {
              wetlandCellCount += 1;
            }
          } else if (waterDepth === WATER_DEPTH_UNITS.deep) {
            deepWaterCellCount += 1;
          }
        }

        return {
          schemaVersion: map.schemaVersion,
          width: map.width,
          height: map.height,
          cellCount: map.width * map.height,
          heightRangeUnits: maximumHeightUnits - minimumHeightUnits,
          mountainCellCount,
          shallowWaterCellCount,
          deepWaterCellCount,
          wetlandCellCount,
          layerLengths: [
            heightUnits.length,
            surfaceTypeIds.length,
            waterDepthUnits.length,
            cellFlags.length,
            staticOccupancy.length,
          ],
          staticObjects: map.staticObjects.map((object) => ({
            id: object.id,
            kind: object.kind,
            x: object.cell.x,
            z: object.cell.z,
            facing: object.facing,
          })),
          surfaceTypeCount: new Set(surfaceTypeIds).size,
          layersAreTypedArrays:
            heightUnits instanceof Int16Array &&
            surfaceTypeIds instanceof Uint16Array &&
            waterDepthUnits instanceof Uint8Array &&
            cellFlags instanceof Uint16Array &&
            staticOccupancy instanceof Uint8Array,
        };
      },
      getObjectives: () => displayFrame?.objectives ?? [],
      getFactionIds: () => state.setup?.factions.map((faction) => faction.id) ?? [],
      getGroupIds: () => displayFrame?.groups.map((group) => group.id) ?? [],
      getEventTypes: () => state.events.map((event) => event.type),
      getObservation: () => observerFactionId ?? "omniscient",
      getLayerVisibility: () => ({ ...observationLayers }),
      setObservation: (factionId?: string) => {
        setSelectedGroupId(undefined);
        setCameraMode("free");
        setObserverFactionId(factionId);
        setObservation(factionId);
      },
      selectGroup,
      pause,
      run,
      step: stepDebug,
    };
  }, [battleMode, displayFrame, e2eMode, observationLayers, observerFactionId, pause, run, selectGroup, setObservation, state.events, state.frame, state.setup, state.stateHash, state.status, stepDebug]);

  if (!state.setup || !state.frame) {
    return (
      <main className="loading-screen">
        {state.status === "error" ? state.error ?? "战场初始化失败" : "正在生成战场..."}
      </main>
    );
  }

  const frameForUi = displayFrame ?? state.frame;
  const winnerNames =
    state.result?.winnerFactionIds.map((id) => factionNames[id] ?? id).join("、") ?? "";

  return (
    <main className={`app-shell ${cleanView ? "is-clean" : ""}`}>
      <section className="battle-stage" aria-label="三维自动战场">
        <Battlefield
          key={state.setup.battleId}
          map={state.setup.map}
          frame={frameForUi}
          events={visibleEvents}
          factionColors={factionColors}
          showObjectives={observationLayers.objectives}
          selectedGroupId={selectedGroupId}
          cameraMode={cameraMode}
          resetSignal={cameraResetSignal}
          onSelectGroup={selectGroup}
        />
      </section>

      <Toolbar
        battleMode={battleMode}
        paused={state.status === "paused"}
        finished={state.status === "finished"}
        cleanView={cleanView}
        cameraMode={cameraMode}
        tick={tick}
        statusLabel={statusLabel}
        seed={seed}
        onTogglePause={state.status === "paused" ? run : pause}
        onBattleModeChange={changeBattleMode}
        onRestart={restart}
        onResetCamera={() => setCameraResetSignal((value) => value + 1)}
        onToggleCleanView={() => setCleanView((value) => !value)}
        onCameraModeChange={(mode) => {
          setCameraMode(mode === "follow" && !selectedGroupId ? "free" : mode);
        }}
      />

      {!cleanView && (
        <>
          <ObservationControls
            factions={state.setup.factions}
            observerFactionId={observerFactionId}
            layers={observationLayers}
            onObserverChange={(factionId) => {
              setSelectedGroupId(undefined);
              setCameraMode("free");
              setObserverFactionId(factionId);
              setObservation(factionId);
            }}
            onLayerChange={(layer, visible) => {
              if (layer === "contacts" && !visible && groupInspection?.visibility === "known") {
                setSelectedGroupId(undefined);
                setCameraMode("free");
                inspect(undefined);
              }
              setObservationLayers((current) => ({ ...current, [layer]: visible }));
            }}
          />
          <FactionSummary factions={state.setup.factions} frame={frameForUi} />
          {observationLayers.objectives && (
            <ObjectiveSummary
              objectives={frameForUi.objectives}
              factionNames={factionNames}
              factionColors={factionColors}
            />
          )}
          <Inspector
            inspection={displayedInspection}
            frame={frameForUi}
            factionNames={factionNames}
            factionColors={factionColors}
            showContacts={observationLayers.contacts}
            showPaths={observationLayers.paths}
          />
          <EventFeed events={visibleEvents} />
          {frameForUi.objectives.length === 0 && (
            <span className="mobile-status">桌面观察模式</span>
          )}
        </>
      )}

      {state.result && (
        <div className="result-banner" role="status">
          <strong>{state.result.outcome === "win" ? `${winnerNames} 获胜` : "战斗结束"}</strong>
          <span>{terminationLabel(state.result.terminationReason)}</span>
        </div>
      )}

      {state.status === "error" && (
        <div className="error-banner" role="alert">
          <strong>模拟已停止</strong>
          <span>{state.error}</span>
        </div>
      )}
    </main>
  );
}
