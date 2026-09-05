import { useEffect, useState } from "react";
import { ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  mcpConfirm,
  mcpPendingConfirmations,
  onMcpConfirmationRequested,
  type McpConfirmationRequest,
} from "@/lib/mcp";

export function McpConfirmationDialog() {
  const [request, setRequest] = useState<McpConfirmationRequest | null>(null);
  const [resolving, setResolving] = useState(false);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void mcpPendingConfirmations().then((pending) => {
      if (!disposed && pending.length > 0) setRequest(pending[0]);
    });
    void onMcpConfirmationRequested((next) => {
      if (!disposed) setRequest((current) => current ?? next);
    }).then((dispose) => {
      if (disposed) dispose();
      else unlisten = dispose;
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  async function resolve(approve: boolean) {
    if (!request || resolving) return;
    setResolving(true);
    const id = request.id;
    try {
      await mcpConfirm(id, approve);
      toast(approve ? "Approved MCP action" : "Rejected MCP action");
      setRequest(null);
      const pending = await mcpPendingConfirmations();
      if (pending.length > 0) setRequest(pending[0]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not resolve MCP action");
    } finally {
      setResolving(false);
    }
  }

  return (
    <Dialog
      open={Boolean(request)}
      onOpenChange={(open) => {
        if (!open && request && !resolving) void resolve(false);
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ShieldAlert className="size-5" /> Approve MCP action?
          </DialogTitle>
          <DialogDescription>
            An LLM or agent connected to Quay requested a destructive operation. Quay will not execute it until you approve this one request.
          </DialogDescription>
        </DialogHeader>
        {request ? (
          <div className="space-y-3">
            <div className="rounded-lg border border-border bg-muted/30 p-3">
              <p className="text-xs uppercase tracking-widest text-subtle">Tool</p>
              <p className="mt-1 font-mono text-sm">{request.tool}</p>
            </div>
            <div className="rounded-lg border border-border bg-muted/30 p-3">
              <p className="text-xs uppercase tracking-widest text-subtle">Target</p>
              <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-all font-mono text-xs text-muted-foreground">
                {JSON.stringify(request.arguments, null, 2)}
              </pre>
            </div>
            <p className="text-xs text-subtle">
              This approval expires automatically and cannot be reused for another operation.
            </p>
          </div>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" disabled={resolving} onClick={() => void resolve(false)}>Reject</Button>
          <Button disabled={resolving} onClick={() => void resolve(true)}>{resolving ? "Resolving…" : "Approve once"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
