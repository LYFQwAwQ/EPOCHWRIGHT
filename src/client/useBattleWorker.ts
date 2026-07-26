import { useCallback, useEffect, useRef, useState } from "react";
import type {
  BattleEvent,
  BattleResult,
  BattleSetup,
  BattleSetupOptions,
  EntityInspection,
  RenderFrame,
} from "../sim/types";
import type { WorkerCommand, WorkerMessage } from "../worker/protocol";

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
  readonly start: (options: BattleSetupOptions, autostart?: boolean) => void;
  readonly pause: () => void;
  readonly run: () => void;
  readonly inspect: (entityId?: string) => void;
  readonly setObservation: (observerFactionId?: string) => void;
  readonly stepDebug: (count?: number) => void;
}

export function useBattleWorker(): BattleWorkerController {
  const workerRef = useRef<Worker | undefined>(undefined);
  const sessionRef = useRef("");
  const [state, setState] = useState<BattleClientState>(initialState);

  const post = useCallback((command: WorkerCommand) => {
    workerRef.current?.postMessage(command);
  }, []);

  const start = useCallback((options: BattleSetupOptions, autostart = true) => {
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
    setState(initialState);

    worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
      const message = event.data;
      if (message.sessionId !== sessionRef.current) {
        return;
      }
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
      options,
      autostart,
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

  return { state, start, pause, run, inspect, setObservation, stepDebug };
}
