# SQLite Audit and Container Log Storage Design

Date: 2026-08-29
Status: Approved architecture, pending implementation plan
Repository: `dhhieu113pro/quay`

## Goal

Make Quay retain a durable history of what it did and what containers emitted, even when containers stop, are removed, or Quay restarts.

The feature has two distinct user-facing histories:

- **Audit**: what Quay attempted, what completed, and what failed.
- **Logs**: actual container stdout/stderr captured over time.

The current Logs view must no longer depend solely on live `wslc container logs` output from running containers.

## Current State

Quay currently stores operation diagnostics in WebView `localStorage` under `quay.operationLogs`, capped at 500 entries. These entries contain a command and diagnostic text, but they are not a full lifecycle audit model.

The Logs store refreshes container output only for containers whose current status is `running`, using `wslc container logs --timestamps --tail 500` with a non-timestamped fallback. The frontend merges this live output with the persisted operation diagnostics.

Consequences:

- stopped containers are no longer refreshed;
- removed containers lose access to runtime-provided logs;
- container history is bounded by the live CLI tail and WebView lifetime;
- audit events and container output are mixed into one presentation model;
- WebView storage is not the right durability boundary for operational history.

Quay already has a Rust/Tauri backend and resolves `app_data_dir()` during setup, so the native layer is the correct owner for durable storage.

## Chosen Architecture

Use a native SQLite database owned by the Rust/Tauri backend.

Database path:

`<app_data_dir>/quay.db`

Use `rusqlite` with the bundled SQLite feature so Quay does not depend on a separately installed SQLite runtime.

The frontend never opens the database directly. React/Zustand call narrow Tauri commands for reads and mutations. This keeps persistence rules, retention, redaction, transactions, and schema migration in one native boundary.

## Storage Components

Add a native persistence module, for example:

- `src-tauri/src/storage/mod.rs`
- `src-tauri/src/storage/schema.rs`
- `src-tauri/src/storage/audit.rs`
- `src-tauri/src/storage/container_logs.rs`

The module owns one SQLite connection or a small synchronized connection wrapper suitable for Tauri command access. Database initialization happens during app setup before the backend is registered.

SQLite should use:

- WAL journal mode;
- foreign keys enabled;
- busy timeout;
- explicit schema versioning through `PRAGMA user_version` or an equivalent migration table;
- prepared statements for all inserts and queries.

Database failures must never crash Quay or prevent a WSLC command from being attempted. Persistence failures are surfaced as Quay diagnostics and, where possible, as an audit error about storage itself.

## Audit Event Model

Create `audit_events` as an append-oriented lifecycle table.

Suggested columns:

```sql
CREATE TABLE audit_events (
    id TEXT PRIMARY KEY,
    operation_id TEXT NOT NULL,
    ts INTEGER NOT NULL,
    category TEXT NOT NULL,
    action TEXT NOT NULL,
    target_type TEXT,
    target_id TEXT,
    target_name TEXT,
    status TEXT NOT NULL,
    message TEXT,
    command TEXT,
    error TEXT,
    duration_ms INTEGER,
    metadata_json TEXT
);

CREATE INDEX ix_audit_events_ts ON audit_events(ts DESC);
CREATE INDEX ix_audit_events_operation ON audit_events(operation_id, ts);
CREATE INDEX ix_audit_events_target ON audit_events(target_type, target_name, ts DESC);
CREATE INDEX ix_audit_events_status ON audit_events(status, ts DESC);
```

`status` is one of:

- `doing`
- `done`
- `error`

Each user-visible or system-visible operation gets one stable `operation_id` and normally two audit rows.

Successful example:

1. `container.start | postgres | doing`
2. `container.start | postgres | done | duration_ms=842`

Failed example:

1. `container.start | postgres | doing`
2. `container.start | postgres | error | exit code/stderr | duration_ms=391`

Separate rows preserve an immutable history rather than updating a previous record in place. If Quay exits or crashes after writing `doing`, that incomplete event remains evidence that the operation started but never recorded a terminal result.

## Audit Coverage

The first implementation should audit all state-changing workflows that Quay itself initiates:

- container create/run;
- container start;
- container stop;
- container restart;
- container remove;
- cube create/update/start/stop/remove operations where applicable;
- image pull start/completion/failure/cancellation;
- image remove;
- volume create/remove;
- workspace create/move/open operations that mutate local state;
- autostart setting changes;
- explicit log/audit clear operations;
- important backend/storage failures.

Read-only refreshes and ordinary polling should not generate audit rows because they would create noise without user value.

## Audit Data Rules

Commands and messages are redacted before persistence using the existing redaction policy, extended as needed for URL credentials, authorization headers, common token/password/secret environment variables, and registry credentials.

Audit metadata may store structured JSON only for stable, non-secret fields useful for diagnostics, such as exit code, cube ID, image reference, or WSLC operation type.

Do not persist environment-variable dumps, access tokens, authorization headers, or arbitrary request bodies.

