import type {
  AuditEvent,
  AuditQuery,
  ContainerLogQuery,
  ContainerLogRecord,
  ContainerLogTarget,
  ContainerLogWrite,
  ImageSearchResult,
  LegacyImportResult,
  LegacyOperationLogInput,
  PullJob,
  StorageStats,
} from "@/lib/wslc/types";

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

export async function queryAudit(query: AuditQuery = {}): Promise<AuditEvent[]> {
  if (!isTauri()) return [];
  return invokeNative<AuditEvent[]>("audit_query", { query });
}

export async function clearAudit(): Promise<number> {
  if (!isTauri()) return 0;
  return invokeNative<number>("audit_clear");
}

export async function appendContainerLogs(lines: ContainerLogWrite[]): Promise<number> {
  if (!lines.length || !isTauri()) return 0;
  return invokeNative<number>("container_logs_append", { lines });
}

export async function queryContainerLogs(query: ContainerLogQuery = {}): Promise<ContainerLogRecord[]> {
  if (!isTauri()) return [];
  return invokeNative<ContainerLogRecord[]>("container_logs_query", { query });
}

export async function listContainerLogTargets(): Promise<ContainerLogTarget[]> {
  if (!isTauri()) return [];
  return invokeNative<ContainerLogTarget[]>("container_log_targets");
}

export async function clearContainerLogs(): Promise<number> {
  if (!isTauri()) return 0;
  return invokeNative<number>("container_logs_clear");
}

export async function cleanupContainerLogs(nowMs = Date.now()): Promise<number> {
  if (!isTauri()) return 0;
  return invokeNative<number>("container_logs_cleanup", { nowMs });
}

export async function getStorageStats(): Promise<StorageStats> {
  if (!isTauri()) {
    return { available: false, databaseBytes: 0, auditRows: 0, containerLogRows: 0, containerLogPayloadBytes: 0 };
  }
  return invokeNative<StorageStats>("storage_stats");
}

export async function importLegacyOperationLogs(entries: LegacyOperationLogInput[]): Promise<LegacyImportResult> {
  if (!isTauri()) return { imported: 0, alreadyImported: false };
  return invokeNative<LegacyImportResult>("legacy_operation_logs_import", { entries });
}

function lifecycleArgs(payload: Record<string, unknown>): string[] {
  return payload.cmd === "run_cli" && Array.isArray(payload.args)
    ? payload.args.map((arg) => String(arg))
    : [];
}

function destructiveLifecycleContainer(payload: Record<string, unknown>): string {
  const args = lifecycleArgs(payload);
  if (args[0] !== "container") return "";
  if (args[1] !== "stop" && args[1] !== "restart" && args[1] !== "rm") return "";
  return args.at(-1)?.trim() ?? "";
}

function failedLifecycleContainer(payload: Record<string, unknown>): string {
  const args = lifecycleArgs(payload);
  if (args[0] === "container" && args[1] === "start") return args.at(-1)?.trim() ?? "";
  if (args[0] !== "run") return "";
  const nameIndex = args.findIndex((arg) => arg === "--name" || arg === "-n");
  return nameIndex >= 0 ? args[nameIndex + 1]?.trim() ?? "" : "";
}

async function bestEffortLogDrain(containerName: string) {
  if (!containerName) return;
  try {
    const { drainContainerLogs } = await import("@/lib/wslc/log-store");
    await drainContainerLogs(containerName);
  } catch {
    // Container lifecycle must continue even when log capture/storage is unavailable.
  }
}

export async function invokeWslcHost(payload: Record<string, unknown>): Promise<WslcInvokeResult> {
  if (!isTauri()) return { ok: true, output: "browser lab" };
  const containerName = destructiveLifecycleContainer(payload);
  const failureContainerName = failedLifecycleContainer(payload);
  if (containerName) await bestEffortLogDrain(containerName);
  const result = await invokeNative<WslcInvokeResult>("wslc_invoke", { payload });
  if (containerName) await bestEffortLogDrain(containerName);
  if (!result.ok && failureContainerName) await bestEffortLogDrain(failureContainerName);
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
  try {
    const enabled = Boolean(await invokeNative<boolean>("autostart_enabled"));
    if (enabled) {
      try { await invokeNative<boolean>("autostart_set", { enabled: true }); }
      catch { /* preserve enabled state if the migration rewrite fails */ }
    }
    return enabled;
  } catch { return loadLaunchFallback(); }
}

export async function setLaunchAtSignIn(enabled: boolean): Promise<boolean> {
  saveLaunchFallback(enabled);
  if (!isTauri()) return enabled;
  return Boolean(await invokeNative<boolean>("autostart_set", { enabled }));
}

export async function startedAtWindowsSignIn(): Promise<boolean> {
  if (!isTauri()) return false;
  try { return Boolean(await invokeNative<boolean>("windows_sign_in_launch")); }
  catch { return false; }
}

function loadLaunchFallback() {
  try { return localStorage.getItem("quay.launchAtSignIn") === "1"; }
  catch { return false; }
}

function saveLaunchFallback(enabled: boolean) {
  try { localStorage.setItem("quay.launchAtSignIn", enabled ? "1" : "0"); }
  catch { /* ignore */ }
}
