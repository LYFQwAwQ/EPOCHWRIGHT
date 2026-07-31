import { cellIndex, heightAt, isInsideMap } from "./map";
import type {
  AirAltitudeBand,
  BattleMap,
  FlightAltitudeCandidateInspection,
  GridCoord,
  MovementType,
  PlatformFlightInspection,
} from "./types";
import { MAP_CELL_FLAGS, STATIC_OBJECT_DEFINITIONS } from "./types";

export const AIR_ALTITUDE_BANDS = ["low", "medium", "high"] as const;
export const AIR_ALTITUDE_TRANSITION_TICKS_PER_BAND = 20;
export const AIR_MIN_TERRAIN_CLEARANCE_MM = 2_000;

const AIR_ALTITUDE_MODIFIERS: Readonly<
  Record<AirAltitudeBand, { readonly sensorRangeBps: number; readonly exposureBps: number }>
> = {
  low: { sensorRangeBps: 9_000, exposureBps: 0 },
  medium: { sensorRangeBps: 10_000, exposureBps: 1_400 },
  high: { sensorRangeBps: 11_000, exposureBps: 2_400 },
};

const STATIC_OBJECT_HEIGHT_UNITS_BY_TYPE_ID = new Map<number, number>(
  Object.values(STATIC_OBJECT_DEFINITIONS).map((definition) => [
    definition.typeId,
    definition.heightUnits,
  ]),
);

export interface FlightAltitudeCandidateInput {
  readonly altitudeBand: AirAltitudeBand;
  readonly clearanceMm: number;
  readonly visibleInterestCount: number;
  readonly attackOpportunityBps?: number;
  readonly routeClear: boolean;
}

export interface AirspaceOccupant {
  readonly id: string;
  readonly cell: GridCoord;
  readonly altitudeBand: AirAltitudeBand;
  readonly safetyRadiusMm: number;
}

export function isAirMovementType(movementType: MovementType): boolean {
  return movementType === "hover";
}

export function altitudeBandIndex(band: AirAltitudeBand): number {
  return AIR_ALTITUDE_BANDS.indexOf(band);
}

export function altitudeBandsBetweenInclusive(
  first: AirAltitudeBand,
  second: AirAltitudeBand,
): readonly AirAltitudeBand[] {
  const start = Math.min(altitudeBandIndex(first), altitudeBandIndex(second));
  const end = Math.max(altitudeBandIndex(first), altitudeBandIndex(second));
  return AIR_ALTITUDE_BANDS.slice(start, end + 1);
}

export function altitudeBandModifiers(band: AirAltitudeBand): {
  readonly sensorRangeBps: number;
  readonly exposureBps: number;
} {
  return AIR_ALTITUDE_MODIFIERS[band];
}

export function altitudeTransitionTicks(
  fromBand: AirAltitudeBand,
  toBand: AirAltitudeBand,
): number {
  return (
    Math.abs(altitudeBandIndex(fromBand) - altitudeBandIndex(toBand)) *
    AIR_ALTITUDE_TRANSITION_TICKS_PER_BAND
  );
}

export function flightTransitionClearanceMm(
  startClearanceMm: number,
  targetClearanceMm: number,
  totalTicks: number,
  ticksRemaining: number,
  quantumMm = 1,
): number {
  if (totalTicks <= 0 || ticksRemaining <= 0) {
    return targetClearanceMm;
  }
  const safeQuantumMm = Number.isInteger(quantumMm) && quantumMm > 0 ? quantumMm : 1;
  const elapsedTicks = Math.max(0, totalTicks - ticksRemaining);
  const interpolated = startClearanceMm + Math.trunc(
    ((targetClearanceMm - startClearanceMm) * elapsedTicks) / totalTicks,
  );
  const quantized = Math.round(interpolated / safeQuantumMm) * safeQuantumMm;
  return targetClearanceMm >= startClearanceMm
    ? Math.min(targetClearanceMm, quantized)
    : Math.max(targetClearanceMm, quantized);
}

