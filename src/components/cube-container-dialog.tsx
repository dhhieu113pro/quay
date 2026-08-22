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
import { catalogPresets, specFromPreset } from "@/lib/wslc/catalog";
import { useWslc } from "@/lib/wslc/store";
import type { ContainerGroup, RunSpec } from "@/lib/wslc/types";
import { cn } from "@/lib/utils";

const initialSpec = specFromPreset(catalogPresets[0]!);

export function CubeContainerDialog({
  cube,
  open,
  onOpenChange,
  onSave,
}: {
  cube: ContainerGroup | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSave: (spec: RunSpec) => void;
}) {
  const catalog = useWslc((s) => s.catalog);
  const images = useWslc((s) => s.images);
  const [spec, setSpec] = useState<RunSpec>(initialSpec);
  const [envRows, setEnvRows] = useState<KvPair[]>(() => parseEnvLines(initialSpec.env));
  const [mountRows, setMountRows] = useState<MountRow[]>(() => parseMountLines(initialSpec.mounts));

  const localImages = Array.from(
    new Set([...images.map((image) => `${image.repository}:${image.tag}`), ...catalog]),
  );

  function applySpec(next: RunSpec) {
    const normalized = { ...next, groupId: cube?.id };
    setSpec(normalized);
    setEnvRows(parseEnvLines(normalized.env));
    setMountRows(parseMountLines(normalized.mounts));
  }

  useEffect(() => {
    if (open) applySpec({ ...initialSpec, groupId: cube?.id });
  }, [open, cube?.id]);

  if (!cube) return null;

  const patch = (value: Partial<RunSpec>) => setSpec((current) => ({ ...current, ...value }));
  const selectedPreset = catalogPresets.find((preset) => preset.image === spec.image);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90dvh] max-w-2xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b border-border px-5 py-4">
          <DialogTitle>Add Container to {cube.name}</DialogTitle>
          <DialogDescription>
            Save a container definition in this Cube. It will use the Cube network and shared environment when the Cube starts.
          </DialogDescription>
        </DialogHeader>

        <form
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            const name = spec.name.trim();
            if (!name) {
              toast.error("Container name is required inside a Cube");
              return;
            }
            onSave({
              ...spec,
              name,
              groupId: cube.id,
              env: joinEnvLines(envRows),
              mounts: joinMountLines(mountRows),
            });
            onOpenChange(false);
          }}
        >
          <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto px-5 py-4">
            <div className="grid gap-1.5">
              <Label>Quick pick</Label>
              <div className="flex flex-wrap gap-1.5">
                {catalogPresets.map((preset) => (
                  <button
                    key={preset.image}
                    type="button"
                    onClick={() => applySpec({ ...specFromPreset(preset), groupId: cube.id })}
                    className={cn(
                      "h-9 rounded-md border px-3 text-xs",
                      spec.image === preset.image
                        ? "border-foreground bg-elevated text-foreground"
                        : "border-border text-muted-foreground hover:bg-elevated/70",
                    )}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
              {selectedPreset ? <p className="text-xs text-subtle">{selectedPreset.hint}</p> : null}
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="cube-container-image">Image</Label>
              <Input
                id="cube-container-image"
                list="cube-image-catalog"
                value={spec.image}
                onChange={(event) => patch({ image: event.target.value })}
                required
                className="font-mono text-xs"
              />
              <datalist id="cube-image-catalog">
                {localImages.map((image) => <option key={image} value={image} />)}
              </datalist>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="cube-container-name">Name</Label>
                <Input
                  id="cube-container-name"
                  value={spec.name}
                  onChange={(event) => patch({ name: event.target.value })}
                  placeholder="api"
                  required
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="cube-container-ports">Publish ports</Label>
                <Input
                  id="cube-container-ports"
                  value={spec.ports}
                  onChange={(event) => patch({ ports: event.target.value })}
                  placeholder="8080:80"
                />
              </div>
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="cube-container-command">Command</Label>
              <Input
                id="cube-container-command"
                value={spec.command}
                onChange={(event) => patch({ command: event.target.value })}
                placeholder="optional override"
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
            <p className="font-mono text-[11px] text-subtle">
              Cube network: {cube.network} · {cube.env.split("\n").filter((line) => line.trim()).length} shared env
            </p>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit">Add to Cube</Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
