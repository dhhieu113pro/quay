import { applyStackConfig } from "@/components/stack-config-dialog";
import { invokeWslcHost, type WslcInvokeResult } from "@/lib/tauri";
import type {
  Container,
  ContainerGroup,
  ContainerStatus,
  LogLine,
  Mount,
  RunSpec,
} from "./types";

type SdkLog = {
  ts?: number;
  Ts?: number;
  stream?: string;
  Stream?: string;
  text?: string;
  Text?: string;
};

type SdkContainer = {
  id: string;
  name: string;
  image: string;
  status?: string;
  createdAt?: number;
  startedAt?: number | null;
  finishedAt?: number | null;
  exitCode?: number | null;
  ports?: string;
  mounts?: string;
  env?: string;
  gpu?: boolean;
  command?: string[];
  workdir?: string;
  bridgeIp?: string | null;
  logs?: SdkLog[];
};

type SdkResult = WslcInvokeResult & {
  container?: SdkContainer;
  containers?: SdkContainer[];
};

function nativeName(group: ContainerGroup, spec: RunSpec): string {
  if (group.id === "local-coding" && spec.image.startsWith("ngrok/ngrok")) {
    return "local-coding-mcp-ngrok";
  }
  return spec.name;
}

function normalizeStatus(value?: string): ContainerStatus {
  const status = (value ?? "").toLowerCase();
  if (status.includes("running") || status.includes("started")) return "running";
  if (status.includes("paused")) return "paused";
  if (status.includes("created")) return "created";
  if (status.includes("removing")) return "removing";
  return "exited";
}

function parsePorts(value: string) {
  return value
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean)
    .map((item) => {
      const [host, container] = item.split(":").map(Number);
      return { host, container, protocol: "tcp" as const };
    })
    .filter((x) => Number.isFinite(x.host) && Number.isFinite(x.container));
}

function parseMounts(value: string): Mount[] {
  return value
    .split("\n")
    .map((x) => x.trim())
    .filter(Boolean)
    .flatMap((item) => {
      const modeAt = item.lastIndexOf(":");
      if (modeAt <= 0) return [];
      const mode = item.slice(modeAt + 1).toLowerCase() === "ro" ? "ro" as const : "rw" as const;
      const paths = item.slice(0, modeAt);
      const destinationAt = paths.lastIndexOf(":");
      if (destinationAt <= 0) return [];
      return [{
        source: paths.slice(0, destinationAt),
        destination: paths.slice(destinationAt + 1),
        mode,
      }];
    });
}

function parseEnv(value: string) {
  return Object.fromEntries(
    value
      .split("\n")
      .map((x) => x.trim())
      .filter(Boolean)
      .map((line) => {
        const i = line.indexOf("=");
        return i < 0 ? [line, ""] : [line.slice(0, i), line.slice(i + 1)];
      }),
  );
}

function parseLogs(logs?: SdkLog[]): LogLine[] {
  return (logs ?? []).map((line) => ({
    ts: line.ts ?? line.Ts ?? Date.now(),
    stream: (line.stream ?? line.Stream) === "stderr" ? "stderr" : "stdout",
    text: line.text ?? line.Text ?? "",
  }));
}

function toContainer(group: ContainerGroup, record: SdkContainer): Container {
  return {
    id: record.id,
    name: record.name,
    image: record.image,
    status: normalizeStatus(record.status),
    createdAt: record.createdAt ?? Date.now(),
    startedAt: record.startedAt ?? undefined,
    finishedAt: record.finishedAt ?? undefined,
    ports: parsePorts(record.ports ?? ""),
    mounts: parseMounts(record.mounts ?? ""),
    env: parseEnv(record.env ?? ""),
    gpu: Boolean(record.gpu),
    cpuPercent: 0,
    memoryMB: 0,
    memoryLimitMB: 0,
    command: record.command ?? [],
    workdir: record.workdir || "/",
    user: "",
    exitCode: record.exitCode ?? undefined,
    logs: parseLogs(record.logs),
    groupId: group.id,
  };
}

async function sdkPs(): Promise<SdkContainer[]> {
  const result = await invokeWslcHost({ cmd: "ps" }) as SdkResult;
  if (!result.ok) throw new Error(result.error || "Could not read Quay SDK containers");
  return result.containers ?? [];
}

export async function readNativeGroup(group: ContainerGroup): Promise<Container[]> {
  applyStackConfig(group);
  const names = new Set(group.specs.map((spec) => nativeName(group, spec)));
  const records = await sdkPs();
  return records
    .filter((record) => names.has(record.name))
    .map((record) => toContainer(group, record));
}

async function runSpec(group: ContainerGroup, spec: RunSpec) {
  const name = nativeName(group, spec);
  const result = await invokeWslcHost({
    cmd: "run",
    image: spec.image,
    name,
    command: spec.command,
    ports: spec.ports,
    env: spec.env,
    mounts: spec.mounts,
    gpu: spec.gpu,
    remove: false,
    workdir: spec.workdir,
  }) as SdkResult;

  if (!result.ok) {
    throw new Error(result.error || `Could not start ${name} with Microsoft.WSL.Containers`);
  }

  const record = result.container;
  if (!record || normalizeStatus(record.status) !== "running") {
    throw new Error(`${name} was created by the WSLC SDK but is not running.`);
  }
}

export async function runNativeStack(group: ContainerGroup): Promise<Container[]> {
  applyStackConfig(group);
  const started: string[] = [];

  try {
    for (const spec of group.specs) {
      const name = nativeName(group, spec);
      await runSpec(group, spec);
      started.push(name);
    }
  } catch (error) {
    for (const name of started.reverse()) {
      try {
        await invokeWslcHost({ cmd: "stop", id: name });
      } catch {
        // Preserve the original start failure.
      }
    }
    throw error;
  }

  return readNativeGroup(group);
}

export async function stopNativeStack(group: ContainerGroup): Promise<Container[]> {
  const existing = await sdkPs();
  const existingNames = new Set(existing.map((x) => x.name));
  const names = [...group.specs]
    .reverse()
    .map((spec) => nativeName(group, spec));

  for (const name of [...new Set(names)].filter(Boolean)) {
    if (!existingNames.has(name)) continue;
    const result = await invokeWslcHost({ cmd: "stop", id: name });
    if (!result.ok) throw new Error(result.error || `Could not stop ${name}`);
  }

  return readNativeGroup(group);
}
