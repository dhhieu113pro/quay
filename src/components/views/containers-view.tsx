import { Gpu, Play, RefreshCw, Search, Square } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { ContainerInspect } from "@/components/container-inspect";
import { applyStackConfig, StackConfigDialog } from "@/components/stack-config-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { StatusPill } from "@/components/status-pill";
import { cn, formatUptime } from "@/lib/utils";
import { useWslc } from "@/lib/wslc/store";
import type { Container, ContainerGroup } from "@/lib/wslc/types";

export function ContainersView() {
  const containers = useWslc((s) => s.containers);
  const groups = useWslc((s) => s.groups);
  const selectedId = useWslc((s) => s.selectedId);
  const inspectOpen = useWslc((s) => s.inspectOpen);
  const selectContainer = useWslc((s) => s.selectContainer);
  const setInspectOpen = useWslc((s) => s.setInspectOpen);
  const setGroupAutoStart = useWslc((s) => s.setGroupAutoStart);
  const startGroup = useWslc((s) => s.startGroup);
  const stopGroup = useWslc((s) => s.stopGroup);
  const tick = useWslc((s) => s.tick);
  const setRunOpen = useWslc((s) => s.setRunOpen);
  const now = useWslc((s) => s.now);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | "running" | "exited">("all");

  const filtered = useMemo(() => {
    return containers.filter((c) => {
      if (filter === "running" && c.status !== "running") return false;
      if (filter === "exited" && c.status === "running") return false;
      if (!q.trim()) return true;
      const hay = `${c.name} ${c.image} ${c.id}`.toLowerCase();
      return hay.includes(q.toLowerCase());
    });
  }, [containers, filter, q]);

  const grouped = useMemo(() => {
    return groups.map((group) => {
      if (group.id === "local-coding") applyStackConfig(group);
      const names = new Set(group.specs.map((s) => s.name));
      const items = filtered.filter(
        (c) => c.groupId === group.id || names.has(c.name),
      );
      return { group, items };
    });
  }, [groups, filtered]);

  const groupedIds = useMemo(() => {
    const ids = new Set<string>();
    for (const { items } of grouped) {
      for (const c of items) ids.add(c.id);
    }
    return ids;
  }, [grouped]);

  const ungrouped = filtered.filter((c) => !groupedIds.has(c.id));
  const selected = containers.find((c) => c.id === selectedId) ?? null;

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="sticky top-0 z-20 flex flex-col gap-3 border-b border-border bg-background/95 px-4 py-3 backdrop-blur md:flex-row md:items-center">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Filter by name, image, id"
              className="pl-9"
            />
          </div>
          <div className="flex gap-1 rounded-lg bg-elevated p-1">
            {(["all", "running", "exited"] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                className={cn(
                  "h-9 rounded-md px-3 text-xs capitalize",
                  filter === f ? "bg-card text-foreground" : "text-muted-foreground",
                )}
              >
                {f}
              </button>
            ))}
          </div>
          <Button onClick={() => setRunOpen(true)} className="md:w-auto">
            Run Container
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {filtered.length === 0 && grouped.every((g) => g.items.length === 0) ? (
            <div className="px-4 py-16 text-center text-sm text-muted-foreground">
              No containers match.
            </div>
          ) : (
            <div>
              {grouped.map(({ group, items }) =>
                items.length === 0 && q.trim() ? null : (
                  <CubeBlock
                    key={group.id}
                    group={group}
                    items={items}
                    selectedId={selectedId}
                    inspectOpen={inspectOpen}
                    now={now}
                    onSelect={selectContainer}
                    onStart={() => {
                      startGroup(group.id);
                      toast(`Starting ${group.name}`);
                    }}
                    onStop={() => {
                      stopGroup(group.id);
                      toast(`Stopping ${group.name}`);
                    }}
                    onRefresh={() => {
                      void tick();
                    }}
                    onAuto={(on) => {
                      setGroupAutoStart(group.id, on);
                      toast(on ? `${group.name} starts with the session` : `${group.name} auto-start off`);
                    }}
                  />
                ),
              )}
              {ungrouped.length > 0 ? (
                <ul className="divide-y divide-border">
                  {ungrouped.map((c) => (
                    <ContainerRow
                      key={c.id}
                      c={c}
                      selected={selectedId === c.id && inspectOpen}
                      now={now}
                      onSelect={selectContainer}
                    />
                  ))}
                </ul>
              ) : null}
            </div>
          )}
        </div>
      </div>

      {selected && inspectOpen ? (
        <div className="fixed inset-0 z-40 flex h-dvh flex-col bg-background md:static md:z-0 md:h-auto md:w-[min(100%,24rem)] md:shrink-0 lg:w-[28rem]">
          <ContainerInspect container={selected} onClose={() => setInspectOpen(false)} />
        </div>
      ) : null}
    </div>
  );
}

