# Global Image Search and Background Pulls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move image discovery to the Quay title bar, add Docker Hub suggestions, and run WSLC image pulls as native background jobs with live progress and a global Downloads panel.

**Architecture:** A native Rust `PullManager` owns queueing, process execution, cancellation, persistence, and job events. Docker Hub search is native to avoid WebView CORS. React/Zustand stays the UI-facing state layer and reconciles native pull jobs through focused Tauri commands/events.

**Tech Stack:** Tauri 2, Rust 2021, `serde`/`serde_json`, `reqwest`, React 19, TypeScript, Zustand 5, Radix Popover, Tailwind CSS 4, Node test runner, existing Quay WSLC CLI integration.

**Spec:** `docs/superpowers/specs/2026-08-28-image-search-background-pulls-design.md`

## Global Constraints

- Docker Hub is the only search provider in this scope.
- Any non-empty typed reference remains directly pullable, including `ghcr.io/...` and custom registries.
- Maximum concurrent pull count is exactly 2; excess jobs remain `queued`.
- A duplicate non-terminal job for the same trimmed reference must reuse the existing job.
- Pulls must execute outside the existing `WslcExecutor` mutation mutex.
- Never fabricate progress: determinate percentage exists only when trusted byte totals are available; otherwise use indeterminate progress and stage text.
- Window close continues to hide Quay to tray and must not cancel pulls.
- Explicit application Quit must request cancellation and wait for Quay-owned pull processes to terminate before executor shutdown, bounded by a short shutdown timeout.
- Persisted non-terminal jobs become `interrupted` on process restart; downloads do not resume after process exit.
- Keep all active jobs plus at most the latest 50 terminal jobs.
- Pull-history persistence failure is nonfatal: log it and keep the in-memory job running.
- Preserve existing image removal, volume, container, session, cube, tray, and caption-button behavior.
- Follow TDD: failing test first, verify failure, minimal implementation, verify passing tests, commit.

---

## File Map

### Native

- `src-tauri/src/docker_hub.rs` — Docker Hub response DTOs, mapping, HTTP search.
- `src-tauri/src/pull_manager.rs` — pull model, parser, queue, process executor, cancellation, persistence, event sink.
- `src-tauri/src/lib.rs` — owns native pull manager, Tauri commands/events, shutdown integration.
- `src-tauri/Cargo.toml` / `src-tauri/Cargo.lock` — `reqwest` dependency.

### Frontend bridge/state

- `src/lib/wslc/types.ts` — `PullJobStatus`, expanded `PullJob`, `ImageSearchResult`.
- `src/lib/tauri.ts` — focused search/pull commands and pull-event listener.
- `src/lib/wslc/store.ts` — native job reconciliation, commands, completion inventory refresh, failed-pull toast routing.

### UI

- `src/components/image-search.tsx` — debounced suggestions, stale-response guard, keyboard/mouse selection, direct ref submission.
- `src/components/ui/popover.tsx` — focused Radix wrapper.
- `src/components/pull-progress.tsx` — determinate/indeterminate rendering.
- `src/components/downloads-panel.tsx` — Active/Recent jobs, cancel, clear history, View images.
- `src/components/downloads-button.tsx` — icon + active badge + popover.
- `src/components/app-shell.tsx` — top-bar composition and one native event subscription.
- `src/components/views/images-view.tsx` — inventory/volumes only; page-local pull form removed.

### Tests

- `tests/image-pull-contracts.test.mjs`
- `tests/image-search-ui.test.mjs`
- `tests/downloads-ui.test.mjs`
- update `tests/operation-ux.test.mjs`
- native tests colocated in `docker_hub.rs` and `pull_manager.rs`
- update `package.json` so the existing `test:autostart` CI gate runs the new tests.

---

### Task 1: Define frontend pull/search contracts and bridge functions

**Files:**
- Modify: `src/lib/wslc/types.ts`
- Modify: `src/lib/tauri.ts`
- Create: `tests/image-pull-contracts.test.mjs`

**Interfaces:**
- Produces `PullJobStatus`, `PullJob`, `ImageSearchResult`.
- Produces `imageSearch`, `pullStart`, `pullList`, `pullCancel`, `pullClearHistory`, `onPullJobUpdated`.

- [ ] **Step 1: Write the failing contract test**

Create `tests/image-pull-contracts.test.mjs`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const types = await readFile(new URL("../src/lib/wslc/types.ts", import.meta.url), "utf8");
const tauri = await readFile(new URL("../src/lib/tauri.ts", import.meta.url), "utf8");

test("pull jobs expose the background lifecycle", () => {
  for (const status of ["queued", "pulling", "completed", "failed", "cancelling", "cancelled", "interrupted"]) {
    assert.match(types, new RegExp(`"${status}"`));
  }
  assert.match(types, /currentBytes: number/);
  assert.match(types, /totalBytes\?: number/);
  assert.match(types, /progress\?: number/);
  assert.match(types, /bytesPerSecond\?: number/);
});

