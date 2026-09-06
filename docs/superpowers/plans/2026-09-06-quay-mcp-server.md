# Quay MCP Server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Quay locally controllable by MCP-capable LLMs and agents through structured, audited container/image/cube tools while Quay remains the authority for WSLC operations.

**Architecture:** Embed an MCP 2026-07-28 Streamable HTTP server in the Rust/Tauri process, bound to `127.0.0.1`, and route all tool calls through a shared `QuayOperations` application service that also backs the existing Tauri bridge. A policy/confirmation layer blocks destructive actions until a one-shot UI approval is received; no generic shell or raw `wslc` tool is registered.

**Tech Stack:** Rust 2021, Tauri 2, official `rmcp` 3.x Rust SDK, Tokio, serde/serde_json, rusqlite, React 19, TypeScript, existing Node test harness.

**Spec:** `docs/superpowers/specs/2026-09-06-quay-mcp-server-design.md`

## Global Constraints

- Target stable MCP protocol revision `2026-07-28`; use official `rmcp` 3.x and preserve its compatibility with older supported revisions.
- MCP transport is Streamable HTTP and binds only to loopback (`127.0.0.1`) in v1; reject non-loopback configuration.
- MCP is disabled by default until explicitly enabled in Quay settings.
- No generic `quay.exec`, PowerShell, shell, or raw `wslc` passthrough tool in v1.
- Existing WSLC/backend validation and execution paths remain authoritative; MCP must not implement a second container runtime path.
- Read-only and ordinary state-changing tools may execute when MCP is enabled; destructive and high-impact bulk operations require explicit one-shot human confirmation.
- Every MCP invocation is audited; environment values and other secrets are redacted before persistence or tool-result logging.
- Use TDD for production behavior: write a failing test, observe the expected failure, add minimal implementation, then rerun the focused and regression tests.
- Windows remains the runtime platform for WSLC operations; non-Windows builds must continue compiling through existing `#[cfg(windows)]` boundaries.

---

## File Structure

New Rust modules are deliberately small and responsibility-focused:

- `src-tauri/src/operations/mod.rs` — shared application service and normalized `OperationError`; owns the single path from adapters to WSLC/pull/storage services.
- `src-tauri/src/mcp/mod.rs` — MCP subsystem exports and runtime handle.
- `src-tauri/src/mcp/config.rs` — persisted MCP settings, loopback validation, endpoint formatting.
- `src-tauri/src/mcp/tools.rs` — stable `quay.*` tool catalog, schemas, side-effect classification, dispatch to `QuayOperations`.
- `src-tauri/src/mcp/confirmation.rs` — one-shot confirmation requests, approval/rejection/expiry state.
- `src-tauri/src/mcp/audit.rs` — MCP audit normalization/redaction adapter over existing storage.
- `src-tauri/src/mcp/server.rs` — `rmcp` service and Streamable HTTP lifecycle.
- `src-tauri/src/mcp/commands.rs` — Tauri-only settings/status/confirmation commands and events.
- `src-tauri/tests/mcp_contract.rs` — protocol/tool/policy integration tests with a fake operations backend.
- `src/lib/mcp.ts` — typed frontend bridge for MCP settings/status/confirmation.
- `src/components/mcp-confirmation-dialog.tsx` — destructive-action approval UI.
- `src/components/views/session-view.tsx` — existing Settings view; add MCP settings/status card only.
- `tests/mcp-ui.test.mjs` — static/wiring regression tests for MCP settings and confirmation UI.

Existing files modified:

- `src-tauri/Cargo.toml` / `src-tauri/Cargo.lock` — MCP/runtime dependencies.
- `src-tauri/src/lib.rs` — construct shared operations service, start/stop MCP runtime, register MCP Tauri commands.
- `src-tauri/src/wslc_runtime.rs` — expose/refactor the existing invocation entry point so `QuayOperations` can reuse it without Tauri indirection.
- `src-tauri/src/storage/audit.rs`, `src-tauri/src/storage/mod.rs`, `src-tauri/src/storage/schema.rs` — persist/query MCP audit metadata using the existing SQLite storage.
- `src/lib/tauri.ts` — preserve existing bridge and delegate MCP-specific calls to `src/lib/mcp.ts` if that matches current import patterns.
- `package.json` — include MCP UI test in the existing regression script.

---

### Task 1: Shared Quay Operations Boundary

