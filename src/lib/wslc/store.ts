import { create } from "zustand";
import {
  ensureHostDirectory,
  ensureWorkspaceRoot,
  getDefaultWorkspaceRoot,
  getLaunchAtSignIn,
  invokeWslcHost,
  moveWorkspaceRoot,
  pullCancel,
  pullClearHistory,
  pullList,
  pullStart,
  setLaunchAtSignIn as setNativeLaunchAtSignIn,
} from "@/lib/tauri";
import {
  DEFAULT_WORKSPACE_TARGET,
  defaultCubeContainerWorkspacePath,
  defaultStandaloneWorkspacePath,
  normalizeWorkspacePath,
  resolveWorkspacePath,
} from "@/lib/workspace";
import { checkHost } from "./probe";
import { loadPrefs, savePrefs } from "./prefs";
import {
  assignContainer,
  deleteGroupDefinition,
  effectiveSpec,
  groupForContainer,
  loadGroups,
  normalizeGroupWorkspace,
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
const LAB_WORKSPACE_ROOT = "D:\\QuayAppData\\workspace";

export type OperationStatus = "starting" | "stopping" | "restarting" | "removing" | "creating";

export type CompleteOnboardingInput = {
  workspaceRoot: string;
  launchAtSignIn: boolean;
};

interface WslcState {
  view: ViewId; gate: HostGate; probeNote: string; wslcOnPath: boolean;
  session: SessionInfo; containers: Container[]; images: ImageRecord[];
  volumes: VolumeRecord[]; calls: ApiCall[]; pulls: PullJob[];
  selectedId: string | null; runOpen: boolean; inspectOpen: boolean;
  metrics: MetricsPoint[]; now: number; catalog: string[];
  groups: ContainerGroup[]; launchAtSignIn: boolean; workspaceRoot: string;
  onboardingCompleted: boolean;
  operations: Record<string, OperationStatus>; lastError: string | null;
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
  startPull: (reference: string) => Promise<PullJob | null>;
  cancelPull: (id: string) => Promise<void>;
  clearPullHistory: () => Promise<void>;
  syncPullJobs: () => Promise<void>;
  applyPullJobUpdate: (job: PullJob) => void;
  removeImage: (id: string) => void;
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
  setWorkspaceRoot: (root: string) => void;
  setOnboardingCompleted: (completed: boolean) => void;
  completeOnboarding: (input: CompleteOnboardingInput) => Promise<void>;
  changeWorkspaceRoot: (nextRoot: string, mode: "move" | "keep") => Promise<void>;
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
        }) : [];
    const createdSeconds = Number(value(r, "createdat"));
    const changedSeconds = Number(value(r, "statechangedat"));
    return {
      id, name, image: text(value(r, "image")), status,
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
      repository, tag, digest: text(value(r, "digest")), sizeBytes: sizeBytesFrom(r),
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

function runArgs(spec: RunSpec, network?: string, managedMount?: string) {
  const args = ["run"];
  if (spec.detach) args.push("-d"); if (spec.remove) args.push("--rm");
  if (spec.gpu) args.push("--gpus", "all"); if (spec.name.trim()) args.push("--name", spec.name.trim());
  if (network) args.push("--network", network);
  if (spec.workdir.trim()) args.push("-w", spec.workdir.trim());
  for (const p of spec.ports.split(",").map((x) => x.trim()).filter(Boolean)) args.push("-p", p);
  for (const e of spec.env.split("\n").map((x) => x.trim()).filter(Boolean)) args.push("-e", e);
  if (managedMount) args.push("-v", managedMount);
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

const upsertPull = (pulls: PullJob[], job: PullJob) => {
  const index = pulls.findIndex((item) => item.id === job.id);
  if (index < 0) return [job, ...pulls];
  const next = pulls.slice();
  next[index] = job;
  return next;
};

const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);

const prefs = loadPrefs();
export const useWslc = create<WslcState>((set, get) => {
  let containersRefreshInFlight: Promise<void> | null = null;
  let inventoryRefreshInFlight: Promise<void> | null = null;

  const saveCurrentPrefs = (patch: Partial<ReturnType<typeof loadPrefs>> = {}) => {
    savePrefs({
      launchAtSignIn: get().launchAtSignIn,
      groupAuto: {},
      workspaceRoot: get().workspaceRoot,
      onboardingCompleted: get().onboardingCompleted,
      ...patch,
    });
  };

  const setOperation = (key: string, status?: OperationStatus) => set((state) => {
    const operations = { ...state.operations };
    if (status) operations[key] = status; else delete operations[key];
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

  const refreshContainers = (): Promise<void> => {
    if (containersRefreshInFlight) return containersRefreshInFlight;
    if (get().gate !== "ready") return Promise.resolve();
    containersRefreshInFlight = (async () => {
      try {
        const result = await call(["container", "list", "--all", "--no-trunc", "--format", "json"]);
        if (!result.ok) return;
        const previous = get().containers;
        const containers = containersFrom(result.output).map((container) => {
          const old = previous.find((item) => item.id === container.id || item.name === container.name);
          return old ? { ...container, logs: old.logs } : container;
        });
        set({ containers, now: Date.now() });
      } catch { set({ now: Date.now() }); }
      finally { containersRefreshInFlight = null; }
    })();
    return containersRefreshInFlight;
  };

  const refreshInventory = (): Promise<void> => {
    if (inventoryRefreshInFlight) return inventoryRefreshInFlight;
    if (get().gate !== "ready") return Promise.resolve();
    inventoryRefreshInFlight = (async () => {
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
      } catch { set({ now: Date.now() }); }
      finally { inventoryRefreshInFlight = null; }
    })();
    return inventoryRefreshInFlight;
  };

  const refreshAll = async () => { await Promise.all([refreshContainers(), refreshInventory()]); };
  const refreshAfterMutation = async () => { await refreshAll(); };

  const refreshLogs = async (id: string) => {
    const container = get().containers.find((item) => item.id === id);
    if (!container || container.status !== "running") return;
    const logs = await call(["container", "logs", "--tail", "100", container.name]);
    if (!logs.ok) return;
    const parsed = (logs.output ?? "").split(/\r?\n/).filter(Boolean).map((line, index) => ({
      ts: Date.now() + index, stream: "stdout" as const, text: line,
    }));
    set((state) => ({ containers: state.containers.map((item) => item.id === id ? { ...item, logs: parsed } : item) }));
  };

  const prepareGroup = async (group: ContainerGroup) => {
    if (group.id === "local-coding") await ensureHostDirectory(LOCAL_CODING_WORKSPACE);
  };

  const ensureNetwork = async (network: string) => {
    if (!network.trim()) return;
    const result = await invokeWslcHost({ cmd: "ensure_network", name: network });
    if (!result.ok) throw new Error(result.error || `Could not create network ${network}`);
  };

  const managedWorkspaceMount = async (spec: RunSpec, group?: ContainerGroup) => {
    const groupPath = group ? normalizeGroupWorkspace(group).workspacePath : undefined;
    const relative = normalizeWorkspacePath(
      spec.workspacePath || (groupPath
        ? defaultCubeContainerWorkspacePath(groupPath, spec.name || spec.image)
        : defaultStandaloneWorkspacePath(spec.name || spec.image)),
    );
    const source = resolveWorkspacePath(get().workspaceRoot, relative);
    await ensureHostDirectory(source);
    return `${source}:${spec.workspaceTarget?.trim() || DEFAULT_WORKSPACE_TARGET}:rw`;
  };

  const runInGroup = async (spec: RunSpec) => {
    const group = spec.groupId ? get().groups.find((item) => item.id === spec.groupId) : undefined;
    const effective = effectiveSpec(spec, group);
    if (group) { await prepareGroup(group); await ensureNetwork(group.network); }
    const managedMount = await managedWorkspaceMount(effective, group);
    if (effective.name.trim()) assignContainer(effective.name, group?.id);
    return execute(runArgs(effective, group?.network, managedMount));
  };

  const runOperation = async (key: string, status: OperationStatus, work: () => Promise<void>) => {
    if (get().operations[key]) return;
    setOperation(key, status);
    try { await work(); }
    catch (error) { set({ lastError: errorMessage(error) }); }
    finally { setOperation(key); }
  };

  return {
    view: "dashboard", gate: "checking", probeNote: "Looking for wslc.exe…", wslcOnPath: false,
    session: emptySession(["wslc"]), containers: [], images: [], volumes: [], calls: [], pulls: [],
    selectedId: null, runOpen: false, inspectOpen: false, metrics: [], now: Date.now(),
    catalog: CATALOG, groups: loadGroups(), launchAtSignIn: prefs.launchAtSignIn,
    workspaceRoot: prefs.workspaceRoot ?? LAB_WORKSPACE_ROOT,
    onboardingCompleted: prefs.onboardingCompleted === true,
    operations: {}, lastError: null,
    setView: (view) => { set({ view }); if (view === "images") void refreshInventory(); },
    selectContainer: (selectedId) => set({ selectedId, inspectOpen: Boolean(selectedId) }),
    setRunOpen: (runOpen) => set({ runOpen }),
    setInspectOpen: (inspectOpen) => set({ inspectOpen, selectedId: inspectOpen ? get().selectedId : null }),
    clearError: () => set({ lastError: null }),
    tick: refreshContainers,
    refreshInventory,
    refreshLogs,
    startSession: () => { void runOperation("session", "starting", async () => { await execute(["system", "session", "start"]); await refreshAfterMutation(); }); },
    stopSession: () => { void runOperation("session", "stopping", async () => { await execute(["system", "session", "terminate"]); await refreshAfterMutation(); }); },
    updateSession: (patch) => set((state) => ({ session: { ...state.session, ...patch } })),
    startPull: async (reference) => {
      const ref = reference.trim();
      if (!ref) return null;
      try {
        const job = await pullStart(ref);
        set((state) => ({ pulls: upsertPull(state.pulls, job), lastError: null }));
        return job;
      } catch (error) {
        set({ lastError: errorMessage(error) });
        return null;
      }
    },
    cancelPull: async (id) => {
      try {
        const job = await pullCancel(id);
        set((state) => ({ pulls: upsertPull(state.pulls, job) }));
      } catch (error) { set({ lastError: errorMessage(error) }); }
    },
    clearPullHistory: async () => {
      try { set({ pulls: await pullClearHistory() }); }
      catch (error) { set({ lastError: errorMessage(error) }); }
    },
    syncPullJobs: async () => {
      try { set({ pulls: await pullList() }); }
      catch (error) { set({ lastError: errorMessage(error) }); }
    },
    applyPullJobUpdate: (job) => {
      const previous = get().pulls.find((item) => item.id === job.id);
      set((state) => ({ pulls: upsertPull(state.pulls, job) }));
      if (job.status === "completed" && previous?.status !== "completed") void refreshInventory();
      if (job.status === "failed" && previous?.status !== "failed") {
        set({ lastError: job.error || `Pull ${job.reference} failed` });
      }
    },
    removeImage: (id) => {
      const image = get().images.find((item) => item.id === id);
      if (!image) return;
      const ref = `${image.repository}:${image.tag}`;
      void runOperation(`image:${ref}`, "removing", async () => { await execute(["image", "rm", ref]); await refreshAfterMutation(); });
    },
    runContainer: (spec) => {
      void runOperation(`container:${spec.name || spec.image}`, "starting", async () => {
        const result = await runInGroup({
          ...spec,
          workspacePath: spec.workspacePath || defaultStandaloneWorkspacePath(spec.name || spec.image),
          workspaceTarget: spec.workspaceTarget || DEFAULT_WORKSPACE_TARGET,
        });
        await refreshAfterMutation();
        if (result.ok) set({ runOpen: false, view: "containers" });
      });
    },
    startContainer: (id) => {
      const container = get().containers.find((item) => item.id === id);
      if (container) void runOperation(`container:${container.name}`, "starting", async () => { await execute(["container", "start", container.name]); await refreshAfterMutation(); });
    },
    stopContainer: (id) => {
      const container = get().containers.find((item) => item.id === id);
      if (container) void runOperation(`container:${container.name}`, "stopping", async () => { await execute(["container", "stop", container.name]); await refreshAfterMutation(); });
    },
    restartContainer: (id) => {
      const container = get().containers.find((item) => item.id === id);
      if (container) void runOperation(`container:${container.name}`, "restarting", async () => { await execute(["container", "restart", container.name]); await refreshAfterMutation(); });
    },
    deleteContainer: (id) => {
      const container = get().containers.find((item) => item.id === id);
      if (!container) return;
      void runOperation(`container:${container.name}`, "removing", async () => {
        assignContainer(container.name); await execute(["container", "rm", container.name]); await refreshAfterMutation();
      });
    },
    appendExec: (id, command) => {
      const container = get().containers.find((item) => item.id === id);
      if (container) void execute(["exec", container.name, ...command.trim().split(/\s+/)]);
    },
    createVolume: (name) => {
      const value = name.trim();
      if (value) void runOperation(`volume:${value}`, "creating", async () => { await execute(["volume", "create", value]); await refreshAfterMutation(); });
    },
    deleteVolume: (name) => { void runOperation(`volume:${name}`, "removing", async () => { await execute(["volume", "rm", name]); await refreshAfterMutation(); }); },
    retryProbe: async () => {
      const nativeLaunchAtSignIn = await getLaunchAtSignIn();
      let workspaceRoot = get().workspaceRoot;
      if (!prefs.workspaceRoot) {
        try { workspaceRoot = await getDefaultWorkspaceRoot(); } catch { workspaceRoot = LAB_WORKSPACE_ROOT; }
      }
      try { await ensureWorkspaceRoot(workspaceRoot); }
      catch (error) { set({ lastError: errorMessage(error) }); }
      set({ gate: "checking", probeNote: "Checking WSL and wslc.exe…", containers: [], images: [], volumes: [], metrics: [], groups: loadGroups(), launchAtSignIn: nativeLaunchAtSignIn, workspaceRoot });
      savePrefs({ launchAtSignIn: nativeLaunchAtSignIn, groupAuto: {}, workspaceRoot, onboardingCompleted: get().onboardingCompleted });
      const result = await checkHost();
      if (!result.wslc) {
        set({ gate: "missing", probeNote: result.note, wslcOnPath: false, session: emptySession(result.missing) });
        return;
      }
      set({ gate: "ready", probeNote: result.note, wslcOnPath: true, session: { ...emptySession(), running: true, version: result.version ?? "wslc", wslVersion: result.wslVersion ?? "—" } });
      await refreshAll();
    },
    saveGroup: (group) => { persistGroup(group); set({ groups: loadGroups() }); },
    deleteGroup: (id) => { deleteGroupDefinition(id); set({ groups: loadGroups() }); },
    setGroupAutoStart: (id, autoStart) => {
      const group = get().groups.find((item) => item.id === id);
      if (!group || group.builtIn) return;
      persistGroup({ ...group, autoStart }); set({ groups: loadGroups() });
    },
    startGroup: (id) => {
      const group = get().groups.find((item) => item.id === id);
      if (!group) return;
      void runOperation(`cube:${id}`, "starting", async () => {
        await prepareGroup(group); await ensureNetwork(group.network);
        for (const spec of group.specs) {
          if (!specConfigured(group, spec)) continue;
          const existing = get().containers.find((container) => container.name === spec.name);
          if (existing?.status === "running") continue;
          if (existing) { assignContainer(existing.name, group.id); await execute(["container", "start", existing.name]); }
          else {
            const effective = effectiveSpec(spec, group);
            const managedMount = await managedWorkspaceMount(effective, group);
            assignContainer(effective.name, group.id);
            await execute(runArgs(effective, group.network, managedMount));
          }
        }
        await refreshAfterMutation();
      });
    },
    stopGroup: (id) => {
      const group = get().groups.find((item) => item.id === id);
      if (!group) return;
      void runOperation(`cube:${id}`, "stopping", async () => {
        const names = new Set([
          ...group.specs.map((spec) => spec.name),
          ...get().containers.filter((container) => container.groupId === id).map((container) => container.name),
        ]);
        for (const name of Array.from(names).reverse()) {
          const existing = get().containers.find((container) => container.name === name && container.status === "running");
          if (existing) await execute(["container", "stop", name]);
        }
        await refreshAfterMutation();
      });
    },
    startGroupContainer: (groupId, name) => {
      const group = get().groups.find((item) => item.id === groupId);
      if (!group) return;
      const spec = group.specs.find((item) => item.name === name);
      const existing = get().containers.find((container) => container.name === name);
      if (existing?.status === "running") return;
      if (spec && !specConfigured(group, spec)) { set({ lastError: `Configure NGROK_AUTHTOKEN before starting ${name}.` }); return; }
      void runOperation(`container:${name}`, "starting", async () => {
        await prepareGroup(group);
        if (existing) { assignContainer(existing.name, group.id); await execute(["container", "start", existing.name]); }
        else if (spec) {
          await ensureNetwork(group.network);
          const effective = effectiveSpec(spec, group);
          const managedMount = await managedWorkspaceMount(effective, group);
          assignContainer(effective.name, group.id);
          await execute(runArgs(effective, group.network, managedMount));
        }
        await refreshAfterMutation();
      });
    },
    startAutoGroups: () => { for (const group of get().groups.filter((item) => item.autoStart)) get().startGroup(group.id); },
    setLaunchAtSignIn: (launchAtSignIn) => {
      void (async () => {
        try {
          const nativeLaunchAtSignIn = await setNativeLaunchAtSignIn(launchAtSignIn);
          set({ launchAtSignIn: nativeLaunchAtSignIn });
          saveCurrentPrefs({ launchAtSignIn: nativeLaunchAtSignIn });
        } catch (error) { set({ lastError: errorMessage(error) }); }
      })();
    },
    setWorkspaceRoot: (workspaceRoot) => {
      set({ workspaceRoot });
      saveCurrentPrefs({ workspaceRoot });
    },
    setOnboardingCompleted: (onboardingCompleted) => {
      set({ onboardingCompleted });
      saveCurrentPrefs({ onboardingCompleted });
    },
    completeOnboarding: async (input) => {
      const workspaceRoot = input.workspaceRoot.trim();
      if (!workspaceRoot) throw new Error("Choose a Quay workspace folder before continuing.");
      await ensureWorkspaceRoot(input.workspaceRoot);
      const launchAtSignIn = await setNativeLaunchAtSignIn(input.launchAtSignIn);
      set({ workspaceRoot, launchAtSignIn, onboardingCompleted: true, lastError: null });
      saveCurrentPrefs({ workspaceRoot, launchAtSignIn, onboardingCompleted: true });
    },
    changeWorkspaceRoot: async (nextRoot, mode) => {
      const previous = get().workspaceRoot;
      if (!nextRoot.trim() || nextRoot.trim().toLowerCase() === previous.trim().toLowerCase()) return;
      try {
        await ensureWorkspaceRoot(nextRoot);
        if (mode === "move") await moveWorkspaceRoot(previous, nextRoot);
        set({ workspaceRoot: nextRoot, lastError: null });
        savePrefs({ launchAtSignIn: get().launchAtSignIn, groupAuto: {}, workspaceRoot: nextRoot, onboardingCompleted: get().onboardingCompleted });
      } catch (error) {
        set({ lastError: errorMessage(error) });
        throw error;
      }
    },
  };
});