test("tauri bridge exposes focused search and pull APIs", () => {
  for (const command of ["image_search", "pull_start", "pull_list", "pull_cancel", "pull_clear_history"]) {
    assert.match(tauri, new RegExp(`"${command}"`));
  }
  assert.match(tauri, /quay:\/\/pull-job-updated/);
});
```

- [ ] **Step 2: Verify the test fails**

```bash
node --test tests/image-pull-contracts.test.mjs
```

Expected: FAIL because the contracts/bridge are not implemented.

- [ ] **Step 3: Expand `types.ts`**

Replace the minimal `PullJob` with:

```ts
export type PullJobStatus =
  | "queued"
  | "pulling"
  | "completed"
  | "failed"
  | "cancelling"
  | "cancelled"
  | "interrupted";

export interface PullJob {
  id: string;
  reference: string;
  status: PullJobStatus;
  currentBytes: number;
  totalBytes?: number;
  progress?: number;
  bytesPerSecond?: number;
  startedAt?: number;
  createdAt: number;
  updatedAt: number;
  finishedAt?: number;
  message?: string;
  error?: string;
}

export interface ImageSearchResult {
  name: string;
  description: string;
  official: boolean;
  stars?: number;
  pulls?: number;
  updatedAt?: string;
}
```

- [ ] **Step 4: Add bridge functions to `tauri.ts`**

```ts
import type { ImageSearchResult, PullJob } from "@/lib/wslc/types";

export async function imageSearch(query: string): Promise<ImageSearchResult[]> {
  const value = query.trim();
  if (!value || !isTauri()) return [];
  return invokeNative<ImageSearchResult[]>("image_search", { query: value });
}

export async function pullStart(reference: string): Promise<PullJob> {
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
```

Keep `invokeWslcHost` for existing short WSLC operations.

- [ ] **Step 5: Verify Task 1**

```bash
node --test tests/image-pull-contracts.test.mjs
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/wslc/types.ts src/lib/tauri.ts tests/image-pull-contracts.test.mjs
git commit -m "feat: define background pull frontend contracts"
```

---

### Task 2: Add native Docker Hub search

**Files:**
- Create: `src-tauri/src/docker_hub.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/Cargo.lock`

**Interfaces:**
- Produces `pub async fn search(query: &str) -> Result<Vec<ImageSearchResult>, String>`.
- `ImageSearchResult` serializes with camelCase matching Task 1.

- [ ] **Step 1: Write failing mapping tests**

Start `docker_hub.rs` with DTOs and:

```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_docker_hub_result() {
        let raw = r#"{"results":[{"repo_name":"nginx","short_description":"Official build","is_official":true,"star_count":21000,"pull_count":1000000,"last_updated":"2026-08-20T00:00:00Z"}]}"#;
        let result = map_response(raw).unwrap();
        assert_eq!(result[0].name, "nginx");
        assert!(result[0].official);
        assert_eq!(result[0].pulls, Some(1_000_000));
    }

    #[test]
    fn trims_and_rejects_empty_query() {
        assert_eq!(normalize_query(" nginx ").as_deref(), Some("nginx"));
        assert!(normalize_query("   ").is_none());
    }
}
```

- [ ] **Step 2: Verify failure**

```bash
cargo test --manifest-path src-tauri/Cargo.toml docker_hub
```

Expected: FAIL for missing mapper/normalizer.

- [ ] **Step 3: Implement DTO mapping and search**

Use:

```rust
use serde::{Deserialize, Serialize};

const SEARCH_URL: &str = "https://hub.docker.com/v2/search/repositories/";

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ImageSearchResult {
    pub name: String,
    pub description: String,
    pub official: bool,
    pub stars: Option<u64>,
    pub pulls: Option<u64>,
    pub updated_at: Option<String>,
}

#[derive(Deserialize)]
struct SearchResponse { results: Vec<SearchRow> }

#[derive(Deserialize)]
struct SearchRow {
    repo_name: String,
    short_description: Option<String>,
    is_official: Option<bool>,
    star_count: Option<u64>,
    pull_count: Option<u64>,
    last_updated: Option<String>,
}

fn normalize_query(query: &str) -> Option<String> {
    let query = query.trim();
    (!query.is_empty()).then(|| query.to_string())
}

fn map_response(raw: &str) -> Result<Vec<ImageSearchResult>, String> {
    let response: SearchResponse = serde_json::from_str(raw)
        .map_err(|e| format!("invalid Docker Hub search response: {e}"))?;
    Ok(response.results.into_iter().take(8).map(|row| ImageSearchResult {
        name: row.repo_name,
        description: row.short_description.unwrap_or_default(),
        official: row.is_official.unwrap_or(false),
        stars: row.star_count,
        pulls: row.pull_count,
        updated_at: row.last_updated,
    }).collect())
}

