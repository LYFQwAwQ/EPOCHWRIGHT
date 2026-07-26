import type {
  BattleEvent,
  BattleResult,
  BattleSetup,
  EntityInspection,
  RenderFrame,
  SimulationStatus,
} from "../sim/types";
import type { MetricSummary } from "../performance/metrics";

export interface WorkerPerformanceSnapshot {
  readonly initializationDurationMs: number;
  readonly tickDurationMs: MetricSummary;
  readonly frameProjectionDurationMs: MetricSummary;
}

export type WorkerCommand =
  | {
      readonly type: "initialize";
      readonly sessionId: string;
      readonly setup: BattleSetup;
      readonly autostart: boolean;
      readonly collectPerformance?: boolean;
    }
  | { readonly type: "run"; readonly sessionId: string }
  | { readonly type: "pause"; readonly sessionId: string }
  | { readonly type: "step-debug"; readonly sessionId: string; readonly count: number }
  | {
      readonly type: "inspect";
      readonly sessionId: string;
      readonly entityId?: string;
    }
  | {
      readonly type: "set-observation";
      readonly sessionId: string;
      readonly observerFactionId?: string;
    }
  | { readonly type: "dispose"; readonly sessionId: string }
  | { readonly type: "reset-performance"; readonly sessionId: string };

interface WorkerMessageBase {
  readonly sessionId: string;
}

export type WorkerMessage =
  | (WorkerMessageBase & {
      readonly type: "ready";
      readonly setup: BattleSetup;
      readonly frame: RenderFrame;
      readonly stateHash: string;
      readonly paused: boolean;
      readonly performance?: WorkerPerformanceSnapshot;
    })
  | (WorkerMessageBase & {
      readonly type: "frame";
      readonly frame: RenderFrame;
      readonly events: readonly BattleEvent[];
      readonly stateHash: string;
      readonly simulationStatus: SimulationStatus;
      readonly performance?: WorkerPerformanceSnapshot;
    })
  | (WorkerMessageBase & {
      readonly type: "pause-changed";
      readonly paused: boolean;
      readonly tick: number;
    })
  | (WorkerMessageBase & {
      readonly type: "inspection";
      readonly inspection?: EntityInspection;
    })
  | (WorkerMessageBase & {
      readonly type: "finished";
      readonly frame: RenderFrame;
      readonly events: readonly BattleEvent[];
      readonly result: BattleResult;
      readonly stateHash: string;
      readonly performance?: WorkerPerformanceSnapshot;
    })
  | (WorkerMessageBase & {
      readonly type: "error";
      readonly message: string;
    });
