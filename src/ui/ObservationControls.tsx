import { Eye, MapPinned, Radio, Route, Target } from "lucide-react";
import type { ReactNode } from "react";
import type { FactionSetup } from "../sim/types";

export interface ObservationLayers {
  readonly objectives: boolean;
  readonly contacts: boolean;
  readonly paths: boolean;
}

interface ObservationControlsProps {
  readonly factions: readonly FactionSetup[];
  readonly observerFactionId?: string;
  readonly layers: ObservationLayers;
  readonly onObserverChange: (factionId?: string) => void;
  readonly onLayerChange: (layer: keyof ObservationLayers, visible: boolean) => void;
}

export function ObservationControls({
  factions,
  observerFactionId,
  layers,
  onObserverChange,
  onLayerChange,
}: ObservationControlsProps) {
  return (
    <aside className="observation-panel" aria-label="观察视角与信息图层">
      <div className="observation-heading">
        <Eye size={15} />
        <span>观察视角</span>
      </div>
      <label className="observation-select-label">
        <MapPinned size={14} />
        <select
          aria-label="观察视角"
          value={observerFactionId ?? "omniscient"}
          onChange={(event) =>
            onObserverChange(
              event.target.value === "omniscient" ? undefined : event.target.value,
            )
          }
        >
          <option value="omniscient">全知演算</option>
          {factions.map((faction) => (
            <option value={faction.id} key={faction.id}>
              {faction.displayName}视角
            </option>
          ))}
        </select>
      </label>
      <div className="observation-layers" aria-label="信息图层">
        <LayerToggle
          icon={<Target size={14} />}
          label="目标"
          checked={layers.objectives}
          onChange={(checked) => onLayerChange("objectives", checked)}
        />
        <LayerToggle
          icon={<Radio size={14} />}
          label="接触"
          checked={layers.contacts}
          onChange={(checked) => onLayerChange("contacts", checked)}
        />
        <LayerToggle
          icon={<Route size={14} />}
          label="路径"
          checked={layers.paths}
          onChange={(checked) => onLayerChange("paths", checked)}
        />
      </div>
    </aside>
  );
}

function LayerToggle({
  icon,
  label,
  checked,
  onChange,
}: {
  readonly icon: ReactNode;
  readonly label: string;
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
}) {
  return (
    <label className="observation-toggle">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="observation-toggle__icon">{icon}</span>
      <span>{label}</span>
    </label>
  );
}
