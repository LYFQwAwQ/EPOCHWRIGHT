import { describe, expect, it } from "vitest";
import { createDemoScenarioOptions } from "../demo/scenarios";
import { createDemoBattleSetup } from "../demo/setup";
import {
  BATTLE_CONTENT_VERSION,
  BATTLE_RULES_VERSION,
  BATTLE_SETUP_SCHEMA_VERSION,
  DEFAULT_AIR_RECON_PLATFORM_TEMPLATE_ID,
  PRE_AIR_BATTLE_RULES_VERSION,
  PRE_AIR_BATTLE_SETUP_SCHEMA_VERSION,
  airspaceOccupantsConflict,
  cloneBattleContent,
  createSimulation,
  flightHeightUnits,
  hasLineOfSight,
  migrateBattleSetup,
  validateBattleContent,
  validateBattleSetup,
} from "./index";
import type {
  BattleSetup,
  BattleSetupInput,
  GridCoord,
  GroupInspection,
  GroupSpawn,
  PlatformSpawn,
  PlatformInspection,
} from "./types";

type Mutable<T> = { -readonly [Key in keyof T]: T[Key] };
type MutableGroupSpawn = Mutable<GroupSpawn> & { platforms: PlatformSpawn[] };
type MutableBattleSetup = Mutable<BattleSetup> & { groups: MutableGroupSpawn[] };

