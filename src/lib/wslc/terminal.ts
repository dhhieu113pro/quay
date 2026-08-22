import { invokeWslcHost } from "@/lib/tauri";
import type { Container } from "./types";

export interface ContainerExecResult {
  ok: boolean;
  output: string;
  exitCode?: number;
  command?: string;
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
    output: output || (result.ok ? "" : `Command failed with exit code ${result.exitCode ?? "?"}`),
    exitCode: result.exitCode,
    command: result.command,
  };
}
