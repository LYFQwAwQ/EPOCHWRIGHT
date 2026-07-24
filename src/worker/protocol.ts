import type {
  BattleEvent,
  BattleResult,
  BattleSetup,
  BattleSetupOptions,
  EntityInspection,
  RenderFrame,
  SimulationStatus,
} from "../sim/types";

export type WorkerCommand =
  | {
      readonly type: "initialize";
      readonly sessionId: string;
      readonly options: BattleSetupOptions;
      readonly autostart: boolean;
    }
  | { readonly type: "run"; readonly sessionId: string }
  | { readonly type: "pause"; readonly sessionId: string }
  | { readonly type: "step-debug"; readonly sessionId: string; readonly count: number }
  | {
      readonly type: "inspect";
      readonly sessionId: string;
      readonly entityId?: string;
    }
  | { readonly type: "dispose"; readonly sessionId: string };

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
    })
  | (WorkerMessageBase & {
      readonly type: "frame";
      readonly frame: RenderFrame;
      readonly events: readonly BattleEvent[];
      readonly stateHash: string;
      readonly simulationStatus: SimulationStatus;
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
    })
  | (WorkerMessageBase & {
      readonly type: "error";
      readonly message: string;
    });
