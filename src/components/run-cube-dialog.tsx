import { Boxes, LoaderCircle, Network, Play } from "lucide-react";
import { toast } from "sonner";
import { applyStackConfig, loadStackConfig } from "@/components/stack-config-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { effectiveSpec } from "@/lib/wslc/groups";
import { useWslc } from "@/lib/wslc/store";
import type { ContainerGroup, RunSpec } from "@/lib/wslc/types";

function envValue(env: string, key: string) {
  const prefix = `${key}=`;
  return env.split("\n").map((line) => line.trim()).find((line) => line.startsWith(prefix))?.slice(prefix.length).trim() ?? "";
}

function needsConfig(cube: ContainerGroup, spec: RunSpec) {
  if (cube.id !== "local-coding" || spec.name !== "local-coding-mcp-ngrok") return false;
  return !envValue(effectiveSpec(spec, cube).env, "NGROK_AUTHTOKEN") && !loadStackConfig(cube.id).ngrokToken.trim();
}

export function RunCubeDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const cubes = useWslc((s) => s.groups);
  const containers = useWslc((s) => s.containers);
  const operations = useWslc((s) => s.operations);
  const startCube = useWslc((s) => s.startGroup);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Run Cube</DialogTitle>
          <DialogDescription>
            Start configured containers in a Cube on its shared WSLC network.
          </DialogDescription>
        </DialogHeader>

        <div className="grid max-h-[60dvh] gap-2 overflow-y-auto pr-1">
          {cubes.length ? (
            cubes.map((cube) => {
              const runnableSpecs = cube.specs.filter((spec) => !needsConfig(cube, spec));
              const names = new Set(runnableSpecs.map((spec) => spec.name));
              const members = containers.filter(
                (container) => container.groupId === cube.id || names.has(container.name),
              );
              const running = members.filter(
                (container) => names.has(container.name) && container.status === "running",
              ).length;
              const total = Math.max(runnableSpecs.length, members.filter((container) => names.has(container.name)).length);
              const needsConfiguration = cube.specs.length - runnableSpecs.length;
              const empty = total === 0;
              const fullyRunning = total > 0 && running >= total;
              const busy = Boolean(operations[`cube:${cube.id}`]);

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
                      <span>{running}/{total} runnable</span>
                      {needsConfiguration ? <span className="text-warn">{needsConfiguration} needs config</span> : null}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    disabled={empty || fullyRunning || busy}
                    onClick={() => {
                      if (cube.id === "local-coding") applyStackConfig(cube);
                      startCube(cube.id);
                      toast(`Starting ${cube.name}`);
                    }}
                  >
                    {busy ? <LoaderCircle className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
                    {busy ? "Starting…" : fullyRunning ? "Running" : empty ? "Needs config" : "Run"}
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
