import { describe, expect, it } from "vitest";
import {
  PERFORMANCE_BUDGETS,
  evaluatePerformanceBudget,
  type PerformanceBudgetInput,
} from "./budget";
import type { MetricSummary } from "./metrics";

function summary(samples: number, p99: number): MetricSummary {
  return { samples, mean: p99, p95: p99, p99, max: p99 };
}

function input(overrides: Partial<PerformanceBudgetInput> = {}): PerformanceBudgetInput {
  return {
    profile: "medium",
    worker: {
      initializationDurationMs: 500,
      tickDurationMs: summary(12, 8),
      frameProjectionDurationMs: summary(12, 2),
    },
    workerMessageBytes: summary(12, 40_000),
    workerMessageHandlerDurationMs: summary(12, 1),
    animationFrameIntervalMs: summary(12, 16.8),
    ...overrides,
  };
}

describe("performance budget evaluation", () => {
  it("distinguishes an empty sample window", () => {
    const evaluation = evaluatePerformanceBudget({
      profile: "medium",
      workerMessageBytes: summary(0, 0),
      workerMessageHandlerDurationMs: summary(0, 0),
      animationFrameIntervalMs: summary(0, 0),
    });

    expect(evaluation.status).toBe("no-samples");
    expect(evaluation.ready).toBe(false);
  });

  it("keeps partially collected metrics in sampling state", () => {
    const partial = input({
      worker: {
        initializationDurationMs: 500,
        tickDurationMs: summary(0, 0),
        frameProjectionDurationMs: summary(0, 0),
      },
    });

    const evaluation = evaluatePerformanceBudget(partial);

    expect(evaluation.status).toBe("sampling");
    expect(evaluation.ready).toBe(false);
  });

  it("reports a complete sample window within budget", () => {
    const evaluation = evaluatePerformanceBudget(input());

    expect(evaluation.status).toBe("within-budget");
    expect(evaluation.ready).toBe(true);
    expect(evaluation.violations).toHaveLength(0);
  });

  it("reports each metric that exceeds the selected profile", () => {
    const limits = PERFORMANCE_BUDGETS.large;
    const evaluation = evaluatePerformanceBudget(
      input({
        profile: "large",
        worker: {
          initializationDurationMs: limits.initializationDurationMs + 1,
          tickDurationMs: summary(12, limits.tickP99Ms + 1),
          frameProjectionDurationMs: summary(12, 2),
        },
        workerMessageBytes: summary(12, limits.workerMessageBytesP99 + 1),
        animationFrameIntervalMs: summary(12, limits.animationFrameP99Ms + 1),
      }),
    );

    expect(evaluation.status).toBe("over-budget");
    expect(evaluation.violations.map((violation) => violation.metric)).toEqual([
      "initializationDurationMs",
      "tickP99Ms",
      "animationFrameP99Ms",
      "workerMessageBytesP99",
    ]);
  });
});
