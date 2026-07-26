import { useCallback, useEffect, useRef, useState } from "react";
import type {
  BattleEvent,
  BattleResult,
  BattleSetup,
  EntityInspection,
  RenderFrame,
} from "../sim/types";
import {
  estimateMessageBytes,
  recordMetric,
  summarizeMetrics,
  type MetricSummary,
} from "../performance/metrics";
import type {
  WorkerCommand,
  WorkerMessage,
  WorkerPerformanceSnapshot,
} from "../worker/protocol";

export type ClientBattleStatus = "initializing" | "running" | "paused" | "finished" | "error";

export interface BattleClientState {
  readonly status: ClientBattleStatus;
  readonly setup?: BattleSetup;
  readonly frame?: RenderFrame;
  readonly events: readonly BattleEvent[];
  readonly inspection?: EntityInspection;
  readonly result?: BattleResult;
  readonly stateHash?: string;
  readonly observerFactionId?: string;
  readonly error?: string;
}

const initialState: BattleClientState = {
  status: "initializing",
  events: [],
};

function newSessionId(): string {
  const values = new Uint32Array(2);
  crypto.getRandomValues(values);
  return `session-${values[0]?.toString(16)}-${values[1]?.toString(16)}`;
}

function appendEvents(
  existing: readonly BattleEvent[],
  incoming: readonly BattleEvent[],
): readonly BattleEvent[] {
  if (incoming.length === 0) {
    return existing;
  }
  return [...existing, ...incoming].slice(-160);
}

export interface BattleWorkerController {
  readonly state: BattleClientState;
  readonly start: (
    setup: BattleSetup,
    autostart?: boolean,
    collectPerformance?: boolean,
  ) => void;
  readonly pause: () => void;
  readonly run: () => void;
  readonly inspect: (entityId?: string) => void;
  readonly setObservation: (observerFactionId?: string) => void;
  readonly stepDebug: (count?: number) => void;
  readonly resetPerformance: () => void;
  readonly getPerformanceSnapshot: () => ClientPerformanceSnapshot;
}

export interface ClientPerformanceSnapshot {
  readonly worker?: WorkerPerformanceSnapshot;
  readonly workerMessageBytes: MetricSummary;
  readonly workerMessageHandlerDurationMs: MetricSummary;
  readonly totalWorkerMessageBytes: number;
}