pub async fn search(query: &str) -> Result<Vec<ImageSearchResult>, String> {
    let Some(query) = normalize_query(query) else { return Ok(Vec::new()); };
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()
        .map_err(|e| format!("could not create Docker Hub client: {e}"))?;
    let response = client.get(SEARCH_URL)
        .query(&[("query", query.as_str()), ("page_size", "8")])
        .send().await
        .map_err(|e| format!("Docker Hub search failed: {e}"))?;
    if !response.status().is_success() {
        return Err(format!("Docker Hub search returned HTTP {}", response.status()));
    }
    map_response(&response.text().await.map_err(|e| format!("could not read Docker Hub response: {e}"))?)
}
```

Add:

```toml
reqwest = { version = "0.12", default-features = false, features = ["json", "rustls-tls"] }
```

- [ ] **Step 4: Wire `image_search`**

In `lib.rs`:

```rust
mod docker_hub;

#[tauri::command]
async fn image_search(query: String) -> Result<Vec<docker_hub::ImageSearchResult>, String> {
    docker_hub::search(&query).await
}
```

Add `image_search` to `tauri::generate_handler!`.

- [ ] **Step 5: Verify Task 2**

```bash
cargo test --manifest-path src-tauri/Cargo.toml
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/docker_hub.rs src-tauri/src/lib.rs src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "feat: add Docker Hub image search"
```

---

### Task 3: Add pull model, progress parser, persistence, and history pruning

**Files:**
- Create: `src-tauri/src/pull_manager.rs`
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Produces `PullJobStatus`, `PullJob`, `ProgressUpdate`.
- Produces `parse_progress_fragment`, `load_jobs`, `save_jobs`, `prune_history`.

- [ ] **Step 1: Write failing parser/restart/history tests**

Use these contract shapes:

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum PullJobStatus { Queued, Pulling, Completed, Failed, Cancelling, Cancelled, Interrupted }

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PullJob {
    pub id: String,
    pub reference: String,
    pub status: PullJobStatus,
    pub current_bytes: u64,
    pub total_bytes: Option<u64>,
    pub progress: Option<f64>,
    pub bytes_per_second: Option<u64>,
    pub started_at: Option<u64>,
    pub created_at: u64,
    pub updated_at: u64,
    pub finished_at: Option<u64>,
    pub message: Option<String>,
    pub error: Option<String>,
}
```

Tests must assert:

```rust
#[test]
fn byte_fraction_is_determinate() {
    let update = parse_progress_fragment("Downloading 12.5 MB / 50 MB");
    assert_eq!(update.current_bytes, Some(13_107_200));
    assert_eq!(update.total_bytes, Some(52_428_800));
    assert_eq!(update.progress, Some(25.0));
}

#[test]
fn stage_only_output_stays_indeterminate() {
    let update = parse_progress_fragment("Pulling fs layer");
    assert_eq!(update.progress, None);
    assert_eq!(update.message.as_deref(), Some("Pulling fs layer"));
}

#[test]
fn restart_marks_active_job_interrupted() {
    let jobs = normalize_loaded_jobs(vec![sample_job(PullJobStatus::Pulling)], 2000);
    assert_eq!(jobs[0].status, PullJobStatus::Interrupted);
    assert_eq!(jobs[0].finished_at, Some(2000));
}

#[test]
fn pruning_keeps_all_active_and_only_fifty_terminal_jobs() {
    let mut jobs = (0..55).map(|i| terminal_job(i)).collect::<Vec<_>>();
    jobs.push(sample_job(PullJobStatus::Pulling));
    prune_history(&mut jobs);
    assert_eq!(jobs.iter().filter(|j| is_terminal(&j.status)).count(), 50);
    assert_eq!(jobs.iter().filter(|j| !is_terminal(&j.status)).count(), 1);
}
```

- [ ] **Step 2: Verify failure**

```bash
cargo test --manifest-path src-tauri/Cargo.toml pull_manager
```

- [ ] **Step 3: Implement trusted byte parsing**

Implement `B`, `KB`, `MB`, `GB` conversion and only set progress when both sides of `current / total` parse. All unrecognized non-empty text becomes `message` with `progress = None`.

```rust
#[derive(Debug, Clone, Default, PartialEq)]
pub struct ProgressUpdate {
    pub current_bytes: Option<u64>,
    pub total_bytes: Option<u64>,
    pub progress: Option<f64>,
    pub message: Option<String>,
}
```

Do not assume a WSLC JSON flag. The system executor in Task 4 feeds whatever stdout/stderr WSLC currently emits into this parser.

- [ ] **Step 4: Implement persistence and pruning**

Required behavior:

```rust
fn is_terminal(status: &PullJobStatus) -> bool {
    matches!(status, PullJobStatus::Completed | PullJobStatus::Failed | PullJobStatus::Cancelled | PullJobStatus::Interrupted)
}

fn prune_history(jobs: &mut Vec<PullJob>) {
    let mut terminal = jobs.iter().filter(|j| is_terminal(&j.status)).cloned().collect::<Vec<_>>();
    terminal.sort_by_key(|j| std::cmp::Reverse(j.updated_at));
    terminal.truncate(50);
    let mut active = jobs.iter().filter(|j| !is_terminal(&j.status)).cloned().collect::<Vec<_>>();
    active.extend(terminal);
    *jobs = active;
}
```

