import { describe, expect, it } from "vitest";
import { createDemoScenarioOptions } from "../demo/scenarios";
import { createDemoBattleSetup } from "../demo/setup";
import {
  BATTLE_CONTENT_VERSION,
  BATTLE_RULES_VERSION,
  BATTLE_SETUP_SCHEMA_VERSION,
  DEFAULT_AIR_RECON_PLATFORM_TEMPLATE_ID,
  DEFAULT_WEAPON_TEMPLATE_ID,
  PRE_AIR_BATTLE_RULES_VERSION,
  PRE_AIR_BATTLE_SETUP_SCHEMA_VERSION,
  PRE_ALTITUDE_BATTLE_RULES_VERSION,
  altitudeBandModifiers,
  altitudeTransitionTicks,
  airspaceOccupantsConflict,
  cloneBattleContent,
  createSimulation,
  flightHeightUnits,
  flightStepHasTerrainClearance,
  flightTransitionClearanceMm,
  hasLineOfSight,
  migrateBattleSetup,
  scoreFlightAltitudeCandidates,
  validateBattleContent,
  validateBattleSetup,
} from "./index";
import type {
  BattleSetup,
  BattleSetupInput,
  GridCoord,
  GroupInspection,
  GroupSpawn,
  FlightAltitudeEvaluationInspection,
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

    expect(inspection.flight).toEqual({
      state: "airborne",
      altitudeBand: "low",
      clearanceMm: 12_000,
    });
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
    )?.finalFlight).toEqual({
      state: "airborne",
      altitudeBand: "low",
      clearanceMm: 12_000,
    });
    const frozenHash = first.getStateHash();
    first.step(20);
    expect(first.getStateHash()).toBe(frozenHash);
  });
});

