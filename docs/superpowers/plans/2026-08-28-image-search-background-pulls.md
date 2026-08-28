# Global Image Search and Background Pulls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move image discovery to the Quay title bar, add Docker Hub suggestions, and run WSLC image pulls as native background jobs with live progress and a global Downloads panel.

**Architecture:** A native Rust `PullManager` owns queueing, process execution, cancellation, persistence, and job events. Docker Hub search is also native to avoid WebView CORS. React/Zustand remains the UI-facing state layer and synchronizes with native pull jobs through focused Tauri commands/events.

**Tech Stack:** Tauri 2, Rust 2021, `serde`/`serde_json`, `reqwest`, React 19, TypeScript, Zustand 5, Radix Popover, Tailwind CSS 4, Node test runner, existing Quay WSLC CLI integration.

**Spec:** `docs/superpowers/specs/2026-08-28-image-search-background-pulls-design.md`

## Global Constraints

- Docker Hub is the only search provider in this scope.
- Any non-empty typed reference can still be pulled directly, including `ghcr.io/...` and custom registries.
- Maximum concurrent pull count is exactly 2; additional jobs remain queued.
- A duplicate non-terminal job for the same normalized reference must not be created.
- Pulls must execute outside the existing `WslcExecutor` mutation mutex.
- Never fabricate progress; use determinate progress only when byte totals are trustworthy, otherwise render indeterminate progress plus stage/status text.
- Window close continues to hide Quay to tray and must not cancel pulls.
- Explicit application Quit must terminate Quay-owned active pull processes.
- Restarted Quay processes mark persisted non-terminal jobs as `interrupted`; this feature does not resume downloads after process exit.
- Keep at most the latest 50 terminal pull jobs.
- Preserve the existing image removal, volume, container, session, and cube workflows.
- Follow TDD: add a failing test first, run it, implement the minimum behavior, rerun tests, then commit.

---

## File Structure

### Native backend

- `src-tauri/src/docker_hub.rs` — Docker Hub transport, response mapping, and `ImageSearchResult` DTO.
- `src-tauri/src/pull_manager.rs` — pull job model, persistence, queue scheduler, progress parser, process runner, cancellation, and event sink.
- `src-tauri/src/lib.rs` — owns `PullManager`, exposes focused Tauri commands, emits updates, and performs shutdown cleanup.
- `src-tauri/Cargo.toml` — adds HTTP dependency for Docker Hub search.

### Frontend bridge/state

- `src/lib/wslc/types.ts` — `PullJobStatus`, expanded `PullJob`, and `ImageSearchResult` contracts.
- `src/lib/tauri.ts` — `imageSearch`, `pullStart`, `pullList`, `pullCancel`, `pullClearHistory`, and `onPullJobUpdated` wrappers.
- `src/lib/wslc/store.ts` — synchronizes native jobs into Zustand, starts/cancels/clears jobs, and refreshes image inventory after successful pulls.

### Frontend UI

- `src/components/image-search.tsx` — debounced Docker Hub search, stale-result protection, keyboard navigation, and direct-reference submission.
- `src/components/downloads-button.tsx` — title-bar download icon, active badge, and popover trigger.
- `src/components/downloads-panel.tsx` — active/recent job lists and actions.
- `src/components/pull-progress.tsx` — determinate/indeterminate progress presentation.
- `src/components/ui/popover.tsx` — thin Radix Popover wrapper matching existing Quay UI wrappers.
- `src/components/app-shell.tsx` — composes global search/downloads and starts native pull synchronization once.
- `src/components/views/images-view.tsx` — removes page-local pull input/button, retains inventory/volume actions.

### Tests

- `tests/image-pull-contracts.test.mjs` — contract/source wiring for new native bridge and Zustand actions.
- `tests/image-search-ui.test.mjs` — title-bar search and old pull-form removal contracts.
- `tests/downloads-ui.test.mjs` — download icon/panel/progress contracts.
- `tests/operation-ux.test.mjs` — updated expectation that pulling is no longer represented by generic `operations`.
- Rust unit tests live beside `docker_hub.rs` and `pull_manager.rs` so CI exercises them through the existing Cargo test step.
- `package.json` — adds the new Node tests to `test:autostart` so existing CI runs them on x64 and ARM64 Windows.

---

### Task 1: Define the frontend contracts and focused Tauri bridge

**Files:**
- Modify: `src/lib/wslc/types.ts`
- Modify: `src/lib/tauri.ts`
- Create: `tests/image-pull-contracts.test.mjs`

**Interfaces:**
- Produces: `PullJobStatus`, `PullJob`, `ImageSearchResult`
- Produces: `imageSearch(query): Promise<ImageSearchResult[]>`
- Produces: `pullStart(reference): Promise<PullJob>`
- Produces: `pullList(): Promise<PullJob[]>`
- Produces: `pullCancel(id): Promise<PullJob>`
- Produces: `pullClearHistory(): Promise<PullJob[]>`
- Produces: `onPullJobUpdated(handler): Promise<() => void>`

- [ ] **Step 1: Write the failing frontend contract test**

Create `tests/image-pull-contracts.test.mjs`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const types = await readFile(new URL("../src/lib/wslc/types.ts", import.meta.url), "utf8");
const tauri = await readFile(new URL("../src/lib/tauri.ts", import.meta.url), "utf8");

