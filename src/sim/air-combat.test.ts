import { describe, expect, it } from "vitest";
import { createDemoBattleSetup } from "../demo/setup";
import {
  DEFAULT_AIR_DEFENSE_WEAPON_TEMPLATE_ID,
  DEFAULT_AIR_RECON_PLATFORM_TEMPLATE_ID,
  DEFAULT_AIR_TO_AIR_WEAPON_TEMPLATE_ID,
  DEFAULT_AIR_TO_GROUND_WEAPON_TEMPLATE_ID,
  DEFAULT_MEMBER_TEMPLATE_ID,
  PRE_AIR_COMBAT_BATTLE_CONTENT_VERSION,
  PRE_AIR_COMBAT_BATTLE_RULES_VERSION,
  cellIndex,
  cloneBattleContent,
  createDefaultBattleContent,
  createSimulation,
  migrateBattleSetup,
  spatialDistanceSquaredMm,
  validateBattleSetup,
} from "./index";
import { weaponTargetEffectivenessBps } from "./targeting";
import type {
  AirAltitudeBand,
  BattleEvent,
  BattleSetup,
  BattleSetupInput,
  GridCoord,
  GroupAction,
  GroupInspection,
  GroupSpawn,
  MemberInspection,
  PlatformComponentState,
  PlatformFlightInspection,
  PlatformInspection,
  PlatformSpawn,
  TargetProfile,
  WeaponTargetDomain,
} from "./types";

type Mutable<T> = { -readonly [Key in keyof T]: T[Key] };
type MutableGroupSpawn = Mutable<GroupSpawn> & { platforms: Mutable<PlatformSpawn>[] };
type MutableBattleSetup = Omit<Mutable<BattleSetup>, "groups"> & {
  groups: MutableGroupSpawn[];
};

interface AirCombatRuntimeComponent {
  readonly id: string;
  integrityBps: number;
  state: PlatformComponentState;
}

interface AirCombatRuntimeFlight {
  state: "airborne" | "forced-landed" | "crashed";
  altitudeBand: AirAltitudeBand;
  clearanceMm: number;
  readonly evaluation?: {
    readonly selectedAltitudeBand: AirAltitudeBand;
    readonly candidates: readonly {
      readonly altitudeBand: AirAltitudeBand;
      readonly components: { readonly attack: number };
    }[];
  };
}

interface AirCombatRuntimePlatform {
  readonly id: string;
  readonly components: AirCombatRuntimeComponent[];
  readonly flight?: AirCombatRuntimeFlight;
}

interface AirCombatContact {
  readonly targetGroupId: string;
  readonly targetFactionId: string;
  readonly targetProfile: TargetProfile;
  readonly targetDomain: WeaponTargetDomain;
  readonly targetFlight?: PlatformFlightInspection;
  readonly lastKnown: GridCoord;
  readonly observedAt: number;
  readonly deliveredAt: number;
  readonly lastDirectTick: number;
  readonly confidenceBps: number;
  readonly sourceGroupId: string;
  readonly intelSource: "local-direct";
}

interface AirCombatRuntimeGroup {
  readonly id: string;
  readonly factionId: string;
  cell: GridCoord;
  action: GroupAction;
  currentTargetId?: string;
  readonly platforms: AirCombatRuntimePlatform[];
  readonly localContacts: Map<string, AirCombatContact>;
}

interface AirCombatInternals {
  readonly state: {
    readonly tick: number;
    readonly groups: readonly AirCombatRuntimeGroup[];
    readonly groupsById: Map<string, AirCombatRuntimeGroup>;
    readonly occupancy: Map<number, string>;
    readonly staticPlatformOccupancy: Map<number, string>;
  };
  updateWeapons(): void;
  evaluateFlightAltitude(group: AirCombatRuntimeGroup): void;
}

