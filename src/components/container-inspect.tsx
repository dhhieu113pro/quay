import { useEffect, useRef, useState } from "react";
import { Copy, LoaderCircle, Play, RotateCcw, Square, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { CloneContainerDialog } from "@/components/clone-container-dialog";
import { EnvEditor, joinEnvLines, parseEnvLines as editableEnvRows, type KvPair } from "@/components/kv-editor";
import { PortBindingEditor } from "@/components/port-binding-editor";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StatusPill } from "@/components/status-pill";
import { formatUptime } from "@/lib/utils";
import { loadExistingContainerConfig, recreateContainerWithEnv } from "@/lib/wslc/existing-container-env-client";
import type { ExistingContainerConfig } from "@/lib/wslc/existing-container-env";
import { withoutEnvKeys } from "@/lib/wslc/groups";
import { hasPublishedHostPortErrors } from "@/lib/wslc/image-inspect-defaults";
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
  const groups = useWslc((s) => s.groups);
  const tick = useWslc((s) => s.tick);
  const operations = useWslc((s) => s.operations);
  const now = useWslc((s) => s.now);
  const [tab, setTab] = useState("logs");
  const [cloneOpen, setCloneOpen] = useState(false);
  const operation = operations[`container:${container.name}`];
  const busy = Boolean(operation);
  const cube = groups.find((group) => group.id === container.groupId);

  return (
    <>
      <aside className="flex h-full min-h-0 flex-col border-border bg-card md:border-l">
        <header className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate text-sm font-medium">{container.name}</h2>
              <StatusPill status={container.status} />
              {operation ? <span className="text-xs text-muted-foreground">{operation === "starting" ? "Starting…" : operation === "stopping" ? "Stopping…" : operation === "restarting" ? "Restarting…" : operation === "removing" ? "Removing…" : null}</span> : null}
              {container.gpu ? <Badge variant="gpu">GPU</Badge> : null}
            </div>
            <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
              {container.id} · {container.image}
            </p>
          </div>
          <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close inspect"><X /></Button>
        </header>

        <div className="flex flex-wrap gap-2 border-b border-border px-4 py-2">
          {container.status === "running" ? (
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => { stopContainer(container.id); toast(`Stopping ${container.name}`); }}>
              {operation === "stopping" ? <LoaderCircle className="size-3.5 animate-spin" /> : <Square className="size-3.5" />}
              {operation === "stopping" ? "Stopping…" : "Stop"}
            </Button>
          ) : (
            <Button size="sm" disabled={busy} onClick={() => { startContainer(container.id); toast(`Starting ${container.name}`); }}>
              {operation === "starting" ? <LoaderCircle className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
              {operation === "starting" ? "Starting…" : "Start"}
            </Button>
          )}
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => { restartContainer(container.id); toast(`Restarting ${container.name}`); }}>
            <RotateCcw className={operation === "restarting" ? "size-3.5 animate-spin" : "size-3.5"} />
            {operation === "restarting" ? "Restarting…" : "Restart"}
          </Button>
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => setCloneOpen(true)}>
            <Copy className="size-3.5" />Clone
          </Button>
          <Button size="sm" variant="ghost" className="text-destructive" disabled={busy} onClick={() => { deleteContainer(container.id); toast(`Removing ${container.name}`); }}>
            {operation === "removing" ? <LoaderCircle className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
            {operation === "removing" ? "Removing…" : "Delete"}
          </Button>
        </div>

        <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col px-4 py-3">
          <TabsList className="w-full justify-start"><TabsTrigger value="logs">Logs</TabsTrigger><TabsTrigger value="exec">Exec</TabsTrigger><TabsTrigger value="environment">Environment</TabsTrigger><TabsTrigger value="ports">Ports</TabsTrigger><TabsTrigger value="inspect">Inspect</TabsTrigger></TabsList>
          <TabsContent value="logs" className="min-h-0 flex-1">{tab === "logs" ? <LogPane container={container} /> : null}</TabsContent>
          <TabsContent value="exec" className="min-h-0 flex-1"><ExecPane container={container} /></TabsContent>
          <TabsContent value="environment" className="min-h-0 flex-1">{tab === "environment" ? <EnvironmentPane container={container} inheritedEnv={cube?.env ?? ""} onSaved={async () => { await tick(); onClose(); }} /> : null}</TabsContent>
          <TabsContent value="ports" className="min-h-0 flex-1">{tab === "ports" ? <PortBindingsPane container={container} onSaved={async () => { await tick(); onClose(); }} /> : null}</TabsContent>
          <TabsContent value="inspect" className="min-h-0 flex-1 overflow-y-auto">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-xs">
              <Row k="Status" v={container.status} /><Row k="Image" v={container.image} /><Row k="Command" v={container.command.join(" ") || "—"} mono /><Row k="User" v={container.user || "—"} /><Row k="Workdir" v={container.workdir || "/"} mono />
              <Row k="Mounts" v={container.mounts.length ? container.mounts.map((m) => `${m.source} → ${m.destination} (${m.mode})`).join("\n") : "not reported by container list"} mono />
              <Row k="Uptime" v={container.status === "running" ? formatUptime(container.startedAt, now) : "—"} />
              {container.exitCode !== undefined ? <Row k="Exit" v={String(container.exitCode)} /> : null}
            </dl>
            <p className="mt-4 text-[11px] leading-relaxed text-subtle">Quay only shows fields returned by the current WSLC list data here. Resource usage is intentionally omitted unless WSLC reports it directly.</p>
          </TabsContent>
        </Tabs>
      </aside>
      <CloneContainerDialog container={container} open={cloneOpen} onOpenChange={setCloneOpen} />
    </>
  );
}

