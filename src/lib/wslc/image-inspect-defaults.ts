export type ImageHealthcheck = {
  test: string[];
  intervalMs: number;
  timeoutMs: number;
  retries: number;
  startPeriodMs: number;
};

export type ImageOciLabels = {
  title?: string;
  description?: string;
  version?: string;
  source?: string;
  vendor?: string;
};

export type ImageInspectDefaults = {
  env: Record<string, string>;
  exposedPorts: string[];
  workingDir: string;
  entrypoint: string[];
  cmd: string[];
  volumes: string[];
  labels?: ImageOciLabels;
  healthcheck?: ImageHealthcheck;
};

export type ImageInspectLoader = (reference: string) => Promise<string | null | undefined>;

export type ImageMountRow = {
  id: string;
  source: string;
  destination: string;
  mode: "rw" | "ro";
};

export type PublishedPortRow = {
  hostPort: string;
  containerPort: string;
  protocol: "tcp" | "udp";
};

const NOISY_ENV_KEYS = new Set(["PATH", "HOME", "HOSTNAME", "PWD", "SHLVL", "TERM", "_"]);
const OCI_LABELS = {
  "org.opencontainers.image.title": "title",
  "org.opencontainers.image.description": "description",
  "org.opencontainers.image.version": "version",
  "org.opencontainers.image.source": "source",
  "org.opencontainers.image.vendor": "vendor",
} as const;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function stringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item)).filter(Boolean);
  if (typeof value === "string" && value.trim()) return [value.trim()];
  return [];
}

function envDefaults(value: unknown) {
  const entries = Array.isArray(value) ? value : [];
  const env: Record<string, string> = {};
  for (const item of entries) {
    if (typeof item !== "string") continue;
    const eq = item.indexOf("=");
    const key = (eq === -1 ? item : item.slice(0, eq)).trim();
    if (!key || NOISY_ENV_KEYS.has(key.toUpperCase())) continue;
    env[key] = eq === -1 ? "" : item.slice(eq + 1);
  }
  return env;
}

function portList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  const ports = record(value);
  return ports ? Object.keys(ports) : [];
}

function volumeList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  const volumes = record(value);
  return volumes ? Object.keys(volumes) : [];
}

function imageLabels(value: unknown): ImageOciLabels | undefined {
  const labels = record(value);
  if (!labels) return undefined;
  const result: ImageOciLabels = {};
  for (const [source, target] of Object.entries(OCI_LABELS)) {
    const raw = labels[source];
    if (raw === undefined || raw === null) continue;
    const text = String(raw).trim();
    if (text) result[target] = text;
  }
  return Object.keys(result).length ? result : undefined;
}

function durationMs(value: unknown) {
  const nanoseconds = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(nanoseconds) && nanoseconds > 0 ? Math.round(nanoseconds / 1_000_000) : 0;
}

function imageHealthcheck(value: unknown): ImageHealthcheck | undefined {
  const healthcheck = record(value);
  if (!healthcheck) return undefined;
  const test = stringList(healthcheck.Test ?? healthcheck.test);
  if (!test.length || (test.length === 1 && test[0]?.toUpperCase() === "NONE")) return undefined;
  const retriesValue = Number(healthcheck.Retries ?? healthcheck.retries ?? 0);
  return {
    test,
    intervalMs: durationMs(healthcheck.Interval ?? healthcheck.interval),
    timeoutMs: durationMs(healthcheck.Timeout ?? healthcheck.timeout),
    retries: Number.isFinite(retriesValue) && retriesValue > 0 ? Math.trunc(retriesValue) : 0,
    startPeriodMs: durationMs(healthcheck.StartPeriod ?? healthcheck.startPeriod ?? healthcheck.start_period),
  };
}

export function parseImageInspect(raw: string | unknown): ImageInspectDefaults {
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    try { parsed = JSON.parse(raw); }
    catch { return { env: {}, exposedPorts: [], workingDir: "", entrypoint: [], cmd: [], volumes: [] }; }
  }
  if (Array.isArray(parsed)) parsed = parsed[0] ?? {};
  const root = record(parsed) ?? {};
  const config = record(root.Config) ?? record(root.config) ?? root;
  return {
    env: envDefaults(config.Env ?? config.env),
    exposedPorts: portList(config.ExposedPorts ?? config.exposedPorts ?? config.exposed_ports),
    workingDir: String(config.WorkingDir ?? config.workingDir ?? config.working_dir ?? ""),
    entrypoint: stringList(config.Entrypoint ?? config.entrypoint),
    cmd: stringList(config.Cmd ?? config.cmd),
    volumes: volumeList(config.Volumes ?? config.volumes),
    labels: imageLabels(config.Labels ?? config.labels),
    healthcheck: imageHealthcheck(config.Healthcheck ?? config.healthcheck),
  };
}

function parseEnv(raw: string) {
  const values = new Map<string, string>();
  for (const line of raw.split("\n").map((item) => item.trimEnd()).filter(Boolean)) {
    const eq = line.indexOf("=");
    values.set(eq === -1 ? line : line.slice(0, eq), eq === -1 ? "" : line.slice(eq + 1));
  }
  return values;
}

