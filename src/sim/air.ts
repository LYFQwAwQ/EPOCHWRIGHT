import { heightAt } from "./map";
import type {
  AirAltitudeBand,
  BattleMap,
  GridCoord,
  MovementType,
  PlatformFlightInspection,
} from "./types";

export interface AirspaceOccupant {
  readonly id: string;
  readonly cell: GridCoord;
  readonly altitudeBand: AirAltitudeBand;
  readonly safetyRadiusMm: number;
}

export function isAirMovementType(movementType: MovementType): boolean {
  return movementType === "hover";
}

export function flightHeightUnits(
  map: BattleMap,
  cell: GridCoord,
  flight: PlatformFlightInspection,
): number {
  return heightAt(map, cell) + flight.clearanceMm / map.heightUnitMm;
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
