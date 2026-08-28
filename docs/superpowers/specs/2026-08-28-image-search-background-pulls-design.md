# Global Image Search and Background Pulls Design

Date: 2026-08-28
Status: Proposed for implementation
Repository: `dhhieu113pro/quay`

## Goal

Make image discovery and pulling a global Quay workflow rather than an Images-page-only form.

Users should be able to:

- search Docker Hub from the top title bar and see Docker-style suggestions;
- type any valid image reference, including non-Docker-Hub registries such as `ghcr.io/...`, and pull it directly;
- start a pull and continue using any Quay view while it runs;
- see pull progress from a Downloads icon beside the appearance toggle;
- cancel queued or active pulls;
- see recent completed, failed, cancelled, and interrupted jobs;
- hide the Quay window to the tray without stopping downloads.

The existing Images page remains the inventory/volume management surface, but its image pull input is removed.

## Current State

Quay currently starts image pulls from `src/components/views/images-view.tsx`. The frontend calls `pullImage(reference)` in the global Zustand store, which executes `wslc pull <reference>` through the generic Tauri command bridge.

The current native executor captures stdout/stderr until process exit. Pulls are classified as mutations and therefore share the mutation mutex with other state-changing WSLC commands. This means a long-running pull cannot provide live progress and can delay unrelated container mutations.

Quay already has a global `pulls` array and a `PullJob` type, but they are not currently used as the source of truth for pull execution or UI.

## Chosen Architecture

Use a native Rust `PullManager` as the authoritative pull subsystem, with React/Zustand acting as a thin presentation and synchronization layer.

This separates long-running image downloads from the existing command executor while keeping Quay's current `wslc.exe` integration.

### Why this approach

A frontend-only implementation would still depend on the blocking `wslc_invoke` path and would not solve live progress or mutation-lane blocking.

A fully detached external job service would survive a complete Quay process exit, but it would add process discovery, ownership, IPC, and recovery complexity that is not required for this feature. Quay already hides to tray on normal window close, so native in-process jobs continue when the window is hidden.

## User Experience

### Top-bar image search

Add a centered search control to the desktop title bar between the Quay identity block and the right-side status/actions.

Behavior:

1. Placeholder: `Search Docker Hub images…`
2. Begin search after approximately 300 ms of idle typing.
3. Search only Docker Hub for suggestions.
4. Show up to 8 suggestions in a dropdown.
5. Each suggestion may show:
   - repository/image name;
   - short description;
   - official badge when available;
   - pull/star/popularity metadata when returned by Docker Hub.
6. Keyboard support:
   - Up/Down changes selection;
   - Enter starts a pull for the selected suggestion when one is actively selected;
   - otherwise Enter starts a pull for the exact non-empty trimmed text in the search field;
   - Escape closes the suggestion list.
7. Mouse click on a suggestion starts that image pull.
8. Direct typed references do not need to exist in Docker Hub search results.
9. Examples that must remain valid:
   - `nginx:latest`
   - `redis:7`
   - `ghcr.io/dhhieu113pro/ai-studio:latest`
   - `registry.example.com/team/app:1.2.3`

Search failures do not block direct references. The dropdown shows a compact non-destructive error state and the user may still press Enter to pull the typed value.

### Images page

Remove the current pull input and Pull button from the Images tab.

The page keeps:

- Images / Volumes tabs;
- local image inventory;
- image removal;
- volume creation/removal.

Add a short hint near the Images heading only if needed: image pulls are started from the title-bar search.

### Downloads icon

Add a Downloads button immediately before the appearance toggle in `Titlebar`.

Badge count = number of jobs in `queued`, `pulling`, or `cancelling` states.

The button remains visible from every main Quay view while WSLC is ready.

### Downloads popover

Clicking the Downloads button opens a compact panel anchored under the icon.

Sections:

- Active: queued, pulling, and cancelling jobs;
- Recent: completed, failed, cancelled, and interrupted jobs.

Each job row shows as much as is available:

- image reference;
- status;
- progress bar;
- downloaded bytes / total bytes;
- percentage;
- transfer speed;
- elapsed time;
- error text for failed/interrupted jobs.

Actions:

- cancel queued job;
- cancel active job;
- clear terminal job history;
- optionally open the Images view after a completed pull.

If byte totals cannot be derived from WSLC output, render an indeterminate progress bar and status text. Quay must never fabricate a percentage.

## Pull Job Model

