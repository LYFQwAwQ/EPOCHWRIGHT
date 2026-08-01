interface BattleTestApi {
  getTick(): number;
  getStateHash(): string;
  getStatus(): string;
  getMode(): "conflict" | "defense";
  getScenarioId(): string;
  getBattleId(): string;
  getMapLayerSummary():
    | {
        schemaVersion: string;
        width: number;
        height: number;
        cellCount: number;
        heightRangeUnits: number;
        mountainCellCount: number;
        shallowWaterCellCount: number;
        deepWaterCellCount: number;
        wetlandCellCount: number;
        layerLengths: readonly number[];
        staticObjects: readonly {
          id: string;
          kind: "tree" | "rock" | "wall";
          x: number;
          z: number;
          facing: number;
        }[];
        surfaceTypeCount: number;
        layersAreTypedArrays: boolean;
      }
    | undefined;
  getObjectives(): readonly {
    id: string;
    state: string;
    progressBps: number;
    attackerPower: number;
    defenderPower: number;
  }[];
  getFactionIds(): readonly string[];
  getGroupIds(): readonly string[];
  getPlatformIds(): readonly string[];
  getPlatforms(): readonly {
    id: string;
    groupId: string;
    worldX: number;
    worldY: number;
    worldZ: number;
    headingRadians: number;
    visualTypeId: string;
    flight?: {
      altitudeBand: "low" | "medium" | "high";
      clearanceMm: number;
    };
  }[];
  getProjectiles(): readonly {
    id: string;
    sourceFactionId: string;
    worldX: number;
    worldY: number;
    worldZ: number;
    visualTypeId: string;
  }[];
  getEventTypes(): readonly string[];
  getEventSummaries(): readonly {
    type: string;
    groupId?: string;
    sourceGroupId?: string;
    fireModeId?: string;
    phase?: string;
  }[];
  getObservation(): string;
  getLayerVisibility(): {
    objectives: boolean;
    contacts: boolean;
    paths: boolean;
  };
  getPerformanceProfile(): "medium" | "large" | undefined;
  getRenderQuality(): "low" | "medium" | "high";
  getCameraMode(): "free" | "follow" | "director";
  getDirectorHotspot():
    | {
        id: string;
        worldX: number;
        worldY: number;
        worldZ: number;
        score: number;
        reason: string;
      }
    | undefined;
  getCameraView():
    | {
        positionX: number;
        positionY: number;
        positionZ: number;
        targetX: number;
        targetY: number;
        targetZ: number;
        zoom: number;
        directorMoveCount: number;
      }
    | undefined;
  getPerformanceMetrics(): {
    worker?: {
      initializationDurationMs: number;
      tickDurationMs: PerformanceMetricSummary;
      frameProjectionDurationMs: PerformanceMetricSummary;
    };
    workerMessageBytes: PerformanceMetricSummary;
    workerMessageHandlerDurationMs: PerformanceMetricSummary;
    totalWorkerMessageBytes: number;
    animationFrameIntervalMs: PerformanceMetricSummary;
  };
  resetPerformanceMetrics(): void;
  setObservation(factionId?: string): void;
  setCameraMode(mode: "free" | "follow" | "director"): void;
  selectGroup(groupId?: string): void;
  selectPlatform(platformId: string, groupId: string): void;
  pause(): void;
  run(): void;
  step(count?: number): void;
}

interface PerformanceMetricSummary {
  samples: number;
  mean: number;
  p95: number;
  p99: number;
  max: number;
}

interface Window {
  __battleTest?: BattleTestApi;
}
