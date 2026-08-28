import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Download, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { imageSearch } from "@/lib/tauri";
import { useWslc } from "@/lib/wslc/store";
import type { ImageSearchResult } from "@/lib/wslc/types";

type ImageSuggestion = ImageSearchResult & {
  registry: "docker-hub" | "ghcr";
  reference: string;
};

function isGhcrReference(value: string) {
  return value.toLowerCase().startsWith("ghcr.io/");
}

function withDefaultTag(reference: string) {
  if (reference.includes("@")) return reference;
  const lastSegment = reference.split("/").at(-1) ?? reference;
  return lastSegment.includes(":") ? reference : `${reference}:latest`;
}

export function ImageSearch({ disabled = false, className }: { disabled?: boolean; className?: string }) {
  const startPull = useWslc((state) => state.startPull);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ImageSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [highlighted, setHighlighted] = useState(-1);
  const requestId = useRef(0);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      setOpen(false);
      setHighlighted(-1);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  useEffect(() => {
    const id = ++requestId.current;
    const value = query.trim();
    if (!value || disabled) {
      setResults([]);
      setHighlighted(-1);
      setSearchError(null);
      setOpen(false);
      return;
    }

    if (isGhcrReference(value)) {
      setResults([{
        name: value,
        description: "GitHub Container Registry reference",
        official: false,
        registry: "ghcr",
        reference: withDefaultTag(value),
      }]);
      setHighlighted(-1);
      setSearchError(null);
      setOpen(true);
      return;
    }

    const timer = window.setTimeout(() => {
      void imageSearch(value)
        .then((next) => {
          if (id !== requestId.current) return;
          setResults(next.slice(0, 8).map((result) => ({
            ...result,
            registry: "docker-hub" as const,
            reference: `${result.name}:latest`,
          })));
          setHighlighted(-1);
          setSearchError(null);
          setOpen(true);
        })
        .catch((error) => {
          if (id !== requestId.current) return;
          setResults([]);
          setHighlighted(-1);
          setSearchError(error instanceof Error ? error.message : String(error));
          setOpen(true);
        });
    }, 300);

    return () => window.clearTimeout(timer);
  }, [query, disabled]);

  const pullTyped = () => {
    const value = query.trim();
    if (!value || disabled) return;
    void startPull(value);
    setOpen(false);
  };

  const pullResult = (result: ImageSuggestion) => {
    if (disabled) return;
    void startPull(result.reference);
    setQuery(result.reference);
    setOpen(false);
    setHighlighted(-1);
  };

  const selectResult = (result: ImageSuggestion) => {
    setQuery(result.reference);
    setOpen(false);
    setHighlighted(-1);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!open) setOpen(true);
      setHighlighted((current) => results.length ? Math.min(current + 1, results.length - 1) : -1);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) setOpen(true);
      setHighlighted((current) => results.length ? (current <= 0 ? results.length - 1 : current - 1) : -1);
      return;
    }
    if (event.key === "Escape") {
      setOpen(false);
      setHighlighted(-1);
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const result = highlighted >= 0 ? results[highlighted] : undefined;
      if (result) selectResult(result);
      else pullTyped();
    }
  };

  return (
    <div ref={rootRef} className={cn("relative min-w-0", className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 z-10 size-4 -translate-y-1/2 text-muted-foreground" />
      <input
        type="search"
        value={query}
        disabled={disabled}
        aria-label="Search images"
        placeholder="Search images (Docker Hub or ghcr.io/...)"
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => setQuery(event.target.value)}
        onFocus={() => {
          if (query.trim() && (results.length || searchError)) setOpen(true);
        }}
        onKeyDown={onKeyDown}
        className="h-8 w-full rounded-lg border border-border bg-background/80 pl-9 pr-3 text-sm outline-none transition placeholder:text-subtle focus:border-ring focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-50"
      />

      {open ? (
        <div className="absolute left-0 right-0 top-[calc(100%+0.45rem)] z-50 overflow-hidden rounded-xl border border-border bg-card shadow-xl">
          {searchError ? (
            <div className="px-3 py-3 text-sm text-destructive">
              <p className="font-medium">Docker Hub search failed</p>
              <p className="mt-1 text-xs text-muted-foreground">{searchError}</p>
              <p className="mt-2 text-xs text-muted-foreground">Press Enter to pull the typed reference directly.</p>
            </div>
          ) : results.length ? (
            <ul className="max-h-80 overflow-y-auto py-1" role="listbox" aria-label="Image suggestions">
              {results.map((result, index) => (
                <li key={`${result.registry}:${result.name}`}>
                  <div
                    role="option"
                    aria-selected={index === highlighted}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => setHighlighted(index)}
                    onMouseEnter={() => setHighlighted(index)}
                    className={cn(
                      "flex w-full cursor-default items-start gap-3 px-3 py-2.5 text-left",
                      index === highlighted ? "bg-elevated" : "hover:bg-elevated/70",
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="truncate font-mono text-sm text-foreground">{result.name}</span>
                        <span className="shrink-0 rounded-full border border-border px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                          {result.registry === "ghcr" ? "GHCR" : "Docker Hub"}
                        </span>
                        {result.official ? (
                          <span className="shrink-0 rounded-full bg-accent/15 px-1.5 py-0.5 text-[10px] font-medium text-accent">Official</span>
                        ) : null}
                      </div>
                      {result.description ? <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{result.description}</p> : null}
                      {result.registry === "docker-hub" ? (
                        <p className="mt-1 text-[11px] text-subtle">
                          {[
                            typeof result.pulls === "number" ? `${result.pulls.toLocaleString()} pulls` : null,
                            typeof result.stars === "number" ? `${result.stars.toLocaleString()} stars` : null,
                            result.updatedAt ? `updated ${new Date(result.updatedAt).toLocaleDateString()}` : null,
                          ].filter(Boolean).join(" · ")}
                        </p>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      aria-label={`Download ${result.reference}`}
                      title={`Download ${result.reference}`}
                      disabled={disabled}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={(event) => {
                        event.stopPropagation();
                        pullResult(result);
                      }}
                      className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                    >
                      <Download className="size-4" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <div className="px-3 py-3 text-sm text-muted-foreground">No Docker Hub images found. Press Enter to pull the typed reference.</div>
          )}
        </div>
      ) : null}
    </div>
  );
}