describe("AIR-003 air weapon rules", () => {
  it("migrates stage-4.1/content-4 inputs to the air-combat rule set", () => {
    const current = createAirCombatSetup("air-combat-migration");
    const migrated = migrateBattleSetup({
      ...current,
      rulesVersion: PRE_AIR_COMBAT_BATTLE_RULES_VERSION,
      content: {
        ...current.content,
        contentVersion: PRE_AIR_COMBAT_BATTLE_CONTENT_VERSION,
      },
    } satisfies BattleSetupInput);

    expect(migrated.rulesVersion).not.toBe(PRE_AIR_COMBAT_BATTLE_RULES_VERSION);
    expect(migrated.content.contentVersion).not.toBe(
      PRE_AIR_COMBAT_BATTLE_CONTENT_VERSION,
    );
    expect(() => validateBattleSetup(migrated)).not.toThrow();
  });

  it("provides explicit air-to-ground, air-to-air, and air-defense effects", () => {
    const content = createDefaultBattleContent();
    const airToGround = content.weaponTemplates[DEFAULT_AIR_TO_GROUND_WEAPON_TEMPLATE_ID]!;
    const airToAir = content.weaponTemplates[DEFAULT_AIR_TO_AIR_WEAPON_TEMPLATE_ID]!;
    const airDefense = content.weaponTemplates[DEFAULT_AIR_DEFENSE_WEAPON_TEMPLATE_ID]!;

    expect(weaponTargetEffectivenessBps(airToGround, "personnel", "ground"))
      .toBeGreaterThan(0);
    expect(weaponTargetEffectivenessBps(airToGround, "platform", "ground"))
      .toBeGreaterThan(0);
    expect(weaponTargetEffectivenessBps(airToGround, "platform", "air")).toBe(0);
    expect(weaponTargetEffectivenessBps(airToAir, "platform", "air")).toBeGreaterThan(0);
    expect(weaponTargetEffectivenessBps(airToAir, "personnel", "ground")).toBe(0);
    expect(weaponTargetEffectivenessBps(airDefense, "platform", "air")).toBeGreaterThan(0);
    expect(weaponTargetEffectivenessBps(airDefense, "platform", "ground")).toBe(0);
  });

  it("uses exact three-dimensional distance for altitude-dependent direct fire", () => {
    const low = createAirDefenseEngagement("air-defense-low", "low");
    const high = createAirDefenseEngagement("air-defense-high", "high");
    const lowAir = findGroup(low, "azure", true);
    const highAir = findGroup(high, "azure", true);
    const lowGround = findGroup(low, "ember", false);
    const highGround = findGroup(high, "ember", false);

    expect(
      spatialDistanceSquaredMm(
        low.map,
        lowGround.spawn,
        lowAir.spawn,
        undefined,
        { state: "airborne", altitudeBand: "low", clearanceMm: 12_000 },
      ),
    ).toBe(12_000 ** 2);
    expect(
      spatialDistanceSquaredMm(
        high.map,
        highGround.spawn,
        highAir.spawn,
        undefined,
        { state: "airborne", altitudeBand: "high", clearanceMm: 80_000 },
      ),
    ).toBe(80_000 ** 2);

    expect(fireDirectOnce(low, lowGround.id, lowAir.id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "weapon-fired",
          groupId: lowGround.id,
          targetGroupId: lowAir.id,
        }),
      ]),
    );
    expect(
      fireDirectOnce(high, highGround.id, highAir.id).some(
        (event) => event.type === "weapon-fired" && event.groupId === highGround.id,
      ),
    ).toBe(false);
  });

  it("never fires across a mismatched target domain and supports both air attack domains", () => {
    const mismatch = createAirCombatSetup("air-domain-mismatch");
    const mismatchGround = findGroup(mismatch, "ember", false);
    const mismatchAir = findGroup(mismatch, "azure", true);
    setSpawn(mismatchAir, mismatchGround.spawn);
    expect(
      fireDirectOnce(mismatch, mismatchGround.id, mismatchAir.id).some(
        (event) => event.type === "weapon-fired" && event.groupId === mismatchGround.id,
      ),
    ).toBe(false);

    const airToGround = mountAirWeapon(
      createAirCombatSetup("air-to-ground-fire"),
      DEFAULT_AIR_TO_GROUND_WEAPON_TEMPLATE_ID,
    );
    const airShooter = findGroup(airToGround, "ember", true);
    const groundTarget = findGroup(airToGround, "azure", false);
    setSpawn(groundTarget, airShooter.spawn);
    expect(fireDirectOnce(airToGround, airShooter.id, groundTarget.id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "weapon-fired",
          groupId: airShooter.id,
          targetGroupId: groundTarget.id,
        }),
      ]),
    );

    const airToAir = mountAirWeapon(
      createAirCombatSetup("air-to-air-fire"),
      DEFAULT_AIR_TO_AIR_WEAPON_TEMPLATE_ID,
    );
    const firstAir = findGroup(airToAir, "ember", true);
    const secondAir = findGroup(airToAir, "azure", true);
    setSpawn(firstAir, { x: 4, z: 10 });
    setSpawn(secondAir, { x: 24, z: 10 });
    expect(fireDirectOnce(airToAir, firstAir.id, secondAir.id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "weapon-fired",
          groupId: firstAir.id,
          targetGroupId: secondAir.id,
        }),
      ]),
    );
  });

  it("scores attack opportunities from legal contact snapshots without hidden target truth", () => {
    const setup = mountAirWeapon(
      createAirCombatSetup("air-altitude-attack-utility"),
      DEFAULT_AIR_TO_GROUND_WEAPON_TEMPLATE_ID,
    );
    const shooterSpawn = findGroup(setup, "ember", true);
    const targetSpawn = findGroup(setup, "azure", false);
    setSpawn(targetSpawn, shooterSpawn.spawn);
    shooterSpawn.platforms[0] = {
      ...shooterSpawn.platforms[0]!,
      initialAltitudeBand: "high",
    };
    const simulation = createSimulation(setup);
    const internals = simulation as unknown as AirCombatInternals;
    neutralizeGroups(internals);
    const shooter = internals.state.groupsById.get(shooterSpawn.id)!;
    const target = internals.state.groupsById.get(targetSpawn.id)!;
    addDirectContact(internals, shooter, target, "personnel", "ground");

    internals.evaluateFlightAltitude(shooter);

    const candidates = shooter.platforms[0]!.flight!.evaluation!.candidates;
    expect(candidates.find((candidate) => candidate.altitudeBand === "low")?.components.attack)
      .toBeGreaterThan(0);
    expect(candidates.find((candidate) => candidate.altitudeBand === "high")?.components.attack)
      .toBe(0);
    expect(shooter.platforms[0]!.flight!.evaluation?.selectedAltitudeBand).toBe("low");

    const evaluationFromSnapshot = shooter.platforms[0]!.flight!.evaluation;
    target.cell = { x: target.cell.x + 8, z: target.cell.z };
    internals.evaluateFlightAltitude(shooter);
    expect(shooter.platforms[0]!.flight!.evaluation).toEqual(evaluationFromSnapshot);
  });
});

