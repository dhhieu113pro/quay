import { create } from "zustand";
import {
  ensureHostDirectory,
  getLaunchAtSignIn,
  invokeWslcHost,
  setLaunchAtSignIn as setNativeLaunchAtSignIn,
} from "@/lib/tauri";
import { checkHost } from "./probe";
import { loadPrefs, savePrefs } from "./prefs";
import {
  assignContainer,
  deleteGroupDefinition,
  effectiveSpec,
  groupForContainer,
  loadGroups,
  saveGroup as persistGroup,
} from "./groups";
import type {
  ApiCall, Container, ContainerGroup, HostGate, ImageRecord, MetricsPoint,
  PullJob, RunSpec, SessionInfo, ViewId, VolumeRecord,
} from "./types";

const CATALOG = [
  "ubuntu:24.04", "alpine:latest", "python:3.12", "node:22", "golang:1.23",
  "nginx:latest", "postgres:16", "redis:7", "httpd:2.4",
];
const LOCAL_CODING_WORKSPACE = "D:\\wslc\\workspaces";

interface WslcState {
  view: ViewId; gate: HostGate; probeNote: string; wslcOnPath: boolean;
  session: SessionInfo; containers: Container[]; images: ImageRecord[];
  volumes: VolumeRecord[]; calls: ApiCall[]; pulls: PullJob[];
  selectedId: string | null; runOpen: boolean; inspectOpen: boolean;
  metrics: MetricsPoint[]; now: number; catalog: string[];
  groups: ContainerGroup[]; launchAtSignIn: boolean;
  operations: Record<string, boolean>; lastError: string | null;
  setView: (view: ViewId) => void;
  selectContainer: (id: string | null) => void;
  setRunOpen: (open: boolean) => void;
  setInspectOpen: (open: boolean) => void;
  clearError: () => void;
  tick: () => Promise<void>;
  refreshInventory: () => Promise<void>;
  refreshLogs: (id: string) => Promise<void>;
  startSession: () => void; stopSession: () => void;
  updateSession: (patch: Partial<SessionInfo>) => void;
  pullImage: (reference: string) => void; removeImage: (id: string) => void;
  runContainer: (spec: RunSpec) => void; startContainer: (id: string) => void;
  stopContainer: (id: string) => void; restartContainer: (id: string) => void;
  deleteContainer: (id: string) => void;
  appendExec: (id: string, command: string, output: string) => void;
  createVolume: (name: string) => void; deleteVolume: (name: string) => void;
  retryProbe: () => Promise<void>;
  saveGroup: (group: ContainerGroup) => void;
  deleteGroup: (id: string) => void;
  setGroupAutoStart: (id: string, autoStart: boolean) => void;
  startGroup: (id: string) => void; stopGroup: (id: string) => void;
  startGroupContainer: (groupId: string, name: string) => void;
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

function sizeBytesFrom(row: Record<string, unknown>) {
  const bytes = Number(value(row, "size"));
  if (Number.isFinite(bytes) && bytes > 0) return bytes;
  const sizeMB = Number(value(row, "sizemb"));
  return Number.isFinite(sizeMB) && sizeMB > 0 ? sizeMB * 1024 * 1024 : 0;
}

function containersFrom(output?: string): Container[] {
  return rows(output, "containers").map((r) => {
    const rawState = value(r, "status", "state");
    const statusText = text(rawState).toLowerCase();
    const status: Container["status"] = rawState === 2 || statusText.includes("running") || statusText === "up"
      ? "running" : statusText.includes("created") ? "created" : "exited";
    const id = text(value(r, "id", "containerid", "container_id"));
    const name = text(value(r, "name", "names")) || id.slice(0, 12);
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
      id, name,
      image: text(value(r, "image")), status,
      createdAt: createdSeconds ? createdSeconds * 1000 : Date.now(),
      startedAt: status === "running" && changedSeconds ? changedSeconds * 1000 : undefined,
      ports, mounts: [], env: {}, gpu: false, cpuPercent: 0, memoryMB: 0,
      memoryLimitMB: 0, command: [], workdir: "/", user: "", logs: [],
      groupId: groupForContainer(name),
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
      sizeBytes: sizeBytesFrom(r),
      createdAt: Date.now(), containers: 0,
    };
  });
}

