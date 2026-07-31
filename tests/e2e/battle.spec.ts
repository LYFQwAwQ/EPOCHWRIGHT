import { expect, test, type Page } from "@playwright/test";
import { PNG } from "pngjs";

interface CanvasMetrics {
  readonly width: number;
  readonly height: number;
  readonly opaqueRatio: number;
  readonly luminanceRange: number;
  readonly quantizedColors: number;
}

async function waitForBattle(page: Page): Promise<void> {
  await page.waitForFunction(
    () =>
      window.__battleTest?.getStatus() === "running" &&
      (window.__battleTest?.getTick() ?? 0) >= 4,
  );
  await expect(page.locator("canvas")).toBeVisible();
}

async function readCanvasMetrics(page: Page): Promise<CanvasMetrics> {
  const screenshot = await page.locator("canvas").screenshot();
  const image = PNG.sync.read(screenshot);
  let opaque = 0;
  let minimumLuminance = 255;
  let maximumLuminance = 0;
  const colors = new Set<number>();
  const pixelCount = image.width * image.height;
  const sampleStride = Math.max(1, Math.floor(pixelCount / 35_000));

  for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += sampleStride) {
    const offset = pixelIndex * 4;
    const red = image.data[offset] ?? 0;
    const green = image.data[offset + 1] ?? 0;
    const blue = image.data[offset + 2] ?? 0;
    const alpha = image.data[offset + 3] ?? 0;
    if (alpha > 0) opaque += 1;
    const luminance = Math.round(red * 0.2126 + green * 0.7152 + blue * 0.0722);
    minimumLuminance = Math.min(minimumLuminance, luminance);
    maximumLuminance = Math.max(maximumLuminance, luminance);
    colors.add(((red >> 4) << 8) | ((green >> 4) << 4) | (blue >> 4));
  }

  const samples = Math.ceil(pixelCount / sampleStride);
  return {
    width: image.width,
    height: image.height,
    opaqueRatio: opaque / samples,
    luminanceRange: maximumLuminance - minimumLuminance,
    quantizedColors: colors.size,
  };
}

async function expectMixedTerrainMap(page: Page): Promise<void> {
  const summary = await page.evaluate(() => window.__battleTest?.getMapLayerSummary());
  expect(summary).toBeDefined();
  expect(summary?.schemaVersion).toBe("map-2");
  expect(summary?.width).toBeGreaterThan(0);
  expect(summary?.height).toBeGreaterThan(0);
  expect(summary?.layersAreTypedArrays).toBe(true);
  expect(summary?.surfaceTypeCount).toBeGreaterThan(1);
  expect(summary?.heightRangeUnits).toBeGreaterThan(0);
  expect(summary?.mountainCellCount).toBeGreaterThan(0);
  expect(summary?.shallowWaterCellCount).toBeGreaterThan(0);
  expect(summary?.deepWaterCellCount).toBeGreaterThan(0);
  expect(summary?.wetlandCellCount).toBeGreaterThan(0);
  expect(summary?.staticObjects.length).toBeGreaterThan(0);
  expect(new Set(summary?.staticObjects.map((object) => object.id)).size).toBe(
    summary?.staticObjects.length,
  );
  for (const kind of ["tree", "rock", "wall"] as const) {
    expect(summary?.staticObjects.some((object) => object.kind === kind)).toBe(true);
  }
  expect(
    summary?.staticObjects.every(
      (object) =>
        object.x >= 0 &&
        object.x < summary.width &&
        object.z >= 0 &&
        object.z < summary.height &&
        Number.isInteger(object.facing) &&
        object.facing >= 0 &&
        object.facing <= 7,
    ),
  ).toBe(true);
  expect(summary?.layerLengths).toEqual([
    summary?.cellCount,
    summary?.cellCount,
    summary?.cellCount,
    summary?.cellCount,
    summary?.cellCount,
  ]);
}

function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  return errors;
}

async function countWaterPixels(page: Page): Promise<number> {
  const screenshot = await page.locator("canvas").screenshot();
  const image = PNG.sync.read(screenshot);
  let count = 0;
  for (let offset = 0; offset < image.data.length; offset += 4) {
    const red = image.data[offset] ?? 0;
    const green = image.data[offset + 1] ?? 0;
    const blue = image.data[offset + 2] ?? 0;
    const alpha = image.data[offset + 3] ?? 0;
    const isTealOrCyan =
      green > red + 14 &&
      blue > red + 8 &&
      blue > green - 25 &&
      blue < green + 50;
    if (alpha > 0 && isTealOrCyan) {
      count += 1;
    }
  }
  return count;
}

async function countTreeCanopyPixels(page: Page): Promise<number> {
  const screenshot = await page.locator("canvas").screenshot();
  const image = PNG.sync.read(screenshot);
  let count = 0;
  for (let offset = 0; offset < image.data.length; offset += 4) {
    const red = image.data[offset] ?? 0;
    const green = image.data[offset + 1] ?? 0;
    const blue = image.data[offset + 2] ?? 0;
    const alpha = image.data[offset + 3] ?? 0;
    if (
      alpha > 0 &&
      red < 90 &&
      green > red + 24 &&
      green > blue + 12 &&
      blue < 110
    ) {
      count += 1;
    }
  }
  return count;
}

async function countTracerPixels(page: Page): Promise<number> {
  const screenshot = await page.locator("canvas").screenshot();
  const image = PNG.sync.read(screenshot);
  let count = 0;
  for (let offset = 0; offset < image.data.length; offset += 4) {
    const red = image.data[offset] ?? 0;
    const green = image.data[offset + 1] ?? 0;
    const blue = image.data[offset + 2] ?? 0;
    if (red > 235 && green > 175 && blue < 195) {
      count += 1;
    }
  }
  return count;
}

