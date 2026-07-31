import { Activity, Plane, Radio, Route, ShieldAlert, ShieldCheck, Target, Truck } from "lucide-react";
import type {
  GroupInspection,
  PlatformFlightInspection,
  PlatformMovementType,
  PlatformInspection,
  RenderFrame,
} from "../sim/types";

interface InspectorProps {
  readonly inspection?: GroupInspection | PlatformInspection;
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
  "platform-combat-ineffective": "平台失去作战能力，正在撤离",
  "platform-abandoned": "平台失去机动与作战能力，乘员弃车",
  "no-active-members": "无可作战成员",
  "defend-objective": "守住分配的防御阵位",
  "advance-objective": "向防守目标推进",
  "assault-objective": "在交火中突击目标区",
  "capture-objective": "驻留目标区并完成占领",
  "vehicle-engagement-position": "前往车辆射击位置",
  "orient-armor": "调整车体正面朝向",
  ARTILLERY_HOLD_INDIRECT_RANGE: "保持间射距离并等待火力任务",
  "transport-rendezvous": "与配对运输平台会合",
  "transport-embarking": "整组搭载中",
  "transport-embarked": "已搭载，随平台机动",
  "transport-disembarking": "整组下车中",
  "transport-dismounted": "已完成下车",
  "transport-forced-dismount": "平台失效，被迫下车",
  "transport-trapped": "周边无合法容量，乘客受困",
  "transport-evacuated": "随运输平台撤离",
};

