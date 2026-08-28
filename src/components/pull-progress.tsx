import { formatBytes } from "@/lib/utils";
import { useWslc } from "@/lib/wslc/store";
import type { PullJob } from "@/lib/wslc/types";

export function PullProgress({ job }: { job: PullJob }) {
  const now = useWslc((state) => state.now);
  const determinate = typeof job.progress === "number" && Number.isFinite(job.progress);
  const pct = determinate ? Math.max(0, Math.min(100, job.progress!)) : 0;
  const details: string[] = [];

  if (job.totalBytes) details.push(`${formatBytes(job.currentBytes)} / ${formatBytes(job.totalBytes)}`);
  if (job.bytesPerSecond) details.push(`${formatBytes(job.bytesPerSecond)}/s`);
  if (job.startedAt) details.push(`${Math.max(0, Math.floor((now - job.startedAt) / 1000))}s`);

  return (
    <div className="space-y-1.5">
      <div className="h-1.5 overflow-hidden rounded-full bg-elevated">
        {determinate ? (
          <div
            className="h-full rounded-full bg-accent transition-[width]"
            style={{ width: `${pct}%` }}
          />
        ) : (
          <div
            className="h-full w-1/3 animate-pulse rounded-full bg-accent"
            data-progress="indeterminate"
          />
        )}
      </div>
      <p className="truncate text-xs text-muted-foreground">{job.message || job.status}</p>
      {details.length ? <p className="truncate font-mono text-[11px] text-subtle">{details.join(" · ")}</p> : null}
    </div>
  );
}