function CubeBlock({
  group,
  items,
  selectedId,
  inspectOpen,
  now,
  onSelect,
  onStart,
  onStop,
  onRefresh,
  onAuto,
}: {
  group: ContainerGroup;
  items: Container[];
  selectedId: string | null;
  inspectOpen: boolean;
  now: number;
  onSelect: (id: string) => void;
  onStart: () => void;
  onStop: () => void;
  onRefresh: () => void;
  onAuto: (on: boolean) => void;
}) {
  const running = items.filter((c) => c.status === "running").length;
  return (
    <section className="border-b border-border">
      <header className="flex flex-wrap items-center gap-2 bg-elevated/50 px-4 py-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">{group.name}</p>
          <p className="font-mono text-xs text-subtle">
            {items.length} containers · {running} running
          </p>
        </div>
        {group.id === "local-coding" ? <StackConfigDialog group={group} /> : null}
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <Switch checked={group.autoStart} onCheckedChange={onAuto} />
          Auto
        </label>
        <Button
          size="icon-sm"
          variant="ghost"
          onClick={onRefresh}
          title="Refresh now"
          aria-label={`Refresh ${group.name}`}
        >
          <RefreshCw />
        </Button>
        <Button size="sm" variant="secondary" onClick={onStop}>Stop</Button>
        <Button size="sm" onClick={onStart}>Start</Button>
      </header>
      <ul className="divide-y divide-border">
        {items.map((c) => (
          <ContainerRow
            key={c.id}
            c={c}
            selected={selectedId === c.id && inspectOpen}
            now={now}
            onSelect={onSelect}
          />
        ))}
      </ul>
    </section>
  );
}

function ContainerRow({
  c,
  selected,
  now,
  onSelect,
}: {
  c: Container;
  selected: boolean;
  now: number;
  onSelect: (id: string) => void;
}) {
  return (
    <li>
      <div className={cn("flex items-center gap-3 px-4 py-3", selected ? "bg-elevated" : "hover:bg-elevated/60")}> 
        <button type="button" className="min-w-0 flex-1 text-left" onClick={() => onSelect(c.id)}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium">{c.name}</span>
            <StatusPill status={c.status} />
            {c.gpu ? (
              <Badge variant="gpu"><Gpu className="mr-1 size-3" />GPU</Badge>
            ) : null}
          </div>
          <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
            {c.id} · {c.image}
          </p>
          <p className="mt-1 font-mono text-xs text-subtle">
            {c.ports.length ? c.ports.map((p) => `${p.host}:${p.container}`).join("  ") : "no ports"}
            {" · "}
            {c.status === "running" ? formatUptime(c.startedAt, now) : "exited"}
          </p>
        </button>
        <div className="flex shrink-0 gap-1">
          {c.status === "running" ? <Square className="size-4 text-muted-foreground" /> : <Play className="size-4 text-muted-foreground" />}
        </div>
      </div>
    </li>
  );
}
