# SQLite Audit and Container Log Storage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist Quay audit activity and container output in native SQLite so Doing/Done/Error history and container logs survive container stop/removal and Quay restarts.

**Architecture:** Add a Rust-owned `rusqlite` storage service at `<app_data_dir>/quay.db`, exposed through narrow Tauri commands. Native mutation execution records append-only audit lifecycle rows; the frontend captures rolling WSLC container tails into SQLite, reads historical logs from SQLite, and renders Audit separately from container output.

**Tech Stack:** Rust 2021, Tauri 2, `rusqlite` with `bundled`, React 19, TypeScript, Zustand, Node test runner, Cargo tests.

**Spec:** `docs/superpowers/specs/2026-08-29-sqlite-audit-container-logs-design.md`

## Global Constraints

- Database path is exactly `<app_data_dir>/quay.db`.
- SQLite is native-owned; React never opens SQLite or accepts arbitrary SQL.
- Use `rusqlite` with `bundled`, WAL, foreign keys, busy timeout, and explicit schema versioning.
- Audit status values are exactly `doing`, `done`, `error`; lifecycle rows are append-only and share a stable `operation_id`.
- Audit commands/errors are redacted before persistence; raw container output is not broadly regex-redacted.
- Container history must remain queryable after stop, removal, and Quay restart.
- Container logs and Audit remain separate storage/query/UI concepts.
- Container-log retention defaults to 30 days and 500 MB of retained `container_log_lines.text` payload; audit history is retained indefinitely by default.
- Storage/capture failures must not block requested WSLC operations.
- Existing `quay.operationLogs` migration is idempotent and deletes localStorage only after SQLite confirms the transaction.
- Use TDD for every production behavior change: failing test first, verify RED, minimal implementation, verify GREEN.

---

## File Structure

Native persistence is split by responsibility rather than placed in `lib.rs`:

- `src-tauri/src/storage/mod.rs` — `Storage` facade, connection locking, initialization, common models/errors.
- `src-tauri/src/storage/schema.rs` — schema v1, PRAGMAs, migration/version checks.
- `src-tauri/src/storage/audit.rs` — audit insert/query/clear/redaction operations.
- `src-tauri/src/storage/container_logs.rs` — batched log persistence, dedupe, query, retention, statistics.
- `src-tauri/src/storage/legacy.rs` — atomic import marker and legacy diagnostic import.
- `src-tauri/src/lib.rs` — owns optional storage state and exposes narrow Tauri commands.
- `src-tauri/src/wslc_runtime.rs` / `src-tauri/src/wslc_executor.rs` — identify mutation metadata and record native lifecycle results at the execution boundary.
- `src-tauri/src/pull_manager.rs` — uses the same audit sink for image-pull lifecycle.
- `src/lib/tauri.ts` — typed bridge for storage/audit/log commands and legacy import.
- `src/lib/wslc/types.ts` — shared frontend audit/log/storage DTOs and `audit` ViewId.
- `src/lib/wslc/log-store.ts` — capture rolling tails, persist batches, query SQLite history; no operation-diagnostic merging.
- `src/lib/wslc/audit-store.ts` — audit paging/filter/clear state.
- `src/components/views/logs-view.tsx` — historical container-only log UI.
- `src/components/views/audit-view.tsx` — dedicated audit UI.
- `src/components/app-shell.tsx` — Audit navigation/view wiring and storage initialization/migration trigger.

---

### Task 1: SQLite storage foundation and schema

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/lib.rs`
- Create: `src-tauri/src/storage/mod.rs`
- Create: `src-tauri/src/storage/schema.rs`

**Interfaces:**
- Produces: `storage::Storage::open(path: PathBuf) -> Result<Storage, StorageError>`
- Produces: `Storage::is_available() -> bool` only if useful for command state; prefer `Option<Storage>` in `Backend` for degraded mode.
- Produces schema tables `audit_events`, `container_log_lines`, `storage_meta`, indexes from the approved spec, plus `payload_bytes INTEGER NOT NULL` on `container_log_lines` so the 500 MB payload budget is measurable without conflating audit/index/WAL bytes.

- [ ] **Step 1: Write failing Rust tests for schema initialization**

In `src-tauri/src/storage/schema.rs`, add `#[cfg(test)]` tests using `rusqlite::Connection::open_in_memory()` that call `initialize(&mut conn)`, assert `PRAGMA user_version == 1`, and query `sqlite_master` for `audit_events`, `container_log_lines`, `storage_meta`, `ix_audit_events_ts`, and `ix_container_logs_container`. Also assert `PRAGMA foreign_keys == 1` and `PRAGMA journal_mode` is a valid in-memory equivalent while a file-backed temp DB test verifies WAL.

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `cargo test --manifest-path src-tauri/Cargo.toml storage::schema -- --nocapture`

