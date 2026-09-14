/**
 * The cleanup's words and arithmetic, kept out of the store so they can be
 * tested: what the dialogs say about installed programs and protected folders,
 * how the retry with administrator permission folds into the first attempt,
 * and the line left under the cleanup bar afterwards.
 */
import type { BinUse, Protection, TrashFailure, TrashOutcome } from "../api/types";
import { baseName, formatBytes } from "./format";

/** The programs first, then the services, each name once. */
export function protectedNames(protections: Protection[]): string[] {
  const names: string[] = [];
  const add = (name: string) => {
    if (name && !names.includes(name)) names.push(name);
  };
  for (const p of protections) p.apps.forEach((a) => add(a.name));
  for (const p of protections) p.services.forEach((s) => add(s.display || s.name));
  return names;
}

/** "A", "A and B", "A, B and 3 more" — `max` names at most. */
export function listNames(names: string[], max = 2): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length <= max) return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  return `${names.slice(0, max).join(", ")} and ${names.length - max} more`;
}

/**
 * What to type into Applications' filter to find what protects an item: the
 * program's own name, or the folder's name when only a service gave it away
 * (MongoDB's installer records no folder; its service does).
 */
export function appsQueryFor(p: Protection): string {
  return p.apps[0]?.name ?? baseName(p.path);
}

/** For a cleanup where every item is part of an installed program. */
export function protectedDialog(protections: Protection[]): { title: string; message: string } {
  const names = protectedNames(protections);
  return {
    title: names.length === 1 ? "Part of an installed program" : "Part of installed programs",
    message: `${protections.length === 1 ? "This is" : "These are"} part of ${listNames(names, 3)}. Moving a program's files breaks it and leaves its uninstall entry, services and drivers behind — its own uninstaller removes all of it.`,
  };
}

/** Appended to the Recycle Bin confirmation when some items stay. */
export function skipSentence(protections: Protection[]): string {
  if (!protections.length) return "";
  const one = protections.length === 1;
  return ` ${one ? "One item stays where it is" : `${protections.length} items stay where they are`}: part of ${listNames(protectedNames(protections))}.`;
}

/**
 * Appended to the Recycle Bin confirmation, per drive (`bin.rs`): items on a
 * drive without a bin stay put, what the cleanup pushes out of a bin for good,
 * and how much of a bin it takes once that is half of it or more. Empty when
 * there is nothing worth saying.
 */
export function binSentence(bins: BinUse[]): string {
  const parts: string[] = [];
  for (const bin of bins) {
    if (!bin.hasBin) {
      const stay = bin.items === 1 ? "One item stays where it is" : `${bin.items} items stay where they are`;
      parts.push(`${stay}: ${bin.reason ?? `${bin.root} has no Recycle Bin`}, and nothing is deleted for good.`);
    } else if (bin.adding > bin.capacity) {
      continue; // refused as a whole: binBlockDialog speaks instead of the confirmation
    } else if (bin.evicts > 0) {
      parts.push(`To make room, Windows will permanently erase the oldest ${formatBytes(bin.evicts)} already in the Recycle Bin on ${bin.root}.`);
    } else if (bin.adding * 2 >= bin.capacity) {
      parts.push(`That is ${formatBytes(bin.adding)} of the ${formatBytes(bin.capacity)} the Recycle Bin on ${bin.root} holds.`);
    }
  }
  return parts.length ? ` ${parts.join(" ")}` : "";
}

/**
 * Said instead of the confirmation when the Recycle Bin would not take it: more
 * than a drive's bin holds (Windows would make room by erasing part of it for
 * good), or everything sits on drives without a bin. `null` when it can go.
 */
export function binBlockDialog(bins: BinUse[], movable: number): { title: string; message: string } | null {
  const over = bins.find((b) => b.hasBin && b.adding > b.capacity);
  if (over) {
    return {
      title: "More than the Recycle Bin holds",
      message: `This is ${formatBytes(over.adding)}, and the Recycle Bin on ${over.root} holds ${formatBytes(over.capacity)}. Windows would make room by erasing part of it for good, so nothing was moved. Move less at a time, or give the Recycle Bin more room in its Properties.`,
    };
  }
  const bare = bins.filter((b) => !b.hasBin);
  const stranded = bare.reduce((n, b) => n + b.items, 0);
  if (movable > 0 && stranded >= movable) {
    return {
      title: "No Recycle Bin there",
      message: `${bare[0].reason ?? `${bare[0].root} has no Recycle Bin`}, so deleting there would be for good — owntools never does that. Copy what you want to keep somewhere else, then delete it yourself.`,
    };
  }
  return null;
}

/** Asked after Windows refused some items for want of rights. */
export function adminDialog(failures: TrashFailure[]): { title: string; message: string; okLabel: string; cancelLabel: string } {
  const one = failures.length === 1;
  return {
    title: "Administrator permission needed",
    message: one
      ? `Windows protects “${baseName(failures[0].path)}”. Continue and Windows asks for your permission; it still goes to the Recycle Bin.`
      : `Windows protects ${failures.length} of these items. Continue and Windows asks for your permission once; they still go to the Recycle Bin.`,
    okLabel: "Continue",
    cancelLabel: one ? "Skip it" : "Skip them",
  };
}

/** Folds the retry into the first attempt: items tried twice take the second answer. */
export function mergeOutcomes(first: TrashOutcome, retry: TrashOutcome, retried: number[]): TrashOutcome {
  const again = new Set(retried);
  return {
    removed: [...first.removed, ...retry.removed],
    freed: first.freed + retry.freed,
    failed: [...first.failed.filter((f) => !again.has(f.id)), ...retry.failed],
    skipped: [...first.skipped, ...retry.skipped],
  };
}

export interface CleanupSummary {
  text: string;
  kind: "ok" | "error";
  /** Set when installed programs were left alone: what to look for in Applications. */
  appsQuery: string | null;
}

/** The line under the cleanup bar once it is over. */
export function summarizeCleanup(outcome: TrashOutcome): CleanupSummary {
  const moved = outcome.removed.length;
  const skipped = outcome.skipped.length;
  const failed = outcome.failed.length;
  const parts: string[] = [];
  if (!skipped && !failed) {
    parts.push(`${moved} item${moved === 1 ? "" : "s"} moved to the Recycle Bin · ${formatBytes(outcome.freed)} freed. They are in the Recycle Bin until you empty it.`);
  } else if (moved) {
    parts.push(`${moved} moved to the Recycle Bin · ${formatBytes(outcome.freed)} freed`);
  }
  if (skipped) {
    const names = protectedNames(outcome.skipped);
    parts.push(`${skipped} left alone: part of ${names.length === 1 ? names[0] : "installed programs"}`);
  }
  if (failed) {
    const first = outcome.failed[0];
    parts.push(`${failed} could not be moved — ${baseName(first.path)}: ${first.error}`);
  }
  return {
    text: parts.join(" · "),
    kind: failed ? "error" : "ok",
    appsQuery: skipped ? appsQueryFor(outcome.skipped[0]) : null,
  };
}