**Files:**
- Create: `src-tauri/src/operations/mod.rs`
- Modify: `src-tauri/src/wslc_runtime.rs`
- Modify: `src-tauri/src/lib.rs`
- Test: unit tests in `src-tauri/src/operations/mod.rs`

**Interfaces:**
- Consumes: existing `WslcExecutor`, `HostSampler`, `PullManager`, `Storage`, and `wslc_runtime::invoke` behavior.
- Produces: `QuayOperations`, `OperationError`, and `OperationKind`; `QuayOperations::invoke(&self, payload: Value) -> Result<Value, OperationError>` is the compatibility seam used by Tauri and later MCP dispatch.

- [ ] **Step 1: Write the failing shared-boundary tests**

Add tests that define the error contract and prove the operations layer rejects malformed payloads before dispatch:

```rust
#[test]
fn operation_error_has_stable_code_and_message() {
    let error = OperationError::invalid_input("missing op");
    assert_eq!(error.code(), "invalid_input");
    assert_eq!(error.message(), "missing op");
}

#[test]
fn classify_operation_marks_delete_as_destructive() {
    assert_eq!(OperationKind::from_name("container.delete"), OperationKind::Destructive);
    assert_eq!(OperationKind::from_name("container.list"), OperationKind::ReadOnly);
}
```

- [ ] **Step 2: Run the focused Rust tests and verify RED**

Run: `cargo test --manifest-path src-tauri/Cargo.toml operations -- --nocapture`

Expected: FAIL because `operations`, `OperationError`, and `OperationKind` do not exist.

- [ ] **Step 3: Implement the minimal operations service**

Create `QuayOperations` with cloned/shared handles to the existing backend services. Keep `invoke(Value)` as the first adapter so existing `wslc_runtime::invoke` logic is reused instead of copied. Add stable error codes: `invalid_input`, `not_found`, `runtime_unavailable`, `conflict`, `confirmation_required`, `rejected`, `timeout`, `cancelled`, `backend_failure`.

```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OperationKind { ReadOnly, StateChanging, Destructive }

#[derive(Debug, Clone, Serialize)]
pub struct OperationError {
    code: &'static str,
    message: String,
}

#[derive(Clone)]
pub struct QuayOperations {
    #[cfg(windows)] executor: WslcExecutor,
    #[cfg(windows)] host: Arc<Mutex<HostSampler>>,
    pull_manager: PullManager,
    storage: Option<Storage>,
}

impl QuayOperations {
    pub fn invoke(&self, payload: Value) -> Result<Value, OperationError> {
        // Validate operation envelope, then call the existing runtime path.
    }
}
```

- [ ] **Step 4: Rewire `wslc_invoke` to call `QuayOperations`**

`Backend` should hold `operations: QuayOperations`; the Tauri command clones it into `spawn_blocking` and serializes `OperationError` to the current string-facing API so frontend behavior remains compatible.

- [ ] **Step 5: Run focused and existing Rust tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml operations -- --nocapture`

Run: `cargo test --manifest-path src-tauri/Cargo.toml`

Expected: PASS; existing Tauri/WSLC behavior unchanged.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/operations src-tauri/src/wslc_runtime.rs src-tauri/src/lib.rs
git commit -m "refactor: share Quay operation services"
```

---

### Task 2: MCP Configuration and Loopback Security

**Files:**
- Create: `src-tauri/src/mcp/mod.rs`
- Create: `src-tauri/src/mcp/config.rs`
- Modify: `src-tauri/src/lib.rs`
- Test: unit tests in `src-tauri/src/mcp/config.rs`

**Interfaces:**
- Consumes: app data directory from Tauri setup.
- Produces: `McpConfig { enabled: bool, bind: IpAddr, port: u16 }`, `McpConfig::validate()`, `McpConfig::endpoint()`, and load/save helpers.

- [ ] **Step 1: Write failing configuration tests**

```rust
#[test]
fn default_config_is_disabled_and_loopback_only() {
    let config = McpConfig::default();
    assert!(!config.enabled);
    assert_eq!(config.bind, IpAddr::V4(Ipv4Addr::LOCALHOST));
    assert_eq!(config.endpoint(), format!("http://127.0.0.1:{}/mcp", config.port));
}

#[test]
fn non_loopback_bind_is_rejected() {
    let config = McpConfig { enabled: true, bind: "0.0.0.0".parse().unwrap(), port: 47831 };
    assert_eq!(config.validate().unwrap_err().code(), "invalid_input");
}
```