Expected: FAIL because the storage module/schema initializer and `rusqlite` dependency do not exist.

- [ ] **Step 3: Implement the minimal storage foundation**

Add:

```toml
rusqlite = { version = "0.32", features = ["bundled"] }
```

Implement `Storage` as a cloneable `Arc<Mutex<Connection>>` wrapper. `Storage::open` creates the parent directory, opens the file, applies a 5-second busy timeout, calls schema initialization, and returns the wrapper. Schema v1 creates the approved tables/indexes, adds `payload_bytes`, enables foreign keys and WAL for file databases, and sets `PRAGMA user_version = 1` in a transaction.

In Tauri setup resolve `app.path().app_data_dir()?.join("quay.db")`. Attempt to open it; on failure print a diagnostic and keep `storage: None` so Quay remains usable.

- [ ] **Step 4: Verify GREEN**

Run: `cargo test --manifest-path src-tauri/Cargo.toml storage::schema -- --nocapture`

Expected: PASS.

Run: `cargo test --manifest-path src-tauri/Cargo.toml`

Expected: all Rust tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/lib.rs src-tauri/src/storage
git commit -m "feat: add sqlite storage foundation"
```

---

### Task 2: Audit repository, redaction, paging, and clearing

**Files:**
- Create: `src-tauri/src/storage/audit.rs`
- Modify: `src-tauri/src/storage/mod.rs`
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Produces Rust `AuditStatus { Doing, Done, Error }`, serialized lowercase.
- Produces `AuditWrite { operation_id, ts, category, action, target_type, target_id, target_name, status, message, command, error, duration_ms, metadata_json }`.
- Produces `AuditQuery { status, category, target, search, from_ts, to_ts, limit, before_ts }` with `limit` clamped to `1..=500`.
- Produces `Storage::append_audit(&AuditWrite)`, `Storage::query_audit(&AuditQuery)`, `Storage::clear_audit()`.
- Produces Tauri `audit_query`, `audit_clear`, and `storage_stats` read/maintenance commands.

- [ ] **Step 1: Write failing audit repository tests**

Tests must prove: two rows with one `operation_id` preserve `doing -> done`; `doing -> error` preserves sanitized error; an unmatched `doing` remains queryable; paging is newest-first; status/category/target/search/time filters work; clear removes only audit rows; command/error redaction replaces values for `NGROK_AUTHTOKEN=abc`, `password=secret`, `Authorization: Bearer token`, and URL userinfo with `REDACTED`.

- [ ] **Step 2: Verify RED**

Run: `cargo test --manifest-path src-tauri/Cargo.toml storage::audit -- --nocapture`

Expected: FAIL because audit repository APIs do not exist.

- [ ] **Step 3: Implement audit repository and commands**

Use prepared statements and parameterized filters. Generate IDs at the caller; do not update prior rows. Sanitize `command`, `error`, and diagnostic `message` before insert. Do not sanitize arbitrary container output here. `storage_stats` returns at least `{ available, database_bytes, audit_rows, container_log_rows, container_log_payload_bytes }`; if storage is unavailable, return `available: false` rather than failing app startup.

- [ ] **Step 4: Verify GREEN**

Run the focused audit tests, then full `cargo test --manifest-path src-tauri/Cargo.toml`; expected PASS.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/storage src-tauri/src/lib.rs
git commit -m "feat: persist audit events in sqlite"
```

---

### Task 3: Container log repository, deduplication, retention, and historical identity

**Files:**
- Create: `src-tauri/src/storage/container_logs.rs`
- Modify: `src-tauri/src/storage/mod.rs`
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Produces `ContainerLogWrite { container_id, container_name, cube_id, cube_name, source_ts, captured_ts, stream, text, dedupe_key }`.
- Produces `ContainerLogQuery { container_name, cube_id, search, from_ts, to_ts, limit, before_id }`.
- Produces `Storage::append_container_logs(&[ContainerLogWrite]) -> Result<usize, StorageError>`.
- Produces `Storage::query_container_logs`, `Storage::list_log_targets`, `Storage::clear_container_logs`, `Storage::enforce_log_retention(now_ms, max_age_days, max_payload_bytes)`.
- Produces Tauri `container_logs_append`, `container_logs_query`, `container_log_targets`, `container_logs_clear`, `container_logs_cleanup`.

