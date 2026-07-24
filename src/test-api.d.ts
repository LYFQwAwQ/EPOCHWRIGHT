interface BattleTestApi {
  getTick(): number;
  getStateHash(): string;
  getStatus(): string;
  getMode(): "conflict" | "defense";
  getBattleId(): string;
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