test("pull jobs expose the native background lifecycle", () => {
  assert.match(types, /export type PullJobStatus/);
  for (const status of ["queued", "pulling", "completed", "failed", "cancelling", "cancelled", "interrupted"]) {
    assert.match(types, new RegExp(`"${status}"`));
  }
  assert.match(types, /progress\?: number/);
  assert.match(types, /totalBytes\?: number/);
  assert.match(types, /bytesPerSecond\?: number/);
});

test("frontend bridge uses focused image search and pull commands", () => {
  for (const command of ["image_search", "pull_start", "pull_list", "pull_cancel", "pull_clear_history"]) {
    assert.match(tauri, new RegExp(`"${command}"`));
  }
  assert.match(tauri, /quay:\/\/pull-job-updated/);
});
```

- [ ] **Step 2: Run the new test and confirm it fails**

Run:

```bash
node --test tests/image-pull-contracts.test.mjs
```

Expected: FAIL because the expanded types and focused bridge functions do not exist yet.

- [ ] **Step 3: Expand the TypeScript pull/search contracts**

Replace the current minimal `PullJob` definition in `src/lib/wslc/types.ts` with:

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

- [ ] **Step 4: Add focused bridge functions in `src/lib/tauri.ts`**

Import the contracts and add:

```ts
import type { ImageSearchResult, PullJob } from "@/lib/wslc/types";

export async function imageSearch(query: string): Promise<ImageSearchResult[]> {
  if (!query.trim() || !isTauri()) return [];
  return invokeNative<ImageSearchResult[]>("image_search", { query: query.trim() });
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

Do not remove `invokeWslcHost`; short generic WSLC operations continue using it.

- [ ] **Step 5: Run the contract test and TypeScript check**

Run:

```bash
node --test tests/image-pull-contracts.test.mjs
pnpm typecheck
```

Expected: both PASS.

- [ ] **Step 6: Commit Task 1**

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

**Interfaces:**
- Consumes: frontend invokes Tauri command `image_search(query)`
- Produces: Rust `ImageSearchResult` serialized in camelCase to the TypeScript contract from Task 1
- Produces: `pub async fn search(query: &str) -> Result<Vec<ImageSearchResult>, String>`

- [ ] **Step 1: Add failing Docker Hub response-mapping tests**

Create `src-tauri/src/docker_hub.rs` initially with DTO declarations plus tests that reference a not-yet-implemented mapper:

```rust
use serde::{Deserialize, Serialize};

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

#[derive(Debug, Deserialize)]
struct SearchResponse {
    results: Vec<SearchRow>,
}

#[derive(Debug, Deserialize)]
struct SearchRow {
    repo_name: String,
    short_description: Option<String>,
    is_official: Option<bool>,
    star_count: Option<u64>,
    pull_count: Option<u64>,
    last_updated: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_docker_hub_results_into_quay_contract() {
        let raw = r#"{
          "results": [{
            "repo_name": "nginx",
            "short_description": "Official build of Nginx.",
            "is_official": true,
            "star_count": 21000,
            "pull_count": 1000000,
            "last_updated": "2026-08-20T00:00:00Z"
          }]
        }"#;
        let mapped = map_response(raw).unwrap();
        assert_eq!(mapped[0].name, "nginx");
        assert!(mapped[0].official);
        assert_eq!(mapped[0].pulls, Some(1_000_000));
    }

    #[test]
    fn empty_query_returns_no_results_without_network() {
        assert!(normalize_query("   ").is_none());
        assert_eq!(normalize_query(" nginx ").as_deref(), Some("nginx"));
    }
}
```

- [ ] **Step 2: Run Cargo tests and confirm failure**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml docker_hub
```

Expected: FAIL because `map_response` and `normalize_query` do not exist.

- [ ] **Step 3: Implement mapping, normalization, and HTTP search**

In `docker_hub.rs`, add:

```rust
const SEARCH_URL: &str = "https://hub.docker.com/v2/search/repositories/";

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
    let response = client
        .get(SEARCH_URL)
        .query(&[("query", query.as_str()), ("page_size", "8")])
        .send()
        .await
        .map_err(|e| format!("Docker Hub search failed: {e}"))?;
    if !response.status().is_success() {
        return Err(format!("Docker Hub search returned HTTP {}", response.status()));
    }
    let raw = response.text().await
        .map_err(|e| format!("could not read Docker Hub response: {e}"))?;
    map_response(&raw)
}
```

Add to `src-tauri/Cargo.toml`:

```toml
reqwest = { version = "0.12", default-features = false, features = ["json", "rustls-tls"] }
```

- [ ] **Step 4: Wire `image_search` into Tauri**

In `src-tauri/src/lib.rs` add:

```rust
mod docker_hub;

#[tauri::command]
async fn image_search(query: String) -> Result<Vec<docker_hub::ImageSearchResult>, String> {
    docker_hub::search(&query).await
}
```

Add `image_search` to `tauri::generate_handler![...]`.

- [ ] **Step 5: Run native tests and TypeScript check**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit Task 2**

```bash
git add src-tauri/src/docker_hub.rs src-tauri/src/lib.rs src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "feat: add Docker Hub image search"
```

---

### Task 3: Build the pull job model, progress parser, and persistence layer

**Files:**
- Create: `src-tauri/src/pull_manager.rs`
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Produces: Rust `PullJobStatus`, `PullJob`, `ProgressUpdate`
- Produces: `parse_progress_fragment(fragment: &str) -> ProgressUpdate`
- Produces: persistence helpers that store the latest 50 terminal jobs and convert stale non-terminal jobs to `interrupted` on load

- [ ] **Step 1: Write failing parser and persistence tests**

Start `pull_manager.rs` with the public job contract and these tests:

```rust
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum PullJobStatus {
    Queued,
    Pulling,
    Completed,
    Failed,
    Cancelling,
    Cancelled,
    Interrupted,
}

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