- [ ] **Step 1: Write failing repository tests**

Use temp SQLite DBs. Assert one transaction persists a batch; duplicate `dedupe_key` inserts are ignored; two identical text lines with distinct sequence-aware dedupe keys are both retained; removed/stopped identities remain in `list_log_targets` without a live container table; query filters/paging work; clearing logs does not clear audit; rows older than `30 * 24 * 60 * 60 * 1000` ms are deleted; payload-budget cleanup deletes oldest rows until `SUM(payload_bytes) <= 500 * 1024 * 1024` (use a tiny injected budget in the unit test).

- [ ] **Step 2: Verify RED**

Run: `cargo test --manifest-path src-tauri/Cargo.toml storage::container_logs -- --nocapture`

Expected: FAIL because container-log APIs do not exist.

- [ ] **Step 3: Implement batched persistence and cleanup**

Set `payload_bytes` to `text.as_bytes().len()`. Use `INSERT OR IGNORE` on unique `dedupe_key`. Keep container/cube identity directly on each row. Cleanup first deletes by age, then repeatedly deletes bounded oldest-ID batches while payload sum exceeds budget. Do not `VACUUM` automatically.

- [ ] **Step 4: Verify GREEN**

Run focused tests and full Cargo suite; expected PASS.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/storage src-tauri/src/lib.rs
git commit -m "feat: persist container logs in sqlite"
```

---

### Task 4: Native audit lifecycle around WSLC mutations and image pulls

**Files:**
- Modify: `src-tauri/src/wslc_runtime.rs`
- Modify: `src-tauri/src/wslc_executor.rs`
- Modify: `src-tauri/src/pull_manager.rs`
- Modify: `src-tauri/src/lib.rs`
- Test: existing Rust tests in those modules plus new focused tests

**Interfaces:**
- Consumes: `Storage::append_audit` from Task 2.
- Produces: mutation classification returning `{ category, action, target_type, target_name, sanitized_command }` for supported state-changing WSLC commands.
- Produces: one `doing` row before mutation execution and one `done` or `error` row afterward with same `operation_id` and duration.
- Pull manager consumes an optional cloneable audit sink/storage and emits image-pull start/terminal/cancel audit lifecycle.

- [ ] **Step 1: Write failing mutation-classification and lifecycle tests**

Cover container run/start/stop/restart/rm, image rm, volume create/rm, session start/terminate and representative cube-member commands. Assert read-only list/log/probe commands produce no audit. With a temp Storage, execute a fake success and fake non-zero failure and assert exactly `doing,done` or `doing,error`, same operation ID, sanitized command/error, and positive/non-negative duration.

Add pull-manager tests proving queued/start/completed, failed, and cancelled pulls produce terminal audit states without changing existing pull semantics.

- [ ] **Step 2: Verify RED**

Run the focused Rust module tests; expected FAIL because native execution does not accept an audit sink.

- [ ] **Step 3: Implement the native audit boundary**

Thread optional `Storage` into the executor/runtime path. Record audit best-effort: an insert failure is reported diagnostically but the WSLC command still executes. Terminal audit is recorded from the actual process result. Do not audit ordinary polling/read commands. Thread the same optional storage into `PullManager` and map pull lifecycle to category `image`, action `pull`, target type `image`, target name/reference.

- [ ] **Step 4: Verify GREEN and regressions**

Run focused tests, then full Cargo suite. Expected PASS with existing executor concurrency/pull tests unchanged.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/wslc_runtime.rs src-tauri/src/wslc_executor.rs src-tauri/src/pull_manager.rs src-tauri/src/lib.rs src-tauri/src/storage
git commit -m "feat: audit native quay mutations"
```

---

### Task 5: Typed frontend storage bridge and legacy localStorage migration

