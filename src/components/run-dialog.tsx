import { useEffect, useState } from "react";
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
import { catalogPresets, specFromPreset } from "@/lib/wslc/seed";
import type { RunSpec } from "@/lib/wslc/types";
import { cn } from "@/lib/utils";

const defaultSpec = specFromPreset(catalogPresets[0]!);

export function RunDialog() {
  const open = useWslc((s) => s.runOpen);
  const setRunOpen = useWslc((s) => s.setRunOpen);
  const runContainer = useWslc((s) => s.runContainer);
  const catalog = useWslc((s) => s.catalog);
  const images = useWslc((s) => s.images);
  const [spec, setSpec] = useState<RunSpec>(defaultSpec);
  const [envRows, setEnvRows] = useState<KvPair[]>(() => parseEnvLines(defaultSpec.env));
  const [mountRows, setMountRows] = useState<MountRow[]>(() =>
    parseMountLines(defaultSpec.mounts),
  );
  const local = Array.from(
    new Set([...images.map((i) => `${i.repository}:${i.tag}`), ...catalog]),
  );

  function applySpec(next: RunSpec) {
    setSpec(next);
    setEnvRows(parseEnvLines(next.env));
    setMountRows(parseMountLines(next.mounts));
  }

  useEffect(() => {
    if (open) applySpec(defaultSpec);
  }, [open]);

  function patch(p: Partial<RunSpec>) {
    setSpec((s) => ({ ...s, ...p }));
  }

  const selectedPreset = catalogPresets.find((p) => p.image === spec.image);

  return (
    <Dialog open={open} onOpenChange={setRunOpen}>
      <DialogContent className="flex max-h-[90dvh] max-w-2xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b border-border px-5 py-4">
          <DialogTitle>Run container</DialogTitle>
          <DialogDescription>
            Each environment row is one variable. Name on the left, value on the right.
          </DialogDescription>
        </DialogHeader>

        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(e) => {
            e.preventDefault();
            runContainer({
              ...spec,
              env: joinEnvLines(envRows),
              mounts: joinMountLines(mountRows),
            });
            toast(`Creating ${spec.name || spec.image}`);
            setRunOpen(false);
          }}
        >
          <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto px-5 py-4">
          <div className="grid gap-1.5">
            <Label>Quick pick</Label>
            <div className="flex flex-wrap gap-1.5">
              {catalogPresets.map((p) => (
                <button
                  key={p.image}
                  type="button"
                  onClick={() => applySpec(specFromPreset(p))}
                  className={cn(
                    "h-9 rounded-md border px-3 text-xs",
                    spec.image === p.image
                      ? "border-foreground bg-elevated text-foreground"
                      : "border-border text-muted-foreground hover:bg-elevated/70",
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>
            {selectedPreset ? (
              <p className="text-xs text-subtle">{selectedPreset.hint}</p>
            ) : null}
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="image">Image</Label>
            <Input
              id="image"
              list="image-catalog"
              value={spec.image}
              onChange={(e) => patch({ image: e.target.value })}
              required
              className="font-mono text-xs"
            />
            <datalist id="image-catalog">
              {local.map((i) => (
                <option key={i} value={i} />
              ))}
            </datalist>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                placeholder="web"
                value={spec.name}
                onChange={(e) => patch({ name: e.target.value })}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="ports">Publish ports</Label>
              <Input
                id="ports"
                placeholder="8080:80"
                value={spec.ports}
                onChange={(e) => patch({ ports: e.target.value })}
              />
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="cmd">Command</Label>
            <Input
              id="cmd"
              placeholder="optional override"
              value={spec.command}
              onChange={(e) => patch({ command: e.target.value })}
            />
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
                <Switch
                  checked={spec.gpu}
                  onCheckedChange={(gpu) => patch({ gpu })}
                />
                GPU
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Switch
                  checked={spec.detach}
                  onCheckedChange={(detach) => patch({ detach })}
                />
                Detach
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Switch
                  checked={spec.remove}
                  onCheckedChange={(remove) => patch({ remove })}
                />
                Auto-remove
              </label>
            </div>
            <p className="truncate font-mono text-[11px] text-subtle">
              {cliForRun({ ...spec, env: joinEnvLines(envRows), mounts: joinMountLines(mountRows) })}
            </p>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => setRunOpen(false)}>
                Cancel
              </Button>
              <Button type="submit">Create & start</Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
