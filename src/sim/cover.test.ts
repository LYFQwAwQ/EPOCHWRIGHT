import { describe, expect, it } from "vitest";
import { createDemoBattleSetup } from "../demo";
import {
  BATTLE_MAP_SCHEMA_VERSION,
  DEFAULT_GROUP_TEMPLATE_ID,
  DEFAULT_MEMBER_TEMPLATE_ID,
  STATIC_OBJECT_DEFINITIONS,
  SURFACE_TYPE_IDS,
  WATER_DEPTH_UNITS,
  createSimulation,
  type BattleMap,
  type BattleSetup,
  type FactionId,
  type GroupInspection,
  type GroupSpawn,
  type StaticMapObject,
} from "./index";
import {
  buildCoverSlots,
  claimCoverSlot,
  releaseCoverSlot,
  resolveDirectionalCoverEffect,
} from "./cover";

describe("authoritative directional cover", () => {
  it("derives stable standable slots behind static-object facing normals", () => {
    const map = createCoverMap([
      createStaticObject("wall-a", "wall", 4, 4, 0),
      createStaticObject("rock-a", "rock", 7, 4, 2),
      createStaticObject("tree-edge", "tree", 0, 0, 0),
    ]);

    expect(buildCoverSlots(map)).toEqual([
      {
        id: "rock-a:cover-0",
        staticObjectId: "rock-a",
        staticObjectKind: "rock",
        objectCell: { x: 7, z: 4 },
        cell: { x: 6, z: 4 },
        facing: 2,
        capacity: STATIC_OBJECT_DEFINITIONS.rock.cover.capacity,
        protectionBps: STATIC_OBJECT_DEFINITIONS.rock.cover.protectionBps,
        concealmentBps: STATIC_OBJECT_DEFINITIONS.rock.cover.concealmentBps,
      },
      {
        id: "wall-a:cover-0",
        staticObjectId: "wall-a",
        staticObjectKind: "wall",
        objectCell: { x: 4, z: 4 },
        cell: { x: 4, z: 3 },
        facing: 0,
        capacity: STATIC_OBJECT_DEFINITIONS.wall.cover.capacity,
        protectionBps: STATIC_OBJECT_DEFINITIONS.wall.cover.protectionBps,
        concealmentBps: STATIC_OBJECT_DEFINITIONS.wall.cover.concealmentBps,
      },
    ]);
  });

  it("scales one unified effect by capacity and attack direction", () => {
    const slot = buildCoverSlots(
      createCoverMap([createStaticObject("wall", "wall", 4, 4, 0)]),
    )[0]!;

    const front = resolveDirectionalCoverEffect(slot, 8, { x: 4, z: 9 });
    expect(front.aspect).toBe("front");
    expect(front.coveredMembers).toBe(6);
    expect(front.protectionBps).toBe(
      Math.round((STATIC_OBJECT_DEFINITIONS.wall.cover.protectionBps * 6) / 8),
    );
    expect(front.concealmentBps).toBe(
      Math.round((STATIC_OBJECT_DEFINITIONS.wall.cover.concealmentBps * 6) / 8),
    );

    const flank = resolveDirectionalCoverEffect(slot, 8, { x: 9, z: 3 });
    expect(flank.aspect).toBe("flank");
    expect(flank.protectionBps).toBe(Math.round(front.protectionBps / 2));
    expect(flank.concealmentBps).toBe(Math.round(front.concealmentBps / 2));

    const rear = resolveDirectionalCoverEffect(slot, 8, { x: 4, z: 0 });
    expect(rear).toMatchObject({
      aspect: "rear",
      coveredMembers: 6,
      protectionBps: 0,
      concealmentBps: 0,
    });

    const undersizedGroup = resolveDirectionalCoverEffect(slot, 4, { x: 4, z: 9 });
    expect(undersizedGroup.coveredMembers).toBe(4);
    expect(undersizedGroup.protectionBps).toBe(
      STATIC_OBJECT_DEFINITIONS.wall.cover.protectionBps,
    );
  });

  it("resolves slot contention and owner-only release deterministically", () => {
    const slot = buildCoverSlots(
      createCoverMap([createStaticObject("wall", "wall", 4, 4, 0)]),
    )[0]!;
    const occupancy = new Map<string, string>();

    expect(claimCoverSlot(occupancy, slot, "ember-a")).toBe(true);
    expect(claimCoverSlot(occupancy, slot, "ember-b")).toBe(false);
    expect(releaseCoverSlot(occupancy, slot.id, "ember-b")).toBe(false);
    expect(occupancy.get(slot.id)).toBe("ember-a");
    expect(releaseCoverSlot(occupancy, slot.id, "ember-a")).toBe(true);
    expect(claimCoverSlot(occupancy, slot, "ember-b")).toBe(true);
  });

  it("claims cover on spawn, hashes occupancy, and releases it after leaving", () => {
    const simulation = createSimulation(createCoverSetup(2, 1));
    const initial = simulation.inspect("azure-covered") as GroupInspection;
    expect(initial.currentCover).toMatchObject({
      staticObjectId: "test-wall",
      capacity: 6,
      coveredMembers: 6,
    });

    const occupiedHash = simulation.getStateHash();
    const runtime = simulation as unknown as {
      readonly state: { readonly coverOccupancy: Map<string, string> };
    };
    runtime.state.coverOccupancy.clear();
    expect(simulation.getStateHash()).not.toBe(occupiedHash);

    const movingSimulation = createSimulation(createCoverSetup(2, 1));
    movingSimulation.step(40);
    const afterMove = movingSimulation.inspect("azure-covered") as GroupInspection;
    expect(afterMove.cell).not.toEqual({ x: 12, z: 10 });
    expect(afterMove.currentCover).toBeUndefined();
  });

  it("uses occupied cover to delay frontal discovery but not rear discovery", () => {
    const frontalTick = findSpotTick(createCoverSetup(18, 12));
    const rearTick = findSpotTick(createCoverSetup(2, 12));

    expect(frontalTick).toBeTypeOf("number");
    expect(rearTick).toBeTypeOf("number");
    expect(frontalTick!).toBeGreaterThan(rearTick!);
  });

  it("applies the same frontal cover state to weapon hit resolution", () => {
    const frontal = createSimulation(createCoverSetup(18, 12, "cover-hit-0", 12));
    prepareDirectEngagement(frontal);
    frontal.step();
    const frontalEvents = frontal.drainEvents();
    const frontalHits = frontalEvents.filter(
      (event) =>
        event.type === "member-health-changed" && event.groupId === "azure-covered",
    );

    const rear = createSimulation(createCoverSetup(2, 12, "cover-hit-0", 12));
    prepareDirectEngagement(rear);
    rear.step();
    const rearHits = rear
      .drainEvents()
      .filter(
        (event) =>
          event.type === "member-health-changed" && event.groupId === "azure-covered",
      );

    expect(frontalHits).toHaveLength(0);
    expect(rearHits).toHaveLength(1);
    expect(
      frontalEvents.some(
        (event) => event.type === "weapon-fired" && event.groupId === "azure-covered",
      ),
    ).toBe(true);
  });
});