- [ ] **Step 2: Run and verify RED**

Run: `cargo test --manifest-path src-tauri/Cargo.toml mcp::config -- --nocapture`

Expected: FAIL because MCP config types do not exist.

- [ ] **Step 3: Implement persisted config**

Use a small JSON file under Quay app data, e.g. `mcp.json`. Default to `enabled=false`, `127.0.0.1`, and stable port `47831`. `validate()` must require `IpAddr::is_loopback()` and nonzero port. Write via temporary file + rename so partial writes do not corrupt settings.

- [ ] **Step 4: Add MCP config state to backend setup**

Load config during `.setup`; invalid persisted config falls back to disabled localhost config and logs the validation error without starting a listener.

- [ ] **Step 5: Run Rust regression tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/mcp src-tauri/src/lib.rs
git commit -m "feat: add secure MCP configuration"
```

---

### Task 3: Stable MCP Tool Catalog and Structured Dispatch

**Files:**
- Create: `src-tauri/src/mcp/tools.rs`
- Modify: `src-tauri/src/mcp/mod.rs`
- Test: unit tests in `src-tauri/src/mcp/tools.rs`

**Interfaces:**
- Consumes: `QuayOperations`, `OperationKind`.
- Produces: `ToolSpec`, `tool_catalog() -> Vec<ToolSpec>`, and `dispatch_tool(operations, name, arguments)`; destructive tools are tagged, not executed through a bypass.

- [ ] **Step 1: Write the failing catalog tests**

Assert the exact v1 tool names:

```rust
const EXPECTED: &[&str] = &[
    "quay.host.status",
    "quay.container.list", "quay.container.inspect", "quay.container.logs",
    "quay.container.start", "quay.container.stop", "quay.container.restart",
    "quay.container.run", "quay.container.clone", "quay.container.update_ports",
    "quay.container.update_env", "quay.container.delete",
    "quay.image.list", "quay.image.inspect", "quay.image.pull", "quay.image.delete",
    "quay.cube.list", "quay.cube.inspect", "quay.cube.start", "quay.cube.stop",
    "quay.cube.create", "quay.cube.clone", "quay.cube.delete",
    "quay.audit.query",
];

#[test]
fn catalog_contains_exact_v1_tools_and_no_exec() {
    let names = tool_catalog().into_iter().map(|t| t.name).collect::<Vec<_>>();
    assert_eq!(names, EXPECTED);
    assert!(!names.iter().any(|name| name.contains("exec") || name.contains("shell")));
}
```

Also assert every schema has `type: object`, `additionalProperties: false`, and destructive classification for the three delete tools.

- [ ] **Step 2: Run and verify RED**

Run: `cargo test --manifest-path src-tauri/Cargo.toml mcp::tools -- --nocapture`

Expected: FAIL because the catalog does not exist.

- [ ] **Step 3: Implement strict schemas and mapping**

Define each tool description with side effects and JSON Schema. Translate MCP arguments into the existing Quay operation envelope. Do not embed runtime command construction in this file.

Representative mapping:

```rust
match name {
    "quay.container.list" => operations.invoke(json!({"op":"container.list"})),
    "quay.container.start" => operations.invoke(json!({"op":"container.start","id": required_string(args,"id")?})),
    "quay.container.delete" => Err(OperationError::confirmation_required("container.delete")),
    _ => Err(OperationError::invalid_input(format!("unknown MCP tool: {name}"))),
}
```

The real operation names/argument shapes must match the current `wslc_runtime` contract discovered in Task 1; adjust the adapter, not the public MCP tool names.

- [ ] **Step 4: Add representative dispatch tests with a fake operations adapter**

Cover one read-only, one state-changing, invalid arguments, unknown tool, and all destructive classifications. The fake records normalized operation envelopes so tests assert Quay dispatch rather than mock call counts.

- [ ] **Step 5: Run focused and full Rust tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml mcp::tools -- --nocapture`

