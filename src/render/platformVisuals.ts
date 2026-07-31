import { Color, Vector3 } from "three";
import type { RenderPlatform } from "../sim/types";
import { visualWorldY } from "./elevation";

export const ARTILLERY_BARREL_CENTER_Z = 1.55;
export const ARTILLERY_BARREL_LENGTH = 3.65;
export const ARTILLERY_SPADE_CENTER_Z = -1.82;
export const ARTILLERY_DEPLOYED_ELEVATION_RADIANS = 0.28;
export const ARTILLERY_PACKED_ELEVATION_RADIANS = 0.08;
export const AIR_PLATFORM_MODEL_YAW_OFFSET_RADIANS = Math.PI;

export function platformStateColor(
  factionColor: string,
  disposition: RenderPlatform["disposition"],
  damaged: boolean,
): string {
  const color = new Color(factionColor);
  if (disposition === "destroyed") {
    color.lerp(new Color("#252927"), 0.62);
  } else if (damaged) {
    color.lerp(new Color("#332e29"), 0.22);
  }
  return `#${color.getHexString()}`;
}

export function artilleryMuzzleWorldPosition(platform: RenderPlatform): Vector3 {
  const deployed = platform.deployment === "deployed" || platform.deployment === "deploying";
  const elevation = deployed
    ? ARTILLERY_DEPLOYED_ELEVATION_RADIANS
    : ARTILLERY_PACKED_ELEVATION_RADIANS;
  const barrelCenterY = deployed ? 1.08 : 0.92;
  const barrelHalfLength = ARTILLERY_BARREL_LENGTH / 2;
  const forwardOffset = ARTILLERY_BARREL_CENTER_Z + barrelHalfLength * Math.cos(elevation);
  const heightOffset = 0.72 + barrelCenterY + barrelHalfLength * Math.sin(elevation);

  return new Vector3(
    platform.worldX + Math.sin(platform.headingRadians) * forwardOffset,
    visualWorldY(platform.worldY) + heightOffset,
    platform.worldZ + Math.cos(platform.headingRadians) * forwardOffset,
  );
}