const transportStatusLabels: Readonly<Record<string, string>> = {
  pending: "等待双方部署",
  dismounted: "已下车",
  embarking: "搭载中",
  embarked: "已搭载",
  disembarking: "下车中",
  trapped: "受困",
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

const targetProfileLabels: Readonly<Record<string, string>> = {
  personnel: "人员",
  platform: "平台",
};

const vehicleEngagementReasonLabels: Readonly<Record<string, string>> = {
  "move-to-firing-position": "转移至有效射击位",
  "orient-armor": "以正面装甲对敌",
  "hold-firing-position": "保持当前射击位",
  "no-firing-position": "暂无合法射击位",
};

const transportDismountReasonLabels: Readonly<Record<string, string>> = {
  routing: "乘客组撤离",
  "platform-risk": "平台受损或能力下降",
  "direct-contact": "运输组发现直接威胁",
  "objective-proximity": "接近任务目标",
  forced: "平台失效强制下车",
};

const deploymentLabels: Readonly<Record<string, string>> = {
  packed: "行军状态",
  deploying: "展开中",
  deployed: "已展开",
  packing: "收炮中",
};

const missionSourceLabels: Readonly<Record<string, string>> = {
  "local-direct": "本组直接接触",
  "same-faction": "同势力情报",
  allied: "同盟情报",
};

const missionReasonLabels: Readonly<Record<string, string>> = {
  ARTILLERY_AIM_INDIRECT_MISSION: "正在瞄准间接火力任务",
  ARTILLERY_DEPLOY_FOR_MISSION: "正在为间接火力任务展开",
  ARTILLERY_DIRECT_SELF_DEFENSE: "当前直接接触触发自卫",
  ARTILLERY_MISSION_ASSIGNED: "已选择合法间接火力目标",
  ARTILLERY_MISSION_ACTIVE: "正在执行当前间接火力任务",
  ARTILLERY_HOLD_DANGER_CLOSE: "危险近界，禁止开火",
  ARTILLERY_HOLD_NO_LEGAL_CONTACT: "暂无合法间接火力情报",
  ARTILLERY_HOLD_NO_CONTACT: "暂无可用间接火力情报",
  ARTILLERY_HOLD_NO_WEAPON: "间射武器当前不可用",
  ARTILLERY_HOLD_NO_COMPATIBLE_TARGET: "没有武器适配的合法目标",
};

const altitudeBandLabels: Readonly<Record<PlatformFlightInspection["altitudeBand"], string>> = {
  low: "低空",
  medium: "中空",
  high: "高空",
};

function movementTypeLabel(movementType: PlatformMovementType): string {
  if (movementType === "hover") {
    return "悬停";
  }
  return movementType === "tracked" ? "履带" : "轮式";
}

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
  const activePlatforms = frame.platforms.filter(
    (platform) => platform.disposition === "crewed" && platform.mobility === "mobile",
  ).length;

  return (
    <>
      <div className="panel-heading">
        <span>战场态势</span>
        <strong>{active} 名下车成员 · {activePlatforms} 平台</strong>
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

function PlatformInspector({
  inspection,
  factionNames,
  factionColors,
}: {
  readonly inspection: PlatformInspection;
  readonly factionNames: Readonly<Record<string, string>>;
  readonly factionColors: Readonly<Record<string, string>>;
}) {
  const artillery = inspection.artillery;
  const damagedComponents = inspection.components.filter(
    (component) => component.integrityBps < 10_000,
  );
  const effectiveStations = inspection.stations.filter(
    (station) => station.status === "effective",
  ).length;

  return (
    <aside className="inspector-panel">
      <div className="panel-heading panel-heading--unit">
        <span>{factionNames[inspection.factionId] ?? inspection.factionId}</span>
        <strong>{inspection.id}</strong>
        <i style={{ backgroundColor: factionColors[inspection.factionId] }} />
      </div>

      <section className="inspector-section" data-testid="platform-inspection">
        <div className="section-title">
          {inspection.flight ? <Plane size={15} /> : <Truck size={15} />}
          <span>平台能力</span>
          <b>{movementTypeLabel(inspection.movementType)}</b>
        </div>
        <strong className="action-label">
          {inspection.disposition === "destroyed"
            ? "已摧毁"
            : inspection.disposition === "abandoned"
              ? "已废弃"
              : inspection.mobility === "mobile"
                ? "可机动"
                : "失去机动"}
          {inspection.combat === "effective" ? " · 武器有效" : " · 武器停用"}
        </strong>
        <p>
          网格 {inspection.cell.x}, {inspection.cell.z} · {effectiveStations}/{inspection.stations.length} 有效岗位
          {damagedComponents.length > 0 ? ` · ${damagedComponents.length} 个受损部件` : ""}
        </p>
      </section>

      {inspection.flight && (
        <section className="inspector-section" data-testid="flight-status">
          <div className="section-title">
            <Plane size={15} />
            <span>飞行状态</span>
            <b>{altitudeBandLabels[inspection.flight.altitudeBand]}</b>
          </div>
          <strong className="action-label">
            离地 {Math.round(inspection.flight.clearanceMm / 1_000)}m
          </strong>
          <p>当前高度层固定</p>
        </section>
      )}

      {artillery && (
        <section className="inspector-section" data-testid="artillery-status">
          <div className="section-title">
            <Target size={15} />
            <span>火炮状态</span>
            <b>{deploymentLabels[artillery.deployment] ?? artillery.deployment}</b>
          </div>
          <strong className="action-label">
            {artillery.deploymentTicksRemaining > 0
              ? `剩余 ${artillery.deploymentTicksRemaining} tick`
              : "部署动作稳定"}
          </strong>
          {artillery.mission ? (
            <div data-testid="artillery-mission">
              <p>
                目标 {artillery.mission.targetGroupId} · {missionSourceLabels[artillery.mission.source] ?? artillery.mission.source}
              </p>
              <p>
                情报 {artillery.mission.observedAt}/{artillery.mission.deliveredAt} tick · 可信度 {Math.round(artillery.mission.confidenceBps / 100)}%
              </p>
              <p>
                误差 {Math.round(artillery.mission.uncertaintyRadiusMm / 1_000)}m · 偏移 {artillery.mission.selectedOffset.dx},{artillery.mission.selectedOffset.dz} · 弹着格 {artillery.mission.plannedImpactCell.x},{artillery.mission.plannedImpactCell.z}
              </p>
              <p>瞄准剩余 {artillery.mission.aimTicksRemaining} tick</p>
            </div>
          ) : (
            <p>当前无火力任务</p>
          )}
        </section>
      )}

      {artillery?.evaluation && (
        <section className="inspector-section" data-testid="artillery-evaluation">
          <div className="section-title">
            <Radio size={15} />
            <span>任务评估</span>
            <b>{artillery.evaluation.candidates.length}</b>
          </div>
          <strong className="action-label">
            {missionReasonLabels[artillery.evaluation.reason] ?? artillery.evaluation.reason}
          </strong>
          {artillery.evaluation.candidates.slice(0, 3).map((candidate) => (
            <div className="contact-row" key={`${candidate.targetGroupId}:${candidate.source}`}>
              <Target size={14} />
              <span>
                {candidate.targetGroupId} · {missionSourceLabels[candidate.source] ?? candidate.source} · {candidate.ageTicks} tick
              </span>
              <strong>{candidate.rejectionReason ?? candidate.score}</strong>
            </div>
          ))}
        </section>
      )}

      <section className="inspector-section">
        <div className="section-title">
          <Activity size={15} />
          <span>武器与部件</span>
          <b>{inspection.weapons.length}</b>
        </div>
        {inspection.weapons.map((weapon) => (
          <div className="contact-row" key={weapon.componentId}>
            <Target size={14} />
            <span>{weapon.weaponTemplateId}</span>
            <strong>{weapon.available ? `${weapon.magazineRounds} 发` : weapon.reason}</strong>
          </div>
        ))}
        {damagedComponents.map((component) => (
          <div className="contact-row" key={component.id}>
            <ShieldAlert size={14} />
            <span>{component.id}</span>
            <strong>{Math.round(component.integrityBps / 100)}%</strong>
          </div>
        ))}
      </section>
    </aside>
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
  if (inspection?.kind === "platform") {
    return (
      <PlatformInspector
        inspection={inspection}
        factionNames={factionNames}
        factionColors={factionColors}
      />
    );
  }
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
            {inspection.modeEffective !== undefined && (
              <div className="metric-label metric-label--spaced" data-testid="mode-effectiveness">
                <span>模式有效战力</span>
                <strong>{inspection.modeEffective ? "有效" : "无效"}</strong>
              </div>
            )}
          </section>

          {inspection.targetEvaluation && (
            <section className="inspector-section" data-testid="target-evaluation">
              <div className="section-title">
                <Target size={15} />
                <span>目标效用</span>
                <b>{inspection.targetEvaluation.candidates.length}</b>
              </div>
              <strong className="action-label">
                {inspection.targetEvaluation.selectedTargetId ?? "暂无兼容目标"}
              </strong>
              {inspection.targetEvaluation.candidates.slice(0, 3).map((candidate) => (
                <div className="contact-row" key={candidate.targetGroupId}>
                  <Target size={14} />
                  <span>
                    {candidate.targetGroupId} · {targetProfileLabels[candidate.targetProfile] ?? candidate.targetProfile}
                  </span>
                  <strong>{candidate.compatible ? candidate.score : "不适配"}</strong>
                </div>
              ))}
            </section>
          )}

          {inspection.vehicleEngagement && (
            <section className="inspector-section" data-testid="vehicle-engagement">
              <div className="section-title">
                <Truck size={15} />
                <span>车辆交战位</span>
                <b>{inspection.vehicleEngagement.score} 分</b>
              </div>
              <strong className="action-label">
                {vehicleEngagementReasonLabels[inspection.vehicleEngagement.reason] ??
                  inspection.vehicleEngagement.reason}
              </strong>
              {inspection.vehicleEngagement.selectedCell && (
                <p>
                  网格 {inspection.vehicleEngagement.selectedCell.x}, {inspection.vehicleEngagement.selectedCell.z}
                  {inspection.vehicleEngagement.desiredFacing !== undefined
                    ? ` · 朝向 ${inspection.vehicleEngagement.desiredFacing}`
                    : ""}
                </p>
              )}
            </section>
          )}

          {inspection.platforms.length > 0 && (
            <section className="inspector-section" data-testid="platform-status">
              <div className="section-title">
                <Truck size={15} />
                <span>平台状态</span>
                <b>{inspection.platforms.length}</b>
              </div>
              {inspection.platforms.map((platform) => (
                <div className="contact-row" key={platform.id}>
                  {platform.flight ? <Plane size={14} /> : <Truck size={14} />}
                  <span>{platform.id}</span>
                  <strong>
                    {movementTypeLabel(platform.movementType)}
                    {platform.disposition === "destroyed"
                      ? "已摧毁"
                      : platform.disposition === "abandoned"
                        ? "已废弃"
                        : platform.mobility === "mobile"
                          ? "可机动"
                          : "失去机动"}
                    {platform.combat === "effective" ? ` · ${platform.crewCount} 乘员` : " · 武器停用"}
                    {platform.passengerGroupIds.length > 0
                      ? ` · ${platform.passengerGroupIds.length} 乘客组`
                      : ""}
                    {platform.damaged && platform.disposition === "crewed" ? " · 受损" : ""}
                    {platform.flight
                      ? ` · ${altitudeBandLabels[platform.flight.altitudeBand]} ${Math.round(platform.flight.clearanceMm / 1_000)}m`
                      : ""}
                  </strong>
                </div>
              ))}
            </section>
          )}

          {inspection.transport && (
            <section className="inspector-section" data-testid="transport-status">
              <div className="section-title">
                <Truck size={15} />
                <span>运输配对</span>
                <b>{transportStatusLabels[inspection.transport.status] ?? inspection.transport.status}</b>
              </div>
              <strong className="action-label">{inspection.transport.platformId}</strong>
              {(inspection.transport.status === "embarking" ||
                inspection.transport.status === "disembarking") && (
                <p>剩余 {inspection.transport.ticksRemaining} tick</p>
              )}
              {inspection.transport.dismountEvaluation && (
                <p data-testid="transport-dismount-evaluation">
                  {transportDismountReasonLabels[inspection.transport.dismountEvaluation.reason] ??
                    inspection.transport.dismountEvaluation.reason}
                  {inspection.transport.dismountEvaluation.selectedCell
                    ? ` · 下车格 ${inspection.transport.dismountEvaluation.selectedCell.x},${inspection.transport.dismountEvaluation.selectedCell.z}`
                    : " · 无合法下车格"}
                  {` · ${inspection.transport.dismountEvaluation.knownThreats.length} 个已知威胁`}
                </p>
              )}
            </section>
          )}

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
