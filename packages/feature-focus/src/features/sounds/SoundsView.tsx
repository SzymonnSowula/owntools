import { NOISE_LAYERS } from "../../types";
import { useAppStore } from "../../store/useAppStore";

export function SoundsView() {
  const sounds = useAppStore((s) => s.sounds);
  const setPlaying = useAppStore((s) => s.setSoundPlaying);
  const setMaster = useAppStore((s) => s.setMasterVolume);
  const setLayer = useAppStore((s) => s.setLayerVolume);

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <p className="kicker">Tło</p>
          <h1 className="page-title">Dźwięki</h1>
        </div>
        <div className="page-actions">
          <button className="btn primary" onClick={() => setPlaying(!sounds.playing)}>
            {sounds.playing ? "Zatrzymaj" : "Odtwarzaj"}
          </button>
        </div>
      </header>

      <section className="card">
        <div className="mixer-row">
          <span>Głośność</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={sounds.master}
            onChange={(e) => setMaster(Number(e.target.value))}
          />
          <span className="faint">{Math.round(sounds.master * 100)}</span>
        </div>
        {NOISE_LAYERS.map((layer) => (
          <div className="mixer-row" key={layer.id}>
            <span>{layer.label}</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={sounds.layers[layer.id]}
              onChange={(e) => setLayer(layer.id, Number(e.target.value))}
            />
            <span className="faint">{Math.round(sounds.layers[layer.id] * 100)}</span>
          </div>
        ))}
      </section>
      <p className="muted" style={{ marginTop: 16, maxWidth: "52ch" }}>
        Szum jest liczony na bieżąco — bez sampli i bez sieci. Mikser działa razem z timerem, także w tle.
      </p>
    </div>
  );
}
