import { create } from "zustand";
import {
  csharpCreateAndStart,
  csharpDelete,
  csharpExec,
  csharpPull,
  csharpSessionStart,
  csharpStop,
  cliForRun,
} from "./csharp";
import { checkHost } from "./probe";
import {
  catalogImages,
  seedContainers,
  seedImages,
  seedSession,
  seedVolumes,
} from "./seed";
import type {
  ApiCall,
  Container,
  HostGate,
  ImageRecord,
  MetricsPoint,
  PullJob,
  RunSpec,
  SessionInfo,
  ViewId,
  VolumeRecord,
} from "./types";

function rid(prefix = "") {
  const hex = Math.random().toString(16).slice(2, 14).padEnd(12, "0");
  return prefix + hex;
}

function clone<T>(v: T): T {
  return structuredClone(v);
}

function parsePorts(raw: string): Container["ports"] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((p) => {
      const [host, container] = p.split(":").map((n) => Number(n));
      return {
        host: host || container || 0,
        container: container || host || 0,
        protocol: "tcp" as const,
      };
    })
    .filter((p) => p.host > 0);
}

function parseMounts(raw: string): Container["mounts"] {
  return raw
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((line) => {
      const [source, destination, mode] = line.split(":");
      return {
        source: source ?? "",
        destination: destination ?? source ?? "",
        mode: mode === "ro" ? ("ro" as const) : ("rw" as const),
      };
    });
}

function parseEnv(raw: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) env[trimmed] = "";
    else env[trimmed.slice(0, eq)] = trimmed.slice(eq + 1);
  }
  return env;
}

const LOG_SNIPPETS: Record<string, string[]> = {
  nginx: [
    '172.17.0.1 - GET / HTTP/1.1" 200',
    '172.17.0.1 - GET /healthz HTTP/1.1" 200',
    "start worker process",
  ],
  postgres: [
    "checkpoint complete: wrote 12 buffers",
    "connection received: host=172.17.0.1",
    "duration: 1.2 ms  statement: SELECT 1",
  ],
  redis: ["DB saved on disk", "1 client connected"],
  pytorch: ["step loss=0.173", "cuda mem 3.1/16.0 GB", "saving checkpoint"],
  webtop: ["selkies: websocket ping", "kwin: compositor ready"],
  alpine: ["done"],
  default: ["heartbeat"],
};

function snippetsFor(image: string) {
  const key = Object.keys(LOG_SNIPPETS).find((k) => image.includes(k));
  return LOG_SNIPPETS[key ?? "default"] ?? LOG_SNIPPETS.default;
}

interface WslcState {
  view: ViewId;
  gate: HostGate;
  probeNote: string;
  wslcOnPath: boolean;
  sidecarUp: boolean;
  session: SessionInfo;
  containers: Container[];
  images: ImageRecord[];
  volumes: VolumeRecord[];
  calls: ApiCall[];
  pulls: PullJob[];
  selectedId: string | null;
  runOpen: boolean;
  inspectOpen: boolean;
  metrics: MetricsPoint[];
  now: number;
  catalog: string[];
  setView: (view: ViewId) => void;
  selectContainer: (id: string | null) => void;
  setRunOpen: (open: boolean) => void;
  setInspectOpen: (open: boolean) => void;
  tick: () => void;
  startSession: () => void;
  stopSession: () => void;
  updateSession: (patch: Partial<SessionInfo>) => void;
  pullImage: (reference: string) => void;
  removeImage: (id: string) => void;
  runContainer: (spec: RunSpec) => void;
  startContainer: (id: string) => void;
  stopContainer: (id: string) => void;
  restartContainer: (id: string) => void;
  deleteContainer: (id: string) => void;
  appendExec: (id: string, command: string, output: string) => void;
  createVolume: (name: string) => void;
  deleteVolume: (name: string) => void;
  resetLab: () => void;
  enterLab: () => void;
  retryProbe: () => Promise<void>;
}

function pushCall(
  calls: ApiCall[],
  partial: Omit<ApiCall, "id" | "at">,
): ApiCall[] {
  const next: ApiCall = { id: rid("call-"), at: Date.now(), ...partial };
  return [next, ...calls].slice(0, 80);
}

function emptyMetrics(): MetricsPoint[] {
  const t0 = Date.now() - 60_000;
  return Array.from({ length: 30 }, (_, i) => ({
    t: t0 + i * 2000,
    cpu: 18 + Math.sin(i / 3) * 8,
    mem: 32 + Math.cos(i / 4) * 6,
  }));
}

