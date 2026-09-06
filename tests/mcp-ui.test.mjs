import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), "utf8");
}

test("settings exposes local MCP controls without raw exec capability", async () => {
  const settings = await source("src/components/views/session-view.tsx");
  const bridge = await source("src/lib/mcp.ts");
  assert.match(settings, /MCP server/);
  assert.match(settings, /mcpSetEnabled/);
  assert.match(settings, /mcpSetPort/);
  assert.match(settings, /127\.0\.0\.1/);
  assert.match(settings, /MCP 2026-07-28/);
  assert.doesNotMatch(settings + bridge, /quay\.exec|raw shell tool\s*:/i);
});

test("app shell mounts one-shot MCP confirmation dialog and advances stale requests", async () => {
  const shell = await source("src/components/app-shell.tsx");
  const dialog = await source("src/components/mcp-confirmation-dialog.tsx");
  const bridge = await source("src/lib/mcp.ts");
  assert.match(shell, /<McpConfirmationDialog \/>/);
  assert.match(dialog, /onMcpConfirmationRequested/);
  assert.match(bridge, /mcp:\/\/confirmation-requested/);
  assert.match(dialog, /mcpConfirm/);
  assert.match(dialog, /showNextPending/);
  assert.match(dialog, /catch \(error\)[\s\S]*showNextPending/);
  assert.match(dialog, /Approve once/);
  assert.match(dialog, /Reject/);
});

test("Rust bridge registers MCP lifecycle and Cube dispatch", async () => {
  const backend = await source("src-tauri/src/lib.rs");
  const commands = await source("src-tauri/src/mcp/commands.rs");
  const modules = await source("src-tauri/src/mcp/mod.rs");
  const server = await source("src-tauri/src/mcp/server.rs");
  assert.match(backend, /mcp::commands::mcp_get_status/);
  assert.match(backend, /mcp::commands::mcp_set_enabled/);
  assert.match(backend, /mcp::commands::mcp_set_port/);
  assert.match(backend, /mcp::commands::mcp_confirm/);
  assert.match(commands, /McpRuntime::start/);
  assert.match(modules, /pub mod cube_tools/);
  assert.match(server, /cube_tools::dispatch/);
  assert.match(server, /cube_tools::dispatch_destructive/);
});
