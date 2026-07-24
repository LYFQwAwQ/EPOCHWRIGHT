const UINT32_RANGE = 0x1_0000_0000;

export function hashString(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function mixUint32(value: number): number {
  let mixed = value >>> 0;
  mixed ^= mixed >>> 16;
  mixed = Math.imul(mixed, 0x7feb352d);
  mixed ^= mixed >>> 15;
  mixed = Math.imul(mixed, 0x846ca68b);
  mixed ^= mixed >>> 16;
  return mixed >>> 0;
}

export function createSeededRandom(seed: string): () => number {
  let state = hashString(seed);
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / UINT32_RANGE;
  };
}

export function deterministicUint32(
  battleSeed: string,
  stream: string,
  tick: number,
  entityKey: string,
  ordinal: number,
): number {
  let value = hashString(battleSeed);
  value = mixUint32(value ^ hashString(stream));
  value = mixUint32(value ^ mixUint32(tick));
  value = mixUint32(value ^ hashString(entityKey));
  return mixUint32(value ^ mixUint32(ordinal));
}

export function deterministicBps(
  battleSeed: string,
  stream: string,
  tick: number,
  entityKey: string,
  ordinal: number,
): number {
  return (
    deterministicUint32(battleSeed, stream, tick, entityKey, ordinal) % 10_000
  );
}

export class StateHasher {
  private hash = 0x811c9dc5;

  addNumber(value: number): void {
    this.addString(String(value));
  }

  addString(value: string): void {
    for (let index = 0; index < value.length; index += 1) {
      this.hash ^= value.charCodeAt(index);
      this.hash = Math.imul(this.hash, 0x01000193);
    }
    this.hash ^= 0xff;
    this.hash = Math.imul(this.hash, 0x01000193);
  }

  digest(): string {
    return (this.hash >>> 0).toString(16).padStart(8, "0");
  }
}