function idleMetrics(): MetricsPoint[] {
  const t0 = Date.now() - 60_000;
  return Array.from({ length: 30 }, (_, i) => ({
    t: t0 + i * 2000,
    cpu: 0,
    mem: 0,
  }));
}

function emptySession(missing: string[]): SessionInfo {
  return {
    ...clone(seedSession),
    running: false,
    startedAt: undefined,
    missingComponents: missing,
    gpu: false,
    gpuName: "",
    version: "wslc —",
    wslVersion: "—",
  };
}

function labState(): Pick<
  WslcState,
  | "view"
  | "gate"
  | "probeNote"
  | "wslcOnPath"
  | "sidecarUp"
  | "session"
  | "containers"
  | "images"
  | "volumes"
  | "calls"
  | "pulls"
  | "selectedId"
  | "runOpen"
  | "inspectOpen"
  | "metrics"
  | "now"
  | "catalog"
> {
  return {
    view: "dashboard",
    gate: "lab",
    probeNote: "Sample data — not a live wslc session",
    wslcOnPath: false,
    sidecarUp: false,
    session: clone(seedSession),
    containers: clone(seedContainers),
    images: clone(seedImages),
    volumes: clone(seedVolumes),
    calls: [
      {
        id: "boot-1",
        at: Date.now() - 3000,
        method: "Session.Start",
        csharp: csharpSessionStart(seedSession),
        cli: "wslc system session start",
        result: "session Quay running · 4 vCPU · 4096 MB",
        ok: true,
      },
    ],
    pulls: [],
    selectedId: null,
    runOpen: false,
    inspectOpen: false,
    metrics: emptyMetrics(),
    now: Date.now(),
    catalog: catalogImages,
  };
}

function initial(): ReturnType<typeof labState> {
  return {
    view: "dashboard",
    gate: "checking",
    probeNote: "Looking for wslc.exe…",
    wslcOnPath: false,
    sidecarUp: false,
    session: emptySession(["wslc"]),
    containers: [],
    images: [],
    volumes: [],
    calls: [],
    pulls: [],
    selectedId: null,
    runOpen: false,
    inspectOpen: false,
    metrics: idleMetrics(),
    now: Date.now(),
    catalog: catalogImages,
  };
}

