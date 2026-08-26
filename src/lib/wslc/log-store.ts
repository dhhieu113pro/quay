import { create } from "zustand";
import { invokeWslcHost } from "@/lib/tauri";
import { useWslc } from "./store";
import { mergeAggregatedLogs, parseContainerLogs } from "./logs";
import type { AggregatedLogLine } from "./types";

type OpenLogsInput = { cubeId?: string; containerName?: string };

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

async function readContainerLogs(name: string) {
  const withTimestamps = await invokeWslcHost({ cmd: "run_cli", args: ["container", "logs", "--timestamps", "--tail", "500", name] });
  if (withTimestamps.ok) return withTimestamps;
  return invokeWslcHost({ cmd: "run_cli", args: ["container", "logs", "--tail", "500", name] });
}

export const useLogs = create<LogState>((set, get) => ({
  aggregatedLogs: [],
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
    logsRefreshInFlight = (async () => {
      try {
        const runtime = useWslc.getState();
        const running = runtime.containers.filter((container) => container.status === "running");
        const settled = await Promise.allSettled(running.map(async (container) => {
          const result = await readContainerLogs(container.name);
          if (!result.ok) return [];
          const cube = container.groupId ? runtime.groups.find((group) => group.id === container.groupId) : undefined;
          return parseContainerLogs({
            output: result.output,
            containerId: container.id,
            containerName: container.name,
            cubeId: cube?.id,
            cubeName: cube?.name,
          });
        }));
        const incoming = settled.flatMap((result) => result.status === "fulfilled" ? result.value : []);
        if (incoming.length) set({ aggregatedLogs: mergeAggregatedLogs(get().aggregatedLogs, incoming) });
      } finally {
        logsRefreshInFlight = null;
      }
    })();
    return logsRefreshInFlight;
  },
  clearLogs: () => set({ aggregatedLogs: [] }),
}));

export function openLogs(input?: OpenLogsInput) {
  useLogs.getState().openLogs(input);
}
