import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, FolderOpen, LoaderCircle, Play, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { AppearanceToggle } from "@/components/appearance-toggle";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { getDefaultWorkspaceRoot, openWorkspacePath, pickWorkspaceRoot } from "@/lib/tauri";
import { useWslc } from "@/lib/wslc/store";

export function GettingStartedView({ rerun = false, onDone, onCancel }: {
  rerun?: boolean;
  onDone?: () => void;
  onCancel?: () => void;
}) {
  const workspaceRoot = useWslc((s) => s.workspaceRoot);
  const currentLaunchAtSignIn = useWslc((s) => s.launchAtSignIn);
  const completeOnboarding = useWslc((s) => s.completeOnboarding);
  const changeWorkspaceRoot = useWslc((s) => s.changeWorkspaceRoot);
  const gate = useWslc((s) => s.gate);
  const session = useWslc((s) => s.session);
  const probeNote = useWslc((s) => s.probeNote);
  const retryProbe = useWslc((s) => s.retryProbe);
  const startSession = useWslc((s) => s.startSession);
  const operations = useWslc((s) => s.operations);
  const [draftRoot, setDraftRoot] = useState(workspaceRoot);
  const [launchAtSignIn, setLaunchAtSignIn] = useState(rerun ? currentLaunchAtSignIn : false);
  const [saving, setSaving] = useState(false);
  const [migrationPending, setMigrationPending] = useState(false);

  useEffect(() => {
    void retryProbe();
  }, [retryProbe]);

  useEffect(() => {
    if (workspaceRoot.trim()) {
      setDraftRoot(workspaceRoot);
      return;
    }
    void getDefaultWorkspaceRoot().then(setDraftRoot).catch(() => undefined);
  }, [workspaceRoot]);

  const rootChanged = draftRoot.trim().toLowerCase() !== workspaceRoot.trim().toLowerCase();
  const runtime = useMemo(() => {
    if (gate === "missing") return { label: "WSLC unavailable", ready: false, stopped: false };
    if (gate === "checking") return { label: "Checking WSLC…", ready: false, stopped: false };
    if (!session.running) return { label: "WSLC is stopped", ready: false, stopped: true };
    return { label: "Ready", ready: true, stopped: false };
  }, [gate, session.running]);

  async function finish(root = draftRoot) {
    setSaving(true);
    try {
      await completeOnboarding({ workspaceRoot: root, launchAtSignIn });
      toast(rerun ? "Getting Started settings updated" : "Quay is ready");
      onDone?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not finish Quay setup");
    } finally {
      setSaving(false);
    }
  }

  async function applyMigration(mode: "move" | "keep") {
    setSaving(true);
    try {
      await changeWorkspaceRoot(draftRoot, mode);
      setMigrationPending(false);
      await completeOnboarding({ workspaceRoot: draftRoot, launchAtSignIn });
      toast(mode === "move" ? "Moved Quay workspace" : "Changed Quay workspace; old files were left in place");
      onDone?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not change the Quay workspace");
    } finally {
      setSaving(false);
    }
  }

  function submit() {
    if (!draftRoot.trim()) {
      toast.error("Choose a Quay workspace folder before continuing.");
      return;
    }
    if (rerun && rootChanged) {
      setMigrationPending(true);
      return;
    }
    void finish();
  }

  return (
    <div className="min-h-screen bg-background px-4 py-8 text-foreground md:py-12">
      <main className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <header className="space-y-2">
          <p className="font-mono text-xs uppercase tracking-[0.24em] text-subtle">Getting Started</p>
          <h1 className="text-3xl font-medium tracking-tight">Welcome to Quay</h1>
          <p className="max-w-2xl text-sm text-muted-foreground">Set up the essentials before your first Cube. You can change these settings later.</p>
        </header>

        <section className="rounded-xl border border-border bg-card p-5">
          <div className="flex gap-3">
            <span className="grid size-7 shrink-0 place-items-center rounded-full bg-elevated font-mono text-xs">1</span>
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-medium">Workspace</h2>
              <p className="mt-1 text-sm text-muted-foreground">Quay stores Cube and container workspace files here.</p>
              <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                <Input value={draftRoot} readOnly className="min-w-0 flex-1 font-mono text-xs" aria-label="Quay workspace root" />
                <Button type="button" variant="secondary" onClick={() => void (async () => {
                  const selected = await pickWorkspaceRoot(draftRoot);
                  if (selected) setDraftRoot(selected);
                })()}>Choose folder</Button>
                <Button type="button" variant="ghost" disabled={!draftRoot.trim()} onClick={() => void openWorkspacePath(draftRoot)}>
                  <FolderOpen className="size-4" /> Open folder
                </Button>
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-border bg-card p-5">
          <div className="flex gap-3">
            <span className="grid size-7 shrink-0 place-items-center rounded-full bg-elevated font-mono text-xs">2</span>
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-medium">WSLC</h2>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg bg-elevated/60 p-3">
                <div className="flex items-start gap-2">
                  {runtime.ready ? <CheckCircle2 className="mt-0.5 size-4" /> : <TriangleAlert className="mt-0.5 size-4" />}
                  <div>
                    <p className="text-sm font-medium">{runtime.label}</p>
                    <p className="mt-0.5 font-mono text-xs text-muted-foreground">{session.version} · {session.wslVersion}</p>
                    {!runtime.ready ? <p className="mt-1 text-xs text-subtle">{probeNote}</p> : null}
                  </div>
                </div>
                {runtime.stopped ? (
                  <Button type="button" size="sm" disabled={Boolean(operations.session)} onClick={startSession}>
                    {operations.session ? <LoaderCircle className="size-4 animate-spin" /> : <Play className="size-4" />} Start WSLC
                  </Button>
                ) : null}
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-xl border border-border bg-card p-5">
          <div className="flex gap-3">
            <span className="grid size-7 shrink-0 place-items-center rounded-full bg-elevated font-mono text-xs">3</span>
            <div className="min-w-0 flex-1 space-y-4">
              <div>
                <h2 className="text-sm font-medium">Preferences</h2>
                <p className="mt-1 text-sm text-muted-foreground">Choose only the essentials. Advanced container settings stay out of first-run setup.</p>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <Switch checked={launchAtSignIn} onCheckedChange={setLaunchAtSignIn} />
                Open Quay at Windows sign-in
              </label>
              <div>
                <p className="mb-2 text-xs uppercase tracking-widest text-subtle">Appearance</p>
                <AppearanceToggle />
              </div>
            </div>
          </div>
        </section>

        <footer className="flex flex-wrap justify-end gap-2">
          {rerun ? <Button type="button" variant="ghost" disabled={saving} onClick={onCancel}>Cancel</Button> : null}
          <Button type="button" disabled={saving || !draftRoot.trim()} onClick={submit}>
            {saving ? <LoaderCircle className="size-4 animate-spin" /> : null}
            {rerun ? "Save settings" : "Start using Quay"}
          </Button>
        </footer>
      </main>

      <Dialog open={migrationPending} onOpenChange={(open) => { if (!open && !saving) setMigrationPending(false); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Change Quay workspace?</DialogTitle>
            <DialogDescription>
              New root: <span className="font-mono text-foreground">{draftRoot}</span>. Choose whether Quay should move its managed cubes and containers.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2 sm:grid-cols-3">
            <Button disabled={saving} onClick={() => void applyMigration("move")}>Move existing data</Button>
            <Button disabled={saving} variant="secondary" onClick={() => void applyMigration("keep")}>Keep existing data</Button>
            <Button disabled={saving} variant="ghost" onClick={() => setMigrationPending(false)}>Cancel</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
