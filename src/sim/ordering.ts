import type { ContactState, IntelMessage } from "./internal";
import type { GroupId } from "./types";

export function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function compareById<T extends { readonly id: string }>(a: T, b: T): number {
  return compareStrings(a.id, b.id);
}

export function compareByFactionId(
  a: { readonly factionId: string },
  b: { readonly factionId: string },
): number {
  return compareStrings(a.factionId, b.factionId);
}

export function compareIntelMessages(a: IntelMessage, b: IntelMessage): number {
  return a.deliveryAt - b.deliveryAt || a.sequence - b.sequence;
}

export function sortedContacts(contacts: ReadonlyMap<GroupId, ContactState>): ContactState[] {
  return [...contacts.values()].sort((a, b) =>
    compareStrings(a.targetGroupId, b.targetGroupId),
  );
}
