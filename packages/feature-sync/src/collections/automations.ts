import { emitSyncApplied, onSyncTouch } from "../events";
import { bytesOf, combine, isRecord, poll, type AdapterContext, type ItemsAdapter } from "./adapter";

/**
 * Automation rules from `<AppData>/automations/rules.json`, one item per rule
 * by `id`, fields as they are. The file's envelope is not this package's to
 * define, so it is read leniently — a bare array, `{ rules: [...] }` or
 * `{ items: [...] }` — and written back in the shape it was found, other
 * top-level fields untouched. Folder paths inside a rule may not exist on the
 * other device; the rule still travels and automations shows "folder not found".
 */

export const RULES_FILE = "automations/rules.json";

export type Rule = Record<string, unknown> & { id: string };

interface Envelope {
  /** Key holding the list, or null for a bare array. */
  key: string | null;
  rest: Record<string, unknown>;
}

const DEFAULT_ENVELOPE: Envelope = { key: "rules", rest: { version: 1 } };

function isRule(v: unknown): v is Rule {
  return isRecord(v) && typeof v.id === "string" && v.id.length > 0;
}

export function parseRules(text: string | null): { rules: Rule[]; envelope: Envelope } {
  if (!text) return { rules: [], envelope: DEFAULT_ENVELOPE };
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { rules: [], envelope: DEFAULT_ENVELOPE };
  }
  if (Array.isArray(data)) return { rules: data.filter(isRule), envelope: { key: null, rest: {} } };
  if (isRecord(data)) {
    for (const key of ["rules", "items"]) {
      if (Array.isArray(data[key])) {
        const { [key]: _list, ...rest } = data;
        return { rules: (data[key] as unknown[]).filter(isRule), envelope: { key, rest } };
      }
    }
    return { rules: [], envelope: { key: "rules", rest: data } };
  }
  return { rules: [], envelope: DEFAULT_ENVELOPE };
}

export function serializeRules(rules: Rule[], envelope: Envelope): string {
  if (envelope.key === null) return JSON.stringify(rules, null, 2);
  return JSON.stringify({ ...envelope.rest, [envelope.key]: rules }, null, 2);
}

async function readFile(ctx: AdapterContext) {
  return parseRules(await ctx.backend.appReadText(RULES_FILE));
}

export const automationsAdapter: ItemsAdapter<Rule> = {
  kind: "items",
  id: "automations-rules",
  label: "Automation rules",
  detail: "rules as they are; a folder a rule watches may not exist on the other device",
  async read(ctx) {
    const { rules } = await readFile(ctx);
    return { items: rules.map((r) => ({ id: r.id, value: r })), bytes: bytesOf(rules) };
  },
  async apply(ctx, merged, changed, removed) {
    const { rules, envelope } = await readFile(ctx);
    const byId = new Map(merged.items.map((i) => [i.id, i.value] as const));
    const gone = new Set(removed);
    // Local order for what stays, new rules appended in merged (id) order.
    const kept = rules.filter((r) => !gone.has(r.id)).map((r) => (byId.has(r.id) ? (byId.get(r.id) as Rule) : r));
    const seen = new Set(kept.map((r) => r.id));
    for (const item of merged.items) if (!seen.has(item.id) && isRule(item.value)) kept.push(item.value);
    await ctx.backend.appWriteText(RULES_FILE, serializeRules(kept, envelope));
    emitSyncApplied({ collection: "automations-rules", ids: changed, removed });
  },
  subscribe(cb) {
    return combine(
      poll(30_000, () => import("../api").then(({ getSyncBackend }) => getSyncBackend().appReadText(RULES_FILE).then((t) => t ?? "")), cb),
      onSyncTouch("automations-rules", cb),
    );
  },
};
