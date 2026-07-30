import { describe, expect, it } from "vitest";
import { Color } from "three";
import {
  DEFAULT_RENDER_QUALITY,
  getRenderQualitySettings,
  parseRenderQuality,
} from "./quality";
import { VISUAL_HEIGHT_SCALE, visualMapHeightMeters, visualWorldY } from "./elevation";
import {
  ARTILLERY_BARREL_CENTER_Z,
  ARTILLERY_SPADE_CENTER_Z,
  artilleryMuzzleWorldPosition,
  platformStateColor,
} from "./platformVisuals";

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
    expect(getRenderQualitySettings("low").maxImpactBursts).toBeLessThan(
      getRenderQualitySettings("high").maxImpactBursts,
    );
    expect(getRenderQualitySettings("low").maxProjectileTracers).toBeLessThan(
      getRenderQualitySettings("high").maxProjectileTracers,
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

  it("keeps the artillery muzzle ahead of the hull and deployment spades behind it", () => {
    expect(ARTILLERY_BARREL_CENTER_Z).toBeGreaterThan(0);
    expect(ARTILLERY_SPADE_CENTER_Z).toBeLessThan(0);

    const facingNorth = artilleryMuzzleWorldPosition({
      worldX: 0,
      worldY: 0,
      worldZ: 0,
      headingRadians: 0,
      deployment: "deployed",
    } as never);
    const facingEast = artilleryMuzzleWorldPosition({
      worldX: 0,
      worldY: 0,
      worldZ: 0,
      headingRadians: Math.PI / 2,
      deployment: "deployed",
    } as never);
    expect(facingNorth.z).toBeGreaterThan(0);
    expect(facingEast.x).toBeGreaterThan(0);
  });

  it("preserves faction hue when a platform is damaged or destroyed", () => {
    const damagedEmber = new Color(platformStateColor("#e45f62", "crewed", true));
    const damagedAzure = new Color(platformStateColor("#3e8fd1", "crewed", true));
    const destroyedEmber = new Color(platformStateColor("#e45f62", "destroyed", true));
    const destroyedAzure = new Color(platformStateColor("#3e8fd1", "destroyed", true));

    expect(damagedEmber.r).toBeGreaterThan(damagedEmber.b);
    expect(damagedAzure.b).toBeGreaterThan(damagedAzure.r);
    expect(destroyedEmber.r).toBeGreaterThan(destroyedEmber.b);
    expect(destroyedAzure.b).toBeGreaterThan(destroyedAzure.r);
    expect(destroyedEmber.getHexString()).not.toBe(destroyedAzure.getHexString());
  });
});
