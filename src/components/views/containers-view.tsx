import { Gpu, Play, Search, Square } from "lucide-react";
import { useMemo, useState } from "react";
import { ContainerInspect } from "@/components/container-inspect";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusPill } from "@/components/status-pill";
import { cn, formatUptime } from "@/lib/utils";
import { useWslc } from "@/lib/wslc/store";
import type { Container } from "@/lib/wslc/types";

export function ContainersView() {
  const containers = useWslc((s) => s.containers);
  const cubes = useWslc((s) => s.groups);
  const selectedId = useWslc((s) => s.selectedId);
  const inspectOpen = useWslc((s) => s.inspectOpen);
  const selectContainer = useWslc((s) => s.selectContainer);
  const setInspectOpen = useWslc((s) => s.setInspectOpen);
  const setRunOpen = useWslc((s) => s.setRunOpen);
  const startContainer = useWslc((s) => s.startContainer);
  const stopContainer = useWslc((s) => s.stopContainer);
  const now = useWslc((s) => s.now);
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<"all" | "running" | "exited">("all");

  const cubeNames = useMemo(
    () => new Set(cubes.flatMap((cube) => cube.specs.map((spec) => spec.name).filter(Boolean))),
    [cubes],
  );

  const standalone = useMemo(
    () => containers.filter((container) => !container.groupId && !cubeNames.has(container.name)),
    [containers, cubeNames],
  );

  const filtered = useMemo(() => {
    return standalone.filter((c) => {
      if (filter === "running" && c.status !== "running") return false;
      if (filter === "exited" && c.status === "running") return false;
      if (!q.trim()) return true;
      const hay = `${c.name} ${c.image} ${c.id}`.toLowerCase();
      return hay.includes(q.toLowerCase());
    });
  }, [standalone, filter, q]);

  const selected = standalone.find((c) => c.id === selectedId) ?? null;

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="sticky top-0 z-20 flex flex-col gap-3 border-b border-border bg-background/95 px-4 py-3 backdrop-blur md:flex-row md:items-center">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-subtle" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Filter standalone containers"
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
          {filtered.length === 0 ? (
            <div className="px-4 py-16 text-center">
              <p className="text-sm text-muted-foreground">No standalone containers match.</p>
              <p className="mt-1 text-xs text-subtle">Cube containers are managed from the Cubes page.</p>
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {filtered.map((c) => (
                <ContainerRow
                  key={c.id}
                  c={c}
                  selected={selectedId === c.id && inspectOpen}
                  now={now}
                  onSelect={selectContainer}
                  onStart={startContainer}
                  onStop={stopContainer}
                />
              ))}
            </ul>
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

function ContainerRow({
  c,
  selected,
  now,
  onSelect,
  onStart,
  onStop,
}: {
  c: Container;
  selected: boolean;
  now: number;
  onSelect: (id: string) => void;
  onStart: (id: string) => void;
  onStop: (id: string) => void;
}) {
  const running = c.status === "running";

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
            {running ? formatUptime(c.startedAt, now) : "exited"}
          </p>
        </button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={() => running ? onStop(c.id) : onStart(c.id)}
          aria-label={running ? `Stop ${c.name}` : `Start ${c.name}`}
          title={running ? `Stop ${c.name}` : `Start ${c.name}`}
          className="shrink-0 text-muted-foreground hover:text-foreground"
        >
          {running ? <Square className="size-4" /> : <Play className="size-4" />}
        </Button>
      </div>
    </li>
  );
}