function PortBindingsPane({ container, onSaved }: { container: Container; onSaved: () => Promise<void> }) {
  const [config, setConfig] = useState<ExistingContainerConfig | null>(null);
  const [ports, setPorts] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true); setError(null);
    void loadExistingContainerConfig(container.name)
      .then((loaded) => {
        if (!active) return;
        setConfig(loaded);
        setPorts(loaded.ports);
      })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : String(reason)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [container.name]);

  async function save() {
    if (!config || saving || container.status === "running" || hasPublishedHostPortErrors(ports) || ports === config.ports) return;
    setSaving(true); setError(null);
    try {
      await recreateContainerWithEnv({ ...config, ports }, config.env, false);
      toast.success(`Recreated ${container.name} with updated ports`);
      await onSaved();
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      setError(message); toast.error(message);
    } finally { setSaving(false); }
  }

  if (loading) return <div className="flex h-40 items-center justify-center text-sm text-subtle"><LoaderCircle className="mr-2 size-4 animate-spin" />Loading port bindings…</div>;
  if (!config) return <p className="text-xs text-destructive">{error || "Could not inspect container port bindings."}</p>;
  if (!config.ports.trim()) return <div className="rounded-md border border-border bg-elevated/20 p-3 text-xs text-subtle">Ports: none published.</div>;

  const invalidPorts = hasPublishedHostPortErrors(ports);
  const unchanged = ports === config.ports;
  const readOnly = container.status === "running";
  return <div className="grid max-h-full gap-3 overflow-y-auto pb-2">
    <div className="rounded-md border border-border bg-elevated/30 p-3 text-xs text-subtle">{readOnly ? "Stop the container to edit port bindings. Current bindings are shown read-only." : "Port changes require container recreation. Only the outside/host port is editable; the container port and protocol stay unchanged. Quay will recreate it and keep the replacement stopped."}</div>
    <PortBindingEditor value={ports} onChange={setPorts} disabled={container.status === "running"} />
    {error ? <p className="text-xs text-destructive">{error}</p> : null}
    <div className="flex justify-end"><Button onClick={() => void save()} disabled={readOnly || saving || invalidPorts || unchanged}>{saving ? <LoaderCircle className="size-4 animate-spin" /> : null}{saving ? "Recreating…" : "Save & recreate"}</Button></div>
  </div>;
}

