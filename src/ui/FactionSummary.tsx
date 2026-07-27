import type { FactionSetup, RenderFrame } from "../sim/types";

interface FactionSummaryProps {
  readonly factions: readonly FactionSetup[];
  readonly frame: RenderFrame;
}

export function FactionSummary({ factions, frame }: FactionSummaryProps) {
  return (
    <section
      className="faction-summary"
      data-faction-count={factions.length}
      aria-label="势力状态"
    >
      {factions.map((faction) => {
        const members = frame.members.filter((member) => member.factionId === faction.id);
        const ready = members.filter(
          (member) =>
            member.presence === "deployed" &&
            (member.health === "healthy" || member.health === "wounded"),
        ).length;
        const losses = members.filter(
          (member) => member.health === "dead" || member.health === "incapacitated",
        ).length;
        const platforms = frame.platforms.filter(
          (platform) => platform.factionId === faction.id,
        );
        const readyPlatforms = platforms.filter(
          (platform) => platform.disposition === "crewed" && platform.mobility === "mobile",
        ).length;
        const effective = ready + readyPlatforms;
        const total = Math.max(1, members.length + platforms.length);
        const routing = frame.groups.filter(
          (group) => group.factionId === faction.id && group.action === "routing",
        ).length;

        return (
          <div className="faction-row" key={faction.id}>
            <span className="faction-swatch" style={{ backgroundColor: faction.color }} />
            <div className="faction-main">
              <div className="faction-label">
                <strong>{faction.displayName}</strong>
                <span>{effective} 有效单位</span>
              </div>
              <div className="strength-track" aria-hidden="true">
                <span
                  style={{
                    width: `${(effective / total) * 100}%`,
                    backgroundColor: faction.color,
                  }}
                />
              </div>
              <div className="faction-meta">
                <span>{losses} 伤亡</span>
                <span>{readyPlatforms} 可机动平台</span>
                <span>{routing} 溃散编组</span>
              </div>
            </div>
          </div>
        );
      })}
    </section>
  );
}
