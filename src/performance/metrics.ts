export interface MetricSummary {
  readonly samples: number;
  readonly mean: number;
  readonly p95: number;
  readonly p99: number;
  readonly max: number;
}

export const MAX_PERFORMANCE_SAMPLES = 4_096;

export function recordMetric(samples: number[], value: number): void {
  if (!Number.isFinite(value) || value < 0) {
    return;
  }
  if (samples.length >= MAX_PERFORMANCE_SAMPLES) {
    samples.shift();
  }
  samples.push(value);
}

export function summarizeMetrics(samples: readonly number[]): MetricSummary {
  if (samples.length === 0) {
    return { samples: 0, mean: 0, p95: 0, p99: 0, max: 0 };
  }
  const sorted = [...samples].sort((a, b) => a - b);
  const percentile = (ratio: number): number =>
    sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)] ?? 0;
  return {
    samples: sorted.length,
    mean: sorted.reduce((sum, value) => sum + value, 0) / sorted.length,
    p95: percentile(0.95),
    p99: percentile(0.99),
    max: sorted[sorted.length - 1] ?? 0,
  };
}

export function estimateMessageBytes(value: unknown): number {
  const visited = new WeakSet<object>();
  const countedBuffers = new Set<ArrayBufferLike>();
  const encoder = new TextEncoder();

  const estimate = (candidate: unknown): number => {
    if (candidate === null || candidate === undefined) return 0;
    if (typeof candidate === "boolean") return 1;
    if (typeof candidate === "number") return 8;
    if (typeof candidate === "string") return encoder.encode(candidate).byteLength;
    if (typeof candidate !== "object") return 0;
    if (ArrayBuffer.isView(candidate)) {
      if (countedBuffers.has(candidate.buffer)) return 0;
      countedBuffers.add(candidate.buffer);
      return candidate.buffer.byteLength;
    }
    if (candidate instanceof ArrayBuffer) {
      if (countedBuffers.has(candidate)) return 0;
      countedBuffers.add(candidate);
      return candidate.byteLength;
    }
    if (visited.has(candidate)) return 0;
    visited.add(candidate);
    if (Array.isArray(candidate)) {
      return candidate.reduce((sum, item) => sum + estimate(item), 0);
    }
    return Object.entries(candidate).reduce(
      (sum, [key, item]) => sum + encoder.encode(key).byteLength + estimate(item),
      0,
    );
  };

  return estimate(value);
}
