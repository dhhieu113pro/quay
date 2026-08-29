import { create } from "zustand";
import { invokeWslcHost } from "@/lib/tauri";
import { useWslc } from "./store";
import { clearOperationLogs, loadOperationLogs } from "./operation-log";
import { mergeAggregatedLogs, parseContainerLogs } from "./logs";
import type { AggregatedLogLine } from "./types";

type OpenLogsInput = { cubeId?: string; containerName?: string };

type LogRead = {
  ok: boolean;
  output?: string;
  timestamped: boolean;
};

interface LogState {
  aggregatedLogs: AggregatedLogLine[];
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

function operationDiagnosticLines(): AggregatedLogLine[] {
  const runtime = useWslc.getState();
  return loadOperationLogs().map((entry) => {
    const container = entry.containerName
      ? runtime.containers.find((item) => item.name === entry.containerName)
      : undefined;
    const cube = container?.groupId
      ? runtime.groups.find((group) => group.id === container.groupId)
      : entry.containerName
        ? runtime.groups.find((group) => group.specs.some((spec) => spec.name === entry.containerName))
        : undefined;
    const containerName = entry.containerName || "Quay";
    return {
      id: `operation:${entry.id}`,
      ts: entry.ts,
      stream: "stderr" as const,
      text: `${entry.command}\n${entry.text}`,
      containerId: container?.id || `operation:${containerName}`,
      containerName,
      cubeId: cube?.id,
      cubeName: cube?.name,
    };
  });
}

export const useLogs = create<LogState>((set, get) => ({
  aggregatedLogs: operationDiagnosticLines(),
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
    const clearWatermark = clearedAt;
    logsRefreshInFlight = (async () => {
      try {
        const runtime = useWslc.getState();
        const running = runtime.containers.filter((container) => container.status === "running");
        const settled = await Promise.allSettled(running.map(async (container) => {
          const result = await readContainerLogs(container.name);
          if (!result.ok || generation !== clearGeneration) return [];
          const cube = container.groupId ? runtime.groups.find((group) => group.id === container.groupId) : undefined;
          if (result.timestamped) {
            return parseContainerLogs({
              output: result.output,
              containerId: container.id,
              containerName: container.name,
              cubeId: cube?.id,
              cubeName: cube?.name,
            }).filter((line) => line.ts > clearWatermark);
          }

          const currentTail = splitLogLines(result.output);
          const previousTail = fallbackTails.get(container.id) ?? [];
          fallbackTails.set(container.id, currentTail);
          if (fallbackNeedsBaseline.delete(container.id)) return [];
          const delta = newFallbackTail(previousTail, currentTail);
          if (!previousTail.length && clearWatermark > 0) return [];
          return parseContainerLogs({
            output: delta.join("\n"),
            containerId: container.id,
            containerName: container.name,
            cubeId: cube?.id,
            cubeName: cube?.name,
          });
        }));
        if (generation !== clearGeneration) return;
        const incoming = [
          ...operationDiagnosticLines().filter((line) => line.ts > clearWatermark),
          ...settled.flatMap((result) => result.status === "fulfilled" ? result.value : []),
        ];
        if (incoming.length) set({ aggregatedLogs: mergeAggregatedLogs(get().aggregatedLogs, incoming) });
      } finally {
        logsRefreshInFlight = null;
      }
    })();
    return logsRefreshInFlight;
  },
  clearLogs: () => {
    clearGeneration += 1;
    clearedAt = Date.now();
    clearOperationLogs();
    for (const container of useWslc.getState().containers) {
      if (container.status === "running" && !fallbackTails.has(container.id)) fallbackNeedsBaseline.add(container.id);
    }
    set({ aggregatedLogs: [] });
  },
}));

export function openLogs(input?: OpenLogsInput) {
  useLogs.getState().openLogs(input);
}