function EnvironmentPane({ container, inheritedEnv, onSaved }: { container: Container; inheritedEnv: string; onSaved: () => Promise<void> }) {
  const [config, setConfig] = useState<ExistingContainerConfig | null>(null);
  const [rows, setRows] = useState<KvPair[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inheritedRows = editableEnvRows(inheritedEnv).filter((row) => row.key.trim());

  useEffect(() => {
    let active = true;
    setLoading(true); setError(null);
    void loadExistingContainerConfig(container.name)
      .then((loaded) => {
        if (!active) return;
        setConfig(loaded);
        setRows(editableEnvRows(withoutEnvKeys(loaded.env, inheritedEnv)));
      })
      .catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : String(reason)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [container.name, inheritedEnv]);

  async function save() {
    if (!config || saving) return;
    setSaving(true); setError(null);
    const localEnv = joinEnvLines(rows);
    const effectiveEnv = [inheritedEnv, localEnv].filter(Boolean).join("\n");
    try {
      await recreateContainerWithEnv(config, effectiveEnv, container.status === "running");
      toast.success(`Recreated ${container.name} with updated environment`);
      await onSaved();
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      setError(message); toast.error(message);
    } finally { setSaving(false); }
  }

  if (loading) return <div className="flex h-40 items-center justify-center text-sm text-subtle"><LoaderCircle className="mr-2 size-4 animate-spin" />Loading environment…</div>;
  if (!config) return <div className="grid gap-3"><p className="text-sm text-destructive">{error || "Could not inspect container environment."}</p></div>;

  return <div className="grid max-h-full gap-3 overflow-y-auto pb-2">
    <div className="rounded-md border border-border bg-elevated/30 p-3 text-xs text-subtle">Environment changes require container recreation. {container.status === "running" ? "Quay will stop it, recreate it, and leave the replacement running." : "Quay will recreate it and keep the replacement stopped."}</div>
    <EnvEditor rows={rows} inheritedRows={inheritedRows} onChange={setRows} />
    {error ? <p className="text-xs text-destructive">{error}</p> : null}
    <div className="flex justify-end"><Button onClick={() => void save()} disabled={saving}>{saving ? <LoaderCircle className="size-4 animate-spin" /> : null}{saving ? "Recreating…" : "Save & recreate"}</Button></div>
  </div>;
}

function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return <><dt className="text-subtle">{k}</dt><dd className={mono ? "font-mono whitespace-pre-wrap break-all" : "break-all"}>{v}</dd></>;
}

function LogPane({ container }: { container: Container }) {
  const refreshLogs = useWslc((s) => s.refreshLogs);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { if (container.status !== "running") return; void refreshLogs(container.id); const id = window.setInterval(() => void refreshLogs(container.id), 3000); return () => window.clearInterval(id); }, [container.id, container.status, refreshLogs]);
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [container.logs.length]);
  return <div className="h-64 overflow-y-auto rounded-lg border border-border bg-background p-3 font-mono text-xs leading-relaxed md:h-full">
    {container.logs.length === 0 ? <p className="text-subtle">{container.status === "running" ? "No output yet." : "Start the container to read logs."}</p> : container.logs.map((line, index) => <div key={`${line.ts}-${index}`} className={line.stream === "stderr" ? "text-destructive" : "text-foreground/85"}>{line.text}</div>)}<div ref={end} />
  </div>;
}

function ExecPane({ container }: { container: Container }) {
  const [cmd, setCmd] = useState("");
  const [busy, setBusy] = useState(false);
  const [lines, setLines] = useState<string[]>([`Connected to ${container.name} through wslc exec.`]);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [lines.length, busy]);
  async function run() {
    const value = cmd.trim(); if (!value || busy) return;
    if (value === "clear") { setLines([]); setCmd(""); return; }
    if (container.status !== "running") { setLines((current) => [...current, `# ${value}`, "container is not running"]); setCmd(""); return; }
    const prompt = `${container.user || "root"}@${container.name}:${container.workdir || "/"}# ${value}`;
    setLines((current) => [...current, prompt]); setCmd(""); setBusy(true);
    try { const result = await execInContainer(container, value); if (result.output) setLines((current) => [...current, result.output]); if (!result.ok && result.exitCode != null) setLines((current) => [...current, `[exit ${result.exitCode}]`]); }
    catch (error) { setLines((current) => [...current, error instanceof Error ? error.message : String(error)]); }
    finally { setBusy(false); }
  }
  return <div className="flex h-64 flex-col rounded-lg border border-border bg-background md:h-full"><div className="min-h-0 flex-1 overflow-y-auto p-3 font-mono text-xs leading-relaxed">{lines.map((line, index) => <div key={index} className="whitespace-pre-wrap text-foreground/85">{line}</div>)}{busy ? <div className="animate-pulse text-subtle">running…</div> : null}<div ref={end} /></div><form className="flex gap-2 border-t border-border p-2" onSubmit={(event) => { event.preventDefault(); void run(); }}><span className="hidden items-center px-1 font-mono text-xs text-accent sm:flex">#</span><Input value={cmd} onChange={(event) => setCmd(event.target.value)} placeholder={container.status === "running" ? "Run a shell command" : "start the container first"} className="h-10 font-mono text-xs" autoComplete="off" disabled={busy} /><Button type="submit" size="sm" className="h-10" disabled={busy || !cmd.trim()}>Run</Button></form></div>;
}
