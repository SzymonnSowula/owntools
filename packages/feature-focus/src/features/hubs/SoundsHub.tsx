import { SoundsView } from "../sounds/SoundsView";
import { PianoView } from "../piano/PianoView";
import { HubTabs, useHubTab, type HubTabDef } from "./HubTabs";

type Tab = "ambient" | "piano";

const TABS: readonly HubTabDef<Tab>[] = [
  { id: "ambient", label: "Ambient" },
  { id: "piano", label: "Piano" },
];

export function SoundsHub() {
  const [tab, setTab] = useHubTab<Tab>("shipshape-hub-sounds", ["ambient", "piano"]);
  return (
    <>
      <HubTabs tabs={TABS} active={tab} onSelect={setTab} />
      {tab === "piano" ? <PianoView /> : <SoundsView />}
    </>
  );
}
