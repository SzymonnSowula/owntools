import "./settings.css";
import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import {
  ArrowUpRight,
  Brain,
  FolderSync,
  HardDrive,
  KeyRound,
  LifeBuoy,
  LoaderCircle,
  Palette,
  Search,
  Settings2,
  ShieldCheck,
  Timer,
  Workflow,
  X,
} from "lucide-react";
import { OPEN_TOOL_EVENT } from "@core/handoff";
import { requestToolPage } from "@core/navigation";
import { ToolGlyph } from "@ui/ToolMark";
import {
  SETTINGS_CATEGORIES,
  SETTINGS_GROUP_LABEL,
  TOOL_SETTINGS,
  categoryFor,
  isCategory,
  searchSettings,
  type SettingsCategory,
  type SettingsCategoryId,
  type SettingsItem,
  type ToolWithSettings,
} from "./catalogue";
import { AboutPage } from "./pages/AboutPage";
import { AppearancePage } from "./pages/AppearancePage";
import { DataPage } from "./pages/DataPage";
import { FocusPage } from "./pages/FocusPage";
import { GeneralPage } from "./pages/GeneralPage";
import { LicensePage } from "./pages/LicensePage";
import { PrivacyPage } from "./pages/PrivacyPage";
import { StoragePage } from "./pages/StoragePage";
import { PageHead } from "./ui";

// Lazy: the model catalogue and the rules engine load when their page opens.
const IntelligenceCard = lazy(() => import("@feature-llm/IntelligenceCard"));
const AutomationsCard = lazy(() => import("@feature-automations/AutomationsCard"));

const ICONS: Record<SettingsCategoryId, ReactElement> = {
  general: <Settings2 />,
  appearance: <Palette />,
  license: <KeyRound />,
  focus: <Timer />,
  intelligence: <Brain />,
  automations: <Workflow />,
  data: <FolderSync />,
  storage: <HardDrive />,
  privacy: <ShieldCheck />,
  about: <LifeBuoy />,
};

/** Where Settings should open, and a stamp so the same place can be asked for twice. */
export interface SettingsTarget {
  section: string | null;
  at: number;
}

/** Survives leaving Settings and coming back within a session. */
let lastCategory: SettingsCategoryId = "general";

/**
 * Settings - its own screen, reached from the gear at the bottom of the tool
 * bar, Ctrl+, or any "open settings" link. A sidebar of categories and a
 * search box on the left; the page for one category on the right. Settings
 * that only mean something inside a tool (dictate's language, social's
 * approvals) stay in that tool and are listed at the bottom of the sidebar,
 * so there is one place to start looking either way.
 */
