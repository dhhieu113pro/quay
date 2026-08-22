import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { CodeBlock } from "@/components/code-block";
import { AppearanceToggle } from "@/components/appearance-toggle";
import { csharpSessionStart } from "@/lib/wslc/csharp";
import { formatUptime } from "@/lib/utils";
import { useWslc } from "@/lib/wslc/store";
import type { FilesystemMode, NetworkMode } from "@/lib/wslc/types";

export function SessionView() {
  const session = useWslc((s) => s.session);
  const startSession = useWslc((s) => s.startSession);
  const stopSession = useWslc((s) => s.stopSession);
  const updateSession = useWslc((s) => s.updateSession);
  const groups = useWslc((s) => s.groups);
  const launchAtSignIn = useWslc((s) => s.launchAtSignIn);
  const setLaunchAtSignIn = useWslc((s) => s.setLaunchAtSignIn);
  const setGroupAutoStart = useWslc((s) => s.setGroupAutoStart);
  const now = useWslc((s) => s.now);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 p-4 md:p-6">
      <div>
        <h1 className="text-xl font-medium tracking-tight">WSL container session</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          One Hyper-V VM, separate from WSL distros. Quay controls it by running the installed{" "}
          <span className="font-mono text-foreground/80">wslc.exe</span> CLI.
        </p>
      </div>

      <section className="rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-widest text-subtle">State</p>
            <p className="mt-1 text-sm">
              {session.running ? "Running" : "Stopped"}
              {session.running ? ` · ${formatUptime(session.startedAt, now)}` : ""}
            </p>
            <p className="mt-1 font-mono text-xs text-muted-foreground">
              {session.version} · WSL {session.wslVersion}
            </p>
          </div>
          <div className="flex gap-2">
            {session.running ? (
              <Button
                variant="secondary"
                onClick={() => {
                  stopSession();
                  toast("Session terminated");
                }}
              >
                Terminate
              </Button>
            ) : (
              <Button
                onClick={() => {
                  startSession();
                  toast("Session started");
                }}
              >
                Start session
              </Button>
            )}
          </div>
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
          <Meta k="Filesystem" v={session.filesystem} />
          <Meta k="Network" v={session.networking} />
          <Meta k="GPU" v={session.gpu ? session.gpuName : "off"} />
          <Meta
            k="Components"
            v={
              session.missingComponents.length
                ? session.missingComponents.join(", ")
                : "none missing"
            }
          />
        </dl>
      </section>

      <section className="grid gap-4 rounded-xl border border-border bg-card p-4">
        <h2 className="text-sm font-medium">Session preferences</h2>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="sname">Name</Label>
            <Input
              id="sname"
              value={session.name}
              onChange={(e) => updateSession({ name: e.target.value })}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="spath">Data path</Label>
            <Input
              id="spath"
              className="font-mono"
              value={session.dataPath}
              onChange={(e) => updateSession({ dataPath: e.target.value })}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="scpu">vCPU</Label>
            <Input
              id="scpu"
              type="number"
              min={1}
              max={16}
              value={session.cpuCount}
              onChange={(e) =>
                updateSession({ cpuCount: Number(e.target.value) || 1 })
              }
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="smem">Memory MB</Label>
            <Input
              id="smem"
              type="number"
              min={512}
              step={256}
              value={session.memoryMB}
              onChange={(e) =>
                updateSession({ memoryMB: Number(e.target.value) || 512 })
              }
            />
          </div>
        </div>
        <div className="flex flex-wrap gap-6">
          <label className="flex items-center gap-2 text-sm">
            <Switch
              checked={session.filesystem === "virtiofs"}
              onCheckedChange={(on) =>
                updateSession({
                  filesystem: (on ? "virtiofs" : "9p") as FilesystemMode,
                })
              }
            />
            virtiofs
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Switch
              checked={session.networking === "consomme"}
              onCheckedChange={(on) =>
                updateSession({
                  networking: (on ? "consomme" : "nat") as NetworkMode,
                })
              }
            />
            consomme network
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Switch
              checked={session.gpu}
              onCheckedChange={(gpu) => updateSession({ gpu })}
            />
            GPU / CDI
          </label>
        </div>
      </section>

      <section className="rounded-xl border border-border bg-card p-4">
        <h2 className="text-sm font-medium">Windows</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Open Quay when you sign in to Windows. Groups marked Auto start with
          the WSL container session.
        </p>
        <label className="mt-3 flex items-center gap-2 text-sm">
          <Switch
            checked={launchAtSignIn}
            onCheckedChange={(on) => {
              setLaunchAtSignIn(on);
              toast(on ? "Quay will open at Windows sign-in" : "Removed from Windows startup");
            }}
          />
          Open Quay at sign-in
        </label>
        <ul className="mt-4 grid gap-2">
          {groups.map((g) => (
            <li
              key={g.id}
              className="flex items-center justify-between gap-3 rounded-lg bg-elevated px-3 py-2"
            >
              <div>
                <p className="text-sm">{g.name}</p>
                <p className="font-mono text-xs text-subtle">
                  {g.specs.map((s) => s.name).join(" + ")}
                </p>
              </div>
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <Switch
                  checked={g.autoStart}
                  onCheckedChange={(on) => setGroupAutoStart(g.id, on)}
                />
                Auto
              </label>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-xl border border-border bg-card p-4">
        <h2 className="text-sm font-medium">Appearance</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Auto follows sunrise and sunset at this location. Light and dark lock the
          palette. Closing the window hides Quay in the tray — quit from there.
        </p>
        <div className="mt-3">
          <AppearanceToggle />
        </div>
      </section>

      <CodeBlock code={csharpSessionStart(session)} />

      <p className="text-xs text-subtle">
        This preview simulates the runtime. On Windows 11 with WSL 2.9.3+, these
        commands run against the real VM.
      </p>

    </div>
  );
}

function Meta({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="text-xs text-subtle">{k}</dt>
      <dd className="mt-0.5 font-mono text-xs">{v}</dd>
    </div>
  );
}
