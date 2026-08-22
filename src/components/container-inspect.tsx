import { useEffect, useRef, useState } from "react";
import { Play, RotateCcw, Square, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StatusPill } from "@/components/status-pill";
import { formatBytes, formatUptime } from "@/lib/utils";
import { execInContainer } from "@/lib/wslc/terminal";
import { useWslc } from "@/lib/wslc/store";
import type { Container } from "@/lib/wslc/types";

export function ContainerInspect({
  container,
  onClose,
}: {
  container: Container;
  onClose: () => void;
}) {
  const startContainer = useWslc((s) => s.startContainer);
  const stopContainer = useWslc((s) => s.stopContainer);
  const restartContainer = useWslc((s) => s.restartContainer);
  const deleteContainer = useWslc((s) => s.deleteContainer);
  const now = useWslc((s) => s.now);

  return (
    <aside className="flex h-full min-h-0 flex-col border-border bg-card md:border-l">
      <header className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate text-sm font-medium">{container.name}</h2>
            <StatusPill status={container.status} />
            {container.gpu ? <Badge variant="gpu">GPU</Badge> : null}
          </div>
          <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
            {container.id} · {container.image}
          </p>
        </div>
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close inspect">
          <X />
        </Button>
      </header>

      <div className="flex flex-wrap gap-2 border-b border-border px-4 py-2">
        {container.status === "running" ? (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              stopContainer(container.id);
              toast(`Stopped ${container.name}`);
            }}
          >
            <Square className="size-3.5" />
            Stop
          </Button>
        ) : (
          <Button
            size="sm"
            onClick={() => {
              startContainer(container.id);
              toast(`Started ${container.name}`);
            }}
          >
            <Play className="size-3.5" />
            Start
          </Button>
        )}
        <Button
          size="sm"
          variant="secondary"
          onClick={() => {
            restartContainer(container.id);
            toast(`Restarting ${container.name}`);
          }}
        >
          <RotateCcw className="size-3.5" />
          Restart
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="text-destructive"
          onClick={() => {
            deleteContainer(container.id);
            toast(`Removed ${container.name}`);
          }}
        >
          <Trash2 className="size-3.5" />
          Delete
        </Button>
      </div>

      <Tabs defaultValue="logs" className="flex min-h-0 flex-1 flex-col px-4 py-3">
        <TabsList className="w-full justify-start">
          <TabsTrigger value="logs">Logs</TabsTrigger>
          <TabsTrigger value="exec">Exec</TabsTrigger>
          <TabsTrigger value="inspect">Inspect</TabsTrigger>
        </TabsList>
        <TabsContent value="logs" className="min-h-0 flex-1">
          <LogPane container={container} />
        </TabsContent>
        <TabsContent value="exec" className="min-h-0 flex-1">
          <ExecPane container={container} />
        </TabsContent>
        <TabsContent value="inspect" className="min-h-0 flex-1 overflow-y-auto">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-xs">
            <Row k="Status" v={container.status} />
            <Row k="Image" v={container.image} />
            <Row k="Command" v={container.command.join(" ")} mono />
            <Row k="User" v={container.user} />
            <Row k="Workdir" v={container.workdir} mono />
            <Row
              k="Ports"
              v={
                container.ports.length
                  ? container.ports
                      .map((p) => `${p.host}:${p.container}/${p.protocol}`)
                      .join(", ")
                  : "none"
              }
              mono
            />
            <Row
              k="Mounts"
              v={
                container.mounts.length
                  ? container.mounts
                      .map((m) => `${m.source} → ${m.destination} (${m.mode})`)
                      .join("\n")
                  : "none"
              }
              mono
            />
            <Row k="CPU" v={`${container.cpuPercent.toFixed(1)}%`} />
            <Row
              k="Memory"
              v={`${formatBytes(container.memoryMB)} / ${formatBytes(container.memoryLimitMB)}`}
            />
            <Row k="Uptime" v={formatUptime(container.startedAt, now)} />
            {container.exitCode !== undefined ? (
              <Row k="Exit" v={String(container.exitCode)} />
            ) : null}
          </dl>
        </TabsContent>
      </Tabs>
    </aside>
  );
}

function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <>
      <dt className="text-subtle">{k}</dt>
      <dd className={mono ? "font-mono whitespace-pre-wrap break-all" : "break-all"}>{v}</dd>
    </>
  );
}

function LogPane({ container }: { container: Container }) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [container.logs.length]);

  return (
    <div className="h-64 overflow-y-auto rounded-lg border border-border bg-background p-3 font-mono text-xs leading-relaxed md:h-full">
      {container.logs.length === 0 ? (
        <p className="text-subtle">No output yet.</p>
      ) : (
        container.logs.map((l, i) => (
          <div
            key={`${l.ts}-${i}`}
            className={l.stream === "stderr" ? "text-destructive" : "text-foreground/85"}
          >
            <span className="mr-2 text-subtle">
              {new Date(l.ts).toISOString().slice(11, 19)}
            </span>
            {l.text}
          </div>
        ))
      )}
      <div ref={end} />
    </div>
  );
}

function ExecPane({ container }: { container: Container }) {
  const [cmd, setCmd] = useState("");
  const [busy, setBusy] = useState(false);
  const [lines, setLines] = useState<string[]>([
    `Connected to ${container.name} through wslc exec.`,
  ]);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [lines.length, busy]);

  async function run() {
    const value = cmd.trim();
    if (!value || busy) return;

    if (value === "clear") {
      setLines([]);
      setCmd("");
      return;
    }

    if (container.status !== "running") {
      setLines((current) => [...current, `# ${value}`, "container is not running"]);
      setCmd("");
      return;
    }

    const prompt = `${container.user || "root"}@${container.name}:${container.workdir || "/"}# ${value}`;
    setLines((current) => [...current, prompt]);
    setCmd("");
    setBusy(true);

    try {
      const result = await execInContainer(container, value);
      if (result.output) {
        setLines((current) => [...current, result.output]);
      }
      if (!result.ok && result.exitCode != null) {
        setLines((current) => [...current, `[exit ${result.exitCode}]`]);
      }
    } catch (error) {
      setLines((current) => [
        ...current,
        error instanceof Error ? error.message : String(error),
      ]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-64 flex-col rounded-lg border border-border bg-background md:h-full">
      <div className="min-h-0 flex-1 overflow-y-auto p-3 font-mono text-xs leading-relaxed">
        {lines.map((line, i) => (
          <div key={i} className="whitespace-pre-wrap text-foreground/85">
            {line}
          </div>
        ))}
        {busy ? <div className="animate-pulse text-subtle">running…</div> : null}
        <div ref={end} />
      </div>
      <form
        className="flex gap-2 border-t border-border p-2"
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
      >
        <span className="hidden items-center px-1 font-mono text-xs text-accent sm:flex">#</span>
        <Input
          value={cmd}
          onChange={(e) => setCmd(e.target.value)}
          placeholder={
            container.status === "running"
              ? "Run a shell command"
              : "start the container first"
          }
          className="h-10 font-mono text-xs"
          autoComplete="off"
          disabled={busy}
        />
        <Button type="submit" size="sm" className="h-10" disabled={busy || !cmd.trim()}>
          Run
        </Button>
      </form>
    </div>
  );
}