describe("AIR-002 altitude rules", () => {
  it("migrates fixed-altitude stage-4 rules without changing the setup schema", () => {
    const current = createAirSetup("air-altitude-migration", 1);
    const migrated = migrateBattleSetup({
      ...current,
      rulesVersion: PRE_ALTITUDE_BATTLE_RULES_VERSION,
    });

    expect(migrated.schemaVersion).toBe(BATTLE_SETUP_SCHEMA_VERSION);
    expect(migrated.rulesVersion).toBe(BATTLE_RULES_VERSION);
    expect(() => validateBattleSetup(migrated)).not.toThrow();
  });

  it("uses integer band timing and exact transition clearance", () => {
    expect(altitudeTransitionTicks("low", "medium")).toBe(20);
    expect(altitudeTransitionTicks("low", "high")).toBe(40);
    expect(flightTransitionClearanceMm(12_000, 40_000, 20, 20)).toBe(12_000);
    expect(flightTransitionClearanceMm(12_000, 40_000, 20, 10)).toBe(26_000);
    expect(flightTransitionClearanceMm(12_000, 40_000, 20, 0)).toBe(40_000);
    expect(flightTransitionClearanceMm(40_000, 12_000, 20, 10)).toBe(26_000);
    expect(flightTransitionClearanceMm(12_000, 40_000, 20, 19, 500)).toBe(13_500);
  });

  it("requires terrain clearance for low flight steps", () => {
    const setup = createAirSetup("air-terrain-clearance", 1);
    const from = { x: 8, z: 8 };
    const to = { x: 9, z: 8 };

    setup.map.layers.heightUnits[from.z * setup.map.width + from.x] = 0;
    setup.map.layers.heightUnits[to.z * setup.map.width + to.x] = 0;
    expect(flightStepHasTerrainClearance(setup.map, from, to, 12_000)).toBe(true);
    setup.map.layers.heightUnits[to.z * setup.map.width + to.x] = 21;
    expect(flightStepHasTerrainClearance(setup.map, from, to, 12_000)).toBe(false);
    expect(flightStepHasTerrainClearance(setup.map, from, to, 40_000)).toBe(true);
  });

  it("balances visible task cells, exposure, transition cost, and hysteresis", () => {
    const candidates = [
      {
        altitudeBand: "low" as const,
        clearanceMm: 12_000,
        visibleInterestCount: 0,
        routeClear: false,
      },
      {
        altitudeBand: "medium" as const,
        clearanceMm: 40_000,
        visibleInterestCount: 1,
        routeClear: true,
      },
      {
        altitudeBand: "high" as const,
        clearanceMm: 80_000,
        visibleInterestCount: 1,
        routeClear: true,
      },
    ];
    const scored = scoreFlightAltitudeCandidates("low", candidates);

    expect(scored[0]?.altitudeBand).toBe("medium");
    expect(scored.at(-1)).toMatchObject({
      altitudeBand: "low",
      rejectionReason: "terrain-clearance",
    });
    expect(altitudeBandModifiers("high")).toMatchObject({
      sensorRangeBps: 11_000,
      exposureBps: 2_400,
    });

    const noTask = scoreFlightAltitudeCandidates(
      "medium",
      candidates.map((candidate) => ({
        ...candidate,
        visibleInterestCount: 0,
        routeClear: true,
      })),
    );
    expect(noTask[0]?.altitudeBand).toBe("low");
  });

  it("starts, advances, and completes an authoritative terrain-clearance climb", () => {
    const setup = createAirSetup("air-altitude-action", 1);
    const spawn = airGroups(setup).find((group) => group.factionId === "ember")!;
    const from = { x: 8, z: 8 };
    const blockedStep = { x: 9, z: 8 };
    setSpawn(spawn, from);
    setup.map.layers.heightUnits[from.z * setup.map.width + from.x] = 0;
    setup.map.layers.heightUnits[blockedStep.z * setup.map.width + blockedStep.x] = 21;
    const simulation = createSimulation(setup);
    const internals = altitudeInternals(simulation);
    const group = internals.state.groupsById.get(spawn.id)!;
    group.goal = { ...blockedStep };
    group.path = [{ ...blockedStep }];

    internals.evaluateFlightAltitude(group);
    internals.updateFlightAltitudeActions();

    expect(simulation.inspect(spawn.platforms[0]!.id)).toMatchObject({
      flight: { altitudeBand: "low", clearanceMm: 12_000 },
      flightControl: {
        action: "climbing",
        targetAltitudeBand: "medium",
        ticksRemaining: 20,
        evaluation: { reason: "terrain-clearance", selectedAltitudeBand: "medium" },
      },
    });

    for (let tick = 0; tick < 10; tick += 1) {
      internals.updateFlightAltitudeActions();
    }
    expect(simulation.inspect(spawn.platforms[0]!.id)).toMatchObject({
      flight: { altitudeBand: "low", clearanceMm: 26_000 },
      flightControl: { action: "climbing", ticksRemaining: 10 },
    });

    for (let tick = 0; tick < 10; tick += 1) {
      internals.updateFlightAltitudeActions();
    }
    expect(simulation.inspect(spawn.platforms[0]!.id)).toMatchObject({
      flight: { altitudeBand: "medium", clearanceMm: 40_000 },
      flightControl: { action: "holding", ticksRemaining: 0 },
    });
  });

  it("interrupts a climb when lift capability is lost", () => {
    const setup = createAirSetup("air-altitude-interruption", 1);
    const spawn = airGroups(setup).find((group) => group.factionId === "ember")!;
    const simulation = createSimulation(setup);
    const internals = altitudeInternals(simulation);
    const group = internals.state.groupsById.get(spawn.id)!;
    const platform = group.platforms[0]!;
    platform.flight!.evaluation = altitudeEvaluation("medium");
    internals.updateFlightAltitudeActions();
    const lift = platform.components.find((component) => component.id === "lift")!;
    lift.integrityBps = 0;
    lift.state = "destroyed";

    internals.updateFlightAltitudeActions();

    expect(simulation.inspect(platform.id)).toMatchObject({
      flight: { altitudeBand: "low", clearanceMm: 12_000 },
      flightControl: {
        action: "holding",
        ticksRemaining: 0,
        evaluation: { reason: "capability-unavailable" },
      },
    });
  });

  it("hashes every altitude action tick deterministically", () => {
    const setup = createAirSetup("air-altitude-action-hash", 1);
    const spawn = airGroups(setup).find((group) => group.factionId === "ember")!;
    const simulations = [createSimulation(setup), createSimulation(setup)];
    const internals = simulations.map(altitudeInternals);
    for (const runtime of internals) {
      const platform = runtime.state.groupsById.get(spawn.id)!.platforms[0]!;
      platform.flight!.evaluation = altitudeEvaluation("medium");
      runtime.updateFlightAltitudeActions();
    }

    for (let tick = 0; tick <= 20; tick += 1) {
      expect(simulations[1]!.getStateHash(), `altitude hash at action tick ${tick}`).toBe(
        simulations[0]!.getStateHash(),
      );
      internals.forEach((runtime) => runtime.updateFlightAltitudeActions());
    }
  });

  it("applies altitude bands to sensor range and target exposure", () => {
    const rangeSetup = createAirSetup("air-altitude-sensor-range", 1);
    const rangeSpawn = airGroups(rangeSetup).find((group) => group.factionId === "ember")!;
    const rangeSimulation = createSimulation(rangeSetup);
    const rangeInternals = altitudeInternals(rangeSimulation);
    const rangeGroup = rangeInternals.state.groupsById.get(rangeSpawn.id)!;
    const rangeFlight = rangeGroup.platforms[0]!.flight!;
    const ranges = (["low", "medium", "high"] as const).map((band) => {
      rangeFlight.altitudeBand = band;
      rangeFlight.clearanceMm = band === "low" ? 12_000 : band === "medium" ? 40_000 : 80_000;
      return rangeInternals.groupSightRangeCells(rangeGroup);
    });
    expect(ranges).toEqual([11, 13, 14]);

    const acquisitionGain = (band: "low" | "high") => {
      const setup = createAirSetup(`air-altitude-exposure-${band}`, 1);
      const simulation = createSimulation(setup);
      const internals = altitudeInternals(simulation);
      const observer = [...internals.state.groupsById.values()].find(
        (group) => group.factionId === "ember" && group.platforms.length === 0,
      )!;
      const target = [...internals.state.groupsById.values()].find(
        (group) => group.factionId === "azure" && group.platforms[0]?.flight,
      )!;
      observer.cell = { x: 8, z: 8 };
      target.cell = { x: 9, z: 8 };
      target.platforms[0]!.flight!.altitudeBand = band;
      target.platforms[0]!.flight!.clearanceMm = band === "low" ? 12_000 : 80_000;
      internals.updateSensing();
      return observer.localDetections.get(target.id)!.progressBps;
    };

    expect(acquisitionGain("high")).toBeGreaterThan(acquisitionGain("low"));
  });

  it("resolves simultaneous target-band capacity by stable platform ID", () => {
    const setup = createAirSetup("air-altitude-capacity", 2);
    const [firstSpawn, secondSpawn] = airGroups(setup).filter(
      (group) => group.factionId === "ember",
    );
    setSpawn(firstSpawn!, { x: 10, z: 10 });
    setSpawn(secondSpawn!, { x: 10, z: 10 });
    secondSpawn!.platforms[0] = {
      ...secondSpawn!.platforms[0]!,
      initialAltitudeBand: "high",
    };
    const simulation = createSimulation(setup);
    const internals = altitudeInternals(simulation);
    const first = internals.state.groupsById.get(firstSpawn!.id)!.platforms[0]!;
    const second = internals.state.groupsById.get(secondSpawn!.id)!.platforms[0]!;
    first.flight!.evaluation = altitudeEvaluation("medium");
    second.flight!.evaluation = altitudeEvaluation("medium");

    internals.updateFlightAltitudeActions();

    const winner = [first, second].sort((a, b) => a.id.localeCompare(b.id))[0]!;
    const blocked = winner === first ? second : first;
    expect(simulation.inspect(winner.id)).toMatchObject({
      flightControl: { targetAltitudeBand: "medium" },
    });
    expect(simulation.inspect(blocked.id)).toMatchObject({
      flightControl: {
        action: "holding",
        evaluation: { reason: "target-band-occupied" },
      },
    });
  });

  it("does not read hidden hostile weapon truth when selecting altitude", () => {
    const setups = [
      createAirSetup("air-hidden-air-defense", 1),
      createAirSetup("air-hidden-air-defense", 1),
    ];
    const selections = setups.map((setup, index) => {
      const spawn = airGroups(setup).find((group) => group.factionId === "ember")!;
      const simulation = createSimulation(setup);
      const internals = altitudeInternals(simulation);
      const ownGroup = internals.state.groupsById.get(spawn.id)!;
      ownGroup.goal = { x: ownGroup.cell.x + 4, z: ownGroup.cell.z };
      if (index === 1) {
        const hiddenHostile = [...internals.state.groupsById.values()].find(
          (group) => group.factionId === "azure" && group.platforms.length > 0,
        )!;
        hiddenHostile.platforms[0]!.weaponStates.push({
          componentId: "hidden-air-defense",
          weaponTemplateId: DEFAULT_WEAPON_TEMPLATE_ID,
          magazineRounds: 1,
          reloadTicksRemaining: 0,
          shotCooldownTicks: 0,
        });
      }
      internals.evaluateFlightAltitude(ownGroup);
      return ownGroup.platforms[0]!.flight!.evaluation;
    });

    expect(selections[0]).toEqual(selections[1]);
  });

  it("replays altitude decisions through a long defense scenario", () => {
    const setup = createAirSetup("air-altitude-defense", 1);
    const objective = {
      id: "air-defense-objective",
      center: { x: 16, z: 12 },
      radiusCells: 2,
    };
    mutableSetup(setup).mode = {
      kind: "defense",
      attackerFactionId: "ember",
      defenderFactionId: "azure",
      objective,
      objectives: [objective],
      objectiveRule: "all",
    };
    const first = createSimulation(setup);
    const second = createSimulation(setup);

    for (let tick = 0; tick < 240 && first.status === "active"; tick += 1) {
      first.step();
      second.step();
      expect(second.getStateHash(), `defense altitude hash at tick ${tick + 1}`).toBe(
        first.getStateHash(),
      );
    }

    const platformId = airGroups(setup).find((group) => group.factionId === "ember")!
      .platforms[0]!.id;
    expect(first.inspect(platformId)).toMatchObject({
      flightControl: { evaluation: { selectedAltitudeBand: expect.any(String) } },
    });
  });
});

