import { useState } from "react";
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
import { Textarea } from "@/components/ui/textarea";
import { useWslc } from "@/lib/wslc/store";
import { cliForRun } from "@/lib/wslc/csharp";
import type { RunSpec } from "@/lib/wslc/types";

const empty: RunSpec = {
  image: "nginx:latest",
  name: "",
  command: "",
  ports: "8080:80",
  env: "",
  mounts: "",
  gpu: false,
  remove: false,
  detach: true,
  workdir: "/",
};

export function RunDialog() {
  const open = useWslc((s) => s.runOpen);
  const setRunOpen = useWslc((s) => s.setRunOpen);
  const runContainer = useWslc((s) => s.runContainer);
  const catalog = useWslc((s) => s.catalog);
  const images = useWslc((s) => s.images);
  const [spec, setSpec] = useState<RunSpec>(empty);
  const local = Array.from(
    new Set([...images.map((i) => `${i.repository}:${i.tag}`), ...catalog]),
  );

  function patch(p: Partial<RunSpec>) {
    setSpec((s) => ({ ...s, ...p }));
  }

  return (
    <Dialog open={open} onOpenChange={setRunOpen}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Run container</DialogTitle>
          <DialogDescription>
            Creates a container through the C# host —{" "}
            <span className="font-mono text-[12px] text-foreground/80">
              Session.CreateContainer
            </span>
            .
          </DialogDescription>
        </DialogHeader>

        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            runContainer(spec);
            toast(`Creating ${spec.name || spec.image}`);
          }}
        >
          <div className="grid gap-1.5">
            <Label htmlFor="image">Image</Label>
            <Input
              id="image"
              list="image-catalog"
              value={spec.image}
              onChange={(e) => patch({ image: e.target.value })}
              required
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

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="env">Environment</Label>
              <Textarea
                id="env"
                placeholder={"KEY=value"}
                value={spec.env}
                onChange={(e) => patch({ env: e.target.value })}
                className="min-h-16 font-mono text-xs"
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="mounts">Mounts</Label>
              <Textarea
                id="mounts"
                placeholder={"C:\\src:/workspace:rw"}
                value={spec.mounts}
                onChange={(e) => patch({ mounts: e.target.value })}
                className="min-h-16 font-mono text-xs"
              />
            </div>
          </div>

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
            {cliForRun(spec)}
          </p>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => setRunOpen(false)}>
              Cancel
            </Button>
            <Button type="submit">Create & start</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
