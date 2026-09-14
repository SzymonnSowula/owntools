import { lazy, Suspense, useRef, useState, type ChangeEvent } from "react";
import { confirmDialog } from "@ui/Dialog";
import { SUITE_NAME } from "@core/branding";
import { isTauri } from "../../../lib/env";
import { exportFileName, saveTextAs, workspaceToMarkdown } from "../../../lib/exportData";
import { validateBackup } from "../../../store/persist";
import { useAppStore } from "../../../store/useAppStore";
import { Button, Card, Note, Row } from "../ui";

// Lazy: the sync engine only loads when this page is opened.
const SyncCard = lazy(() => import("@feature-sync/SyncCard"));

export function DataPage() {
  return (
    <>
      <Suspense fallback={null}>
        <SyncCard />
      </Suspense>
      <BackupCard />
    </>
  );
}

function BackupCard() {
  const workspaces = useAppStore((s) => s.workspaces);
  const workspaceId = useAppStore((s) => s.workspaceId);
  const [msg, setMsg] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const workspaceName = workspaces.find((w) => w.id === workspaceId)?.name ?? "workspace";

  const doExport = async (kind: "md" | "json") => {
    const data = useAppStore.getState().exportWorkspaceData();
    const content = kind === "md" ? workspaceToMarkdown(data, workspaceName) : JSON.stringify(data, null, 2);
    const ok = await saveTextAs(
      exportFileName(workspaceName, kind),
      content,
      kind === "md" ? "text/markdown" : "application/json",
    );
    setMsg(ok ? `Saved ${kind === "md" ? "the Markdown export" : "a JSON backup"}.` : "Export cancelled.");
  };

  // Shared tail of both pickers: parse -> validate -> confirm -> replace.
  const restoreFromText = async (text: string) => {
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      setMsg("That file isn't valid JSON.");
      return;
    }
    if (!validateBackup(raw)) {
      setMsg(`That file doesn't look like a ${SUITE_NAME} backup.`);
      return;
    }
    const ok = await confirmDialog({
      title: "Restore backup",
      message: "This replaces everything in the current workspace with the backup. Continue?",
      kind: "warning",
      okLabel: "Restore",
    });
    if (!ok) {
      setMsg("Restore cancelled.");
      return;
    }
    setRestoring(true);
    try {
      await useAppStore.getState().importWorkspaceData(raw);
      setMsg("Backup restored - this workspace now matches the file.");
    } catch {
      setMsg("Couldn't restore that backup.");
    } finally {
      setRestoring(false);
    }
  };

  const restore = async () => {
    setMsg(null);
    if (!isTauri()) {
      fileRef.current?.click();
      return;
    }
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const picked = await open({ filters: [{ name: "JSON", extensions: ["json"] }], multiple: false });
      if (typeof picked !== "string") {
        setMsg("Restore cancelled.");
        return;
      }
      const { readTextFile } = await import("@tauri-apps/plugin-fs");
      await restoreFromText(await readTextFile(picked));
    } catch {
      setMsg("Couldn't read that file.");
    }
  };

  const onBrowserFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      await restoreFromText(await file.text());
    } catch {
      setMsg("Couldn't read that file.");
    }
  };

  return (
    <Card
      id="backup"
      title="Export and backup"
      desc={`The focus workspace “${workspaceName}” as plain files. Nothing leaves this device.`}
    >
      <Row label="Export as Markdown" hint="Tasks, notes and habits in a file you (or an AI agent) can read.">
        <Button onClick={() => void doExport("md")}>Export</Button>
      </Row>
      <Row label="Back up as JSON" hint="Everything in this workspace, in a file you can restore later.">
        <Button onClick={() => void doExport("json")}>Back up</Button>
      </Row>
      <Row label="Restore a backup" hint="Replaces this workspace with the file - take a fresh backup first if in doubt.">
        <Button kind="ghost" disabled={restoring} onClick={() => void restore()}>
          {restoring ? "Restoring…" : "Restore…"}
        </Button>
      </Row>
      {msg ? (
        <div className="st-row-foot">
          <Note>{msg}</Note>
        </div>
      ) : null}
      {!isTauri() ? (
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          style={{ display: "none" }}
          onChange={(e) => void onBrowserFile(e)}
        />
      ) : null}
    </Card>
  );
}
