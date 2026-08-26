import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { isNearBottom } from "@/lib/log-follow";
import { filterAggregatedLogs } from "@/lib/wslc/log-filters";
import { useLogs } from "@/lib/wslc/log-store";
import { formatLogSource } from "@/lib/wslc/logs";
import { cn } from "@/lib/utils";

function formatTimestamp(ts: number) {
  const value = new Date(ts);
  const base = value.toLocaleTimeString([], { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
  return `${base}.${String(value.getMilliseconds()).padStart(3, "0")}`;
}

export function CubeLogsPanel({ cubeId, cubeName, onClose }: { cubeId: string; cubeName: string; onClose: () => void }) {
  const lines = useLogs((state) => state.aggregatedLogs);
  const refreshAggregatedLogs = useLogs((state) => state.refreshAggregatedLogs);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const previousNewestVisibleId = useRef<string | null>(null);
  const [follow, setFollow] = useState(true);
  const [newWhilePaused, setNewWhilePaused] = useState(false);

  useEffect(() => {
    void refreshAggregatedLogs();
    const id = window.setInterval(() => void refreshAggregatedLogs(), 1500);
    return () => window.clearInterval(id);
  }, [refreshAggregatedLogs]);

  const visible = useMemo(() => filterAggregatedLogs(lines, cubeId, null), [lines, cubeId]);
  const newestVisibleId = visible.at(-1)?.id ?? null;

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
    <div className="flex h-full min-h-0 flex-1 flex-col border-l border-border bg-background">
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold">{cubeName} logs</h2>
          <p className="text-xs text-muted-foreground">All running members · sorted by time</p>
        </div>
        <Button type="button" variant="ghost" size="icon-sm" aria-label="Close Cube logs" onClick={onClose}>
          <X className="size-4" />
        </Button>
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
            <div className="grid h-full min-h-48 place-items-center px-4 text-center text-muted-foreground">
              No running-member logs for {cubeName} yet.
            </div>
          ) : (
            <div className="min-w-0 space-y-0.5">
              {visible.map((line) => (
                <div key={line.id} className={cn("grid min-w-0 grid-cols-[5.75rem_minmax(0,1fr)] gap-x-2 rounded px-2 py-1 hover:bg-elevated/50", line.stream === "stderr" && "text-warn")}>
                  <time className="tabular-nums text-subtle">{formatTimestamp(line.ts)}</time>
                  <span className="truncate text-muted-foreground" title={formatLogSource(line)}>{formatLogSource(line)}</span>
                  <span className="col-span-2 whitespace-pre-wrap break-words pt-0.5 text-foreground">{line.text}</span>
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
