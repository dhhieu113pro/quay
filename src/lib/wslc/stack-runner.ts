import { applyStackConfig } from "@/components/stack-config-dialog";
import { invokeWslcHost } from "@/lib/tauri";
import type { ContainerGroup, RunSpec } from "./types";

function nativeName(group: ContainerGroup, spec: RunSpec): string {
  if (group.id === "local-coding" && spec.image.startsWith("ngrok/ngrok")) {
    return "local-coding-mcp-ngrok";
  }
  return spec.name;
}

function argsForSpec(group: ContainerGroup, spec: RunSpec, network: string): string[] {
  const args = ["run", "--rm"];
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

export async function runNativeStack(group: ContainerGroup) {
  applyStackConfig(group);
  const network = group.id === "local-coding" ? "mcp-net" : `${group.id}-net`;

  const networkResult = await invokeWslcHost({
    cmd: "ensure_network",
    name: network,
  });
  if (!networkResult.ok) {
    throw new Error(networkResult.error || `Could not create network ${network}`);
  }

  // Clean up stale containers from an earlier run so Start is repeatable.
  await stopNativeStack(group);

  for (const spec of group.specs) {
    const result = await invokeWslcHost({
      cmd: "run_cli",
      args: argsForSpec(group, spec, network),
    });
    if (!result.ok) {
      // Do not leave a half-started group running.
      await stopNativeStack(group);
      throw new Error(result.error || `Could not start ${nativeName(group, spec)}`);
    }
  }
}

export async function stopNativeStack(group: ContainerGroup) {
  const names = [...group.specs]
    .reverse()
    .map((spec) => nativeName(group, spec));

  // Migration cleanup: older Quay builds used the plain `ngrok` name.
  if (group.id === "local-coding") names.push("ngrok");

  for (const name of [...new Set(names)].filter(Boolean)) {
    await stopByName(name);
  }
}