export const useWslc = create<WslcState>((set, get) => ({
  ...initial(),

  setView: (view) => set({ view }),
  selectContainer: (id) =>
    set({ selectedId: id, inspectOpen: Boolean(id) }),
  setRunOpen: (runOpen) => set({ runOpen }),
  setInspectOpen: (inspectOpen) =>
    set({ inspectOpen, selectedId: inspectOpen ? get().selectedId : null }),

  tick: () => {
    const t = Date.now();
    set((s) => {
      const containers = s.containers.map((c) => {
        if (c.status !== "running") {
          return { ...c, cpuPercent: 0 };
        }
        const drift = (Math.random() - 0.45) * 6;
        const cpu = Math.min(96, Math.max(0.4, c.cpuPercent + drift));
        const mem = Math.min(
          c.memoryLimitMB * 0.95,
          Math.max(4, c.memoryMB + (Math.random() - 0.5) * 12),
        );
        const extraLogs = { ...c };
        extraLogs.cpuPercent = cpu;
        extraLogs.memoryMB = mem;
        if (Math.random() < 0.18) {
          const line = snippetsFor(c.image)[
            Math.floor(Math.random() * snippetsFor(c.image).length)
          ]!;
          extraLogs.logs = [
            ...c.logs,
            { ts: t, stream: "stdout" as const, text: line },
          ].slice(-200);
        }
        return extraLogs;
      });

      const running = containers.filter((c) => c.status === "running");
      const cpu =
        running.reduce((a, c) => a + c.cpuPercent, 0) / Math.max(1, s.session.cpuCount * 25);
      const mem =
        (running.reduce((a, c) => a + c.memoryMB, 0) / s.session.memoryMB) * 100;

      const pulls = s.pulls
        .map((p) => {
          if (p.currentBytes >= p.totalBytes) return p;
          const step = p.totalBytes / 8 + Math.random() * (p.totalBytes / 10);
          const currentBytes = Math.min(p.totalBytes, p.currentBytes + step);
          const pct = currentBytes / p.totalBytes;
          const status =
            pct < 0.15
              ? "Resolving"
              : pct < 0.85
                ? "Downloading"
                : "Extracting";
          return { ...p, currentBytes, status };
        })
        .filter((p) => {
          if (p.currentBytes < p.totalBytes) return true;
          return t - p.startedAt < 4000;
        });

      return {
        containers,
        pulls,
        now: t,
        metrics: [
          ...s.metrics,
          {
            t,
            cpu: Math.min(100, Math.max(4, cpu * 100 + (Math.random() - 0.5) * 3)),
            mem: Math.min(100, Math.max(8, mem + (Math.random() - 0.5) * 2)),
          },
        ].slice(-40),
      };
    });
  },

  startSession: () => {
    const session = { ...get().session, running: true, startedAt: Date.now() };
    set((s) => ({
      session,
      calls: pushCall(s.calls, {
        method: "Session.Start",
        csharp: csharpSessionStart(session),
        cli: "wslc system session start",
        result: `session ${session.name} started`,
        ok: true,
      }),
    }));
  },

  stopSession: () => {
    set((s) => ({
      session: { ...s.session, running: false },
      containers: s.containers.map((c) =>
        c.status === "running"
          ? {
              ...c,
              status: "exited" as const,
              cpuPercent: 0,
              exitCode: 137,
              finishedAt: Date.now(),
            }
          : c,
      ),
      calls: pushCall(s.calls, {
        method: "Session.Terminate",
        csharp: "session.Terminate();",
        cli: "wslc system session terminate",
        result: "session terminated · containers signaled",
        ok: true,
      }),
    }));
  },

  updateSession: (patch) => {
    set((s) => ({
      session: { ...s.session, ...patch },
      calls: pushCall(s.calls, {
        method: "SessionSettings",
        csharp: csharpSessionStart({ ...s.session, ...patch }),
        cli: `wslc system session update --cpu ${patch.cpuCount ?? s.session.cpuCount} --memory ${patch.memoryMB ?? s.session.memoryMB}`,
        result: "session settings applied on next start",
        ok: true,
      }),
    }));
  },

  pullImage: (reference) => {
    const ref = reference.trim();
    if (!ref) return;
    const [repository, tag = "latest"] = ref.includes("/")
      ? [ref.replace(/:([^:]+)$/, ""), ref.includes(":") ? ref.split(":").pop()! : "latest"]
      : ref.split(":");
    const repo = repository || ref;
    const existing = get().images.find(
      (i) => `${i.repository}:${i.tag}` === `${repo}:${tag}` || `${i.repository}:${i.tag}` === ref,
    );
    if (existing) {
      set((s) => ({
        calls: pushCall(s.calls, {
          method: "Session.PullImageAsync",
          csharp: csharpPull(ref),
          cli: `wslc pull ${ref}`,
          result: `Image ${ref} already present`,
          ok: true,
        }),
      }));
      return;
    }
    const totalBytes = (80 + Math.random() * 900) * 1024 * 1024;
    const job: PullJob = {
      id: rid("pull-"),
      reference: ref.includes(":") ? ref : `${ref}:latest`,
      status: "Resolving",
      currentBytes: 0,
      totalBytes,
      startedAt: Date.now(),
    };
    set((s) => ({
      pulls: [job, ...s.pulls],
      calls: pushCall(s.calls, {
        method: "Session.PullImageAsync",
        csharp: csharpPull(ref),
        cli: `wslc pull ${ref}`,
        result: `pulling ${job.reference}`,
        ok: true,
      }),
    }));
    window.setTimeout(() => {
      set((s) => {
        if (!s.pulls.some((p) => p.id === job.id)) return s;
        const record: ImageRecord = {
          id: `sha256:${rid()}`,
          repository: repo,
          tag,
          digest: `sha256:${rid()}${rid().slice(0, 4)}`,
          sizeMB: totalBytes / (1024 * 1024),
          createdAt: Date.now(),
          containers: 0,
        };
        return {
          images: [record, ...s.images],
          pulls: s.pulls.map((p) =>
            p.id === job.id
              ? { ...p, currentBytes: p.totalBytes, status: "Complete" }
              : p,
          ),
        };
      });
    }, 2600);
  },

  removeImage: (id) => {
    const img = get().images.find((i) => i.id === id);
    if (!img) return;
    const inUse = get().containers.some(
      (c) => c.image === `${img.repository}:${img.tag}` && c.status !== "exited",
    );
    if (inUse) {
      set((s) => ({
        calls: pushCall(s.calls, {
          method: "Session.RemoveImage",
          csharp: `session.RemoveImage("${img.repository}:${img.tag}");`,
          cli: `wslc image rm ${img.repository}:${img.tag}`,
          result: "conflict: image is in use by a running container",
          ok: false,
        }),
      }));
      return;
    }
    set((s) => ({
      images: s.images.filter((i) => i.id !== id),
      calls: pushCall(s.calls, {
        method: "Session.RemoveImage",
        csharp: `session.RemoveImage("${img.repository}:${img.tag}");`,
        cli: `wslc image rm ${img.repository}:${img.tag}`,
        result: `removed ${img.repository}:${img.tag}`,
        ok: true,
      }),
    }));
  },

  runContainer: (spec) => {
    if (!get().session.running) {
      set((s) => ({
        calls: pushCall(s.calls, {
          method: "Session.CreateContainer",
          csharp: csharpCreateAndStart(spec),
          cli: cliForRun(spec),
          result: "session is not running — start the WSL container VM first",
          ok: false,
        }),
      }));
      return;
    }
    const name =
      spec.name.trim() ||
      spec.image.split("/").pop()?.split(":")[0] ||
      "container";
    const unique = get().containers.some((c) => c.name === name)
      ? `${name}-${rid().slice(0, 4)}`
      : name;
    const command = spec.command.trim()
      ? spec.command.trim().split(/\s+/)
      : ["/bin/sh"];
    const container: Container = {
      id: rid(),
      name: unique,
      image: spec.image,
      status: "created",
      createdAt: Date.now(),
      ports: parsePorts(spec.ports),
      mounts: parseMounts(spec.mounts),
      env: parseEnv(spec.env),
      gpu: spec.gpu,
      cpuPercent: 0,
      memoryMB: 4,
      memoryLimitMB: spec.gpu ? 2048 : 512,
      command,
      workdir: spec.workdir || "/",
      user: "root",
      logs: [],
    };
    set((s) => ({
      containers: [container, ...s.containers],
      selectedId: container.id,
      inspectOpen: true,
      runOpen: false,
      view: "containers",
      images: s.images.map((i) =>
        `${i.repository}:${i.tag}` === spec.image
          ? { ...i, containers: i.containers + 1 }
          : i,
      ),
      calls: pushCall(s.calls, {
        method: "Session.CreateContainer",
        csharp: csharpCreateAndStart({ ...spec, name: unique }),
        cli: cliForRun({ ...spec, name: unique }),
        result: `created ${unique} (${container.id})`,
        ok: true,
      }),
    }));
    window.setTimeout(() => get().startContainer(container.id), 380);
  },

  startContainer: (id) => {
    set((s) => {
      const target = s.containers.find((c) => c.id === id);
      if (!target) return s;
      if (!s.session.running) {
        return {
          calls: pushCall(s.calls, {
            method: "Container.Start",
            csharp: "container.Start();",
            cli: `wslc container start ${target.name}`,
            result: "session is not running",
            ok: false,
          }),
        };
      }
      return {
        containers: s.containers.map((c) =>
          c.id === id
            ? {
                ...c,
                status: "running" as const,
                startedAt: Date.now(),
                finishedAt: undefined,
                exitCode: undefined,
                cpuPercent: 2 + Math.random() * 8,
                memoryMB: Math.max(8, c.memoryMB || 16),
                logs: [
                  ...c.logs,
                  {
                    ts: Date.now(),
                    stream: "stdout" as const,
                    text: `started ${c.command.join(" ")}`,
                  },
                ],
              }
            : c,
        ),
        calls: pushCall(s.calls, {
          method: "Container.Start",
          csharp: "container.Start();",
          cli: `wslc container start ${target.name}`,
          result: `started ${target.name}`,
          ok: true,
        }),
      };
    });
  },

  stopContainer: (id) => {
    set((s) => {
      const target = s.containers.find((c) => c.id === id);
      if (!target) return s;
      return {
        containers: s.containers.map((c) =>
          c.id === id
            ? {
                ...c,
                status: "exited" as const,
                cpuPercent: 0,
                exitCode: 0,
                finishedAt: Date.now(),
                logs: [
                  ...c.logs,
                  {
                    ts: Date.now(),
                    stream: "stderr" as const,
                    text: "received SIGTERM",
                  },
                ],
              }
            : c,
        ),
        calls: pushCall(s.calls, {
          method: "Container.Stop",
          csharp: csharpStop(target),
          cli: `wslc container stop ${target.name}`,
          result: `stopped ${target.name}`,
          ok: true,
        }),
      };
    });
  },

  restartContainer: (id) => {
    get().stopContainer(id);
    window.setTimeout(() => get().startContainer(id), 420);
  },

  deleteContainer: (id) => {
    const target = get().containers.find((c) => c.id === id);
    if (!target) return;
    set((s) => ({
      containers: s.containers.filter((c) => c.id !== id),
      selectedId: s.selectedId === id ? null : s.selectedId,
      inspectOpen: s.selectedId === id ? false : s.inspectOpen,
      calls: pushCall(s.calls, {
        method: "Container.Delete",
        csharp: csharpDelete(target),
        cli: `wslc container rm ${target.name}`,
        result: `removed ${target.name}`,
        ok: true,
      }),
    }));
  },

  appendExec: (id, command, output) => {
    const target = get().containers.find((c) => c.id === id);
    if (!target) return;
    set((s) => ({
      containers: s.containers.map((c) =>
        c.id === id
          ? {
              ...c,
              logs: [
                ...c.logs,
                { ts: Date.now(), stream: "stdout" as const, text: `# ${command}` },
                { ts: Date.now() + 1, stream: "stdout" as const, text: output },
              ].slice(-200),
            }
          : c,
      ),
      calls: pushCall(s.calls, {
        method: "Container.CreateProcess",
        csharp: csharpExec(target.name, command),
        cli: `wslc exec ${target.name} ${command}`,
        result: "process exited 0",
        ok: true,
      }),
    }));
  },

  createVolume: (name) => {
    const n = name.trim().replace(/\s+/g, "-");
    if (!n) return;
    if (get().volumes.some((v) => v.name === n)) return;
    set((s) => ({
      volumes: [
        {
          name: n,
          driver: "wslc",
          mountpoint: `/var/lib/wslc/volumes/${n}`,
          sizeMB: 0,
          createdAt: Date.now(),
          inUse: false,
        },
        ...s.volumes,
      ],
      calls: pushCall(s.calls, {
        method: "Session.CreateVolume",
        csharp: `session.CreateVolume(new VolumeSettings("${n}"));`,
        cli: `wslc volume create ${n}`,
        result: `volume ${n}`,
        ok: true,
      }),
    }));
  },

  deleteVolume: (name) => {
    const vol = get().volumes.find((v) => v.name === name);
    if (!vol) return;
    if (vol.inUse) {
      set((s) => ({
        calls: pushCall(s.calls, {
          method: "Session.RemoveVolume",
          csharp: `session.RemoveVolume("${name}");`,
          cli: `wslc volume rm ${name}`,
          result: "conflict: volume is in use",
          ok: false,
        }),
      }));
      return;
    }
    set((s) => ({
      volumes: s.volumes.filter((v) => v.name !== name),
      calls: pushCall(s.calls, {
        method: "Session.RemoveVolume",
        csharp: `session.RemoveVolume("${name}");`,
        cli: `wslc volume rm ${name}`,
        result: `removed ${name}`,
        ok: true,
      }),
    }));
  },

  resetLab: () => set({ ...labState() }),
  enterLab: () => set({ ...labState() }),
  retryProbe: async () => {
    set({ gate: "checking", probeNote: "Looking for wslc.exe…" });
    const result = await checkHost();
    if (result.wslc) {
      set({
        view: "dashboard",
        gate: "ready",
        probeNote: result.note,
        wslcOnPath: true,
        sidecarUp: result.sidecar,
        session: {
          ...emptySession([]),
          running: true,
          startedAt: Date.now(),
          version: result.version ?? "wslc",
          wslVersion: result.version ?? "2.9.3+",
        },
        containers: [],
        images: [],
        volumes: [],
        calls: [
          {
            id: rid("call-"),
            at: Date.now(),
            method: "WslcService.GetMissingComponents",
            csharp: csharpSessionStart(seedSession),
            cli: "wslc version",
            result: result.note,
            ok: true,
          },
        ],
        pulls: [],
        selectedId: null,
        inspectOpen: false,
        metrics: idleMetrics(),
        now: Date.now(),
      });
      return;
    }
    set({
      gate: "missing",
      probeNote: result.note,
      wslcOnPath: false,
      sidecarUp: result.sidecar,
      session: emptySession(result.missing),
    });
  },
}));

export function selectedContainer() {
  const { containers, selectedId } = useWslc.getState();
  return containers.find((c) => c.id === selectedId) ?? null;
}