Run: `cargo test --manifest-path src-tauri/Cargo.toml`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/mcp/tools.rs src-tauri/src/mcp/mod.rs
git commit -m "feat: define Quay MCP tool catalog"
```

---

### Task 4: One-Shot Destructive Confirmation Policy

**Files:**
- Create: `src-tauri/src/mcp/confirmation.rs`
- Modify: `src-tauri/src/mcp/tools.rs`
- Test: unit tests in `src-tauri/src/mcp/confirmation.rs`

**Interfaces:**
- Consumes: destructive `ToolSpec` classification and normalized target summary.
- Produces: `ConfirmationBroker`, `ConfirmationRequest`, `ConfirmationDecision`; `request()` creates a one-shot request, `resolve(id, decision)` resolves exactly once, and expiry returns `rejected/timeout` without dispatch.

- [ ] **Step 1: Write failing confirmation tests**

```rust
#[tokio::test]
async fn destructive_action_does_not_run_before_approval() {
    let broker = ConfirmationBroker::with_timeout(Duration::from_secs(5));
    let pending = broker.request("quay.container.delete", json!({"id":"abc"}));
    assert_eq!(broker.pending().len(), 1);
    assert!(!pending.is_finished());
}

#[tokio::test]
async fn approval_is_one_shot() {
    let broker = ConfirmationBroker::default();
    let request = broker.request("quay.image.delete", json!({"id":"sha256:x"}));
    assert!(broker.resolve(request.id(), ConfirmationDecision::Approve).is_ok());
    assert_eq!(broker.resolve(request.id(), ConfirmationDecision::Approve).unwrap_err().code(), "conflict");
}
```

Add rejection and expiry tests.

- [ ] **Step 2: Run and verify RED**

Run: `cargo test --manifest-path src-tauri/Cargo.toml mcp::confirmation -- --nocapture`

Expected: FAIL because confirmation types do not exist.

- [ ] **Step 3: Implement broker with bounded lifetime**

Use UUID/random opaque request IDs, a mutex-protected pending map, Tokio oneshot channels, and a default 60-second expiry. Store only normalized/redacted arguments. Resolution removes the request before sending the decision so duplicate approval cannot execute twice.

- [ ] **Step 4: Route destructive tool dispatch through the broker**

`quay.container.delete`, `quay.image.delete`, and `quay.cube.delete` create a pending confirmation and await the one-shot result before calling `QuayOperations`. Bulk/high-impact adapters use the same policy classification.

- [ ] **Step 5: Run Rust regression tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`

Expected: PASS, including rejection/expiry/duplicate coverage.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/mcp/confirmation.rs src-tauri/src/mcp/tools.rs
git commit -m "feat: gate destructive MCP actions"
```

---

### Task 5: MCP Audit and Secret Redaction

**Files:**
- Create: `src-tauri/src/mcp/audit.rs`
- Modify: `src-tauri/src/storage/audit.rs`
- Modify: `src-tauri/src/storage/schema.rs`
- Modify: `src-tauri/src/storage/mod.rs`
- Modify: `src-tauri/src/mcp/tools.rs`
- Test: unit tests in `src-tauri/src/mcp/audit.rs` and existing storage tests

**Interfaces:**
- Consumes: tool name, category, normalized targets, result/error, confirmation outcome, optional client metadata.
- Produces: `McpAuditRecord` persistence/query methods and `redact_value(Value) -> Value`.

- [ ] **Step 1: Write failing redaction and persistence tests**

```rust
#[test]
fn redacts_environment_and_secret_fields_recursively() {
    let value = json!({"env":{"API_KEY":"secret"},"token":"abc","id":"container-1"});
    let redacted = redact_value(value);
    assert_eq!(redacted["env"]["API_KEY"], "[REDACTED]");
    assert_eq!(redacted["token"], "[REDACTED]");
    assert_eq!(redacted["id"], "container-1");
}
```

Storage test: insert an MCP record and query it back with tool name, category, success, confirmation-required, confirmation outcome, and client metadata.

- [ ] **Step 2: Run and verify RED**

Run: `cargo test --manifest-path src-tauri/Cargo.toml mcp::audit -- --nocapture`

Expected: FAIL because MCP audit storage does not exist.

- [ ] **Step 3: Add schema migration and storage methods**

Add a dedicated `mcp_audit` table or extend the existing audit schema only if it can represent all required fields without overloading WSLC audit semantics. Migration must be idempotent. Index timestamp and tool name.

- [ ] **Step 4: Implement redaction and invocation audit wrapper**

Sensitive key matching is case-insensitive for at least: `env`, `environment`, `token`, `secret`, `password`, `api_key`, `apikey`, `authorization`. Persist normalized targets separately when safe; never persist raw secret-bearing argument JSON.

- [ ] **Step 5: Run storage and full Rust tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml storage -- --nocapture`

