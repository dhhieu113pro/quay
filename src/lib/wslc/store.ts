import { create } from "zustand";
import { invokeWslcHost } from "@/lib/tauri";
import { cliForRun } from "./csharp";
import { checkHost } from "./probe";
import { loadPrefs, savePrefs } from "./prefs";
import type {
  ApiCall, Container, ContainerGroup, HostGate, ImageRecord, MetricsPoint,
  PullJob, RunSpec, SessionInfo, ViewId, VolumeRecord,
} from "./types";

const CATALOG = [
  "ubuntu:24.04", "alpine:latest", "python:3.12", "node:22", "golang:1.23",
  "nginx:latest", "postgres:16", "redis:7", "httpd:2.4",
];

interface WslcState {
  view: ViewId; gate: HostGate; probeNote: string; wslcOnPath: boolean;
  session: SessionInfo; containers: Container[]; images: ImageRecord[];
  volumes: VolumeRecord[]; calls: ApiCall[]; pulls: PullJob[];
  selectedId: string | null; runOpen: boolean; inspectOpen: boolean;
  metrics: MetricsPoint[]; now: number; catalog: string[];
  groups: ContainerGroup[]; launchAtSignIn: boolean;
  setView: (view: ViewId) => void;
  selectContainer: (id: string | null) => void;
  setRunOpen: (open: boolean) => void;
  setInspectOpen: (open: boolean) => void;
  tick: () => Promise<void>;
  startSession: () => void; stopSession: () => void;
  updateSession: (patch: Partial<SessionInfo>) => void;
  pullImage: (reference: string) => void; removeImage: (id: string) => void;
  runContainer: (spec: RunSpec) => void; startContainer: (id: string) => void;
  stopContainer: (id: string) => void; restartContainer: (id: string) => void;
  deleteContainer: (id: string) => void;
  appendExec: (id: string, command: string, output: string) => void;
  createVolume: (name: string) => void; deleteVolume: (name: string) => void;
  retryProbe: () => Promise<void>;
  setGroupAutoStart: (id: string, autoStart: boolean) => void;
  startGroup: (id: string) => void; stopGroup: (id: string) => void;
  startAutoGroups: () => void; setLaunchAtSignIn: (enabled: boolean) => void;
}

const emptySession = (missing: string[] = []): SessionInfo => ({
  name: "default", dataPath: "", cpuCount: 0, memoryMB: 0, running: false,
  filesystem: "virtiofs", networking: "consomme", gpu: false, gpuName: "",
  version: "wslc —", wslVersion: "—", missingComponents: missing,
});

const value = (row: Record<string, unknown>, ...names: string[]) => {
  for (const [key, val] of Object.entries(row)) {
    if (names.some((name) => key.toLowerCase() === name.toLowerCase())) return val;
  }
  return undefined;
};
const text = (v: unknown) => v == null ? "" : String(v);
const rows = (output?: string, key?: string): Record<string, unknown>[] => {
  if (!output?.trim()) return [];
  try {
    const parsed: unknown = JSON.parse(output);
    if (Array.isArray(parsed)) return parsed as Record<string, unknown>[];
    if (parsed && typeof parsed === "object") {
      const root = parsed as Record<string, unknown>;
      const candidate = key ? value(root, key) : undefined;
      if (Array.isArray(candidate)) return candidate as Record<string, unknown>[];
      return [root];
    }
  } catch {
    const parsedLines = output.split(/\r?\n/).flatMap((line) => {
      try {
        const parsed = JSON.parse(line) as unknown;
        return parsed && typeof parsed === "object" ? [parsed as Record<string, unknown>] : [];
      } catch { return []; }
    });
    if (parsedLines.length) return parsedLines;
  }
  return [];
};

