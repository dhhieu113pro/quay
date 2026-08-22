import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from "react";
import { Box, Play, TerminalSquare, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { execInContainer } from "@/lib/wslc/terminal";
import { useWslc } from "@/lib/wslc/store";

type TerminalEntry = {
  id: string;
  container: string;
  command: string;
  output: string;
  ok: boolean;
  exitCode?: number;
};

const QUICK_COMMANDS = ["pwd", "ls -la", "cat /etc/os-release", "ps"];

export function TerminalView() {
  const containers = useWslc((s) => s.containers);
  const [containerId, setContainerId] = useState("");
  const [command, setCommand] = useState("");
  const [entries, setEntries] = useState<TerminalEntry[]>([]);
  const [history, setHistory] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const [busy, setBusy] = useState(false);
  const outputRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const running = useMemo(
    () => containers.filter((container) => container.status === "running"),
    [containers],
  );
  const selected = running.find((container) => container.id === containerId) ?? running[0];

  useEffect(() => {
    if (!selected) {
      if (containerId) setContainerId("");
      return;
    }
    if (selected.id !== containerId) setContainerId(selected.id);
  }, [containerId, selected]);

  useEffect(() => {
    const el = outputRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [entries, busy]);

  async function submit(raw = command) {
    const line = raw.trim();
    if (!line || !selected || busy) return;

    if (line === "clear") {
      setEntries([]);
      setCommand("");
      setHistoryIndex(-1);
      inputRef.current?.focus();
      return;
    }

    setBusy(true);
    setCommand("");
    setHistory((current) => [line, ...current.filter((item) => item !== line)].slice(0, 50));
    setHistoryIndex(-1);

    try {
      const result = await execInContainer(selected, line);
      setEntries((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          container: selected.name,
          command: line,
          output: result.output,
          ok: result.ok,
          exitCode: result.exitCode,
        },
      ]);
    } catch (error) {
      setEntries((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          container: selected.name,
          command: line,
          output: error instanceof Error ? error.message : String(error),
          ok: false,
        },
      ]);
    } finally {
      setBusy(false);
      window.setTimeout(() => inputRef.current?.focus(), 0);
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void submit();
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowUp") {
      event.preventDefault();
      if (!history.length) return;
      const next = Math.min(historyIndex + 1, history.length - 1);
      setHistoryIndex(next);
      setCommand(history[next] ?? "");
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      const next = historyIndex - 1;
      if (next < 0) {
        setHistoryIndex(-1);
        setCommand("");
      } else {
        setHistoryIndex(next);
        setCommand(history[next] ?? "");
      }
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-border bg-card px-4 py-3 sm:px-6">
        <div className="flex items-center gap-2">
          <TerminalSquare className="size-4 text-muted-foreground" />
          <div>
            <h1 className="text-sm font-medium">Terminal</h1>
            <p className="text-xs text-subtle">Real commands through wslc exec</p>
          </div>
        </div>

        <label className="ml-auto flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
          <Box className="size-3.5 shrink-0" />
          <select
            value={selected?.id ?? ""}
            onChange={(event) => {
              setContainerId(event.target.value);
              setEntries([]);
              setHistoryIndex(-1);
            }}
            disabled={!running.length || busy}
            className="h-8 min-w-40 rounded-md border border-border bg-background px-2 font-mono text-xs text-foreground outline-none focus:border-ring disabled:opacity-50"
            aria-label="Running container"
          >
            {!running.length ? <option value="">No running containers</option> : null}
            {running.map((container) => (
              <option key={container.id} value={container.id}>
                {container.name}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          onClick={() => setEntries([])}
          disabled={!entries.length || busy}
          className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs text-muted-foreground hover:bg-elevated hover:text-foreground disabled:opacity-40"
        >
          <Trash2 className="size-3.5" />
          Clear
        </button>
      </div>

      {!selected ? (
        <div className="grid flex-1 place-items-center p-8 text-center">
          <div className="max-w-sm">
            <TerminalSquare className="mx-auto size-8 text-subtle" />
            <h2 className="mt-3 text-sm font-medium">No running container</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Start a container or a Cube, then come back here to run commands inside it.
            </p>
          </div>
        </div>
      ) : (
        <>
          <div
            ref={outputRef}
            className="min-h-0 flex-1 overflow-y-auto bg-background px-4 py-4 font-mono text-xs leading-5 sm:px-6"
            onClick={() => inputRef.current?.focus()}
          >
            <div className="mb-4 text-subtle">
              Quay terminal · {selected.name} · {selected.image}
              <br />
              Commands run as: wslc exec {selected.name} sh -lc &lt;command&gt;
            </div>

            {entries.map((entry) => (
              <div key={entry.id} className="mb-4">
                <div className="flex gap-2 text-foreground">
                  <span className="select-none text-ok">{entry.container}:/#</span>
                  <span className="break-all">{entry.command}</span>
                </div>
                {entry.output ? (
                  <pre
                    className={cn(
                      "mt-1 whitespace-pre-wrap break-words font-mono text-xs leading-5",
                      entry.ok ? "text-muted-foreground" : "text-destructive",
                    )}
                  >
                    {entry.output}
                  </pre>
                ) : null}
                {!entry.ok && entry.exitCode != null ? (
                  <p className="mt-1 text-[11px] text-subtle">exit {entry.exitCode}</p>
                ) : null}
              </div>
            ))}

            {busy ? (
              <div className="flex items-center gap-2 text-muted-foreground">
                <span className="select-none text-ok">{selected.name}:/#</span>
                <span className="animate-pulse">running…</span>
              </div>
            ) : null}
          </div>

          <div className="border-t border-border bg-card px-4 py-3 sm:px-6">
            <div className="mb-2 flex flex-wrap gap-1.5">
              {QUICK_COMMANDS.map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => {
                    setCommand(item);
                    inputRef.current?.focus();
                  }}
                  disabled={busy}
                  className="rounded border border-border bg-background px-2 py-1 font-mono text-[11px] text-muted-foreground hover:bg-elevated hover:text-foreground disabled:opacity-50"
                >
                  {item}
                </button>
              ))}
            </div>
            <form onSubmit={onSubmit} className="flex items-center gap-2">
              <span className="shrink-0 font-mono text-xs text-ok">{selected.name}:/#</span>
              <input
                ref={inputRef}
                value={command}
                onChange={(event) => setCommand(event.target.value)}
                onKeyDown={onKeyDown}
                disabled={busy}
                autoComplete="off"
                spellCheck={false}
                placeholder="Type a shell command…"
                className="h-9 min-w-0 flex-1 rounded-md border border-border bg-background px-3 font-mono text-xs text-foreground outline-none placeholder:text-subtle focus:border-ring disabled:opacity-60"
              />
              <button
                type="submit"
                disabled={busy || !command.trim()}
                className="inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
              >
                <Play className="size-3.5" />
                Run
              </button>
            </form>
          </div>
        </>
      )}
    </div>
  );
}
