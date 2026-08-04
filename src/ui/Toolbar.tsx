import {
  Clapperboard,
  Crosshair,
  Eye,
  EyeOff,
  Gauge,
  LocateFixed,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  Shield,
  SlidersHorizontal,
  Swords,
} from "lucide-react";
import type { CameraMode } from "../render/Battlefield";
import type { RenderQuality } from "../render/quality";

interface ToolbarProps {
  readonly battleMode: "conflict" | "defense";
  readonly paused: boolean;
  readonly finished: boolean;
  readonly cleanView: boolean;
  readonly cameraMode: CameraMode;
  readonly tick: number;
  readonly statusLabel: string;
  readonly seed: string;
  readonly quality: RenderQuality;
  readonly performanceToolsAvailable: boolean;
  readonly performancePanelOpen: boolean;
  readonly onTogglePause: () => void;
  readonly onBattleModeChange: (mode: "conflict" | "defense") => void;
  readonly onRestart: () => void;
  readonly onResetCamera: () => void;
  readonly onToggleCleanView: () => void;
  readonly onCameraModeChange: (mode: CameraMode) => void;
  readonly onQualityChange: (quality: RenderQuality) => void;
  readonly onTogglePerformancePanel: () => void;
}

function formatBattleTime(tick: number): string {
  const seconds = Math.floor(tick / 20);
  const minutes = Math.floor(seconds / 60);
  return `${minutes.toString().padStart(2, "0")}:${(seconds % 60)
    .toString()
    .padStart(2, "0")}`;
}

export function Toolbar({
  battleMode,
  paused,
  finished,
  cleanView,
  cameraMode,
  tick,
  statusLabel,
  seed,
  quality,
  performanceToolsAvailable,
  performancePanelOpen,
  onTogglePause,
  onBattleModeChange,
  onRestart,
  onResetCamera,
  onToggleCleanView,
  onCameraModeChange,
  onQualityChange,
  onTogglePerformancePanel,
}: ToolbarProps) {
  return (
    <header className={`toolbar ${cleanView ? "toolbar--clean" : ""}`}>
      {!cleanView && (
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">
            <Crosshair size={18} strokeWidth={1.8} />
          </span>
          <div>
            <h1>拓世纪</h1>
            <span>{battleMode === "defense" ? "防守演算" : "冲突演算"} / {seed}</span>
          </div>
        </div>
      )}

      <div className="battle-clock" aria-label={`战斗时间 ${formatBattleTime(tick)}`}>
        <span className={`status-dot ${paused || finished ? "status-dot--idle" : ""}`} />
        <strong>{formatBattleTime(tick)}</strong>
        <span>{statusLabel}</span>
      </div>

      <nav className="toolbar-actions" aria-label="战场控制">
        <button
          className="icon-button icon-button--primary"
          type="button"
          title={paused ? "继续演算" : "暂停演算"}
          aria-label={paused ? "继续演算" : "暂停演算"}
          disabled={finished}
          onClick={onTogglePause}
        >
          {paused ? <Play size={18} fill="currentColor" /> : <Pause size={18} fill="currentColor" />}
        </button>

        {!cleanView && (
          <>
            <button
              className="icon-button"
              type="button"
              title="生成新战斗"
              aria-label="生成新战斗"
              onClick={onRestart}
            >
              <RefreshCw size={17} />
            </button>
            <span className="toolbar-separator" />
            <div className="segmented-icons mode-switch" aria-label="战斗模式">
              <button
                className={battleMode === "conflict" ? "is-active" : ""}
                type="button"
                title="冲突模式"
                aria-label="冲突模式"
                onClick={() => onBattleModeChange("conflict")}
              >
                <Swords size={17} />
                <span>冲突</span>
              </button>
              <button
                className={battleMode === "defense" ? "is-active" : ""}
                type="button"
                title="防守模式"
                aria-label="防守模式"
                onClick={() => onBattleModeChange("defense")}
              >
                <Shield size={17} />
                <span>防守</span>
              </button>
            </div>
            <span className="toolbar-separator" />
            <div className="segmented-icons" aria-label="镜头模式">
              <button
                className={cameraMode === "free" ? "is-active" : ""}
                type="button"
                title="自由镜头"
                aria-label="自由镜头"
                onClick={() => onCameraModeChange("free")}
              >
                <LocateFixed size={17} />
              </button>
              <button
                className={cameraMode === "follow" ? "is-active" : ""}
                type="button"
                title="跟随选中编组"
                aria-label="跟随选中编组"
                onClick={() => onCameraModeChange("follow")}
              >
                <Crosshair size={17} />
              </button>
              <button
                className={cameraMode === "director" ? "is-active" : ""}
                type="button"
                title="自动导演"
                aria-label="自动导演"
                onClick={() => onCameraModeChange("director")}
              >
                <Clapperboard size={17} />
              </button>
            </div>
            <button
              className="icon-button"
              type="button"
              title="复位镜头"
              aria-label="复位镜头"
              onClick={onResetCamera}
            >
              <RotateCcw size={17} />
            </button>
            <label className="quality-select">
              <SlidersHorizontal size={15} aria-hidden="true" />
              <select
                aria-label="画质"
                value={quality}
                onChange={(event) => onQualityChange(event.target.value as RenderQuality)}
              >
                <option value="low">低</option>
                <option value="medium">中</option>
                <option value="high">高</option>
              </select>
            </label>
            {performanceToolsAvailable && (
              <button
                className={`icon-button ${performancePanelOpen ? "is-active" : ""}`}
                type="button"
                title={performancePanelOpen ? "隐藏性能诊断" : "显示性能诊断"}
                aria-label={performancePanelOpen ? "隐藏性能诊断" : "显示性能诊断"}
                aria-pressed={performancePanelOpen}
                onClick={onTogglePerformancePanel}
              >
                <Gauge size={17} />
              </button>
            )}
          </>
        )}

        <button
          className="icon-button"
          type="button"
          title={cleanView ? "显示战术界面" : "隐藏战术界面"}
          aria-label={cleanView ? "显示战术界面" : "隐藏战术界面"}
          onClick={onToggleCleanView}
        >
          {cleanView ? <Eye size={17} /> : <EyeOff size={17} />}
        </button>
      </nav>
    </header>
  );
}