export function useBattleWorker(): BattleWorkerController {
  const workerRef = useRef<Worker | undefined>(undefined);
  const sessionRef = useRef("");
  const collectPerformanceRef = useRef(false);
  const workerPerformanceRef = useRef<WorkerPerformanceSnapshot | undefined>(undefined);
  const workerMessageBytesRef = useRef<number[]>([]);
  const workerMessageHandlerDurationsRef = useRef<number[]>([]);
  const totalWorkerMessageBytesRef = useRef(0);
  const [state, setState] = useState<BattleClientState>(initialState);

  const post = useCallback((command: WorkerCommand) => {
    workerRef.current?.postMessage(command);
  }, []);

  const start = useCallback((
    setup: BattleSetup,
    autostart = true,
    collectPerformance = false,
  ) => {
    if (workerRef.current) {
      workerRef.current.terminate();
    }
    const sessionId = newSessionId();
    const worker = new Worker(new URL("../worker/battle.worker.ts", import.meta.url), {
      type: "module",
      name: `battle-${sessionId}`,
    });
    workerRef.current = worker;
    sessionRef.current = sessionId;
    collectPerformanceRef.current = collectPerformance;
    workerPerformanceRef.current = undefined;
    workerMessageBytesRef.current = [];
    workerMessageHandlerDurationsRef.current = [];
    totalWorkerMessageBytesRef.current = 0;
    setState(initialState);

    worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
      const message = event.data;
      if (message.sessionId !== sessionRef.current) {
        return;
      }
      if (collectPerformanceRef.current) {
        const messageBytes = estimateMessageBytes(message);
        recordMetric(workerMessageBytesRef.current, messageBytes);
        totalWorkerMessageBytesRef.current += messageBytes;
        if ("performance" in message && message.performance) {
          workerPerformanceRef.current = message.performance;
        }
      }
      const handlerStartedAt = collectPerformanceRef.current ? performance.now() : 0;
      switch (message.type) {
        case "ready":
          setState((current) => ({
            ...current,
            status: message.paused ? "paused" : "running",
            setup: message.setup,
            frame: message.frame,
            stateHash: message.stateHash,
            error: undefined,
          }));
          break;
        case "frame":
          setState((current) => ({
            ...current,
            frame: message.frame,
            events: appendEvents(current.events, message.events),
            stateHash: message.stateHash,
          }));
          break;
        case "pause-changed":
          setState((current) => ({
            ...current,
            status: message.paused ? "paused" : "running",
          }));
          break;
        case "inspection":
          setState((current) => ({ ...current, inspection: message.inspection }));
          break;
        case "finished":
          setState((current) => ({
            ...current,
            status: "finished",
            frame: message.frame,
            events: appendEvents(current.events, message.events),
            result: message.result,
            stateHash: message.stateHash,
          }));
          break;
        case "error":
          setState((current) => ({ ...current, status: "error", error: message.message }));
          break;
      }
      if (collectPerformanceRef.current) {
        recordMetric(
          workerMessageHandlerDurationsRef.current,
          performance.now() - handlerStartedAt,
        );
      }
    };

    worker.onerror = (event) => {
      if (sessionId !== sessionRef.current) {
        return;
      }
      setState((current) => ({
        ...current,
        status: "error",
        error: event.message || "Battle worker failed to start.",
      }));
    };

    worker.postMessage({
      type: "initialize",
      sessionId,
      setup,
      autostart,
      collectPerformance,
    } satisfies WorkerCommand);
  }, []);

  useEffect(
    () => () => {
      if (workerRef.current) {
        workerRef.current.terminate();
      }
      workerRef.current = undefined;
      sessionRef.current = "";
    },
    [],
  );

  const pause = useCallback(() => {
    post({ type: "pause", sessionId: sessionRef.current });
  }, [post]);

  const run = useCallback(() => {
    post({ type: "run", sessionId: sessionRef.current });
  }, [post]);

  const inspect = useCallback(
    (entityId?: string) => {
      post({ type: "inspect", sessionId: sessionRef.current, entityId });
    },
    [post],
  );

  const setObservation = useCallback(
    (observerFactionId?: string) => {
      setState((current) => ({ ...current, observerFactionId, inspection: undefined }));
      post({
        type: "set-observation",
        sessionId: sessionRef.current,
        observerFactionId,
      });
    },
    [post],
  );

  const stepDebug = useCallback(
    (count = 1) => {
      post({ type: "step-debug", sessionId: sessionRef.current, count });
    },
    [post],
  );

  const resetPerformance = useCallback(() => {
    workerPerformanceRef.current = undefined;
    workerMessageBytesRef.current = [];
    workerMessageHandlerDurationsRef.current = [];
    totalWorkerMessageBytesRef.current = 0;
    post({ type: "reset-performance", sessionId: sessionRef.current });
  }, [post]);

  const getPerformanceSnapshot = useCallback(
    (): ClientPerformanceSnapshot => ({
      worker: workerPerformanceRef.current,
      workerMessageBytes: summarizeMetrics(workerMessageBytesRef.current),
      workerMessageHandlerDurationMs: summarizeMetrics(
        workerMessageHandlerDurationsRef.current,
      ),
      totalWorkerMessageBytes: totalWorkerMessageBytesRef.current,
    }),
    [],
  );

  return {
    state,
    start,
    pause,
    run,
    inspect,
    setObservation,
    stepDebug,
    resetPerformance,
    getPerformanceSnapshot,
  };
}
