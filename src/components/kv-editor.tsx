import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { parseMountLine } from "@/lib/wslc/spec-parse";

export type KvPair = { id: string; key: string; value: string };
export type EnvSuggestion = { key: string; value?: string; source?: string };

function rid() { return Math.random().toString(16).slice(2, 10); }

export function parseEnvLines(raw: string): KvPair[] {
  const rows = raw.split("\n").map((line) => line.trimEnd()).filter((line) => line.length > 0).map((line) => {
    const eq = line.indexOf("=");
    if (eq === -1) return { id: rid(), key: line, value: "" };
    return { id: rid(), key: line.slice(0, eq), value: line.slice(eq + 1) };
  });
  return rows.length ? rows : [{ id: rid(), key: "", value: "" }];
}

export function joinEnvLines(rows: KvPair[]) {
  return rows.filter((r) => r.key.trim()).map((r) => `${r.key}=${r.value}`).join("\n");
}

export function EnvEditor({ rows, onChange, label = "Environment", suggestions = [], inheritedRows = [], protectedKeys = new Set<string>(), sourceByKey = {}, requiredKeys = new Set<string>() }: {
  rows: KvPair[];
  onChange: (rows: KvPair[]) => void;
  label?: string;
  suggestions?: EnvSuggestion[];
  inheritedRows?: KvPair[];
  protectedKeys?: ReadonlySet<string>;
  sourceByKey?: Readonly<Record<string, string>>;
  requiredKeys?: ReadonlySet<string>;
}) {
  function patch(id: string, next: Partial<KvPair>) { onChange(rows.map((r) => (r.id === id ? { ...r, ...next } : r))); }
  const existing = new Set([...rows.map((row) => row.key.trim()), ...inheritedRows.map((row) => row.key.trim())].filter(Boolean));
  const available = suggestions.filter((suggestion, index) => suggestion.key.trim() && !existing.has(suggestion.key.trim()) && suggestions.findIndex((item) => item.key === suggestion.key) === index);
  function addSuggestion(suggestion: EnvSuggestion) {
    const blank = rows.find((row) => !row.key.trim() && !row.value);
    if (blank) { patch(blank.id, { key: suggestion.key, value: suggestion.value ?? "" }); return; }
    onChange([...rows, { id: rid(), key: suggestion.key, value: suggestion.value ?? "" }]);
  }

  return <div className="grid gap-2">
    <div className="flex items-center justify-between gap-2"><Label>{label}</Label><Button type="button" variant="ghost" size="sm" onClick={() => onChange([...rows, { id: rid(), key: "", value: "" }])}><Plus className="size-3.5" /> Add</Button></div>
    {available.length ? <div className="flex flex-wrap gap-1.5">{available.map((suggestion) => <button key={`${suggestion.source ?? "env"}:${suggestion.key}`} type="button" title={suggestion.source ? `From ${suggestion.source}` : `Add ${suggestion.key}`} onClick={() => addSuggestion(suggestion)} className="rounded-md border border-border bg-background px-2 py-1 font-mono text-[11px] text-muted-foreground hover:bg-elevated hover:text-foreground">+ {suggestion.key}{suggestion.source ? <span className="ml-1 font-sans text-subtle">· {suggestion.source}</span> : null}</button>)}</div> : null}
    {inheritedRows.length ? <div className="grid gap-2 rounded-md border border-border bg-elevated/40 p-2"><p className="text-[11px] text-subtle">Inherited from Cube · edit these in Cube configuration</p>{inheritedRows.filter((row) => row.key.trim()).map((row) => <div key={`inherited-${row.key}`} className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_4.5rem]"><Input value={row.key} disabled aria-label="Inherited variable name" className="font-mono text-xs" /><Input value={row.value} disabled aria-label={`Inherited value for ${row.key}`} className="font-mono text-xs" /><span className="grid place-items-center text-[10px] text-subtle">Cube</span></div>)}</div> : null}
    <ul className="grid max-h-56 gap-2 overflow-y-auto pr-1">{rows.map((row) => {
      const key = row.key.trim();
      const source = sourceByKey[key];
      const required = requiredKeys.has(key);
      const sourceLabel = required ? "Required" : (source ?? (key ? "Custom" : ""));
      return <li key={row.id} className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_5.5rem_2.75rem]">
        <Input value={row.key} onChange={(e) => patch(row.id, { key: e.target.value })} placeholder="NAME" aria-label="Variable name" className="font-mono text-xs" autoComplete="off" spellCheck={false} />
        <Input value={row.value} onChange={(e) => patch(row.id, { value: e.target.value })} placeholder={required ? "required" : "value"} aria-invalid={required && !row.value.trim()} aria-label={`Value for ${row.key || "variable"}`} className="font-mono text-xs" autoComplete="off" spellCheck={false} />
        <span className={required && !row.value.trim() ? "grid place-items-center rounded-md border border-destructive/40 px-1 text-center text-[10px] text-destructive" : "grid place-items-center text-center text-[10px] text-subtle"}>{sourceLabel}</span>
        {!protectedKeys.has(row.key.trim()) ? <Button type="button" variant="ghost" size="icon" aria-label="Remove variable" disabled={rows.length <= 1 && !row.key && !row.value} onClick={() => { const next = rows.filter((r) => r.id !== row.id); onChange(next.length ? next : [{ id: rid(), key: "", value: "" }]); }}><Trash2 className="size-3.5" /></Button> : <span aria-label="Protected container variable" />}
      </li>;
    })}</ul>
  </div>;
}

export type MountRow = { id: string; source: string; destination: string; mode: "rw" | "ro" };
export function parseMountLines(raw: string): MountRow[] { const rows = raw.split("\n").map((line) => line.trim()).filter(Boolean).map((line) => ({ id: rid(), ...parseMountLine(line) })); return rows.length ? rows : [{ id: rid(), source: "", destination: "", mode: "rw" }]; }
export function joinMountLines(rows: MountRow[]) { return rows.filter((r) => r.source.trim() && r.destination.trim()).map((r) => `${r.source}:${r.destination}:${r.mode}`).join("\n"); }
export function MountEditor({ rows, onChange }: { rows: MountRow[]; onChange: (rows: MountRow[]) => void; }) {
  function patch(id: string, next: Partial<MountRow>) { onChange(rows.map((r) => (r.id === id ? { ...r, ...next } : r))); }
  return <div className="grid gap-2"><div className="flex items-center justify-between gap-2"><Label>Mounts</Label><Button type="button" variant="ghost" size="sm" onClick={() => onChange([...rows, { id: rid(), source: "", destination: "", mode: "rw" }])}><Plus className="size-3.5" />Add</Button></div><ul className="grid gap-2">{rows.map((row) => <li key={row.id} className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_4.5rem_2.75rem]"><Input value={row.source} onChange={(e) => patch(row.id, { source: e.target.value })} placeholder="D:\\wslc\\workspaces" aria-label="Host path" className="font-mono text-xs" spellCheck={false} /><Input value={row.destination} onChange={(e) => patch(row.id, { destination: e.target.value })} placeholder="/workspace" aria-label="Container path" className="font-mono text-xs" spellCheck={false} /><button type="button" className="h-11 rounded-md border border-border bg-background font-mono text-xs text-muted-foreground hover:bg-elevated hover:text-foreground" onClick={() => patch(row.id, { mode: row.mode === "rw" ? "ro" : "rw" })} aria-label={`Mode ${row.mode}`}>{row.mode}</button><Button type="button" variant="ghost" size="icon" aria-label="Remove mount" onClick={() => { const next = rows.filter((r) => r.id !== row.id); onChange(next.length ? next : [{ id: rid(), source: "", destination: "", mode: "rw" }]); }}><Trash2 className="size-3.5" /></Button></li>)}</ul></div>;
}
