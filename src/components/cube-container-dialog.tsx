import { useEffect, useRef, useState } from "react";
import { FolderOpen } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { EnvEditor, MountEditor, joinEnvLines, joinMountLines, parseEnvLines as editableEnvRows, parseMountLines, type KvPair, type MountRow } from "@/components/kv-editor";
import { PortBindingEditor } from "@/components/port-binding-editor";
import { openWorkspacePath, pickWorkspaceDescendant } from "@/lib/tauri";
import { DEFAULT_WORKSPACE_TARGET, defaultCubeContainerWorkspacePath, defaultCubeWorkspacePath, isGeneratedContainerWorkspacePath, relativeWorkspacePath, resolveWorkspacePath } from "@/lib/workspace";
import { catalogPresets, specFromPreset } from "@/lib/wslc/catalog";
import { applyImageDefaults } from "@/lib/wslc/container-defaults";
import { inspectImage } from "@/lib/wslc/image-inspect-client";
import { addImageVolumeMount, applyImageCommandSuggestion, applyImageInspectDefaults, imageCommandSuggestion, imageInspectEnvSourceByKey, imageReadinessMetadata, imageVolumeSuggestions, type ImageInspectDefaults } from "@/lib/wslc/image-inspect-defaults";
import { applyRuntimeEnvDefaults, missingRequiredEnv, reconcileRuntimeEnvDefaults, requiredEnvKeys, runtimeEnvSourceByKey } from "@/lib/wslc/image-runtime-env";
import { withoutEnvKeys } from "@/lib/wslc/groups";
import { useWslc } from "@/lib/wslc/store";
import type { ContainerGroup, RunSpec } from "@/lib/wslc/types";
import { cn } from "@/lib/utils";

const defaultSpec = specFromPreset(catalogPresets[0]!);

