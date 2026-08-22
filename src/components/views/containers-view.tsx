import { Gpu, Play, Search, Square } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { ContainerInspect } from "@/components/container-inspect";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatusPill } from "@/components/status-pill";
import { cn, formatUptime } from "@/lib/utils";
import { useWslc } from "@/lib/wslc/store";

export function ContainersView() {
  const containers = useWslc((s) => s.containers);
  const selectedId = useWslc((s) => s.selectedId);
  const inspectOpen = useWslc((s) => s.inspectOpen);
  const selectContainer = useWslc((s) => s.selectContainer);
  const setInspectOpen = useWslc((s) => s.setInspectOpen);
  const startContainer = useWslc((s) => s.startContainer);
  const stopContainer = useWslc((s) => s.stopContainer);
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

  const selected = containers.find((c) => c.id === selectedId) ?? null;

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex flex-col gap-3 border-b border-border px-4 py-3 md:flex-row md:items-center">
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
            Run
          </Button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="px-4 py-16 text-center text-sm text-muted-foreground">
              No containers match.
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {filtered.map((c) => (
                <li key={c.id}>
                  <div
                    className={cn(
                      "flex items-center gap-3 px-4 py-3",
                      selectedId === c.id && inspectOpen ? "bg-elevated" : "hover:bg-elevated/60",
                    )}
                  >
                    <button
                      type="button"
                      className="min-w-0 flex-1 text-left"
                      onClick={() => selectContainer(c.id)}
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium">{c.name}</span>
                        <StatusPill status={c.status} />
                        {c.gpu ? (
                          <Badge variant="gpu">
                            <Gpu className="mr-1 size-3" />
                            GPU
                          </Badge>
                        ) : null}
                      </div>
                      <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">
                        {c.id} · {c.image}
                      </p>
                      <p className="mt-1 font-mono text-xs text-subtle">
                        {c.ports.length
                          ? c.ports.map((p) => `${p.host}:${p.container}`).join("  ")
                          : "no ports"}
                        {" · "}
                        {c.status === "running"
                          ? formatUptime(c.startedAt, now)
                          : c.exitCode !== undefined
                            ? `exit ${c.exitCode}`
                            : "created"}
                      </p>
                    </button>
                    <div className="flex shrink-0 gap-1">
                      {c.status === "running" ? (
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          aria-label={`Stop ${c.name}`}
                          onClick={() => {
                            stopContainer(c.id);
                            toast(`Stopped ${c.name}`);
                          }}
                        >
                          <Square className="size-4" />
                        </Button>
                      ) : (
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          aria-label={`Start ${c.name}`}
                          onClick={() => {
                            startContainer(c.id);
                            toast(`Started ${c.name}`);
                          }}
                        >
                          <Play className="size-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {selected && inspectOpen ? (
        <div className="fixed inset-0 z-40 flex h-dvh flex-col bg-background md:static md:z-0 md:h-auto md:w-[min(100%,24rem)] md:shrink-0 lg:w-[28rem]">
          <ContainerInspect
            container={selected}
            onClose={() => setInspectOpen(false)}
          />
        </div>
      ) : null}
    </div>
  );
}
