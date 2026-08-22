import { applyStackConfig } from "@/components/stack-config-dialog";
import { invokeWslcHost } from "@/lib/tauri";
import type { Container, ContainerGroup, RunSpec } from "./types";

function nativeName(group: ContainerGroup, spec: RunSpec): string {
  if (group.id === "local-coding" && spec.image.startsWith("ngrok/ngrok")) {
    return "local-coding-mcp-ngrok";
  }
  return spec.name;
}

function argsForSpec(group: ContainerGroup, spec: RunSpec, network: string): string[] {
  const args = ["run"];
  if (spec.detach) args.push("-d");

  const name = nativeName(group, spec);
  if (name) args.push("--name", name);
  if (network) args.push("--network", network);
  if (spec.gpu) args.push("--gpus", "all");
  if (spec.workdir) args.push("-w", spec.workdir);

  for (const port of spec.ports.split(",").map((x) => x.trim()).filter(Boolean)) {
    args.push("-p", port);
  }
  for (const env of spec.env.split("\n").map((x) => x.trim()).filter(Boolean)) {
    args.push("-e", env);
  }
  for (const mount of spec.mounts.split("\n").map((x) => x.trim()).filter(Boolean)) {
    args.push("-v", mount);
  }

  args.push(spec.image);
  if (spec.command.trim()) args.push(...spec.command.trim().split(/\s+/));
  return args;
}

function matchesName(line: string, name: string) {
  const lower = line.toLowerCase();
  const target = name.toLowerCase();
  return lower.includes(target) || lower.includes(target.slice(0, Math.min(16, target.length)));
}

async function listCli(all = true) {
  const result = await invokeWslcHost({
    cmd: "run_cli",
    args: all ? ["container", "list", "--all"] : ["container", "list"],
  });
  if (!result.ok) throw new Error(result.error || "Could not list WSLC containers");
  return result.output ?? "";
}

function parsePorts(spec: RunSpec) {
  return spec.ports
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean)
    .map((value) => {
      const [host, container] = value.split(":").map(Number);
      return { host, container, protocol: "tcp" as const };
    })
    .filter((p) => Number.isFinite(p.host) && Number.isFinite(p.container));
}

function parseEnv(spec: RunSpec) {
  return Object.fromEntries(
    spec.env
      .split("\n")
      .map((x) => x.trim())
      .filter(Boolean)
      .map((line) => {
        const i = line.indexOf("=");
        return i < 0 ? [line, ""] : [line.slice(0, i), line.slice(i + 1)];
      }),
  );
}

export async function readNativeGroup(group: ContainerGroup): Promise<Container[]> {
  applyStackConfig(group);
  const output = await listCli(true);
  const lines = output.split(/\r?\n/).filter(Boolean);

  return group.specs.flatMap((spec) => {
    const name = nativeName(group, spec);
    const line = lines.find((x) => matchesName(x, name));
    if (!line) return [];

    const parts = line.trim().split(/\s+/);
    const status = /\brunning\b/i.test(line) ? "running" as const : "exited" as const;
    return [{
      id: parts[0] ?? name,
      name,
      image: spec.image,
      status,
      createdAt: Date.now(),
      startedAt: status === "running" ? Date.now() : undefined,
      ports: parsePorts(spec),
      mounts: [],
      env: parseEnv(spec),
      gpu: spec.gpu,
      cpuPercent: 0,
      memoryMB: 0,
      memoryLimitMB: 0,
      command: spec.command.trim() ? spec.command.trim().split(/\s+/) : [],
      workdir: spec.workdir || "/",
      user: "",
      logs: [],
      groupId: group.id,
    }];
  });
}

async function stopByName(name: string) {
  const result = await invokeWslcHost({
    cmd: "run_cli",
    args: ["container", "stop", name],
  });

  if (
    !result.ok &&
    !result.error?.toLowerCase().includes("not found") &&
    !result.error?.toLowerCase().includes("no such")
  ) {
    throw new Error(result.error || `Could not stop ${name}`);
  }
}

export async function runNativeStack(group: ContainerGroup): Promise<Container[]> {
  applyStackConfig(group);
  const network = group.id === "local-coding" ? "mcp-net" : `${group.id}-net`;

  const networkResult = await invokeWslcHost({
    cmd: "ensure_network",
    name: network,
  });
  if (!networkResult.ok) {
    throw new Error(networkResult.error || `Could not create network ${network}`);
  }

  await stopNativeStack(group);

  for (const spec of group.specs) {
    const name = nativeName(group, spec);
    const result = await invokeWslcHost({
      cmd: "run_cli",
      args: argsForSpec(group, spec, network),
    });
    if (!result.ok) {
      throw new Error(result.error || `Could not start ${name}`);
    }

    const running = await listCli(false);
    if (!running.split(/\r?\n/).some((line) => matchesName(line, name))) {
      const all = await listCli(true);
      const detail = all.split(/\r?\n/).find((line) => matchesName(line, name));
      throw new Error(
        detail
          ? `${name} was created but is not running: ${detail}`
          : `${name} did not appear in WSLC after start`,
      );
    }
  }

  return readNativeGroup(group);
}

export async function stopNativeStack(group: ContainerGroup): Promise<Container[]> {
  const names = [...group.specs]
    .reverse()
    .map((spec) => nativeName(group, spec));

  if (group.id === "local-coding") names.push("ngrok");

  for (const name of [...new Set(names)].filter(Boolean)) {
    await stopByName(name);
  }

  return readNativeGroup(group);
}
