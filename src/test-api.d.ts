interface BattleTestApi {
  getTick(): number;
  getStateHash(): string;
  getStatus(): string;
  getMode(): "conflict" | "defense";
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
  getGroupIds(): readonly string[];
  getEventTypes(): readonly string[];
  selectGroup(groupId?: string): void;
  pause(): void;
  run(): void;
  step(count?: number): void;
}

interface Window {
  __battleTest?: BattleTestApi;
}
