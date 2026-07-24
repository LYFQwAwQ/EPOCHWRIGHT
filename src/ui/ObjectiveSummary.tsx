import { Shield, Swords } from "lucide-react";
import type { RenderObjective } from "../sim/types";

interface ObjectiveSummaryProps {
  readonly objectives: readonly RenderObjective[];
  readonly factionNames: Readonly<Record<string, string>>;
  readonly factionColors: Readonly<Record<string, string>>;
}

const statusLabels: Readonly<Record<RenderObjective["state"], string>> = {
  "defender-controlled": "防守方控制",
  capturing: "正在占领",
  contested: "争夺中",
  recovering: "防守方恢复",
  unoccupied: "目标区空置",
  "attacker-controlled": "进攻方控制",
};

export function ObjectiveSummary({ objectives, factionNames, factionColors }: ObjectiveSummaryProps) {
  if (objectives.length === 0) {
    return null;
  }

  return (
    <section className="objective-summary" aria-label="防守目标">
      {objectives.map((objective, index) => {
        const percentage = Math.round(objective.progressBps / 100);
        return (
          <div className="objective-row" key={objective.id}>
            <div className="objective-heading">
              <strong>目标 {String.fromCharCode(65 + index)}</strong>
              <span aria-live="polite">{statusLabels[objective.state]}</span>
              <b>{percentage}%</b>
            </div>
            <div
              className="objective-progress"
              role="progressbar"
              aria-label={`${objective.id} 占领进度`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={percentage}
            >
              <span style={{ width: `${percentage}%` }} />
            </div>
            <div className="objective-powers">
              <span>
                <Swords size={13} color={factionColors[objective.attackerFactionId]} />
                {factionNames[objective.attackerFactionId] ?? objective.attackerFactionId}
                <b>{objective.attackerPower}</b>
              </span>
              <span>
                <Shield size={13} color={factionColors[objective.defenderFactionId]} />
                {factionNames[objective.defenderFactionId] ?? objective.defenderFactionId}
                <b>{objective.defenderPower}</b>
              </span>
            </div>
          </div>
        );
      })}
    </section>
  );
}
