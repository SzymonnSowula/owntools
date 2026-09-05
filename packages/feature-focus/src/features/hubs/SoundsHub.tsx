import { RecordsView } from "../sounds/RecordsView";
import { SoundsView } from "../sounds/SoundsView";
import { PianoView } from "../piano/PianoView";
import { HubTabs, useHubTab, type HubTabDef } from "./HubTabs";

type Tab = "records" | "mixer" | "piano";

const TABS: readonly HubTabDef<Tab>[] = [
  { id: "records", label: "Records" },
  { id: "mixer", label: "Mixer" },
  { id: "piano", label: "Piano" },
];

export function SoundsHub() {
  // The key changed with the tab set — an old "ambient" value would no longer
  // match anything and would silently fall back to the first tab anyway.
  const [tab, setTab] = useHubTab<Tab>("shipshape-hub-sounds-v2", ["records", "mixer", "piano"]);
  return (
    <>
      <HubTabs tabs={TABS} active={tab} onSelect={setTab} />
      {tab === "piano" ? <PianoView /> : tab === "mixer" ? <SoundsView /> : <RecordsView />}
    </>
  );
}
