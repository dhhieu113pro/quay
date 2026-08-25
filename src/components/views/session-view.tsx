import { useState } from "react";
import { FolderOpen, LoaderCircle } from "lucide-react";
import { toast } from "sonner";
import { AppearanceToggle } from "@/components/appearance-toggle";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { openWorkspacePath, pickWorkspaceRoot } from "@/lib/tauri";
import { useWslc } from "@/lib/wslc/store";

export function SessionView() {
  const session = useWslc((s) => s.session);
  const containers = useWslc((s) => s.containers);
  const operations = useWslc((s) => s.operations);
  const startSession = useWslc((s) => s.startSession);
  const stopSession = useWslc((s) => s.stopSession);
  const launchAtSignIn = useWslc((s) => s.launchAtSignIn);
  const setLaunchAtSignIn = useWslc((s) => s.setLaunchAtSignIn);
  const workspaceRoot = useWslc((s) => s.workspaceRoot);
  const changeWorkspaceRoot = useWslc((s) => s.changeWorkspaceRoot);
  const [pendingRoot, setPendingRoot] = useState<string | null>(null);
  const [changingRoot, setChangingRoot] = useState(false);
  const sessionBusy = Boolean(operations.session);
  const running = containers.filter((container) => container.status === "running").length;

  async function applyRoot(mode: "move" | "keep") {
    if (!pendingRoot) return;
    setChangingRoot(true);
    try {
      await changeWorkspaceRoot(pendingRoot, mode);
      toast(mode === "move" ? "Moved Quay workspace" : "Changed Quay workspace; old files were left in place");
      setPendingRoot(null);
    } catch {
      toast.error("Could not change the Quay workspace");
    } finally {
      setChangingRoot(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-4 md:p-6">
      <div>
        <h1 className="text-xl font-medium tracking-tight">WSL container session</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Quay uses the default WSL Containers session by running the installed <span className="font-mono text-foreground/80">wslc.exe</span> CLI directly.
        </p>
      </div>

      <section className="rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-widest text-subtle">Runtime</p>
            <p className="mt-1 text-sm">{session.running ? "Available" : "Unavailable"} · {running} running containers</p>
            <p className="mt-1 font-mono text-xs text-muted-foreground">{session.version} · {session.wslVersion}</p>
          </div>
          <div className="flex gap-2">
            {session.running ? (
              <Button variant="secondary" disabled={sessionBusy} onClick={() => { stopSession(); toast("Terminating the default WSLC session"); }}>
                {sessionBusy ? <LoaderCircle className="size-4 animate-spin" /> : null}
                {sessionBusy ? "Terminating…" : "Terminate session"}
              </Button>
            ) : (
              <Button disabled={sessionBusy} onClick={() => { startSession(); toast("Starting the default WSLC session"); }}>
                {sessionBusy ? <LoaderCircle className="size-4 animate-spin" /> : null}
                {sessionBusy ? "Starting…" : "Start session"}
              </Button>
            )}
          </div>
        </div>
        <p className="mt-4 text-xs leading-relaxed text-subtle">
          Session CPU, memory, filesystem and networking controls are intentionally not shown: Quay does not create a custom VM and does not pretend to apply settings that belong to the default WSLC runtime.
        </p>
      </section>

      <section className="rounded-xl border border-border bg-card p-4">
        <h2 className="text-sm font-medium">Windows sign-in</h2>
        <p className="mt-1 text-sm text-muted-foreground">Open Quay when you sign in to Windows.</p>
        <label className="mt-3 flex items-center gap-2 text-sm">
          <Switch checked={launchAtSignIn} onCheckedChange={(on) => { setLaunchAtSignIn(on); toast(on ? "Quay will open at Windows sign-in" : "Removed Quay from Windows startup"); }} />
          Open Quay at sign-in
        </label>
      </section>

      <section className="rounded-xl border border-border bg-card p-4">
        <h2 className="text-sm font-medium">Workspace</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Root folder for all Quay-managed Cube and standalone container workspaces.
        </p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <Input value={workspaceRoot} readOnly className="min-w-0 flex-1 font-mono text-xs" aria-label="Quay workspace root" />
          <Button type="button" variant="secondary" onClick={() => void (async () => {
            const selected = await pickWorkspaceRoot(workspaceRoot);
            if (selected && selected.toLowerCase() !== workspaceRoot.toLowerCase()) setPendingRoot(selected);
          })()}>
            Choose folder
          </Button>
          <Button type="button" variant="ghost" onClick={() => void openWorkspacePath(workspaceRoot)}>
            <FolderOpen className="size-4" /> Open folder
          </Button>
        </div>
        <p className="mt-2 text-xs text-subtle">Cube and container folders are stored as relative paths so this root can be moved later.</p>
      </section>

      <section className="rounded-xl border border-border bg-card p-4">
        <h2 className="text-sm font-medium">Appearance</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Auto follows sunrise and sunset at this location. Light and dark lock the palette. Closing the window hides Quay in the tray; quit from the tray menu.
        </p>
        <div className="mt-3"><AppearanceToggle /></div>
      </section>

      <Dialog open={Boolean(pendingRoot)} onOpenChange={(open) => { if (!open && !changingRoot) setPendingRoot(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Change Quay workspace?</DialogTitle>
            <DialogDescription>
              New root: <span className="font-mono text-foreground">{pendingRoot}</span>. Choose whether Quay should move its managed cubes and containers. Keep existing data leaves files under <span className="font-mono text-foreground">{workspaceRoot}</span>.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-2 sm:grid-cols-3">
            <Button disabled={changingRoot} onClick={() => void applyRoot("move")}>Move existing data</Button>
            <Button disabled={changingRoot} variant="secondary" onClick={() => void applyRoot("keep")}>Keep existing data</Button>
            <Button disabled={changingRoot} variant="ghost" onClick={() => setPendingRoot(null)}>Cancel</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