`normalize_loaded_jobs` changes every non-terminal persisted job to `Interrupted`, sets `updated_at`/`finished_at` to `now`, sets error to `Quay exited before this pull finished`, then prunes.

`save_jobs(path, jobs)` writes pretty JSON and returns `Result<(), String>`. `load_jobs(path, now)` returns `Vec::new()` when the file does not exist and treats malformed history as empty instead of preventing app startup.

Add a round-trip test using a unique `std::env::temp_dir()` file and delete it afterward.

- [ ] **Step 5: Register the module without platform-gating the model/tests**

Add:

```rust
mod pull_manager;
```

Windows-only process details remain guarded inside `pull_manager.rs`; keeping the module itself unconditional avoids command/type divergence.

- [ ] **Step 6: Verify and commit**

```bash
cargo test --manifest-path src-tauri/Cargo.toml
git add src-tauri/src/pull_manager.rs src-tauri/src/lib.rs
git commit -m "feat: add pull job model and persistence"
```

---

### Task 4: Implement the two-slot native pull scheduler, process runner, cancellation, and blocking shutdown

**Files:**
- Modify: `src-tauri/src/pull_manager.rs`

**Interfaces:**
- Produces `PullExecutor`, `PullEventSink`, `PullManager`.
- `PullManager` API:

```rust
pub fn new(history_path: PathBuf, executor: Arc<dyn PullExecutor>, sink: Arc<dyn PullEventSink>, concurrency: usize) -> Self;
pub fn start(&self, reference: &str) -> Result<PullJob, String>;
pub fn list(&self) -> Vec<PullJob>;
pub fn cancel(&self, id: &str) -> Result<PullJob, String>;
pub fn clear_history(&self) -> Vec<PullJob>;
pub fn shutdown(&self);
```

- [ ] **Step 1: Write failing scheduler tests with a fake executor**

Interfaces:

```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PullExecution { Completed, Cancelled }

pub trait PullExecutor: Send + Sync + 'static {
    fn execute(
        &self,
        reference: &str,
        cancelled: Arc<AtomicBool>,
        on_progress: Arc<dyn Fn(ProgressUpdate) + Send + Sync>,
    ) -> Result<PullExecution, String>;
}

pub trait PullEventSink: Send + Sync + 'static {
    fn emit(&self, job: &PullJob);
}
```

Fake-executor tests must cover:

```rust
#[test]
fn two_run_and_third_waits() { /* start 3, fake blocks, assert 2 Pulling + 1 Queued */ }

#[test]
fn duplicate_active_reference_reuses_job_id() { /* " nginx:latest " and "nginx:latest" => same id */ }

#[test]
fn cancelling_running_job_starts_next_queued_job() { /* cancel first, fake observes cancellation, third starts */ }

#[test]
fn queued_cancel_never_calls_executor() { /* third queued, cancel it, assert fake never starts it */ }

#[test]
fn shutdown_waits_until_running_fake_jobs_observe_cancellation() { /* shutdown returns only after fake active count reaches zero */ }
```

Implement the bodies directly in the test module with a `FakeExecutor` using `Mutex`, `Condvar`, and cancellation polling; do not use real WSLC/network in unit tests.

- [ ] **Step 2: Verify failure**

```bash
cargo test --manifest-path src-tauri/Cargo.toml pull_manager
```

- [ ] **Step 3: Implement queue state**

Use:

```rust
struct PullState {
    jobs: Vec<PullJob>,
    running: std::collections::HashSet<String>,
    cancellations: std::collections::HashMap<String, Arc<AtomicBool>>,
}

struct PullManagerInner {
    state: Mutex<PullState>,
    changed: Condvar,
    executor: Arc<dyn PullExecutor>,
    sink: Arc<dyn PullEventSink>,
    history_path: PathBuf,
    concurrency: usize,
    sequence: AtomicU64,
    shutting_down: AtomicBool,
}
```

`start` trims, rejects empty, reuses an existing `Queued`/`Pulling`/`Cancelling` job for the same reference, otherwise creates `Queued`, emits, persists, then schedules.

`schedule` starts jobs while `running.len() < concurrency`, marks `Pulling`, sets `started_at`, creates cancellation flag, emits, persists, and spawns one thread per job. Completion updates terminal state, removes running/cancellation entries, calls `changed.notify_all()`, prunes, persists, emits, then schedules the next queued job unless shutting down.

Use a helper:

```rust
fn persist_nonfatal(&self, jobs: &[PullJob]) {
    if let Err(error) = save_jobs(&self.inner.history_path, jobs) {
        eprintln!("pull history: {error}");
    }
}
```

- [ ] **Step 4: Apply progress updates without excessive persistence**

Each `ProgressUpdate` updates the in-memory job and emits a job snapshot. Persist progress snapshots no more often than once per second per job; state transitions persist immediately. This keeps crash metadata useful without writing the JSON file on every carriage-return fragment.

