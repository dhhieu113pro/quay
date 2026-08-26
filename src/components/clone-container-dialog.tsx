import { useEffect, useState } from "react";
import { Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cloneContainerSpec, renameCloneContainer } from "@/lib/wslc/clone";
import { useWslc } from "@/lib/wslc/store";
import type { Container, RunSpec } from "@/lib/wslc/types";

export function CloneContainerDialog({ container, open, onOpenChange }: {
  container: Container | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const containers = useWslc((state) => state.containers);
  const runContainer = useWslc((state) => state.runContainer);
  const [draft, setDraft] = useState<RunSpec | null>(null);

  useEffect(() => {
    if (open && container) setDraft(cloneContainerSpec(container, containers.map((item) => item.name)));
  }, [open, container, containers]);

  if (!container || !draft) return null;

  const rows = [
    ["Image", draft.image],
    ["Ports", draft.ports || "none"],
    ["Environment", draft.env || "none"],
    ["Mounts", draft.mounts || "none"],
    ["Command", draft.command || "default"],
    ["Workdir", draft.workdir || "/"],
    ["GPU", draft.gpu ? "enabled" : "disabled"],
  ] as const;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Clone Container</DialogTitle>
          <DialogDescription>Only the cloned container identity can be changed here. Configuration is copied from {container.name}.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="clone-container-name">Name</Label>
            <Input id="clone-container-name" value={draft.name} onChange={(event) => setDraft(renameCloneContainer(draft, event.target.value))} autoFocus />
          </div>
          <div className="grid gap-2 rounded-lg border border-border bg-elevated/30 p-3">
            {rows.map(([label, value]) => (
              <div key={label} className="grid gap-1 sm:grid-cols-[7rem_minmax(0,1fr)] sm:gap-3">
                <span className="text-xs text-subtle">{label}</span>
                <Input value={value} readOnly aria-label={`Cloned ${label}`} className="h-8 font-mono text-xs" />
              </div>
            ))}
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!draft.name.trim()} onClick={() => {
            runContainer(draft);
            toast(`Creating clone ${draft.name}`);
            onOpenChange(false);
          }}><Copy className="size-4" />Create Clone</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
