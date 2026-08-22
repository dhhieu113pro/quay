import { Boxes, Network, Play } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useWslc } from "@/lib/wslc/store";

export function RunCubeDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const cubes = useWslc((s) => s.groups);
  const containers = useWslc((s) => s.containers);
  const startCube = useWslc((s) => s.startGroup);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Run Cube</DialogTitle>
          <DialogDescription>
            Start every container defined in a Cube on its shared WSLC network.
          </DialogDescription>
        </DialogHeader>

        <div className="grid max-h-[60dvh] gap-2 overflow-y-auto pr-1">
          {cubes.length ? (
            cubes.map((cube) => {
              const names = new Set(cube.specs.map((spec) => spec.name));
              const members = containers.filter(
                (container) => container.groupId === cube.id || names.has(container.name),
              );
              const running = members.filter((container) => container.status === "running").length;
              const total = Math.max(cube.specs.length, members.length);
              const empty = cube.specs.length === 0;
              const fullyRunning = total > 0 && running >= total;

              return (
                <div
                  key={cube.id}
                  className="flex items-center gap-3 rounded-lg border border-border bg-card p-3"
                >
                  <div className="grid size-10 shrink-0 place-items-center rounded-md bg-elevated">
                    <Boxes className="size-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium">{cube.name}</p>
                      {cube.builtIn ? (
                        <span className="rounded bg-elevated px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                          Built-in
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        <Network className="size-3" />
                        {cube.network}
                      </span>
                      <span>{running}/{total} running</span>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    disabled={empty || fullyRunning}
                    onClick={() => {
                      startCube(cube.id);
                      toast(`Starting ${cube.name}`);
                      onOpenChange(false);
                    }}
                  >
                    <Play className="size-3.5" />
                    {fullyRunning ? "Running" : empty ? "Empty" : "Run"}
                  </Button>
                </div>
              );
            })
          ) : (
            <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
              No Cubes are defined yet.
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
