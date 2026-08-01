import { describe, expect, it } from "vitest";
import type { BattleEvent, RenderFrame, RenderGroup } from "../sim/types";
import {
  advanceDirector,
  buildDirectorHotspots,
  createDirectorState,
  type DirectorConfig,
} from "./director";

function group(
  id: string,
  worldX: number,
  worldZ: number,
  action: RenderGroup["action"] = "engaging",
): RenderGroup {
  return {
    id,
    factionId: id.split("-")[0] ?? "faction",
    worldX,
    worldY: 2,
    worldZ,
    headingRadians: 0,
    action,
    moraleBps: 8_000,
    suppressionBps: 1_000,
    activeMembers: 8,
  };
}

function frame(
  tick: number,
  groups: readonly RenderGroup[],
  objectives: RenderFrame["objectives"] = [],
): RenderFrame {
  return {
    tick,
    phase: "running",
    groups,
    members: [],
    platforms: [],
    projectiles: [],
    objectives,
  };
}

const FAST_CONFIG: Partial<DirectorConfig> = {
  regionSizeMeters: 10,
  recentEventTicks: 50,
  minimumDwellTicks: 10,
  switchCooldownTicks: 6,
  minimumSwitchDistanceMeters: 12,
  switchScoreMargin: 20,
};

describe("observer camera director", () => {
  it("aggregates nearby combat and objective activity into stable regions", () => {
    const currentFrame = frame(
      40,
      [group("ember-1", 20, 20), group("azure-1", 24, 22)],
      [
        {
          id: "objective-alpha",
          worldX: 22,
          worldY: 1,
          worldZ: 20,
          radiusMeters: 12,
          state: "contested",
          progressBps: 4_000,
          attackerPower: 8,
          defenderPower: 7,
          attackerFactionId: "ember",
          defenderFactionId: "azure",
        },
      ],
    );
    const events: BattleEvent[] = [
      {
        type: "weapon-fired",
        tick: 39,
        sequence: 2,
        groupId: "ember-1",
        targetGroupId: "azure-1",
        shotCount: 8,
      },
      {
        type: "member-health-changed",
        tick: 39,
        sequence: 3,
        memberId: "azure-member-1",
        groupId: "azure-1",
        from: "wounded",
        to: "dead",
      },
    ];

    const hotspots = buildDirectorHotspots(currentFrame, events, 4, {
      regionSizeMeters: 28,
    });
    const reversed = buildDirectorHotspots(
      { ...currentFrame, groups: [...currentFrame.groups].reverse() },
      [...events].reverse(),
      4,
      { regionSizeMeters: 28 },
    );

    expect(hotspots).toEqual(reversed);
    expect(hotspots).toHaveLength(1);
    expect(hotspots[0]?.reason).toBe("objective");
    expect(hotspots[0]?.score).toBeGreaterThan(1_800);
    expect(hotspots[0]?.worldX).toBeGreaterThan(20);
    expect(hotspots[0]?.worldX).toBeLessThan(24);
  });

  it("honors dwell, cooldown, score margin, and switch distance", () => {
    const firstFrame = frame(0, [group("ember-a", 5, 5)]);
    let state = advanceDirector(
      createDirectorState(),
      { contextKey: "omniscient", frame: firstFrame, events: [], cellSizeMeters: 4 },
      FAST_CONFIG,
    );
    expect(state.hotspot?.worldX).toBe(5);

    const earlyChallenger = frame(5, [
      group("ember-a", 5, 5, "moving-to-contact"),
      group("azure-b", 45, 5),
      group("azure-c", 47, 6),
    ]);
    const dwellHeld = advanceDirector(
      state,
      { contextKey: "omniscient", frame: earlyChallenger, events: [], cellSizeMeters: 4 },
      { ...FAST_CONFIG, switchCooldownTicks: 0 },
    );
    expect(dwellHeld.hotspot?.worldX).toBe(5);

    const cooldownHeld = advanceDirector(
      state,
      {
        contextKey: "omniscient",
        frame: { ...earlyChallenger, tick: 7 },
        events: [],
        cellSizeMeters: 4,
      },
      { ...FAST_CONFIG, minimumDwellTicks: 0, switchCooldownTicks: 10 },
    );
    expect(cooldownHeld.hotspot?.worldX).toBe(5);

    const switched = advanceDirector(
      state,
      {
        contextKey: "omniscient",
        frame: { ...earlyChallenger, tick: 12 },
        events: [],
        cellSizeMeters: 4,
      },
      { ...FAST_CONFIG, minimumDwellTicks: 0, switchCooldownTicks: 10 },
    );
    expect(switched.hotspot?.worldX).toBeGreaterThan(45);

    const marginFrame = frame(24, [
      group("azure-b", 45, 5),
      group("azure-c", 47, 6),
      group("ember-d", 85, 5),
      { ...group("ember-e", 87, 6), suppressionBps: 2_100 },
    ]);
    const marginHeld = advanceDirector(
      switched,
      { contextKey: "omniscient", frame: marginFrame, events: [], cellSizeMeters: 4 },
      FAST_CONFIG,
    );
    expect(marginHeld.hotspot?.id).toBe(switched.hotspot?.id);

    const nearbyChallenger = frame(30, [
      group("azure-b", 47, 5, "moving-to-contact"),
      group("ember-d", 56, 5),
      group("ember-e", 57, 6),
    ]);
    const held = advanceDirector(
      marginHeld,
      { contextKey: "omniscient", frame: nearbyChallenger, events: [], cellSizeMeters: 4 },
      FAST_CONFIG,
    );
    expect(held.hotspot?.id).toBe(switched.hotspot?.id);
  });

  it("drops stale events and immediately resets across observation contexts", () => {
    const casualty: BattleEvent = {
      type: "member-health-changed",
      tick: 0,
      sequence: 1,
      memberId: "hidden-member",
      groupId: "hidden-group",
      from: "healthy",
      to: "dead",
    };
    const staleFrame = frame(60, [group("visible-group", 8, 8, "combat-ineffective")]);
    expect(
      buildDirectorHotspots(staleFrame, [casualty], 4, { recentEventTicks: 50 }),
    ).toEqual([]);

    const omniscientFrame = frame(20, [
      group("visible-group", 8, 8, "moving-to-contact"),
      group("hidden-group", 80, 8),
      group("hidden-support", 82, 9),
    ]);
    const omniscient = advanceDirector(
      createDirectorState(),
      {
        contextKey: "omniscient",
        frame: omniscientFrame,
        events: [],
        cellSizeMeters: 4,
      },
      FAST_CONFIG,
    );
    expect(omniscient.hotspot?.worldX).toBeGreaterThan(80);

    const factionFrame = frame(21, [group("visible-group", 8, 8, "moving-to-contact")]);
    const faction = advanceDirector(
      omniscient,
      {
        contextKey: "faction:ember",
        frame: factionFrame,
        events: [],
        cellSizeMeters: 4,
      },
      FAST_CONFIG,
    );
    expect(faction.hotspot?.worldX).toBe(8);
    expect(faction.contextKey).toBe("faction:ember");
    expect(faction.selectedAtTick).toBe(21);
  });
});
