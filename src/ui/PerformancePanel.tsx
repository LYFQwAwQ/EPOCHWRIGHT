import {
  Activity,
  Clock3,
  Database,
  Gauge,
  RotateCcw,
  TimerReset,
} from "lucide-react";
import type { ReactNode } from "react";
import type { ClientPerformanceSnapshot } from "../client/useBattleWorker";
import {
  evaluatePerformanceBudget,
  type PerformanceBudgetStatus,
  type PerformanceBudgetViolationMetric,
} from "../performance/budget";
import type { MetricSummary } from "../performance/metrics";
import type { PerformanceProfile } from "../performance/profiles";

interface PerformancePanelProps {
  readonly profile?: PerformanceProfile;
  readonly snapshot: ClientPerformanceSnapshot & {
    readonly animationFrameIntervalMs: MetricSummary;
  };
  readonly onReset: () => void;
}

const STATUS_LABELS: Readonly<Record<PerformanceBudgetStatus, string>> = {
  "no-samples": "无样本",
  sampling: "采样中",
  "within-budget": "预算内",
  "over-budget": "超预算",
};

const PROFILE_LABELS: Readonly<Record<PerformanceProfile, string>> = {
  medium: "中型标准档",
  large: "大型高负载档",
};

const VIOLATION_LABELS: Readonly<Record<PerformanceBudgetViolationMetric, string>> = {
  initializationDurationMs: "初始化",
  tickP99Ms: "Worker tick",
  animationFrameP99Ms: "RAF 间隔",
  workerMessageBytesP99: "帧消息",
};

function formatDuration(value: number | undefined): string {
  return value === undefined ? "--" : `${value.toFixed(1)} ms`;
}

function formatBytes(value: number | undefined): string {
  if (value === undefined) {
    return "--";
  }
  if (value >= 1024 * 1024) {
    return `${(value / (1024 * 1024)).toFixed(2)} MiB`;
  }
  if (value >= 1024) {
    return `${(value / 1024).toFixed(1)} KiB`;
  }
  return `${Math.round(value)} B`;
}

function formatLimit(value: number | undefined, bytes = false): string {
  return value === undefined ? "无" : bytes ? formatBytes(value) : formatDuration(value);
}

function metricValues(
  summary: ClientPerformanceSnapshot["workerMessageBytes"] | undefined,
  formatter: (value: number | undefined) => string,
) {
  return {
    p95: formatter(summary?.samples ? summary.p95 : undefined),
    p99: formatter(summary?.samples ? summary.p99 : undefined),
    samples: summary?.samples ?? 0,
  };
}

interface MetricRowProps {
  readonly icon: ReactNode;
  readonly label: string;
  readonly values: ReturnType<typeof metricValues>;
  readonly limit?: string;
  readonly overBudget?: boolean;
}

function MetricRow({ icon, label, values, limit, overBudget = false }: MetricRowProps) {
  return (
    <div className={`performance-metric ${overBudget ? "is-over" : ""}`}>
      <div className="performance-metric__label">
        <span>{icon}</span>
        <strong>{label}</strong>
        <small>{values.samples} 样本</small>
      </div>
      <div className="performance-metric__values">
        <span><b>P95</b>{values.p95}</span>
        <span><b>P99</b>{values.p99}</span>
        {limit !== undefined && <small>限 {limit}</small>}
      </div>
    </div>
  );
}

export function PerformancePanel({ profile, snapshot, onReset }: PerformancePanelProps) {
  const evaluation = evaluatePerformanceBudget({ profile, ...snapshot });
  const violationMetrics = new Set(
    evaluation.violations.map((violation) => violation.metric),
  );
  const worker = snapshot.worker;
  const initializationValue = worker?.initializationDurationMs;
  const initializationSummary =
    initializationValue === undefined
      ? undefined
      : {
          samples: 1,
          mean: initializationValue,
          p95: initializationValue,
          p99: initializationValue,
          max: initializationValue,
        };
  const sampleCount =
    (worker?.tickDurationMs.samples ?? 0) +
    (worker?.frameProjectionDurationMs.samples ?? 0) +
    snapshot.workerMessageBytes.samples +
    snapshot.workerMessageHandlerDurationMs.samples +
    snapshot.animationFrameIntervalMs.samples;

  return (
    <aside
      className={`performance-panel performance-panel--${evaluation.status}`}
      aria-label="性能诊断面板"
    >
      <header className="performance-panel__header">
        <div className="performance-panel__title">
          <Gauge size={15} aria-hidden="true" />
          <div>
            <strong>性能诊断</strong>
            <span>{profile ? PROFILE_LABELS[profile] : "未选择预算档"}</span>
          </div>
        </div>
        <button
          className="icon-button"
          type="button"
          title="重置性能采样"
          aria-label="重置性能采样"
          onClick={onReset}
        >
          <RotateCcw size={15} />
        </button>
      </header>

      <div className="performance-panel__status" role="status">
        <span className="performance-status-dot" aria-hidden="true" />
        <strong>{STATUS_LABELS[evaluation.status]}</strong>
        <span>{sampleCount} 个样本</span>
      </div>

      <div className="performance-metrics">
        <MetricRow
          icon={<Clock3 size={13} />}
          label="初始化"
          values={metricValues(initializationSummary, formatDuration)}
          limit={formatLimit(evaluation.limits?.initializationDurationMs)}
          overBudget={violationMetrics.has("initializationDurationMs")}
        />
        <MetricRow
          icon={<TimerReset size={13} />}
          label="Worker tick"
          values={metricValues(worker?.tickDurationMs, formatDuration)}
          limit={formatLimit(evaluation.limits?.tickP99Ms)}
          overBudget={violationMetrics.has("tickP99Ms")}
        />
        <MetricRow
          icon={<Activity size={13} />}
          label="帧投影"
          values={metricValues(worker?.frameProjectionDurationMs, formatDuration)}
        />
        <MetricRow
          icon={<Database size={13} />}
          label="帧消息"
          values={metricValues(snapshot.workerMessageBytes, formatBytes)}
          limit={formatLimit(evaluation.limits?.workerMessageBytesP99, true)}
          overBudget={violationMetrics.has("workerMessageBytesP99")}
        />
        <MetricRow
          icon={<Activity size={13} />}
          label="主线程处理"
          values={metricValues(snapshot.workerMessageHandlerDurationMs, formatDuration)}
        />
        <MetricRow
          icon={<Gauge size={13} />}
          label="RAF 间隔"
          values={metricValues(snapshot.animationFrameIntervalMs, formatDuration)}
          limit={formatLimit(evaluation.limits?.animationFrameP99Ms)}
          overBudget={violationMetrics.has("animationFrameP99Ms")}
        />
      </div>

      <footer className="performance-panel__footer">
        <span>累计消息 {formatBytes(snapshot.totalWorkerMessageBytes)}</span>
        {evaluation.violations.length > 0 ? (
          <span className="performance-panel__violations">
            超限：{evaluation.violations.map((violation) => VIOLATION_LABELS[violation.metric]).join("、")}
          </span>
        ) : (
          <span>投影不设独立预算</span>
        )}
      </footer>
    </aside>
  );
}
