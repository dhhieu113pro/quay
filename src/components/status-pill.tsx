import { cn } from "@/lib/utils";
import type { ContainerStatus } from "@/lib/wslc/types";

const styles: Record<ContainerStatus, string> = {
  running: "text-ok bg-ok/15",
  exited: "text-muted-foreground bg-elevated",
  created: "text-warn bg-warn/15",
  paused: "text-warn bg-warn/15",
  removing: "text-destructive bg-destructive/15",
};

export function StatusPill({ status }: { status: ContainerStatus }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium capitalize",
        styles[status],
      )}
    >
      <span
        className={cn(
          "size-1.5 rounded-full",
          status === "running" ? "bg-ok" : "bg-current opacity-70",
        )}
      />
      {status}
    </span>
  );
}
