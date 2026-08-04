import type { MetricSummary } from "./metrics";
import type { PerformanceProfile } from "./profiles";

export interface PerformanceBudgetLimits {
  readonly initializationDurationMs: number;
  readonly tickP99Ms: number;
  readonly animationFrameP99Ms: number;
  readonly workerMessageBytesP99: number;
}

export const PERFORMANCE_BUDGETS: Readonly<
  Record<PerformanceProfile, PerformanceBudgetLimits>
> = {
  medium: {
    initializationDurationMs: 2_000,
    tickP99Ms: 25,
    animationFrameP99Ms: 20,
    workerMessageBytesP99: 128 * 1024,
  },
  large: {
    initializationDurationMs: 5_000,
    tickP99Ms: 50,
    animationFrameP99Ms: 33.3,
    workerMessageBytesP99: 384 * 1024,
  },
};

export type PerformanceBudgetStatus =
  | "no-samples"
  | "sampling"
  | "within-budget"
  | "over-budget";

export interface PerformanceBudgetWorkerSnapshot {
  readonly initializationDurationMs: number;
  readonly tickDurationMs: MetricSummary;
  readonly frameProjectionDurationMs: MetricSummary;
}

export interface PerformanceBudgetInput {
  readonly profile?: PerformanceProfile;
  readonly worker?: PerformanceBudgetWorkerSnapshot;
  readonly workerMessageBytes: MetricSummary;
  readonly workerMessageHandlerDurationMs: MetricSummary;
  readonly animationFrameIntervalMs: MetricSummary;
}

export type PerformanceBudgetViolationMetric =
  | "initializationDurationMs"
  | "tickP99Ms"
  | "animationFrameP99Ms"
  | "workerMessageBytesP99";

export interface PerformanceBudgetViolation {
  readonly metric: PerformanceBudgetViolationMetric;
  readonly actual: number;
  readonly limit: number;
}

export interface PerformanceBudgetEvaluation {
  readonly status: PerformanceBudgetStatus;
  readonly ready: boolean;
  readonly profile?: PerformanceProfile;
  readonly limits?: PerformanceBudgetLimits;
  readonly violations: readonly PerformanceBudgetViolation[];
}

function hasMetricSamples(summary: MetricSummary | undefined): boolean {
  return (summary?.samples ?? 0) > 0;
}

export function evaluatePerformanceBudget(
  input: PerformanceBudgetInput,
): PerformanceBudgetEvaluation {
  const worker = input.worker;
  const hasAnySamples =
    worker !== undefined ||
    hasMetricSamples(input.workerMessageBytes) ||
    hasMetricSamples(input.workerMessageHandlerDurationMs) ||
    hasMetricSamples(input.animationFrameIntervalMs);
  if (!hasAnySamples) {
    return {
      status: "no-samples",
      ready: false,
      profile: input.profile,
      limits: input.profile ? PERFORMANCE_BUDGETS[input.profile] : undefined,
      violations: [],
    };
  }

  const ready =
    worker !== undefined &&
    hasMetricSamples(worker.tickDurationMs) &&
    hasMetricSamples(worker.frameProjectionDurationMs) &&
    hasMetricSamples(input.workerMessageBytes) &&
    hasMetricSamples(input.workerMessageHandlerDurationMs) &&
    hasMetricSamples(input.animationFrameIntervalMs);
  const limits = input.profile ? PERFORMANCE_BUDGETS[input.profile] : undefined;
  if (!ready || !limits) {
    return {
      status: "sampling",
      ready,
      profile: input.profile,
      limits,
      violations: [],
    };
  }

  const violations: PerformanceBudgetViolation[] = [];
  const addViolation = (
    metric: PerformanceBudgetViolationMetric,
    actual: number,
    limit: number,
  ) => {
    if (actual > limit) {
      violations.push({ metric, actual, limit });
    }
  };

  addViolation(
    "initializationDurationMs",
    worker.initializationDurationMs,
    limits.initializationDurationMs,
  );
  addViolation("tickP99Ms", worker.tickDurationMs.p99, limits.tickP99Ms);
  addViolation(
    "animationFrameP99Ms",
    input.animationFrameIntervalMs.p99,
    limits.animationFrameP99Ms,
  );
  addViolation(
    "workerMessageBytesP99",
    input.workerMessageBytes.p99,
    limits.workerMessageBytesP99,
  );

  return {
    status: violations.length > 0 ? "over-budget" : "within-budget",
    ready: true,
    profile: input.profile,
    limits,
    violations,
  };
}