#[derive(Debug, Clone, Default, PartialEq)]
pub struct ProgressUpdate {
    pub current_bytes: Option<u64>,
    pub total_bytes: Option<u64>,
    pub progress: Option<f64>,
    pub message: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_byte_fraction_without_inventing_missing_values() {
        let update = parse_progress_fragment("Downloading 12.5 MB / 50 MB");
        assert_eq!(update.current_bytes, Some(13_107_200));
        assert_eq!(update.total_bytes, Some(52_428_800));
        assert_eq!(update.progress, Some(25.0));
    }

    #[test]
    fn stage_only_output_is_indeterminate() {
        let update = parse_progress_fragment("Pulling fs layer");
        assert_eq!(update.progress, None);
        assert_eq!(update.total_bytes, None);
        assert_eq!(update.message.as_deref(), Some("Pulling fs layer"));
    }

    #[test]
    fn persisted_active_jobs_become_interrupted() {
        let now = 1_700_000_000_000_u64;
        let loaded = normalize_loaded_jobs(vec![PullJob {
            id: "pull-1".into(), reference: "nginx:latest".into(), status: PullJobStatus::Pulling,
            current_bytes: 1, total_bytes: Some(10), progress: Some(10.0), bytes_per_second: None,
            started_at: Some(now - 10), created_at: now - 20, updated_at: now - 10,
            finished_at: None, message: None, error: None,
        }], now);
        assert_eq!(loaded[0].status, PullJobStatus::Interrupted);
        assert_eq!(loaded[0].finished_at, Some(now));
    }
}
```

- [ ] **Step 2: Run the tests and confirm failure**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml pull_manager
```

Expected: FAIL because parser/load normalization functions are missing.

- [ ] **Step 3: Implement byte parsing without a new regex dependency**

Implement helpers that recognize `B`, `KB`, `MB`, and `GB`, split only when a trustworthy `current / total` pair exists, and otherwise retain the raw stage text as the message:

```rust
fn parse_size(token: &str, unit: &str) -> Option<u64> {
    let value = token.trim().parse::<f64>().ok()?;
    let multiplier = match unit.trim().to_ascii_uppercase().as_str() {
        "B" => 1.0,
        "KB" => 1024.0,
        "MB" => 1024.0 * 1024.0,
        "GB" => 1024.0 * 1024.0 * 1024.0,
        _ => return None,
    };
    Some((value * multiplier) as u64)
}

pub fn parse_progress_fragment(fragment: &str) -> ProgressUpdate {
    let text = fragment.trim();
    let words: Vec<&str> = text.split_whitespace().collect();
    for i in 0..words.len().saturating_sub(4) {
        if words.get(i + 2) == Some(&"/") {
            if let (Some(current), Some(total)) = (
                parse_size(words[i], words[i + 1]),
                parse_size(words[i + 3], words[i + 4]),
            ) {
                if total > 0 {
                    return ProgressUpdate {
                        current_bytes: Some(current),
                        total_bytes: Some(total),
                        progress: Some(((current as f64 / total as f64) * 100.0).clamp(0.0, 100.0)),
                        message: Some(text.to_string()),
                    };
                }
            }
        }
    }
    ProgressUpdate { message: (!text.is_empty()).then(|| text.to_string()), ..Default::default() }
}
```

- [ ] **Step 4: Implement persistence and restart normalization**

Use a JSON file path provided by the caller. Persist after every state transition, but persistence failure must not fail the pull itself.

Implement:

```rust
fn is_terminal(status: &PullJobStatus) -> bool {
    matches!(status, PullJobStatus::Completed | PullJobStatus::Failed | PullJobStatus::Cancelled | PullJobStatus::Interrupted)
}

fn normalize_loaded_jobs(mut jobs: Vec<PullJob>, now: u64) -> Vec<PullJob> {
    for job in &mut jobs {
        if !is_terminal(&job.status) {
            job.status = PullJobStatus::Interrupted;
            job.updated_at = now;
            job.finished_at = Some(now);
            job.error = Some("Quay exited before this pull finished".into());
        }
    }
    jobs.sort_by_key(|job| std::cmp::Reverse(job.updated_at));
    jobs.into_iter().take(50).collect()
}

fn load_jobs(path: &std::path::Path, now: u64) -> Vec<PullJob> {
    let Ok(raw) = std::fs::read_to_string(path) else { return Vec::new(); };
    let Ok(jobs) = serde_json::from_str::<Vec<PullJob>>(&raw) else { return Vec::new(); };
    normalize_loaded_jobs(jobs, now)
}

fn save_jobs(path: &std::path::Path, jobs: &[PullJob]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("could not create pull history directory: {e}"))?;
    }
    let raw = serde_json::to_string_pretty(jobs).map_err(|e| e.to_string())?;
    std::fs::write(path, raw).map_err(|e| format!("could not persist pull history: {e}"))
}
```

Add a round-trip test using a unique file under `std::env::temp_dir()` and remove it at the end.

- [ ] **Step 5: Register the module and rerun native tests**

Add `#[cfg(windows)] mod pull_manager;` in `src-tauri/src/lib.rs` so the production process runner can remain Windows-only while its unit tests run in the Windows CI matrix.

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

Expected: PASS.

- [ ] **Step 6: Commit Task 3**