async function countArtilleryEffectPixels(page: Page): Promise<number> {
  const screenshot = await page.locator("canvas").screenshot();
  const image = PNG.sync.read(screenshot);
  let count = 0;
  for (let offset = 0; offset < image.data.length; offset += 4) {
    const red = image.data[offset] ?? 0;
    const green = image.data[offset + 1] ?? 0;
    const blue = image.data[offset + 2] ?? 0;
    if (red > 235 && green > 65 && green < 205 && blue < 135) {
      count += 1;
    }
  }
  return count;
}

async function countProjectileTracerPixels(page: Page): Promise<number> {
  const screenshot = await page.locator("canvas").screenshot();
  const image = PNG.sync.read(screenshot);
  let count = 0;
  for (let offset = 0; offset < image.data.length; offset += 4) {
    const red = image.data[offset] ?? 0;
    const green = image.data[offset + 1] ?? 0;
    const blue = image.data[offset + 2] ?? 0;
    if (red > 245 && green > 235 && blue > 205) {
      count += 1;
    }
  }
  return count;
}

async function stepPausedBattle(page: Page, count: number): Promise<void> {
  const previousTick = await page.evaluate(() => window.__battleTest?.getTick() ?? 0);
  await page.evaluate((ticks) => window.__battleTest?.step(ticks), count);
  await page.waitForFunction(
    ({ tick, ticks }) =>
      (window.__battleTest?.getTick() ?? 0) >= tick + ticks ||
      window.__battleTest?.getStatus() === "finished",
    { tick: previousTick, ticks: count },
  );
}

async function countObjectiveBoundaryPixels(page: Page): Promise<number> {
  const screenshot = await page.locator("canvas").screenshot();
  const image = PNG.sync.read(screenshot);
  let count = 0;
  for (let offset = 0; offset < image.data.length; offset += 4) {
    const red = image.data[offset] ?? 0;
    const green = image.data[offset + 1] ?? 0;
    const blue = image.data[offset + 2] ?? 0;
    if (red > 225 && green > 170 && green < 225 && blue > 45 && blue < 155) {
      count += 1;
    }
  }
  return count;
}

async function countSelectedPlatformPixels(page: Page): Promise<number> {
  const screenshot = await page.locator("canvas").screenshot();
  const image = PNG.sync.read(screenshot);
  let count = 0;
  for (let offset = 0; offset < image.data.length; offset += 4) {
    const red = image.data[offset] ?? 0;
    const green = image.data[offset + 1] ?? 0;
    const blue = image.data[offset + 2] ?? 0;
    if (red > 225 && green > 170 && green < 235 && blue > 65 && blue < 180) {
      count += 1;
    }
  }
  return count;
}

async function countDroneSensorPixels(page: Page): Promise<number> {
  const screenshot = await page.locator("canvas").screenshot();
  const image = PNG.sync.read(screenshot);
  let count = 0;
  for (let offset = 0; offset < image.data.length; offset += 4) {
    const red = image.data[offset] ?? 0;
    const green = image.data[offset + 1] ?? 0;
    const blue = image.data[offset + 2] ?? 0;
    if (red > 105 && red < 190 && green > 205 && blue > 195) {
      count += 1;
    }
  }
  return count;
}

test("desktop battle renders, pauses, and exposes squad inspection", async ({ page }, testInfo) => {
  const errors = collectErrors(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?e2e=1&seed=e2e-desktop");
  await waitForBattle(page);

  expect(await page.evaluate(() => window.__battleTest?.getFactionIds())).toEqual([
    "ember",
    "azure",
    "olive",
  ]);

  const canvas = page.locator("canvas");
  await expect.poll(
    async () => (await canvas.boundingBox())?.width ?? 0,
  ).toBeGreaterThan(1_000);
  await expect.poll(
    async () => (await canvas.boundingBox())?.height ?? 0,
  ).toBeGreaterThan(700);
  const box = await canvas.boundingBox();
  expect(box?.width).toBeGreaterThan(1_000);
  expect(box?.height).toBeGreaterThan(700);

  const metrics = await readCanvasMetrics(page);
  expect(metrics.width).toBeGreaterThan(1_000);
  expect(metrics.height).toBeGreaterThan(700);
  expect(metrics.opaqueRatio).toBeGreaterThan(0.98);
  expect(metrics.luminanceRange).toBeGreaterThan(35);
  expect(metrics.quantizedColors).toBeGreaterThan(12);
  await expectMixedTerrainMap(page);
  expect(await countWaterPixels(page)).toBeGreaterThan(1_000);
  expect(await countTreeCanopyPixels(page)).toBeGreaterThan(100);

  await page.getByRole("button", { name: "暂停演算" }).click();
  await page.waitForFunction(() => window.__battleTest?.getStatus() === "paused");
  const pausedTick = await page.evaluate(() => window.__battleTest?.getTick() ?? -1);
  await page.waitForTimeout(350);
  expect(await page.evaluate(() => window.__battleTest?.getTick() ?? -2)).toBe(pausedTick);

  const cameraBefore = await canvas.screenshot();
  await canvas.hover();
  await page.mouse.wheel(0, -650);
  await page.waitForTimeout(250);
  const cameraAfter = await canvas.screenshot();
  expect(cameraBefore.equals(cameraAfter)).toBe(false);
  await page.getByRole("button", { name: "复位镜头" }).click();

  const selectedGroup = await page.evaluate(() => {
    const groupId = window.__battleTest?.getGroupIds()[0];
    window.__battleTest?.selectGroup(groupId);
    return groupId;
  });
  expect(selectedGroup).toBeTruthy();
  await expect(page.locator(".panel-heading--unit strong")).toHaveText(selectedGroup!);

  await page.getByRole("button", { name: "继续演算" }).click();
  await page.waitForFunction(
    (tick) => (window.__battleTest?.getTick() ?? 0) > Number(tick),
    pausedTick,
  );

  await page.screenshot({ path: testInfo.outputPath("battle-desktop.png"), fullPage: true });
  expect(errors).toEqual([]);
});

test("narrow viewport keeps a nonblank battlefield and stable controls", async ({ page }, testInfo) => {
  const errors = collectErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?e2e=1&seed=e2e-mobile");
  await waitForBattle(page);

  await expect(page.locator(".toolbar")).toBeVisible();
  await expect(page.locator(".mobile-status")).toBeVisible();
  const metrics = await readCanvasMetrics(page);
  expect(metrics.width).toBeGreaterThan(300);
  expect(metrics.height).toBeGreaterThan(600);
  expect(metrics.luminanceRange).toBeGreaterThan(25);
  expect(metrics.quantizedColors).toBeGreaterThan(8);
  await expectMixedTerrainMap(page);
  expect(await countWaterPixels(page)).toBeGreaterThan(200);
  expect(await countTreeCanopyPixels(page)).toBeGreaterThan(20);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true);

  await page.screenshot({ path: testInfo.outputPath("battle-mobile.png"), fullPage: true });
  expect(errors).toEqual([]);
});

