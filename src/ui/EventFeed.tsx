import { Crosshair, Flag, PlaneLanding, Radio, ShieldAlert, Skull, Swords } from "lucide-react";
import type { BattleEvent } from "../sim/types";

interface EventFeedProps {
  readonly events: readonly BattleEvent[];
}

function describeEvent(event: BattleEvent): string | undefined {
  switch (event.type) {
    case "contact-spotted":
      return `${event.observerGroupId} 发现 ${event.targetGroupId}`;
    case "member-health-changed":
      if (event.to === "incapacitated") {
        return `${event.groupId} 有成员失去战斗能力`;
      }
      if (event.to === "dead") {
        return `${event.groupId} 出现阵亡`;
      }
      return undefined;
    case "crew-station-changed":
      if (event.phase === "started") {
        return `${event.groupId} 开始调整乘员岗位`;
      }
      if (event.phase === "completed") {
        return `${event.groupId} 完成乘员换岗`;
      }
      return `${event.groupId} 乘员换岗中断`;
    case "platform-state-changed":
      if (event.from.disposition !== event.to.disposition) {
        return event.to.disposition === "destroyed"
          ? `${event.groupId} 平台被摧毁`
          : `${event.groupId} 乘员弃车`;
      }
      if (event.from.mobility !== event.to.mobility) {
        return event.to.mobility === "mobile"
          ? `${event.groupId} 恢复机动`
          : `${event.groupId} 失去机动`;
      }
      if (event.from.combat !== event.to.combat) {
        return event.to.combat === "effective"
          ? `${event.groupId} 恢复平台武器`
          : `${event.groupId} 平台武器停用`;
      }
      return undefined;
    case "platform-flight-resolved":
      return event.outcome === "forced-landing"
        ? `${event.groupId} 完成迫降`
        : `${event.groupId} 坠毁`;
    case "platform-deployment-changed":
      if (event.phase === "cancelled") {
        const cancellationLabels: Readonly<Record<string, string>> = {
          "move-requested": "收到移动请求",
          "capability-lost": "展开能力失效",
          "platform-unavailable": "平台不可用",
        };
        return `${event.groupId} 展开动作中断${event.reason ? ` · ${cancellationLabels[event.reason] ?? event.reason}` : ""}`;
      }
      if (event.to === "deploying") {
        return `${event.groupId} 开始展开`;
      }
      if (event.to === "deployed") {
        return `${event.groupId} 完成展开`;
      }
      if (event.to === "packing") {
        return `${event.groupId} 开始收炮`;
      }
      return `${event.groupId} 完成收炮`;
    case "artillery-mission-changed":
      if (event.phase === "assigned") {
        return `自行火炮 ${event.groupId} 接收间接火力任务`;
      }
      if (event.phase === "released") {
        return `自行火炮 ${event.groupId} 发射炮弹`;
      }
      return `自行火炮 ${event.groupId} 取消间接火力任务`;
    case "projectile-impacted":
      return `自行火炮 ${event.sourceGroupId} 的炮弹在 ${event.impactCell.x},${event.impactCell.z} 弹着`;
    case "platform-component-changed":
      if (event.to.state === "destroyed") {
        return `${event.groupId} 的 ${event.componentId} 被摧毁`;
      }
      if (event.to.state === "disabled") {
        return `${event.groupId} 的 ${event.componentId} 失效`;
      }
      return event.penetrated ? `${event.groupId} 装甲被击穿` : undefined;
    case "embarkation-changed":
      if (event.phase === "cancelled") {
        return `${event.passengerGroupId} 上下车动作中断`;
      }
      if (event.action === "embark") {
        return event.phase === "started"
          ? `${event.passengerGroupId} 开始搭载`
          : `${event.passengerGroupId} 完成搭载`;
      }
      if (event.phase === "started") {
        return event.reason === "platform-destroyed"
          ? `${event.passengerGroupId} 受困于损毁平台`
          : `${event.passengerGroupId} 开始下车`;
      }
      return event.phase === "forced"
        ? `${event.passengerGroupId} 被迫下车`
        : `${event.passengerGroupId} 完成下车`;
    case "morale-changed":
      return event.to === "routing" ? `${event.groupId} 开始撤离` : undefined;
    case "reinforcement-triggered":
      return `${event.waveId} 增援已触发`;
    case "reinforcement-waiting":
      return `${event.waveId} 增援等待入口`;
    case "reinforcement-deployed":
      return `${event.waveId} 增援进入战场`;
    case "reinforcement-cancelled":
      return `${event.waveId} 增援已取消`;
    case "battle-ended":
      return event.winnerFactionIds.length > 0 ? "敌对行动结束" : "战斗陷入僵局";
    case "objective-state-changed": {
      const labels: Readonly<Record<string, string>> = {
        capturing: "进攻方开始占领目标",
        contested: "目标区进入争夺",
        recovering: "防守方正在恢复目标",
        "attacker-controlled": "目标已被进攻方占领",
        "defender-controlled": "防守方重新控制目标",
      };
      return labels[event.to] ?? "目标状态发生变化";
    }
    default:
      return undefined;
  }
}

function EventIcon({ event }: { readonly event: BattleEvent }) {
  if (event.type === "contact-spotted") return <Radio size={14} />;
  if (event.type === "platform-flight-resolved") return <PlaneLanding size={14} />;
  if (event.type === "artillery-mission-changed" || event.type === "projectile-impacted") {
    return <Crosshair size={14} />;
  }
  if (event.type === "member-health-changed" && event.to === "dead") return <Skull size={14} />;
  if (event.type === "morale-changed") return <ShieldAlert size={14} />;
  if (event.type === "objective-state-changed") return <Flag size={14} />;
  return <Swords size={14} />;
}

export function EventFeed({ events }: EventFeedProps) {
  const visible = events
    .map((event) => ({ event, label: describeEvent(event) }))
    .filter((item): item is { event: BattleEvent; label: string } => Boolean(item.label))
    .slice(-3)
    .reverse();

  return (
    <div className="event-feed" aria-live="polite">
      {visible.map(({ event, label }) => (
        <div className="event-line" key={`${event.tick}-${event.sequence}`}>
          <EventIcon event={event} />
          <span>{label}</span>
          <time>{Math.floor(event.tick / 20)}s</time>
        </div>
      ))}
    </div>
  );
}