```bash
git add src-tauri/src/pull_manager.rs src-tauri/src/lib.rs
git commit -m "feat: add pull job model and persistence"
```

---

### Task 4: Implement the native two-slot background pull scheduler and cancellation

**Files:**
- Modify: `src-tauri/src/pull_manager.rs`

**Interfaces:**
- Produces: `PullExecutor` abstraction for testability
- Produces: `PullManager::start`, `list`, `cancel`, `clear_history`, `shutdown`
- Produces: `PullEventSink` abstraction used by Tauri wiring in Task 5

- [ ] **Step 1: Add failing queue/concurrency/cancellation tests with a fake executor**

Define these interfaces before implementing the manager:

```rust
use std::sync::{Arc, atomic::AtomicBool};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PullExecution {
    Completed,
    Cancelled,
}

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

Add tests using a fake executor that blocks each job until the test releases it. Required assertions:

```rust
#[test]
fn starts_only_two_jobs_and_queues_the_third() {
    let (manager, fake) = test_manager(2);
    manager.start("one:latest").unwrap();
    manager.start("two:latest").unwrap();
    manager.start("three:latest").unwrap();
    fake.wait_for_running(2);
    let jobs = manager.list();
    assert_eq!(jobs.iter().filter(|j| j.status == PullJobStatus::Pulling).count(), 2);
    assert_eq!(jobs.iter().filter(|j| j.status == PullJobStatus::Queued).count(), 1);
}

#[test]
fn duplicate_active_reference_returns_existing_job() {
    let (manager, _fake) = test_manager(2);
    let first = manager.start(" nginx:latest ").unwrap();
    let second = manager.start("nginx:latest").unwrap();
    assert_eq!(first.id, second.id);
    assert_eq!(manager.list().len(), 1);
}

#[test]
fn cancelling_running_job_opens_slot_for_next_job() {
    let (manager, fake) = test_manager(2);
    let first = manager.start("one:latest").unwrap();
    manager.start("two:latest").unwrap();
    manager.start("three:latest").unwrap();
    fake.wait_for_running(2);
    manager.cancel(&first.id).unwrap();
    fake.wait_until_started("three:latest");
    assert!(manager.list().iter().any(|j| j.reference == "three:latest" && j.status == PullJobStatus::Pulling));
}
```

- [ ] **Step 2: Run the scheduler tests and confirm failure**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml pull_manager
```

Expected: FAIL because `PullManager` and the scheduler do not exist.

- [ ] **Step 3: Implement `PullManager` state and scheduling**

Use one shared inner object so background completion can schedule the next queued job:

```rust
struct PullState {
    jobs: Vec<PullJob>,
    running: std::collections::HashSet<String>,
    cancellations: std::collections::HashMap<String, Arc<AtomicBool>>,
}

struct PullManagerInner {
    state: std::sync::Mutex<PullState>,
    executor: Arc<dyn PullExecutor>,
    sink: Arc<dyn PullEventSink>,
    history_path: std::path::PathBuf,
    concurrency: usize,
    sequence: std::sync::atomic::AtomicU64,
    shutting_down: AtomicBool,
}

#[derive(Clone)]
pub struct PullManager {
    inner: Arc<PullManagerInner>,
}
```

`start(reference)` must trim the reference, reject only an empty string, reuse an existing job when the exact normalized reference is `queued`, `pulling`, or `cancelling`, create a `queued` job otherwise, persist it, emit it, then call `schedule()`.

`schedule()` must claim queued jobs while `running.len() < 2`, set them to `pulling`, create cancellation flags, emit/persist each transition, and spawn one Rust thread per active job. Completion must remove the job from `running`/`cancellations`, set `completed`, `failed`, or `cancelled`, emit/persist, then call `schedule()` again.

- [ ] **Step 4: Implement the real Windows process executor**

Create `SystemPullExecutor` implementing `PullExecutor`. Launch `wslc pull <reference>` with no console window and piped stdout/stderr:

```rust
let mut command = std::process::Command::new("wslc");
command
    .args(["pull", reference])
    .stdin(std::process::Stdio::null())
    .stdout(std::process::Stdio::piped())
    .stderr(std::process::Stdio::piped());
use std::os::windows::process::CommandExt;
command.creation_flags(0x0800_0000);
```

Read stdout and stderr concurrently. Split progress fragments on both `\n` and `\r` so carriage-return based progress updates are not lost. Every non-empty fragment calls `parse_progress_fragment` and forwards the normalized update.

Poll `child.try_wait()` roughly every 50 ms. When the cancellation flag becomes true, terminate the owned process tree on Windows with:

```rust
let pid = child.id().to_string();
let _ = std::process::Command::new("taskkill")
    .args(["/PID", &pid, "/T", "/F"])
    .stdin(std::process::Stdio::null())
    .stdout(std::process::Stdio::null())
    .stderr(std::process::Stdio::null())
    .status();
let _ = child.kill();
let _ = child.wait();
return Ok(PullExecution::Cancelled);
```

A zero exit code returns `Completed`. A non-zero exit returns an error containing the collected stderr summary.

- [ ] **Step 5: Implement cancel, history cleanup, and shutdown**

Behavior must be exact:

```rust
pub fn cancel(&self, id: &str) -> Result<PullJob, String>;
pub fn clear_history(&self) -> Vec<PullJob>;
pub fn list(&self) -> Vec<PullJob>;
pub fn shutdown(&self);
```

