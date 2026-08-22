import { useEffect, useMemo, useState } from "react";
import { Boxes, Network, Pencil, Play, Plus, Square, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { CubeContainerDialog } from "@/components/cube-container-dialog";
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
import type { Container, ContainerGroup, RunSpec } from "@/lib/wslc/types";

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

function cubeMembers(cube: ContainerGroup, containers: Container[]) {
  const expectedNames = new Set(cube.specs.map((spec) => spec.name).filter(Boolean));
  const runtime = containers.filter(
    (container) => container.groupId === cube.id || expectedNames.has(container.name),
  );

  const rows = cube.specs.map((spec) => ({
    name: spec.name || spec.image,
    image: spec.image,
    container: runtime.find((item) => item.name === spec.name),
  }));

  for (const container of runtime) {
    if (!expectedNames.has(container.name)) {
      rows.push({ name: container.name, image: container.image, container });
    }
  }

  return rows;
}

function cubeState(total: number, running: number) {
  if (total === 0) return { label: "Empty", className: "bg-elevated text-muted-foreground" };
  if (running === total) return { label: "Running", className: "bg-ok/15 text-ok" };
  if (running > 0) return { label: "Partial", className: "bg-warn/15 text-warn" };
  return { label: "Stopped", className: "bg-elevated text-muted-foreground" };
}

export function CubesView() {
  const groups = useWslc((s) => s.groups);
  const containers = useWslc((s) => s.containers);
  const saveGroup = useWslc((s) => s.saveGroup);
  const deleteGroup = useWslc((s) => s.deleteGroup);
  const startGroup = useWslc((s) => s.startGroup);
  const startContainer = useWslc((s) => s.startContainer);
  const stopContainer = useWslc((s) => s.stopContainer);
  const stopGroup = useWslc((s) => s.stopGroup);
  const [editing, setEditing] = useState<ContainerGroup | null>(null);
  const [addingTo, setAddingTo] = useState<ContainerGroup | null>(null);
  const [runOpen, setRunOpen] = useState(false);

  const counts = useMemo(() => {
    const result = new Map<string, { total: number; running: number }>();
    for (const cube of groups) {
      const members = cubeMembers(cube, containers);
      result.set(cube.id, {
        total: members.length,
        running: members.filter((member) => member.container?.status === "running").length,
      });
    }
    return result;
  }, [containers, groups]);

  const startCube = (cube: ContainerGroup, members: ReturnType<typeof cubeMembers>) => {
    if (cube.id === "local-coding") applyStackConfig(cube);
    if (cube.specs.length) {
      startGroup(cube.id);
    } else {
      for (const member of members) {
        if (member.container && member.container.status !== "running") {
          startContainer(member.container.id);
        }
      }
    }
    toast(`Starting ${cube.name}`);
  };

  const addContainer = (cube: ContainerGroup, spec: RunSpec) => {
    const running = cubeMembers(cube, containers).some(
      (member) => member.container?.status === "running",
    );
    if (running) {
      toast.error(`Stop ${cube.name} before adding a container`);
      return false;
    }

    saveGroup({
      ...cube,
      specs: [
        ...cube.specs.filter((item) => item.name !== spec.name),
        { ...spec, groupId: cube.id },
      ],
    });
    toast(`Added ${spec.name} to ${cube.name}`);
    return true;
  };

  return (
    <>
      <div className="mx-auto w-full max-w-6xl p-4 sm:p-6">
        <div className="mb-5 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold">Cubes</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Define Cube containers here. They share one WSLC network and shared environment variables.
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
            const members = cubeMembers(cube, containers);
            const count = counts.get(cube.id) ?? { total: 0, running: 0 };
            const envCount = cube.env.split("\n").map((line) => line.trim()).filter(Boolean).length;
            const state = cubeState(count.total, count.running);
            const fullyRunning = count.total > 0 && count.running === count.total;
            const partiallyRunning = count.running > 0 && !fullyRunning;
            const canAddContainer = count.running === 0;

            return (
              <section key={cube.id} className="overflow-hidden rounded-xl border border-border bg-card">
                <div className="p-4">
                  <div className="flex items-start gap-3">
                    <div className="grid size-10 shrink-0 place-items-center rounded-md bg-elevated">
                      <Boxes className="size-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="font-medium">{cube.name}</h2>
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${state.className}`}>
                          {state.label}
                        </span>
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
                        <span className={count.running > 0 ? "font-medium text-foreground" : ""}>
                          {count.running} running · {count.total} total
                        </span>
                        <span>{envCount} shared env</span>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="border-y border-border bg-background/35">
                  {members.length ? (
                    <ul className="divide-y divide-border">
                      {members.map((member) => {
                        const status = member.container?.status ?? "missing";
                        const running = status === "running";
                        const actionLabel = running
                          ? `Stop ${member.name}`
                          : member.container
                            ? `Start ${member.name}`
                            : `${member.name} is not created`;
                        return (
                          <li key={member.name} className="flex items-center gap-3 px-4 py-2.5">
                            <span
                              className={`size-2 shrink-0 rounded-full ${running ? "bg-ok" : status === "created" ? "bg-warn" : "bg-subtle"}`}
                              aria-hidden
                            />
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium">{member.name}</p>
                              <p className="truncate font-mono text-[11px] text-subtle">{member.image}</p>
                            </div>
                            <span className={running ? "text-xs font-medium text-ok" : "text-xs text-muted-foreground"}>
                              {running ? "Running" : status === "missing" ? "Not created" : status === "created" ? "Created" : "Stopped"}
                            </span>
                            <Button
                              type="button"
                              size="icon-sm"
                              variant="ghost"
                              disabled={!member.container}
                              aria-label={actionLabel}
                              title={actionLabel}
                              onClick={() => {
                                if (!member.container) return;
                                if (running) {
                                  stopContainer(member.container.id);
                                  toast(`Stopping ${member.name}`);
                                } else {
                                  startContainer(member.container.id);
                                  toast(`Starting ${member.name}`);
                                }
                              }}
                            >
                              {running ? <Square className="size-3.5" /> : <Play className="size-3.5" />}
                            </Button>
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <div className="px-4 py-5 text-center text-xs text-subtle">
                      No containers are defined in this Cube yet.
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2 p-4">
                  {fullyRunning ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        stopGroup(cube.id);
                        toast(`Stopping ${cube.name}`);
                      }}
                    >
                      <Square className="mr-1.5 size-3.5" /> Stop Cube
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      disabled={count.total === 0}
                      onClick={() => startCube(cube, members)}
                    >
                      <Play className="mr-1.5 size-3.5" />
                      {partiallyRunning ? "Start missing" : "Start Cube"}
                    </Button>
                  )}

                  {partiallyRunning ? (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        stopGroup(cube.id);
                        toast(`Stopping ${cube.name}`);
                      }}
                    >
                      <Square className="mr-1.5 size-3.5" /> Stop Cube
                    </Button>
                  ) : null}

                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!canAddContainer}
                    title={canAddContainer ? "Add Container" : "Stop the Cube before adding a container"}
                    onClick={() => setAddingTo(cube)}
                  >
                    <Plus className="mr-1.5 size-3.5" /> Add Container
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setEditing({ ...cube })}>
                    <Pencil className="mr-1.5 size-3.5" /> Configure
                  </Button>
                  {!cube.builtIn ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="ml-auto"
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
      <CubeContainerDialog
        cube={addingTo}
        open={Boolean(addingTo)}
        onOpenChange={(open) => { if (!open) setAddingTo(null); }}
        onSave={(spec) => {
          if (!addingTo) return;
          if (addContainer(addingTo, spec)) setAddingTo(null);
        }}
      />
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
