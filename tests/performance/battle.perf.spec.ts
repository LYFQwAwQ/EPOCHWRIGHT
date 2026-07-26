import { expect, test, type Page } from "@playwright/test";
import {
  PERFORMANCE_PROFILES,
  type PerformanceProfile,
} from "../../src/performance/profiles";

interface HeapMemory {
  readonly usedJSHeapSize: number;
}

function selectedProfiles(): readonly PerformanceProfile[] {
  const selected = process.env.PERF_PROFILE;
  if (selected === "medium" || selected === "large") {
    return [selected];
  }
  return ["medium", "large"];
}

async function waitForPausedBattle(page: Page): Promise<void> {
  await page.waitForFunction(
    () => window.__battleTest?.getStatus() === "paused" && window.__battleTest.getBattleId(),
  );
  await expect(page.locator("canvas")).toBeVisible();
}

async function usedHeapBytes(page: Page): Promise<number> {
  await page.requestGC();
  return page.evaluate(() => {
    const memory = (performance as Performance & { memory?: HeapMemory }).memory;
    return memory?.usedJSHeapSize ?? 0;
  });
}

async function advanceWithRenderedFrames(page: Page, tickCount: number): Promise<void> {
  for (let expectedTick = 2; expectedTick <= tickCount; expectedTick += 2) {
    await page.evaluate(() => window.__battleTest?.step(2));
    await page.waitForFunction(
      (tick) => (window.__battleTest?.getTick() ?? -1) >= tick,
      expectedTick,
    );
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
  }
}

for (const profile of selectedProfiles()) {
  test(`${profile} fixed scenario reports browser and worker performance`, async ({
    browser,
    page,
  }) => {
    const definition = PERFORMANCE_PROFILES[profile];
    const seed = `perf-${profile}-stage-2`;
    const path = `/?e2e=1&autostart=0&mode=conflict&profile=${profile}&seed=${seed}`;
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(path);
    await waitForPausedBattle(page);

    const setupSummary = await page.evaluate(() => ({
      profile: window.__battleTest?.getPerformanceProfile(),
      factionCount: window.__battleTest?.getFactionIds().length ?? 0,
      groupCount: window.__battleTest?.getGroupIds().length ?? 0,
      map: window.__battleTest?.getMapLayerSummary(),
    }));
    expect(setupSummary.profile).toBe(profile);
    expect(setupSummary.map?.width).toBe(definition.width);
    expect(setupSummary.map?.height).toBe(definition.height);
    expect(setupSummary.factionCount).toBe(definition.expectedFactionCount);
    expect(setupSummary.groupCount).toBe(definition.expectedGroupCount);

    const initialHeapBytes = await usedHeapBytes(page);
    await page.evaluate(() => window.__battleTest?.resetPerformanceMetrics());
    const benchmarkStartedAt = performance.now();
    await advanceWithRenderedFrames(page, definition.benchmarkTicks);
    const benchmarkDurationMs = performance.now() - benchmarkStartedAt;
    const finalHeapBytes = await usedHeapBytes(page);
    const finalHash = await page.evaluate(() => window.__battleTest?.getStateHash() ?? "");
    const metrics = await page.evaluate(() => window.__battleTest?.getPerformanceMetrics());
    const browserRuntime = await page.evaluate(() => {
      const canvas = document.createElement("canvas");
      const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
      const debugInfo = gl?.getExtension("WEBGL_debug_renderer_info");
      return {
        userAgent: navigator.userAgent,
        gpuRenderer:
          gl && debugInfo
            ? String(gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL))
            : "unavailable",
      };
    });

    expect(metrics?.worker?.tickDurationMs.samples).toBe(definition.benchmarkTicks);
    expect(metrics?.workerMessageBytes.samples).toBeGreaterThanOrEqual(
      definition.benchmarkTicks / 2,
    );
    expect(metrics?.animationFrameIntervalMs.samples).toBeGreaterThan(0);
    expect(finalHash).not.toBe("");

    const replayPage = await page.context().newPage();
    try {
      await replayPage.goto(path);
      await waitForPausedBattle(replayPage);
      await replayPage.evaluate((ticks) => window.__battleTest?.step(ticks), definition.benchmarkTicks);
      await replayPage.waitForFunction(
        (ticks) => (window.__battleTest?.getTick() ?? -1) >= ticks,
        definition.benchmarkTicks,
      );
      const replayHash = await replayPage.evaluate(
        () => window.__battleTest?.getStateHash() ?? "",
      );
      expect(replayHash).toBe(finalHash);
    } finally {
      await replayPage.close();
    }

    const result = {
      profile,
      seed,
      browserVersion: browser.version(),
      browserRuntime,
      viewport: "1440x900",
      map: `${definition.width}x${definition.height}`,
      groups: definition.expectedGroupCount,
      members: definition.expectedMemberCount,
      ticks: definition.benchmarkTicks,
      benchmarkDurationMs,
      logicalTicksPerSecond: (definition.benchmarkTicks * 1_000) / benchmarkDurationMs,
      finalHash,
      worker: metrics?.worker,
      messages: {
        bytes: metrics?.workerMessageBytes,
        totalBytes: metrics?.totalWorkerMessageBytes,
        handlerDurationMs: metrics?.workerMessageHandlerDurationMs,
      },
      animationFrameIntervalMs: metrics?.animationFrameIntervalMs,
      heap: {
        initialBytes: initialHeapBytes,
        finalBytes: finalHeapBytes,
        growthBytes: finalHeapBytes - initialHeapBytes,
      },
    };
    console.log(`PERF_RESULT ${JSON.stringify(result)}`);
  });
}