- Queued cancellation immediately sets `cancelled` and never starts the executor.
- Pulling cancellation first sets `cancelling`, then flips its `AtomicBool`; executor completion sets `cancelled`.
- `clear_history` removes only terminal jobs; active/queued jobs remain.
- `shutdown` sets `shutting_down = true`, flips all running cancellation flags, marks queued jobs `cancelled`, and prevents the scheduler from starting another job.

Add tests for queued cancellation, terminal-history cleanup, and shutdown preventing queued work from starting.

- [ ] **Step 6: Run the full native test suite**

Run:

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

Expected: PASS including max-concurrency, duplicate suppression, cancellation, persistence, parser, and shutdown tests.

- [ ] **Step 7: Commit Task 4**

```bash
git add src-tauri/src/pull_manager.rs
git commit -m "feat: run image pulls as background jobs"
```

---

### Task 5: Wire native pull commands/events and synchronize Zustand

**Files:**
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/lib/wslc/store.ts`
- Modify: `tests/image-pull-contracts.test.mjs`
- Modify: `tests/operation-ux.test.mjs`

**Interfaces:**
- Consumes: `PullManager` from Task 4
- Consumes: bridge functions from Task 1
- Produces native commands: `pull_start`, `pull_list`, `pull_cancel`, `pull_clear_history`
- Produces Zustand actions: `startPull`, `cancelPull`, `clearPullHistory`, `syncPullJobs`, `applyPullJobUpdate`

- [ ] **Step 1: Extend failing contract tests for the native command wiring and Zustand API**

Add to `tests/image-pull-contracts.test.mjs`:

```js
const nativeLib = await readFile(new URL("../src-tauri/src/lib.rs", import.meta.url), "utf8");
const store = await readFile(new URL("../src/lib/wslc/store.ts", import.meta.url), "utf8");

test("native app exposes focused pull manager commands", () => {
  for (const command of ["pull_start", "pull_list", "pull_cancel", "pull_clear_history"]) {
    assert.match(nativeLib, new RegExp(`fn ${command}`));
  }
  assert.match(nativeLib, /pull_manager\.shutdown\(\)/);
});