Run: `cargo test --manifest-path src-tauri/Cargo.toml`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/mcp/audit.rs src-tauri/src/mcp/tools.rs src-tauri/src/storage
git commit -m "feat: audit MCP operations safely"
```

---

### Task 6: Embedded `rmcp` Streamable HTTP Server

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/Cargo.lock`
- Create: `src-tauri/src/mcp/server.rs`
- Modify: `src-tauri/src/mcp/mod.rs`
- Modify: `src-tauri/src/lib.rs`
- Test: `src-tauri/tests/mcp_contract.rs`

**Interfaces:**
- Consumes: `McpConfig`, `QuayOperations`, tool catalog/dispatch, `ConfirmationBroker`, audit adapter.
- Produces: `McpRuntime::start(...) -> Result<McpRuntime, OperationError>`, `McpRuntime::status()`, `McpRuntime::shutdown()` and an MCP endpoint at `http://127.0.0.1:<port>/mcp`.

- [ ] **Step 1: Add a failing protocol contract test**

The test starts the server on an ephemeral loopback port with fake operations, connects with an `rmcp` client, lists tools, and asserts `quay.host.status` and `quay.container.list` are discoverable while `quay.exec` is absent.

```rust
#[tokio::test]
async fn client_discovers_quay_tools_over_streamable_http() {
    let fixture = TestServer::start().await;
    let client = fixture.connect_client().await;
    let tools = client.list_all_tools().await.unwrap();
    assert!(tools.iter().any(|tool| tool.name == "quay.host.status"));
    assert!(!tools.iter().any(|tool| tool.name == "quay.exec"));
}
```

- [ ] **Step 2: Run and verify RED**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --test mcp_contract -- --nocapture`

Expected: FAIL because `rmcp`/server runtime is not wired.

- [ ] **Step 3: Add MCP dependencies**

Add official `rmcp` 3.x with server + Streamable HTTP features and the Tokio features required by the selected `rmcp` transport. Do not add a second web framework unless `rmcp`'s documented server transport requires it. Keep Rust compatibility at or above `rmcp` 3.x's minimum supported Rust version.

- [ ] **Step 4: Implement MCP service and tool conversion**

Expose server metadata for Quay and convert `ToolSpec` schemas/descriptions into `rmcp` tools. Tool calls dispatch through policy/audit/operations. Use MCP 2026-07-28 semantics; do not reintroduce legacy session handshake state in Quay.

- [ ] **Step 5: Implement lifecycle and loopback listener**

`McpRuntime::start` validates config before binding, owns cancellation/shutdown state, and reports endpoint/running state. `.setup` starts it only when enabled. App exit shuts it down before executor shutdown.

- [ ] **Step 6: Add representative call and confirmation protocol tests**

Use the `rmcp` client to invoke one read-only tool and one state-changing tool. For a destructive tool, assert no fake backend call occurs until the confirmation broker is approved; rejection returns a structured MCP error/result. Where `rmcp` exposes MCP 2026-07-28 multi-round-trip input-required support, surface the pending confirmation as `input_required`; otherwise keep Quay's UI confirmation pending and return the SDK-supported structured confirmation state without bypassing policy.

- [ ] **Step 7: Run focused and full Rust tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --test mcp_contract -- --nocapture`

Run: `cargo test --manifest-path src-tauri/Cargo.toml`

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/mcp src-tauri/src/lib.rs src-tauri/tests/mcp_contract.rs
git commit -m "feat: embed Quay MCP server"
```

---

### Task 7: Tauri MCP Settings, Status, and Confirmation Bridge

**Files:**
- Create: `src-tauri/src/mcp/commands.rs`
- Modify: `src-tauri/src/mcp/mod.rs`
- Modify: `src-tauri/src/lib.rs`
- Test: unit tests in `src-tauri/src/mcp/commands.rs`

**Interfaces:**
- Consumes: `McpConfig`, `McpRuntime`, `ConfirmationBroker`.
- Produces Tauri commands: `mcp_get_status`, `mcp_set_enabled`, `mcp_set_port`, `mcp_confirm`; emits `mcp://confirmation-requested` and `mcp://status-changed` events.

- [ ] **Step 1: Write failing command/state tests**