function volumesFrom(output?: string): VolumeRecord[] {
  return rows(output, "volumes").map((r) => ({
    name: text(value(r, "name")), driver: text(value(r, "driver")) || "wslc",
    mountpoint: text(value(r, "mountpoint")), sizeBytes: sizeBytesFrom(r),
    createdAt: Date.now(), inUse: false,
  }));
}

function runArgs(spec: RunSpec, network?: string) {
  const args = ["run"];
  if (spec.detach) args.push("-d"); if (spec.remove) args.push("--rm");
  if (spec.gpu) args.push("--gpus", "all"); if (spec.name.trim()) args.push("--name", spec.name.trim());
  if (network) args.push("--network", network);
  if (spec.workdir.trim()) args.push("-w", spec.workdir.trim());
  for (const p of spec.ports.split(",").map((x) => x.trim()).filter(Boolean)) args.push("-p", p);
  for (const e of spec.env.split("\n").map((x) => x.trim()).filter(Boolean)) args.push("-e", e);
  for (const m of spec.mounts.split("\n").map((x) => x.trim()).filter(Boolean)) args.push("-v", m);
  args.push(spec.image); if (spec.command.trim()) args.push(...spec.command.trim().split(/\s+/));
  return args;
}

function envValue(env: string, key: string) {
  const prefix = `${key}=`;
  return env.split("\n").map((line) => line.trim()).find((line) => line.startsWith(prefix))?.slice(prefix.length).trim() ?? "";
}

function specConfigured(group: ContainerGroup, spec: RunSpec) {
  if (group.id === "local-coding" && spec.name === "local-coding-mcp-ngrok") {
    return Boolean(envValue(effectiveSpec(spec, group).env, "NGROK_AUTHTOKEN"));
  }
  return true;
}

const call = (args: string[]) => invokeWslcHost({ cmd: "run_cli", args });
const apiCall = (args: string[], ok: boolean, result: string): ApiCall => ({
  id: crypto.randomUUID(), at: Date.now(), method: args.join(" "), csharp: `wslc ${args.join(" ")}`,
  cli: `wslc ${args.join(" ")}`, result, ok,
});

