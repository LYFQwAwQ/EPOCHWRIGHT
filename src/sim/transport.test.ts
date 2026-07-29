import { describe, expect, it } from "vitest";
import { createDemoBattleSetup } from "../demo/setup";
import {
  BATTLE_RULES_VERSION,
  DEFAULT_WHEELED_PLATFORM_TEMPLATE_ID,
  PRE_COMBINED_ARMS_BATTLE_RULES_VERSION,
  PRE_TRANSPORT_BATTLE_RULES_VERSION,
  createSimulation,
  migrateBattleSetup,
  validateBattleSetup,
} from "./index";
import type {
  BattleEvent,
  BattleSetup,
  GroupInspection,
  MemberInspection,
  PlatformInspection,
} from "./types";

const EMBER_PLATFORM_GROUP_ID = "ember-wheeled-1";
const EMBER_PLATFORM_ID = "ember-wheeled-1-platform";
const EMBER_PASSENGER_GROUP_ID = "ember-squad-2";
const AZURE_TARGET_GROUP_ID = "azure-tracked-1";

describe("explicit transport assignments", () => {
  it("migrates the stage-3.2 setup fields into transport-capable rules", () => {
    const setup = createTransportSetup();
    const migrated = migrateBattleSetup({
      ...setup,
      rulesVersion: PRE_TRANSPORT_BATTLE_RULES_VERSION,
    });

    expect(migrated.transportAssignments).toEqual(setup.transportAssignments);
    expect(migrated.groups).toEqual(setup.groups);
  });

  it("preserves stage-3.3 fields while upgrading combined-arms rules", () => {
    const setup = createTransportSetup();
    const migrated = migrateBattleSetup({
      ...setup,
      rulesVersion: PRE_COMBINED_ARMS_BATTLE_RULES_VERSION,
    });

    expect(migrated.rulesVersion).toBe(BATTLE_RULES_VERSION);
    expect(migrated.transportAssignments).toEqual(setup.transportAssignments);
    expect(migrated.groups).toEqual(setup.groups);
  });

  it("validates pairing and capacity before runtime", () => {
    const setup = createTransportSetup();
    expect(() => validateBattleSetup(setup)).not.toThrow();

    const crossFaction = {
      ...setup,
      transportAssignments: setup.transportAssignments.map((assignment, index) =>
        index === 0
          ? { ...assignment, passengerGroupId: "azure-squad-2" }
          : assignment,
      ),
    } satisfies BattleSetup;
    expect(() => validateBattleSetup(crossFaction)).toThrow(/same-faction/i);

    const platformTemplate = setup.content.platformTemplates[
      DEFAULT_WHEELED_PLATFORM_TEMPLATE_ID
    ]!;
    const overCapacity = {
      ...setup,
      content: {
        ...setup.content,
        platformTemplates: {
          ...setup.content.platformTemplates,
          [platformTemplate.id]: {
            ...platformTemplate,
            transportCapacityUnits: 7,
          },
        },
      },
    } satisfies BattleSetup;
    expect(() => validateBattleSetup(overCapacity)).toThrow(/capacity/i);
  });

  it("initializes an atomic passenger placement without ground occupancy or projection", () => {
    const simulation = createSimulation(createTransportSetup());
    const passenger = simulation.inspect(EMBER_PASSENGER_GROUP_ID) as GroupInspection;
    const platform = simulation.inspect(EMBER_PLATFORM_ID) as PlatformInspection;
    const member = simulation.inspect(
      `${EMBER_PASSENGER_GROUP_ID}-member-1`,
    ) as MemberInspection;
    const frame = simulation.getRenderFrame("ember");
    const internals = simulation as unknown as {
      readonly state: { readonly occupancy: ReadonlyMap<number, string> };
    };

    expect(passenger.transport).toMatchObject({
      platformId: EMBER_PLATFORM_ID,
      status: "embarked",
    });
    expect(platform.passengerGroupIds).toEqual([EMBER_PASSENGER_GROUP_ID]);
    expect(member.placement).toEqual({
      kind: "passenger",
      platformId: EMBER_PLATFORM_ID,
    });
    expect(
      frame.members.some((candidate) => candidate.groupId === EMBER_PASSENGER_GROUP_ID),
    ).toBe(false);
    expect([...internals.state.occupancy.values()]).not.toContain(
      EMBER_PASSENGER_GROUP_ID,
    );
  });

  it("deploys a same-wave initial transport pair through one entrance slot", () => {
    const source = createDemoBattleSetup({
      ...transportOptions("conflict"),
      groupsPerFaction: 3,
    });
    const pairedGroupIds = new Set([EMBER_PLATFORM_GROUP_ID, EMBER_PASSENGER_GROUP_ID]);
    const pairedGroups = source.groups.filter((group) => pairedGroupIds.has(group.id));
    const setup = {
      ...source,
      groups: source.groups.filter((group) => !pairedGroupIds.has(group.id)),
      reinforcementEntrances: [
        {
          id: "ember-transport-gate",
          factionId: "ember",
          cells: [{ x: 0, z: pairedGroups[0]!.spawn.z }],
          capacityPerTick: 1,
        },
      ],
      reinforcements: [
        {
          id: "ember-transport-wave",
          factionId: "ember",
          arrivalTick: 0,
          entranceIds: ["ember-transport-gate"],
          groups: pairedGroups,
          blockedPolicy: "wait" as const,
        },
      ],
    } satisfies BattleSetup;
    expect(() => validateBattleSetup(setup)).not.toThrow();

    const simulation = createSimulation(setup);
    simulation.step();

    expect(
      (simulation.inspect(EMBER_PASSENGER_GROUP_ID) as GroupInspection).transport,
    ).toMatchObject({ status: "embarked", platformId: EMBER_PLATFORM_ID });
    expect(
      (simulation.inspect(EMBER_PLATFORM_ID) as PlatformInspection).passengerGroupIds,
    ).toEqual([EMBER_PASSENGER_GROUP_ID]);
    expect(simulation.drainEvents()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "reinforcement-deployed",
          groupIds: [EMBER_PASSENGER_GROUP_ID, EMBER_PLATFORM_GROUP_ID].sort(),
        }),
      ]),
    );
  });

  it("uses a fresh local contact to hold the platform and atomically disembark", () => {
    const simulation = createSimulation(createTransportSetup());
    addDirectContact(simulation);

    simulation.step();
    expect(
      (simulation.inspect(EMBER_PASSENGER_GROUP_ID) as GroupInspection).transport,
    ).toMatchObject({ status: "disembarking", ticksRemaining: 16 });

    simulation.step(16);
    const passenger = simulation.inspect(EMBER_PASSENGER_GROUP_ID) as GroupInspection;
    const platform = simulation.inspect(EMBER_PLATFORM_ID) as PlatformInspection;
    const events = simulation.drainEvents().filter(
      (event): event is Extract<BattleEvent, { type: "embarkation-changed" }> =>
        event.type === "embarkation-changed" &&
        event.passengerGroupId === EMBER_PASSENGER_GROUP_ID,
    );

    expect(passenger.transport?.status).toBe("dismounted");
    expect(platform.passengerGroupIds).toEqual([]);
    expect(events.map((event) => `${event.action}:${event.phase}`)).toEqual([
      "disembark:started",
      "disembark:completed",
    ]);
    expect(
      simulation.getRenderFrame("ember").members.filter(
        (member) => member.groupId === EMBER_PASSENGER_GROUP_ID,
      ),
    ).toHaveLength(8);
  });

  it("selects a safer dismount cell from the observed threat snapshot", () => {
    const first = createSimulation(createTransportSetup());
    const second = createSimulation(createTransportSetup());
    const platform = first.inspect(EMBER_PLATFORM_ID) as PlatformInspection;
    const observedThreat = { x: platform.cell.x - 4, z: platform.cell.z - 4 };
    addDirectContact(first, observedThreat);
    addDirectContact(second, observedThreat);

    const firstInternals = first as unknown as {
      updateTransportAssignments(): void;
    };
    const secondInternals = second as unknown as {
      readonly state: {
        readonly groupsById: Map<string, { cell: { x: number; z: number } }>;
      };
      updateTransportAssignments(): void;
    };
    secondInternals.state.groupsById.get(AZURE_TARGET_GROUP_ID)!.cell = {
      x: platform.cell.x - 8,
      z: platform.cell.z + 6,
    };

    firstInternals.updateTransportAssignments();
    secondInternals.updateTransportAssignments();

    const firstTransport = (
      first.inspect(EMBER_PASSENGER_GROUP_ID) as GroupInspection
    ).transport;
    const secondTransport = (
      second.inspect(EMBER_PASSENGER_GROUP_ID) as GroupInspection
    ).transport;
    expect(firstTransport?.destination).toEqual(secondTransport?.destination);
    expect(firstTransport?.destination?.x).toBeGreaterThan(platform.cell.x);
    expect(firstTransport?.destination?.z).toBeGreaterThan(platform.cell.z);
    expect(firstTransport?.dismountEvaluation).toMatchObject({
      reason: "direct-contact",
      knownThreats: [
        {
          targetGroupId: AZURE_TARGET_GROUP_ID,
          lastKnown: observedThreat,
        },
      ],
    });
  });

  it("does not react to an unobserved enemy beside the transport", () => {
    const simulation = createSimulation(createTransportSetup());
    const platform = simulation.inspect(EMBER_PLATFORM_ID) as PlatformInspection;
    const internals = simulation as unknown as {
      readonly state: {
        readonly groupsById: Map<string, { cell: { x: number; z: number } }>;
      };
      updateTransportAssignments(): void;
    };
    internals.state.groupsById.get(AZURE_TARGET_GROUP_ID)!.cell = {
      x: platform.cell.x + 1,
      z: platform.cell.z,
    };

    internals.updateTransportAssignments();

    expect(
      (simulation.inspect(EMBER_PASSENGER_GROUP_ID) as GroupInspection).transport,
    ).toMatchObject({ status: "embarked" });
  });

  it("dismounts passengers when the platform becomes damaged", () => {
    const simulation = createSimulation(createTransportSetup());
    const internals = simulation as unknown as {
      readonly state: {
        readonly platformsById: Map<
          string,
          { readonly components: { integrityBps: number; state: string }[] }
        >;
      };
      updateTransportAssignments(): void;
    };
    const platform = internals.state.platformsById.get(EMBER_PLATFORM_ID)!;
    platform.components[0]!.integrityBps = 8_000;
    platform.components[0]!.state = "damaged";

    internals.updateTransportAssignments();

    expect(
      (simulation.inspect(EMBER_PASSENGER_GROUP_ID) as GroupInspection).transport,
    ).toMatchObject({
      status: "disembarking",
      dismountEvaluation: { reason: "platform-risk" },
    });
  });

  it("allows the same explicit pair to embark again after dismounting", () => {
    const simulation = createSimulation(createTransportSetup());
    addDirectContact(simulation);
    simulation.step(17);
    const internals = simulation as unknown as {
      readonly state: {
        readonly groupsById: Map<
          string,
          {
            movingTo?: { x: number; z: number };
            path: { x: number; z: number }[];
            readonly localContacts: Map<string, unknown>;
          }
        >;
        readonly transportByPassengerGroupId: Map<
          string,
          { lastTransitionTick: number }
        >;
      };
      updateTransportAssignments(): void;
    };
    const passenger = internals.state.groupsById.get(EMBER_PASSENGER_GROUP_ID)!;
    const platformGroup = internals.state.groupsById.get(EMBER_PLATFORM_GROUP_ID)!;
    passenger.movingTo = undefined;
    passenger.path = [];
    passenger.localContacts.clear();
    platformGroup.movingTo = undefined;
    platformGroup.path = [];
    platformGroup.localContacts.clear();
    internals.state.transportByPassengerGroupId.get(
      EMBER_PASSENGER_GROUP_ID,
    )!.lastTransitionTick = -100;

    for (let tick = 0; tick <= 20; tick += 1) {
      internals.updateTransportAssignments();
    }

    expect(
      (simulation.inspect(EMBER_PASSENGER_GROUP_ID) as GroupInspection).transport
        ?.status,
    ).toBe("embarked");
    expect(
      simulation.drainEvents().some(
        (event) =>
          event.type === "embarkation-changed" &&
          event.action === "embark" &&
          event.phase === "completed",
      ),
    ).toBe(true);
  });

  it("cancels an atomic disembark when its reserved destination becomes occupied", () => {
    const simulation = createSimulation(createTransportSetup());
    addDirectContact(simulation);
    simulation.step();
    const passenger = simulation.inspect(EMBER_PASSENGER_GROUP_ID) as GroupInspection;
    const destination = passenger.transport?.destination;
    expect(destination).toBeDefined();
    const internals = simulation as unknown as {
      readonly setup: BattleSetup;
      readonly state: { readonly occupancy: Map<number, string> };
    };
    internals.state.occupancy.set(
      destination!.z * internals.setup.map.width + destination!.x,
      "blocking-group",
    );

    simulation.step();

    expect(
      (simulation.inspect(EMBER_PASSENGER_GROUP_ID) as GroupInspection).transport
        ?.status,
    ).toBe("embarked");
    expect(
      simulation.drainEvents().some(
        (event) =>
          event.type === "embarkation-changed" &&
          event.phase === "cancelled" &&
          event.reason === "destination-blocked",
      ),
    ).toBe(true);
  });

  it("settles passenger damage once and retries a trapped forced dismount", () => {
    const simulation = createSimulation(createTransportSetup());
    const internals = simulation as unknown as {
      readonly setup: BattleSetup;
      readonly state: {
        readonly occupancy: Map<number, string>;
        readonly platformsById: Map<
          string,
          {
            readonly cell: { readonly x: number; readonly z: number };
            readonly components: {
              readonly id: string;
              integrityBps: number;
              state: string;
            }[];
          }
        >;
      };
      refreshPlatformState(platform: unknown, emitEvent: boolean): void;
    };
    const platform = internals.state.platformsById.get(EMBER_PLATFORM_ID)!;
    for (let dz = -1; dz <= 1; dz += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        if (dx === 0 && dz === 0) continue;
        const x = platform.cell.x + dx;
        const z = platform.cell.z + dz;
        internals.state.occupancy.set(
          z * internals.setup.map.width + x,
          `blocker:${dx}:${dz}`,
        );
      }
    }
    const structure = platform.components.find((component) => component.id === "structure")!;
    structure.integrityBps = 0;
    structure.state = "destroyed";
    internals.refreshPlatformState(platform, true);

    simulation.step();
    const trapped = simulation.inspect(EMBER_PASSENGER_GROUP_ID) as GroupInspection;
    const healthEvents = simulation.drainEvents().filter(
      (event) =>
        event.type === "member-health-changed" &&
        event.groupId === EMBER_PASSENGER_GROUP_ID,
    );
    expect(trapped.transport?.status).toBe("trapped");
    expect(healthEvents).toHaveLength(8);

    const openX = platform.cell.x - 1;
    const openZ = platform.cell.z - 1;
    internals.state.occupancy.delete(
      openZ * internals.setup.map.width + openX,
    );
    simulation.step();
    const dismounted = simulation.inspect(EMBER_PASSENGER_GROUP_ID) as GroupInspection;
    expect(dismounted.transport?.status).toBe("dismounted");
    expect(dismounted.cell).toEqual({ x: openX, z: openZ });
    expect(
      simulation.drainEvents().filter(
        (event) =>
          event.type === "member-health-changed" &&
          event.groupId === EMBER_PASSENGER_GROUP_ID,
      ),
    ).toHaveLength(0);

    simulation.step(500);
    const result = simulation.getResult()!;
    expect(
      result.members.filter((member) => member.groupId === EMBER_PASSENGER_GROUP_ID),
    ).toHaveLength(8);
    expect(
      result.platforms.find((candidate) => candidate.id === EMBER_PLATFORM_ID)
        ?.finalPassengerGroupIds,
    ).toEqual([]);
  });

  it("keeps onboard passengers out of objective power and replays tick hashes", () => {
    const setup = createTransportSetup("defense");
    const first = createSimulation(setup);
    const second = createSimulation(setup);

    for (let tick = 0; tick < 30; tick += 1) {
      first.step();
      second.step();
      expect(first.getStateHash()).toBe(second.getStateHash());
    }
    const objective = first.getRenderFrame().objectives[0]!;
    const passenger = first.inspect(EMBER_PASSENGER_GROUP_ID) as GroupInspection;
    expect(passenger.transport?.status).toBe("embarked");
    expect(objective.attackerPower).toBe(0);
  });
});