If successive trusted `current_bytes` updates have a positive time delta, compute `bytes_per_second = delta_bytes * 1000 / delta_ms`; otherwise leave it `None`.

- [ ] **Step 5: Implement `SystemPullExecutor`**

Launch:

```rust
let mut command = Command::new("wslc");
command.args(["pull", reference])
    .stdin(Stdio::null())
    .stdout(Stdio::piped())
    .stderr(Stdio::piped());
#[cfg(windows)] {
    use std::os::windows::process::CommandExt;
    command.creation_flags(0x0800_0000);
}
```

Read stdout/stderr concurrently and split fragments on both `\n` and `\r`. Forward every non-empty fragment through `parse_progress_fragment`.

Poll `try_wait()` about every 50 ms. On cancellation:

```rust
#[cfg(windows)]
{
    let pid = child.id().to_string();
    let _ = Command::new("taskkill")
        .args(["/PID", &pid, "/T", "/F"])
        .stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).status();
}
let _ = child.kill();
let _ = child.wait();
return Ok(PullExecution::Cancelled);
```

Zero exit => `Completed`; non-zero exit => `Err` containing the stderr summary.

- [ ] **Step 6: Implement cancel/clear/shutdown exactly**

- Queued cancel: immediately `Cancelled`, never starts.
- Running cancel: transition to `Cancelling`, emit/persist, then set cancellation flag; executor completion produces `Cancelled`.
- `clear_history`: remove `Completed`, `Failed`, `Cancelled`, `Interrupted`; never remove active jobs.
- `shutdown`: set `shutting_down`, mark queued jobs `Cancelled`, set all active cancellation flags, then wait on `changed` until `running.is_empty()` or 5 seconds have elapsed. Log a warning if the timeout expires. Do not schedule new jobs during shutdown.

- [ ] **Step 7: Verify and commit**

```bash
cargo test --manifest-path src-tauri/Cargo.toml
git add src-tauri/src/pull_manager.rs
git commit -m "feat: run image pulls as background jobs"
```

---

### Task 5: Wire native pull commands/events and Zustand reconciliation