test("zustand synchronizes native pull jobs instead of generic operations", () => {
  for (const action of ["startPull", "cancelPull", "clearPullHistory", "syncPullJobs", "applyPullJobUpdate"]) {
    assert.match(store, new RegExp(`${action}:`));
  }
  assert.doesNotMatch(store, /runOperation\(`image:\$\{ref\}`/);
});
```

Update `tests/operation-ux.test.mjs` by removing the old `"image pulls show an explicit pulling state"` assertion and replacing it with:

```js
test("image pulling is no longer represented by the generic operation map", () => {
  assert.doesNotMatch(store, /runOperation\(`image:\$\{ref\}`/);
  assert.match(images, /removeImage/);
});
```

- [ ] **Step 2: Run the focused Node tests and confirm failure**

Run:

```bash
node --test tests/image-pull-contracts.test.mjs tests/operation-ux.test.mjs
```

Expected: FAIL until native commands and Zustand actions are wired.

- [ ] **Step 3: Make `Backend` own the pull manager and emit Tauri events**

In `src-tauri/src/lib.rs`, import `tauri::Emitter` and add a Tauri event sink:

```rust
#[cfg(windows)]
#[derive(Clone)]
struct TauriPullSink(tauri::AppHandle);

#[cfg(windows)]
impl pull_manager::PullEventSink for TauriPullSink {
    fn emit(&self, job: &pull_manager::PullJob) {
        let _ = self.0.emit("quay://pull-job-updated", job.clone());
    }
}
```

Extend `Backend`:

```rust
pub struct Backend {
    #[cfg(windows)] executor: wslc_executor::WslcExecutor,
    #[cfg(windows)] host: Arc<Mutex<wslc_runtime::HostSampler>>,
    #[cfg(windows)] pull_manager: pull_manager::PullManager,
}
```

Change backend construction in `.setup(...)` so it can use `app.handle()` and `app.path().app_data_dir()` to build `<app-data>/pull-jobs.json`, then `app.manage(Backend::new(app.handle())?)`.

- [ ] **Step 4: Add the four native pull commands**

Use `State<'_, Backend>` and return serialized `PullJob` values directly:

```rust
#[tauri::command]
fn pull_start(backend: State<'_, Backend>, reference: String) -> Result<pull_manager::PullJob, String> {
    backend.pull_manager.start(&reference)
}

#[tauri::command]
fn pull_list(backend: State<'_, Backend>) -> Vec<pull_manager::PullJob> {
    backend.pull_manager.list()
}

#[tauri::command]
fn pull_cancel(backend: State<'_, Backend>, id: String) -> Result<pull_manager::PullJob, String> {
    backend.pull_manager.cancel(&id)
}

#[tauri::command]
fn pull_clear_history(backend: State<'_, Backend>) -> Vec<pull_manager::PullJob> {
    backend.pull_manager.clear_history()
}
```

Add all four names to `tauri::generate_handler!`.

Before `executor.shutdown()` in the existing exit handler, call:

```rust
app.state::<Backend>().pull_manager.shutdown();
```

- [ ] **Step 5: Replace the old image pull action in Zustand**

Update imports from `@/lib/tauri` to include the bridge functions. Change the state interface:

```ts
startPull: (reference: string) => Promise<PullJob | null>;
cancelPull: (id: string) => Promise<void>;
clearPullHistory: () => Promise<void>;
syncPullJobs: () => Promise<void>;
applyPullJobUpdate: (job: PullJob) => void;
```

Remove `pullImage` and remove `"pulling"` from `OperationStatus` because image pulls no longer use `operations`.

Implement job upsert by ID:

```ts
const upsertPull = (pulls: PullJob[], job: PullJob) => {
  const existing = pulls.findIndex((item) => item.id === job.id);
  if (existing < 0) return [job, ...pulls];
  const next = pulls.slice();
  next[existing] = job;
  return next;
};
```

Implement actions:

```ts
startPull: async (reference) => {
  const value = reference.trim();
  if (!value) return null;
  try {
    const job = await pullStart(value);
    get().applyPullJobUpdate(job);
    return job;
  } catch (error) {
    set({ lastError: error instanceof Error ? error.message : String(error) });
    return null;
  }
},
applyPullJobUpdate: (job) => {
  const previous = get().pulls.find((item) => item.id === job.id);
  set((state) => ({ pulls: upsertPull(state.pulls, job) }));
  if (job.status === "completed" && previous?.status !== "completed") void refreshInventory();
},
syncPullJobs: async () => {
  try { set({ pulls: await pullList() }); }
  catch (error) { set({ lastError: error instanceof Error ? error.message : String(error) }); }
},
cancelPull: async (id) => {
  try { get().applyPullJobUpdate(await pullCancel(id)); }
  catch (error) { set({ lastError: error instanceof Error ? error.message : String(error) }); }
},
clearPullHistory: async () => {
  try { set({ pulls: await pullClearHistory() }); }
  catch (error) { set({ lastError: error instanceof Error ? error.message : String(error) }); }
},
```

- [ ] **Step 6: Run focused tests, TypeScript, and Cargo tests**

Run:

```bash
node --test tests/image-pull-contracts.test.mjs tests/operation-ux.test.mjs
pnpm typecheck
cargo test --manifest-path src-tauri/Cargo.toml
```

Expected: PASS.

- [ ] **Step 7: Commit Task 5**

```bash
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
- Consumes: `imageSearch()` from Task 1
- Consumes: `startPull()` from Task 5
- Produces: title-bar global search with direct-reference fallback

- [ ] **Step 1: Write failing title-bar search/UI contract tests**

Create `tests/image-search-ui.test.mjs`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const shell = await readFile(new URL("../src/components/app-shell.tsx", import.meta.url), "utf8");
const images = await readFile(new URL("../src/components/views/images-view.tsx", import.meta.url), "utf8");
const search = await readFile(new URL("../src/components/image-search.tsx", import.meta.url), "utf8").catch(() => "");

test("title bar owns global image search", () => {
  assert.match(shell, /<ImageSearch/);
  assert.match(search, /Search Docker Hub images/);
  assert.match(search, /300/);
  assert.match(search, /ArrowDown|ArrowUp/);
  assert.match(search, /Enter/);
});

test("search preserves direct custom registry pulls", () => {
  assert.match(search, /startPull\(value\)/);
  assert.match(search, /imageSearch/);
});

test("images page no longer contains the image pull form", () => {
  assert.doesNotMatch(images, /pull-catalog/);
  assert.doesNotMatch(images, /Pulling…/);
  assert.doesNotMatch(images, /type="submit"[^>]*>[^<]*Pull/);
});
```

- [ ] **Step 2: Run the UI contract test and confirm failure**

Run:

```bash
node --test tests/image-search-ui.test.mjs
```

Expected: FAIL because `ImageSearch` does not exist and the Images page still owns the pull form.

- [ ] **Step 3: Implement `ImageSearch` with debounce and stale-result protection**

The component must use component-local query/results/open/error/selection state and `useWslc((s) => s.startPull)`.

Use this request sequencing pattern so slow older responses never overwrite newer ones:

```ts
const requestId = useRef(0);

useEffect(() => {
  const value = query.trim();
  if (!value) {
    setResults([]);
    setSearchError(null);
    return;
  }
  const id = ++requestId.current;
  const timer = window.setTimeout(() => {
    void imageSearch(value)
      .then((next) => {
        if (id !== requestId.current) return;
        setResults(next);
        setSearchError(null);
        setOpen(true);
      })
      .catch((error) => {
        if (id !== requestId.current) return;
        setResults([]);
        setSearchError(error instanceof Error ? error.message : String(error));
        setOpen(true);
      });
  }, 300);
  return () => window.clearTimeout(timer);
}, [query]);
```

Keyboard semantics must be exact:

- `ArrowDown`/`ArrowUp`: move highlighted suggestion and prevent default.
- `Escape`: close results.
- `Enter`: if a suggestion is highlighted, pull `${result.name}:latest`; otherwise pull the exact non-empty trimmed typed value.
- Clicking a suggestion pulls `${result.name}:latest`.
- Search error text is shown inside the dropdown but never disables direct Enter submission.

Render at most 8 results. Show official badge when `official === true`; show compact pulls/stars metadata only when values are present.

- [ ] **Step 4: Compose search in `Titlebar`**

Import `ImageSearch` in `app-shell.tsx` and place it between the Quay brand block and right-side actions:

```tsx
<div className="flex min-w-0 flex-1 justify-center px-4">
  <ImageSearch className="w-full max-w-xl" />
</div>
```

Keep the existing titlebar height and Windows caption buttons. Search input/dropdown must be normal interactive children and must not receive `data-tauri-drag-region`.

- [ ] **Step 5: Remove image pulling controls from `ImagesView`**

Remove:

- local `ref` state;
- `catalog` usage;
- `pullImage` usage;
- `pullStatus`/`pulling` state;
- image pull form, datalist, and Pull button.

Retain image inventory, image removal, Images/Volumes tabs, and volume create/remove UI. Change the supporting copy to:

```tsx
<p className="mt-1 text-sm text-muted-foreground">
  Search and pull images from the title bar. Manage local images and volumes here.
</p>
```

- [ ] **Step 6: Run UI tests and TypeScript check**

Run:

```bash
node --test tests/image-search-ui.test.mjs
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit Task 6**

```bash
git add src/components/image-search.tsx src/components/app-shell.tsx src/components/views/images-view.tsx tests/image-search-ui.test.mjs
git commit -m "feat: move image search into title bar"
```

---

### Task 7: Add the global Downloads icon, progress UI, and native event subscription

**Files:**
- Create: `src/components/ui/popover.tsx`
- Create: `src/components/pull-progress.tsx`
- Create: `src/components/downloads-panel.tsx`
- Create: `src/components/downloads-button.tsx`
- Modify: `src/components/app-shell.tsx`
- Create: `tests/downloads-ui.test.mjs`

**Interfaces:**
- Consumes: `pulls`, `cancelPull`, `clearPullHistory`, `syncPullJobs`, `applyPullJobUpdate` from Task 5
- Consumes: `onPullJobUpdated` from Task 1
- Produces: Downloads icon immediately before `AppearanceToggle`
- Produces: active badge count for `queued`, `pulling`, and `cancelling`

- [ ] **Step 1: Write failing Downloads UI contract tests**

Create `tests/downloads-ui.test.mjs`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const shell = await readFile(new URL("../src/components/app-shell.tsx", import.meta.url), "utf8");
const button = await readFile(new URL("../src/components/downloads-button.tsx", import.meta.url), "utf8").catch(() => "");
const panel = await readFile(new URL("../src/components/downloads-panel.tsx", import.meta.url), "utf8").catch(() => "");
const progress = await readFile(new URL("../src/components/pull-progress.tsx", import.meta.url), "utf8").catch(() => "");

test("downloads button sits before appearance toggle and counts active jobs", () => {
  assert.match(shell, /<DownloadsButton[\s\S]*<AppearanceToggle compact/);
  for (const state of ["queued", "pulling", "cancelling"]) assert.match(button, new RegExp(`"${state}"`));
});

test("downloads panel supports cancellation and history cleanup", () => {
  assert.match(panel, /cancelPull/);
  assert.match(panel, /clearPullHistory/);
  assert.match(panel, /Active/);
  assert.match(panel, /Recent/);
});

test("pull progress can be determinate or indeterminate", () => {
  assert.match(progress, /job\.progress/);
  assert.match(progress, /animate-pulse|indeterminate/);
});

test("app shell subscribes once to native pull updates", () => {
  assert.match(shell, /onPullJobUpdated/);
  assert.match(shell, /syncPullJobs/);
  assert.match(shell, /applyPullJobUpdate/);
});
```

- [ ] **Step 2: Run the Downloads test and confirm failure**

Run:

```bash
node --test tests/downloads-ui.test.mjs
```

Expected: FAIL because the components do not exist.

- [ ] **Step 3: Add a focused Radix Popover wrapper**

Create `src/components/ui/popover.tsx` matching existing Quay wrapper conventions:

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

Use determinate width only when `job.progress` is finite. Otherwise render an indeterminate bar without showing a percentage:

```tsx
export function PullProgress({ job }: { job: PullJob }) {
  const determinate = typeof job.progress === "number" && Number.isFinite(job.progress);
  return (
    <div className="space-y-1.5">
      <div className="h-1.5 overflow-hidden rounded-full bg-elevated">
        {determinate ? (
          <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${Math.max(0, Math.min(100, job.progress!))}%` }} />
        ) : (
          <div className="h-full w-1/3 animate-pulse rounded-full bg-accent" data-progress="indeterminate" />
        )}
      </div>
      <p className="truncate text-xs text-muted-foreground">{job.message || job.status}</p>
    </div>
  );
}
```

Below the bar, show `currentBytes / totalBytes` only when `totalBytes` exists; show speed only when `bytesPerSecond` exists.

- [ ] **Step 5: Implement `DownloadsPanel`**

Split jobs with:

```ts
const active = pulls.filter((job) => ["queued", "pulling", "cancelling"].includes(job.status));
const recent = pulls.filter((job) => ["completed", "failed", "cancelled", "interrupted"].includes(job.status));
```

Panel requirements:

- width around `w-[420px]`, constrained to viewport;
- Active section first, Recent second;
- active row includes reference, `PullProgress`, and Cancel button;
- failed/interrupted row includes error text;
- completed row includes a subtle success indicator;
- footer button text exactly `Clear history`, disabled when `recent.length === 0`;
- optional `View images` action sets `view` to `images`.

- [ ] **Step 6: Implement `DownloadsButton`**

Use Lucide `Download`. Badge count is exactly:

```ts
const activeCount = pulls.filter((job) => ["queued", "pulling", "cancelling"].includes(job.status)).length;
```

Render the badge only when `activeCount > 0`. The button remains visible on every ready main view and opens `DownloadsPanel` inside the Popover.

- [ ] **Step 7: Subscribe to native pull events once in `AppShell` and compose the button**

At `AppShell` level, add one effect:

```tsx
const syncPullJobs = useWslc((s) => s.syncPullJobs);
const applyPullJobUpdate = useWslc((s) => s.applyPullJobUpdate);

