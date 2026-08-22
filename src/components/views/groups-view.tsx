import { useMemo, useState } from "react";
import { Boxes, Network, Pencil, Play, Plus, Square, Trash2 } from "lucide-react";
import { toast } from "sonner";
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
import { Textarea } from "@/components/ui/textarea";
import { defaultGroupNetwork, slugGroupName } from "@/lib/wslc/groups";
import { useWslc } from "@/lib/wslc/store";
import type { ContainerGroup } from "@/lib/wslc/types";

function emptyGroup(): ContainerGroup {
  const id = `group-${Date.now()}`;
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

export function GroupsView() {
  const groups = useWslc((s) => s.groups);
  const containers = useWslc((s) => s.containers);
  const saveGroup = useWslc((s) => s.saveGroup);
  const deleteGroup = useWslc((s) => s.deleteGroup);
  const startGroup = useWslc((s) => s.startGroup);
  const stopGroup = useWslc((s) => s.stopGroup);
  const [editing, setEditing] = useState<ContainerGroup | null>(null);

  const counts = useMemo(() => {
    const result = new Map<string, { total: number; running: number }>();
    for (const group of groups) {
      const memberNames = new Set(group.specs.map((spec) => spec.name));
      const members = containers.filter((container) =>
        container.groupId === group.id || memberNames.has(container.name),
      );
      result.set(group.id, {
        total: members.length || group.specs.length,
        running: members.filter((container) => container.status === "running").length,
      });
    }
    return result;
  }, [containers, groups]);

  return (
    <div className="mx-auto w-full max-w-6xl p-4 sm:p-6">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Groups</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Share a WSLC network and environment variables across related containers.
          </p>
        </div>
        <Button onClick={() => setEditing(emptyGroup())}>
          <Plus className="mr-1.5 size-4" />
          New group
        </Button>
      </div>

      <div className="grid gap-3 lg:grid-cols-2">
        {groups.map((group) => {
          const count = counts.get(group.id) ?? { total: 0, running: 0 };
          const envCount = group.env.split("\n").map((line) => line.trim()).filter(Boolean).length;
          return (
            <section key={group.id} className="rounded-lg border border-border bg-card p-4">
              <div className="flex items-start gap-3">
                <div className="grid size-10 shrink-0 place-items-center rounded-md bg-elevated">
                  <Boxes className="size-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="font-medium">{group.name}</h2>
                    {group.builtIn ? (
                      <span className="rounded bg-elevated px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                        Built-in
                      </span>
                    ) : null}
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <Network className="size-3" /> {group.network}
                    </span>
                    <span>{count.running}/{count.total} running</span>
                    <span>{envCount} shared env</span>
                  </div>
                </div>
              </div>

              {group.env.trim() ? (
                <div className="mt-3 rounded-md border border-border bg-background/50 px-3 py-2 font-mono text-xs text-muted-foreground">
                  {group.env.split("\n").filter(Boolean).slice(0, 4).map((line) => {
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
                <Button size="sm" onClick={() => startGroup(group.id)}>
                  <Play className="mr-1.5 size-3.5" /> Start all
                </Button>
                <Button size="sm" variant="secondary" onClick={() => stopGroup(group.id)}>
                  <Square className="mr-1.5 size-3.5" /> Stop all
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setEditing({ ...group })}>
                  <Pencil className="mr-1.5 size-3.5" /> Configure
                </Button>
                {!group.builtIn ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      deleteGroup(group.id);
                      toast(`Deleted ${group.name}`);
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

      <GroupDialog
        group={editing}
        onClose={() => setEditing(null)}
        onSave={(group) => {
          saveGroup(group);
          toast(`Saved ${group.name}`);
          setEditing(null);
        }}
      />
    </div>
  );
}

function GroupDialog({
  group,
  onClose,
  onSave,
}: {
  group: ContainerGroup | null;
  onClose: () => void;
  onSave: (group: ContainerGroup) => void;
}) {
  const [draft, setDraft] = useState<ContainerGroup | null>(group);

  if (group && (!draft || draft.id !== group.id)) setDraft({ ...group });
  if (!group || !draft) return null;

  const patch = (value: Partial<ContainerGroup>) => setDraft((current) => current ? { ...current, ...value } : current);

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{draft.builtIn ? `Configure ${draft.name}` : draft.name ? `Edit ${draft.name}` : "Create group"}</DialogTitle>
          <DialogDescription>
            Group variables are merged into every container. Container-specific values override variables with the same name.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="group-name">Name</Label>
            <Input
              id="group-name"
              value={draft.name}
              disabled={draft.builtIn}
              onChange={(event) => {
                const name = event.target.value;
                if (draft.name || draft.builtIn) patch({ name });
                else {
                  const id = slugGroupName(name);
                  patch({ name, id, network: defaultGroupNetwork(id) });
                }
              }}
              placeholder="My development stack"
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="group-network">WSLC network</Label>
            <Input
              id="group-network"
              value={draft.network}
              onChange={(event) => patch({ network: event.target.value })}
              placeholder="quay-my-development-stack"
              className="font-mono text-xs"
            />
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="group-env">Shared environment</Label>
            <Textarea
              id="group-env"
              value={draft.env}
              onChange={(event) => patch({ env: event.target.value })}
              placeholder={"API_URL=http://service:5000\nTOKEN=..."}
              className="min-h-36 font-mono text-xs"
            />
            <p className="text-xs text-subtle">One KEY=VALUE per line. Values are hidden on the Group card.</p>
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button
            onClick={() => {
              const name = draft.name.trim();
              if (!name) return;
              const id = draft.builtIn ? draft.id : slugGroupName(name);
              onSave({
                ...draft,
                id,
                name,
                network: draft.network.trim() || defaultGroupNetwork(id),
              });
            }}
          >
            Save group
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