const prefs = loadPrefs();
export const useWslc = create<WslcState>((set, get) => {
  const setOperation = (key: string, active: boolean) => set((state) => {
    const operations = { ...state.operations };
    if (active) operations[key] = true;
    else delete operations[key];
    return { operations };
  });

  const execute = async (args: string[]) => {
    const result = await call(args);
    const message = result.output || result.error || "No output";
    set((state) => ({
      calls: [apiCall(args, result.ok, message), ...state.calls].slice(0, 80),
      lastError: result.ok ? state.lastError : (result.error || result.output || `wslc ${args.join(" ")} failed`),
    }));
    return result;
  };

  const refreshContainers = async () => {
    if (get().gate !== "ready") return;
    try {
      const result = await call(["container", "list", "--all", "--no-trunc", "--format", "json"]);
      if (!result.ok) return;
      const previous = get().containers;
      const containers = containersFrom(result.output).map((container) => {
        const old = previous.find((item) => item.id === container.id || item.name === container.name);
        return old ? { ...container, logs: old.logs } : container;
      });
      set({ containers, now: Date.now() });
    } catch {
      set({ now: Date.now() });
    }
  };

  const refreshInventory = async () => {
    if (get().gate !== "ready") return;
    try {
      const [images, volumes] = await Promise.all([
        call(["image", "list", "--no-trunc", "--format", "json"]),
        call(["volume", "list", "--format", "json"]),
      ]);
      set({
        images: images.ok ? imagesFrom(images.output) : get().images,
        volumes: volumes.ok ? volumesFrom(volumes.output) : get().volumes,
        now: Date.now(),
      });
    } catch {
      set({ now: Date.now() });
    }
  };

  const refreshAll = async () => {
    await Promise.all([refreshContainers(), refreshInventory()]);
  };

  const refreshLogs = async (id: string) => {
    const container = get().containers.find((item) => item.id === id);
    if (!container || container.status !== "running") return;
    const logs = await call(["container", "logs", "--tail", "100", container.name]);
    if (!logs.ok) return;
    const parsed = (logs.output ?? "").split(/\r?\n/).filter(Boolean).map((line, index) => ({
      ts: Date.now() + index,
      stream: "stdout" as const,
      text: line,
    }));
    set((state) => ({
      containers: state.containers.map((item) => item.id === id ? { ...item, logs: parsed } : item),
    }));
  };

  const prepareGroup = async (group: ContainerGroup) => {
    if (group.id === "local-coding") await ensureHostDirectory(LOCAL_CODING_WORKSPACE);
  };

  const ensureNetwork = async (network: string) => {
    if (!network.trim()) return;
    const list = await call(["network", "list"]);
    if (list.ok && (list.output ?? "").toLowerCase().includes(network.toLowerCase())) return;
    const created = await execute(["network", "create", network]);
    if (!created.ok) throw new Error(created.error || `Could not create network ${network}`);
  };

  const runInGroup = async (spec: RunSpec) => {
    const group = spec.groupId ? get().groups.find((item) => item.id === spec.groupId) : undefined;
    const effective = effectiveSpec(spec, group);
    if (group) {
      await prepareGroup(group);
      await ensureNetwork(group.network);
    }
    if (effective.name.trim()) assignContainer(effective.name, group?.id);
    return execute(runArgs(effective, group?.network));
  };

  const runOperation = async (key: string, work: () => Promise<void>) => {
    if (get().operations[key]) return;
    setOperation(key, true);
    try {
      await work();
    } catch (error) {
      set({ lastError: error instanceof Error ? error.message : String(error) });
    } finally {
      setOperation(key, false);
    }
  };

  return {
    view: "dashboard", gate: "checking", probeNote: "Looking for wslc.exe…", wslcOnPath: false,
    session: emptySession(["wslc"]), containers: [], images: [], volumes: [], calls: [], pulls: [],
    selectedId: null, runOpen: false, inspectOpen: false, metrics: [], now: Date.now(),
    catalog: CATALOG, groups: loadGroups(), launchAtSignIn: prefs.launchAtSignIn,
    operations: {}, lastError: null,
    setView: (view) => {
      set({ view });
      if (view === "images") void refreshInventory();
    },
    selectContainer: (selectedId) => set({ selectedId, inspectOpen: Boolean(selectedId) }),
    setRunOpen: (runOpen) => set({ runOpen }),
    setInspectOpen: (inspectOpen) => set({ inspectOpen, selectedId: inspectOpen ? get().selectedId : null }),
    clearError: () => set({ lastError: null }),
    tick: refreshContainers,
    refreshInventory,
    refreshLogs,
    startSession: () => { void runOperation("session", async () => { await execute(["system", "session", "start"]); await refreshContainers(); }); },
    stopSession: () => { void runOperation("session", async () => { await execute(["system", "session", "terminate"]); await refreshContainers(); }); },
    updateSession: (patch) => set((state) => ({ session: { ...state.session, ...patch } })),
    pullImage: (reference) => {
      const ref = reference.trim();
      if (!ref) return;
      void runOperation(`image:${ref}`, async () => { await execute(["pull", ref]); await refreshInventory(); });
    },
    removeImage: (id) => {
      const image = get().images.find((item) => item.id === id);
      if (!image) return;
      const ref = `${image.repository}:${image.tag}`;
      void runOperation(`image:${ref}`, async () => { await execute(["image", "rm", ref]); await refreshInventory(); });
    },
    runContainer: (spec) => {
      void runOperation(`container:${spec.name || spec.image}`, async () => {
        const result = await runInGroup(spec);
        await refreshContainers();
        if (result.ok) set({ runOpen: false, view: "containers" });
      });
    },
    startContainer: (id) => {
      const container = get().containers.find((item) => item.id === id);
      if (container) void runOperation(`container:${container.name}`, async () => { await execute(["container", "start", container.name]); await refreshContainers(); });
    },
    stopContainer: (id) => {
      const container = get().containers.find((item) => item.id === id);
      if (container) void runOperation(`container:${container.name}`, async () => { await execute(["container", "stop", container.name]); await refreshContainers(); });
    },
    restartContainer: (id) => {
      const container = get().containers.find((item) => item.id === id);
      if (container) void runOperation(`container:${container.name}`, async () => { await execute(["container", "restart", container.name]); await refreshContainers(); });
    },
    deleteContainer: (id) => {
      const container = get().containers.find((item) => item.id === id);
      if (!container) return;
      void runOperation(`container:${container.name}`, async () => {
        assignContainer(container.name);
        await execute(["container", "rm", container.name]);
        await refreshContainers();
      });
    },
    appendExec: (id, command) => {
      const container = get().containers.find((item) => item.id === id);
      if (container) void execute(["exec", container.name, ...command.trim().split(/\s+/)]);
    },
    createVolume: (name) => {
      const value = name.trim();
      if (value) void runOperation(`volume:${value}`, async () => { await execute(["volume", "create", value]); await refreshInventory(); });
    },
    deleteVolume: (name) => { void runOperation(`volume:${name}`, async () => { await execute(["volume", "rm", name]); await refreshInventory(); }); },
    retryProbe: async () => {
      const nativeLaunchAtSignIn = await getLaunchAtSignIn();
      set({ gate: "checking", probeNote: "Checking WSL and wslc.exe…", containers: [], images: [], volumes: [], metrics: [], groups: loadGroups(), launchAtSignIn: nativeLaunchAtSignIn });
      savePrefs({ launchAtSignIn: nativeLaunchAtSignIn, groupAuto: {} });
      const result = await checkHost();
      if (!result.wslc) {
        set({ gate: "missing", probeNote: result.note, wslcOnPath: false, session: emptySession(result.missing) });
        return;
      }
      set({
        gate: "ready",
        probeNote: result.note,
        wslcOnPath: true,
        session: {
          ...emptySession(),
          running: true,
          version: result.version ?? "wslc",
          wslVersion: result.wslVersion ?? "—",
        },
      });
      await refreshAll();
    },
    saveGroup: (group) => {
      persistGroup(group);
      set({ groups: loadGroups() });
    },
    deleteGroup: (id) => {
      deleteGroupDefinition(id);
      set({ groups: loadGroups() });
    },
    setGroupAutoStart: (id, autoStart) => {
      const group = get().groups.find((item) => item.id === id);
      if (!group || group.builtIn) return;
      persistGroup({ ...group, autoStart });
      set({ groups: loadGroups() });
    },
    startGroup: (id) => {
      const group = get().groups.find((item) => item.id === id);
      if (!group) return;
      void runOperation(`cube:${id}`, async () => {
        await prepareGroup(group);
        await ensureNetwork(group.network);
        for (const spec of group.specs) {
          if (!specConfigured(group, spec)) continue;
          const existing = get().containers.find((container) => container.name === spec.name);
          if (existing?.status === "running") continue;
          if (existing) {
            assignContainer(existing.name, group.id);
            await execute(["container", "start", existing.name]);
          } else {
            const effective = effectiveSpec(spec, group);
            assignContainer(effective.name, group.id);
            await execute(runArgs(effective, group.network));
          }
        }
        await refreshContainers();
        await refreshInventory();
      });
    },
    stopGroup: (id) => {
      const group = get().groups.find((item) => item.id === id);
      if (!group) return;
      void runOperation(`cube:${id}`, async () => {
        const names = new Set([
          ...group.specs.map((spec) => spec.name),
          ...get().containers.filter((container) => container.groupId === id).map((container) => container.name),
        ]);
        for (const name of Array.from(names).reverse()) {
          const existing = get().containers.find((container) => container.name === name && container.status === "running");
          if (existing) await execute(["container", "stop", name]);
        }
        await refreshContainers();
      });
    },
    startGroupContainer: (groupId, name) => {
      const group = get().groups.find((item) => item.id === groupId);
      if (!group) return;
      const spec = group.specs.find((item) => item.name === name);
      const existing = get().containers.find((container) => container.name === name);
      if (existing?.status === "running") return;
      if (spec && !specConfigured(group, spec)) {
        set({ lastError: `Configure NGROK_AUTHTOKEN before starting ${name}.` });
        return;
      }
      void runOperation(`container:${name}`, async () => {
        await prepareGroup(group);
        if (existing) {
          assignContainer(existing.name, group.id);
          await execute(["container", "start", existing.name]);
        } else if (spec) {
          await ensureNetwork(group.network);
          const effective = effectiveSpec(spec, group);
          assignContainer(effective.name, group.id);
          await execute(runArgs(effective, group.network));
          await refreshInventory();
        }
        await refreshContainers();
      });
    },
    startAutoGroups: () => {
      for (const group of get().groups.filter((item) => item.autoStart)) get().startGroup(group.id);
    },
    setLaunchAtSignIn: (launchAtSignIn) => {
      void (async () => {
        try {
          const nativeLaunchAtSignIn = await setNativeLaunchAtSignIn(launchAtSignIn);
          set({ launchAtSignIn: nativeLaunchAtSignIn });
          savePrefs({ launchAtSignIn: nativeLaunchAtSignIn, groupAuto: {} });
        } catch (error) {
          set({ lastError: error instanceof Error ? error.message : String(error) });
        }
      })();
    },
  };
});