function prepareDirectEngagement(simulation: ReturnType<typeof createSimulation>): void {
  type MutableGroup = {
    readonly id: string;
    readonly cell: { readonly x: number; readonly z: number };
    action: string;
    currentTargetId?: string;
    path: { readonly x: number; readonly z: number }[];
    readonly localDetections: Map<
      string,
      {
        progressBps: number;
        lastCandidateTick: number;
        lastSentTick: number;
        confirmed: boolean;
      }
    >;
    readonly localContacts: Map<
      string,
      {
        targetGroupId: string;
        lastKnown: { readonly x: number; readonly z: number };
        observedAt: number;
        lastDirectTick: number;
        confidenceBps: number;
        sourceGroupId: string;
      }
    >;
  };
  const runtime = simulation as unknown as {
    readonly state: { readonly groupsById: Map<string, MutableGroup> };
  };
  const ember = runtime.state.groupsById.get("ember-observer")!;
  const azure = runtime.state.groupsById.get("azure-covered")!;
  for (const [observer, target] of [
    [ember, azure],
    [azure, ember],
  ] as const) {
    observer.action = "engaging";
    observer.currentTargetId = target.id;
    observer.path = [];
    observer.localDetections.set(target.id, {
      progressBps: 10_000,
      lastCandidateTick: 0,
      lastSentTick: 0,
      confirmed: true,
    });
    observer.localContacts.set(target.id, {
      targetGroupId: target.id,
      lastKnown: { ...target.cell },
      observedAt: 0,
      lastDirectTick: 0,
      confidenceBps: 10_000,
      sourceGroupId: observer.id,
    });
  }
}