describe("AIR-003 forced landing and crash", () => {
  it.each([
    ["low", "forced-landed", "abandoned", "forced-landing"],
    ["medium", "crashed", "destroyed", "crash"],
    ["high", "crashed", "destroyed", "crash"],
  ] as const)(
    "resolves %s-band flight failure once with member and occupancy conservation",
    (band, flightState, disposition, outcome) => {
      const setups = [
        createAirCombatSetup(`air-recovery-${band}`),
        createAirCombatSetup(`air-recovery-${band}`),
      ];
      for (const setup of setups) {
        const spawn = findGroup(setup, "ember", true);
        spawn.platforms[0] = { ...spawn.platforms[0]!, initialAltitudeBand: band };
      }
      const simulations = setups.map((setup) => createSimulation(setup));
      for (const simulation of simulations) {
        const platform = runtimePlatform(simulation, findGroup(simulation.getSetup(), "ember", true));
        disableComponent(platform, "lift");
        disableComponent(platform, "powertrain");
        simulation.step();
      }

      expect(simulations[1]!.getStateHash()).toBe(simulations[0]!.getStateHash());
      const simulation = simulations[0]!;
      const setup = setups[0]!;
      const spawn = findGroup(setup, "ember", true);
      const platformId = spawn.platforms[0]!.id;
      const inspection = simulation.inspect(platformId, "ember") as PlatformInspection;
      const group = simulation.inspect(spawn.id, "ember") as GroupInspection;
      const events = simulation.drainEvents();

      expect(inspection).toMatchObject({
        disposition,
        flight: { state: flightState, clearanceMm: 0 },
        crewAssignments: [],
      });
      expect(
        events.filter(
          (event) => event.type === "platform-flight-resolved" && event.platformId === platformId,
        ),
      ).toEqual([
        expect.objectContaining({ outcome, groupId: spawn.id }),
      ]);
      for (const member of spawn.members) {
        expect(simulation.inspect(member.id, "ember")).toMatchObject({
          kind: "member",
          placement: { kind: "dismounted" },
        } satisfies Partial<MemberInspection>);
      }
      const internals = simulation as unknown as AirCombatInternals;
      const landedIndex = cellIndex(setup.map, group.cell);
      expect(internals.state.occupancy.get(landedIndex)).toBe(spawn.id);
      expect(internals.state.staticPlatformOccupancy.get(landedIndex)).toBe(platformId);

      simulation.step(500);
      const result = simulation.getResult();
      const memberIds = result?.members.map((member) => member.id) ?? [];
      expect(new Set(memberIds).size).toBe(memberIds.length);
      expect(spawn.members.every((member) => memberIds.includes(member.id))).toBe(true);
      expect(result?.platforms.find((platform) => platform.id === platformId)?.finalFlight)
        .toMatchObject({ state: flightState, clearanceMm: 0 });
    },
  );
});

