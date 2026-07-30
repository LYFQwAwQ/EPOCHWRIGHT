/// <reference lib="webworker" />

import { createSimulation, TICK_DURATION_MS } from "../sim";
import type { BattleEvent, BattleSimulation } from "../sim";
import { recordMetric, summarizeMetrics } from "../performance/metrics";
import type {
  WorkerCommand,
  WorkerMessage,
  WorkerPerformanceSnapshot,
} from "./protocol";

const scope = self as DedicatedWorkerGlobalScope;
const MAX_CATCH_UP_TICKS = 4;
const RENDER_INTERVAL_TICKS = 2;

let sessionId = "";
let simulation: BattleSimulation | undefined;
let running = false;
let timer: ReturnType<typeof setInterval> | undefined;
let lastWallTime = 0;
let accumulatedMs = 0;
let pendingEvents: BattleEvent[] = [];
let inspectedEntityId: string | undefined;
let observerFactionId: string | undefined;
let collectPerformance = false;
let initializationDurationMs = 0;
const tickDurationsMs: number[] = [];
const frameProjectionDurationsMs: number[] = [];

function performanceSnapshot(): WorkerPerformanceSnapshot | undefined {
  return collectPerformance
    ? {
        initializationDurationMs,
        tickDurationMs: summarizeMetrics(tickDurationsMs),
        frameProjectionDurationMs: summarizeMetrics(frameProjectionDurationsMs),
      }
    : undefined;
}

function performanceFields(): { readonly performance?: WorkerPerformanceSnapshot } {
  const snapshot = performanceSnapshot();
  return snapshot ? { performance: snapshot } : {};
}

function resetPerformanceSamples(): void {
  tickDurationsMs.length = 0;
  frameProjectionDurationsMs.length = 0;
}

function createRenderFrame() {
  if (!simulation) {
    throw new Error("Cannot project a frame before simulation initialization.");
  }
  const startedAt = collectPerformance ? performance.now() : 0;
  const frame = simulation.getRenderFrame(observerFactionId);
  if (collectPerformance) {
    recordMetric(frameProjectionDurationsMs, performance.now() - startedAt);
  }
  return frame;
}

function post(message: WorkerMessage): void {
  scope.postMessage(message);
}

function stopTimer(): void {
  if (timer !== undefined) {
    clearInterval(timer);
    timer = undefined;
  }
}

function setRunning(nextRunning: boolean): void {
  running = nextRunning && simulation?.status === "active";
  lastWallTime = performance.now();
  accumulatedMs = 0;
  if (running && timer === undefined) {
    timer = setInterval(pump, Math.max(8, TICK_DURATION_MS / 2));
  } else if (!running) {
    stopTimer();
  }
}

function emitInspection(): void {
  if (!simulation || !inspectedEntityId) {
    return;
  }
  post({
    type: "inspection",
    sessionId,
    inspection: simulation.inspect(inspectedEntityId, observerFactionId),
  });
}

function emitFrame(): void {
  if (!simulation) {
    return;
  }
  const events = pendingEvents;
  pendingEvents = [];
  post({
    type: "frame",
    sessionId,
    frame: createRenderFrame(),
    events,
    stateHash: simulation.getStateHash(),
    simulationStatus: simulation.status,
    ...performanceFields(),
  });
  emitInspection();
}

function advance(count: number, emitIntermediateFrames = true): void {
  if (!simulation || simulation.status !== "active") {
    return;
  }

  for (let index = 0; index < count && simulation.status === "active"; index += 1) {
    const startedAt = collectPerformance ? performance.now() : 0;
    simulation.step();
    if (collectPerformance) {
      recordMetric(tickDurationsMs, performance.now() - startedAt);
    }
    pendingEvents.push(...simulation.drainEvents(observerFactionId));
    if (emitIntermediateFrames && simulation.tick % RENDER_INTERVAL_TICKS === 0) {
      emitFrame();
    }
  }

  const result = simulation.getResult();
  if (result) {
    setRunning(false);
    const trailingEvents = pendingEvents;
    pendingEvents = [];
    post({
      type: "finished",
      sessionId,
      frame: createRenderFrame(),
      events: trailingEvents,
      result,
      stateHash: simulation.getStateHash(),
      ...performanceFields(),
    });
    emitInspection();
  }
}

function pump(): void {
  if (!running || !simulation) {
    return;
  }
  const now = performance.now();
  accumulatedMs += Math.min(250, now - lastWallTime);
  lastWallTime = now;
  const availableTicks = Math.floor(accumulatedMs / TICK_DURATION_MS);
  const ticksToRun = Math.min(MAX_CATCH_UP_TICKS, availableTicks);
  if (ticksToRun > 0) {
    accumulatedMs -= ticksToRun * TICK_DURATION_MS;
    advance(ticksToRun);
  }
}

function initialize(command: Extract<WorkerCommand, { type: "initialize" }>): void {
  stopTimer();
  sessionId = command.sessionId;
  collectPerformance = command.collectPerformance === true;
  resetPerformanceSamples();
  const initializationStartedAt = collectPerformance ? performance.now() : 0;
  simulation = createSimulation(command.setup);
  initializationDurationMs = collectPerformance
    ? performance.now() - initializationStartedAt
    : 0;
  running = false;
  pendingEvents = [];
  inspectedEntityId = undefined;
  observerFactionId = undefined;
  lastWallTime = performance.now();
  accumulatedMs = 0;
  post({
    type: "ready",
    sessionId,
    setup: simulation.getSetup(),
    frame: createRenderFrame(),
    stateHash: simulation.getStateHash(),
    paused: !command.autostart,
    ...performanceFields(),
  });
  setRunning(command.autostart);
}

scope.onmessage = (event: MessageEvent<WorkerCommand>) => {
  const command = event.data;
  try {
    if (command.type === "initialize") {
      initialize(command);
      return;
    }
    if (command.sessionId !== sessionId || !simulation) {
      return;
    }

    switch (command.type) {
      case "run":
        setRunning(true);
        post({ type: "pause-changed", sessionId, paused: false, tick: simulation.tick });
        break;
      case "pause":
        setRunning(false);
        post({ type: "pause-changed", sessionId, paused: true, tick: simulation.tick });
        break;
      case "step-debug":
        setRunning(false);
        advance(Math.max(1, Math.min(10_000, Math.floor(command.count))), false);
        emitFrame();
        break;
      case "inspect":
        inspectedEntityId = command.entityId;
        post({
          type: "inspection",
          sessionId,
          inspection: command.entityId
            ? simulation.inspect(command.entityId, observerFactionId)
            : undefined,
        });
        break;
      case "set-observation":
        observerFactionId = command.observerFactionId;
        pendingEvents = [];
        emitFrame();
        break;
      case "reset-performance":
        resetPerformanceSamples();
        break;
      case "dispose":
        setRunning(false);
        simulation = undefined;
        scope.close();
        break;
    }
  } catch (error) {
    setRunning(false);
    post({
      type: "error",
      sessionId: command.sessionId,
      message: error instanceof Error ? error.message : "Unknown simulation error",
    });
  }
};