function findSpotTick(setup: BattleSetup): number | undefined {
  const simulation = createSimulation(setup);
  for (let tick = 0; tick < 30; tick += 1) {
    simulation.step();
    const spotted = simulation
      .drainEvents()
      .find(
        (event) =>
          event.type === "contact-spotted" &&
          event.observerGroupId === "ember-observer" &&
          event.targetGroupId === "azure-covered",
      );
    if (spotted) {
      return spotted.tick;
    }
  }
  return undefined;
}

function createCoverSetup(
  observerZ: number,
  sightRangeCells: number,
  seed = "directional-cover",
  weaponRangeCells = 1,
): BattleSetup {
  const base = createDemoBattleSetup({
    seed,
    width: 40,
    height: 24,
    groupsPerFaction: 1,
    maximumDurationSeconds: 120,
    stalemateSeconds: 90,
  });
  return {
    ...base,
    battleId: `cover-${seed}-${observerZ}-${sightRangeCells}`,
    map: createCoverMap([createStaticObject("test-wall", "wall", 12, 11, 0)], 40, 24),
    groups: [
      createGroup("ember-observer", "ember", 12, observerZ),
      createGroup("azure-covered", "azure", 12, 10),
    ],
    rules: {
      ...base.rules,
      sightRangeCells,
      weaponRangeCells,
      preferredRangeCells: Math.min(8, weaponRangeCells),
    },
  };
}

function createCoverMap(
  staticObjects: readonly StaticMapObject[],
  width = 10,
  height = 10,
): BattleMap {
  const size = width * height;
  const staticOccupancy = new Uint8Array(size);
  for (const object of staticObjects) {
    staticOccupancy[object.cell.z * width + object.cell.x] =
      STATIC_OBJECT_DEFINITIONS[object.kind].typeId;
  }
  return {
    schemaVersion: BATTLE_MAP_SCHEMA_VERSION,
    width,
    height,
    cellSizeMm: 4_000,
    heightUnitMm: 500,
    layers: {
      heightUnits: new Int16Array(size),
      surfaceTypeIds: new Uint16Array(size).fill(SURFACE_TYPE_IDS.grass),
      waterDepthUnits: new Uint8Array(size).fill(WATER_DEPTH_UNITS.none),
      cellFlags: new Uint16Array(size),
      staticOccupancy,
    },
    staticObjects,
  };
}

function createStaticObject(
  id: string,
  kind: StaticMapObject["kind"],
  x: number,
  z: number,
  facing: StaticMapObject["facing"],
): StaticMapObject {
  return { id, kind, cell: { x, z }, facing };
}

function createGroup(
  id: string,
  factionId: FactionId,
  x: number,
  z: number,
): GroupSpawn {
  return {
    id,
    factionId,
    groupTemplateId: DEFAULT_GROUP_TEMPLATE_ID,
    spawn: { x, z },
    evacuation: { x, z },
    members: Array.from({ length: 8 }, (_, index) => ({
      id: `${id}-member-${index + 1}`,
      memberTemplateId: DEFAULT_MEMBER_TEMPLATE_ID,
    })),
  };
}
