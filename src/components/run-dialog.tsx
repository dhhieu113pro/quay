import { useEffect, useMemo, useState } from "react";
import { LoaderCircle } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  EnvEditor,
  MountEditor,
  joinEnvLines,
  joinMountLines,
  parseEnvLines,
  parseMountLines,
  type KvPair,
  type MountRow,
} from "@/components/kv-editor";
import { useWslc } from "@/lib/wslc/store";
import { cliForRun } from "@/lib/wslc/csharp";
import type { RunSpec } from "@/lib/wslc/types";

const defaultSpec: RunSpec = {
  image: "",
  name: "",
  command: "",
  ports: "",
  env: "",
  mounts: "",
  gpu: false,
  remove: false,
  detach: true,
  workdir: "/",
  groupId: undefined,
};

export function RunDialog() {
  const open = useWslc((s) => s.runOpen);
  const setRunOpen = useWslc((s) => s.setRunOpen);
  const runContainer = useWslc((s) => s.runContainer);
  const images = useWslc((s) => s.images);
  const operations = useWslc((s) => s.operations);
  const [spec, setSpec] = useState<RunSpec>(defaultSpec);
  const [envRows, setEnvRows] = useState<KvPair[]>([]);
  const [mountRows, setMountRows] = useState<MountRow[]>([]);

  const pulledImages = useMemo(
    () => Array.from(new Set(images.map((image) => `${image.repository}:${image.tag}`))).sort(),
    [images],
  );

  function applySpec(next: RunSpec) {
    const standalone = { ...next, groupId: undefined };
    setSpec(standalone);
    setEnvRows(parseEnvLines(standalone.env));
    setMountRows(parseMountLines(standalone.mounts));
  }

  useEffect(() => {
    if (open) applySpec(defaultSpec);
  }, [open]);

  function patch(p: Partial<RunSpec>) {
    setSpec((s) => ({ ...s, ...p, groupId: undefined }));
  }

  const submittedSpec: RunSpec = {
    ...spec,
    groupId: undefined,
    env: joinEnvLines(envRows),
    mounts: joinMountLines(mountRows),
  };
  const preview = cliForRun(submittedSpec);
  const operationKey = `container:${spec.name.trim() || spec.image.trim()}`;
  const busy = Boolean(operations[operationKey]);

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!busy) setRunOpen(next); }}>
      <DialogContent className="flex max-h-[90dvh] max-w-2xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b border-border px-5 py-4">
          <DialogTitle>Run Container</DialogTitle>
          <DialogDescription>
            Run one standalone container. Containers that belong to a Cube are defined from the Cubes page.
          </DialogDescription>
        </DialogHeader>

        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            if (busy) return;
            runContainer(submittedSpec);
            toast(`Creating ${spec.name || spec.image}`);
          }}
        >
          <fieldset disabled={busy} className="contents">
            <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto px-5 py-4">
              <div className="grid gap-1.5">
                <Label htmlFor="image">Image</Label>
                <Input
                  id="image"
                  list="pulled-image-catalog"
                  value={spec.image}
                  onChange={(event) => patch({ image: event.target.value })}
                  placeholder={pulledImages.length ? "Select or type a pulled image" : "repository/image:tag"}
                  required
                  className="font-mono text-xs"
                />
                <datalist id="pulled-image-catalog">
                  {pulledImages.map((image) => <option key={image} value={image} />)}
                </datalist>
                <p className="text-xs text-subtle">
                  {pulledImages.length
                    ? `${pulledImages.length} pulled image${pulledImages.length === 1 ? "" : "s"} available.`
                    : "No pulled images yet. You can still type an image reference manually."}
                </p>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="grid gap-1.5">
                  <Label htmlFor="name">Name</Label>
                  <Input id="name" placeholder="web" value={spec.name} onChange={(event) => patch({ name: event.target.value })} />
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="ports">Publish ports</Label>
                  <Input id="ports" placeholder="8080:80" value={spec.ports} onChange={(event) => patch({ ports: event.target.value })} />
                </div>
              </div>

              <div className="grid gap-1.5">
                <Label htmlFor="cmd">Command</Label>
                <Input id="cmd" placeholder="optional override" value={spec.command} onChange={(event) => patch({ command: event.target.value })} />
              </div>

              <EnvEditor
                rows={envRows}
                onChange={(rows) => {
                  setEnvRows(rows);
                  patch({ env: joinEnvLines(rows) });
                }}
              />

              <MountEditor
                rows={mountRows}
                onChange={(rows) => {
                  setMountRows(rows);
                  patch({ mounts: joinMountLines(rows) });
                }}
              />
            </div>

            <div className="grid gap-3 border-t border-border px-5 py-3">
              <div className="flex flex-wrap items-center gap-5">
                <label className="flex items-center gap-2 text-sm">
                  <Switch checked={spec.gpu} onCheckedChange={(gpu) => patch({ gpu })} />
                  GPU
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <Switch checked={spec.detach} onCheckedChange={(detach) => patch({ detach })} />
                  Detach
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <Switch checked={spec.remove} onCheckedChange={(remove) => patch({ remove })} />
                  Auto-remove
                </label>
              </div>
              <p className="truncate font-mono text-[11px] text-subtle">{preview}</p>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => setRunOpen(false)} disabled={busy}>Cancel</Button>
                <Button type="submit" disabled={busy || !spec.image.trim()}>
                  {busy ? <LoaderCircle className="size-4 animate-spin" /> : null}
                  {busy ? "Creating…" : "Create & start"}
                </Button>
              </div>
            </div>
          </fieldset>
        </form>
      </DialogContent>
    </Dialog>
  );
}
