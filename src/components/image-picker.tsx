import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Check, Download, LoaderCircle, Search } from "lucide-react";
import { PullProgress } from "@/components/pull-progress";
import { imageSearch } from "@/lib/tauri";
import { cn } from "@/lib/utils";
import { useWslc } from "@/lib/wslc/store";
import type { ImageSearchResult } from "@/lib/wslc/types";

export type SuggestedImage = {
  reference: string;
  label?: string;
  description?: string;
};

type PickerSuggestion = {
  name: string;
  reference: string;
  description?: string;
  source: "local" | "docker-hub" | "ghcr";
  official?: boolean;
  stars?: number;
  pulls?: number;
  updatedAt?: string;
};

const ACTIVE_PULL_STATUSES = ["queued", "pulling", "cancelling"] as const;

function isGhcrReference(value: string) {
  return value.toLowerCase().startsWith("ghcr.io/");
}

function withDefaultTag(reference: string) {
  if (reference.includes("@")) return reference;
  const lastSegment = reference.split("/").at(-1) ?? reference;
  return lastSegment.includes(":") ? reference : `${reference}:latest`;
}

function dockerReference(result: ImageSearchResult) {
  return `${result.name}:latest`;
}

function sourceForReference(reference: string): PickerSuggestion["source"] {
  return isGhcrReference(reference) ? "ghcr" : "docker-hub";
}

