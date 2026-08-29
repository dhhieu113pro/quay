import { useEffect, useMemo, useRef, useState } from "react";
import { FolderOpen, LoaderCircle } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { EnvEditor, MountEditor, joinEnvLines, joinMountLines, parseEnvLines as editableEnvRows, parseMountLines, type KvPair, type MountRow } from "@/components/kv-editor";
import { ImagePicker } from "@/components/image-picker";
import { PortBindingEditor } from "@/components/port-binding-editor";
import { openWorkspacePath, pickWorkspaceDescendant } from "@/lib/tauri";
import { DEFAULT_WORKSPACE_TARGET, defaultStandaloneWorkspacePath, isGeneratedContainerWorkspacePath, relativeWorkspacePath, resolveWorkspacePath } from "@/lib/workspace";
import { applyImageDefaults } from "@/lib/wslc/container-defaults";
import { inspectImage } from "@/lib/wslc/image-inspect-client";
import { addImageVolumeMount, applyImageCommandSuggestion, applyImageInspectDefaults, hasPublishedHostPortErrors, imageCommandSuggestion, imageInspectEnvSourceByKey, imageReadinessMetadata, imageVolumeSuggestions, type ImageInspectDefaults } from "@/lib/wslc/image-inspect-defaults";
import { applyRuntimeEnvDefaults, missingRequiredEnv, reconcileRuntimeEnvDefaults, requiredEnvKeys, runtimeEnvSourceByKey } from "@/lib/wslc/image-runtime-env";
import { useWslc } from "@/lib/wslc/store";
import { cliForRun } from "@/lib/wslc/csharp";
import type { RunSpec } from "@/lib/wslc/types";

const defaultSpec: RunSpec = { image: "", name: "", command: "", ports: "", env: "", mounts: "", gpu: false, remove: false, detach: true, workdir: "/", workspacePath: undefined, workspaceTarget: DEFAULT_WORKSPACE_TARGET, groupId: undefined };