function createAirCombatSetup(seed: string): BattleSetup {
  return createDemoBattleSetup({
    seed,
    width: 32,
    height: 24,
    groupsPerFaction: 2,
    airGroupsPerFaction: 1,
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

function createAirDefenseEngagement(
  seed: string,
  band: AirAltitudeBand,
): BattleSetup {
  const setup = createAirCombatSetup(seed);
  const content = cloneBattleContent(setup.content);
  const member = content.memberTemplates[DEFAULT_MEMBER_TEMPLATE_ID]!;
  mutableSetup(setup).content = {
    ...content,
    memberTemplates: {
      ...content.memberTemplates,
      [member.id]: {
        ...member,
        weaponSlotRules: member.weaponSlotRules.map((slot, index) =>
          index === 0
            ? { ...slot, weaponTemplateId: DEFAULT_AIR_DEFENSE_WEAPON_TEMPLATE_ID }
            : slot,
        ),
      },
    },
  };
  const ground = findGroup(setup, "ember", false);
  const air = findGroup(setup, "azure", true);
  setSpawn(air, ground.spawn);
  air.platforms[0] = { ...air.platforms[0]!, initialAltitudeBand: band };
  return setup;
}

function mountAirWeapon(setup: BattleSetup, weaponTemplateId: string): BattleSetup {
  const content = cloneBattleContent(setup.content);
  const platform = content.platformTemplates[DEFAULT_AIR_RECON_PLATFORM_TEMPLATE_ID]!;
  mutableSetup(setup).content = {
    ...content,
    platformTemplates: {
      ...content.platformTemplates,
      [platform.id]: {
        ...platform,
        componentRules: [
          ...platform.componentRules,
          {
            id: "air-weapon",
            kind: "weapon",
            hitWeight: 2,
            external: true,
            disabledAtBps: 2_500,
            requiredStationIds: ["observer"],
            weaponTemplateId,
          },
        ],
      },
    },
  };
  return setup;
}

function fireDirectOnce(
  setup: BattleSetup,
  shooterGroupId: string,
  targetGroupId: string,
): readonly BattleEvent[] {
  const simulation = createSimulation(setup);
  const internals = simulation as unknown as AirCombatInternals;
  neutralizeGroups(internals);
  const shooter = internals.state.groupsById.get(shooterGroupId)!;
  const target = internals.state.groupsById.get(targetGroupId)!;
  shooter.action = "engaging";
  shooter.currentTargetId = target.id;
  addDirectContact(
    internals,
    shooter,
    target,
    target.platforms.length > 0 ? "platform" : "personnel",
    target.platforms[0]?.flight?.state === "airborne" ? "air" : "ground",
  );
  internals.updateWeapons();
  return simulation.drainEvents();
}

function addDirectContact(
  internals: AirCombatInternals,
  shooter: AirCombatRuntimeGroup,
  target: AirCombatRuntimeGroup,
  targetProfile: TargetProfile,
  targetDomain: WeaponTargetDomain,
): void {
  const targetFlight = target.platforms[0]?.flight;
  shooter.localContacts.set(target.id, {
    targetGroupId: target.id,
    targetFactionId: target.factionId,
    targetProfile,
    targetDomain,
    targetFlight: targetFlight
      ? {
          state: targetFlight.state,
          altitudeBand: targetFlight.altitudeBand,
          clearanceMm: targetFlight.clearanceMm,
        }
      : undefined,
    lastKnown: { ...target.cell },
    observedAt: internals.state.tick,
    deliveredAt: internals.state.tick,
    lastDirectTick: internals.state.tick,
    confidenceBps: 10_000,
    sourceGroupId: shooter.id,
    intelSource: "local-direct",
  });
}

function neutralizeGroups(internals: AirCombatInternals): void {
  for (const group of internals.state.groups) {
    group.action = "searching";
    group.currentTargetId = undefined;
    group.localContacts.clear();
  }
}

function runtimePlatform(
  simulation: ReturnType<typeof createSimulation>,
  spawn: MutableGroupSpawn,
): AirCombatRuntimePlatform {
  const internals = simulation as unknown as AirCombatInternals;
  return internals.state.groupsById.get(spawn.id)!.platforms[0]!;
}

function disableComponent(platform: AirCombatRuntimePlatform, componentId: string): void {
  const component = platform.components.find((candidate) => candidate.id === componentId)!;
  component.integrityBps = 0;
  component.state = "destroyed";
}

function findGroup(
  setup: BattleSetup,
  factionId: string,
  air: boolean,
): MutableGroupSpawn {
  return mutableSetup(setup).groups.find(
    (group) =>
      group.factionId === factionId &&
      (group.platforms[0]?.platformTemplateId === DEFAULT_AIR_RECON_PLATFORM_TEMPLATE_ID) === air,
  )! as MutableGroupSpawn;
}

function setSpawn(group: MutableGroupSpawn, cell: GridCoord): void {
  group.spawn = { ...cell };
  group.evacuation = { ...cell };
}

function mutableSetup(setup: BattleSetup): MutableBattleSetup {
  return setup as MutableBattleSetup;
}