test("quality changes stay in the renderer and preserve the battle hash", async ({ page }) => {
  const errors = collectErrors(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?e2e=1&autostart=0&seed=e2e-quality");
  await page.waitForFunction(
    () => window.__battleTest?.getStatus() === "paused" && Boolean(document.querySelector("canvas")),
  );

  const initialHash = await page.evaluate(() => window.__battleTest?.getStateHash() ?? "");
  expect(await page.evaluate(() => window.__battleTest?.getRenderQuality())).toBe("high");
  const quality = page.getByLabel("画质");
  await quality.selectOption("low");
  await expect.poll(() => page.evaluate(() => window.__battleTest?.getRenderQuality())).toBe("low");
  expect(await page.evaluate(() => window.__battleTest?.getStateHash() ?? "")).toBe(initialHash);

  await quality.selectOption("medium");
  await expect.poll(() => page.evaluate(() => window.__battleTest?.getRenderQuality())).toBe("medium");
  expect(await page.evaluate(() => window.__battleTest?.getStateHash() ?? "")).toBe(initialHash);
  expect(errors).toEqual([]);
});

test("vehicle scenario renders platforms and exposes crewed platform inspection", async ({
  page,
}, testInfo) => {
  const errors = collectErrors(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(
    "/?e2e=1&devtools=1&autostart=0&scenario=vehicle-skirmish&seed=e2e-vehicles",
  );
  await page.waitForFunction(
    () =>
      window.__battleTest?.getStatus() === "paused" &&
      (window.__battleTest?.getPlatformIds().length ?? 0) === 2,
  );

  expect(await page.evaluate(() => window.__battleTest?.getPlatformIds())).toEqual([
    "azure-tracked-1-platform",
    "ember-wheeled-1-platform",
  ]);
  await page.evaluate(() => window.__battleTest?.selectGroup("ember-wheeled-1"));
  await expect(page.getByTestId("platform-status")).toContainText("轮式可机动");
  await expect(page.getByTestId("platform-status")).toContainText("1 乘客组");
  await expect(page.getByTestId("mode-effectiveness")).toContainText("有效");

  await page.evaluate(() => window.__battleTest?.selectGroup("ember-squad-2"));
  await expect(page.getByTestId("transport-status")).toContainText("已搭载");
  await expect(page.getByTestId("transport-status")).toContainText(
    "ember-wheeled-1-platform",
  );

  let sawEmbarkationEvent = false;
  for (let index = 0; index < 35 && !sawEmbarkationEvent; index += 1) {
    const previousTick = await page.evaluate(() => window.__battleTest?.getTick() ?? 0);
    await page.evaluate(() => window.__battleTest?.step(20));
    await page.waitForFunction(
      (tick) =>
        (window.__battleTest?.getTick() ?? 0) >= Number(tick) + 20 ||
        window.__battleTest?.getStatus() === "finished",
      previousTick,
    );
    sawEmbarkationEvent = await page.evaluate(() =>
      window.__battleTest?.getEventTypes().includes("embarkation-changed") ?? false,
    );
  }
  expect(sawEmbarkationEvent).toBe(true);

  await page.evaluate(() => window.__battleTest?.selectGroup("azure-tracked-1"));
  await expect(page.getByTestId("target-evaluation")).toBeVisible();
  await expect(page.getByTestId("vehicle-engagement")).toBeVisible();

  await page.evaluate(() => window.__battleTest?.selectGroup("azure-squad-2"));
  await expect(page.getByTestId("transport-dismount-evaluation")).toBeVisible();

  const metrics = await readCanvasMetrics(page);
  expect(metrics.opaqueRatio).toBeGreaterThan(0.98);
  expect(metrics.luminanceRange).toBeGreaterThan(70);
  expect(metrics.quantizedColors).toBeGreaterThan(24);
  expect(errors).toEqual([]);
  await page.screenshot({
    path: testInfo.outputPath("vehicle-skirmish.png"),
    fullPage: true,
  });
});

test("passive ability scenario exposes observer-safe ability explanations", async ({
  page,
}, testInfo) => {
  const errors = collectErrors(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(
    "/?e2e=1&devtools=1&autostart=0&scenario=passive-ability&seed=e2e-passive-ability",
  );
  await page.waitForFunction(
    () =>
      window.__battleTest?.getStatus() === "paused" &&
      window.__battleTest?.getGroupIds().includes("ember-disciplined-1") &&
      window.__battleTest?.getGroupIds().includes("azure-disciplined-1"),
  );

  await page.evaluate(() => window.__battleTest?.selectGroup("ember-disciplined-1"));
  const abilities = page.getByTestId("passive-abilities");
  await expect(abilities).toContainText("队列纪律");
  await expect(abilities).toContainText("所属编组");
  await expect(abilities).toContainText("压制抗性 +20%");

  const omniscientHash = await page.evaluate(() => window.__battleTest?.getStateHash() ?? "");
  await page.evaluate(() => window.__battleTest?.setObservation("ember"));
  await page.waitForFunction(() => window.__battleTest?.getObservation() === "ember");
  expect(await page.evaluate(() => window.__battleTest?.getStateHash() ?? "")).toBe(
    omniscientHash,
  );
  await page.evaluate(() => window.__battleTest?.selectGroup("ember-disciplined-1"));
  await expect(abilities).toContainText("队列纪律");

  await page.evaluate(() => window.__battleTest?.selectGroup("azure-disciplined-1"));
  await expect(page.getByTestId("passive-abilities")).toHaveCount(0);

  await page.evaluate(() => window.__battleTest?.setObservation());
  await page.waitForFunction(() => window.__battleTest?.getObservation() === "omniscient");
  await page.evaluate(() => window.__battleTest?.selectGroup("ember-disciplined-1"));
  await expect(abilities).toContainText("队列纪律");
  await page.screenshot({ path: testInfo.outputPath("passive-ability-desktop.png"), fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  const inspectorBox = await page.locator(".inspector-panel").boundingBox();
  expect(inspectorBox).toBeTruthy();
  expect(inspectorBox!.x).toBeGreaterThanOrEqual(0);
  expect(inspectorBox!.x + inspectorBox!.width).toBeLessThanOrEqual(390);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("passive-ability-mobile.png"), fullPage: true });
  expect(errors).toEqual([]);
});

test("air recon scenario renders flight height and exposes hover inspection", async ({
  page,
}, testInfo) => {
  const errors = collectErrors(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(
    "/?e2e=1&devtools=1&autostart=0&scenario=air-recon&seed=e2e-air-recon",
  );
  await page.waitForFunction(
    () =>
      window.__battleTest?.getStatus() === "paused" &&
      (window.__battleTest?.getPlatformIds().length ?? 0) === 2,
  );

  const platforms = await page.evaluate(() => window.__battleTest?.getPlatforms() ?? []);
  expect(platforms.map((platform) => platform.id).sort()).toEqual([
    "azure-air-recon-1-platform",
    "ember-air-recon-1-platform",
  ]);
  expect(
    platforms.every(
      (platform) =>
        platform.worldY >= 12 &&
        platform.flight?.altitudeBand === "low" &&
        platform.flight.clearanceMm === 12_000,
    ),
  ).toBe(true);

  const unselectedPixels = await countSelectedPlatformPixels(page);
  await page.evaluate(() =>
    window.__battleTest?.selectPlatform(
      "ember-air-recon-1-platform",
      "ember-air-recon-1",
    ),
  );
  await expect(page.getByTestId("platform-inspection")).toContainText("悬停");
  await expect(page.getByTestId("flight-status")).toContainText("低空");
  await expect(page.getByTestId("flight-status")).toContainText("离地 12m");
  await expect
    .poll(() => countSelectedPlatformPixels(page))
    .toBeGreaterThan(unselectedPixels + 10);

  let previousPlatform = platforms.find(
    (platform) => platform.id === "ember-air-recon-1-platform",
  )!;
  let observedAlignedMovement = false;
  for (let attempt = 0; attempt < 20 && !observedAlignedMovement; attempt += 1) {
    await stepPausedBattle(page, 4);
    const currentPlatform = await page.evaluate(() =>
      window.__battleTest
        ?.getPlatforms()
        .find((platform) => platform.id === "ember-air-recon-1-platform"),
    );
    expect(currentPlatform).toBeDefined();
    const dx = currentPlatform!.worldX - previousPlatform.worldX;
    const dz = currentPlatform!.worldZ - previousPlatform.worldZ;
    if (Math.hypot(dx, dz) > 0.01) {
      const forwardX = Math.sin(currentPlatform!.headingRadians);
      const forwardZ = Math.cos(currentPlatform!.headingRadians);
      expect(dx * forwardX + dz * forwardZ).toBeGreaterThan(0);
      observedAlignedMovement = true;
    }
    previousPlatform = currentPlatform!;
  }
  expect(observedAlignedMovement).toBe(true);

  const desktopMetrics = await readCanvasMetrics(page);
  expect(desktopMetrics.opaqueRatio).toBeGreaterThan(0.98);
  expect(desktopMetrics.luminanceRange).toBeGreaterThan(70);
  expect(desktopMetrics.quantizedColors).toBeGreaterThan(24);
  await page.screenshot({ path: testInfo.outputPath("air-recon-desktop.png"), fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator("canvas")).toBeVisible();
  const mobileMetrics = await readCanvasMetrics(page);
  expect(mobileMetrics.width).toBeGreaterThan(300);
  expect(mobileMetrics.height).toBeGreaterThan(300);
  expect(mobileMetrics.luminanceRange).toBeGreaterThan(60);
  await page.screenshot({ path: testInfo.outputPath("air-recon-mobile.png"), fullPage: true });
  expect(errors).toEqual([]);
});

test("air operations renders distinct hover platforms and preserves observer boundaries", async ({
  page,
}, testInfo) => {
  test.setTimeout(60_000);
  const errors = collectErrors(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(
    "/?e2e=1&devtools=1&autostart=0&scenario=air-operations&seed=scenario-air-operations-runtime",
  );
  await page.waitForFunction(
    () =>
      window.__battleTest?.getStatus() === "paused" &&
      (window.__battleTest?.getPlatformIds().length ?? 0) === 6,
  );

  const initialPlatforms = await page.evaluate(() => window.__battleTest?.getPlatforms() ?? []);
  expect(
    Object.fromEntries(
      initialPlatforms.map((platform) => [platform.id, platform.visualTypeId]),
    ),
  ).toEqual({
    "azure-air-attack-1-platform": "air-attack-helicopter",
    "azure-air-drone-1-platform": "air-scout-drone",
    "azure-air-recon-1-platform": "air-recon-helicopter",
    "ember-air-attack-1-platform": "air-attack-helicopter",
    "ember-air-drone-1-platform": "air-scout-drone",
    "ember-air-recon-1-platform": "air-recon-helicopter",
  });
  await expect.poll(() => countDroneSensorPixels(page)).toBeGreaterThan(0);

  await page.evaluate(() =>
    window.__battleTest?.selectPlatform(
      "ember-air-attack-1-platform",
      "ember-air-attack-1",
    ),
  );
  await expect(page.getByTestId("platform-inspection")).toContainText("武装直升机");
  await expect(page.getByTestId("flight-status")).toContainText("中空");
  await expect(page.getByTestId("flight-status")).toContainText("离地 44m");
  await expect(page.getByTestId("flight-status")).toContainText("空中火力支援");
  await expect(page.getByTestId("platform-weapons")).toContainText("空地机炮");
  await expect(page.getByTestId("platform-weapons")).toContainText("空空机炮");

  await page.evaluate(() =>
    window.__battleTest?.selectPlatform(
      "ember-air-drone-1-platform",
      "ember-air-drone-1",
    ),
  );
  await expect(page.getByTestId("platform-inspection")).toContainText("侦察无人机");
  await expect(page.getByTestId("platform-inspection")).toContainText("无武装");
  await expect(page.getByTestId("flight-status")).toContainText("高空");
  await expect(page.getByTestId("flight-status")).toContainText("离地 64m");
  await expect(page.getByTestId("flight-status")).toContainText("远程侦察");

  const omniscientHash = await page.evaluate(() => window.__battleTest?.getStateHash() ?? "");
  await page.evaluate(() => window.__battleTest?.setObservation("ember"));
  await page.waitForFunction(() => window.__battleTest?.getObservation() === "ember");
  expect(await page.evaluate(() => window.__battleTest?.getStateHash() ?? "")).toBe(omniscientHash);
  expect(
    await page.evaluate(() =>
      window.__battleTest?.getPlatformIds().every((id) => id.startsWith("ember-")),
    ),
  ).toBe(true);
  await page.evaluate(() =>
    window.__battleTest?.selectPlatform(
      "azure-air-attack-1-platform",
      "azure-air-attack-1",
    ),
  );
  await expect(page.getByTestId("platform-inspection")).toHaveCount(0);

  await page.evaluate(() => window.__battleTest?.setObservation());
  await page.waitForFunction(() => window.__battleTest?.getObservation() === "omniscient");
  const allowedClearances: Readonly<Record<string, readonly number[]>> = {
    "air-recon-helicopter": [12_000, 40_000, 80_000],
    "air-attack-helicopter": [14_000, 44_000, 84_000],
    "air-scout-drone": [10_000, 32_000, 64_000],
  };
  const initialById = new Map(initialPlatforms.map((platform) => [platform.id, platform]));
  let transitioningPlatform: (typeof initialPlatforms)[number] | undefined;
  for (let tick = 0; tick < 240 && !transitioningPlatform; tick += 1) {
    await stepPausedBattle(page, 1);
    const platforms = await page.evaluate(() => window.__battleTest?.getPlatforms() ?? []);
    transitioningPlatform = platforms.find(
      (platform) =>
        platform.flight !== undefined &&
        !allowedClearances[platform.visualTypeId]!.includes(platform.flight.clearanceMm),
    );
  }
  expect(transitioningPlatform).toBeDefined();
  expect(transitioningPlatform!.worldY).not.toBe(initialById.get(transitioningPlatform!.id)!.worldY);

  const hashBeforeQuality = await page.evaluate(() => window.__battleTest?.getStateHash() ?? "");
  await page.getByLabel("画质").selectOption("low");
  await expect.poll(() => page.evaluate(() => window.__battleTest?.getRenderQuality())).toBe("low");
  expect(await page.evaluate(() => window.__battleTest?.getStateHash() ?? "")).toBe(
    hashBeforeQuality,
  );

  await page.evaluate(() =>
    window.__battleTest?.selectPlatform(
      "ember-air-attack-1-platform",
      "ember-air-attack-1",
    ),
  );
  await page.screenshot({ path: testInfo.outputPath("air-operations-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator("canvas")).toBeVisible();
  const inspectorBox = await page.locator(".inspector-panel").boundingBox();
  expect(inspectorBox).toBeTruthy();
  expect(inspectorBox!.x).toBeGreaterThanOrEqual(0);
  expect(inspectorBox!.x + inspectorBox!.width).toBeLessThanOrEqual(390);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("air-operations-mobile.png"), fullPage: true });
  expect(errors).toEqual([]);
});

test("artillery scenario projects missions, moving shells, impacts, and observer-safe events", async ({
  page,
}, testInfo) => {
  test.setTimeout(60_000);
  const errors = collectErrors(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(
    "/?e2e=1&devtools=1&autostart=0&scenario=artillery-observation&seed=ridge-0712",
  );
  await page.waitForFunction(
    () =>
      window.__battleTest?.getStatus() === "paused" &&
      (window.__battleTest?.getPlatformIds().length ?? 0) === 2,
  );

  const initialHash = await page.evaluate(() => window.__battleTest?.getStateHash() ?? "");
  await page.evaluate(() => window.__battleTest?.setObservation("ember"));
  await page.waitForFunction(() => window.__battleTest?.getObservation() === "ember");
  expect(await page.evaluate(() => window.__battleTest?.getStateHash() ?? "")).toBe(initialHash);
  expect(
    await page.evaluate(() =>
      window.__battleTest?.getGroupIds().every((id) => id.startsWith("ember-")),
    ),
  ).toBe(true);

  await page.evaluate(() =>
    window.__battleTest?.selectPlatform(
      "ember-artillery-1-platform",
      "ember-artillery-1",
    ),
  );
  await expect(page.getByTestId("platform-inspection")).toBeVisible();
  await expect(page.getByTestId("artillery-status")).toContainText("行军状态");

  let missionVisible = false;
  for (let index = 0; index < 180 && !missionVisible; index += 1) {
    await stepPausedBattle(page, 5);
    missionVisible = await page.getByTestId("artillery-mission").isVisible().catch(() => false);
  }
  expect(missionVisible).toBe(true);
  await expect(page.getByTestId("artillery-mission")).toContainText("弹着格");
  await expect(page.getByTestId("artillery-evaluation")).toBeVisible();
  const preLaunchTracerPixels = await countProjectileTracerPixels(page);

  let firstProjectile: ReturnType<BattleTestApi["getProjectiles"]>[number] | undefined;
  for (let index = 0; index < 100 && !firstProjectile; index += 1) {
    await stepPausedBattle(page, 1);
    firstProjectile = await page.evaluate(() =>
      window.__battleTest
        ?.getProjectiles()
        .find((projectile) => projectile.sourceFactionId === "ember"),
    );
  }
  expect(firstProjectile).toBeDefined();
  expect(Object.keys(firstProjectile!).sort()).toEqual([
    "id",
    "sourceFactionId",
    "visualTypeId",
    "worldX",
    "worldY",
    "worldZ",
  ]);

  const canvas = page.locator("canvas");
  const frameBefore = await canvas.screenshot();
  await stepPausedBattle(page, 2);
  const nextProjectile = await page.evaluate((projectileId) =>
    window.__battleTest?.getProjectiles().find((projectile) => projectile.id === projectileId),
    firstProjectile!.id,
  );
  expect(nextProjectile).toBeDefined();
  expect(nextProjectile?.worldX).not.toBe(firstProjectile?.worldX);
  await expect(page.locator(".event-feed")).toContainText("自行火炮");
  const stableTick = await page.evaluate(() => window.__battleTest?.getTick() ?? 0);
  await page.waitForTimeout(900);
  const activeTracerPixels = await countProjectileTracerPixels(page);
  await canvas.screenshot({ path: testInfo.outputPath("artillery-tracer.png") });
  expect(activeTracerPixels).toBeGreaterThan(preLaunchTracerPixels + 2);
  await page.waitForTimeout(60);
  const interpolatedFrame = await canvas.screenshot();
  expect(interpolatedFrame.equals(frameBefore)).toBe(false);
  expect(await page.evaluate(() => window.__battleTest?.getTick() ?? -1)).toBe(stableTick);

  const preImpactPixels = await countArtilleryEffectPixels(page);
  let impacted = false;
  for (let index = 0; index < 80 && !impacted; index += 1) {
    await stepPausedBattle(page, 1);
    impacted = await page.evaluate(() =>
      window.__battleTest?.getEventSummaries().some(
        (event) =>
          event.type === "projectile-impacted" &&
          event.sourceGroupId === "ember-artillery-1",
      ) ?? false,
    );
  }
  expect(impacted).toBe(true);
  await page.waitForTimeout(60);
  expect(await countArtilleryEffectPixels(page)).toBeGreaterThan(preImpactPixels + 10);
  await page.waitForTimeout(1_100);
  expect(await countProjectileTracerPixels(page)).toBeLessThanOrEqual(
    preLaunchTracerPixels + 8,
  );

  const projectedEvents = await page.evaluate(() =>
    window.__battleTest?.getEventSummaries() ?? [],
  );
  expect(
    projectedEvents.some(
      (event) =>
        event.type === "artillery-mission-changed" &&
        event.groupId === "azure-artillery-1",
    ),
  ).toBe(false);
  expect(
    projectedEvents.some(
      (event) =>
        event.type === "weapon-fired" &&
        event.fireModeId === "indirect" &&
        event.groupId === "azure-artillery-1",
    ),
  ).toBe(false);

  const hashBeforeQuality = await page.evaluate(() => window.__battleTest?.getStateHash() ?? "");
  await page.getByLabel("画质").selectOption("low");
  await expect.poll(() => page.evaluate(() => window.__battleTest?.getRenderQuality())).toBe("low");
  expect(await page.evaluate(() => window.__battleTest?.getStateHash() ?? "")).toBe(
    hashBeforeQuality,
  );

  await page.screenshot({
    path: testInfo.outputPath("artillery-observation-desktop.png"),
    fullPage: true,
  });

  await page.setViewportSize({ width: 390, height: 844 });
  const inspectorBox = await page.locator(".inspector-panel").boundingBox();
  expect(inspectorBox).toBeTruthy();
  expect(inspectorBox!.x).toBeGreaterThanOrEqual(0);
  expect(inspectorBox!.x + inspectorBox!.width).toBeLessThanOrEqual(390);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("artillery-observation-mobile.png"), fullPage: true });
  expect(errors).toEqual([]);
});

test("faction observation projects only authorized groups and independent layers", async ({ page }) => {
  const errors = collectErrors(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?e2e=1&mode=defense&seed=e2e-observation");
  await waitForBattle(page);

  await page.getByRole("button", { name: "暂停演算" }).click();
  await page.waitForFunction(() => window.__battleTest?.getStatus() === "paused");
  await page.waitForTimeout(200);
  await page.locator('select[aria-label="观察视角"]').selectOption("ember");
  await page.waitForFunction(() => window.__battleTest?.getObservation() === "ember");
  const visibleGroups = await page.evaluate(() => window.__battleTest?.getGroupIds() ?? []);
  expect(visibleGroups.length).toBeGreaterThan(0);
  expect(visibleGroups.every((id) => id.startsWith("ember-"))).toBe(true);
  const projectedHash = await page.evaluate(() => window.__battleTest?.getStateHash());
  await page.waitForTimeout(200);
  expect(await page.evaluate(() => window.__battleTest?.getStateHash())).toBe(projectedHash);

  const objectiveToggle = page.getByRole("checkbox", { name: "目标" });
  await expect(objectiveToggle).toBeChecked();
  await objectiveToggle.uncheck();
  await expect(page.locator(".objective-summary")).toHaveCount(0);
  await objectiveToggle.check();
  await expect(page.locator(".objective-summary")).toBeVisible();
  expect(errors).toEqual([]);
});

test("weapon fire produces visible tracer pixels", async ({ page }, testInfo) => {
  const errors = collectErrors(page);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/?e2e=1&autostart=0&seed=e2e-tracers");
  await page.waitForFunction(
    () => window.__battleTest?.getStatus() === "paused" && Boolean(document.querySelector("canvas")),
  );

  await page.evaluate(() => window.__battleTest?.step(700));
  await page.waitForFunction(() =>
    window.__battleTest?.getEventTypes().includes("weapon-fired"),
  );
  await page.waitForTimeout(50);
  expect(await countTracerPixels(page)).toBeGreaterThan(3);
  await page.screenshot({ path: testInfo.outputPath("battle-tracers.png"), fullPage: true });
  expect(errors).toEqual([]);
});

test("defense mode renders its objective zone and semantic HUD", async ({ page }, testInfo) => {
  const errors = collectErrors(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?e2e=1&autostart=0&mode=defense&seed=e2e-defense-objective");
  await page.waitForFunction(
    () =>
      window.__battleTest?.getStatus() === "paused" &&
      window.__battleTest?.getMode() === "defense" &&
      window.__battleTest?.getObjectives().length === 1,
  );
  await expect(page.locator("canvas")).toBeVisible();

  const objective = await page.evaluate(() => window.__battleTest?.getObjectives()[0]);
  expect(objective).toBeTruthy();
  expect(objective?.id).toBe("central-objective");
  expect(objective?.state).toBe("defender-controlled");
  expect(objective?.progressBps).toBe(0);

  const summary = page.getByRole("region", { name: "防守目标" });
  await expect(summary).toBeVisible();
  await expect(summary.getByText("防守方控制")).toBeVisible();
  const progress = summary.getByRole("progressbar", {
    name: "central-objective 占领进度",
  });
  await expect(progress).toHaveAttribute("aria-valuemin", "0");
  await expect(progress).toHaveAttribute("aria-valuemax", "100");
  await expect(progress).toHaveAttribute("aria-valuenow", "0");

  const defenderGroup = await page.evaluate(() => {
    const groupId = window.__battleTest
      ?.getGroupIds()
      .find((candidate) => candidate.startsWith("azure-"));
    window.__battleTest?.selectGroup(groupId);
    return groupId;
  });
  expect(defenderGroup).toBeTruthy();
  await expect(page.locator(".panel-heading--unit strong")).toHaveText(defenderGroup!);
  await expect(page.getByText("掩体评估", { exact: true })).toBeVisible();

  const metrics = await readCanvasMetrics(page);
  expect(metrics.luminanceRange).toBeGreaterThan(35);
  expect(metrics.quantizedColors).toBeGreaterThan(12);
  expect(await countObjectiveBoundaryPixels(page)).toBeGreaterThan(25);

  await page.screenshot({
    path: testInfo.outputPath("battle-defense-objective.png"),
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

test("defense HUD stays separated and usable on a narrow viewport", async ({ page }, testInfo) => {
  const errors = collectErrors(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/?e2e=1&autostart=0&mode=defense&seed=e2e-defense-mobile");
  await page.waitForFunction(
    () =>
      window.__battleTest?.getStatus() === "paused" &&
      window.__battleTest?.getObjectives().length === 1,
  );

  const toolbar = page.locator(".toolbar");
  const factions = page.locator(".faction-summary");
  const objective = page.getByRole("region", { name: "防守目标" });
  await expect(page.getByRole("button", { name: "冲突模式" })).toBeVisible();
  await expect(page.getByRole("button", { name: "防守模式" })).toBeVisible();
  await expect(objective).toBeVisible();

  const [toolbarBox, factionBox, objectiveBox] = await Promise.all([
    toolbar.boundingBox(),
    factions.boundingBox(),
    objective.boundingBox(),
  ]);
  expect(toolbarBox && factionBox && objectiveBox).toBeTruthy();
  expect(toolbarBox!.y + toolbarBox!.height).toBeLessThanOrEqual(factionBox!.y);
  expect(factionBox!.y + factionBox!.height).toBeLessThanOrEqual(objectiveBox!.y);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  const metrics = await readCanvasMetrics(page);
  expect(metrics.luminanceRange).toBeGreaterThan(25);
  expect(metrics.quantizedColors).toBeGreaterThan(8);
  await page.screenshot({ path: testInfo.outputPath("battle-defense-mobile.png"), fullPage: true });
  expect(errors).toEqual([]);
});

test("switching conflict and defense modes creates fresh battle sessions", async ({ page }) => {
  const errors = collectErrors(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/?e2e=1&autostart=0&mode=conflict&seed=e2e-mode-switch");
  await page.waitForFunction(
    () =>
      window.__battleTest?.getStatus() === "paused" &&
      window.__battleTest?.getMode() === "conflict" &&
      Boolean(window.__battleTest?.getBattleId()),
  );

  const conflictBattleId = await page.evaluate(() => window.__battleTest?.getBattleId() ?? "");
  expect(conflictBattleId).toBeTruthy();
  await expect(page.getByRole("region", { name: "防守目标" })).toHaveCount(0);

  await page.getByRole("button", { name: "防守模式" }).click();
  await page.waitForFunction(
    (previousBattleId) =>
      window.__battleTest?.getMode() === "defense" &&
      window.__battleTest?.getBattleId() !== previousBattleId &&
      window.__battleTest?.getObjectives().length === 1,
    conflictBattleId,
  );
  const defenseBattleId = await page.evaluate(() => window.__battleTest?.getBattleId() ?? "");
  expect(defenseBattleId).not.toBe(conflictBattleId);
  await expect(page.getByRole("region", { name: "防守目标" })).toBeVisible();

  await page.getByRole("button", { name: "冲突模式" }).click();
  await page.waitForFunction(
    (previousBattleId) =>
      window.__battleTest?.getMode() === "conflict" &&
      window.__battleTest?.getBattleId() !== previousBattleId &&
      window.__battleTest?.getObjectives().length === 0,
    defenseBattleId,
  );
  const nextConflictBattleId = await page.evaluate(
    () => window.__battleTest?.getBattleId() ?? "",
  );
  expect(nextConflictBattleId).not.toBe(defenseBattleId);
  await expect(page.getByRole("region", { name: "防守目标" })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test("development scenario lab exposes reproducible scenarios and paused stepping", async ({ page }, testInfo) => {
  const errors = collectErrors(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(
    "/?e2e=1&devtools=1&autostart=0&scenario=alliance-conflict&seed=e2e-scenario-lab",
  );
  await page.waitForFunction(
    () =>
      window.__battleTest?.getStatus() === "paused" &&
      window.__battleTest?.getScenarioId() === "alliance-conflict",
  );

  const lab = page.getByRole("region", { name: "开发场景实验台" });
  await expect(lab).toBeVisible();
  await page.getByLabel("测试场景").selectOption("sequence-defense");
  await page.waitForFunction(
    () =>
      window.__battleTest?.getStatus() === "paused" &&
      window.__battleTest?.getScenarioId() === "sequence-defense" &&
      window.__battleTest?.getMode() === "defense" &&
      window.__battleTest?.getObjectives().length === 3,
  );
  await expect(page.getByRole("region", { name: "防守目标" })).toBeVisible();

  await page.getByRole("textbox", { name: "场景种子" }).fill("manual-sequence-01");
  await page.getByRole("button", { name: "应用场景种子" }).click();
  await page.waitForFunction(
    () => window.__battleTest?.getBattleId() === "demo-sequence-defense-manual-sequence-01",
  );

  await page.getByLabel("测试场景").selectOption("reinforcement-conflict");
  await page.waitForFunction(
    () =>
      window.__battleTest?.getStatus() === "paused" &&
      window.__battleTest?.getScenarioId() === "reinforcement-conflict",
  );
  for (let index = 0; index < 5; index += 1) {
    await page.getByRole("button", { name: "推进 20 tick" }).click();
  }
  await page.waitForFunction(
    () =>
      (window.__battleTest?.getTick() ?? 0) >= 100 &&
      window.__battleTest?.getEventTypes().includes("reinforcement-triggered") &&
      window.__battleTest?.getEventTypes().includes("reinforcement-deployed"),
  );
  expect(await page.evaluate(() => window.__battleTest?.getGroupIds().length)).toBeGreaterThan(4);

  const desktopMetrics = await readCanvasMetrics(page);
  expect(desktopMetrics.opaqueRatio).toBeGreaterThan(0.98);
  expect(desktopMetrics.luminanceRange).toBeGreaterThan(25);
  expect(desktopMetrics.quantizedColors).toBeGreaterThan(8);

  await page.screenshot({ path: testInfo.outputPath("scenario-lab-desktop.png"), fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  const [labBox, observationBox, factionBox] = await Promise.all([
    lab.boundingBox(),
    page.locator(".observation-panel").boundingBox(),
    page.locator(".faction-summary").boundingBox(),
  ]);
  expect(labBox && observationBox && factionBox).toBeTruthy();
  expect(labBox!.y + labBox!.height).toBeLessThanOrEqual(observationBox!.y);
  expect(observationBox!.y + observationBox!.height).toBeLessThanOrEqual(factionBox!.y);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("scenario-lab-mobile.png"), fullPage: true });
  expect(errors).toEqual([]);
});