export function ImagePicker({
  value,
  localImages,
  suggestedImages = [],
  onSelect,
  onBusyChange,
  onReadyChange,
  disabled = false,
  inputId,
  placeholder = "Search local images, Docker Hub, or ghcr.io/...",
  required = false,
  className,
}: {
  value: string;
  localImages: string[];
  suggestedImages?: SuggestedImage[];
  onSelect: (reference: string) => void;
  onBusyChange?: (busy: boolean) => void;
  onReadyChange?: (ready: boolean) => void;
  disabled?: boolean;
  inputId?: string;
  placeholder?: string;
  required?: boolean;
  className?: string;
}) {
  const startPull = useWslc((state) => state.startPull);
  const pulls = useWslc((state) => state.pulls);
  const [query, setQuery] = useState(value);
  const [remoteResults, setRemoteResults] = useState<PickerSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(-1);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [pendingPullId, setPendingPullId] = useState<string | null>(null);
  const [startingPull, setStartingPull] = useState(false);
  const requestId = useRef(0);
  const rootRef = useRef<HTMLDivElement>(null);

  const pendingJob = pendingPullId ? pulls.find((job) => job.id === pendingPullId) : undefined;
  const pullActive = Boolean(pendingJob && ACTIVE_PULL_STATUSES.includes(pendingJob.status as (typeof ACTIVE_PULL_STATUSES)[number]));
  const imageDownloading = startingPull || pullActive;
  const imageReady = Boolean(value.trim()) && query.trim() === value.trim() && !imageDownloading;

  useEffect(() => {
    setQuery(value);
  }, [value]);

  useEffect(() => {
    onBusyChange?.(imageDownloading);
  }, [imageDownloading, onBusyChange]);

  useEffect(() => {
    onReadyChange?.(imageReady);
  }, [imageReady, onReadyChange]);

  useEffect(() => () => {
    onBusyChange?.(false);
    onReadyChange?.(false);
  }, [onBusyChange, onReadyChange]);

  useEffect(() => {
    if (!pendingJob || pendingJob.status !== "completed") return;
    const reference = pendingJob.reference;
    setPendingPullId(null);
    setQuery(reference);
    setOpen(false);
    setHighlighted(-1);
    onSelect(reference);
  }, [pendingJob, onSelect]);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      setOpen(false);
      setHighlighted(-1);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  const normalizedLocalImages = useMemo(
    () => Array.from(new Set(localImages.map((image) => image.trim()).filter(Boolean))).sort(),
    [localImages],
  );

  const localResults = useMemo((): PickerSuggestion[] => {
    const needle = query.trim().toLowerCase();
    return normalizedLocalImages
      .filter((image) => !needle || image.toLowerCase().includes(needle))
      .slice(0, 8)
      .map((image) => ({ name: image, reference: image, source: "local", description: "Available locally" }));
  }, [normalizedLocalImages, query]);

  const suggestedResults = useMemo((): PickerSuggestion[] => {
    const needle = query.trim().toLowerCase();
    const localSet = new Set(normalizedLocalImages);
    const seen = new Set<string>();
    return suggestedImages.flatMap((suggestion) => {
      const rawReference = suggestion.reference.trim();
      if (!rawReference) return [];
      const reference = withDefaultTag(rawReference);
      if (localSet.has(reference) || seen.has(reference)) return [];
      const searchable = `${suggestion.label ?? ""} ${reference} ${suggestion.description ?? ""}`.toLowerCase();
      if (needle && !searchable.includes(needle)) return [];
      seen.add(reference);
      return [{
        name: suggestion.label?.trim() || reference,
        reference,
        description: suggestion.description ? `${reference} · ${suggestion.description}` : reference,
        source: sourceForReference(reference),
      }];
    });
  }, [normalizedLocalImages, query, suggestedImages]);

  useEffect(() => {
    const id = ++requestId.current;
    const searchValue = query.trim();
    if (!searchValue || disabled) {
      setRemoteResults([]);
      setSearchError(null);
      return;
    }

    if (normalizedLocalImages.includes(searchValue)) {
      setRemoteResults([]);
      setSearchError(null);
      return;
    }

    if (isGhcrReference(searchValue)) {
      const reference = withDefaultTag(searchValue);
      setRemoteResults(normalizedLocalImages.includes(reference) ? [] : [{
        name: searchValue,
        reference,
        description: "GitHub Container Registry reference",
        source: "ghcr",
      }]);
      setSearchError(null);
      setOpen(true);
      return;
    }

    const timer = window.setTimeout(() => {
      void imageSearch(searchValue)
        .then((results) => {
          if (requestId.current !== id) return;
          const localSet = new Set(normalizedLocalImages);
          setRemoteResults(results
            .map((result): PickerSuggestion => ({
              ...result,
              name: result.name,
              reference: dockerReference(result),
              source: "docker-hub",
            }))
            .filter((result) => !localSet.has(result.reference))
            .slice(0, 8));
          setSearchError(null);
          setOpen(true);
        })
        .catch((error) => {
          if (requestId.current !== id) return;
          setRemoteResults([]);
          setSearchError(error instanceof Error ? error.message : String(error));
          setOpen(true);
        });
    }, 300);

    return () => window.clearTimeout(timer);
  }, [query, disabled, normalizedLocalImages]);

  const suggestions = useMemo(() => {
    const seen = new Set<string>();
    return [...localResults, ...suggestedResults, ...remoteResults].filter((result) => {
      if (seen.has(result.reference)) return false;
      seen.add(result.reference);
      return true;
    });
  }, [localResults, suggestedResults, remoteResults]);

  const selectLocal = (result: PickerSuggestion) => {
    if (disabled || imageDownloading) return;
    setQuery(result.reference);
    setOpen(false);
    setHighlighted(-1);
    onSelect(result.reference);
  };

  const download = async (result: PickerSuggestion) => {
    if (disabled || imageDownloading || result.source === "local") return;
    setStartingPull(true);
    try {
      const job = await startPull(result.reference);
      if (job) {
        setPendingPullId(job.id);
        setOpen(false);
        setHighlighted(-1);
      }
    } finally {
      setStartingPull(false);
    }
  };

  const activate = (result: PickerSuggestion) => {
    if (result.source === "local") selectLocal(result);
    else void download(result);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setHighlighted((current) => suggestions.length ? Math.min(current + 1, suggestions.length - 1) : -1);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      setHighlighted((current) => suggestions.length ? (current <= 0 ? suggestions.length - 1 : current - 1) : -1);
      return;
    }
    if (event.key === "Escape") {
      setOpen(false);
      setHighlighted(-1);
      return;
    }
    if (event.key === "Enter") {
      const result = highlighted >= 0 ? suggestions[highlighted] : undefined;
      if (!result) return;
      event.preventDefault();
      activate(result);
    }
  };

  const failed = pendingJob && ["failed", "cancelled", "interrupted"].includes(pendingJob.status);

  return (
    <div ref={rootRef} className={cn("relative min-w-0", className)}>
      <Search className="pointer-events-none absolute left-3 top-4 z-10 size-4 -translate-y-1/2 text-muted-foreground" />
      <input
        id={inputId}
        type="search"
        value={query}
        required={required}
        disabled={disabled}
        aria-label="Search images"
        placeholder={placeholder}
        autoComplete="off"
        spellCheck={false}
        onChange={(event) => {
          setQuery(event.target.value);
          setHighlighted(-1);
          if (event.target.value.trim()) setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        className="h-8 w-full rounded-lg border border-border bg-background/80 pl-9 pr-3 font-mono text-xs outline-none transition placeholder:font-sans placeholder:text-subtle focus:border-ring focus:ring-2 focus:ring-ring/20 disabled:cursor-not-allowed disabled:opacity-50"
      />

      {imageDownloading && pendingJob ? (
        <div className="mt-2 rounded-lg border border-border bg-elevated/30 p-3">
          <div className="mb-2 flex items-center gap-2 text-xs font-medium text-foreground">
            <LoaderCircle className="size-3.5 animate-spin" /> Downloading {pendingJob.reference}
          </div>
          <PullProgress job={pendingJob} />
        </div>
      ) : startingPull ? (
        <div className="mt-2 flex items-center gap-2 rounded-lg border border-border bg-elevated/30 px-3 py-2 text-xs text-muted-foreground">
          <LoaderCircle className="size-3.5 animate-spin" /> Starting download…
        </div>
      ) : failed && pendingJob ? (
        <div className="mt-2 flex items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2">
          <div className="min-w-0"><p className="truncate text-xs font-medium text-destructive">Download {pendingJob.status}</p><p className="truncate text-[11px] text-muted-foreground">{pendingJob.error || pendingJob.message || pendingJob.reference}</p></div>
          <button type="button" className="shrink-0 text-xs font-medium text-foreground hover:underline" onClick={() => void download({ name: pendingJob.reference, reference: pendingJob.reference, source: sourceForReference(pendingJob.reference) })}>Retry</button>
        </div>
      ) : null}

      {open && !imageDownloading ? (
        <div className="absolute left-0 right-0 top-[calc(2rem+0.45rem)] z-50 overflow-hidden rounded-xl border border-border bg-card shadow-xl">
          {searchError ? (
            <div className="px-3 py-3 text-sm text-destructive"><p className="font-medium">Docker Hub search failed</p><p className="mt-1 text-xs text-muted-foreground">{searchError}</p></div>
          ) : suggestions.length ? (
            <ul className="max-h-72 overflow-y-auto py-1" role="listbox" aria-label="Image suggestions">
              {suggestions.map((result, index) => (
                <li key={`${result.source}:${result.reference}`}>
                  <div
                    role="option"
                    aria-selected={index === highlighted}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => result.source === "local" ? selectLocal(result) : setHighlighted(index)}
                    onMouseEnter={() => setHighlighted(index)}
                    className={cn("flex cursor-default items-start gap-3 px-3 py-2.5 text-left", index === highlighted ? "bg-elevated" : "hover:bg-elevated/70")}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="truncate font-mono text-sm text-foreground">{result.name}</span>
                        <span className="shrink-0 rounded-full border border-border px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                          {result.source === "local" ? "Local" : result.source === "ghcr" ? "GHCR" : "Docker Hub"}
                        </span>
                        {result.official ? <span className="shrink-0 rounded-full bg-accent/15 px-1.5 py-0.5 text-[10px] font-medium text-accent">Official</span> : null}
                      </div>
                      {result.description ? <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{result.description}</p> : null}
                      {result.source === "docker-hub" ? <p className="mt-1 text-[11px] text-subtle">{[
                        typeof result.pulls === "number" ? `${result.pulls.toLocaleString()} pulls` : null,
                        typeof result.stars === "number" ? `${result.stars.toLocaleString()} stars` : null,
                        result.updatedAt ? `updated ${new Date(result.updatedAt).toLocaleDateString()}` : null,
                      ].filter(Boolean).join(" · ")}</p> : null}
                    </div>
                    {result.source === "local" ? (
                      <span className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center text-muted-foreground" title="Available locally"><Check className="size-4" /></span>
                    ) : (
                      <button
                        type="button"
                        aria-label={`Download ${result.reference}`}
                        title={`Download ${result.reference}`}
                        disabled={disabled || imageDownloading}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={(event) => { event.stopPropagation(); void download(result); }}
                        className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                      ><Download className="size-4" /></button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          ) : query.trim() ? (
            <div className="px-3 py-3 text-sm text-muted-foreground">No matching local or Docker Hub images.</div>
          ) : (
            <div className="px-3 py-3 text-sm text-muted-foreground">Type to search images.</div>
          )}
        </div>
      ) : null}
    </div>
  );
}
