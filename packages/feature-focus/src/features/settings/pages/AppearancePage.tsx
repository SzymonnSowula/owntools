import { THEMES } from "../../../lib/themes";
import { useAppStore } from "../../../store/useAppStore";
import { Card } from "../ui";

export function AppearancePage() {
  const theme = useAppStore((s) => s.settings.theme);
  const setTheme = useAppStore((s) => s.setTheme);

  return (
    <Card id="theme" title="Theme" desc="Also in the palette menu at the top of the window." flush={false}>
      <div className="theme-grid" role="radiogroup" aria-label="Theme">
        {THEMES.map((t) => (
          <button
            key={t.id}
            type="button"
            role="radio"
            className={`theme-card${theme === t.id ? " active" : ""}`}
            aria-checked={theme === t.id}
            onClick={() => setTheme(t.id)}
          >
            <span className="theme-swatch" aria-hidden>
              {t.swatch.map((c, i) => (
                <span key={i} style={{ background: c }} />
              ))}
            </span>
            <span className="theme-card-name">{t.label}</span>
            <span className="theme-card-hint">{t.hint}</span>
          </button>
        ))}
      </div>
    </Card>
  );
}
