import type { ReactNode } from "react";
import { PRICING_URL } from "@core/branding";
import { isTauri } from "@core/env";
import { openSettings } from "@core/navigation";
import { PRO_INCLUDES, PRO_PITCH, type ProTool } from "@licensing/plan";
import { useIsPro } from "@licensing/useLicense";
import { ToolMark } from "./ToolMark";

/**
 * A Pro tool without a key shows this instead of itself: the tool's mark, one
 * sentence on what it does, what the key buys, and two ways forward. The
 * tool's own view is not mounted at all, so nothing in it runs for free.
 * Activating a key in Settings → License re-renders straight into the tool.
 */
export function ProGate({ tool, children }: { tool: ProTool; children: ReactNode }) {
  const pro = useIsPro();
  if (pro) return <>{children}</>;
  return <ProLock tool={tool} />;
}

async function openExternal(url: string): Promise<void> {
  if (isTauri()) {
    try {
      const { openUrl } = await import("@tauri-apps/plugin-opener");
      await openUrl(url);
      return;
    } catch {
      /* fall through to window.open */
    }
  }
  window.open(url, "_blank", "noopener,noreferrer");
}

export function ProLock({ tool }: { tool: ProTool }) {
  return (
    <div className="pro-gate" data-tool={tool}>
      <div className="pro-gate-card">
        <div className="pro-gate-mark">
          <ToolMark tool={tool} size={64} />
        </div>
        <p className="pro-gate-kicker">owntools pro</p>
        <h2 className="pro-gate-title">{tool} comes with Pro</h2>
        <p className="pro-gate-text">{PRO_PITCH[tool]}</p>
        <ul className="pro-gate-list">
          {PRO_INCLUDES.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        <div className="pro-gate-actions">
          <button type="button" className="pro-gate-btn primary" onClick={() => void openExternal(PRICING_URL)}>
            Get Pro
          </button>
          <button type="button" className="pro-gate-btn" onClick={() => openSettings("license")}>
            I have a key
          </button>
        </div>
        <p className="pro-gate-foot">One key, one computer at a time. The free tools stay free.</p>
      </div>
    </div>
  );
}
