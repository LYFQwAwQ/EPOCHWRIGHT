import { describe, expect, it } from "vitest";
import {
  DEFAULT_RENDER_QUALITY,
  getRenderQualitySettings,
  parseRenderQuality,
} from "./quality";
import { VISUAL_HEIGHT_SCALE, visualMapHeightMeters, visualWorldY } from "./elevation";

describe("render configuration", () => {
  it("accepts only supported quality levels", () => {
    expect(parseRenderQuality("low")).toBe("low");
    expect(parseRenderQuality("medium")).toBe("medium");
    expect(parseRenderQuality("high")).toBe("high");
    expect(parseRenderQuality("ultra")).toBe(DEFAULT_RENDER_QUALITY);
    expect(parseRenderQuality(null)).toBe(DEFAULT_RENDER_QUALITY);
  });

  it("reduces non-authoritative rendering work at lower quality", () => {
    expect(getRenderQualitySettings("low").maxTracers).toBeLessThan(
      getRenderQualitySettings("high").maxTracers,
    );
    expect(getRenderQualitySettings("low").shadows).toBe(false);
    expect(getRenderQualitySettings("high").shadows).toBe(true);
  });

  it("keeps relief scaling outside the simulation coordinate contract", () => {
    expect(VISUAL_HEIGHT_SCALE).toBeGreaterThan(1);
    expect(visualWorldY(4)).toBe(4 * VISUAL_HEIGHT_SCALE);
    const map = {
      heightUnitMm: 500,
      layers: { heightUnits: new Int16Array([8]) },
    } as never;
    expect(visualMapHeightMeters(map, 8)).toBe(4 * VISUAL_HEIGHT_SCALE);
  });
});
