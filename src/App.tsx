import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useBattleWorker } from "./client/useBattleWorker";
import {
  DEMO_SCENARIOS,
  createDemoBattleSetup,
  createDemoScenarioOptions,
  defaultDemoScenarioForMode,
  getDemoScenario,
  isDemoScenarioId,
  type DemoScenarioId,
} from "./demo";
import { recordMetric, summarizeMetrics } from "./performance/metrics";
import {
  applyPerformanceProfile,
  parsePerformanceProfile,
} from "./performance/profiles";
import type { CameraMode } from "./render/Battlefield";
import {
  DEFAULT_RENDER_QUALITY,
  parseRenderQuality,
  type RenderQuality,
} from "./render/quality";
import {
  MAP_CELL_FLAGS,
  SURFACE_TYPE_IDS,
  WATER_DEPTH_UNITS,
  type BattleEvent,
  type BattleModeKind,
  type BattleSetup,
  type GroupInspection,
} from "./sim/types";
import { EventFeed } from "./ui/EventFeed";
import { FactionSummary } from "./ui/FactionSummary";
import { Inspector } from "./ui/Inspector";
import { ObjectiveSummary } from "./ui/ObjectiveSummary";
import { ObservationControls, type ObservationLayers } from "./ui/ObservationControls";
import { ScenarioLab } from "./ui/ScenarioLab";
import { Toolbar } from "./ui/Toolbar";

const Battlefield = lazy(() =>
  import("./render/Battlefield").then(({ Battlefield: Component }) => ({
    default: Component,
  })),
);

type BattleModeSelection = BattleModeKind;

function randomSeed(): string {
  const value = new Uint32Array(1);
  crypto.getRandomValues(value);
  return `sector-${value[0]?.toString(36).padStart(6, "0")}`;
}

function initialSeed(): string {
  return new URLSearchParams(window.location.search).get("seed") ?? "ridge-0712";
}

function initialScenario(): DemoScenarioId {
  const searchParams = new URLSearchParams(window.location.search);
  const scenarioId = searchParams.get("scenario");
  if (isDemoScenarioId(scenarioId)) {
    return scenarioId;
  }
  return defaultDemoScenarioForMode(
    searchParams.get("mode") === "defense" ? "defense" : "conflict",
  );
}

function initialPerformanceProfile() {
  return parsePerformanceProfile(new URLSearchParams(window.location.search).get("profile"));
}

function initialRenderQuality(): RenderQuality {
  const value = new URLSearchParams(window.location.search).get("quality");
  return value === null ? DEFAULT_RENDER_QUALITY : parseRenderQuality(value);
}

function updateBattleUrl(
  seed: string,
  mode: BattleModeSelection,
  scenarioId: DemoScenarioId,
): void {
  const url = new URL(window.location.href);
  url.searchParams.set("seed", seed);
  url.searchParams.set("mode", mode);
  url.searchParams.set("scenario", scenarioId);
  window.history.replaceState(null, "", url);
}