export function SettingsView({ target }: { target?: SettingsTarget | null }) {
  const [category, setCategory] = useState<SettingsCategoryId>(() => categoryFor(target?.section) ?? lastCategory);
  const [query, setQuery] = useState("");
  /** Bumped for every "take me to this setting", including one on the page already open. */
  const [scrollKey, setScrollKey] = useState(0);
  const mainRef = useRef<HTMLElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const pendingScroll = useRef<string | null>(null);

  const results = useMemo(() => searchSettings(query), [query]);
  const current = SETTINGS_CATEGORIES.find((c) => c.id === category) ?? SETTINGS_CATEGORIES[0];

  function go(next: SettingsCategoryId, section?: string) {
    lastCategory = next;
    setCategory(next);
    if (section && section !== next) {
      pendingScroll.current = section;
      setScrollKey((k) => k + 1);
    } else {
      pendingScroll.current = null;
      mainRef.current?.scrollTo({ top: 0 });
    }
  }

  // A link from somewhere else in the app: open that category, then scroll.
  useEffect(() => {
    if (!target) return;
    const next = categoryFor(target.section);
    if (next) go(next, target.section ?? undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target?.at]);

  // Scroll to the asked-for setting once its page has rendered (lazy cards
  // take a moment, so it keeps looking for about a second) and flash it.
  useEffect(() => {
    const section = pendingScroll.current;
    if (!section) return;
    let tries = 0;
    const timer = window.setInterval(() => {
      const el = mainRef.current?.querySelector<HTMLElement>(`[data-settings-section="${section}"]`);
      tries += 1;
      if (!el && tries < 20) return;
      window.clearInterval(timer);
      pendingScroll.current = null;
      if (!el) return;
      el.scrollIntoView({ block: "start", behavior: "smooth" });
      el.classList.remove("st-flash");
      void el.offsetWidth; // restarts the animation when the same row is asked for twice
      el.classList.add("st-flash");
    }, 60);
    return () => window.clearInterval(timer);
  }, [scrollKey]);

  // "/" jumps to the search box, like in most settings screens.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
      if (e.key === "/" && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function openResult(item: SettingsItem) {
    setQuery("");
    if (isCategory(item.where)) go(item.where, item.id);
    else openToolSettings(item.where);
  }

  const groups = (["app", "work", "data", "help"] as const).map((group) => ({
    group,
    label: SETTINGS_GROUP_LABEL[group],
    items: SETTINGS_CATEGORIES.filter((c) => c.group === group),
  }));

  return (
    <div className="st">
      <aside className="st-side">
        <div className="st-side-brand">
          <span className="st-side-icon" aria-hidden>
            <Settings2 />
          </span>
          <div className="st-side-name">settings</div>
        </div>

        <label className="st-search">
          <Search aria-hidden />
          <input
            ref={searchRef}
            className="st-search-input"
            placeholder="Search settings"
            value={query}
            spellCheck={false}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setQuery("");
              if (e.key === "Enter" && results[0]) openResult(results[0]);
            }}
          />
          {query ? (
            <button type="button" className="st-search-clear" aria-label="Clear search" onClick={() => setQuery("")}>
              <X />
            </button>
          ) : (
            <kbd className="st-search-kbd" aria-hidden>
              /
            </kbd>
          )}
        </label>

        {query ? (
          <SearchResults results={results} onOpen={openResult} />
        ) : (
          <nav className="st-nav" aria-label="Settings">
            {groups.map(({ group, label, items }) => (
              <div key={group} className="st-nav-group">
                {label ? <div className="st-nav-label">{label}</div> : null}
                {items.map((c) => (
                  <NavItem key={c.id} category={c} active={c.id === category} onClick={() => go(c.id)} />
                ))}
              </div>
            ))}

            <div className="st-nav-group">
              <div className="st-nav-label">inside the tools</div>
              {TOOL_SETTINGS.map((link) => (
                <button
                  key={link.tool}
                  type="button"
                  className="st-nav-item tool"
                  title={`${link.label} settings: ${link.blurb}`}
                  onClick={() => openToolSettings(link.tool)}
                >
                  <ToolGlyph tool={link.tool} size={16} />
                  <span>{link.label}</span>
                  <ArrowUpRight className="st-nav-out" aria-hidden />
                </button>
              ))}
            </div>
          </nav>
        )}
      </aside>

      <main className="st-main" ref={mainRef}>
        <div className="st-page" key={current.id}>
          <PageHead title={current.label.toLowerCase()} sub={current.blurb} />
          <Page id={current.id} />
        </div>
      </main>
    </div>
  );
}

function NavItem({ category, active, onClick }: { category: SettingsCategory; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      className={`st-nav-item${active ? " active" : ""}`}
      aria-current={active ? "page" : undefined}
      onClick={onClick}
    >
      {ICONS[category.id]}
      <span>{category.label}</span>
    </button>
  );
}

function SearchResults({ results, onOpen }: { results: SettingsItem[]; onOpen: (item: SettingsItem) => void }) {
  if (results.length === 0) {
    return <p className="st-nav-empty">Nothing matches. Try a word like “tray”, “theme” or “model”.</p>;
  }
  return (
    <div className="st-results" role="list">
      {results.map((item) => {
        const where = isCategory(item.where)
          ? SETTINGS_CATEGORIES.find((c) => c.id === item.where)?.label
          : `in ${item.where}`;
        return (
          <button key={item.id} type="button" role="listitem" className="st-result" onClick={() => onOpen(item)}>
            <span className="st-result-label">{item.label}</span>
            <span className="st-result-where">
              {where}
              {isCategory(item.where) ? null : <ArrowUpRight aria-hidden />}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function Page({ id }: { id: SettingsCategoryId }) {
  switch (id) {
    case "general":
      return <GeneralPage />;
    case "appearance":
      return <AppearancePage />;
    case "license":
      return <LicensePage />;
    case "focus":
      return <FocusPage />;
    case "intelligence":
      return (
        <Suspense fallback={<Loading />}>
          <IntelligenceCard />
        </Suspense>
      );
    case "automations":
      return (
        <Suspense fallback={<Loading />}>
          <AutomationsCard />
        </Suspense>
      );
    case "data":
      return <DataPage />;
    case "storage":
      return <StoragePage />;
    case "privacy":
      return <PrivacyPage />;
    case "about":
      return <AboutPage />;
  }
}

function Loading() {
  return (
    <div className="st-loading">
      <LoaderCircle aria-hidden />
      Loading…
    </div>
  );
}

/**
 * Leaves Settings for a tool's own settings page. Dictate, meet and capture
 * read the request as they mount; social keeps its page in a store, so it is
 * set directly (loaded on demand, since it is a big chunk).
 */
function openToolSettings(tool: ToolWithSettings) {
  const switchTool = () => window.dispatchEvent(new CustomEvent(OPEN_TOOL_EVENT, { detail: { tool } }));
  if (tool === "social") {
    void import("@feature-social/ui")
      .then((m) => m.useUi.getState().setPage("settings"))
      .catch(() => undefined)
      .finally(switchTool);
    return;
  }
  requestToolPage(tool, "settings");
  switchTool();
}