function containersFrom(output?: string): Container[] {
  return rows(output, "containers").map((r) => {
    const rawState = value(r, "status", "state");
    const statusText = text(rawState).toLowerCase();
    const status: Container["status"] = rawState === 2 || statusText.includes("running") || statusText === "up"
      ? "running" : statusText.includes("created") ? "created" : "exited";
    const id = text(value(r, "id", "containerid", "container_id"));
    const rawPorts = value(r, "ports");
    const ports: Container["ports"] = Array.isArray(rawPorts)
      ? rawPorts.flatMap((entry) => {
          if (!entry || typeof entry !== "object") return [];
          const port = entry as Record<string, unknown>;
          const protocol = Number(value(port, "protocol")) === 17 ? "udp" as const : "tcp" as const;
          return [{ host: Number(value(port, "hostport")) || 0,
            container: Number(value(port, "containerport")) || 0, protocol }];
        })
      : [];
    const createdSeconds = Number(value(r, "createdat"));
    const changedSeconds = Number(value(r, "statechangedat"));
    return {
      id, name: text(value(r, "name", "names")) || id.slice(0, 12),
      image: text(value(r, "image")), status,
      createdAt: createdSeconds ? createdSeconds * 1000 : Date.now(),
      startedAt: status === "running" && changedSeconds ? changedSeconds * 1000 : undefined,
      ports, mounts: [], env: {}, gpu: false, cpuPercent: 0, memoryMB: 0,
      memoryLimitMB: 0, command: [], workdir: "/", user: "", logs: [],
    };
  });
}

function imagesFrom(output?: string): ImageRecord[] {
  return rows(output, "images").map((r) => {
    const repository = text(value(r, "repository", "repo"));
    const tag = text(value(r, "tag")) || "latest";
    return {
      id: text(value(r, "id", "imageid", "digest")) || `${repository}:${tag}`,
      repository, tag, digest: text(value(r, "digest")),
      sizeMB: Number(value(r, "sizemb", "size")) || 0,
      createdAt: Date.now(), containers: 0,
    };
  });
}

function volumesFrom(output?: string): VolumeRecord[] {
  return rows(output, "volumes").map((r) => ({
    name: text(value(r, "name")), driver: text(value(r, "driver")) || "wslc",
    mountpoint: text(value(r, "mountpoint")), sizeMB: Number(value(r, "sizemb", "size")) || 0,
    createdAt: Date.now(), inUse: false,
  }));
}

function runArgs(spec: RunSpec) {
  const args = ["run"];
  if (spec.detach) args.push("-d"); if (spec.remove) args.push("--rm");
  if (spec.gpu) args.push("--gpus", "all"); if (spec.name.trim()) args.push("--name", spec.name.trim());
  if (spec.workdir.trim()) args.push("-w", spec.workdir.trim());
  for (const p of spec.ports.split(",").map((x) => x.trim()).filter(Boolean)) args.push("-p", p);
  for (const e of spec.env.split("\n").map((x) => x.trim()).filter(Boolean)) args.push("-e", e);
  for (const m of spec.mounts.split("\n").map((x) => x.trim()).filter(Boolean)) args.push("-v", m);
  args.push(spec.image); if (spec.command.trim()) args.push(...spec.command.trim().split(/\s+/));
  return args;
}

const call = (args: string[]) => invokeWslcHost({ cmd: "run_cli", args });
const apiCall = (args: string[], ok: boolean, result: string): ApiCall => ({
  id: crypto.randomUUID(), at: Date.now(), method: args.join(" "), csharp: `wslc ${args.join(" ")}`,
  cli: `wslc ${args.join(" ")}`, result, ok,
});

async function loadRuntime() {
  const [containers, images, volumes] = await Promise.all([
    call(["container", "list", "--all", "--no-trunc", "--format", "json"]),
    call(["image", "list", "--no-trunc", "--format", "json"]),
    call(["volume", "list", "--format", "json"]),
  ]);
  return {
    containers: containers.ok ? containersFrom(containers.output) : [],
    images: images.ok ? imagesFrom(images.output) : [],
    volumes: volumes.ok ? volumesFrom(volumes.output) : [],
  };
}