Test that enabling starts the runtime, disabling stops it, invalid/non-loopback configuration is rejected, changing port restarts only the MCP listener, and `mcp_confirm` cannot approve the same request twice.

- [ ] **Step 2: Run and verify RED**

Run: `cargo test --manifest-path src-tauri/Cargo.toml mcp::commands -- --nocapture`

Expected: FAIL because bridge commands do not exist.

- [ ] **Step 3: Implement command state manager**

Return a serializable status shape:

```rust
#[derive(Serialize)]
pub struct McpStatus {
    pub enabled: bool,
    pub running: bool,
    pub endpoint: String,
    pub port: u16,
    pub connected_clients: usize,
    pub pending_confirmations: usize,
}
```

Persist settings only after validation. A failed listener restart must return an error and leave Quay's container backend running.

- [ ] **Step 4: Emit confirmation/status events**

When broker creates a request, emit exact tool name, redacted target summary, request ID, and expiry. Never emit raw secret-bearing args.

- [ ] **Step 5: Register commands in `generate_handler!` and run Rust tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/mcp/commands.rs src-tauri/src/mcp/mod.rs src-tauri/src/lib.rs
git commit -m "feat: expose MCP controls to Quay UI"
```

---

### Task 8: Quay Settings UI and Destructive Confirmation Dialog

**Files:**
- Create: `src/lib/mcp.ts`
- Create: `src/components/mcp-confirmation-dialog.tsx`
- Modify: `src/components/views/session-view.tsx`
- Modify: `src/components/app-shell.tsx`
- Modify: `package.json`
- Create: `tests/mcp-ui.test.mjs`

**Interfaces:**
- Consumes Tauri commands/events from Task 7.
- Produces user controls for enable/disable, port, endpoint copy, running status, connected-client count, capability summary, and one-shot destructive approval/rejection.

- [ ] **Step 1: Write the failing UI wiring test**

Use the repository's existing Node source-wiring test style. Assert the Settings view contains MCP server copy, uses `mcp_get_status`/`mcp_set_enabled`/`mcp_set_port`, renders endpoint copy action, and the app shell mounts a confirmation dialog that listens for `mcp://confirmation-requested` and calls `mcp_confirm`.

```js
test('settings exposes MCP controls without raw exec capability', async () => {
  const source = await readFile('src/components/views/session-view.tsx', 'utf8');
  assert.match(source, /MCP server/);
  assert.match(source, /mcpSetEnabled/);
  assert.doesNotMatch(source, /quay\.exec|raw shell/i);
});
```

- [ ] **Step 2: Run and verify RED**

Run: `node --test tests/mcp-ui.test.mjs`

Expected: FAIL because MCP UI/bridge is absent.

- [ ] **Step 3: Implement typed frontend bridge**

`src/lib/mcp.ts` exports `McpStatus`, `McpConfirmationRequest`, `mcpGetStatus`, `mcpSetEnabled`, `mcpSetPort`, `mcpConfirm`, and event-listener helpers. Keep all Tauri command strings in this module.

- [ ] **Step 4: Add MCP card to existing Settings view**

Follow current card styling. Show toggle, `127.0.0.1` endpoint, editable port, running/stopped state, connected clients when available, Copy configuration/endpoint action, and text stating destructive operations require approval. Do not expose a bind-address field in v1.

- [ ] **Step 5: Add global confirmation dialog**

Mount once in `app-shell.tsx`. Display the exact tool/action and normalized targets, expiry context, Reject and Approve buttons. Closing the dialog without approval rejects the request. Disable buttons while resolution is in flight.

- [ ] **Step 6: Add UI test to regression script and run frontend checks**