**Files:**
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/lib/wslc/store.ts`
- Modify: `tests/image-pull-contracts.test.mjs`
- Modify: `tests/operation-ux.test.mjs`

**Interfaces:**
- Native commands: `pull_start`, `pull_list`, `pull_cancel`, `pull_clear_history`.
- Zustand actions: `startPull`, `cancelPull`, `clearPullHistory`, `syncPullJobs`, `applyPullJobUpdate`.

- [ ] **Step 1: Extend failing source-contract tests**

Add assertions that `lib.rs` contains all four pull command functions plus `pull_manager.shutdown()`, and `store.ts` contains all five Zustand actions while no longer routing image pulls through `runOperation`.

Replace the old `operation-ux` pull assertion with:

```js
test("image pulling is not tracked by generic operations", () => {
  assert.doesNotMatch(store, /runOperation\(`image:\$\{ref\}`/);
  assert.match(images, /removeImage/);
});
```

- [ ] **Step 2: Verify failure**

```bash
node --test tests/image-pull-contracts.test.mjs tests/operation-ux.test.mjs
```

- [ ] **Step 3: Construct the native manager in Tauri setup**

Add a Tauri event sink:

```rust
#[cfg(windows)]
#[derive(Clone)]
struct TauriPullSink(AppHandle);

#[cfg(windows)]
impl pull_manager::PullEventSink for TauriPullSink {
    fn emit(&self, job: &pull_manager::PullJob) {
        let _ = self.0.emit("quay://pull-job-updated", job.clone());
    }
}
```

Extend `Backend` with `#[cfg(windows)] pull_manager: pull_manager::PullManager`.

Change `Backend::new` to accept the manager on Windows. In `.setup`:

```rust
#[cfg(windows)]
let pull_manager = {
    let history_path = app.path().app_data_dir()?.join("pull-jobs.json");
    pull_manager::PullManager::new(
        history_path,
        Arc::new(pull_manager::SystemPullExecutor),
        Arc::new(TauriPullSink(app.handle().clone())),
        2,
    )
};
#[cfg(windows)]
app.manage(Backend::new(pull_manager));
#[cfg(not(windows))]
app.manage(Backend::new());
```

Keep existing executor/host construction semantics inside `Backend::new`.

- [ ] **Step 4: Add platform-safe pull commands**

Follow the same `#[cfg(windows)]` body pattern already used by `wslc_invoke` so command names still compile cross-platform:

```rust
#[tauri::command]
fn pull_start(backend: State<'_, Backend>, reference: String) -> Result<pull_manager::PullJob, String> {
    #[cfg(windows)] { return backend.pull_manager.start(&reference); }
    #[cfg(not(windows))] { let _ = backend; let _ = reference; Err("WSLC pulls are only available on Windows".into()) }
}
```

Implement equivalent `pull_list`, `pull_cancel`, `pull_clear_history`, add all four to `generate_handler!`.

In the existing app exit handler, call `pull_manager.shutdown()` before `executor.shutdown()`.

- [ ] **Step 5: Replace Zustand `pullImage` with native actions**

Remove `pullImage` and remove `"pulling"` from `OperationStatus`.

Add:

```ts
startPull: (reference: string) => Promise<PullJob | null>;
cancelPull: (id: string) => Promise<void>;
clearPullHistory: () => Promise<void>;
syncPullJobs: () => Promise<void>;
applyPullJobUpdate: (job: PullJob) => void;
```

Use:

```ts
const upsertPull = (pulls: PullJob[], job: PullJob) => {
  const index = pulls.findIndex((item) => item.id === job.id);
  if (index < 0) return [job, ...pulls];
  const next = pulls.slice();
  next[index] = job;
  return next;
};
```

`applyPullJobUpdate` must:

```ts
applyPullJobUpdate: (job) => {
  const previous = get().pulls.find((item) => item.id === job.id);
  set((state) => ({ pulls: upsertPull(state.pulls, job) }));
  if (job.status === "completed" && previous?.status !== "completed") void refreshInventory();
  if (job.status === "failed" && previous?.status !== "failed") {
    set({ lastError: job.error || `Pull ${job.reference} failed` });
  }
},
```

This deliberately reuses the existing `lastError` → Sonner error-toast path for failed pulls. Search errors remain local to the search dropdown.

- [ ] **Step 6: Implement the remaining store actions**

`startPull` trims/rejects empty, invokes `pullStart`, then upserts returned job. `syncPullJobs` replaces `pulls` from `pullList`. `cancelPull` upserts returned job. `clearPullHistory` replaces `pulls` with the returned native list. Native bridge errors set `lastError`.

- [ ] **Step 7: Verify and commit**

```bash
node --test tests/image-pull-contracts.test.mjs tests/operation-ux.test.mjs
pnpm typecheck
cargo test --manifest-path src-tauri/Cargo.toml
git add src-tauri/src/lib.rs src/lib/wslc/store.ts tests/image-pull-contracts.test.mjs tests/operation-ux.test.mjs
git commit -m "feat: synchronize native pull jobs with Quay state"
```

---

### Task 6: Move Docker Hub image search into the title bar

**Files:**
- Create: `src/components/image-search.tsx`
- Modify: `src/components/app-shell.tsx`
- Modify: `src/components/views/images-view.tsx`
- Create: `tests/image-search-ui.test.mjs`

**Interfaces:**
- `ImageSearch({ disabled?: boolean, className?: string })`.
- Consumes `imageSearch()` and `startPull()`.

- [ ] **Step 1: Write failing UI contracts**

Create `tests/image-search-ui.test.mjs` asserting:

```js
assert.match(shell, /<ImageSearch/);
assert.match(search, /Search Docker Hub images/);
assert.match(search, /300/);
assert.match(search, /ArrowDown|ArrowUp/);
assert.match(search, /Enter/);
assert.match(search, /requestId/);
assert.doesNotMatch(images, /pull-catalog/);
assert.doesNotMatch(images, /pullImage/);
```

Also assert the search component calls `startPull(value)` for direct typed refs and `${result.name}:latest` for selected Docker Hub results.

- [ ] **Step 2: Verify failure**

```bash
node --test tests/image-search-ui.test.mjs
```

- [ ] **Step 3: Implement debounce/stale-result handling**

Use component-local query/results/open/error/highlight state. In the effect, invalidate the request ID before checking whether the query became empty:

```ts
const requestId = useRef(0);

useEffect(() => {
  const id = ++requestId.current;
  const value = query.trim();
  if (!value || disabled) {
    setResults([]);
    setSearchError(null);
    setOpen(false);
    return;
  }
  const timer = window.setTimeout(() => {
    void imageSearch(value)
      .then((next) => {
        if (id !== requestId.current) return;
        setResults(next.slice(0, 8));
        setHighlighted(-1);
        setSearchError(null);
        setOpen(true);
      })
      .catch((error) => {
        if (id !== requestId.current) return;
        setResults([]);
        setHighlighted(-1);
        setSearchError(error instanceof Error ? error.message : String(error));
        setOpen(true);
      });
  }, 300);
  return () => window.clearTimeout(timer);
}, [query, disabled]);
```

Keyboard semantics:

- Up/Down changes `highlighted` and prevents default.
- Escape closes.
- Enter with highlighted result => `startPull(`${result.name}:latest`)`.
- Enter without highlighted result => `startPull(query.trim())` for any non-empty value.
- Clicking result => `startPull(`${result.name}:latest`)`.

Search failure is displayed in the dropdown and does not disable direct Enter.

Render name, description, Official badge, and pulls/stars/updated metadata only when present.

- [ ] **Step 4: Compose search into `Titlebar` and respect WSLC gate**

`Titlebar` already knows `gated`. Place:

```tsx
<div className="flex min-w-0 flex-1 justify-center px-4">
  <ImageSearch disabled={gated} className="w-full max-w-xl" />
</div>
```

between Quay identity and right-side controls. Keep interactive search elements free of `data-tauri-drag-region`.

- [ ] **Step 5: Remove the Images-page pull form**

Remove local image ref state, `catalog`, `pullImage`, datalist, pull status, Pull button/form. Keep image removal and all volume behavior.

Change intro copy to:

```tsx
<p className="mt-1 text-sm text-muted-foreground">
  Search and pull images from the title bar. Manage local images and volumes here.
</p>
```

- [ ] **Step 6: Verify and commit**

```bash
node --test tests/image-search-ui.test.mjs
pnpm typecheck
git add src/components/image-search.tsx src/components/app-shell.tsx src/components/views/images-view.tsx tests/image-search-ui.test.mjs
git commit -m "feat: move image search into title bar"
```

---

### Task 7: Add Downloads icon, panel, live progress, and pull-event subscription

**Files:**
- Create: `src/components/ui/popover.tsx`
- Create: `src/components/pull-progress.tsx`
- Create: `src/components/downloads-panel.tsx`
- Create: `src/components/downloads-button.tsx`
- Modify: `src/components/app-shell.tsx`
- Create: `tests/downloads-ui.test.mjs`

**Interfaces:**
- Downloads badge counts exactly `queued`, `pulling`, `cancelling`.
- Downloads button is immediately before `AppearanceToggle` and is shown only when WSLC is ready.

- [ ] **Step 1: Write failing Downloads UI tests**

Create `tests/downloads-ui.test.mjs` asserting:

```js
assert.match(shell, /<DownloadsButton[\s\S]*<AppearanceToggle compact/);
for (const state of ["queued", "pulling", "cancelling"]) assert.match(button, new RegExp(`"${state}"`));
assert.match(panel, /cancelPull/);
assert.match(panel, /clearPullHistory/);
assert.match(panel, /View images/);
assert.match(progress, /job\.progress/);
assert.match(progress, /indeterminate|animate-pulse/);
assert.match(shell, /onPullJobUpdated/);
assert.match(shell, /syncPullJobs/);
```

- [ ] **Step 2: Verify failure**

```bash
node --test tests/downloads-ui.test.mjs
```

- [ ] **Step 3: Add Radix Popover wrapper**

Create `src/components/ui/popover.tsx`:

```tsx
import * as PopoverPrimitive from "@radix-ui/react-popover";
import { cn } from "@/lib/utils";

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;

export function PopoverContent({ className, align = "end", sideOffset = 8, ...props }: React.ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        align={align}
        sideOffset={sideOffset}
        className={cn("z-50 rounded-xl border border-border bg-card text-foreground shadow-xl outline-none", className)}
        {...props}
      />
    </PopoverPrimitive.Portal>
  );
}
```

- [ ] **Step 4: Implement `PullProgress`**

```tsx
export function PullProgress({ job }: { job: PullJob }) {
  const determinate = typeof job.progress === "number" && Number.isFinite(job.progress);
  const pct = determinate ? Math.max(0, Math.min(100, job.progress!)) : 0;
  return (
    <div className="space-y-1.5">
      <div className="h-1.5 overflow-hidden rounded-full bg-elevated">
        {determinate ? (
          <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${pct}%` }} />
        ) : (
          <div className="h-full w-1/3 animate-pulse rounded-full bg-accent" data-progress="indeterminate" />
        )}
      </div>
      <p className="truncate text-xs text-muted-foreground">{job.message || job.status}</p>
    </div>
  );
}
```

Below it, show `formatBytes(currentBytes) / formatBytes(totalBytes)` only when `totalBytes` exists, speed only when `bytesPerSecond` exists, and elapsed seconds when `startedAt` exists using the store's `now` timestamp.

- [ ] **Step 5: Implement `DownloadsPanel`**

```ts
const active = pulls.filter((job) => ["queued", "pulling", "cancelling"].includes(job.status));
const recent = pulls.filter((job) => ["completed", "failed", "cancelled", "interrupted"].includes(job.status));
```

Requirements:

- ~420 px popover width, viewport constrained.
- Active first; Recent second.
- Queued/Pulling/Cancelling rows include Cancel.
- Failed/Interrupted rows show `error`.
- Completed rows show success state.
- Footer button text exactly `Clear history`; disabled with no recent jobs.
- Footer action `View images` calls `setView("images")`.

- [ ] **Step 6: Implement `DownloadsButton`**

```ts
const activeCount = pulls.filter((job) => ["queued", "pulling", "cancelling"].includes(job.status)).length;
```

Use Lucide `Download`; render badge only when count > 0; use `DownloadsPanel` inside Popover.

- [ ] **Step 7: Subscribe once to native events safely**

In `AppShell`:

```tsx
const syncPullJobs = useWslc((s) => s.syncPullJobs);
const applyPullJobUpdate = useWslc((s) => s.applyPullJobUpdate);

