import type { FactionId, RelationKind, RelationSetup, Tick } from "./types";

const RELATION_KEY_SEPARATOR = "\u0000";

/** Returns a stable, orientation-independent key for an unordered faction pair. */
export function relationKey(a: FactionId, b: FactionId): string {
  return a < b
    ? `${a}${RELATION_KEY_SEPARATOR}${b}`
    : `${b}${RELATION_KEY_SEPARATOR}${a}`;
}

/** Looks up a relation without giving orientation semantic meaning. */
export function findRelation(
  relations: readonly RelationSetup[],
  a: FactionId,
  b: FactionId,
): RelationSetup | undefined {
  if (a === b) {
    return undefined;
  }
  const key = relationKey(a, b);
  return relations.find((relation) => relationKey(relation.a, relation.b) === key);
}

export function relationKind(
  relations: readonly RelationSetup[],
  a: FactionId,
  b: FactionId,
): RelationKind | undefined {
  return findRelation(relations, a, b)?.kind;
}

export function areHostile(
  relations: readonly RelationSetup[],
  a: FactionId,
  b: FactionId,
): boolean {
  return a !== b && relationKind(relations, a, b) === "hostile";
}

export function areAllied(
  relations: readonly RelationSetup[],
  a: FactionId,
  b: FactionId,
): boolean {
  return a !== b && relationKind(relations, a, b) === "allied";
}

export function defaultRelation(
  a: FactionId,
  b: FactionId,
  kind: RelationKind = "hostile",
  minimumIntelDelayTicks: Tick = 15,
  intelUpdateIntervalTicks: Tick = 10,
): RelationSetup {
  return {
    a,
    b,
    kind,
    shareIntel: kind === "allied",
    minimumIntelDelayTicks,
    intelUpdateIntervalTicks,
  };
}

export function sortRelations(
  relations: readonly RelationSetup[],
): RelationSetup[] {
  return [...relations].sort((left, right) => {
    const leftKey = relationKey(left.a, left.b);
    const rightKey = relationKey(right.a, right.b);
    return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0;
  });
}