export function scoreFlightAltitudeCandidates(
  currentBand: AirAltitudeBand,
  candidates: readonly FlightAltitudeCandidateInput[],
): readonly FlightAltitudeCandidateInspection[] {
  return candidates
    .map<FlightAltitudeCandidateInspection>((candidate) => {
      const modifiers = altitudeBandModifiers(candidate.altitudeBand);
      const components = {
        observation: candidate.visibleInterestCount * 4_000,
        attack: Math.max(0, Math.min(8_000, candidate.attackOpportunityBps ?? 0)),
        sensor: Math.trunc((modifiers.sensorRangeBps - 9_000) / 2),
        exposure: -modifiers.exposureBps,
        terrain: candidate.routeClear ? 0 : -10_000,
        retention: candidate.altitudeBand === currentBand ? 400 : 0,
        transition:
          -Math.abs(
            altitudeBandIndex(candidate.altitudeBand) - altitudeBandIndex(currentBand),
          ) * 350,
      };
      return {
        ...candidate,
        attackOpportunityBps: candidate.attackOpportunityBps ?? 0,
        score: Object.values(components).reduce((sum, value) => sum + value, 0),
        components,
        rejectionReason: candidate.routeClear ? undefined : "terrain-clearance",
      };
    })
    .sort(
      (a, b) =>
        Number(Boolean(a.rejectionReason)) - Number(Boolean(b.rejectionReason)) ||
        b.score - a.score ||
        altitudeBandIndex(a.altitudeBand) - altitudeBandIndex(b.altitudeBand),
    );
}

export function flightStepHasTerrainClearance(
  map: BattleMap,
  from: GridCoord,
  to: GridCoord,
  clearanceMm: number,
): boolean {
  if (!isInsideMap(map, from) || !isInsideMap(map, to)) {
    return false;
  }
  const destinationIndex = cellIndex(map, to);
  const staticHeightUnits =
    STATIC_OBJECT_HEIGHT_UNITS_BY_TYPE_ID.get(
      map.layers.staticOccupancy[destinationIndex] ?? 0,
    ) ?? 0;
  const blockedHeightUnits =
    ((map.layers.cellFlags[destinationIndex] ?? 0) & MAP_CELL_FLAGS.groundBlocked) !== 0
      ? 2
      : 0;
  const obstacleHeightUnits = Math.max(staticHeightUnits, blockedHeightUnits);
  const currentAltitudeMm = heightAt(map, from) * map.heightUnitMm + clearanceMm;
  const requiredAltitudeMm =
    (heightAt(map, to) + obstacleHeightUnits) * map.heightUnitMm +
    AIR_MIN_TERRAIN_CLEARANCE_MM;
  return currentAltitudeMm >= requiredAltitudeMm;
}

export function flightHeightUnits(
  map: BattleMap,
  cell: GridCoord,
  flight: PlatformFlightInspection,
): number {
  return heightAt(map, cell) + flight.clearanceMm / map.heightUnitMm;
}

export function spatialDistanceSquaredMm(
  map: BattleMap,
  firstCell: GridCoord,
  secondCell: GridCoord,
  firstFlight?: PlatformFlightInspection,
  secondFlight?: PlatformFlightInspection,
): number {
  const dxMm = (firstCell.x - secondCell.x) * map.cellSizeMm;
  const dzMm = (firstCell.z - secondCell.z) * map.cellSizeMm;
  const firstHeightMm = heightAt(map, firstCell) * map.heightUnitMm +
    (firstFlight?.state === "airborne" ? firstFlight.clearanceMm : 0);
  const secondHeightMm = heightAt(map, secondCell) * map.heightUnitMm +
    (secondFlight?.state === "airborne" ? secondFlight.clearanceMm : 0);
  const dyMm = firstHeightMm - secondHeightMm;
  const squared = dxMm * dxMm + dyMm * dyMm + dzMm * dzMm;
  if (!Number.isSafeInteger(squared)) {
    throw new RangeError("Air combat distance exceeds the safe integer range.");
  }
  return squared;
}

export function airspaceOccupantsConflict(
  cellSizeMm: number,
  first: AirspaceOccupant,
  second: AirspaceOccupant,
): boolean {
  if (first.id === second.id || first.altitudeBand !== second.altitudeBand) {
    return false;
  }
  const dxMm = BigInt(first.cell.x - second.cell.x) * BigInt(cellSizeMm);
  const dzMm = BigInt(first.cell.z - second.cell.z) * BigInt(cellSizeMm);
  const requiredMm = BigInt(first.safetyRadiusMm + second.safetyRadiusMm);
  return dxMm * dxMm + dzMm * dzMm < requiredMm * requiredMm;
}

export function hasAirspaceConflict(
  cellSizeMm: number,
  candidate: AirspaceOccupant,
  occupants: readonly AirspaceOccupant[],
): boolean {
  return occupants.some((occupant) =>
    airspaceOccupantsConflict(cellSizeMm, candidate, occupant),
  );
}
