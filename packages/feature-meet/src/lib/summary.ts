import { chunkForModel, llmComplete, llmJson, llmStatus, type LlmRequest, type LlmStatus } from "@core/llm";
import type { ActionItem, Meeting, MeetingSummary } from "../types";
import { transcriptPlain } from "./transcript";

/**
 * The after-call summary through `@core/llm`: one JSON answer with the
 * summary, the decisions and the to-dos (each with who owns it, "you" or
 * "them", when the transcript says). A long call is summarised in chunks
 * first (`chunkForModel`) and the chunk notes are summarised once more —
 * never the whole hour in one request.
 */

const PURPOSE = "meeting summary";

const SYSTEM = [
  "You summarise call transcripts. The transcript has two sides:",
  '"you" is the person who recorded the call (their microphone), "them" is everyone else (the system audio).',
  "Write in the language the call was held in. Be concrete: names, numbers, dates, what was agreed.",
  "Never invent decisions or tasks that were not said.",
].join(" ");

const JSON_SHAPE = [
  "Answer with one JSON object and nothing else, of this exact shape:",
  '{"summary": string (3-6 sentences, plain prose), "decisions": string[] (things that were agreed, may be empty),',
  '"actionItems": [{"text": string, "owner": "you" | "them" (omit when unclear)}] (concrete to-dos, may be empty)}',
].join(" ");

export function isActionItem(v: unknown): v is ActionItem {
  if (!v || typeof v !== "object") return false;
  const a = v as Record<string, unknown>;
  if (typeof a.text !== "string") return false;
  return a.owner === undefined || a.owner === null || a.owner === "you" || a.owner === "them";
}

/**
 * The guard `llmJson` runs on the model's answer. `decisions` and
 * `actionItems` may be missing (models drop empty arrays); anything present
 * has to be the right shape.
 */
export function isMeetingSummary(v: unknown): v is MeetingSummary {
  if (!v || typeof v !== "object") return false;
  const s = v as Record<string, unknown>;
  if (typeof s.summary !== "string") return false;
  if (s.decisions !== undefined && (!Array.isArray(s.decisions) || !s.decisions.every((d) => typeof d === "string"))) return false;
  if (s.actionItems !== undefined && (!Array.isArray(s.actionItems) || !s.actionItems.every(isActionItem))) return false;
  return true;
}

/** Fills the optional arrays, trims, drops empties, strips a null owner. */
export function normalizeSummary(s: MeetingSummary): MeetingSummary {
  const items = (s.actionItems ?? [])
    .map((a) => ({ text: a.text.trim(), ...(a.owner === "you" || a.owner === "them" ? { owner: a.owner } : {}) }))
    .filter((a) => a.text);
  return {
    summary: s.summary.trim(),
    decisions: (s.decisions ?? []).map((d) => d.trim()).filter(Boolean),
    actionItems: items,
  };
}

export interface SummaryDeps {
  status: () => Promise<LlmStatus>;
  complete: (req: LlmRequest) => Promise<string>;
  json: <T>(req: LlmRequest, guard: (v: unknown) => v is T) => Promise<T>;
  /** Tokens per chunk; the default is the contract's 3000. */
  chunkTokens?: number;
}

const LIVE_DEPS: SummaryDeps = { status: llmStatus, complete: llmComplete, json: llmJson };

export type SummaryOutcome =
  | { kind: "done"; summary: MeetingSummary }
  | { kind: "unavailable"; reason?: string }
  | { kind: "empty" }
  | { kind: "error"; message: string };

/** The transcript plus the person's notes, which often name what mattered. */
export function summaryInput(meeting: Meeting): string {
  const transcript = transcriptPlain(meeting.segments);
  const notes = meeting.notes.trim();
  if (!transcript && !notes) return "";
  const parts = [`Title: ${meeting.title}`];
  if (notes) parts.push(`Notes taken during the call:\n${notes}`);
  if (transcript) parts.push(`Transcript:\n${transcript}`);
  return parts.join("\n\n");
}

export async function summarizeMeeting(meeting: Meeting, deps: SummaryDeps = LIVE_DEPS): Promise<SummaryOutcome> {
  const input = summaryInput(meeting);
  if (!input) return { kind: "empty" };
  let status: LlmStatus;
  try {
    status = await deps.status();
  } catch (err) {
    return { kind: "error", message: err instanceof Error ? err.message : String(err) };
  }
  if (!status.available) return { kind: "unavailable", reason: status.reason };

  try {
    const chunks = chunkForModel(input, deps.chunkTokens ?? 3000);
    let material = input;
    if (chunks.length > 1) {
      const notes: string[] = [];
      for (let i = 0; i < chunks.length; i += 1) {
        const part = await deps.complete({
          system: SYSTEM,
          prompt: `This is part ${i + 1} of ${chunks.length} of a call transcript. Write dense notes of what was said, what was agreed and every to-do, keeping who said what (you / them):\n\n${chunks[i]}`,
          purpose: PURPOSE,
          maxTokens: 700,
        });
        notes.push(part.trim());
      }
      material = `Notes from the ${chunks.length} parts of the call, in order:\n\n${notes.join("\n\n")}`;
    }
    const raw = await deps.json(
      {
        system: SYSTEM,
        prompt: `${JSON_SHAPE}\n\n${material}`,
        purpose: PURPOSE,
        json: true,
        maxTokens: 1200,
      },
      isMeetingSummary,
    );
    return { kind: "done", summary: normalizeSummary(raw) };
  } catch (err) {
    return { kind: "error", message: err instanceof Error ? err.message : String(err) };
  }
}