export function CubeContainerDialog({ cube, open, initialSpec, onOpenChange, onSave }: { cube: ContainerGroup | null; open: boolean; initialSpec?: RunSpec; onOpenChange: (open: boolean) => void; onSave: (spec: RunSpec) => void; }) {
  const catalog = useWslc((s) => s.catalog);
  const images = useWslc((s) => s.images);
  const workspaceRoot = useWslc((s) => s.workspaceRoot);
  const [spec, setSpec] = useState<RunSpec>(initialSpec ?? defaultSpec);
  const specRef = useRef<RunSpec>(initialSpec ?? defaultSpec);
  const inspectRequest = useRef(0);
  const [imageInspect, setImageInspect] = useState<ImageInspectDefaults | null>(null);
  const [imageVolumeSources, setImageVolumeSources] = useState<Record<string, string>>({});
  const [envRows, setEnvRows] = useState<KvPair[]>(() => editableEnvRows((initialSpec ?? defaultSpec).env));
  const [mountRows, setMountRows] = useState<MountRow[]>(() => parseMountLines((initialSpec ?? defaultSpec).mounts));
  const [nameTouched, setNameTouched] = useState(Boolean(initialSpec));
  const localImages = Array.from(new Set([...images.map((image) => `${image.repository}:${image.tag}`), ...catalog]));

  function applySpec(next: RunSpec) {
    const cubePath = cube?.workspacePath || defaultCubeWorkspacePath(cube?.name || "cube");
    const normalized = { ...next, groupId: cube?.id, workspacePath: next.workspacePath || defaultCubeContainerWorkspacePath(cubePath, next.name || "container"), workspaceTarget: next.workspaceTarget || DEFAULT_WORKSPACE_TARGET };
    specRef.current = normalized;
    setSpec(normalized); setEnvRows(editableEnvRows(cube ? withoutEnvKeys(normalized.env, cube.env) : normalized.env)); setMountRows(parseMountLines(normalized.mounts));
  }

  useEffect(() => { if (open) { inspectRequest.current += 1; setImageInspect(null); setImageVolumeSources({}); setNameTouched(Boolean(initialSpec)); applySpec({ ...(initialSpec ?? defaultSpec), groupId: cube?.id }); } }, [open, cube?.id, initialSpec]);
  if (!cube) return null;

  const cubeId = cube.id;
  const cubePath = cube.workspacePath || defaultCubeWorkspacePath(cube.name);
  const workspacePath = spec.workspacePath || defaultCubeContainerWorkspacePath(cubePath, spec.name || "container");
  const resolvedWorkspace = resolveWorkspacePath(workspaceRoot, workspacePath);
  const patch = (value: Partial<RunSpec>) => setSpec((current) => { const next = { ...current, ...value }; specRef.current = next; return next; });
  const selectedPreset = catalogPresets.find((preset) => preset.image === spec.image);
  const inheritedRows = editableEnvRows(cube.env).filter((row) => row.key.trim());
  const editing = Boolean(initialSpec);
  const localEnv = withoutEnvKeys(joinEnvLines(envRows), cube.env);
  const effectiveEnv = [cube.env, localEnv].filter(Boolean).join("\n");
  const missing = missingRequiredEnv(effectiveEnv, spec.image);
  const sourceByKey = { ...imageInspectEnvSourceByKey(imageInspect), ...runtimeEnvSourceByKey(spec.image) };
  const requiredKeys = requiredEnvKeys(spec.image);
  const suggestedCommand = imageCommandSuggestion(imageInspect);
  const suggestedVolumes = imageVolumeSuggestions(imageInspect);
  const readiness = imageReadinessMetadata(imageInspect);
  const hasImageLabels = Boolean(readiness.title || readiness.description || readiness.version || readiness.source || readiness.vendor);
  const hasImageActions = Boolean(suggestedCommand || suggestedVolumes.length);
  const hasImageMetadata = hasImageActions || Boolean(readiness.healthcheck) || hasImageLabels;

  function applyImage(image: string) {
    const current = specRef.current;
    const withImageDefaults = applyImageDefaults(current, image, nameTouched || editing);
    const next = { ...withImageDefaults, env: reconcileRuntimeEnvDefaults(withImageDefaults.env, current.image, image) };
    const generated = isGeneratedContainerWorkspacePath(current.workspacePath, cubePath, current.name || "container");
    applySpec({ ...next, groupId: cubeId, workspacePath: generated ? defaultCubeContainerWorkspacePath(cubePath, next.name || "container") : current.workspacePath });
    setImageInspect(null);
    setImageVolumeSources({});
    const request = ++inspectRequest.current;
    if (!image.trim()) return;
    void inspectImage(image).then((inspected) => {
      if (!inspected || request !== inspectRequest.current || specRef.current.image !== image) return;
      setImageInspect(inspected);
      const inspectedSpec = applyImageInspectDefaults(specRef.current, inspected);
      applySpec({ ...inspectedSpec, env: applyRuntimeEnvDefaults(inspectedSpec.env, image), groupId: cubeId });
    });
  }

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="flex max-h-[90dvh] max-w-2xl flex-col gap-0 overflow-hidden p-0">
      <DialogHeader className="border-b border-border px-5 py-4"><DialogTitle>{initialSpec ? "Edit Container" : `Add Container to ${cube.name}`}</DialogTitle><DialogDescription>Cube variables are inherited; pulled image metadata and trusted rules fill safe runtime defaults automatically.</DialogDescription></DialogHeader>
      <form className="flex min-h-0 flex-1 flex-col" onSubmit={(event) => { event.preventDefault(); const name = spec.name.trim(); if (!name) { toast.error("Container name is required inside a Cube"); return; } if (missing.length) { toast.error(`Fill required environment: ${missing.join(", ")}`); return; } onSave({ ...spec, name, groupId: cube.id, env: localEnv, mounts: joinMountLines(mountRows), workspacePath, workspaceTarget: spec.workspaceTarget?.trim() || DEFAULT_WORKSPACE_TARGET }); onOpenChange(false); }}>
        <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto px-5 py-4">
          <div className="grid gap-1.5"><Label>Quick pick</Label><div className="flex flex-wrap gap-1.5">{catalogPresets.map((preset) => <button key={preset.image} type="button" onClick={() => { setNameTouched(false); setImageInspect(null); setImageVolumeSources({}); inspectRequest.current += 1; const presetSpec = specFromPreset(preset); applySpec({ ...presetSpec, env: applyRuntimeEnvDefaults(presetSpec.env, preset.image), groupId: cube.id }); applyImage(preset.image); }} className={cn("h-9 rounded-md border px-3 text-xs", spec.image === preset.image ? "border-foreground bg-elevated text-foreground" : "border-border text-muted-foreground hover:bg-elevated/70")}>{preset.label}</button>)}</div>{selectedPreset ? <p className="text-xs text-subtle">{selectedPreset.hint}</p> : null}</div>
          <div className="grid gap-1.5"><Label htmlFor="cube-container-image">Image</Label><Input id="cube-container-image" list="cube-image-catalog" value={spec.image} onChange={(event) => applyImage(event.target.value)} required className="font-mono text-xs" /><datalist id="cube-image-catalog">{localImages.map((image) => <option key={image} value={image} />)}</datalist></div>
          <div className="grid gap-1.5"><Label htmlFor="cube-container-name">Name</Label><Input id="cube-container-name" value={spec.name} disabled={editing} onChange={(event) => { setNameTouched(true); const name = event.target.value; const generated = isGeneratedContainerWorkspacePath(spec.workspacePath, cubePath, spec.name || "container"); patch({ name, workspacePath: generated ? defaultCubeContainerWorkspacePath(cubePath, name || "container") : spec.workspacePath }); }} placeholder="api" required /></div>
          <PortBindingEditor value={spec.ports} onChange={(ports) => patch({ ports })} />
          <div className="grid gap-1.5"><Label htmlFor="cube-container-command">Command</Label><Input id="cube-container-command" value={spec.command} onChange={(event) => patch({ command: event.target.value })} placeholder="optional override" /></div>
          {hasImageMetadata ? <div className="grid gap-3 rounded-lg border border-border bg-elevated/30 p-3">
            <div><Label>Image defaults</Label><p className="text-xs text-subtle">Optional OCI defaults from the selected image. Quay never replaces your explicit command or invents a host mount source.</p></div>
            {suggestedCommand ? <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]"><div className="rounded-md border border-border bg-background px-3 py-2 font-mono text-xs">{suggestedCommand}</div><Button type="button" variant="secondary" disabled={Boolean(spec.command.trim())} onClick={() => patch({ command: applyImageCommandSuggestion(spec.command, imageInspect) })}>Use command</Button></div> : null}
            {suggestedVolumes.map((destination) => {
              const duplicate = mountRows.some((row) => row.destination.trim() === destination);
              const source = imageVolumeSources[destination] ?? "";
              return <div key={destination} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]"><div className="rounded-md border border-border bg-background px-3 py-2 font-mono text-xs">{destination}</div><Input value={source} onChange={(event) => setImageVolumeSources((current) => ({ ...current, [destination]: event.target.value }))} placeholder="Host source" aria-label={`Host source for ${destination}`} className="font-mono text-xs" /><Button type="button" variant="secondary" disabled={duplicate || !source.trim()} onClick={() => { const nextRows = addImageVolumeMount(mountRows, source, destination); setMountRows(nextRows); patch({ mounts: joinMountLines(nextRows) }); }}>Add mount</Button></div>;
            })}
            {readiness.healthcheck ? <div className="grid gap-1.5 rounded-md border border-border bg-background p-3"><Label>Healthcheck</Label><p className="break-all font-mono text-xs">{readiness.healthcheck.test.join(" ")}</p><p className="text-[11px] text-subtle">Interval {readiness.healthcheck.intervalMs} ms · Timeout {readiness.healthcheck.timeoutMs} ms · Retries {readiness.healthcheck.retries} · Start period {readiness.healthcheck.startPeriodMs} ms</p><p className="text-[11px] text-subtle">Image metadata only; the current WSLC RunSpec does not expose healthcheck override fields.</p></div> : null}
            {hasImageLabels ? <div className="grid gap-1.5 rounded-md border border-border bg-background p-3"><Label>Image labels</Label><div className="grid gap-1 text-xs">{readiness.title ? <p><span className="text-subtle">Title:</span> {readiness.title}</p> : null}{readiness.description ? <p><span className="text-subtle">Description:</span> {readiness.description}</p> : null}{readiness.version ? <p><span className="text-subtle">Version:</span> {readiness.version}</p> : null}{readiness.vendor ? <p><span className="text-subtle">Vendor:</span> {readiness.vendor}</p> : null}{readiness.source ? <p className="break-all"><span className="text-subtle">Source:</span> {readiness.source}</p> : null}</div></div> : null}
          </div> : null}
          <div className="grid gap-2 rounded-lg border border-border p-3"><Label>Workspace folder</Label><div className="flex flex-col gap-2 sm:flex-row"><Input value={workspacePath} onChange={(event) => patch({ workspacePath: event.target.value })} className="font-mono text-xs" aria-label="Workspace folder" /><Button type="button" variant="secondary" onClick={() => void (async () => { const selected = await pickWorkspaceDescendant(workspaceRoot, resolvedWorkspace); if (selected) patch({ workspacePath: relativeWorkspacePath(workspaceRoot, selected) }); })()}>Choose folder</Button><Button type="button" variant="ghost" onClick={() => void openWorkspacePath(workspaceRoot, workspacePath)}><FolderOpen className="size-4" /> Open</Button></div><p className="font-mono text-[11px] text-subtle">{resolvedWorkspace}</p><div className="grid gap-1.5 sm:max-w-xs"><Label htmlFor="cube-workspace-target">Container destination</Label><Input id="cube-workspace-target" value={spec.workspaceTarget || DEFAULT_WORKSPACE_TARGET} onChange={(event) => patch({ workspaceTarget: event.target.value })} className="font-mono text-xs" /></div></div>
          <EnvEditor rows={envRows} inheritedRows={inheritedRows} sourceByKey={sourceByKey} requiredKeys={requiredKeys} onChange={(rows) => { setEnvRows(rows); patch({ env: withoutEnvKeys(joinEnvLines(rows), cube.env) }); }} />
          {missing.length ? <p className="text-xs text-destructive">Fill required environment: {missing.join(", ")}</p> : null}
          <MountEditor rows={mountRows} onChange={(rows) => { setMountRows(rows); patch({ mounts: joinMountLines(rows) }); }} />
        </div>
        <div className="grid gap-3 border-t border-border px-5 py-3"><div className="flex flex-wrap items-center gap-5"><label className="flex items-center gap-2 text-sm"><Switch checked={spec.gpu} onCheckedChange={(gpu) => patch({ gpu })} />GPU</label><label className="flex items-center gap-2 text-sm"><Switch checked={spec.detach} onCheckedChange={(detach) => patch({ detach })} />Detach</label><label className="flex items-center gap-2 text-sm"><Switch checked={spec.remove} onCheckedChange={(remove) => patch({ remove })} />Auto-remove</label></div><p className="font-mono text-[11px] text-subtle">Cube network: {cube.network} · {inheritedRows.length} inherited env · workspace → {spec.workspaceTarget || DEFAULT_WORKSPACE_TARGET}</p><div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button><Button type="submit" disabled={missing.length > 0}>{editing ? "Save Container" : "Add to Cube"}</Button></div></div>
      </form>
    </DialogContent>
  </Dialog>;
}