**Files:**
- Modify: `src/lib/tauri.ts`
- Modify: `src/lib/wslc/types.ts`
- Create: `src/lib/wslc/storage-migration.ts`
- Create: `src-tauri/src/storage/legacy.rs`
- Modify: `src-tauri/src/storage/mod.rs`
- Modify: `src-tauri/src/lib.rs`
- Test: `tests/operation-ux.test.mjs`
- Create: `tests/sqlite-storage-bridge.test.mjs`

**Interfaces:**
- Produces frontend `AuditEvent`, `AuditQuery`, `ContainerLogRecord`, `ContainerLogQuery`, `ContainerLogTarget`, `StorageStats`.
- Produces bridge functions `queryAudit`, `clearAudit`, `appendContainerLogs`, `queryContainerLogs`, `listContainerLogTargets`, `clearContainerLogs`, `cleanupContainerLogs`, `getStorageStats`, `importLegacyOperationLogs`.
- Produces native `legacy_operation_logs_import(entries)` transaction that checks `storage_meta` marker `legacy_operation_logs_v1`, inserts sanitized category `legacy`/action `diagnostic`/status `error` rows, writes marker, commits, and reports `{ imported, already_imported }`.

- [ ] **Step 1: Write failing bridge/migration contract tests**

Node source-contract tests assert typed Tauri command names exist, `ViewId` includes `audit`, and migration reads `quay.operationLogs` but calls native import before `localStorage.removeItem`. Rust legacy tests assert first import persists all valid entries plus marker atomically, second import is a no-op, and an induced transaction failure does not write the marker.

- [ ] **Step 2: Verify RED**

Run: `node --test tests/sqlite-storage-bridge.test.mjs tests/operation-ux.test.mjs`

Run focused Cargo legacy tests.

Expected: FAIL because bridge/import APIs do not exist.

- [ ] **Step 3: Implement DTOs, bridge, and atomic migration**

Reuse the current legacy entry shape `{ id, ts, containerName?, command, text }`. Native import classifies these as historical failure diagnostics because current code only creates them from failed lifecycle capture. After native success/already-imported, remove `quay.operationLogs`; on any error leave it untouched. No arbitrary SQL crosses the bridge.

- [ ] **Step 4: Verify GREEN**

Run the two Node tests, focused Cargo legacy tests, `pnpm typecheck`, and full Cargo tests. Expected PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/tauri.ts src/lib/wslc/types.ts src/lib/wslc/storage-migration.ts src-tauri/src/storage src-tauri/src/lib.rs tests/sqlite-storage-bridge.test.mjs tests/operation-ux.test.mjs
git commit -m "feat: bridge sqlite history to frontend"
```

---

### Task 6: Persist rolling container output and drain around destructive lifecycle operations

**Files:**
- Modify: `src/lib/wslc/log-store.ts`
- Modify: `src/lib/wslc/logs.ts`
- Modify: `src/lib/wslc/store.ts`
- Modify: `src/lib/tauri.ts`
- Test: `tests/log-aggregation.test.mjs`
- Test: `tests/log-polling.test.mjs`
- Test: `tests/operation-ux.test.mjs`
- Create: `tests/persistent-container-logs.test.mjs`

**Interfaces:**
- Consumes: container-log bridge from Task 5.
- Produces: `captureContainerLogs(container, options?) -> Promise<void>` in log-store, which reads timestamped tail with fallback, computes unseen rows, persists them, then refreshes displayed SQLite history.
- Produces: deterministic `dedupe_key`: timestamped lines use container identity + source timestamp + stream + text; fallback lines use container identity + a per-runtime capture-session ID + monotonic observed sequence, with overlap suppression before key generation.
- Produces: `drainContainerLogs(name/id)` callable before and after Quay-initiated stop/restart/remove.

- [ ] **Step 1: Write failing persistence/lifecycle tests**

Source-contract tests must assert `log-store.ts` no longer imports `loadOperationLogs`/`clearOperationLogs`; successful refresh sends parsed rows to `appendContainerLogs`; displayed history is loaded via `queryContainerLogs`; stopped/historical targets come from `listContainerLogTargets`; stop/restart/remove invoke a best-effort pre-drain and post-drain where applicable. Add a pure overlap/dedupe test showing repeated rolling tails do not duplicate rows while identical application lines at distinct positions survive.

- [ ] **Step 2: Verify RED**

Run: `node --test tests/log-aggregation.test.mjs tests/log-polling.test.mjs tests/operation-ux.test.mjs tests/persistent-container-logs.test.mjs`

Expected: FAIL on old localStorage/live-only behavior.

- [ ] **Step 3: Implement SQLite-backed capture and drains**

Keep WSLC tail reads best-effort. Persist timestamped lines immediately in one batch. For non-timestamp output preserve the existing overlap algorithm, add capture-session/sequence identity, and never dedupe solely by text. `refreshAggregatedLogs` queries persisted rows as source of truth. `clearLogs` invokes `clearContainerLogs` only and resets fallback cursors. Add pre/post drains to stop/restart and pre-drain to remove; attempt a post-drain after remove only if runtime still exposes logs, swallowing capture failure. Drain failures set/emit storage diagnostics but never cancel the requested mutation.

- [ ] **Step 4: Verify GREEN**

Run focused Node tests, `pnpm typecheck`, and `pnpm test:autostart`; expected PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/wslc/log-store.ts src/lib/wslc/logs.ts src/lib/wslc/store.ts src/lib/tauri.ts tests
git commit -m "feat: retain container logs across stops"
```

