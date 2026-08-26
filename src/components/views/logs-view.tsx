import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { isNearBottom } from "@/lib/log-follow";
import { containerOptionsForCube, filterAggregatedLogs } from "@/lib/wslc/log-filters";
import { useLogs } from "@/lib/wslc/log-store";
import { formatLogSource } from "@/lib/wslc/logs";
import { useWslc } from "@/lib/wslc/store";
import { cn } from "@/lib/utils";

function formatTimestamp(ts: number) {
  const value = new Date(ts);
  const base = value.toLocaleTimeString([], { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
  return `${base}.${String(value.getMilliseconds()).padStart(3, "0")}`;
}

export function LogsView() {
  const containers = useWslc((state) => state.containers);
  const groups = useWslc((state) => state.groups);
  const lines = useLogs((state) => state.aggregatedLogs);
  const cubeFilter = useLogs((state) => state.logCubeFilter);
  const containerFilter = useLogs((state) => state.logContainerFilter);
  const setCubeFilter = useLogs((state) => state.setLogCubeFilter);
  const setContainerFilter = useLogs((state) => state.setLogContainerFilter);
  const refreshAggregatedLogs = useLogs((state) => state.refreshAggregatedLogs);
  const clearLogs = useLogs((state) => state.clearLogs);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const previousNewestVisibleId = useRef<string | null>(null);
  const [follow, setFollow] = useState(true);
  const [newWhilePaused, setNewWhilePaused] = useState(false);

  useEffect(() => {
    void refreshAggregatedLogs();
    const id = window.setInterval(() => void refreshAggregatedLogs(), 1500);
    return () => window.clearInterval(id);
  }, [refreshAggregatedLogs]);

  const visible = useMemo(
    () => filterAggregatedLogs(lines, cubeFilter, containerFilter),
    [lines, cubeFilter, containerFilter],
  );
  const newestVisibleId = visible.at(-1)?.id ?? null;

  const containerOptions = useMemo(
    () => containerOptionsForCube(containers, groups, cubeFilter),
    [containers, groups, cubeFilter],
  );

  useEffect(() => {
    const viewport = viewportRef.current;
    const changed = newestVisibleId !== previousNewestVisibleId.current;
    previousNewestVisibleId.current = newestVisibleId;
    if (!viewport || !changed || newestVisibleId === null) return;
    if (follow) {
      viewport.scrollTop = viewport.scrollHeight;
      setNewWhilePaused(false);
    } else {
      setNewWhilePaused(true);
    }
  }, [newestVisibleId, follow]);

  function resumeFollow() {
    const viewport = viewportRef.current;
    if (viewport) viewport.scrollTop = viewport.scrollHeight;
    setFollow(true);
    setNewWhilePaused(false);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-border bg-background/95 px-4 py-3 backdrop-blur">
        <div>
          <h1 className="text-lg font-semibold">Logs</h1>
          <p className="text-xs text-muted-foreground">All running-container output, merged by time.</p>
        </div>
        <label className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
          Cube
          <select
            aria-label="Cube log filter"
            value={cubeFilter ?? ""}
            onChange={(event) => setCubeFilter(event.target.value || null)}
            className="h-9 rounded-md border border-border bg-card px-2 text-sm text-foreground"
          >
            <option value="">All</option>
            {groups.map((cube) => <option key={cube.id} value={cube.id}>{cube.name}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          Container
          <select
            aria-label="Container log filter"
            value={containerFilter ?? ""}
            onChange={(event) => setContainerFilter(event.target.value || null)}
            className="h-9 rounded-md border border-border bg-card px-2 text-sm text-foreground"
          >
            <option value="">All</option>
            {containerOptions.map((option) => <option key={option.name} value={option.name}>{option.label}</option>)}
          </select>
        </label>
        <Button variant="ghost" size="sm" onClick={clearLogs}><Trash2 className="size-4" />Clear</Button>
      </div>

      <div className="relative min-h-0 flex-1 bg-card/30">
        <div
          ref={viewportRef}
          onScroll={(event) => {
            const viewport = event.currentTarget;
            const nearBottom = isNearBottom(viewport.scrollTop, viewport.clientHeight, viewport.scrollHeight);
            setFollow(nearBottom);
            if (nearBottom) setNewWhilePaused(false);
          }}
          className="h-full overflow-auto p-3 font-mono text-xs"
        >
          {visible.length === 0 ? (
            <div className="grid h-full min-h-48 place-items-center text-muted-foreground">
              No logs match the current filters.
            </div>
          ) : (
            <div className="min-w-0 space-y-0.5">
              {visible.map((line) => (
                <div key={line.id} className={cn("flex min-w-0 items-start gap-3 rounded px-2 py-1 hover:bg-elevated/50", line.stream === "stderr" && "text-warn")}>
                  <time className="shrink-0 tabular-nums text-subtle">{formatTimestamp(line.ts)}</time>
                  <span className="w-52 shrink-0 truncate text-muted-foreground" title={formatLogSource(line)}>{formatLogSource(line)}</span>
                  <span className="min-w-0 flex-1 whitespace-pre-wrap break-words text-foreground">{line.text}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        {!follow && newWhilePaused ? (
          <Button className="absolute bottom-4 right-4 shadow-lg" size="sm" onClick={resumeFollow}>
            <ArrowDown className="size-4" />New logs
          </Button>
        ) : null}
      </div>
    </div>
  );
}
