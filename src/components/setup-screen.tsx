import { useEffect, useState } from "react";
import { Check, CircleAlert, Copy, LoaderCircle } from "lucide-react";
import { Mark } from "@/components/mark";
import { Button } from "@/components/ui/button";
import { probeWslc, type WslcProbe } from "@/lib/tauri";
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
    title: "Install a WSL build with Containers",
    cmd: "wsl --update --pre-release",
    hint: "Quay currently requires WSL 2.9.3+ with wslc.exe. Reboot if Windows asks.",
  },
  {
    n: "3",
    title: "Confirm the container CLI",
    cmd: "wslc version",
    hint: "This must succeed before Quay can manage containers.",
  },
];

export function SetupScreen() {
  const gate = useWslc((s) => s.gate);
  const probeNote = useWslc((s) => s.probeNote);
  const retryProbe = useWslc((s) => s.retryProbe);
  const checking = gate === "checking";
  const [diagnostics, setDiagnostics] = useState<WslcProbe | null>(null);

  async function refreshDiagnostics() {
    try {
      setDiagnostics(await probeWslc());
    } catch {
      setDiagnostics(null);
    }
  }

  useEffect(() => {
    void refreshDiagnostics();
  }, [gate]);

  return (
    <div className="mx-auto flex min-h-0 w-full max-w-xl flex-1 flex-col justify-center gap-6 overflow-y-auto p-6">
      <div className="flex items-center gap-3">
        <Mark className="size-10" />
        <div>
          <p className="text-xs uppercase tracking-widest text-subtle">Quay</p>
          <h1 className="text-2xl font-medium tracking-tight">WSL Containers setup</h1>
        </div>
      </div>

      <p className="text-sm leading-relaxed text-muted-foreground">
        Quay uses the installed <span className="font-mono text-foreground">wslc.exe</span> directly.
        Complete the checks below, then retry — you do not need to reinstall Quay.
      </p>

      <div className="grid gap-2 sm:grid-cols-2">
        <RuntimeCheck
          label="WSL"
          ok={diagnostics?.wsl ?? false}
          value={diagnostics?.wslVersion ?? (checking ? "Checking…" : "Not detected")}
        />
        <RuntimeCheck
          label="WSLC"
          ok={diagnostics?.wslc ?? false}
          value={diagnostics?.version ?? (checking ? "Checking…" : "Not detected")}
        />
      </div>

      <p className="whitespace-pre-wrap break-words rounded-lg bg-elevated px-3 py-2 font-mono text-xs text-muted-foreground">
        {checking ? "Checking the Windows host…" : probeNote}
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
        Microsoft docs:{" "}
        <a
          className="text-accent underline-offset-2 hover:underline"
          href="https://learn.microsoft.com/windows/wsl/wsl-container"
          target="_blank"
          rel="noreferrer"
        >
          WSL Containers
        </a>
        .
      </p>

      <Button
        onClick={async () => {
          await refreshDiagnostics();
          await retryProbe();
        }}
        disabled={checking}
        className="w-full"
      >
        {checking ? (
          <>
            <LoaderCircle className="size-4 animate-spin" />
            Checking
          </>
        ) : (
          "Check again"
        )}
      </Button>
    </div>
  );
}

function RuntimeCheck({ label, ok, value }: { label: string; ok: boolean; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-3">
      <div className="flex items-center gap-2">
        {ok ? <Check className="size-4 text-ok" /> : <CircleAlert className="size-4 text-warn" />}
        <span className="text-sm font-medium">{label}</span>
      </div>
      <p className="mt-1 truncate font-mono text-xs text-subtle" title={value}>{value}</p>
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
            /* clipboard permission can be unavailable */
          }
        }}
      >
        {copied ? <Check className="size-3.5 text-ok" /> : <Copy className="size-3.5" />}
      </button>
    </div>
  );
}
