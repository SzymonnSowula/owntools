import { StatsView } from "../stats/StatsView";
import { HeatmapView } from "../heatmap/HeatmapView";
import { HubTabs, useHubTab, type HubTabDef } from "./HubTabs";

type Tab = "overview" | "heatmap";

const TABS: readonly HubTabDef<Tab>[] = [
  { id: "overview", label: "Overview" },
  { id: "heatmap", label: "Heatmap" },
];

export function StatsHub() {
  const [tab, setTab] = useHubTab<Tab>("shipshape-hub-stats", ["overview", "heatmap"]);
  return (
    <>
      <HubTabs tabs={TABS} active={tab} onSelect={setTab} />
      {tab === "heatmap" ? <HeatmapView /> : <StatsView />}
    </>
  );
}