Replace the existing minimal `PullJob` shape with an explicit model:

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
```

`progress` is only present when Quay can calculate a trustworthy value from native pull output.

## Native Pull Manager

Add `src-tauri/src/pull_manager.rs`.

Responsibilities:

- validate and normalize submitted references minimally without rejecting legitimate custom registries;
- create stable job IDs;
- own the job queue and state;
- run at most 2 pulls concurrently;
- start `wslc pull <reference>` outside `WslcExecutor`'s mutation mutex;
- read stdout and stderr incrementally;
- parse progress information when available;
- emit job snapshots to the frontend;
- cancel queued or running pulls;
- persist recent terminal job history;
- mark stale non-terminal persisted jobs as `interrupted` on a new Quay process start;
- terminate active child processes during an explicit application quit.

### Concurrency

Default concurrent pull limit: 2.

Additional jobs remain `queued` and begin automatically as slots become free.

Duplicate handling:

- do not enqueue a second non-terminal job for the exact same normalized reference;
- selecting the same reference while it is queued/pulling/cancelling exposes the existing job in Downloads rather than spawning a duplicate.

Completed images may be pulled again later.

### Process and progress handling

The pull manager launches `wslc pull <reference>` directly and keeps access to the child process.

Both stdout and stderr are read line-by-line while the process runs.

A small parser converts recognized output into a normalized progress update. The parser must be isolated and unit tested against representative WSLC pull output fixtures.

Do not assume that a `--json` or other structured-progress option exists unless verified against the WSLC version Quay supports. If a machine-readable mode is available and stable, prefer it behind the same parser interface. Otherwise, preserve raw stage text and report indeterminate progress when byte totals cannot be proven.

A successful exit marks the job `completed`. A non-zero exit marks it `failed` unless Quay initiated cancellation, in which case it becomes `cancelled`.

### Cancellation

For a queued job, remove it from the pending queue and mark it `cancelled`.

For a running job:

1. set state to `cancelling`;
2. terminate the owned child process;
3. wait for process exit;
4. mark it `cancelled`;
5. schedule the next queued job.

## Native Commands and Events

Expose focused Tauri commands rather than routing pull jobs through generic `wslc_invoke`:

- `image_search(query: String)` -> Docker Hub search results;
- `pull_start(reference: String)` -> `PullJob`;
- `pull_list()` -> `Vec<PullJob>`;
- `pull_cancel(id: String)` -> updated `PullJob`;
- `pull_clear_history()` -> remaining jobs.

Emit one stable event for job changes, for example:

- `quay://pull-job-updated`

Payload: complete `PullJob` snapshot.

The frontend listens once at application-shell/store initialization and upserts by job ID.

## Docker Hub Search Service

Implement search natively in Rust so the WebView does not depend on browser CORS behavior.

Use Docker Hub's public repository search endpoint behind a small `DockerHubSearch` function/service. The service maps remote data into a Quay-owned DTO:

```ts
export interface ImageSearchResult {
  name: string;
  description: string;
  official: boolean;
  stars?: number;
  pulls?: number;
  updatedAt?: string;
}
```

Requirements:

- URL-encode query input;
- maximum 8 displayed results;
- short request timeout;
- no authentication requirement for the initial feature;
- no GHCR search integration in this scope;
- direct GHCR/custom references remain pullable by typing them.

Search requests are triggered only after frontend debounce. Ignore stale results when a newer query has already been issued.

## Persistence and Lifecycle

Persist recent job metadata in Quay's app data directory as a small JSON document owned by `PullManager`. No extra persistence plugin is required.

Persist:

- queued/running snapshots for crash detection;
- terminal history;
- timestamps, progress metadata, and errors.

Retention:

- keep the most recent 50 terminal jobs;
- `Clear history` removes completed, failed, cancelled, and interrupted jobs from both memory and disk;
- active/non-terminal jobs are never removed by history cleanup.

Lifecycle rules:

- switching views: jobs continue;
- minimizing: jobs continue;
- closing the main window: existing Quay behavior hides to tray; jobs continue;
- restoring from tray: frontend re-requests `pull_list()` and reconciles state;
- application process restart: persisted `queued`, `pulling`, or `cancelling` jobs become `interrupted`; Quay does not claim to resume them;
- explicit Quit: the tray/menu quit path calls `PullManager.shutdown()` and terminates owned child processes before `app.exit(...)`; executor shutdown then follows the existing application shutdown path.

## Frontend State

Keep the existing global Zustand store as the frontend source used by components, but native `PullManager` is authoritative for execution state.

Store additions/actions:

- `pulls: PullJob[]`;
- `imageSearchResults: ImageSearchResult[]` or component-local search results;
- `startPull(reference)`;
- `cancelPull(id)`;
- `clearPullHistory()`;
- `syncPullJobs()`;
- `applyPullJobUpdate(job)`.

Remove image pulling from the generic `operations` map. Image removal remains a normal short mutation and continues using `operations`.

After a job reaches `completed`, trigger `refreshInventory()` so the pulled image appears in Images without requiring manual refresh.

## Components

Add focused components rather than expanding `app-shell.tsx` indefinitely:

- `src/components/image-search.tsx`
  - input, debounce, keyboard selection, suggestion popover, direct-reference submission;
- `src/components/downloads-button.tsx`
  - title-bar icon, active badge, popover trigger;
