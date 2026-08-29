import { create } from "zustand";
import {
  appendContainerLogs,
  clearContainerLogs,
  invokeWslcHost,
  listContainerLogTargets,
  queryContainerLogs,
} from "@/lib/tauri";
import { useWslc } from "./store";
import { mergeAggregatedLogs, parseContainerLogs } from "./logs";
import type { AggregatedLogLine, Container, ContainerLogTarget, ContainerLogWrite } from "./types";

type OpenLogsInput = { cubeId?: string; containerName?: string };

type LogRead = {
  ok: boolean;
  output?: string;
  timestamped: boolean;
};

interface LogState {
  aggregatedLogs: AggregatedLogLine[];
  logTargets: ContainerLogTarget[];
  logCubeFilter: string | null;
  logContainerFilter: string | null;
  openLogs: (input?: OpenLogsInput) => void;
  setLogCubeFilter: (cubeId: string | null) => void;
  setLogContainerFilter: (containerName: string | null) => void;
  refreshAggregatedLogs: () => Promise<void>;
  clearLogs: () => void;
}

let logsRefreshInFlight: Promise<void> | null = null;
let clearGeneration = 0;
let clearedAt = 0;
const fallbackTails = new Map<string, string[]>();
const fallbackNeedsBaseline = new Set<string>();
const fallbackSessionId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const fallbackSequences = new Map<string, number>();

function splitLogLines(output?: string) {
  return (output ?? "").split(/\r?\n/).filter(Boolean);
}

function newFallbackTail(previous: string[], current: string[]) {
  const maxOverlap = Math.min(previous.length, current.length);
  for (let overlap = maxOverlap; overlap > 0; overlap -= 1) {
    const previousStart = previous.length - overlap;
    let same = true;
    for (let index = 0; index < overlap; index += 1) {
      if (previous[previousStart + index] !== current[index]) { same = false; break; }
    }
    if (same) return current.slice(overlap);
  }
  return current;
}

async function readContainerLogs(name: string): Promise<LogRead> {
  const withTimestamps = await invokeWslcHost({ cmd: "run_cli", args: ["container", "logs", "--timestamps", "--tail", "500", name] });
  if (withTimestamps.ok) return { ok: true, output: withTimestamps.output, timestamped: true };
  const fallback = await invokeWslcHost({ cmd: "run_cli", args: ["container", "logs", "--tail", "500", name] });
  return { ok: fallback.ok, output: fallback.output, timestamped: false };
}

function toPersistedLine(record: Awaited<ReturnType<typeof queryContainerLogs>>[number]): AggregatedLogLine {
  return {
    id: `sqlite:${record.id}`,
    ts: record.sourceTs ?? record.capturedTs,
    stream: record.stream,
    text: record.text,
    containerId: record.containerId ?? `history:${record.containerName}`,
    containerName: record.containerName,
    cubeId: record.cubeId,
    cubeName: record.cubeName,
  };
}

function persistenceRows(
  container: Pick<Container, "id" | "name" | "groupId">,
  cube: { id: string; name: string } | undefined,
  lines: AggregatedLogLine[],
  timestamped: boolean,
): ContainerLogWrite[] {
  let sequence = fallbackSequences.get(container.id) ?? 0;
  const capturedAt = Date.now();
  const rows = lines.map((line, index) => {
    const dedupeKey = timestamped
      ? line.id
      : `${container.id}|fallback|${fallbackSessionId}|${sequence++}`;
    return {
      containerId: container.id,
      containerName: container.name,
      cubeId: cube?.id,
      cubeName: cube?.name,
      sourceTs: timestamped ? line.ts : undefined,
      capturedTs: capturedAt + index,
      stream: line.stream,
      text: line.text,
      dedupeKey,
    } satisfies ContainerLogWrite;
  });
  if (!timestamped) fallbackSequences.set(container.id, sequence);
  return rows;
}