export function RunDialog() {
  const open = useWslc((s) => s.runOpen);
  const setRunOpen = useWslc((s) => s.setRunOpen);
  const runContainer = useWslc((s) => s.runContainer);
  const images = useWslc((s) => s.images);
  const operations = useWslc((s) => s.operations);
  const workspaceRoot = useWslc((s) => s.workspaceRoot);
  const [spec, setSpec] = useState<RunSpec>(defaultSpec);
  const specRef = useRef<RunSpec>(defaultSpec);
  const inspectRequest = useRef(0);
  const [imageInspect, setImageInspect] = useState<ImageInspectDefaults | null>(null);
  const [imageVolumeSources, setImageVolumeSources] = useState<Record<string, string>>({});
  const [envRows, setEnvRows] = useState<KvPair[]>(() => editableEnvRows(defaultSpec.env));
  const [mountRows, setMountRows] = useState<MountRow[]>(() => parseMountLines(defaultSpec.mounts));
  const [nameTouched, setNameTouched] = useState(false);
  const [imageDownloading, setImageDownloading] = useState(false);
  const pulledImages = useMemo(() => Array.from(new Set(images.map((image) => `${image.repository}:${image.tag}`))).sort(), [images]);

  function applySpec(next: RunSpec) {
    const standalone = { ...next, groupId: undefined, workspaceTarget: next.workspaceTarget || DEFAULT_WORKSPACE_TARGET };
    specRef.current = standalone;
    setSpec(standalone); setEnvRows(editableEnvRows(standalone.env)); setMountRows(parseMountLines(standalone.mounts));
  }
  useEffect(() => { if (open) { inspectRequest.current += 1; setImageInspect(null); setImageVolumeSources({}); setNameTouched(false); setImageDownloading(false); applySpec(defaultSpec); } }, [open]);
  function patch(p: Partial<RunSpec>) { setSpec((s) => { const next = { ...s, ...p, groupId: undefined }; specRef.current = next; return next; }); }

  function applyImage(image: string) {
    const current = specRef.current;
    const withImageDefaults = applyImageDefaults(current, image, nameTouched);
    const next = { ...withImageDefaults, env: reconcileRuntimeEnvDefaults(withImageDefaults.env, current.image, image) };
    const generated = isGeneratedContainerWorkspacePath(current.workspacePath, undefined, current.name || "container");
    applySpec({ ...next, workspacePath: generated ? defaultStandaloneWorkspacePath(next.name || "container") : current.workspacePath });
    setImageInspect(null);
    setImageVolumeSources({});
    const request = ++inspectRequest.current;
    if (!image.trim()) return;
    void inspectImage(image).then((inspected) => {
      if (!inspected || request !== inspectRequest.current || specRef.current.image !== image) return;
      setImageInspect(inspected);
      const inspectedSpec = applyImageInspectDefaults(specRef.current, inspected);
      applySpec({ ...inspectedSpec, env: applyRuntimeEnvDefaults(inspectedSpec.env, image) });
    });
  }

  const workspacePath = spec.workspacePath || defaultStandaloneWorkspacePath(spec.name || "container");
  const resolvedWorkspace = resolveWorkspacePath(workspaceRoot, workspacePath);
  const env = joinEnvLines(envRows);
  const submittedSpec: RunSpec = { ...spec, groupId: undefined, env, mounts: joinMountLines(mountRows), workspacePath, workspaceTarget: spec.workspaceTarget?.trim() || DEFAULT_WORKSPACE_TARGET };
  const preview = cliForRun(submittedSpec);
  const operationKey = `container:${spec.name.trim() || spec.image.trim()}`;
  const busy = Boolean(operations[operationKey]);
  const missing = missingRequiredEnv(env, spec.image);
  const invalidPorts = hasPublishedHostPortErrors(spec.ports);
  const sourceByKey = { ...imageInspectEnvSourceByKey(imageInspect), ...runtimeEnvSourceByKey(spec.image) };
  const requiredKeys = requiredEnvKeys(spec.image);
  const suggestedCommand = imageCommandSuggestion(imageInspect);
  const suggestedVolumes = imageVolumeSuggestions(imageInspect);
  const readiness = imageReadinessMetadata(imageInspect);
  const hasImageLabels = Boolean(readiness.title || readiness.description || readiness.version || readiness.source || readiness.vendor);
  const hasImageActions = Boolean(suggestedCommand || suggestedVolumes.length);
  const hasImageMetadata = hasImageActions || Boolean(readiness.healthcheck) || hasImageLabels;

  return <Dialog open={open} onOpenChange={(next) => { if (!busy) setRunOpen(next); }}>
    <DialogContent className="flex max-h-[90dvh] max-w-2xl flex-col gap-0 overflow-hidden p-0">
      <DialogHeader className="border-b border-border px-5 py-4"><DialogTitle>Run Container</DialogTitle><DialogDescription>Run one standalone container. Search local images or download from Docker Hub and GHCR before creating.</DialogDescription></DialogHeader>
      <form className="flex min-h-0 flex-1 flex-col" onSubmit={(event) => { event.preventDefault(); if (busy || imageDownloading || missing.length || invalidPorts) return; runContainer(submittedSpec); toast(`Creating ${spec.name || spec.image}`); }}>
        <fieldset disabled={busy} className="contents">
          <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto px-5 py-4">
            <div className="grid gap-1.5"><Label htmlFor="image">Image</Label><ImagePicker inputId="image" value={spec.image} localImages={pulledImages} onSelect={applyImage} onBusyChange={setImageDownloading} disabled={busy} required /></div>
            <div className="grid gap-1.5"><Label htmlFor="name">Name</Label><Input id="name" placeholder="web" value={spec.name} onChange={(event) => { setNameTouched(true); const name = event.target.value; const generated = isGeneratedContainerWorkspacePath(spec.workspacePath, undefined, spec.name || "container"); patch({ name, workspacePath: generated ? defaultStandaloneWorkspacePath(name || "container") : spec.workspacePath }); }} /></div>
            <PortBindingEditor value={spec.ports} onChange={(ports) => patch({ ports })} />
            <div className="grid gap-1.5"><Label htmlFor="cmd">Command</Label><Input id="cmd" placeholder="optional override" value={spec.command} onChange={(event) => patch({ command: event.target.value })} /></div>
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
            <div className="grid gap-2 rounded-lg border border-border p-3"><Label>Workspace folder</Label><div className="flex flex-col gap-2 sm:flex-row"><Input value={workspacePath} onChange={(event) => patch({ workspacePath: event.target.value })} className="font-mono text-xs" aria-label="Workspace folder" /><Button type="button" variant="secondary" onClick={() => void (async () => { const selected = await pickWorkspaceDescendant(workspaceRoot, resolvedWorkspace); if (selected) patch({ workspacePath: relativeWorkspacePath(workspaceRoot, selected) }); })()}>Choose folder</Button><Button type="button" variant="ghost" onClick={() => void openWorkspacePath(workspaceRoot, workspacePath)}><FolderOpen className="size-4" /> Open</Button></div><p className="font-mono text-[11px] text-subtle">{resolvedWorkspace}</p><div className="grid gap-1.5 sm:max-w-xs"><Label htmlFor="workspace-target">Container destination</Label><Input id="workspace-target" value={spec.workspaceTarget || DEFAULT_WORKSPACE_TARGET} onChange={(event) => patch({ workspaceTarget: event.target.value })} className="font-mono text-xs" /></div><p className="text-xs text-subtle">This managed mount is separate from Mounts below and cannot be deleted there.</p></div>
            <EnvEditor rows={envRows} sourceByKey={sourceByKey} requiredKeys={requiredKeys} onChange={(rows) => { setEnvRows(rows); patch({ env: joinEnvLines(rows) }); }} />
            {missing.length ? <p className="text-xs text-destructive">Fill required environment: {missing.join(", ")}</p> : null}
            <MountEditor rows={mountRows} onChange={(rows) => { setMountRows(rows); patch({ mounts: joinMountLines(rows) }); }} />
          </div>
          <div className="grid gap-3 border-t border-border px-5 py-3"><div className="flex flex-wrap items-center gap-5"><label className="flex items-center gap-2 text-sm"><Switch checked={spec.gpu} onCheckedChange={(gpu) => patch({ gpu })} />GPU</label><label className="flex items-center gap-2 text-sm"><Switch checked={spec.detach} onCheckedChange={(detach) => patch({ detach })} />Detach</label><label className="flex items-center gap-2 text-sm"><Switch checked={spec.remove} onCheckedChange={(remove) => patch({ remove })} />Auto-remove</label></div><p className="truncate font-mono text-[11px] text-subtle">{preview}</p><div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => setRunOpen(false)} disabled={busy}>Cancel</Button><Button type="submit" disabled={busy || imageDownloading || !spec.image.trim() || missing.length > 0 || invalidPorts}>{busy ? <LoaderCircle className="size-4 animate-spin" /> : imageDownloading ? <LoaderCircle className="size-4 animate-spin" /> : null}{busy ? "Creating…" : imageDownloading ? "Waiting for image…" : "Create & start"}</Button></div></div>
        </fieldset>
      </form>
    </DialogContent>
  </Dialog>;
}
