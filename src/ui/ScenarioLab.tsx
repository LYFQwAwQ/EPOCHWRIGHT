import { useEffect, useState } from "react";
import {
  CornerDownLeft,
  Dices,
  FastForward,
  FlaskConical,
  StepForward,
} from "lucide-react";
import type { DemoScenarioDefinition, DemoScenarioId } from "../demo";

interface ScenarioLabProps {
  readonly scenarios: readonly DemoScenarioDefinition[];
  readonly scenarioId: DemoScenarioId;
  readonly seed: string;
  readonly paused: boolean;
  readonly finished: boolean;
  readonly onScenarioChange: (scenarioId: DemoScenarioId) => void;
  readonly onSeedChange: (seed: string) => void;
  readonly onRandomize: () => void;
  readonly onStep: (ticks: number) => void;
}

export function ScenarioLab({
  scenarios,
  scenarioId,
  seed,
  paused,
  finished,
  onScenarioChange,
  onSeedChange,
  onRandomize,
  onStep,
}: ScenarioLabProps) {
  const [seedDraft, setSeedDraft] = useState(seed);

  useEffect(() => setSeedDraft(seed), [seed]);

  const normalizedSeed = seedDraft.trim();
  const canApplySeed = normalizedSeed.length > 0 && normalizedSeed !== seed;
  const applySeed = () => {
    if (canApplySeed) {
      onSeedChange(normalizedSeed);
    }
  };

  return (
    <section className="scenario-lab" aria-label="开发场景实验台">
      <div className="scenario-lab-title">
        <FlaskConical size={16} aria-hidden="true" />
        <span>场景实验台</span>
      </div>
      <select
        value={scenarioId}
        aria-label="测试场景"
        onChange={(event) => onScenarioChange(event.target.value as DemoScenarioId)}
      >
        {scenarios.map((scenario) => (
          <option key={scenario.id} value={scenario.id}>
            {scenario.label}
          </option>
        ))}
      </select>
      <div className="scenario-seed-control">
        <input
          value={seedDraft}
          aria-label="场景种子"
          spellCheck={false}
          onChange={(event) => setSeedDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              applySeed();
            }
          }}
        />
        <button
          className="icon-button"
          type="button"
          title="应用场景种子"
          aria-label="应用场景种子"
          disabled={!canApplySeed}
          onClick={applySeed}
        >
          <CornerDownLeft size={16} />
        </button>
      </div>
      <button
        className="icon-button"
        type="button"
        title="随机场景种子"
        aria-label="随机场景种子"
        onClick={onRandomize}
      >
        <Dices size={17} />
      </button>
      <span className="scenario-lab-separator" />
      <button
        className="icon-button"
        type="button"
        title="推进 1 tick"
        aria-label="推进 1 tick"
        disabled={!paused || finished}
        onClick={() => onStep(1)}
      >
        <StepForward size={17} />
      </button>
      <button
        className="icon-button"
        type="button"
        title="推进 20 tick"
        aria-label="推进 20 tick"
        disabled={!paused || finished}
        onClick={() => onStep(20)}
      >
        <FastForward size={17} />
      </button>
    </section>
  );
}
