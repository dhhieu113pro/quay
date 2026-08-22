import { applyStackConfig } from "@/components/stack-config-dialog";
import { invokeWslcHost } from "@/lib/tauri";
import type { ContainerGroup, RunSpec } from "./types";

function argsForSpec(spec: RunSpec, network: string): string[] {
  const args = ["run"];
  if (spec.remove) args.push("--rm");
  if (spec.detach) args.push("-d");
  if (spec.name) args.push("--name", spec.name);
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

  for (const spec of group.specs) {
    const result = await invokeWslcHost({
      cmd: "run_cli",
      args: argsForSpec(spec, network),
    });
    if (!result.ok) {
      throw new Error(result.error || `Could not start ${spec.name}`);
    }
  }
}
