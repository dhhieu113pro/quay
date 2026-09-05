export interface ExistingContainerConfig {
  name: string;
  image: string;
  command: string;
  ports: string;
  env: string;
  mounts: string;
  workdir: string;
  network?: string;
  gpu: boolean;
}

type InspectRecord = Record<string, unknown>;

type ExecResult = { ok: boolean; error?: string; output?: string };

function record(value: unknown): InspectRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? value as InspectRecord : {};
}

function text(value: unknown) {
  return value == null ? "" : String(value);
}

function firstInspectRecord(input: string | unknown): InspectRecord {
  const parsed = typeof input === "string" ? JSON.parse(input) : input;
  if (Array.isArray(parsed)) return record(parsed[0]);
  return record(parsed);
}

export function parseExistingContainerInspect(input: string | unknown): ExistingContainerConfig {
  const root = firstInspectRecord(input);
  const Config = record(root.Config ?? root.config);
  const HostConfig = record(root.HostConfig ?? root.hostConfig);
  const Env = Array.isArray(Config.Env) ? Config.Env.map(text).filter(Boolean) : [];
  const Cmd = Array.isArray(Config.Cmd) ? Config.Cmd.map(text).filter(Boolean) : [];
  const Entrypoint = Array.isArray(Config.Entrypoint) ? Config.Entrypoint.map(text).filter(Boolean) : [];

  const portLines: string[] = [];
  const bindings = record(root.Ports ?? root.ports ?? HostConfig.PortBindings ?? HostConfig.portBindings);
  for (const [containerPort, rawBindings] of Object.entries(bindings)) {
    const [port, protocol = "tcp"] = containerPort.split("/");
    for (const rawBinding of Array.isArray(rawBindings) ? rawBindings : []) {
      const binding = record(rawBinding);
      const hostIp = text(binding.HostIp ?? binding.hostIp).trim();
      const hostPort = text(binding.HostPort ?? binding.hostPort).trim();
      if (hostPort) portLines.push(`${hostIp ? `${hostIp}:` : ""}${hostPort}:${port}${protocol === "udp" ? "/udp" : ""}`);
    }
  }

  const mountLines = (Array.isArray(root.Mounts) ? root.Mounts : []).flatMap((rawMount) => {
    const mount = record(rawMount);
    const source = text(mount.Source ?? mount.source).trim();
    const destination = text(mount.Destination ?? mount.destination).trim();
    const mode = text(mount.Mode ?? mount.mode).trim() || (mount.RW === false ? "ro" : "rw");
    return source && destination ? [`${source}:${destination}:${mode}`] : [];
  });

  const deviceRequests = Array.isArray(HostConfig.DeviceRequests) ? HostConfig.DeviceRequests : [];
  const gpu = deviceRequests.some((request) => JSON.stringify(request).toLowerCase().includes("gpu"));

  return {
    name: text(root.Name ?? root.name).replace(/^\//, ""),
    image: text(Config.Image ?? Config.image ?? root.Image ?? root.image),
    command: [...Entrypoint, ...Cmd].join(" "),
    ports: portLines.join(","),
    env: Env.join("\n"),
    mounts: mountLines.join("\n"),
    workdir: text(Config.WorkingDir ?? Config.workingDir) || "/",
    network: text(HostConfig.NetworkMode ?? HostConfig.networkMode) || undefined,
    gpu,
  };
}

export async function loadExistingContainerConfig(
  name: string,
  inspect: (name: string) => Promise<string | null>,
) {
  const output = await inspect(name);
  if (!output) throw new Error(`Could not inspect ${name}`);
  return parseExistingContainerInspect(output);
}

export function existingContainerRunArgs(config: ExistingContainerConfig, env: string) {
  const args = ["run", "-d", "--name", config.name];
  if (config.gpu) args.push("--gpus", "all");
  if (config.network && config.network !== "default" && config.network !== "bridge") args.push("--network", config.network);
  if (config.workdir.trim()) args.push("-w", config.workdir.trim());
  for (const port of config.ports.split(",").map((value) => value.trim()).filter(Boolean)) args.push("-p", port);
  for (const line of env.split("\n").map((value) => value.trim()).filter(Boolean)) args.push("-e", line);
  for (const mount of config.mounts.split("\n").map((value) => value.trim()).filter(Boolean)) args.push("-v", mount);
  args.push(config.image);
  if (config.command.trim()) args.push(...config.command.trim().split(/\s+/));
  return args;
}

export async function recreateContainerWithEnv(
  config: ExistingContainerConfig,
  env: string,
  wasRunning: boolean,
  execute: (args: string[]) => Promise<ExecResult>,
) {
  const run = async (args: string[]) => {
    const result = await execute(args);
    if (!result.ok) throw new Error(result.error || result.output || `wslc ${args.join(" ")} failed`);
  };

  if (wasRunning) await run(["container", "stop", config.name]);
  await run(["container", "rm", config.name]);
  await run(existingContainerRunArgs(config, env));
  if (!wasRunning) await run(["container", "stop", config.name]);
}
