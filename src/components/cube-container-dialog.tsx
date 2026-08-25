import { useEffect, useState } from "react";
import { FolderOpen } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  EnvEditor, MountEditor, joinEnvLines, joinMountLines, parseEnvLines, parseMountLines,
  type KvPair, type MountRow,
} from "@/components/kv-editor";
import { openWorkspacePath, pickWorkspaceDescendant } from "@/lib/tauri";
import {
  DEFAULT_WORKSPACE_TARGET,
  defaultCubeContainerWorkspacePath,
  defaultCubeWorkspacePath,
  isGeneratedContainerWorkspacePath,
  relativeWorkspacePath,
  resolveWorkspacePath,
} from "@/lib/workspace";
import { catalogPresets, specFromPreset } from "@/lib/wslc/catalog";
import { withoutEnvKeys } from "@/lib/wslc/groups";
import { useWslc } from "@/lib/wslc/store";
import type { ContainerGroup, RunSpec } from "@/lib/wslc/types";
import { cn } from "@/lib/utils";

const defaultSpec = specFromPreset(catalogPresets[0]!);

export function CubeContainerDialog({ cube, open, initialSpec, onOpenChange, onSave }: {
  cube: ContainerGroup | null; open: boolean; initialSpec?: RunSpec; onOpenChange: (open: boolean) => void; onSave: (spec: RunSpec) => void;
}) {
  const catalog = useWslc((s) => s.catalog);
  const images = useWslc((s) => s.images);
  const workspaceRoot = useWslc((s) => s.workspaceRoot);
  const [spec, setSpec] = useState<RunSpec>(initialSpec ?? defaultSpec);
  const [envRows, setEnvRows] = useState<KvPair[]>(() => parseEnvLines((initialSpec ?? defaultSpec).env));
  const [mountRows, setMountRows] = useState<MountRow[]>(() => parseMountLines((initialSpec ?? defaultSpec).mounts));
  const localImages = Array.from(new Set([...images.map((image) => `${image.repository}:${image.tag}`), ...catalog]));

  function applySpec(next: RunSpec) {
    const cubePath = cube?.workspacePath || defaultCubeWorkspacePath(cube?.name || "cube");
    const normalized = {
      ...next,
      groupId: cube?.id,
      workspacePath: next.workspacePath || defaultCubeContainerWorkspacePath(cubePath, next.name || "container"),
      workspaceTarget: next.workspaceTarget || DEFAULT_WORKSPACE_TARGET,
    };
    setSpec(normalized);
    setEnvRows(parseEnvLines(cube ? withoutEnvKeys(normalized.env, cube.env) : normalized.env));
    setMountRows(parseMountLines(normalized.mounts));
  }

  useEffect(() => {
    if (open) applySpec({ ...(initialSpec ?? defaultSpec), groupId: cube?.id });
  }, [open, cube?.id, initialSpec]);
  if (!cube) return null;

  const cubePath = cube.workspacePath || defaultCubeWorkspacePath(cube.name);
  const workspacePath = spec.workspacePath || defaultCubeContainerWorkspacePath(cubePath, spec.name || "container");
  const resolvedWorkspace = resolveWorkspacePath(workspaceRoot, workspacePath);
  const patch = (value: Partial<RunSpec>) => setSpec((current) => ({ ...current, ...value }));
  const selectedPreset = catalogPresets.find((preset) => preset.image === spec.image);
  const inheritedRows = parseEnvLines(cube.env).filter((row) => row.key.trim());
  const editing = Boolean(initialSpec);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90dvh] max-w-2xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b border-border px-5 py-4">
          <DialogTitle>{initialSpec ? "Edit Container" : `Add Container to ${cube.name}`}</DialogTitle>
          <DialogDescription>Cube environment variables are inherited by this container and can only be changed in Cube configuration.</DialogDescription>
        </DialogHeader>
        <form className="flex min-h-0 flex-1 flex-col" onSubmit={(event) => {
          event.preventDefault();
          const name = spec.name.trim();
          if (!name) { toast.error("Container name is required inside a Cube"); return; }
          onSave({ ...spec, name, groupId: cube.id, env: withoutEnvKeys(joinEnvLines(envRows), cube.env), mounts: joinMountLines(mountRows),
            workspacePath, workspaceTarget: spec.workspaceTarget?.trim() || DEFAULT_WORKSPACE_TARGET });
          onOpenChange(false);
        }}>
          <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto px-5 py-4">
            <div className="grid gap-1.5"><Label>Quick pick</Label><div className="flex flex-wrap gap-1.5">
              {catalogPresets.map((preset) => <button key={preset.image} type="button" onClick={() => applySpec({ ...specFromPreset(preset), groupId: cube.id })}
                className={cn("h-9 rounded-md border px-3 text-xs", spec.image === preset.image ? "border-foreground bg-elevated text-foreground" : "border-border text-muted-foreground hover:bg-elevated/70")}>{preset.label}</button>)}
            </div>{selectedPreset ? <p className="text-xs text-subtle">{selectedPreset.hint}</p> : null}</div>
            <div className="grid gap-1.5"><Label htmlFor="cube-container-image">Image</Label><Input id="cube-container-image" list="cube-image-catalog" value={spec.image} onChange={(event) => patch({ image: event.target.value })} required className="font-mono text-xs" /><datalist id="cube-image-catalog">{localImages.map((image) => <option key={image} value={image} />)}</datalist></div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5"><Label htmlFor="cube-container-name">Name</Label><Input id="cube-container-name" value={spec.name} disabled={editing} onChange={(event) => {
                const name = event.target.value;
                const generated = isGeneratedContainerWorkspacePath(spec.workspacePath, cubePath, spec.name || "container");
                patch({ name, workspacePath: generated ? defaultCubeContainerWorkspacePath(cubePath, name || "container") : spec.workspacePath });
              }} placeholder="api" required /></div>
              <div className="grid gap-1.5"><Label htmlFor="cube-container-ports">Publish ports</Label><Input id="cube-container-ports" value={spec.ports} onChange={(event) => patch({ ports: event.target.value })} placeholder="8080:80" /></div>
            </div>
            <div className="grid gap-1.5"><Label htmlFor="cube-container-command">Command</Label><Input id="cube-container-command" value={spec.command} onChange={(event) => patch({ command: event.target.value })} placeholder="optional override" /></div>
            <div className="grid gap-2 rounded-lg border border-border p-3"><Label>Workspace folder</Label><div className="flex flex-col gap-2 sm:flex-row">
              <Input value={workspacePath} onChange={(event) => patch({ workspacePath: event.target.value })} className="font-mono text-xs" aria-label="Workspace folder" />
              <Button type="button" variant="secondary" onClick={() => void (async () => { const selected = await pickWorkspaceDescendant(workspaceRoot, resolvedWorkspace); if (selected) patch({ workspacePath: relativeWorkspacePath(workspaceRoot, selected) }); })()}>Choose folder</Button>
              <Button type="button" variant="ghost" onClick={() => void openWorkspacePath(workspaceRoot, workspacePath)}><FolderOpen className="size-4" /> Open</Button>
            </div><p className="font-mono text-[11px] text-subtle">{resolvedWorkspace}</p><div className="grid gap-1.5 sm:max-w-xs"><Label htmlFor="cube-workspace-target">Container destination</Label><Input id="cube-workspace-target" value={spec.workspaceTarget || DEFAULT_WORKSPACE_TARGET} onChange={(event) => patch({ workspaceTarget: event.target.value })} className="font-mono text-xs" /></div></div>
            <EnvEditor rows={envRows} inheritedRows={inheritedRows} onChange={(rows) => { setEnvRows(rows); patch({ env: withoutEnvKeys(joinEnvLines(rows), cube.env) }); }} />
            <MountEditor rows={mountRows} onChange={(rows) => { setMountRows(rows); patch({ mounts: joinMountLines(rows) }); }} />
          </div>
          <div className="grid gap-3 border-t border-border px-5 py-3"><div className="flex flex-wrap items-center gap-5">
            <label className="flex items-center gap-2 text-sm"><Switch checked={spec.gpu} onCheckedChange={(gpu) => patch({ gpu })} />GPU</label>
            <label className="flex items-center gap-2 text-sm"><Switch checked={spec.detach} onCheckedChange={(detach) => patch({ detach })} />Detach</label>
            <label className="flex items-center gap-2 text-sm"><Switch checked={spec.remove} onCheckedChange={(remove) => patch({ remove })} />Auto-remove</label>
          </div><p className="font-mono text-[11px] text-subtle">Cube network: {cube.network} · {inheritedRows.length} inherited env · workspace → {spec.workspaceTarget || DEFAULT_WORKSPACE_TARGET}</p>
            <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button><Button type="submit">{editing ? "Save Container" : "Add to Cube"}</Button></div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
