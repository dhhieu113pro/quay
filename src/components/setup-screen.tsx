import { useState } from "react";
import { Check, Copy, LoaderCircle } from "lucide-react";
import { Mark } from "@/components/mark";
import { Button } from "@/components/ui/button";
import { useWslc } from "@/lib/wslc/store";

const STEPS = [
  {
    n: "1",
    title: "Install WSL, no distro required",
    cmd: "wsl --install --no-distribution",
    hint: "Skip if wsl --status already works.",
  },
  {
    n: "2",
    title: "Pre-release 2.9.3+ (ships wslc)",
    cmd: "wsl --update --pre-release",
    hint: "Needs a recent Windows 11. Reboot if the installer asks.",
  },
  {
    n: "3",
    title: "Confirm the CLI",
    cmd: "wslc version",
    hint: "Same binary as container.exe. Should print 2.9.3 or newer.",
  },
];

export function SetupScreen() {
  const gate = useWslc((s) => s.gate);
  const probeNote = useWslc((s) => s.probeNote);
  const retryProbe = useWslc((s) => s.retryProbe);
  const enterLab = useWslc((s) => s.enterLab);
  const checking = gate === "checking";

  return (
    <div className="mx-auto flex min-h-0 w-full max-w-xl flex-1 flex-col justify-center gap-6 overflow-y-auto p-6">
      <div className="flex items-center gap-3">
        <Mark className="size-10" />
        <div>
          <p className="text-xs uppercase tracking-widest text-subtle">Quay</p>
          <h1 className="text-2xl font-medium tracking-tight">WSL containers aren’t here</h1>
        </div>
      </div>

      <p className="text-sm leading-relaxed text-muted-foreground">
        This desktop talks to <span className="font-mono text-foreground">wslc.exe</span> through
        a C# sidecar on{" "}
        <span className="font-mono text-foreground">Microsoft.WSL.Containers</span>. Nothing is
        wrong with Quay — Windows doesn’t have the runtime yet.
      </p>

      <p className="font-mono text-xs text-subtle">
        {checking ? "Looking for wslc.exe…" : probeNote}
      </p>

      <ol className="grid gap-3">
        {STEPS.map((step) => (
          <li key={step.n} className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-baseline gap-2">
              <span className="font-mono text-xs text-subtle">{step.n}</span>
              <p className="text-sm font-medium">{step.title}</p>
            </div>
            <CopyRow cmd={step.cmd} />
            <p className="mt-2 text-xs text-subtle">{step.hint}</p>
          </li>
        ))}
      </ol>

      <p className="text-xs text-muted-foreground">
        Docs:{" "}
        <a
          className="text-accent underline-offset-2 hover:underline"
          href="https://learn.microsoft.com/windows/wsl/wsl-container"
          target="_blank"
          rel="noreferrer"
        >
          WSL containers
        </a>
        . After install, come back here and check again — no reinstall of Quay.
      </p>

      <div className="flex flex-col gap-2 sm:flex-row">
        <Button onClick={() => void retryProbe()} disabled={checking} className="sm:flex-1">
          {checking ? (
            <>
              <LoaderCircle className="size-4 animate-spin" />
              Checking
            </>
          ) : (
            "I’ve installed it — check again"
          )}
        </Button>
        <Button variant="secondary" onClick={enterLab} className="sm:flex-1">
          Explore with sample data
        </Button>
      </div>
    </div>
  );
}

function CopyRow({ cmd }: { cmd: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-3 flex items-center gap-2 rounded-lg bg-elevated px-3 py-2">
      <code className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">{cmd}</code>
      <button
        type="button"
        className="grid size-9 shrink-0 place-items-center text-muted-foreground hover:text-foreground"
        aria-label={`Copy ${cmd}`}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(cmd);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1400);
          } catch {
            /* ignore */
          }
        }}
      >
        {copied ? <Check className="size-3.5 text-ok" /> : <Copy className="size-3.5" />}
      </button>
    </div>
  );
}