interface AltitudeTestComponent {
  readonly id: string;
  integrityBps: number;
  state: "operational" | "damaged" | "disabled" | "destroyed";
}

interface AltitudeTestFlight {
  altitudeBand: "low" | "medium" | "high";
  clearanceMm: number;
  evaluation?: FlightAltitudeEvaluationInspection;
}

interface AltitudeTestPlatform {
  readonly id: string;
  readonly factionId: string;
  readonly flight?: AltitudeTestFlight;
  readonly components: AltitudeTestComponent[];
  readonly weaponStates: Array<{
    readonly componentId: string;
    readonly weaponTemplateId: string;
    magazineRounds: number;
    reloadTicksRemaining: number;
    shotCooldownTicks: number;
  }>;
}

interface AltitudeTestGroup {
  readonly id: string;
  readonly factionId: string;
  cell: GridCoord;
  goal?: GridCoord;
  path: GridCoord[];
  readonly platforms: AltitudeTestPlatform[];
  readonly localDetections: Map<string, { progressBps: number }>;
}

interface AltitudeTestInternals {
  readonly state: { readonly groupsById: Map<string, AltitudeTestGroup> };
  evaluateFlightAltitude(group: AltitudeTestGroup): void;
  groupSightRangeCells(group: AltitudeTestGroup): number;
  updateSensing(): void;
  updateFlightAltitudeActions(): void;
}

function altitudeInternals(simulation: ReturnType<typeof createSimulation>): AltitudeTestInternals {
  return simulation as unknown as AltitudeTestInternals;
}

function altitudeEvaluation(
  selectedAltitudeBand: "low" | "medium" | "high",
): FlightAltitudeEvaluationInspection {
  return {
    evaluatedAt: 0,
    reason: "improve-observation",
    selectedAltitudeBand,
    candidates: [],
  };
}

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
