# Quay MCP Server Design

Date: 2026-09-06
Status: Approved design
Branch: `feat/mcp-server`

## Goal

Make Quay controllable by LLMs and agents through Model Context Protocol (MCP), while keeping Quay as the authority for container operations. The MCP layer must reuse Quay's existing Rust backend and WSLC execution paths rather than duplicating container-management logic.

## Scope

The first release exposes structured Quay operations over a localhost-only MCP server. Raw shell or arbitrary command execution is not exposed by default.

In scope:

- Host/runtime inspection.
- Container list, inspect, logs, start, stop, restart, create/run, clone, delete, port updates, and environment updates.
- Image list, inspect, pull, and delete.
- Cube/group list, inspect, start, stop, create, clone, and delete.
- Quay audit/log queries.
- Human confirmation flow for destructive or high-impact operations.
- Local configuration and status UI for the MCP server.
- Tests for protocol handling, tool schemas, permission/confirmation policy, and backend integration.

Out of scope for the first release:

- Remote network exposure.
- Public authentication/OAuth.
- Arbitrary PowerShell, shell, or `wslc` passthrough.
- Autonomous approval of destructive actions.

## Architecture

Quay remains a single desktop application. A new Rust MCP subsystem runs inside the Tauri process and shares the existing `Backend` services.

```text
LLM / Agent
    |
    | MCP
    v
Quay MCP Server (localhost)
    |
    v
MCP Tool Registry / Policy Layer
    |
    v
Quay Backend Services
    |-- WslcExecutor
    |-- PullManager
    |-- Storage / Audit / Logs
    |-- HostSampler
    v
WSLC / Containers / Images / Cubes
```

The MCP server must never create a second WSLC execution implementation. Tool handlers call a small internal service layer extracted from or shared with the existing Tauri commands.

## Transport and lifecycle

- Bind only to loopback (`127.0.0.1`) by default.
- The MCP server starts with Quay when MCP support is enabled.
- The server stops cleanly when Quay exits.
- The port is configurable; Quay should choose a stable default and reject non-loopback bind addresses in the first release.
- The UI shows enabled/disabled state, bind address, port, and connection status.

## Backend refactor

The current Tauri commands are presentation-facing adapters. MCP must call the same application services rather than invoking Tauri commands indirectly.

Introduce a Quay operations/service layer with methods such as:

- `host_status`
- `container_list`
- `container_inspect`
- `container_logs`
- `container_start`
- `container_stop`
- `container_restart`
- `container_run`
- `container_clone`
- `container_delete`
- `container_update_ports`
- `container_update_env`
- `image_list`
- `image_inspect`
- `image_pull`
- `image_delete`
- `cube_list`
- `cube_inspect`
- `cube_start`
- `cube_stop`
- `cube_create`
- `cube_clone`
- `cube_delete`
- `audit_query`

Tauri and MCP handlers both call this service layer.

## MCP tools

Tool names use a stable `quay.*` namespace.

Read-only tools:

- `quay.host.status`
- `quay.container.list`
- `quay.container.inspect`
- `quay.container.logs`
- `quay.image.list`
- `quay.image.inspect`
- `quay.cube.list`
- `quay.cube.inspect`
- `quay.audit.query`

State-changing, non-destructive tools:

- `quay.container.start`
- `quay.container.stop`
- `quay.container.restart`
- `quay.container.run`
- `quay.container.clone`
- `quay.container.update_ports`
- `quay.container.update_env`
- `quay.image.pull`
- `quay.cube.start`
- `quay.cube.stop`
- `quay.cube.create`
- `quay.cube.clone`

Destructive tools:

- `quay.container.delete`
- `quay.image.delete`
- `quay.cube.delete`

Every tool has a strict JSON schema and structured result. Tool descriptions must clearly state side effects so LLMs can plan safely.

## Confirmation policy

Quay applies policy independently of the LLM.

- Read-only tools execute immediately.
- Ordinary state-changing tools execute immediately when MCP control is enabled.
- Destructive operations require explicit human confirmation.
- High-impact bulk operations also require confirmation, even if each individual action is normally non-destructive.
- The MCP response returns an input-required/confirmation state where supported by the selected MCP SDK/protocol revision.
- Confirmation is displayed in Quay with the exact proposed action and target set.
- Approval is one-shot and scoped to that operation. No blanket permanent destructive approval in v1.
- Rejected or expired confirmations return a structured MCP error/result without performing the operation.

## Raw command execution

No generic `quay.exec`, shell, PowerShell, or raw `wslc` tool is registered in the first release.

The design leaves an extension point for a future opt-in capability. If added later, it must be disabled by default, separately permissioned, visibly marked as dangerous, localhost-only, audited, and confirmation-gated.

## Audit

Every MCP invocation is recorded through Quay's existing audit/storage facilities with:

- timestamp
- tool name
- operation category
- normalized target identifiers
- success/failure
- error summary
- whether confirmation was required
- confirmation outcome
- MCP client/session metadata when available

Sensitive environment values and secrets must not be copied verbatim into audit records.

## UI

Add an MCP section to Quay settings/status:

- Enable MCP server toggle.
- Local endpoint display.
- Copy client configuration action.
- Connected client/session indicator when available.
- Destructive-action confirmation dialog.
- Optional tool capability summary.

The UI does not need a full MCP inspector in v1.

## Error handling

Tool results distinguish:

- invalid input
- target not found
- WSLC/runtime unavailable
- operation conflict
- permission/confirmation required
- user rejected
- timeout/cancelled
- backend failure

Backend errors are normalized to concise structured MCP errors while retaining detailed diagnostics in Quay logs/audit.

## Security boundaries

- Loopback-only bind in v1.
- No raw shell tool.
- Strict input schemas.
- Existing WSLC/backend validation remains authoritative.
- Destructive operations require human approval.
- MCP cannot bypass Quay's normal validation or audit path.
- Secrets are redacted from logs and tool results when appropriate.

## Testing

Rust tests:

- Tool registry exposes the expected names and schemas.
- Read-only tools map correctly to Quay operations.
- State-changing tools execute through the shared service layer.
- Destructive tools never execute before approval.
- Approval, rejection, expiry, and duplicate confirmation are covered.
- Server rejects non-loopback configuration.
- Server lifecycle shuts down cleanly.
- Backend error normalization is deterministic.
- Audit records are produced and redact sensitive values.

Integration tests:

- MCP initialize/list-tools flow.
- Invoke representative read-only and state-changing tools against a fake/mocked Quay backend.
- Destructive operation confirmation round-trip.
- CI validates formatting, unit tests, Rust tests, and existing Quay tests.

## Implementation boundaries

Expected primary Rust changes:

- `src-tauri/src/mcp/` for server, tool registry, schemas, confirmation policy, and protocol adapter.
- `src-tauri/src/operations/` or equivalent shared application-service layer.
- `src-tauri/src/lib.rs` for lifecycle wiring only.
- `src-tauri/Cargo.toml` for MCP/server dependencies.
- `src-tauri/tests/` for protocol and policy integration coverage.

Expected frontend changes:

- MCP settings/status component.
- Confirmation dialog for destructive MCP requests.
- Tauri bridge commands/events only for MCP settings and confirmation UI; container operations themselves remain in the shared Rust service layer.

## Success criteria

A supported MCP client can connect locally to Quay, discover structured Quay tools, inspect containers/images/cubes, perform normal lifecycle operations, and request destructive actions that Quay blocks until the user explicitly approves them. All operations use Quay's existing backend execution path and are auditable. No generic shell execution is exposed by default.
