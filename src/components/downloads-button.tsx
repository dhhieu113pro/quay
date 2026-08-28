import { Download } from "lucide-react";
import { DownloadsPanel } from "@/components/downloads-panel";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useWslc } from "@/lib/wslc/store";

const ACTIVE_STATUSES = ["queued", "pulling", "cancelling"] as const;

export function DownloadsButton() {
  const pulls = useWslc((state) => state.pulls);
  const activeCount = pulls.filter((job) => ACTIVE_STATUSES.includes(job.status as (typeof ACTIVE_STATUSES)[number])).length;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label={activeCount ? `Downloads, ${activeCount} active` : "Downloads"}
          title="Downloads"
          className="relative"
        >
          <Download className="size-4" />
          {activeCount > 0 ? (
            <span className="absolute -right-0.5 -top-0.5 grid min-w-4 place-items-center rounded-full bg-accent px-1 text-[10px] font-semibold leading-4 text-accent-foreground">
              {activeCount > 9 ? "9+" : activeCount}
            </span>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="p-0">
        <DownloadsPanel />
      </PopoverContent>
    </Popover>
  );
}
