import type { Container, RunSpec, SessionInfo } from "./types";

// Quay invokes wslc.exe through its Rust CLI worker. These helpers format the
// commands shown in the activity UI.
export function csharpSessionStart(session: SessionInfo) {
  return `wslc version
# Session: ${session.name}
# Data: ${session.dataPath}
# CPU: ${session.cpuCount}, memory: ${session.memoryMB} MB`;
}

export function csharpPull(reference: string) {
  const ref = reference.includes("/") ? reference : `docker.io/library/${reference}`;
  return `wslc pull ${ref}`;
}

export function csharpCreateAndStart(spec: RunSpec) {
  return cliForRun(spec);
}

export function csharpStop(container: Pick<Container, "name">) {
  return `wslc stop ${container.name}`;
}

export function csharpDelete(container: Pick<Container, "name">) {
  return `wslc rm ${container.name}`;
}

export function csharpExec(name: string, command: string) {
  return `wslc exec ${name} ${command}`;
}

export function cliForRun(spec: RunSpec) {
  const parts = ["wslc run"];
  if (spec.detach) parts.push("-d");
  if (spec.remove) parts.push("--rm");
  if (spec.gpu) parts.push("--gpus all");
  if (spec.name) parts.push(`--name ${spec.name}`);
  if (spec.workdir) parts.push(`-w ${spec.workdir}`);
  for (const p of spec.ports.split(",").map((s) => s.trim()).filter(Boolean)) parts.push(`-p ${p}`);
  for (const e of spec.env.split("\n").map((s) => s.trim()).filter(Boolean)) parts.push(`-e ${e}`);
  for (const m of spec.mounts.split("\n").map((s) => s.trim()).filter(Boolean)) parts.push(`-v ${m}`);
  parts.push(spec.image);
  if (spec.command.trim()) parts.push(spec.command.trim());
  return parts.join(" ");
}