---

### Task 7: Audit store and dedicated Audit UI

**Files:**
- Create: `src/lib/wslc/audit-store.ts`
- Create: `src/components/views/audit-view.tsx`
- Modify: `src/components/app-shell.tsx`
- Modify: `src/lib/wslc/types.ts`
- Create: `tests/audit-view.test.mjs`

**Interfaces:**
- Consumes: `queryAudit`, `clearAudit`, `AuditEvent` from Task 5.
- Produces Zustand audit state with filters `{ status, category, target, search, fromTs, toTs }`, paging, refresh, load-more, clear.
- Produces `AuditView` with timestamp, Doing/Done/Error text badge, action, target, duration, concise message, expandable sanitized command/error/metadata.

- [ ] **Step 1: Write failing Audit UI contract tests**

Assert AppShell NAV contains `{ id: "audit", label: "Audit" }`, renders `<AuditView />`, and Audit view contains Doing/Done/Error labels, status/category/target/search/time filtering controls, expandable command/error details, load-more paging, and an explicit clear-audit action. Test source must also prove the UI does not invoke arbitrary SQL.

- [ ] **Step 2: Verify RED**

Run: `node --test tests/audit-view.test.mjs`

Expected: FAIL because Audit view/store do not exist.

- [ ] **Step 3: Implement audit store and view**

Use existing Quay card/input/button conventions. Status distinction includes text/icon, not color alone. Clearing Audit calls only `audit_clear`, refreshes audit state, and leaves container logs untouched. Display metadata JSON in a preformatted expandable detail only after safe parse/stringify; never use `dangerouslySetInnerHTML`.

- [ ] **Step 4: Verify GREEN**

Run Audit test, `pnpm typecheck`, then `pnpm test:autostart`; expected PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/wslc/audit-store.ts src/components/views/audit-view.tsx src/components/app-shell.tsx src/lib/wslc/types.ts tests/audit-view.test.mjs
git commit -m "feat: add audit history view"
```

---

### Task 8: Historical Logs UX, retention startup, migration startup, and storage warnings

**Files:**
- Modify: `src/components/views/logs-view.tsx`
- Modify: `src/components/cube-logs-panel.tsx`
- Modify: `src/components/app-shell.tsx`
- Modify: `src/lib/wslc/log-store.ts`
- Modify: `src/lib/wslc/storage-migration.ts`
- Create: `tests/log-history-ui.test.mjs`
- Modify: `tests/logs-view.test.mjs`
- Modify: `tests/cube-log-side-panel.test.mjs`

**Interfaces:**
- Consumes: persisted log targets/history, `getStorageStats`, `cleanupContainerLogs`, legacy migration.
- Produces startup initialization that imports legacy diagnostics once, runs 30-day/500-MB cleanup, and surfaces `available: false` as a persistent non-blocking storage warning.
- Produces Logs filters for current and removed/stopped historical containers/cubes, search, paging/load-more, and separate clear-container-history action.

- [ ] **Step 1: Write failing historical UX/startup tests**

Assert Logs UI builds filters from persisted targets rather than only live `useWslc().containers`; stopped/removed target labels remain selectable; operation diagnostics are absent; clear history calls container-log clear only; AppShell startup invokes legacy migration and cleanup; unavailable storage renders a warning without hiding/disabling container controls; cube log side panel reads the same persisted container-log source.

- [ ] **Step 2: Verify RED**

Run: `node --test tests/log-history-ui.test.mjs tests/logs-view.test.mjs tests/cube-log-side-panel.test.mjs`

Expected: FAIL on live-only behavior.

- [ ] **Step 3: Implement historical Logs UX and startup maintenance**

At app startup after Tauri availability, run legacy import, then `cleanupContainerLogs({ maxAgeDays: 30, maxPayloadBytes: 500 * 1024 * 1024 })`, then query stats. Keep maintenance failure non-fatal. Logs and cube panel use persisted history and incremental loading; current running containers can still trigger capture refresh. Clear Logs and Clear Audit remain distinct actions with confirmation using the repository's existing dialog conventions.

- [ ] **Step 4: Verify GREEN**

Run focused Node tests, `pnpm typecheck`, and `pnpm test:autostart`; expected PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/views/logs-view.tsx src/components/cube-logs-panel.tsx src/components/app-shell.tsx src/lib/wslc/log-store.ts src/lib/wslc/storage-migration.ts tests
git commit -m "feat: expose persistent log history"
```

