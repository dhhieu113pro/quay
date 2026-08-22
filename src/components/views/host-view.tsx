import { CodeBlock } from "@/components/code-block";
import { csharpCsproj, csharpHostProgram, tauriSidecarNote } from "@/lib/wslc/csharp";
import { relativeTime } from "@/lib/utils";
import { useWslc } from "@/lib/wslc/store";
import { cn } from "@/lib/utils";

export function HostView() {
  const session = useWslc((s) => s.session);
  const calls = useWslc((s) => s.calls);
  const now = useWslc((s) => s.now);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-4 md:p-6">
      <div>
        <h1 className="text-xl font-medium tracking-tight">C# host</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          The WebView is Tauri. Native work is a C# sidecar on{" "}
          <span className="font-mono text-foreground/80">Microsoft.WSL.Containers</span>
          — pull, run, stdio, mounts, ports, GPU.
        </p>
      </div>

      <ol className="grid gap-3 sm:grid-cols-3">
        <Step n="01" title="WebView" body="This UI. Buttons become invoke() calls." />
        <Step
          n="02"
          title="Tauri + sidecar"
          body="Rust stays a thin stdin bridge. quay-host.exe is C#."
        />
        <Step
          n="03"
          title="WSLc VM"
          body="Hyper-V session with virtiofs, consomme, CDI GPU."
        />
      </ol>

      <div className="grid gap-4 lg:grid-cols-2">
        <CodeBlock code={csharpHostProgram(session)} label="Quay.Host / Program.cs" />
        <div className="flex flex-col gap-4">
          <CodeBlock code={csharpCsproj()} label="Quay.Host.csproj" />
          <CodeBlock code={tauriSidecarNote()} label="src-tauri / lib.rs" />
        </div>
      </div>

      <section className="rounded-xl border border-border bg-card">
        <div className="border-b border-border px-4 py-3">
          <h2 className="text-sm font-medium">Live invoke log</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Every UI action appends the C# the sidecar would run.
          </p>
        </div>
        <ul className="divide-y divide-border">
          {calls.map((c) => (
            <li key={c.id} className="px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-mono text-xs text-accent">{c.method}</span>
                <span className="text-xs text-subtle">{relativeTime(c.at, now)}</span>
              </div>
              <p className={cn("mt-1 text-xs", c.ok ? "text-muted-foreground" : "text-destructive")}>
                {c.result}
              </p>
              <p className="mt-1 truncate font-mono text-xs text-subtle">{c.cli}</p>
              <pre className="mt-2 overflow-x-auto whitespace-pre-wrap font-mono text-xs leading-relaxed text-foreground/80">
                {c.csharp}
              </pre>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function Step({ n, title, body }: { n: string; title: string; body: string }) {
  return (
    <li className="rounded-xl border border-border bg-card p-4">
      <p className="font-mono text-xs text-accent">{n}</p>
      <p className="mt-2 text-sm font-medium">{title}</p>
      <p className="mt-1 text-sm text-muted-foreground">{body}</p>
    </li>
  );
}