function updateRenderQualityUrl(quality: RenderQuality): void {
  const url = new URL(window.location.href);
  url.searchParams.set("quality", quality);
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
  const [scenarioId, setScenarioId] = useState<DemoScenarioId>(initialScenario);
  const [battleMode, setBattleMode] = useState<BattleModeSelection>(
    () => getDemoScenario(initialScenario()).mode,
  );
  const [selectedGroupId, setSelectedGroupId] = useState<string>();
  const [cleanView, setCleanView] = useState(false);
  const [cameraMode, setCameraMode] = useState<CameraMode>("free");
  const [renderQuality, setRenderQuality] = useState<RenderQuality>(initialRenderQuality);
  const [cameraResetSignal, setCameraResetSignal] = useState(0);
  const [observerFactionId, setObserverFactionId] = useState<string>();
  const [observationLayers, setObservationLayers] = useState<ObservationLayers>({
    objectives: true,
    contacts: true,
    paths: true,
  });
  const initialSeedRef = useRef(seed);
  const initialScenarioRef = useRef(scenarioId);
  const performanceProfileRef = useRef(initialPerformanceProfile());
  const animationFrameDurationsRef = useRef<number[]>([]);
  const {
    start,
    pause,
    run,
    inspect,
    setObservation,
    stepDebug,
    resetPerformance,
    getPerformanceSnapshot,
  } = controller;
  const searchParams = new URLSearchParams(window.location.search);
  const e2eMode = searchParams.get("e2e") === "1";
  const autostart = searchParams.get("autostart") !== "0";
  const showScenarioLab =
    (import.meta.env.DEV || searchParams.get("devtools") === "1") &&
    performanceProfileRef.current === undefined;

  const createScenarioSetup = useCallback((nextScenarioId: DemoScenarioId, nextSeed: string) => {
    const profile =
      nextScenarioId === "alliance-conflict"
        ? performanceProfileRef.current
        : undefined;
    return createDemoBattleSetup(
      applyPerformanceProfile(
        createDemoScenarioOptions(nextScenarioId, nextSeed),
        profile,
      ),
    );
  }, []);

  useEffect(() => {
    const performanceProfile = performanceProfileRef.current;
    start(
      createScenarioSetup(initialScenarioRef.current, initialSeedRef.current),
      autostart,
      performanceProfile !== undefined,
    );
  }, [autostart, createScenarioSetup, start]);

  useEffect(() => {
    if (!performanceProfileRef.current) {
      return;
    }
    let animationFrame = 0;
    let previousTime: number | undefined;
    const sample = (currentTime: number) => {
      if (previousTime !== undefined) {
        recordMetric(animationFrameDurationsRef.current, currentTime - previousTime);
      }
      previousTime = currentTime;
      animationFrame = requestAnimationFrame(sample);
    };
    animationFrame = requestAnimationFrame(sample);
    return () => cancelAnimationFrame(animationFrame);
  }, []);

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

  const launchScenario = useCallback(
    (nextScenarioId: DemoScenarioId, nextSeed: string, shouldRun: boolean) => {
      const nextMode = getDemoScenario(nextScenarioId).mode;
      setScenarioId(nextScenarioId);
      setBattleMode(nextMode);
      setSeed(nextSeed);
      setSelectedGroupId(undefined);
      setObserverFactionId(undefined);
      setObservation(undefined);
      setCameraMode("free");
      setCameraResetSignal((value) => value + 1);
      updateBattleUrl(nextSeed, nextMode, nextScenarioId);
      start(
        createScenarioSetup(nextScenarioId, nextSeed),
        shouldRun,
        performanceProfileRef.current !== undefined,
      );
    },
    [createScenarioSetup, setObservation, start],
  );

  const restart = useCallback(() => {
    launchScenario(scenarioId, randomSeed(), true);
  }, [launchScenario, scenarioId]);

  const changeBattleMode = useCallback(
    (nextMode: BattleModeSelection) => {
      if (nextMode === battleMode) {
        return;
      }
      launchScenario(
        defaultDemoScenarioForMode(nextMode),
        randomSeed(),
        true,
      );
    },
    [battleMode, launchScenario],
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
      getScenarioId: () => scenarioId,
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
      getPerformanceProfile: () => performanceProfileRef.current,
      getRenderQuality: () => renderQuality,
      getPerformanceMetrics: () => ({
        ...getPerformanceSnapshot(),
        animationFrameIntervalMs: summarizeMetrics(animationFrameDurationsRef.current),
      }),
      resetPerformanceMetrics: () => {
        animationFrameDurationsRef.current = [];
        resetPerformance();
      },
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
  }, [battleMode, displayFrame, e2eMode, getPerformanceSnapshot, observationLayers, observerFactionId, pause, renderQuality, resetPerformance, run, scenarioId, selectGroup, setObservation, state.events, state.frame, state.setup, state.stateHash, state.status, stepDebug]);

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
    <main
      className={`app-shell ${cleanView ? "is-clean" : ""} ${
        showScenarioLab && !cleanView ? "has-scenario-lab" : ""
      }`}
    >
      <section className="battle-stage" aria-label="三维自动战场">
        <Suspense fallback={null}>
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
            quality={renderQuality}
          />
        </Suspense>
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
        quality={renderQuality}
        onTogglePause={state.status === "paused" ? run : pause}
        onBattleModeChange={changeBattleMode}
        onRestart={restart}
        onResetCamera={() => setCameraResetSignal((value) => value + 1)}
        onToggleCleanView={() => setCleanView((value) => !value)}
        onCameraModeChange={(mode) => {
          setCameraMode(mode === "follow" && !selectedGroupId ? "free" : mode);
        }}
        onQualityChange={(quality) => {
          setRenderQuality(quality);
          updateRenderQualityUrl(quality);
        }}
      />

      {showScenarioLab && !cleanView && (
        <ScenarioLab
          scenarios={DEMO_SCENARIOS}
          scenarioId={scenarioId}
          seed={seed}
          paused={state.status === "paused"}
          finished={state.status === "finished"}
          onScenarioChange={(nextScenarioId) =>
            launchScenario(nextScenarioId, seed, state.status !== "paused")
          }
          onSeedChange={(nextSeed) =>
            launchScenario(scenarioId, nextSeed, state.status !== "paused")
          }
          onRandomize={() =>
            launchScenario(scenarioId, randomSeed(), state.status !== "paused")
          }
          onStep={stepDebug}
        />
      )}

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