useEffect(() => {
  let unlisten: (() => void) | undefined;
  void syncPullJobs();
  void onPullJobUpdated(applyPullJobUpdate).then((dispose) => { unlisten = dispose; });
  return () => unlisten?.();
}, [syncPullJobs, applyPullJobUpdate]);
```

In `Titlebar`, place:

```tsx
<DownloadsButton />
<AppearanceToggle compact />
```

in that exact order, before window caption controls.

- [ ] **Step 8: Run UI tests and TypeScript check**

Run:

```bash
node --test tests/downloads-ui.test.mjs tests/image-search-ui.test.mjs tests/image-pull-contracts.test.mjs
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 9: Commit Task 7**

```bash
git add src/components/ui/popover.tsx src/components/pull-progress.tsx src/components/downloads-panel.tsx src/components/downloads-button.tsx src/components/app-shell.tsx tests/downloads-ui.test.mjs
git commit -m "feat: add global image downloads panel"
```

---

### Task 8: Make the new tests part of the existing CI gate and verify the complete feature

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml` only if dependency resolution changes because Cargo changes do not affect pnpm
- Test: all new Node tests plus existing test suite

**Interfaces:**
- Consumes: all prior tasks
- Produces: CI-enforced regression coverage on Windows x64 and ARM64

- [ ] **Step 1: Add the new Node tests to the existing CI-facing script**

Append these files to `test:autostart` in `package.json`:

```text
tests/image-pull-contracts.test.mjs
tests/image-search-ui.test.mjs
tests/downloads-ui.test.mjs
```

Do not create a second CI-only test script; `.github/workflows/ci.yml` already runs `pnpm test:autostart` on both Windows architectures.

- [ ] **Step 2: Run the complete frontend contract suite**

Run:

```bash
pnpm test:autostart
```

Expected: PASS, including the updated `operation-ux` expectation.

- [ ] **Step 3: Run TypeScript and Rust tests**

Run:

```bash
pnpm typecheck
cargo test --manifest-path src-tauri/Cargo.toml
```

Expected: PASS.

- [ ] **Step 4: Build the desktop bundle**

Run:

```bash
pnpm build:desktop
```

Expected: successful Vite desktop build with no TypeScript/import errors.

- [ ] **Step 5: Run Windows WSLC integration validation**

On a Windows machine with working WSLC, run:

```powershell
pnpm test:windows -SkipInstall
```

Expected: existing WSLC responsiveness, nginx, LocalCoding, and backend tests remain green.

Then perform these Quay desktop checks manually because they exercise Tauri UI/native-process integration rather than CLI-only behavior:

1. Search `nginx`; Docker Hub suggestions appear after the debounce.
2. Press Enter on a suggestion; a background job appears under Downloads.
3. Navigate to Containers while the pull runs; the job continues.
4. Start or stop a container during the pull; the operation is not blocked by the pull job.
5. Start three different pulls; exactly two are `pulling`, one is `queued`.
6. Cancel one running pull; it reaches `cancelled` and the queued pull starts.
7. Type `ghcr.io/dhhieu113pro/ai-studio:latest` and press Enter; it is submitted directly without Docker Hub search ownership.
8. Hide Quay using the existing window close behavior; restore it from tray and verify active job state is still present.
9. Complete a pull and open Images; the new image appears without manual inventory refresh.
10. Explicitly Quit Quay while a pull is active; verify no Quay-owned `wslc pull` process remains.
11. Restart Quay after terminating it during a pull; persisted unfinished job appears as `interrupted`, not resumed.
12. Confirm Downloads icon is immediately left of the appearance toggle and matches the approved mockup hierarchy.

- [ ] **Step 6: Run the exact CI-equivalent commands one final time**

Run:

```bash
pnpm test:autostart
pnpm test:store-submission
pnpm test:pages
pnpm typecheck
cargo test --manifest-path src-tauri/Cargo.toml
pnpm build:desktop
```

Expected: all PASS.

- [ ] **Step 7: Commit Task 8**

```bash
git add package.json pnpm-lock.yaml
git commit -m "test: gate image search and background pulls"
```

If `pnpm-lock.yaml` did not change, omit it from `git add` rather than creating a no-op modification.

---

## Final Review Checklist

Before opening the implementation PR, verify every acceptance criterion from the spec maps to completed work:

- [ ] Title-bar image search replaces the page-local pull form.
- [ ] Docker Hub suggestions are debounced and stale responses cannot win.
- [ ] Non-Docker-Hub typed refs are submitted directly.
- [ ] Pulls bypass `WslcExecutor`'s mutation mutex.
- [ ] Exactly two pulls can run concurrently.
- [ ] Duplicate active refs reuse the existing job.
- [ ] Queue, pulling, cancelling, completed, failed, cancelled, interrupted transitions are covered.
- [ ] Determinate progress is shown only from real byte totals; otherwise UI is indeterminate.
- [ ] Downloads badge counts queued + pulling + cancelling jobs only.
- [ ] Cancel works for queued and active jobs.
- [ ] Completed pulls refresh local image inventory automatically.
- [ ] Terminal history persists and is capped at 50.
- [ ] Restart converts stale non-terminal jobs to interrupted.
- [ ] Window hide-to-tray does not stop pulls.
- [ ] Explicit Quit terminates active pull children.
- [ ] Existing x64/ARM64 Windows CI stays green.
- [ ] Existing WSLC local integration validation stays green.

## Recommended Execution Order

Use `superpowers:subagent-driven-development` and execute Task 1 through Task 8 in order. Each task is intentionally reviewable on its own: contracts first, then search, then the native job engine, then frontend synchronization, then search UI, then Downloads UI, and finally CI/integration hardening.
