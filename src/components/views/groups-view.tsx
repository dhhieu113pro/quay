import { useEffect, useMemo, useState } from "react";
import { Boxes, Network, Pencil, Play, Plus, Square, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  EnvEditor,
  joinEnvLines,
  parseEnvLines,
  type EnvSuggestion,
  type KvPair,
} from "@/components/kv-editor";
import { RunCubeDialog } from "@/components/run-cube-dialog";
import { applyStackConfig } from "@/components/stack-config-dialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { defaultGroupNetwork, slugGroupName } from "@/lib/wslc/groups";
import { useWslc } from "@/lib/wslc/store";
import type { ContainerGroup } from "@/lib/wslc/types";

function emptyCube(): ContainerGroup {
  const id = `cube-${Date.now()}`;
  return {
    id,
    name: "",
    network: defaultGroupNetwork(id),
    env: "",
    builtIn: false,
    autoStart: false,
    specs: [],
  };
}

function envSuggestions(cube: ContainerGroup): EnvSuggestion[] {
  return cube.specs.flatMap((spec) =>
    spec.env
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const at = line.indexOf("=");
        return {
          key: at < 0 ? line : line.slice(0, at),
          value: at < 0 ? "" : line.slice(at + 1),
          source: spec.name || spec.image,
        };
      }),
  );
}

export function CubesView() {
  const groups = useWslc((s) => s.groups);
  const containers = useWslc((s) => s.containers);
  const saveGroup = useWslc((s) => s.saveGroup);
  const deleteGroup = useWslc((s) => s.deleteGroup);
  const startGroup = useWslc((s) => s.startGroup);
  const startContainer = useWslc((s) => s.startContainer);
  const stopGroup = useWslc((s) => s.stopGroup);
  const [editing, setEditing] = useState<ContainerGroup | null>(null);
  const [runOpen, setRunOpen] = useState(false);

  const counts = useMemo(() => {
    const result = new Map<string, { total: number; running: number }>();
    for (const cube of groups) {
      const memberNames = new Set(cube.specs.map((spec) => spec.name));
      const members = containers.filter((container) =>
        container.groupId === cube.id || memberNames.has(container.name),
      );
      result.set(cube.id, {
        total: members.length || cube.specs.length,
        running: members.filter((container) => container.status === "running").length,
      });
    }
    return result;
  }, [containers, groups]);

  return (
    <>
      <div className="mx-auto w-full max-w-6xl p-4 sm:p-6">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold">Cubes</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Bundle related containers with one shared WSLC network and shared environment variables.
            </p>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="secondary" onClick={() => setRunOpen(true)}>
              <Play className="mr-1.5 size-4" />
              Run Cube
            </Button>
            <Button onClick={() => setEditing(emptyCube())}>
              <Plus className="mr-1.5 size-4" />
              New Cube
            </Button>
          </div>
        </div>

        <div className="grid gap-3 lg:grid-cols-2">
          {groups.map((cube) => {
            const memberNames = new Set(cube.specs.map((spec) => spec.name));
            const members = containers.filter((container) =>
              container.groupId === cube.id || memberNames.has(container.name),
            );
            const count = counts.get(cube.id) ?? { total: 0, running: 0 };
            const envCount = cube.env.split("\n").map((line) => line.trim()).filter(Boolean).length;
            return (
              <section key={cube.id} className="rounded-lg border border-border bg-card p-4">
                <div className="flex items-start gap-3">
                  <div className="grid size-10 shrink-0 place-items-center rounded-md bg-elevated">
                    <Boxes className="size-5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-medium">{cube.name}</h2>
                      {cube.builtIn ? (
                        <span className="rounded bg-elevated px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                          Built-in
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        <Network className="size-3" /> {cube.network}
                      </span>
                      <span>{count.running}/{count.total} running</span>
                      <span>{envCount} shared env</span>
                    </div>
                  </div>
                </div>

                {cube.env.trim() ? (
                  <div className="mt-3 rounded-md border border-border bg-background/50 px-3 py-2 font-mono text-xs text-muted-foreground">
                    {cube.env.split("\n").filter(Boolean).slice(0, 4).map((line) => {
                      const at = line.indexOf("=");
                      const key = at < 0 ? line : line.slice(0, at);
                      return <div key={key}>{key}=••••••</div>;
                    })}
                    {envCount > 4 ? <div>+{envCount - 4} more</div> : null}
                  </div>
                ) : (
                  <p className="mt-3 text-xs text-subtle">No shared environment variables yet.</p>
                )}

                <div className="mt-4 flex flex-wrap gap-2">
                  <Button
                    size="sm"
                    onClick={() => {
                      if (cube.id === "local-coding") applyStackConfig(cube);
                      if (cube.specs.length) {
                        startGroup(cube.id);
                      } else {
                        for (const container of members.filter((item) => item.status !== "running")) {
                          startContainer(container.id);
                        }
                      }
                    }}
                  >
                    <Play className="mr-1.5 size-3.5" /> Start all
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => stopGroup(cube.id)}>
                    <Square className="mr-1.5 size-3.5" /> Stop all
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditing({ ...cube })}>
                    <Pencil className="mr-1.5 size-3.5" /> Configure
                  </Button>
                  {!cube.builtIn ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        deleteGroup(cube.id);
                        toast(`Deleted ${cube.name}`);
                      }}
                    >
                      <Trash2 className="mr-1.5 size-3.5" /> Delete
                    </Button>
                  ) : null}
                </div>
              </section>
            );
          })}
        </div>

        <CubeDialog
          cube={editing}
          onClose={() => setEditing(null)}
          onSave={(cube) => {
            saveGroup(cube);
            toast(`Saved ${cube.name}`);
            setEditing(null);
          }}
        />
      </div>

      <RunCubeDialog open={runOpen} onOpenChange={setRunOpen} />
    </>
  );
}