const prefs = loadPrefs();
export const useWslc = create<WslcState>((set, get) => {
  const refresh = async () => {
    if (get().gate !== "ready") return;
    try {
      const runtime = await loadRuntime();
      const selectedId = get().selectedId;
      if (selectedId) {
        const selected = runtime.containers.find((container) => container.id === selectedId);
        if (selected) {
          const logs = await call(["container", "logs", "--tail", "100", selected.name]);
          if (logs.ok && logs.output) {
            selected.logs = logs.output.split(/\r?\n/).filter(Boolean).map((line, index) => ({
              ts: Date.now() + index, stream: "stdout" as const, text: line,
            }));
          }
        }
      }
      set({ ...runtime, now: Date.now() });
    } catch { set({ now: Date.now() }); }
  };
  const mutate = async (args: string[]) => {
    const result = await call(args);
    set((s) => ({ calls: [apiCall(args, result.ok, result.output || result.error || "No output"), ...s.calls].slice(0, 80) }));
    await refresh();
    return result;
  };
  return {
    view: "dashboard", gate: "checking", probeNote: "Looking for wslc.exe…", wslcOnPath: false,
    session: emptySession(["wslc"]), containers: [], images: [], volumes: [], calls: [], pulls: [],
    selectedId: null, runOpen: false, inspectOpen: false, metrics: [], now: Date.now(),
    catalog: CATALOG, groups: [], launchAtSignIn: prefs.launchAtSignIn,
    setView: (view) => set({ view }),
    selectContainer: (selectedId) => set({ selectedId, inspectOpen: Boolean(selectedId) }),
    setRunOpen: (runOpen) => set({ runOpen }),
    setInspectOpen: (inspectOpen) => set({ inspectOpen, selectedId: inspectOpen ? get().selectedId : null }),
    tick: refresh,
    startSession: () => { void mutate(["system", "session", "start"]); },
    stopSession: () => { void mutate(["system", "session", "terminate"]); },
    updateSession: (patch) => set((s) => ({ session: { ...s.session, ...patch } })),
    pullImage: (reference) => { const ref = reference.trim(); if (ref) void mutate(["pull", ref]); },
    removeImage: (id) => { const image = get().images.find((x) => x.id === id); if (image) void mutate(["image", "rm", `${image.repository}:${image.tag}`]); },
    runContainer: (spec) => { void mutate(runArgs(spec)).then(() => set({ runOpen: false, view: "containers" })); },
    startContainer: (id) => { const c = get().containers.find((x) => x.id === id); if (c) void mutate(["container", "start", c.name]); },
    stopContainer: (id) => { const c = get().containers.find((x) => x.id === id); if (c) void mutate(["container", "stop", c.name]); },
    restartContainer: (id) => { const c = get().containers.find((x) => x.id === id); if (c) void mutate(["container", "restart", c.name]); },
    deleteContainer: (id) => { const c = get().containers.find((x) => x.id === id); if (c) void mutate(["container", "rm", c.name]); },
    appendExec: (id, command) => { const c = get().containers.find((x) => x.id === id); if (c) void mutate(["exec", c.name, ...command.trim().split(/\s+/)]); },
    createVolume: (name) => { const n = name.trim(); if (n) void mutate(["volume", "create", n]); },
    deleteVolume: (name) => { void mutate(["volume", "rm", name]); },
    retryProbe: async () => {
      set({ gate: "checking", probeNote: "Looking for wslc.exe…", containers: [], images: [], volumes: [], groups: [], metrics: [] });
      const result = await checkHost();
      if (!result.wslc) {
        set({ gate: "missing", probeNote: result.note, wslcOnPath: false, session: emptySession(result.missing) });
        return;
      }
      set({ gate: "ready", probeNote: result.note, wslcOnPath: true,
        session: { ...emptySession(), running: true, version: result.version ?? "wslc", wslVersion: result.version ?? "—" } });
      await refresh();
    },
    setGroupAutoStart: () => {}, startGroup: () => {}, stopGroup: () => {}, startAutoGroups: () => {},
    setLaunchAtSignIn: (launchAtSignIn) => {
      set({ launchAtSignIn }); savePrefs({ launchAtSignIn, groupAuto: {} });
    },
  };
});
