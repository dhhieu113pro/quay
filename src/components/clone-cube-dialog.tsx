import { useEffect, useMemo, useState } from "react";
import { Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cloneCubeDraft, renameCloneCube } from "@/lib/wslc/clone";
import { useWslc } from "@/lib/wslc/store";
import type { ContainerGroup } from "@/lib/wslc/types";

export function CloneCubeDialog({ cube, open, onOpenChange }: {
  cube: ContainerGroup | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const groups = useWslc((state) => state.groups);
  const containers = useWslc((state) => state.containers);
  const saveGroup = useWslc((state) => state.saveGroup);
  const [draft, setDraft] = useState<ContainerGroup | null>(null);

  useEffect(() => {
    if (open && cube) setDraft(cloneCubeDraft(cube, groups, containers.map((item) => item.name)));
  }, [open, cube, groups, containers]);

  const duplicateName = useMemo(() => draft ? groups.some((item) => item.name.toLowerCase() === draft.name.trim().toLowerCase()) : false, [draft, groups]);
  if (!cube || !draft) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Clone Cube</DialogTitle>
          <DialogDescription>Only the cloned Cube identity can be changed here. Shared configuration and member definitions are copied from {cube.name}.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="clone-cube-name">Name</Label>
            <Input id="clone-cube-name" value={draft.name} onChange={(event) => setDraft(renameCloneCube(draft, event.target.value))} autoFocus />
            {duplicateName ? <p className="text-xs text-destructive">A Cube with this name already exists.</p> : null}
          </div>
          <div className="grid gap-2 rounded-lg border border-border bg-elevated/30 p-3">
            <div className="grid gap-1 sm:grid-cols-[8rem_minmax(0,1fr)] sm:gap-3"><span className="text-xs text-subtle">Network</span><Input value={draft.network} readOnly className="h-8 font-mono text-xs" /></div>
            <div className="grid gap-1 sm:grid-cols-[8rem_minmax(0,1fr)] sm:gap-3"><span className="text-xs text-subtle">Workspace</span><Input value={draft.workspacePath ?? ""} readOnly className="h-8 font-mono text-xs" /></div>
            <div className="grid gap-1 sm:grid-cols-[8rem_minmax(0,1fr)] sm:gap-3"><span className="text-xs text-subtle">Shared env</span><Input value={draft.env || "none"} readOnly className="h-8 font-mono text-xs" /></div>
          </div>
          <div className="grid max-h-60 gap-2 overflow-y-auto rounded-lg border border-border p-3">
            <p className="text-xs font-medium">Copied members</p>
            {draft.specs.map((spec) => (
              <div key={spec.name} className="grid gap-2 rounded-md bg-elevated/35 p-2 sm:grid-cols-2">
                <Input value={spec.name} readOnly aria-label="Cloned member identity" className="h-8 text-xs" />
                <Input value={spec.image} readOnly aria-label={`Image for ${spec.name}`} className="h-8 font-mono text-xs" />
              </div>
            ))}
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button disabled={!draft.name.trim() || duplicateName} onClick={() => {
            saveGroup(draft);
            toast(`Cloned ${cube.name} as ${draft.name}`);
            onOpenChange(false);
          }}><Copy className="size-4" />Save Clone</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