function CubeDialog({
  cube,
  onClose,
  onSave,
}: {
  cube: ContainerGroup | null;
  onClose: () => void;
  onSave: (cube: ContainerGroup) => void;
}) {
  const [draft, setDraft] = useState<ContainerGroup | null>(cube);
  const [envRows, setEnvRows] = useState<KvPair[]>(() => parseEnvLines(cube?.env ?? ""));
  const creating = Boolean(cube && !cube.name.trim());

  useEffect(() => {
    setDraft(cube ? { ...cube } : null);
    setEnvRows(parseEnvLines(cube?.env ?? ""));
  }, [cube]);

  if (!cube || !draft) return null;

  const patch = (value: Partial<ContainerGroup>) =>
    setDraft((current) => current ? { ...current, ...value } : current);
  const suggestions = envSuggestions(draft);

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            {draft.builtIn ? `Configure ${draft.name}` : draft.name ? `Edit ${draft.name}` : "Create cube"}
          </DialogTitle>
          <DialogDescription>
            Cube variables are shared with every member container. Container-specific values override the Cube value when keys match.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="cube-name">Name</Label>
            <Input
              id="cube-name"
              value={draft.name}
              disabled={draft.builtIn}
              onChange={(event) => {
                const name = event.target.value;
                if (creating) {
                  const id = slugGroupName(name);
                  patch({ name, id, network: defaultGroupNetwork(id) });
                } else {
                  patch({ name });
                }
              }}
              placeholder="My development cube"
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="cube-network">WSLC network</Label>
            <Input
              id="cube-network"
              value={draft.network}
              onChange={(event) => patch({ network: event.target.value })}
              placeholder="quay-my-development-cube"
              className="font-mono text-xs"
            />
          </div>

          <EnvEditor
            label="Shared environment"
            rows={envRows}
            suggestions={suggestions}
            onChange={(rows) => {
              setEnvRows(rows);
              patch({ env: joinEnvLines(rows) });
            }}
          />
          <p className="-mt-2 text-xs text-subtle">
            Suggestions come from the containers defined in this Cube. Click a suggestion to promote that variable into shared configuration.
          </p>
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => {
              const name = draft.name.trim();
              if (!name) return;
              const id = draft.id;
              onSave({
                ...draft,
                id,
                name,
                env: joinEnvLines(envRows),
                network: draft.network.trim() || defaultGroupNetwork(id),
              });
            }}
          >
            Save Cube
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
