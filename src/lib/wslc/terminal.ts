import { invokeWslcHost } from "@/lib/tauri";
import type { Container } from "./types";

export interface ContainerExecResult {
  ok: boolean;
  output: string;
  exitCode?: number;
  command?: string;
}

function terminalError(output: string, exitCode?: number) {
  const lower = output.toLowerCase();
  const shellMissing =
    (lower.includes("sh") && lower.includes("not found")) ||
    lower.includes("executable file not found") ||
    lower.includes("no such file or directory");

  if (shellMissing) {
    return "This container does not appear to provide /bin/sh. Quay Terminal currently requires a POSIX shell; distroless/scratch images may not support terminal commands.";
  }

  return output || `Command failed with exit code ${exitCode ?? "?"}`;
}

export async function execInContainer(
  container: Container,
  raw: string,
): Promise<ContainerExecResult> {
  const command = raw.trim();
  if (!command) return { ok: true, output: "" };

  const result = await invokeWslcHost({
    cmd: "run_cli",
    args: ["exec", container.name, "sh", "-lc", command],
  });

  const output = (result.output || result.error || "").trim();
  return {
    ok: result.ok,
    output: result.ok ? output : terminalError(output, result.exitCode),
    exitCode: result.exitCode,
    command: result.command,
  };
}
