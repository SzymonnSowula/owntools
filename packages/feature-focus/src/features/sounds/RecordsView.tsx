import { RECORDS, recordById } from "../../lib/audio/engine";
import { useAppStore } from "../../store/useAppStore";
import { SleeveArtwork } from "./Sleeve";

/**
 * The crate. Pick a sleeve, the needle drops, and the record plays for as long
 * as you leave it on — every bar is generated, so there is no loop to notice
 * and no track to end.
 */
export function RecordsView() {
  const record = useAppStore((s) => s.record);
  const play = useAppStore((s) => s.playRecord);
  const stop = useAppStore((s) => s.stopRecord);
  const setVolume = useAppStore((s) => s.setRecordVolume);
  const current = recordById(record.id);
  const spinning = record.playing && Boolean(current);

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <p className="kicker">Background</p>
          <h1 className="page-title">Records</h1>
        </div>
      </header>

      <section className={`turntable${spinning ? " is-playing" : ""}`}>
        <div className="deck">
          <div className="platter">
            <div className="platter-disc" style={{ animationPlayState: spinning ? "running" : "paused" }}>
              <div className="platter-label">
                {current ? (
                  <SleeveArtwork art={current.art} title={current.title} side={current.side} label />
                ) : null}
              </div>
            </div>
            <div className="spindle" />
          </div>
          <div className="tonearm">
            <div className="tonearm-pivot" />
            <div className="tonearm-rod" />
          </div>
        </div>

        <div className="deck-info">
          {current ? (
            <>
              <p className="kicker">
                {current.side} · {current.artist}
              </p>
              <h2 className="deck-title">{current.title.toLowerCase()}</h2>
              <p className="muted deck-blurb">{current.blurb}</p>
              <div className="deck-controls">
                <button
                  className={`btn ${record.playing ? "" : "primary"}`}
                  onClick={() => (record.playing ? stop() : play(current.id))}
                >
                  {record.playing ? "Lift the needle" : "Drop the needle"}
                </button>
                <label className="deck-volume">
                  <span className="faint">Level</span>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.01}
                    value={record.volume}
                    onChange={(e) => setVolume(Number(e.target.value))}
                  />
                </label>
              </div>
            </>
          ) : (
            <>
              <p className="kicker">Nothing on the platter</p>
              <h2 className="deck-title">pick a record</h2>
              <p className="muted deck-blurb">
                Eight pressings, each one generated live on this device — no files, no streaming,
                and no track that ever runs out.
              </p>
            </>
          )}
        </div>
      </section>

      <div className="crate">
        {RECORDS.map((r) => {
          const isCurrent = record.id === r.id;
          const isPlaying = isCurrent && record.playing;
          return (
            <button
              key={r.id}
              className={`sleeve${isCurrent ? " is-current" : ""}${isPlaying ? " is-playing" : ""}`}
              onClick={() => play(r.id)}
              title={r.blurb}
            >
              <span className="sleeve-vinyl" aria-hidden="true" />
              <span className="sleeve-jacket">
                <SleeveArtwork art={r.art} title={r.title} side={r.side} />
              </span>
              <span className="sleeve-meta">
                <span className="sleeve-title">{r.title}</span>
                <span className="faint">{isPlaying ? "playing" : r.side}</span>
              </span>
            </button>
          );
        })}
      </div>

      <p className="muted" style={{ marginTop: 16, maxWidth: "56ch" }}>
        A record is a recipe — a chord cycle, a voice, a noise bed and how worn the pressing is.
        The crackle, hiss and pitch wobble are part of the signal chain, not a sample looping
        underneath.
      </p>
    </div>
  );
}
