import type { ObjectiveControlState } from "./types";

export const OBJECTIVE_CAPTURE_BPS_PER_MEMBER_TICK = 6;
export const OBJECTIVE_RECOVERY_BPS_PER_MEMBER_TICK = 4;
export const OBJECTIVE_POWER_CAP = 16;

export interface ObjectiveTickInput {
  readonly progressBps: number;
  readonly attackerPower: number;
  readonly defenderPower: number;
}

export interface ObjectiveTickResult {
  readonly progressBps: number;
  readonly state: ObjectiveControlState;
}

export function resolveObjectiveTick(input: ObjectiveTickInput): ObjectiveTickResult {
  const attackerPower = clampInteger(input.attackerPower, 0, OBJECTIVE_POWER_CAP);
  const defenderPower = clampInteger(input.defenderPower, 0, OBJECTIVE_POWER_CAP);
  let progressBps = clampInteger(input.progressBps, 0, 10_000);

  if (attackerPower > 0 && defenderPower === 0) {
    progressBps = Math.min(
      10_000,
      progressBps + attackerPower * OBJECTIVE_CAPTURE_BPS_PER_MEMBER_TICK,
    );
  } else if (defenderPower > 0 && attackerPower === 0) {
    progressBps = Math.max(
      0,
      progressBps - defenderPower * OBJECTIVE_RECOVERY_BPS_PER_MEMBER_TICK,
    );
  }

  if (progressBps >= 10_000) {
    return { progressBps: 10_000, state: "attacker-controlled" };
  }
  if (attackerPower > 0 && defenderPower > 0) {
    return { progressBps, state: "contested" };
  }
  if (attackerPower > 0) {
    return { progressBps, state: "capturing" };
  }
  if (defenderPower > 0 && progressBps > 0) {
    return { progressBps, state: "recovering" };
  }
  if (progressBps === 0) {
    return { progressBps, state: "defender-controlled" };
  }
  return { progressBps, state: "unoccupied" };
}

function clampInteger(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, Math.round(value)));
}
