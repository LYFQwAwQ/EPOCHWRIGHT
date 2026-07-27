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
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

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