function publishedPort(exposed: string) {
  const [port, protocol = "tcp"] = exposed.split("/");
  if (!port) return "";
  return protocol.toLowerCase() === "udp" ? `${port}:${port}/udp` : `${port}:${port}`;
}

function splitPublishedPort(binding: string): PublishedPortRow | null {
  const trimmed = binding.trim();
  if (!trimmed) return null;
  const slash = trimmed.lastIndexOf("/");
  const mapping = slash === -1 ? trimmed : trimmed.slice(0, slash);
  const protocolText = slash === -1 ? "tcp" : trimmed.slice(slash + 1).trim().toLowerCase();
  const parts = mapping.split(":").map((part) => part.trim());
  const containerPort = parts.pop() ?? "";
  const hostPort = parts.pop() ?? containerPort;
  if (!containerPort) return null;
  return {
    hostPort,
    containerPort,
    protocol: protocolText === "udp" ? "udp" : "tcp",
  };
}

export function publishedPortRows(raw: string): PublishedPortRow[] {
  return raw.split(",").map(splitPublishedPort).filter((row): row is PublishedPortRow => Boolean(row));
}

export function updatePublishedHostPort(raw: string, index: number, hostPort: string) {
  const bindings = raw.split(",").map((binding) => binding.trim()).filter(Boolean);
  const target = bindings[index];
  if (!target) return raw;

  const slash = target.lastIndexOf("/");
  const mapping = slash === -1 ? target : target.slice(0, slash);
  const suffix = slash === -1 ? "" : target.slice(slash);
  const parts = mapping.split(":");
  if (parts.length === 1) parts.unshift(hostPort.trim());
  else parts[parts.length - 2] = hostPort.trim();
  bindings[index] = `${parts.join(":")}${suffix}`;
  return bindings.join(",");
}

export function applyImageInspectDefaults<T extends { env: string; ports: string; workdir: string }>(spec: T, inspect: ImageInspectDefaults): T {
  const env = parseEnv(spec.env);
  for (const [key, value] of Object.entries(inspect.env)) if (!env.has(key)) env.set(key, value);
  const mergedEnv = Array.from(env, ([key, value]) => `${key}=${value}`).join("\n");
  const ports = spec.ports.trim() || inspect.exposedPorts.map(publishedPort).filter(Boolean).join(",");
  const workdir = spec.workdir.trim() && spec.workdir.trim() !== "/" ? spec.workdir : (inspect.workingDir.trim() || spec.workdir);
  return { ...spec, env: mergedEnv, ports, workdir };
}

export function imageCommandSuggestion(inspect: ImageInspectDefaults | null) {
  if (!inspect) return "";
  return [...inspect.entrypoint, ...inspect.cmd].map((part) => part.trim()).filter(Boolean).join(" ");
}

export function applyImageCommandSuggestion(currentCommand: string, inspect: ImageInspectDefaults | null) {
  return currentCommand.trim() ? currentCommand : imageCommandSuggestion(inspect);
}

export function imageVolumeSuggestions(inspect: ImageInspectDefaults | null) {
  return inspect ? Array.from(new Set(inspect.volumes.map((volume) => volume.trim()).filter(Boolean))) : [];
}

export function addImageVolumeMount<T extends ImageMountRow>(rows: T[], source: string, destination: string): T[] {
  const hostSource = source.trim();
  const containerDestination = destination.trim();
  if (!hostSource || !containerDestination || rows.some((row) => row.destination.trim() === containerDestination)) return rows;
  return [...rows, {
    id: Math.random().toString(16).slice(2, 10),
    source: hostSource,
    destination: containerDestination,
    mode: "rw",
  } as T];
}

export function imageReadinessMetadata(inspect: ImageInspectDefaults | null) {
  return {
    ...(inspect?.labels ?? {}),
    healthcheck: inspect?.healthcheck,
  };
}

export function imageInspectEnvSourceByKey(inspect: ImageInspectDefaults | null) {
  return inspect ? Object.fromEntries(Object.keys(inspect.env).map((key) => [key, "Image default" as const])) : {};
}

export const imageInspectCache = new Map<string, ImageInspectDefaults>();
const imageInspectInFlight = new Map<string, Promise<ImageInspectDefaults | null>>();

export async function inspectImage(reference: string, load: ImageInspectLoader): Promise<ImageInspectDefaults | null> {
  const key = reference.trim();
  if (!key) return null;
  const cached = imageInspectCache.get(key);
  if (cached) return cached;
  const pending = imageInspectInFlight.get(key);
  if (pending) return pending;
  const request = (async () => {
    try {
      const raw = await load(key);
      if (!raw?.trim()) return null;
      const parsed = parseImageInspect(raw);
      imageInspectCache.set(key, parsed);
      return parsed;
    } catch {
      return null;
    } finally {
      imageInspectInFlight.delete(key);
    }
  })();
  imageInspectInFlight.set(key, request);
  return request;
}