useEffect(() => {
  let disposed = false;
  let unlisten: (() => void) | undefined;
  void syncPullJobs();
  void onPullJobUpdated(applyPullJobUpdate).then((dispose) => {
    if (disposed) dispose();
    else unlisten = dispose;
  });
  return () => {
    disposed = true;
    unlisten?.();
  };
}, [syncPullJobs, applyPullJobUpdate]);
```

In `Titlebar`:

```tsx
{!gated ? <DownloadsButton /> : null}
<AppearanceToggle compact />
```

in that exact order.

- [ ] **Step 8: Verify and commit**

```bash
node --test tests/downloads-ui.test.mjs tests/image-search-ui.test.mjs tests/image-pull-contracts.test.mjs
pnpm typecheck
git add src/components/ui/popover.tsx src/components/pull-progress.tsx src/components/downloads-panel.tsx src/components/downloads-button.tsx src/components/app-shell.tsx tests/downloads-ui.test.mjs
git commit -m "feat: add global image downloads panel"
```

---

### Task 8: Add CI gates and run full verification

**Files:**
- Modify: `package.json`

**Interfaces:**
- Existing `.github/workflows/ci.yml` already runs `pnpm test:autostart`, `pnpm typecheck`, and Rust tests on Windows x64/ARM64.

- [ ] **Step 1: Add new tests to `test:autostart`**

Append:

```text
tests/image-pull-contracts.test.mjs
tests/image-search-ui.test.mjs
tests/downloads-ui.test.mjs
```

Do not create a second CI-only test script.

- [ ] **Step 2: Run frontend regression suite**

```bash
pnpm test:autostart
```

Expected: PASS including the updated `operation-ux` test.

- [ ] **Step 3: Run TypeScript, Rust, and desktop build**

```bash
pnpm typecheck
cargo test --manifest-path src-tauri/Cargo.toml
pnpm build:desktop
```

Expected: PASS.

- [ ] **Step 4: Run existing Windows WSLC integration script**

```powershell
pnpm test:windows -SkipInstall
```

Expected: current responsiveness, nginx, LocalCoding, and native tests remain green.

- [ ] **Step 5: Manually validate the integrated desktop flow**

1. Search `nginx`; suggestions appear after debounce with Docker Hub metadata.
2. Arrow to a suggestion and press Enter; background pull appears under Downloads.
3. Type `ghcr.io/dhhieu113pro/ai-studio:latest` with no highlighted suggestion and press Enter; exact ref is submitted directly.
4. Navigate to Containers while pulling; pull continues.
5. Start/stop a container while pulling; operation is not blocked by the pull manager.
6. Start three different pulls; exactly two are `pulling`, one `queued`.
7. Cancel one running pull; it transitions through `cancelling` to `cancelled`, then queued job starts.
8. Hide Quay to tray and restore; active jobs remain visible.
9. Complete a pull; image inventory refreshes automatically.
10. Trigger a failed pull; job remains in Recent and Sonner error toast appears.
11. Clear history; active jobs remain, terminal jobs disappear.
12. Explicitly Quit during a pull; no Quay-owned `wslc pull` process remains after shutdown returns.
13. Restart after a forcibly interrupted process; old unfinished job is shown as `interrupted`, never resumed.
14. Downloads icon is immediately left of appearance toggle and matches the approved visual hierarchy.

- [ ] **Step 6: Run exact CI-equivalent commands one final time**

```bash
pnpm test:autostart
pnpm test:store-submission
pnpm test:pages
pnpm typecheck
cargo test --manifest-path src-tauri/Cargo.toml
pnpm build:desktop
```

Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add package.json
git commit -m "test: gate image search and background pulls"
```