describe("AIR-001 hover airspace", () => {
  it("migrates the final stage-3 contract and validates hover flight content", () => {
    const current = createDemoBattleSetup({ seed: "air-migration", groupsPerFaction: 1 });
    const migrated = migrateBattleSetup({
      ...current,
      schemaVersion: PRE_AIR_BATTLE_SETUP_SCHEMA_VERSION,
      rulesVersion: PRE_AIR_BATTLE_RULES_VERSION,
      content: {
        ...current.content,
        contentVersion: "content-3",
      },
    } satisfies BattleSetupInput);

    expect(migrated.schemaVersion).toBe(BATTLE_SETUP_SCHEMA_VERSION);
    expect(migrated.rulesVersion).toBe(BATTLE_RULES_VERSION);
    expect(migrated.content.contentVersion).toBe(BATTLE_CONTENT_VERSION);
    expect(() => validateBattleSetup(migrated)).not.toThrow();

    const invalidContent = cloneBattleContent(migrated.content);
    const air = invalidContent.platformTemplates[DEFAULT_AIR_RECON_PLATFORM_TEMPLATE_ID]!;
    expect(() =>
      validateBattleContent({
        ...invalidContent,
        platformTemplates: {
          ...invalidContent.platformTemplates,
          [air.id]: {
            ...air,
            flightRule: { ...air.flightRule!, safetyRadiusMm: 0 },
          },
        },
      }),
    ).toThrow(/flight rule/i);
  });

  it("requires supported air bands, rejects same-band overlap, and permits ground sharing", () => {
    const missingBand = createAirSetup("air-missing-band", 1);
    const missingAir = airGroups(missingBand)[0]!;
    missingAir.platforms[0] = { ...missingAir.platforms[0]!, initialAltitudeBand: undefined };
    expect(() => validateBattleSetup(missingBand)).toThrow(/initial altitude band/i);

    const conflict = createAirSetup("air-initial-conflict", 1);
    const [emberAir, azureAir] = airGroups(conflict);
    azureAir!.spawn = { ...emberAir!.spawn };
    expect(() => validateBattleSetup(conflict)).toThrow(/safety separation/i);

    const splitBand = createAirSetup("air-split-band", 1);
    const [lowAir, mediumAir] = airGroups(splitBand);
    mediumAir!.spawn = { ...lowAir!.spawn };
    mediumAir!.platforms[0] = {
      ...mediumAir!.platforms[0]!,
      initialAltitudeBand: "medium",
    };
    expect(() => validateBattleSetup(splitBand)).not.toThrow();

    const shared = createAirSetup("air-ground-sharing", 1);
    const air = airGroups(shared)[0]!;
    const ground = shared.groups.find(
      (group) => group.factionId === air.factionId && group.platforms.length === 0,
    )!;
    mutableGroup(ground).spawn = { ...air.spawn };
    expect(() => validateBattleSetup(shared)).not.toThrow();
  });

  it("uses exact deterministic safety radii and authoritative height for sight and projection", () => {
    expect(
      airspaceOccupantsConflict(
        4_000,
        { id: "a", cell: { x: 1, z: 1 }, altitudeBand: "low", safetyRadiusMm: 2_000 },
        { id: "b", cell: { x: 2, z: 1 }, altitudeBand: "low", safetyRadiusMm: 2_000 },
      ),
    ).toBe(false);
    expect(
      airspaceOccupantsConflict(
        4_000,
        { id: "a", cell: { x: 1, z: 1 }, altitudeBand: "low", safetyRadiusMm: 2_001 },
        { id: "b", cell: { x: 2, z: 1 }, altitudeBand: "low", safetyRadiusMm: 2_000 },
      ),
    ).toBe(true);

    const setup = createAirSetup("air-height", 1);
    const group = airGroups(setup)[0]!;
    const simulation = createSimulation(setup);
    const platformId = group.platforms[0]!.id;
    const inspection = simulation.inspect(platformId) as PlatformInspection;
    const rendered = simulation.getRenderFrame().platforms.find(
      (platform) => platform.id === platformId,
    )!;
    const expectedHeightUnits = flightHeightUnits(setup.map, group.spawn, inspection.flight!);

    expect(inspection.flight).toEqual({ altitudeBand: "low", clearanceMm: 12_000 });
    expect(rendered.flight).toEqual(inspection.flight);
    expect(rendered.worldY).toBe(expectedHeightUnits * setup.map.heightUnitMm / 1_000);

    const from = { x: 8, z: 8 };
    const to = { x: 12, z: 8 };
    setup.map.layers.heightUnits[8 * setup.map.width + 10] = 20;
    expect(hasLineOfSight(setup.map, from, to)).toBe(false);
    expect(
      hasLineOfSight(setup.map, from, to, {
        observerHeightUnits: 24,
        targetHeightUnits: 24,
      }),
    ).toBe(true);
  });

  it("resolves simultaneous hover movement with stable airspace reservations", () => {
    const setup = createAirSetup("air-movement-conflict", 2);
    const [firstSpawn, secondSpawn] = airGroups(setup).filter(
      (group) => group.factionId === "ember",
    );
    setSpawn(firstSpawn!, { x: 10, z: 10 });
    setSpawn(secondSpawn!, { x: 12, z: 10 });
    const simulation = createSimulation(setup);
    const internals = simulation as unknown as {
      readonly state: {
        readonly groupsById: Map<string, {
          id: string;
          action: string;
          path: GridCoord[];
          movingTo?: GridCoord;
          waitAge: number;
        }>;
        readonly airspaceReservations: Map<string, GridCoord>;
      };
      advanceMovement(): void;
    };
    const destination = { x: 11, z: 10 };
    for (const spawn of [firstSpawn!, secondSpawn!]) {
      const group = internals.state.groupsById.get(spawn.id)!;
      group.action = "searching";
      group.path = [{ ...destination }];
      group.waitAge = 0;
    }

    internals.advanceMovement();

    expect(internals.state.groupsById.get(firstSpawn!.id)!.movingTo).toEqual(destination);
    expect(internals.state.groupsById.get(secondSpawn!.id)!.movingTo).toBeUndefined();
    expect(internals.state.groupsById.get(secondSpawn!.id)!.waitAge).toBe(1);
    expect(internals.state.airspaceReservations.get(firstSpawn!.id)).toEqual(destination);
    expect(internals.state.airspaceReservations.has(secondSpawn!.id)).toBe(false);
  });

  it("keeps hover groups out of ground occupancy and objective capture", () => {
    const setup = createAirSetup("air-no-capture", 1);
    const air = airGroups(setup).find((group) => group.factionId === "ember")!;
    mutableSetup(setup).mode = {
      kind: "defense",
      attackerFactionId: "ember",
      defenderFactionId: "azure",
      objective: { id: "air-objective", center: { ...air.spawn }, radiusCells: 2 },
      objectives: [{ id: "air-objective", center: { ...air.spawn }, radiusCells: 2 }],
      objectiveRule: "all",
    };
    const simulation = createSimulation(setup);
    const internals = simulation as unknown as {
      readonly state: { readonly occupancy: ReadonlyMap<number, string> };
    };
    simulation.step();

    expect([...internals.state.occupancy.values()]).not.toContain(air.id);
    expect(simulation.getRenderFrame().objectives[0]).toMatchObject({
      attackerPower: 0,
      progressBps: 0,
    });
  });

  it("moves deterministic recon platforms and freezes final flight results", () => {
    const options = {
      ...createDemoScenarioOptions("air-recon", "air-deterministic"),
      maximumDurationSeconds: 4,
      stalemateSeconds: 3,
    };
    const first = createSimulation(createDemoBattleSetup(options));
    const second = createSimulation(createDemoBattleSetup(options));
    const initial = (first.inspect("ember-air-recon-1") as GroupInspection).cell;

    for (let tick = 0; tick < 160 && first.status === "active"; tick += 1) {
      first.step();
      second.step();
      expect(second.getStateHash(), `air hash at tick ${tick + 1}`).toBe(first.getStateHash());
    }

    const finalCell = (first.inspect("ember-air-recon-1") as GroupInspection).cell;
    expect(finalCell).not.toEqual(initial);
    expect(first.getResult()?.platforms.find(
      (platform) => platform.id === "ember-air-recon-1-platform",
    )?.finalFlight).toEqual({ altitudeBand: "low", clearanceMm: 12_000 });
    const frozenHash = first.getStateHash();
    first.step(20);
    expect(first.getStateHash()).toBe(frozenHash);
  });
});

function createAirSetup(seed: string, airGroupsPerFaction: number): BattleSetup {
  return createDemoBattleSetup({
    seed,
    width: 32,
    height: 24,
    groupsPerFaction: airGroupsPerFaction + 1,
    airGroupsPerFaction,
    mountainDensity: 0,
    roughness: 0,
    waterCoverage: 0,
    wetlandCoverage: 0,
    treeCoverage: 0,
    rockCoverage: 0,
    wallCoverage: 0,
    maximumDurationSeconds: 20,
    stalemateSeconds: 10,
  });
}

function airGroups(setup: BattleSetup): MutableGroupSpawn[] {
  return setup.groups.filter(
    (group) =>
      group.platforms[0]?.platformTemplateId === DEFAULT_AIR_RECON_PLATFORM_TEMPLATE_ID,
  ) as MutableGroupSpawn[];
}

function setSpawn(group: MutableGroupSpawn, cell: GridCoord): void {
  group.spawn = { ...cell };
  group.evacuation = { ...cell };
}

function mutableSetup(setup: BattleSetup): MutableBattleSetup {
  return setup as MutableBattleSetup;
}

function mutableGroup(group: GroupSpawn): MutableGroupSpawn {
  return group as MutableGroupSpawn;
}
