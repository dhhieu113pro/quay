import { useEffect, useMemo, useState } from "react";
import { Boxes, FileText, FolderOpen, LoaderCircle, Pencil, Play, Plus, Square, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { CubeContainerDialog } from "@/components/cube-container-dialog";
import { EnvEditor, joinEnvLines, parseEnvLines, type KvPair } from "@/components/kv-editor";
import { RunCubeDialog } from "@/components/run-cube-dialog";
import { applyStackConfig, loadStackConfig } from "@/components/stack-config-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { moveWorkspaceEntry, openWorkspacePath } from "@/lib/tauri";
import { defaultCubeWorkspacePath, isGeneratedCubeWorkspacePath, resolveWorkspacePath } from "@/lib/workspace";
import { cubeCanConfigure, cubeCanStart, cubeNetworkName, effectiveSpec, slugGroupName, specConfigured, syncGroupEnv } from "@/lib/wslc/groups";
import { openLogs } from "@/lib/wslc/log-store";
import { useWslc, type OperationStatus } from "@/lib/wslc/store";
import type { Container, ContainerGroup, RunSpec } from "@/lib/wslc/types";

function emptyCube(): ContainerGroup {
  const id = `cube-${Date.now()}`;
  return { id, name: "", network: cubeNetworkName(""), env: "", builtIn: false, autoStart: false, specs: [] };
}

type Member = { name: string; image: string; spec?: RunSpec; container?: Container };
function membersOf(cube: ContainerGroup, containers: Container[]): Member[] {
  const names = new Set(cube.specs.map((spec) => spec.name).filter(Boolean));
  const runtime = containers.filter((c) => c.groupId === cube.id || names.has(c.name));
  const rows: Member[] = cube.specs.map((spec) => ({ name: spec.name || spec.image, image: spec.image, spec, container: runtime.find((c) => c.name === spec.name) }));
  for (const container of runtime) if (!names.has(container.name)) rows.push({ name: container.name, image: container.image, container });
  return rows;
}

function needsConfig(cube: ContainerGroup, member: Member) {
  if (!member.spec || !specConfigured(member.spec, cube)) return true;
  if (cube.id !== "local-coding" || member.name !== "local-coding-mcp-ngrok") return false;
  const env = effectiveSpec(member.spec, cube).env;
  const token = env.split("\n").find((line) => line.startsWith("NGROK_AUTHTOKEN="))?.slice(16).trim();
  return !token && !loadStackConfig(cube.id).ngrokToken.trim();
}

function operationLabel(status?: OperationStatus) {
  switch (status) {
    case "starting": return "Starting…";
    case "stopping": return "Stopping…";
    case "restarting": return "Restarting…";
    case "removing": return "Removing…";
    default: return null;
  }
}

export function CubesView() {
  const groups = useWslc((s) => s.groups);
  const containers = useWslc((s) => s.containers);
  const operations = useWslc((s) => s.operations);
  const saveGroup = useWslc((s) => s.saveGroup);
  const deleteGroup = useWslc((s) => s.deleteGroup);
  const startGroup = useWslc((s) => s.startGroup);
  const stopGroup = useWslc((s) => s.stopGroup);
  const startGroupContainer = useWslc((s) => s.startGroupContainer);
  const startContainer = useWslc((s) => s.startContainer);
  const stopContainer = useWslc((s) => s.stopContainer);
  const [editing, setEditing] = useState<ContainerGroup | null>(null);
  const [containerEditor, setContainerEditor] = useState<{ cube: ContainerGroup } | null>(null);
  const [runOpen, setRunOpen] = useState(false);

  const counts = useMemo(() => new Map(groups.map((cube) => {
    const members = membersOf(cube, containers);
    return [cube.id, { total: members.length, running: members.filter((member) => member.container?.status === "running").length }];
  })), [groups, containers]);

  function saveMember(cube: ContainerGroup, spec: RunSpec) {
    if (!cubeCanConfigure(cube, containers, operations)) { toast.error(`Stop ${cube.name} before changing container configuration`); return false; }
    saveGroup(syncGroupEnv({ ...cube, specs: [...cube.specs.filter((x) => x.name !== spec.name), { ...spec, groupId: cube.id }] }));
    toast(`Added ${spec.name} to ${cube.name}`);
    return true;
  }

  return <>
    <div className="mx-auto w-full max-w-6xl p-4 sm:p-6">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div><h1 className="text-xl font-semibold">Cubes</h1><p className="mt-1 text-sm text-muted-foreground">Define related containers with one network, shared environment, and a managed workspace.</p></div>
        <div className="flex gap-2"><Button variant="secondary" onClick={() => setRunOpen(true)}><Play className="size-4" />Run Cube</Button><Button onClick={() => setEditing(emptyCube())}><Plus className="size-4" />New Cube</Button></div>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        {groups.map((cube) => {
          const members = membersOf(cube, containers);
          const count = counts.get(cube.id) ?? { total: 0, running: 0 };
          const cubeStatus = operations[`cube:${cube.id}`];
          const busy = Boolean(cubeStatus);
          const canConfigure = cubeCanConfigure(cube, containers, operations);
          const missing = members.filter((member) => needsConfig(cube, member)).length;
          const canStart = cubeCanStart(cube, containers, operations) && missing === 0;
          return <section key={cube.id} className="overflow-hidden rounded-xl border border-border bg-card">
            <div className="p-4">
              <div className="flex items-start gap-3"><div className="grid size-10 place-items-center rounded-md bg-elevated"><Boxes className="size-5" /></div><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><h2 className="font-medium">{cube.name}</h2>{cube.builtIn ? <span className="rounded bg-elevated px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">Built-in</span> : null}{cubeStatus ? <span className="text-xs text-muted-foreground">{operationLabel(cubeStatus)}</span> : null}</div><p className="mt-1 text-xs text-muted-foreground">{count.running} running · {members.length} members · {cube.network}</p><p className="mt-1 truncate font-mono text-[11px] text-subtle">{cube.workspacePath || defaultCubeWorkspacePath(cube.name)}</p>{missing > 0 ? <p className="mt-1 text-xs text-warn">{missing} {missing === 1 ? "member needs" : "members need"} configuration before this Cube can start.</p> : null}</div></div>
            </div>
            <ul className="divide-y divide-border border-y border-border bg-background/35">{members.map((member) => {
              const running = member.container?.status === "running";
              const memberStatus = operations[`container:${member.name}`];
              const memberBusy = busy || Boolean(memberStatus);
              const blocked = needsConfig(cube, member);
              return <li key={member.name} className="flex items-center gap-2 px-4 py-2.5"><span className={`size-2 rounded-full ${running ? "bg-ok" : blocked ? "bg-warn" : "bg-subtle"}`} /><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{member.name}</p><p className="truncate font-mono text-[11px] text-subtle">{member.image}</p></div>
                {memberStatus ? <span className="text-xs text-muted-foreground">{operationLabel(memberStatus)}</span> : null}
                <Button size="icon-sm" variant="ghost" disabled={memberBusy || (!running && blocked)} onClick={() => {
                  if (running && member.container) stopContainer(member.container.id);
                  else if (member.spec) { if (cube.id === "local-coding") applyStackConfig(cube); startGroupContainer(cube.id, member.name); }
                  else if (member.container) startContainer(member.container.id);
                }}>{memberBusy ? <LoaderCircle className="size-3.5 animate-spin" /> : running ? <Square className="size-3.5" /> : <Play className="size-3.5" />}</Button></li>;
            })}</ul>
            <div className="flex flex-wrap gap-2 p-4">
              <Button size="sm" disabled={!count.total || busy || (count.running === 0 && !canStart)} onClick={() => count.running ? stopGroup(cube.id) : startGroup(cube.id)}>{busy ? <LoaderCircle className="size-3.5 animate-spin" /> : count.running ? <Square className="size-3.5" /> : <Play className="size-3.5" />}{cubeStatus === "starting" ? "Starting…" : cubeStatus === "stopping" ? "Stopping…" : count.running ? "Stop Cube" : "Start Cube"}</Button>
              <Button size="icon-sm" variant="ghost" aria-label={`Logs for ${cube.name}`} title={`Logs for ${cube.name}`} onClick={() => openLogs({ cubeId: cube.id })}><FileText className="size-3.5" /></Button>
              <Button size="sm" variant="outline" disabled={!canConfigure} onClick={() => setContainerEditor({ cube })}><Plus className="size-3.5" />Add Container</Button>
              <Button size="sm" variant="ghost" disabled={!canConfigure} onClick={() => setEditing(syncGroupEnv(cube))}><Pencil className="size-3.5" />Configure</Button>
              {!cube.builtIn ? <Button size="sm" variant="ghost" className="ml-auto" disabled={!canConfigure} onClick={() => deleteGroup(cube.id)}><Trash2 className="size-3.5" />Delete</Button> : null}
            </div>
          </section>;
        })}
      </div>
      <CubeDialog cube={editing} onClose={() => setEditing(null)} onSave={(cube) => { saveGroup(syncGroupEnv(cube)); toast(`Saved ${cube.name}`); setEditing(null); }} />
    </div>
    <RunCubeDialog open={runOpen} onOpenChange={setRunOpen} />
    <CubeContainerDialog cube={containerEditor?.cube ?? null} open={Boolean(containerEditor)} onOpenChange={(open) => { if (!open) setContainerEditor(null); }} onSave={(spec) => { if (containerEditor && saveMember(containerEditor.cube, spec)) setContainerEditor(null); }} />
  </>;
}

function CubeDialog({ cube, onClose, onSave }: { cube: ContainerGroup | null; onClose: () => void; onSave: (cube: ContainerGroup) => void }) {
  const workspaceRoot = useWslc((s) => s.workspaceRoot);
  const [draft, setDraft] = useState<ContainerGroup | null>(cube ? syncGroupEnv(cube) : null);
  const [envRows, setEnvRows] = useState<KvPair[]>(() => parseEnvLines(cube ? syncGroupEnv(cube).env : ""));
  const [rename, setRename] = useState<{ next: ContainerGroup; from: string; to: string } | null>(null);
  const creating = Boolean(cube && !cube.name.trim());
  useEffect(() => { const next = cube ? syncGroupEnv(cube) : null; setDraft(next); setEnvRows(parseEnvLines(next?.env ?? "")); setRename(null); }, [cube]);
  if (!cube || !draft) return null;

  const currentCube: ContainerGroup = cube;
  const currentDraft: ContainerGroup = draft;
  const workspacePath = currentDraft.workspacePath || defaultCubeWorkspacePath(currentDraft.name || "cube");
  const containerEnvKeys = new Set(currentDraft.protectedEnvKeys ?? []);
  let resolved = workspaceRoot; try { resolved = resolveWorkspacePath(workspaceRoot, workspacePath); } catch { /* stored path remains visible */ }
  const patch = (value: Partial<ContainerGroup>) => setDraft((current) => current ? { ...current, ...value } : current);

  function save() {
    const name = currentDraft.name.trim();
    if (!name) return;
    const next: ContainerGroup = syncGroupEnv({ ...currentDraft, name, env: joinEnvLines(envRows), workspacePath, network: cubeNetworkName(name) });
    const from = currentCube.workspacePath || defaultCubeWorkspacePath(currentCube.name || name);
    const to = defaultCubeWorkspacePath(name);
    if (!creating && name !== currentCube.name && isGeneratedCubeWorkspacePath(from, currentCube.name) && from !== to) { setRename({ next, from, to }); return; }
    onSave(next);
  }

  async function finish(mode: "rename" | "keep") {
    if (!rename) return;
    try {
      if (mode === "rename") { await moveWorkspaceEntry(workspaceRoot, rename.from, rename.to); onSave({ ...rename.next, workspacePath: rename.to }); }
      else onSave({ ...rename.next, workspacePath: rename.from });
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not move Cube workspace"); }
  }

  return <>
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}><DialogContent className="max-w-2xl"><DialogHeader><DialogTitle>{currentDraft.builtIn ? `Configure ${currentDraft.name}` : currentDraft.name ? `Edit ${currentDraft.name}` : "Create cube"}</DialogTitle><DialogDescription>Cube settings and managed workspace folder.</DialogDescription></DialogHeader>
      <div className="grid gap-4">
        <div className="grid gap-1.5"><Label>Name</Label><Input value={currentDraft.name} disabled={currentDraft.builtIn} onChange={(event) => { const name = event.target.value; if (creating) { const id = slugGroupName(name); patch({ name, id, network: cubeNetworkName(name), workspacePath: defaultCubeWorkspacePath(name || "cube") }); } else patch({ name, network: cubeNetworkName(name) }); }} /></div>
        <div className="grid gap-1.5"><Label>WSLC network</Label><Input value={cubeNetworkName(currentDraft.name)} disabled className="font-mono text-xs" /></div>
        <div className="grid gap-2 rounded-lg border border-border p-3"><Label>Workspace folder</Label><div className="flex gap-2"><Input value={workspacePath} readOnly className="font-mono text-xs" /><Button type="button" variant="ghost" onClick={() => void openWorkspacePath(workspaceRoot, workspacePath)}><FolderOpen className="size-4" />Open</Button></div><p className="font-mono text-[11px] text-subtle">{resolved}</p></div>
        <EnvEditor label="Shared environment" rows={envRows} protectedKeys={containerEnvKeys} onChange={(rows) => { setEnvRows(rows); patch({ env: joinEnvLines(rows) }); }} />
      </div>
      <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save}>Save Cube</Button></div>
    </DialogContent></Dialog>
    <Dialog open={Boolean(rename)} onOpenChange={(open) => { if (!open) setRename(null); }}><DialogContent className="max-w-lg"><DialogHeader><DialogTitle>Rename Cube workspace folder?</DialogTitle><DialogDescription>Rename the generated folder to match the Cube name, or keep the existing folder.</DialogDescription></DialogHeader><div className="grid gap-2 sm:grid-cols-3"><Button onClick={() => void finish("rename")}>Rename folder</Button><Button variant="secondary" onClick={() => void finish("keep")}>Keep existing folder</Button><Button variant="ghost" onClick={() => setRename(null)}>Cancel</Button></div></DialogContent></Dialog>
  </>;
}
