import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useBattleWorker } from "./client/useBattleWorker";
import { Battlefield, type CameraMode } from "./render/Battlefield";
import type { BattleModeKind, BattleSetupOptions, GroupInspection } from "./sim/types";
import { EventFeed } from "./ui/EventFeed";
import { FactionSummary } from "./ui/FactionSummary";
import { Inspector } from "./ui/Inspector";
import { ObjectiveSummary } from "./ui/ObjectiveSummary";
import { Toolbar } from "./ui/Toolbar";

type BattleModeSelection = BattleModeKind;

const DEFAULT_OPTIONS: BattleSetupOptions = {
  width: 56,
  height: 42,
  groupsPerFaction: 4,
  mountainDensity: 0.34,
  roughness: 0.46,
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

export function App() {
  const controller = useBattleWorker();
  const { state } = controller;
  const [seed, setSeed] = useState(initialSeed);
  const [battleMode, setBattleMode] = useState<BattleModeSelection>(initialMode);
  const [selectedGroupId, setSelectedGroupId] = useState<string>();
  const [cleanView, setCleanView] = useState(false);
  const [cameraMode, setCameraMode] = useState<CameraMode>("free");
  const [cameraResetSignal, setCameraResetSignal] = useState(0);
  const initialSeedRef = useRef(seed);
  const initialModeRef = useRef(battleMode);
  const { start, pause, run, inspect, stepDebug } = controller;
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
    setCameraMode("free");
    setCameraResetSignal((value) => value + 1);
    updateBattleUrl(nextSeed, battleMode);
    start({ ...DEFAULT_OPTIONS, seed: nextSeed, mode: battleMode }, true);
  }, [battleMode, start]);

  const changeBattleMode = useCallback(
    (nextMode: BattleModeSelection) => {
      if (nextMode === battleMode) {
        return;
      }
      const nextSeed = randomSeed();
      setBattleMode(nextMode);
      setSeed(nextSeed);
      setSelectedGroupId(undefined);
      setCameraMode("free");
      setCameraResetSignal((value) => value + 1);
      updateBattleUrl(nextSeed, nextMode);
      start({ ...DEFAULT_OPTIONS, seed: nextSeed, mode: nextMode }, true);
    },
    [battleMode, start],
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
      getObjectives: () => state.frame?.objectives ?? [],
      getGroupIds: () => state.frame?.groups.map((group) => group.id) ?? [],
      getEventTypes: () => state.events.map((event) => event.type),
      selectGroup,
      pause,
      run,
      step: stepDebug,
    };
  }, [battleMode, e2eMode, pause, run, selectGroup, state.frame, state.setup, state.stateHash, state.status, stepDebug]);

  if (!state.setup || !state.frame) {
    return (
      <main className="loading-screen">
        {state.status === "error" ? state.error ?? "战场初始化失败" : "正在生成战场..."}
      </main>
    );
  }

  const winnerNames =
    state.result?.winnerFactionIds.map((id) => factionNames[id] ?? id).join("、") ?? "";

  return (
    <main className={`app-shell ${cleanView ? "is-clean" : ""}`}>
      <section className="battle-stage" aria-label="三维自动战场">
        <Battlefield
          key={state.setup.battleId}
          map={state.setup.map}
          frame={state.frame}
          events={state.events}
          factionColors={factionColors}
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
          <FactionSummary factions={state.setup.factions} frame={state.frame} />
          <ObjectiveSummary
            objectives={state.frame.objectives}
            factionNames={factionNames}
            factionColors={factionColors}
          />
          <Inspector
            inspection={groupInspection}
            frame={state.frame}
            factionNames={factionNames}
            factionColors={factionColors}
          />
          <EventFeed events={state.events} />
          {state.frame.objectives.length === 0 && (
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