export async function captureContainerLogs(container: Pick<Container, "id" | "name" | "groupId">): Promise<AggregatedLogLine[]> {
  const generation = clearGeneration;
  const clearWatermark = clearedAt;
  const result = await readContainerLogs(container.name);
  if (!result.ok || generation !== clearGeneration) return [];

  const runtime = useWslc.getState();
  const cube = container.groupId ? runtime.groups.find((group) => group.id === container.groupId) : undefined;
  let lines: AggregatedLogLine[];

  if (result.timestamped) {
    lines = parseContainerLogs({
      output: result.output,
      containerId: container.id,
      containerName: container.name,
      cubeId: cube?.id,
      cubeName: cube?.name,
    }).filter((line) => line.ts > clearWatermark);
  } else {
    const currentTail = splitLogLines(result.output);
    const previousTail = fallbackTails.get(container.id) ?? [];
    fallbackTails.set(container.id, currentTail);
    if (fallbackNeedsBaseline.delete(container.id)) return [];
    const delta = newFallbackTail(previousTail, currentTail);
    if (!previousTail.length && clearWatermark > 0) return [];
    lines = parseContainerLogs({
      output: delta.join("\n"),
      containerId: container.id,
      containerName: container.name,
      cubeId: cube?.id,
      cubeName: cube?.name,
    });
  }

  if (!lines.length || generation !== clearGeneration) return lines;
  try {
    await appendContainerLogs(persistenceRows(container, cube, lines, result.timestamped));
  } catch {
    // Persistence is diagnostic infrastructure and must never break container operations.
  }
  return lines;
}

export async function drainContainerLogs(containerName: string): Promise<void> {
  const runtime = useWslc.getState();
  const existing = runtime.containers.find((item) => item.name === containerName);
  const group = existing?.groupId
    ? runtime.groups.find((item) => item.id === existing.groupId)
    : runtime.groups.find((item) => item.specs.some((spec) => spec.name === containerName));
  const container = existing ?? {
    id: `history:${containerName}`,
    name: containerName,
    groupId: group?.id,
  };
  try { await captureContainerLogs(container); }
  catch { /* best-effort lifecycle drain */ }
}

export const useLogs = create<LogState>((set, get) => ({
  aggregatedLogs: [],
  logTargets: [],
  logCubeFilter: null,
  logContainerFilter: null,
  openLogs: (input) => {
    set({
      logCubeFilter: input?.cubeId ?? null,
      logContainerFilter: input?.containerName ?? null,
    });
    useWslc.getState().setView("logs");
  },
  setLogCubeFilter: (cubeId) => set({ logCubeFilter: cubeId, logContainerFilter: null }),
  setLogContainerFilter: (logContainerFilter) => set({ logContainerFilter }),
  refreshAggregatedLogs: () => {
    if (logsRefreshInFlight) return logsRefreshInFlight;
    const generation = clearGeneration;
    logsRefreshInFlight = (async () => {
      try {
        const runtime = useWslc.getState();
        const running = runtime.containers.filter((container) => container.status === "running");
        const settled = await Promise.allSettled(running.map((container) => captureContainerLogs(container)));
        if (generation !== clearGeneration) return;
        const incoming = settled.flatMap((result) => result.status === "fulfilled" ? result.value : []);

        try {
          const [persisted, targets] = await Promise.all([
            queryContainerLogs({ limit: 500 }),
            listContainerLogTargets(),
          ]);
          if (generation !== clearGeneration) return;
          const visiblePersisted = persisted.filter((record) => record.capturedTs > clearedAt);
          set({
            aggregatedLogs: mergeAggregatedLogs(visiblePersisted.map(toPersistedLine), incoming),
            logTargets: targets,
          });
        } catch {
          if (incoming.length) set({ aggregatedLogs: mergeAggregatedLogs(get().aggregatedLogs, incoming) });
        }
      } finally {
        logsRefreshInFlight = null;
      }
    })();
    return logsRefreshInFlight;
  },
  clearLogs: () => {
    clearGeneration += 1;
    clearedAt = Date.now();
    fallbackTails.clear();
    fallbackSequences.clear();
    for (const container of useWslc.getState().containers) {
      if (container.status === "running") fallbackNeedsBaseline.add(container.id);
    }
    set({ aggregatedLogs: [], logTargets: [] });
    void clearContainerLogs().catch(() => undefined);
  },
}));

export function openLogs(input?: OpenLogsInput) {
  useLogs.getState().openLogs(input);
}
