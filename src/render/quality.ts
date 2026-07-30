export type RenderQuality = "low" | "medium" | "high";

export interface RenderQualitySettings {
  readonly dpr: [number, number];
  readonly shadows: boolean;
  readonly shadowMapSize: number;
  readonly maxTracers: number;
  readonly maxProjectileTracers: number;
  readonly maxImpactBursts: number;
}

export const DEFAULT_RENDER_QUALITY: RenderQuality = "high";

export const RENDER_QUALITY_SETTINGS: Readonly<
  Record<RenderQuality, RenderQualitySettings>
> = {
  low: {
    dpr: [0.8, 1],
    shadows: false,
    shadowMapSize: 512,
    maxTracers: 24,
    maxProjectileTracers: 12,
    maxImpactBursts: 8,
  },
  medium: {
    dpr: [1, 1.35],
    shadows: true,
    shadowMapSize: 768,
    maxTracers: 48,
    maxProjectileTracers: 24,
    maxImpactBursts: 16,
  },
  high: {
    dpr: [1, 1.7],
    shadows: true,
    shadowMapSize: 1_024,
    maxTracers: 96,
    maxProjectileTracers: 48,
    maxImpactBursts: 28,
  },
};

export function parseRenderQuality(value: string | null): RenderQuality {
  return value === "low" || value === "medium" || value === "high"
    ? value
    : DEFAULT_RENDER_QUALITY;
}

export function getRenderQualitySettings(quality: RenderQuality): RenderQualitySettings {
  return RENDER_QUALITY_SETTINGS[quality];
}
