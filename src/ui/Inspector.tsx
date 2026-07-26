import { Activity, Radio, Route, ShieldAlert, ShieldCheck, Target } from "lucide-react";
import type { GroupInspection, RenderFrame } from "../sim/types";

interface InspectorProps {
  readonly inspection?: GroupInspection;
  readonly frame: RenderFrame;
  readonly factionNames: Readonly<Record<string, string>>;
  readonly factionColors: Readonly<Record<string, string>>;
  readonly showContacts?: boolean;
  readonly showPaths?: boolean;
}

const actionLabels: Readonly<Record<string, string>> = {
  searching: "搜索敌情",
  "moving-to-contact": "前往接触点",
  engaging: "交战",
  routing: "撤离",
  evacuated: "已撤离",
  "combat-ineffective": "失去战斗力",
};

const reasonLabels: Readonly<Record<string, string>> = {
  "search-sector": "搜索预定扇区",
  "direct-contact": "直接发现敌方",
  "shared-contact": "响应共享情报",
  "preferred-range": "保持有效射程",
  "seek-cover-high-suppression": "高压制下转移至掩体",
  "seek-cover-defense": "调整防守掩体",
  "avoid-threat-high-suppression": "无可用掩体，避开已知威胁",
  "clear-line-of-fire": "绕开友军射线",
  "low-morale": "士气低落，向出口撤离",
  "no-active-members": "无可作战成员",
  "defend-objective": "守住分配的防御阵位",
  "advance-objective": "向防守目标推进",
  "assault-objective": "在交火中突击目标区",
  "capture-objective": "驻留目标区并完成占领",
};

const coverReasonLabels: Readonly<Record<string, string>> = {
  "defend-objective-cover": "目标区防守选位",
  "seek-cover-high-suppression": "高压制换位",
  "seek-cover-defense": "根据已知威胁调整",
  "hold-cover": "保持当前掩体",
  "no-cover-available": "没有合法掩体槽位",
};

const coverKindLabels: Readonly<Record<string, string>> = {
  tree: "树木",
  rock: "岩石",
  wall: "墙体",
};

const threatSourceLabels: Readonly<Record<string, string>> = {
  "direct-contact": "直接接触",
  "local-contact": "本组最后已知",
  "shared-contact": "共享情报",
};

function currentCoverLabel(inspection: GroupInspection): string {
  const cover = inspection.currentCover;
  if (!cover) {
    return "未占用掩体";
  }
  const kind = coverKindLabels[cover.staticObjectKind] ?? cover.staticObjectKind;
  return `${kind} ${cover.coveredMembers}/${cover.capacity}`;
}

function coverEvaluationSummary(inspection: GroupInspection): string | undefined {
  const evaluation = inspection.coverEvaluation;
  if (!evaluation) {
    return undefined;
  }
  const reason = coverReasonLabels[evaluation.reason] ?? evaluation.reason;
  if (!evaluation.threat) {
    return reason;
  }
  const source = threatSourceLabels[evaluation.threat.source] ?? evaluation.threat.source;
  return `${reason} · ${source} ${evaluation.threat.lastKnown.x},${evaluation.threat.lastKnown.z}`;
}

function Meter({ value, tone }: { readonly value: number; readonly tone: "morale" | "suppression" }) {
  return (
    <div className={`metric-meter metric-meter--${tone}`}>
      <span style={{ width: `${Math.min(100, Math.max(0, value / 100))}%` }} />
    </div>
  );
}

function Overview({ frame }: { readonly frame: RenderFrame }) {
  const engaging = frame.groups.filter((group) => group.action === "engaging").length;
  const searching = frame.groups.filter((group) => group.action === "searching").length;
  const routing = frame.groups.filter((group) => group.action === "routing").length;
  const active = frame.members.filter(
    (member) =>
      member.presence === "deployed" &&
      (member.health === "healthy" || member.health === "wounded"),
  ).length;

  return (
    <>
      <div className="panel-heading">
        <span>战场态势</span>
        <strong>{active} 名有效成员</strong>
      </div>
      <div className="overview-grid">
        <div>
          <Target size={17} />
          <strong>{engaging}</strong>
          <span>交战编组</span>
        </div>
        <div>
          <Radio size={17} />
          <strong>{searching}</strong>
          <span>搜索编组</span>
        </div>
        <div>
          <ShieldAlert size={17} />
          <strong>{routing}</strong>
          <span>撤离编组</span>
        </div>
      </div>
    </>
  );
}