---

## Self-Review Coverage Matrix

- Search moved to title bar: Task 6.
- Docker Hub suggestions + 300 ms debounce: Tasks 2 and 6.
- Stale response protection including clearing query: Task 6.
- Direct GHCR/custom refs: Task 6.
- Pulls bypass generic mutation mutex: Task 4 uses its own process executor.
- Two concurrent pulls + queue: Task 4.
- Duplicate active suppression: Task 4.
- Live progress/stage events: Tasks 4, 5, 7.
- No fake percentages: Tasks 3 and 7.
- Downloads badge/panel globally: Task 7.
- Queue/running cancellation: Task 4 and Task 7.
- Persist 50 terminal jobs while retaining active jobs: Tasks 3 and 4.
- Nonfatal persistence errors: Task 4.
- Restart → interrupted: Task 3.
- Completed pull refreshes image inventory: Task 5.
- Failed pull toast: Task 5.
- Tray hide keeps jobs alive: existing behavior preserved; verified Task 8.
- Explicit Quit waits for cancellation: Tasks 4 and 5.
- Existing image removal/volume behavior: Task 6 preserves it; Task 8 verifies regressions.
- Windows x64/ARM64 CI: Task 8 uses the existing CI-facing script.

## Execution Order

Execute Task 1 → Task 8 in order. Use `superpowers:subagent-driven-development` for a fresh implementer per task and reviewer gates between tasks. Each task ends with an independently testable commit.
