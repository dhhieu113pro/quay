import { isTauri } from "@/lib/tauri";
import type { ContainerGroup } from "@/lib/wslc/types";

const GROUPS_KEY = "quay.groups.v1";

export type McpStatus = {
  enabled: boolean;
  running: boolean;
  endpoint: string;
  port: number;
  connectedClients: number;
  pendingConfirmations: number;
};

export type McpConfirmationRequest = {
  id: string;
  tool: string;
  arguments: unknown;
  createdAtMs: number;
  expiresAtMs: number;
};

const FALLBACK_STATUS: McpStatus = {
  enabled: false,
  running: false,
  endpoint: "http://127.0.0.1:47831/mcp",
  port: 47831,
  connectedClients: 0,
  pendingConfirmations: 0,
};

async function invokeMcp<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri()) throw new Error("MCP controls are only available in the Quay desktop app");
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(command, args);
}

export async function mcpGetStatus(): Promise<McpStatus> {
  if (!isTauri()) return FALLBACK_STATUS;
  return invokeMcp<McpStatus>("mcp_get_status");
}
export function mcpSetEnabled(enabled: boolean): Promise<McpStatus> { return invokeMcp<McpStatus>("mcp_set_enabled", { enabled }); }
export function mcpSetPort(port: number): Promise<McpStatus> { return invokeMcp<McpStatus>("mcp_set_port", { port }); }
export function mcpConfirm(id: string, approve: boolean): Promise<void> { return invokeMcp<void>("mcp_confirm", { id, approve }); }
export function mcpSyncCubes(cubes: ContainerGroup[]): Promise<void> { return invokeMcp<void>("mcp_sync_cubes", { cubes }); }

export function applyMcpCubes(cubes: ContainerGroup[]) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(GROUPS_KEY, JSON.stringify(cubes.filter((cube) => !cube.builtIn)));
}

export async function mcpPendingConfirmations(): Promise<McpConfirmationRequest[]> {
  if (!isTauri()) return [];
  return invokeMcp<McpConfirmationRequest[]>("mcp_pending_confirmations");
}

export async function onMcpConfirmationRequested(handler: (request: McpConfirmationRequest) => void): Promise<() => void> {
  if (!isTauri()) return () => {};
  const { listen } = await import("@tauri-apps/api/event");
  return listen<McpConfirmationRequest>("mcp://confirmation-requested", (event) => handler(event.payload));
}

export async function onMcpStatusChanged(handler: (status: McpStatus) => void): Promise<() => void> {
  if (!isTauri()) return () => {};
  const { listen } = await import("@tauri-apps/api/event");
  return listen<McpStatus>("mcp://status-changed", (event) => handler(event.payload));
}

export async function onMcpCubesChanged(handler: (cubes: ContainerGroup[]) => void): Promise<() => void> {
  if (!isTauri()) return () => {};
  const { listen } = await import("@tauri-apps/api/event");
  return listen<ContainerGroup[]>("mcp://cubes-changed", (event) => handler(event.payload));
}