export function Inspector({
  inspection,
  frame,
  factionNames,
  factionColors,
  showContacts = true,
  showPaths = true,
}: InspectorProps) {
  const coverSummary = inspection ? coverEvaluationSummary(inspection) : undefined;
  return (
    <aside className={`inspector-panel ${inspection ? "" : "inspector-panel--overview"}`}>
      {!inspection ? (
        <Overview frame={frame} />
      ) : (
        <>
          <div className="panel-heading panel-heading--unit">
            <span>{factionNames[inspection.factionId] ?? inspection.factionId}</span>
            <strong>
              {inspection.id}
              {inspection.visibility === "known" && (
                <small className="inspection-visibility">已知接触</small>
              )}
            </strong>
            <i style={{ backgroundColor: factionColors[inspection.factionId] }} />
          </div>

          <section className="inspector-section">
            <div className="section-title">
              <Activity size={15} />
              <span>当前行动</span>
            </div>
            <strong className="action-label">{actionLabels[inspection.action] ?? inspection.action}</strong>
            <p>{reasonLabels[inspection.decisionReason] ?? inspection.decisionReason}</p>
          </section>

          {(inspection.currentCover || inspection.coverEvaluation) && (
            <section className="inspector-section">
              <div className="section-title">
                <ShieldCheck size={15} />
                <span>掩体评估</span>
                {inspection.coverEvaluation && <b>{inspection.coverEvaluation.score} 分</b>}
              </div>
              <strong className="action-label">{currentCoverLabel(inspection)}</strong>
              {coverSummary && <p>{coverSummary}</p>}
            </section>
          )}

          <section className="inspector-section">
            <div className="metric-label">
              <span>士气</span>
              <strong>{Math.round(inspection.moraleBps / 100)}%</strong>
            </div>
            <Meter value={inspection.moraleBps} tone="morale" />
            <div className="metric-label metric-label--spaced">
              <span>压制</span>
              <strong>{Math.round(inspection.suppressionBps / 100)}%</strong>
            </div>
            <Meter value={inspection.suppressionBps} tone="suppression" />
          </section>

          <section className="inspector-section">
            <div className="section-title">
              <ShieldAlert size={15} />
              <span>人员状态</span>
            </div>
            <dl className="casualty-grid">
              <div>
                <dt>有效</dt>
                <dd>{inspection.activeMembers}</dd>
              </div>
              <div>
                <dt>受伤</dt>
                <dd>{inspection.woundedMembers}</dd>
              </div>
              <div>
                <dt>失能</dt>
                <dd>{inspection.incapacitatedMembers}</dd>
              </div>
              <div>
                <dt>死亡</dt>
                <dd>{inspection.deadMembers}</dd>
              </div>
            </dl>
          </section>

          {showContacts && (
            <section className="inspector-section inspector-section--contacts">
              <div className="section-title">
                <Radio size={15} />
                <span>接触信息</span>
                <b>{inspection.contacts.length}</b>
              </div>
              {inspection.contacts.slice(0, 4).map((contact) => (
                <div className="contact-row" key={contact.targetGroupId}>
                  <Target size={14} />
                  <span>{contact.targetGroupId}</span>
                  <strong>{Math.round(contact.confidenceBps / 100)}%</strong>
                </div>
              ))}
              {inspection.contacts.length === 0 && <span className="empty-value">暂无有效接触</span>}
            </section>
          )}

          {showPaths && (
            <section className="inspector-section inspector-section--route">
              <Route size={15} />
              <span>
                网格 {inspection.cell.x}, {inspection.cell.z}
              </span>
              <strong>{inspection.path.length} 路径点</strong>
            </section>
          )}
        </>
      )}
    </aside>
  );
}