function createTransportSetup(mode: "conflict" | "defense" = "conflict"): BattleSetup {
  return createDemoBattleSetup(transportOptions(mode));
}

function transportOptions(mode: "conflict" | "defense") {
  return {
    seed: `transport-${mode}`,
    width: 36,
    height: 24,
    groupsPerFaction: 2,
    vehicleGroupsPerFaction: 1,
    transportPairsPerFaction: 1,
    mountainDensity: 0,
    roughness: 0,
    waterCoverage: 0,
    wetlandCoverage: 0,
    treeCoverage: 0,
    rockCoverage: 0,
    wallCoverage: 0,
    maximumDurationSeconds: 20,
    stalemateSeconds: 15,
    mode,
  } as const;
}

function addDirectContact(
  simulation: ReturnType<typeof createSimulation>,
  lastKnown = { x: 30, z: 8 },
): void {
  const internals = simulation as unknown as {
    readonly state: {
      readonly tick: number;
      readonly groupsById: Map<
        string,
        {
          readonly localContacts: Map<string, unknown>;
        }
      >;
    };
  };
  internals.state.groupsById.get(EMBER_PLATFORM_GROUP_ID)!.localContacts.set(
    AZURE_TARGET_GROUP_ID,
    {
      targetGroupId: AZURE_TARGET_GROUP_ID,
      targetFactionId: "azure",
      targetProfile: "platform",
      lastKnown,
      observedAt: internals.state.tick,
      lastDirectTick: internals.state.tick,
      confidenceBps: 10_000,
      sourceGroupId: EMBER_PLATFORM_GROUP_ID,
    },
  );
}