## Container Log Model

Create `container_log_lines` for actual container output.

Suggested columns:

```sql
CREATE TABLE container_log_lines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    container_id TEXT,
    container_name TEXT NOT NULL,
    cube_id TEXT,
    cube_name TEXT,
    source_ts INTEGER,
    captured_ts INTEGER NOT NULL,
    stream TEXT NOT NULL,
    text TEXT NOT NULL,
    dedupe_key TEXT NOT NULL UNIQUE
);

CREATE INDEX ix_container_logs_time
    ON container_log_lines(captured_ts DESC);
CREATE INDEX ix_container_logs_container
    ON container_log_lines(container_name, captured_ts DESC);
CREATE INDEX ix_container_logs_cube
    ON container_log_lines(cube_id, captured_ts DESC);
```

`stream` is `stdout`, `stderr`, or `unknown` when WSLC cannot provide a trustworthy stream distinction.

`source_ts` is the timestamp emitted by WSLC/container log output when available. `captured_ts` is when Quay persisted the line.

`container_name` is intentionally stored independently from the current runtime inventory so historical records remain queryable after a container is removed.

## Deduplication

Quay currently retrieves rolling tails, so repeated refreshes can return previously seen lines. SQLite persistence must be idempotent.

Generate `dedupe_key` from stable context such as:

`container identity + source timestamp + stream + line text`

When source timestamps are unavailable, use a session-aware fallback cursor derived from the observed rolling tail and captured sequence. The fallback must not rely only on line text because legitimate applications can emit identical lines repeatedly.

Use `INSERT OR IGNORE` or an equivalent conflict-safe insert so refresh retries cannot multiply rows.

## Capture Lifecycle

### While running

The existing log refresh loop continues to call WSLC for active containers, but newly parsed lines are immediately appended to SQLite in batches.

The UI reads persisted history from SQLite and may merge very recent in-memory rows for responsiveness, but SQLite becomes the authoritative historical source.

### Before stop/restart/remove

For Quay-initiated lifecycle operations, perform a best-effort **pre-operation drain**:

1. read the latest available container tail;
2. persist unseen rows;
3. write the `doing` audit event;
4. execute the lifecycle command.

This captures output that may disappear once the runtime operation completes.

### After stop/restart

Perform a best-effort **post-operation drain** after the WSLC command returns, because some runtimes keep logs readable for stopped containers and may expose final shutdown lines only after exit.

Failure to drain logs must not change the result of the lifecycle operation. It creates a diagnostic/audit storage or capture error instead.

### After remove

Never cascade-delete historical rows when a container disappears from the current inventory. Removed containers remain available as historical log filters.

## Query API

Expose focused Tauri commands. Exact names may follow current repository conventions, but the responsibilities are:

- query audit events with paging and filters;
- query container log rows with paging and filters;
- append audit lifecycle entries from native operation execution;
- append batches of container log rows;
- request retention cleanup;
- clear container logs after explicit user confirmation;
- clear audit history after explicit user confirmation;
- return storage statistics such as database size and row counts.

Frontend commands should not accept arbitrary SQL.

## Audit Integration Boundary

Audit lifecycle recording should be as close as possible to the native command execution boundary instead of scattered across React click handlers.

For generic WSLC mutations, wrap execution with an operation context that knows:

- action;
- target type/name;
- sanitized command description;
- stable operation ID;
- start time.

The wrapper writes `doing`, executes WSLC, then writes `done` or `error` with duration and sanitized result details.

Subsystems that bypass the generic executor, such as the native pull manager, use the same audit repository directly so they produce identical audit semantics.

The frontend may provide friendly operation metadata, but native code is responsible for recording the terminal outcome because it sees the actual process result.

## Frontend UX

### Logs view

The Logs view becomes container-output-only.

It should support:

- running and stopped/removed historical containers;
- cube filter;
- container filter;
- text search;
- chronological display;
- paging or incremental loading from SQLite;
- a clear-history action separate from audit clearing;
- an indicator when a row is historical rather than newly captured live output, if useful.

The current persisted operation diagnostics are removed from the Logs feed once migration is complete.

### Audit view

Add a dedicated **Audit** navigation item/view.

Each row shows:

- timestamp;
- status (`Doing`, `Done`, `Error`);
- action;
- target;
- duration for terminal events when available;
- concise message.

Rows can expand to show sanitized command, error details, and structured metadata.

Filters:

- status;
- category/action;
- target/container/cube;
- text search;
- time range.

Use clear status distinction, but do not rely on color alone.

## Retention

### Container logs

Default retention:

- keep 30 days;
- enforce a global container-log storage budget of 500 MB.

Both values should be represented as configuration constants/settings so a later UI can expose them without redesigning persistence.

Cleanup policy:

1. delete rows older than the configured age;
2. if estimated DB/log storage still exceeds the configured budget, delete oldest container-log rows in bounded batches until under budget;
3. run cleanup at startup and periodically after successful log batches, not for every inserted line;
4. checkpoint WAL when useful;
5. do not run `VACUUM` on every cleanup because it is expensive. A manual maintenance action or infrequent threshold-based vacuum may be added later.

### Audit

Audit records are retained indefinitely by default.

They are deleted only by an explicit user clear action. A future export/retention setting is out of scope for the first implementation.

## Migration from Existing Operation Logs

On first startup after SQLite support is introduced:

1. frontend/native bridge reads the existing `quay.operationLogs` localStorage entries once;
2. transform each valid legacy entry into an audit event with category `legacy`, status `error` or `done` only when the existing data proves it; otherwise use a neutral migration message without fabricating an outcome;
3. preserve timestamp, container name, sanitized command, and text;
4. write a migration marker in SQLite so import is idempotent;
5. after successful import, delete the legacy localStorage key.

If migration fails, leave localStorage untouched and retry on a later startup.

No existing legacy entry may be silently discarded before SQLite confirms the import transaction committed.

## Failure Handling

Logging and auditing are observability features and must not become a reason container operations stop working.

Rules:

- SQLite initialization failure: Quay remains usable, surfaces a persistent storage warning, and falls back to session-only logging where practical.
- Audit insert failure before a WSLC command: execute the requested command anyway, then surface the storage failure.
- Container-log batch insert failure: retain UI/live data for the session and retry on future refreshes where practical.
- Corrupt DB: close it, preserve the file for diagnosis, create a new database only after a clearly defined recovery path; never silently delete corruption evidence.
- Migration failure: keep source data and retry later.
- Retention failure: report it but do not block normal operations.

## Concurrency and Transactions

Use short SQLite transactions.

Batch container-log inserts in one transaction per refresh/container batch.

Audit start/terminal rows do not need to be in one transaction because preserving a standalone `doing` record is valuable if the process terminates unexpectedly.

Serialize schema migration and destructive maintenance operations. Normal reads may proceed concurrently according to the chosen connection strategy.

## Testing Strategy

### Rust unit/integration tests

Use temporary SQLite databases to verify:

- schema creation and migration versioning;
- audit `doing -> done` lifecycle;
- audit `doing -> error` lifecycle;
- incomplete `doing` persistence;
- secret redaction before storage;
- container log batch inserts;
- duplicate suppression;
- identical repeated application lines are not incorrectly collapsed when sequence context differs;
- stopped/removed container history remains queryable;
- 30-day cleanup;
- size-budget cleanup ordering;
- legacy import idempotency;
- failed migration leaves source data eligible for retry;
- paging/filter queries.

### Frontend tests

Verify:

- Logs no longer mixes operation diagnostics with container stdout/stderr;
- historical stopped/removed containers can be selected;
- Audit renders Doing/Done/Error states;
- audit filters and expandable details work;
- clear Logs and clear Audit are separate actions;
- UI handles storage-unavailable state without breaking container controls.

### Lifecycle regression tests

Cover the critical user problem:

1. run a container that emits known output;
2. capture logs;
3. stop the container;
4. refresh Quay state;
5. confirm the output is still returned from SQLite;
6. restart Quay/storage state;
7. confirm the same historical output remains available.

Also verify a failed start/stop operation produces `doing` followed by `error` with a sanitized error message.

## Security and Privacy

The database lives only in Quay's application data directory and is not uploaded automatically.

Because container output itself may contain application secrets, the container-log store is not subjected to broad regex redaction that could alter legitimate log content. Audit command/error fields are redacted because Quay controls those fields and knows they can contain credentials.

The UI should make clear that container logs are persisted locally and provide an explicit clear action.

## Non-Goals for the First Implementation

- remote log shipping;
- cloud synchronization;
- multi-machine audit aggregation;
- full-text-search extensions such as SQLite FTS5 unless ordinary indexed/paged querying proves insufficient;
- per-container retention settings;
- compressed archival files;
- audit cryptographic signing/tamper evidence;
- retaining logs after manual user clearing.

## Acceptance Criteria

The feature is complete when:

1. Quay creates and migrates `quay.db` under its app-data directory.
2. Every supported state-changing Quay operation records `doing` and then `done` or `error` with a stable operation ID.
3. Audit commands/errors are sanitized before persistence.
4. Container stdout/stderr is incrementally persisted while containers run.
5. Quay performs best-effort lifecycle drains around stop/restart/remove.
6. Logs remain available after a container stops, is removed, and after Quay restarts.
7. Logs and Audit are separate views and separate persistence/query concepts.
8. Container-log retention defaults to 30 days and a 500 MB global budget.
9. Audit history has no automatic retention in the first release.
10. Existing `quay.operationLogs` entries are migrated without deleting source data before a successful transaction.
11. SQLite/storage failures do not prevent requested WSLC operations.
12. Automated tests cover persistence, deduplication, retention, migration, audit lifecycle, and the stopped-container regression.
