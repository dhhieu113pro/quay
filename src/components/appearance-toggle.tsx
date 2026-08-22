import { useEffect, useRef, useState } from "react";
import { Moon, Sun, Sunset } from "lucide-react";
import { useAppearance } from "@/components/appearance-provider";
import { cn } from "@/lib/utils";
import type { AppearanceMode } from "@/lib/appearance";

const OPTIONS: Array<{ id: AppearanceMode; label: string; hint: string }> = [
  { id: "auto", label: "Sunset", hint: "Follow sunrise and sunset" },
  { id: "light", label: "Light", hint: "Always light" },
  { id: "dark", label: "Dark", hint: "Always dark" },
];

export function AppearanceToggle({ compact = false }: { compact?: boolean }) {
  const { mode, scheme, sun, setMode } = useAppearance();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const Icon = mode === "auto" ? Sunset : scheme === "dark" ? Moon : Sun;

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const sunHint =
    mode === "auto" && sun
      ? `${sun.kind === "sunset" ? "Sunset" : "Sunrise"} ${sun.at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
      : mode === "auto"
        ? "Sunset · 6:30–18:30 until location is known"
        : null;

  if (!compact) {
    return (
      <div className="grid gap-2">
        <div className="flex rounded-lg bg-elevated p-1">
          {OPTIONS.map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => setMode(opt.id)}
              className={cn(
                "h-9 flex-1 rounded-md text-xs",
                mode === opt.id ? "bg-card text-foreground" : "text-muted-foreground",
              )}
            >
              {opt.label}
            </button>
          ))}
        </div>
        {sunHint ? <p className="font-mono text-xs text-subtle">{sunHint}</p> : null}
      </div>
    );
  }

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-label={`Appearance: ${mode}`}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="grid h-12 w-11 place-items-center text-muted-foreground hover:bg-elevated hover:text-foreground"
      >
        <Icon className="size-3.5" />
      </button>
      {open ? (
        <div className="absolute right-0 top-full z-50 mt-1 w-52 rounded-lg border border-border bg-popover p-1 shadow-lg">
          {OPTIONS.map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => {
                setMode(opt.id);
                setOpen(false);
              }}
              className={cn(
                "flex w-full flex-col rounded-md px-2.5 py-2 text-left",
                mode === opt.id ? "bg-elevated text-foreground" : "text-muted-foreground hover:bg-elevated/70",
              )}
            >
              <span className="text-sm">{opt.label}</span>
              <span className="text-xs text-subtle">{opt.hint}</span>
            </button>
          ))}
          {sunHint ? (
            <p className="px-2.5 py-1.5 font-mono text-xs text-subtle">{sunHint}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
