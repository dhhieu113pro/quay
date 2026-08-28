import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { imageSearch } from "@/lib/tauri";
import { useWslc } from "@/lib/wslc/store";
import type { ImageSearchResult } from "@/lib/wslc/types";

export function ImageSearch({ disabled = false, className }: { disabled?: boolean; className?: string }) {
  const startPull = useWslc((state) => state.startPull);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ImageSearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [highlighted, setHighlighted] = useState(-1);
  const requestId = useRef(0);

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

    const timer = window.setTimeout(() => {
      void imageSearch(value)
        .then((next) => {
          if (id !== requestId.current) return;
          setResults(next.slice(0, 8));
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

  const pullResult = (result: ImageSearchResult) => {
    if (disabled) return;
    void startPull(`${result.name}:latest`);
    setQuery(`${result.name}:latest`);
    setOpen(false);
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
      if (result) pullResult(result);
      else pullTyped();
    }
  };

  return (
    <div className={cn("relative min-w-0", className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 z-10 size-4 -translate-y-1/2 text-muted-foreground" />
      <input
        type="search"
        value={query}
        disabled={disabled}
        aria-label="Search Docker Hub images"
        placeholder="Search Docker Hub images"
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
            <ul className="max-h-80 overflow-y-auto py-1">
              {results.map((result, index) => (
                <li key={result.name}>
                  <button
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => pullResult(result)}
                    onMouseEnter={() => setHighlighted(index)}
                    className={cn(
                      "flex w-full items-start gap-3 px-3 py-2.5 text-left",
                      index === highlighted ? "bg-elevated" : "hover:bg-elevated/70",
                    )}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="truncate font-mono text-sm text-foreground">{result.name}</span>
                        {result.official ? (
                          <span className="shrink-0 rounded-full bg-accent/15 px-1.5 py-0.5 text-[10px] font-medium text-accent">Official</span>
                        ) : null}
                      </div>
                      {result.description ? <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{result.description}</p> : null}
                      <p className="mt-1 text-[11px] text-subtle">
                        {[
                          typeof result.pulls === "number" ? `${result.pulls.toLocaleString()} pulls` : null,
                          typeof result.stars === "number" ? `${result.stars.toLocaleString()} stars` : null,
                          result.updatedAt ? `updated ${new Date(result.updatedAt).toLocaleDateString()}` : null,
                        ].filter(Boolean).join(" · ")}
                      </p>
                    </div>
                  </button>
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
