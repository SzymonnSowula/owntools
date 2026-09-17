import { createElement } from "react";
import { createRoot } from "react-dom/client";
import IntelligenceCard from "./IntelligenceCard";

/**
 * Browser-preview helper, never imported by the app: mounts the card into an
 * element of the running page so it can be looked at inside the real focus
 * Settings layout before the integrator wires `<IntelligenceCard />` into
 * SettingsView. Imported from devtools through Vite's `/@fs/` so React
 * resolves to the same optimized dependency the page already runs:
 *
 *   const { mountIntelligenceCard } = await import(
 *     "/@fs/<path to the checkout>/packages/feature-llm/src/devMount.ts");
 *   mountIntelligenceCard(document.querySelector(".mod-focus .stack"));
 */
export function mountIntelligenceCard(into: Element | null, before?: Element | null): () => void {
  if (!into) throw new Error("mountIntelligenceCard: no container");
  const host = document.createElement("div");
  host.className = "llm-dev-host";
  host.style.display = "contents";
  if (before && before.parentElement === into) into.insertBefore(host, before);
  else into.appendChild(host);
  const root = createRoot(host);
  root.render(createElement(IntelligenceCard));
  return () => {
    root.unmount();
    host.remove();
  };
}
