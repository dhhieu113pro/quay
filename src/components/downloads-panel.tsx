import { CheckCircle2, CircleAlert, LoaderCircle, X } from "lucide-react";
import { PullProgress } from "@/components/pull-progress";
import { Button } from "@/components/ui/button";
import { useWslc } from "@/lib/wslc/store";
import type { PullJob } from "@/lib/wslc/types";

const ACTIVE_STATUSES: PullJob["status"][] = ["queued", "pulling", "cancelling"];
const RECENT_STATUSES: PullJob["status"][] = ["completed", "failed", "cancelled", "interrupted"];

export function DownloadsPanel() {
  const pulls = useWslc((state) => state.pulls);
  const cancelPull = useWslc((state) => state.cancelPull);
  const clearPullHistory = useWslc((state) => state.clearPullHistory);
  const setView = useWslc((state) => state.setView);
  const active = pulls.filter((job) => ACTIVE_STATUSES.includes(job.status));
  const recent = pulls.filter((job) => RECENT_STATUSES.includes(job.status));

  return (
    <div className="flex max-h-[min(70vh,34rem)] w-[min(26rem,calc(100vw-1.5rem))] flex-col">
      <div className="border-b border-border px-4 py-3">
        <h2 className="text-sm font-medium">Downloads</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">Background image pulls continue while you work.</p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {active.length ? (
          <section>
            <p className="px-2 py-1.5 text-[11px] font-medium uppercase tracking-wider text-subtle">Active</p>
            <div className="space-y-1">
              {active.map((job) => (
                <PullRow key={job.id} job={job} onCancel={() => void cancelPull(job.id)} />
              ))}
            </div>
          </section>
        ) : null}

        {recent.length ? (
          <section className={active.length ? "mt-3" : undefined}>
            <p className="px-2 py-1.5 text-[11px] font-medium uppercase tracking-wider text-subtle">Recent</p>
            <div className="space-y-1">
              {recent.map((job) => <RecentRow key={job.id} job={job} />)}
            </div>
          </section>
        ) : null}

        {!active.length && !recent.length ? (
          <div className="px-4 py-10 text-center text-sm text-muted-foreground">No downloads yet.</div>
        ) : null}
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-border p-2">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={!recent.length}
          onClick={() => void clearPullHistory()}
        >
          Clear history
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={() => setView("images")}>
          View images
        </Button>
      </div>
    </div>
  );
}

function PullRow({ job, onCancel }: { job: PullJob; onCancel: () => void }) {
  return (
    <div className="rounded-lg border border-border/70 bg-background/50 p-3">
      <div className="mb-2 flex items-start gap-2">
        <LoaderCircle className={job.status === "queued" ? "mt-0.5 size-4 text-muted-foreground" : "mt-0.5 size-4 animate-spin text-accent"} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-mono text-sm">{job.reference}</p>
          <p className="mt-0.5 text-xs capitalize text-muted-foreground">{job.status}</p>
        </div>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label={`Cancel ${job.reference}`}
          disabled={job.status === "cancelling"}
          onClick={onCancel}
        >
          <X className="size-4" />
        </Button>
      </div>
      <PullProgress job={job} />
    </div>
  );
}

function RecentRow({ job }: { job: PullJob }) {
  const successful = job.status === "completed";
  return (
    <div className="rounded-lg px-3 py-2.5 hover:bg-elevated/60">
      <div className="flex items-start gap-2">
        {successful ? (
          <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-ok" />
        ) : (
          <CircleAlert className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <p className="truncate font-mono text-sm">{job.reference}</p>
            <span className="shrink-0 text-[11px] capitalize text-muted-foreground">{job.status}</span>
          </div>
          {job.status === "failed" || job.status === "interrupted" ? (
            <p className="mt-1 line-clamp-2 text-xs text-destructive">{job.error || job.message || "Pull did not complete."}</p>
          ) : job.message ? (
            <p className="mt-1 truncate text-xs text-muted-foreground">{job.message}</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}
