import { TasksView } from "../tasks/TasksView";
import { PlannerView } from "../planner/PlannerView";
import { HubTabs, useHubTab, type HubTabDef } from "./HubTabs";

type Tab = "lists" | "plan";

const TABS: readonly HubTabDef<Tab>[] = [
  { id: "lists", label: "Lists" },
  { id: "plan", label: "Day plan" },
];

export function TasksHub() {
  const [tab, setTab] = useHubTab<Tab>("owntools-hub-tasks", ["lists", "plan"]);
  return (
    <>
      <HubTabs tabs={TABS} active={tab} onSelect={setTab} />
      {tab === "plan" ? <PlannerView /> : <TasksView />}
    </>
  );
}