Add `tests/mcp-ui.test.mjs` to `test:autostart` (or the repo's equivalent broad desktop regression script).

Run: `node --test tests/mcp-ui.test.mjs`

Run: `pnpm typecheck`

Run: `pnpm test:autostart`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/mcp.ts src/components/mcp-confirmation-dialog.tsx src/components/views/session-view.tsx src/components/app-shell.tsx tests/mcp-ui.test.mjs package.json
git commit -m "feat: add MCP settings and approvals UI"
```

---

### Task 9: End-to-End Verification, Documentation, and CI Gate

**Files:**
- Modify: `README.md`
- Modify: `.github/workflows/ci.yml` only if current CI does not already run the Rust contract + frontend regression commands
- Modify: `docs/superpowers/specs/2026-09-06-quay-mcp-server-design.md` only for factual implementation notes if required
- Test: all Rust and frontend suites

**Interfaces:**
- Consumes: completed MCP server and UI.
- Produces: documented client connection instructions and a green branch ready for PR review.

- [ ] **Step 1: Add a failing documentation/CI contract test if needed**

If existing repository tests use README/CI source contracts, add `tests/mcp-docs.test.mjs` asserting README contains `http://127.0.0.1:47831/mcp`, MCP is disabled by default, destructive actions require approval, and no raw shell tool is advertised. Otherwise use a manual grep verification in Step 4 rather than creating a test solely for prose.

- [ ] **Step 2: Document MCP usage**

Add a concise README section with: enabling MCP in Settings, local endpoint, supported capability categories, a generic Streamable HTTP client configuration example, confirmation behavior, and localhost/security limitations. Do not claim remote/OAuth support.

- [ ] **Step 3: Ensure CI executes the new tests**

Inspect `.github/workflows/ci.yml`. If it already runs `cargo test` and `pnpm test:autostart`, no workflow change is needed. Otherwise add the minimal missing commands; do not duplicate existing jobs.

- [ ] **Step 4: Run complete local verification**

Run:

```bash
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo test --manifest-path src-tauri/Cargo.toml
pnpm typecheck
pnpm test:autostart
pnpm build:desktop
```

Expected: all commands exit 0. Also verify:

```bash
git grep -n "quay.exec\|raw wslc\|0.0.0.0" -- src-tauri/src/mcp src/components/views/session-view.tsx README.md
```

Expected: no registered/advertised raw execution capability and no non-loopback bind option; explanatory security prose is acceptable.

- [ ] **Step 5: Run protocol smoke test on Windows**

Start Quay with MCP enabled, connect an MCP client to the displayed loopback endpoint, list tools, call `quay.host.status`, call `quay.container.list`, perform a harmless start/stop on a disposable test container, then request deletion and verify Quay blocks until the confirmation dialog is approved. Reject a second delete and verify no backend delete occurs.

- [ ] **Step 6: Commit documentation/CI changes**

```bash
git add README.md .github/workflows/ci.yml tests/mcp-docs.test.mjs docs/superpowers/specs/2026-09-06-quay-mcp-server-design.md
git commit -m "docs: document Quay MCP control"
```

Omit nonexistent/unchanged paths from `git add`.

- [ ] **Step 7: Final branch review**

Compare `main...feat/mcp-server`. Confirm every spec requirement maps to an implementation/test, no secrets are logged, no destructive path bypasses `ConfirmationBroker`, MCP shutdown precedes WSLC executor shutdown, and existing non-MCP Quay workflows remain unchanged.

---

## Self-Review

### Spec coverage

- Embedded localhost MCP server: Tasks 2, 6, 7.
- Shared backend service instead of duplicated WSLC logic: Task 1 and Task 3 dispatch mapping.
- Complete structured tool catalog: Task 3.
- No raw command execution: global constraint + Tasks 3, 8, 9 verification.
- Destructive/high-impact confirmation: Task 4, protocol coverage Task 6, UI Task 8.
- Audit + secret redaction: Task 5.
- Settings/status/client indication: Tasks 7 and 8.
- Error normalization: Task 1, reused by Tasks 3/6/7.
- Protocol/list-tools/tool-call integration: Task 6.
- Clean shutdown: Task 6 and final verification Task 9.
- CI/documentation: Task 9.

### Type consistency

- `QuayOperations` and `OperationError` originate in Task 1 and are consumed by Tasks 3-7.
- `McpConfig` originates in Task 2 and is consumed by Tasks 6-8.
- Tool classification/catalog originates in Task 3 and is consumed by confirmation/audit/server Tasks 4-6.
- `ConfirmationBroker` originates in Task 4 and is consumed by Tasks 6-8.
- MCP audit adapter originates in Task 5 and is consumed by Task 6.
- `McpRuntime` originates in Task 6 and is controlled by Task 7.
- Tauri command/event names originate in Task 7 and are consumed verbatim by Task 8.

### Placeholder scan

The plan contains no TBD/TODO/fill-later steps. The one implementation-dependent adapter detail is explicitly bounded: Task 3 must map stable public MCP names onto the existing WSLC operation envelope discovered and preserved in Task 1, rather than inventing a second runtime API.
