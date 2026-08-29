import type { ImageSearchResult, PullJob } from "@/lib/wslc/types";
import { appendOperationLog, redactOperationText } from "@/lib/wslc/operation-log";

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function windowAction(kind: "minimize" | "toggleMaximize" | "close") {
  if (!isTauri()) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const win = getCurrentWindow();
  if (kind === "minimize") await win.minimize();
  else if (kind === "toggleMaximize") await win.toggleMaximize();
  else await win.close();
}

export type WslcProbe = {
  wsl: boolean;
  wslVersion: string | null;
  wslc: boolean;
  version: string | null;
};

export type WslcInvokeResult = {
  ok: boolean;
  output?: string;
  error?: string;
  command?: string;
  exitCode?: number;
  stdout?: string;
  stderr?: string;
  cpuCount?: number;
  cpuPercent?: number;
  memoryPercent?: number;
  memoryTotalMB?: number;
  memoryUsedMB?: number;
};

async function invokeNative<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(command, args);
}

export async function imageSearch(query: string): Promise<ImageSearchResult[]> {
  if (!query.trim() || !isTauri()) return [];
  return invokeNative<ImageSearchResult[]>("image_search", { query: query.trim() });
}

export async function pullStart(reference: string): Promise<PullJob> {
  if (!reference.trim()) throw new Error("image reference is empty");
  return invokeNative<PullJob>("pull_start", { reference: reference.trim() });
}

export async function pullList(): Promise<PullJob[]> {
  if (!isTauri()) return [];
  return invokeNative<PullJob[]>("pull_list");
}

export async function pullCancel(id: string): Promise<PullJob> {
  return invokeNative<PullJob>("pull_cancel", { id });
}

export async function pullClearHistory(): Promise<PullJob[]> {
  if (!isTauri()) return [];
  return invokeNative<PullJob[]>("pull_clear_history");
}

export async function onPullJobUpdated(handler: (job: PullJob) => void): Promise<() => void> {
  if (!isTauri()) return () => undefined;
  const { listen } = await import("@tauri-apps/api/event");
  return listen<PullJob>("quay://pull-job-updated", (event) => handler(event.payload));
}

function cliArgs(payload: Record<string, unknown>) {
  return payload.cmd === "run_cli" && Array.isArray(payload.args)
    ? payload.args.map((arg) => String(arg))
    : [];
}

function lifecycleContainerName(args: string[]) {
  if (args[0] === "container" && (args[1] === "start" || args[1] === "restart")) return args.at(-1) ?? "";
  if (args[0] !== "run") return "";
  const nameIndex = args.indexOf("--name");
  return nameIndex >= 0 ? args[nameIndex + 1] ?? "" : "";
}

function lifecycleFailure(args: string[]) {
  return args[0] === "run" || (args[0] === "container" && (args[1] === "start" || args[1] === "restart"));
}

function diagnosticText(result: WslcInvokeResult, args: string[]) {
  const parts = [result.error, result.stderr, result.output]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value));
  if (typeof result.exitCode === "number") parts.push(`exit code ${result.exitCode}`);
  return parts.join("\n") || `wslc ${args.join(" ")} failed`;
}

async function captureLifecycleFailure(args: string[], result: WslcInvokeResult) {
  if (!lifecycleFailure(args)) return;
  const containerName = lifecycleContainerName(args);
  const command = redactOperationText(`wslc ${args.join(" ")}`);
  appendOperationLog({
    containerName: containerName || undefined,
    command,
    text: diagnosticText(result, args),
  });

  if (!containerName || !isTauri()) return;
  try {
    const logs = await invokeNative<WslcInvokeResult>("wslc_invoke", {
      payload: { cmd: "run_cli", args: ["container", "logs", "--tail", "200", containerName] },
    });
    const tail = [logs.output, logs.stderr]
      .map((value) => value?.trim())
      .filter((value): value is string => Boolean(value))
      .join("\n");
    if (tail) {
      appendOperationLog({
        containerName,
        command: `wslc container logs --tail 200 ${containerName}`,
        text: tail,
      });
    }
  } catch {
    // The original start error is already persisted. Missing tail logs are non-fatal.
  }
}

export async function invokeWslcHost(payload: Record<string, unknown>): Promise<WslcInvokeResult> {
  if (!isTauri()) return { ok: true, output: "browser lab" };
  const result = await invokeNative<WslcInvokeResult>("wslc_invoke", { payload });
  const args = cliArgs(payload);
  if (!result.ok && args.length) await captureLifecycleFailure(args, result);
  return result;
}

export async function probeWslc(): Promise<WslcProbe> {
  if (!isTauri()) return { wsl: false, wslVersion: null, wslc: false, version: null };
  const raw = await invokeNative<WslcProbe>("wslc_probe");
  return { wsl: Boolean(raw?.wsl), wslVersion: raw?.wslVersion ?? null, wslc: Boolean(raw?.wslc), version: raw?.version ?? null };
}

export async function ensureHostDirectory(path: string): Promise<void> {
  if (!path.trim() || !isTauri()) return;
  await invokeNative<boolean>("ensure_host_directory", { path });
}

export async function getDefaultWorkspaceRoot(): Promise<string> {
  if (!isTauri()) return "D:\\QuayAppData\\workspace";
  return invokeNative<string>("workspace_default_root");
}

export async function ensureWorkspaceRoot(root: string): Promise<void> {
  if (!isTauri()) return;
  await invokeNative<void>("workspace_ensure", { root });
}

export async function pickWorkspaceRoot(current?: string): Promise<string | null> {
  if (!isTauri()) return null;
  return invokeNative<string | null>("workspace_pick_root", { current: current || null });
}

export async function pickWorkspaceDescendant(root: string, current?: string): Promise<string | null> {
  if (!isTauri()) return null;
  return invokeNative<string | null>("workspace_pick_descendant", { root, current: current || null });
}

export async function openWorkspacePath(root: string, relative?: string): Promise<void> {
  if (!isTauri()) return;
  await invokeNative<void>("workspace_open", { root, relative: relative || null });
}

export async function moveWorkspaceRoot(oldRoot: string, newRoot: string): Promise<void> {
  if (!isTauri()) return;
  await invokeNative<void>("workspace_move_root", { oldRoot, newRoot });
}

export async function moveWorkspaceEntry(root: string, fromRelative: string, toRelative: string): Promise<void> {
  if (!isTauri()) return;
  await invokeNative<void>("workspace_move_entry", { root, fromRelative, toRelative });
}

export async function getLaunchAtSignIn(): Promise<boolean> {
  if (!isTauri()) return loadLaunchFallback();
  try { return Boolean(await invokeNative<boolean>("autostart_enabled")); }
  catch { return loadLaunchFallback(); }
}

export async function setLaunchAtSignIn(enabled: boolean): Promise<boolean> {
  saveLaunchFallback(enabled);
  if (!isTauri()) return enabled;
  return Boolean(await invokeNative<boolean>("autostart_set", { enabled }));
}

function loadLaunchFallback() {
  try { return localStorage.getItem("quay.launchAtSignIn") === "1"; }
  catch { return false; }
}

function saveLaunchFallback(enabled: boolean) {
  try { localStorage.setItem("quay.launchAtSignIn", enabled ? "1" : "0"); }
  catch { /* ignore */ }
}
