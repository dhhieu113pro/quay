import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { publishedPortRows, updatePublishedHostPort } from "@/lib/wslc/image-inspect-defaults";

export function PortBindingEditor({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const rows = publishedPortRows(value);
  if (!rows.length) return null;

  return (
    <div className="grid gap-2">
      <div className="flex items-end justify-between gap-3">
        <Label>Port bindings</Label>
        <span className="text-[11px] text-subtle">Only the host port can be changed.</span>
      </div>
      <div className="grid gap-2">
        {rows.map((row, index) => (
          <div
            key={`${row.containerPort}-${row.protocol}-${index}`}
            className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto] items-end gap-2 rounded-lg border border-border bg-elevated/20 p-3"
          >
            <div className="grid gap-1.5">
              <Label htmlFor={`host-port-${index}`} className="text-xs">Host port</Label>
              <Input
                id={`host-port-${index}`}
                type="number"
                inputMode="numeric"
                min={1}
                max={65535}
                required
                value={row.hostPort}
                onChange={(event) => onChange(updatePublishedHostPort(value, index, event.target.value))}
                aria-label={`Host port for container port ${row.containerPort}`}
                className="font-mono text-xs"
              />
            </div>
            <span className="mb-3 text-xs text-subtle" aria-hidden>→</span>
            <div className="grid gap-1.5">
              <Label htmlFor={`container-port-${index}`} className="text-xs">Container port</Label>
              <Input
                id={`container-port-${index}`}
                value={row.containerPort}
                readOnly
                tabIndex={-1}
                aria-label={`Container port ${row.containerPort}`}
                className="font-mono text-xs text-muted-foreground"
              />
            </div>
            <span className="mb-2.5 rounded-md border border-border bg-background px-2 py-1.5 font-mono text-[10px] uppercase text-muted-foreground">
              {row.protocol}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}