---

### Task 9: End-to-end regression contracts, full verification, and documentation

**Files:**
- Create: `tests/audit-container-storage-regression.test.mjs`
- Modify: `tests/run-all.ps1`
- Modify: `README.md` only if current feature overview has a suitable Logs/diagnostics section
- Modify: `docs/privacy.md` to disclose local persistent container/audit logs and clear controls

**Interfaces:**
- Consumes all prior tasks.
- Produces final regression coverage for the approved acceptance criteria.

- [ ] **Step 1: Write the final failing regression contract before documentation changes**

The regression test inspects the integrated code paths and asserts: `quay.db` app-data initialization; SQLite commands are registered; native mutation audit is wired; log refresh persists batches; stop/remove history is queried from SQLite; Audit and Logs are distinct views; retention constants are 30 days/500 MB; legacy migration is wired; storage errors are non-blocking. Add the test to `tests/run-all.ps1` / the relevant aggregate script.

- [ ] **Step 2: Verify the regression test fails for any missing acceptance wiring**

Run: `node --test tests/audit-container-storage-regression.test.mjs`

Expected: FAIL only for any acceptance wiring not yet present. If it unexpectedly passes immediately, inspect the assertions and strengthen them until they prove the integrated behavior rather than mere string presence.

- [ ] **Step 3: Fill any integration gap, then update privacy/docs**

`docs/privacy.md` must state that Quay locally stores audit history and container output in its app-data SQLite database, does not upload it automatically, container logs can contain application secrets, and users can explicitly clear Logs/Audit independently. Keep README changes concise and user-facing; do not expose implementation internals unless useful.

- [ ] **Step 4: Run complete verification**

Run:

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test:autostart
cargo test --manifest-path src-tauri/Cargo.toml
pnpm build:desktop
```

On Windows also run:

```powershell
pnpm test:windows
```

Expected: all commands PASS. Capture exact counts/output in the implementation report; do not claim completion from stale CI.

- [ ] **Step 5: Commit**

```bash
git add tests README.md docs/privacy.md src src-tauri
git commit -m "test: verify durable audit and container logs"
```

---

## Self-Review Results

**Spec coverage:** Tasks 1-3 cover SQLite/schema/query/retention; Task 4 covers native Doing/Done/Error and pulls; Task 5 covers narrow bridge and safe legacy migration; Task 6 covers running capture plus lifecycle drains and dedupe; Tasks 7-8 separate Audit/Logs UX, historical targets, cleanup, warnings; Task 9 covers privacy and all acceptance wiring.

**Placeholder scan:** No TBD/TODO/"similar to" implementation placeholders remain. Each production task specifies a RED command, concrete interface/behavior, GREEN command, and commit.

**Type consistency:** `AuditEvent/AuditQuery`, `ContainerLogRecord/ContainerLogQuery`, `StorageStats`, bridge command names, and retention values are introduced once in Task 5 and consumed consistently afterward. Native storage APIs are introduced in Tasks 1-3 before Tasks 4-5 consume them.

**Ruling:** The spec describes one user capability with tightly coupled persistence/audit/log/UI boundaries. Keep it as one implementation plan rather than split plans, because Tasks 4-8 depend on the same schema and bridge contracts and only the complete chain solves the stopped-container log loss.