- `src/components/downloads-panel.tsx`
  - pull job lists, progress rendering, cancellation/history actions;
- optional `src/components/pull-progress.tsx`
  - reusable determinate/indeterminate progress presentation.

`Titlebar` composes `ImageSearch` and `DownloadsButton`.

The title bar's draggable region must not intercept pointer/keyboard interaction with the search field, dropdown, or downloads controls.

## Error Handling

Search errors:

- display compact search-specific feedback;
- do not write to the global fatal/error toast channel unless the native bridge itself is unavailable;
- preserve direct pull submission.

Pull errors:

- job becomes `failed` with the native error/output summary;
- Downloads badge no longer counts the failed job as active;
- show a toast when an active pull transitions to failed;
- retain the failure in Recent until cleared.

Native persistence errors:

- do not fail the download solely because history persistence failed;
- log/report a nonfatal application error;
- continue maintaining in-memory state.

## Testing Strategy

### Rust unit tests

Add tests for:

- pull output parser: determinate progress;
- pull output parser: indeterminate/stage-only output;
- successful completion transition;
- failed process transition;
- queued cancellation;
- running cancellation;
- duplicate active-reference suppression;
- max concurrency of 2;
- next queued job starts after completion/cancellation;
- persistence round trip;
- restart converts non-terminal jobs to `interrupted`;
- explicit shutdown terminates owned children;
- Docker Hub response mapping and invalid/empty query handling.

The process runner and HTTP search transport should be behind small testable interfaces so tests do not require real downloads or network access.

### Frontend tests

Add tests matching the repository's existing Node-based wiring/component contract style for:

- image search is rendered in the title bar;
- old Images pull form is removed;
- Downloads button is beside AppearanceToggle;
- active badge counts queued + pulling + cancelling only;
- Enter submits selected Docker Hub suggestion;
- Enter submits exact non-empty typed custom registry reference when no suggestion is selected;
- stale search responses do not replace newer results;
- pull update events upsert jobs;
- completed pull refreshes image inventory;
- cancel/clear actions call their native bridge methods;
- determinate vs indeterminate progress UI.

### Integration verification

Manual/desktop verification on Windows with real WSLC:

1. search `nginx` and verify suggestions;
2. start `nginx:latest` pull;
3. navigate to Containers while pulling;
4. start/stop a container during the pull and verify it is not blocked by the pull job;
5. open Downloads and observe live state/progress;
6. start two additional images and verify only two pull concurrently;
7. cancel one active job and verify the next queued job starts;
8. pull a direct GHCR reference;
9. hide Quay to tray and restore it while a pull is active;
10. verify completed images appear in Images;
11. explicitly Quit during a pull and verify Quay leaves no owned pull process behind.

## Files Expected to Change

Native:

- `src-tauri/src/lib.rs`
- `src-tauri/src/pull_manager.rs` (new)
- `src-tauri/src/docker_hub.rs` (new, or equivalent focused module)
- `src-tauri/Cargo.toml`

Frontend:

- `src/components/app-shell.tsx`
- `src/components/image-search.tsx` (new)
- `src/components/downloads-button.tsx` (new)
- `src/components/downloads-panel.tsx` (new)
- `src/components/views/images-view.tsx`
- `src/lib/tauri.ts`
- `src/lib/wslc/store.ts`
- `src/lib/wslc/types.ts`

Tests:

- Rust tests colocated with the new native modules or under the existing native test pattern;
- new `tests/*.test.mjs` frontend contract tests as appropriate.

## Out of Scope

Do not add in this change:

- GHCR repository search;
- authenticated/private-registry discovery UI;
- pause/resume of downloads;
- automatic retry policy;
- downloads that survive an explicit Quay process exit;
- detached helper service/daemon;
- arbitrary Docker registry browsing;
- image build/push workflows.

These can be added later without changing the core boundary: search providers feed image references, while `PullManager` owns pull execution.

## Acceptance Criteria

The feature is complete when:

1. the image search input is in the top bar and the Images page no longer owns the pull form;
2. Docker Hub suggestions appear after debounced typing;
3. any non-empty direct registry/image reference can be submitted from the search field;
4. pulls execute outside the existing WSLC mutation mutex;
5. up to two pulls can run concurrently and excess jobs queue;
6. live job state is visible from a Downloads icon beside the theme toggle from any view;
7. available progress is shown without fabricated percentages;
8. pulls continue while navigating or while the window is hidden to tray;
9. queued/running pulls are cancellable;
10. completed pulls refresh image inventory automatically;
11. recent terminal history is persisted and stale active jobs become `interrupted` after process restart;
12. explicit Quit terminates Quay-owned active pull children before process exit;
13. automated Rust and frontend tests cover the state machine, queueing, parser, native bridge, and critical UI wiring;
14. the existing container/session/image inventory workflows remain green.
