# Quay Workspace Root Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a first-class Quay workspace root with safe relative Cube/container workspace folders, native folder operations, migration prompts, rename handling, and an automatic managed `/workspace` mount.

**Architecture:** Introduce a focused workspace-domain module for path derivation/validation plus persisted workspace preferences in the existing Zustand store. Keep all persisted Cube/container paths relative, resolve them only at the WSLC execution boundary, and perform filesystem effects through explicit Tauri commands that validate containment before touching disk. UI changes in Settings, Cube configuration, and container configuration consume these centralized interfaces rather than constructing Windows paths themselves.

**Tech Stack:** React + TypeScript, Zustand, Tauri v2, Rust, existing Node regression tests, existing Windows x64/ARM64 GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-08-25-quay-workspace-root-design.md`

## Global Constraints

- Persist only relative Cube/container workspace paths; absolute paths are resolved at runtime from one global `workspaceRoot`.
- Default layout is `<root>/cubes/<cube>/<container>` and `<root>/containers/<container>`.
- `workspaceTarget` defaults to `/workspace` and remains editable per container.
- Cube/container workspace selections must stay inside the configured Quay root.
- Root changes use explicit **Move existing data / Keep existing data / Cancel** behavior.
- Rename operations use explicit **Rename folder / Keep existing folder / Cancel** behavior when the path is still the generated default.
- Never silently overwrite files during workspace moves or renames.
- Existing ordinary mounts remain unchanged and independent from the managed workspace mount.
- Existing installs migrate lazily; arbitrary absolute mounts are never converted automatically.
- CI must remain green on Windows x64 and Windows ARM64.

---

## File Structure

- Create `src/lib/workspace.ts` — pure path/default/validation helpers shared by UI and store.
- Modify `src/lib/wslc/types.ts` — add workspace fields to `RunSpec` and `ContainerGroup`.
- Modify `src/lib/wslc/prefs.ts` — persist the global `workspaceRoot`.
- Modify `src/lib/wslc/store.ts` — expose workspace state/actions and inject the managed mount at the WSLC command boundary.
- Modify `src/lib/tauri.ts` — typed wrappers for workspace native commands.
- Modify `src-tauri/src/lib.rs` — register workspace commands.
- Create `src-tauri/src/workspace.rs` — Windows filesystem validation, directory creation/open/move/rename helpers.
- Modify `src/components/views/session-view.tsx` — Workspace Settings UI and root migration prompt.
- Modify `src/components/views/groups-view.tsx` — Cube workspace path UI plus rename-folder prompt.
- Modify `src/components/cube-container-dialog.tsx` — Cube-member workspace path/target UI.
- Modify `src/components/run-dialog.tsx` — standalone container workspace path/target UI.
- Modify `tests/autostart-wiring.test.mjs` — wiring/regression coverage for the new frontend contracts.
- Create `tests/workspace.test.mjs` — executable pure TypeScript/Node tests for path behavior.
- Modify/add Rust unit tests in `src-tauri/src/workspace.rs` — containment, conflict, move ordering.

---

### Task 1: Workspace Domain Model and Pure Path Helpers

**Files:**
- Create: `src/lib/workspace.ts`
- Modify: `src/lib/wslc/types.ts`
- Create: `tests/workspace.test.mjs`

**Interfaces:**
- Produces: `DEFAULT_WORKSPACE_TARGET`, `normalizeWorkspacePath(path: string): string`, `defaultCubeWorkspacePath(name: string): string`, `defaultStandaloneWorkspacePath(name: string): string`, `defaultCubeContainerWorkspacePath(cubePath: string, containerName: string): string`, `resolveWorkspacePath(root: string, relativePath: string): string`, `isGeneratedCubeWorkspacePath(path: string | undefined, name: string): boolean`, `isGeneratedContainerWorkspacePath(path: string | undefined, parentPath: string | undefined, name: string): boolean`.
- Produces model fields: `ContainerGroup.workspacePath?: string`, `RunSpec.workspacePath?: string`, `RunSpec.workspaceTarget?: string`.

- [ ] **Step 1: Write failing pure-path tests**

Create `tests/workspace.test.mjs` with cases equivalent to:

```js
import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_WORKSPACE_TARGET,
  defaultCubeWorkspacePath,
  defaultCubeContainerWorkspacePath,
  defaultStandaloneWorkspacePath,
  normalizeWorkspacePath,
  resolveWorkspacePath,
} from "../src/lib/workspace.ts";

test("workspace defaults use portable relative paths", () => {
  assert.equal(defaultCubeWorkspacePath("Local Coding"), "cubes/local-coding");
  assert.equal(defaultCubeContainerWorkspacePath("cubes/local-coding", "API"), "cubes/local-coding/api");
  assert.equal(defaultStandaloneWorkspacePath("Postgres DB"), "containers/postgres-db");
  assert.equal(DEFAULT_WORKSPACE_TARGET, "/workspace");
});

test("workspace normalization rejects absolute and traversal paths", () => {
  assert.equal(normalizeWorkspacePath("cubes\\demo\\api"), "cubes/demo/api");
  assert.throws(() => normalizeWorkspacePath("C:\\temp"));
  assert.throws(() => normalizeWorkspacePath("../../other"));
  assert.throws(() => normalizeWorkspacePath("cubes/demo/../.."));
});

test("workspace resolution remains under the selected root", () => {
  assert.equal(resolveWorkspacePath("D:\\Quay", "cubes/demo/api"), "D:\\Quay\\cubes\\demo\\api");
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `node --test tests/workspace.test.mjs`

Expected: FAIL because `src/lib/workspace.ts` and the exported helpers do not exist.

- [ ] **Step 3: Add the model fields and minimal helper implementation**

In `src/lib/wslc/types.ts`, extend:

```ts
export interface RunSpec {
  // existing fields
  workspacePath?: string;
  workspaceTarget?: string;
}

export interface ContainerGroup {
  // existing fields
  workspacePath?: string;
}
```

Implement `src/lib/workspace.ts` with slugging consistent with Cube names, `/` as persisted separator, explicit rejection of drive-letter/UNC/leading-slash absolute paths, and Windows-path resolution only in `resolveWorkspacePath`.

- [ ] **Step 4: Run tests and verify GREEN**

Run: `node --test tests/workspace.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/workspace.ts src/lib/wslc/types.ts tests/workspace.test.mjs
git commit -m "feat: add workspace path model"
```

---

### Task 2: Persist the Global Workspace Root

**Files:**
- Modify: `src/lib/wslc/prefs.ts`
- Modify: `src/lib/wslc/store.ts`
- Test: `tests/autostart-wiring.test.mjs`

**Interfaces:**
- Consumes: workspace helpers from Task 1.
- Produces store state/actions: `workspaceRoot: string`, `setWorkspaceRoot(root: string): void`.
- Produces preference field: `workspaceRoot?: string`.

- [ ] **Step 1: Add failing wiring tests**

Extend `tests/autostart-wiring.test.mjs` to assert that prefs load/save `workspaceRoot`, `WslcState` exposes `workspaceRoot`, and `setWorkspaceRoot` persists through `savePrefs`.

- [ ] **Step 2: Run regression test and verify RED**

Run: `node --test tests/autostart-wiring.test.mjs`

Expected: FAIL on missing workspace preference/store wiring.

- [ ] **Step 3: Implement persistence**

Use the existing prefs object rather than introducing a second storage mechanism. Initialize the default root to a stable Windows per-user Quay workspace location resolved by the native layer in Task 3; until native resolution is available in browser/lab mode, use a deterministic fallback such as `D:\\Quay` only for lab/tests, not as the production Windows default.

Add `workspaceRoot` and `setWorkspaceRoot` to `WslcState`; `setWorkspaceRoot` updates state and calls `savePrefs({ ...currentPrefs, workspaceRoot: root })` through the existing prefs pattern.

- [ ] **Step 4: Run regression tests and verify GREEN**

Run: `node --test tests/autostart-wiring.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/wslc/prefs.ts src/lib/wslc/store.ts tests/autostart-wiring.test.mjs
git commit -m "feat: persist Quay workspace root"
```

---

### Task 3: Native Workspace Filesystem Service

**Files:**
- Create: `src-tauri/src/workspace.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/lib/tauri.ts`

**Interfaces:**
- Produces Tauri commands:
  - `workspace_default_root() -> Result<String, String>`
  - `workspace_ensure(root: String) -> Result<(), String>`
  - `workspace_pick_root(current: Option<String>) -> Result<Option<String>, String>`
  - `workspace_pick_descendant(root: String, current: Option<String>) -> Result<Option<String>, String>`
  - `workspace_open(root: String, relative: Option<String>) -> Result<(), String>`
  - `workspace_move_root(old_root: String, new_root: String) -> Result<(), String>`
  - `workspace_move_entry(root: String, from_relative: String, to_relative: String) -> Result<(), String>`
- Produces TypeScript wrappers with the same intent.

- [ ] **Step 1: Write Rust unit tests first**

In `workspace.rs`, add tests around pure internal helpers such as `validate_descendant(root, candidate)` and `move_without_overwrite(source, destination)` covering drive mismatch, `..`, case-insensitive Windows containment, missing source, and destination conflict.

- [ ] **Step 2: Run Rust tests and verify RED**

Run: `cargo test --manifest-path src-tauri/Cargo.toml workspace`

Expected: FAIL because module/helpers are not implemented.

- [ ] **Step 3: Implement the minimal native service**

Use `std::fs` for create/move operations. Validate canonical/normalized Windows paths before effects. For opening folders use the Windows shell (`explorer.exe`) through `Command`; for selection use the Tauri dialog facility already compatible with the app dependency set, adding only the minimal plugin/dependency if not present. Root moves operate only on `cubes` and `containers`; destination conflicts return an error before persistence changes.

- [ ] **Step 4: Register commands and add TypeScript wrappers**

Register each command in `src-tauri/src/lib.rs`. Add strongly typed wrappers in `src/lib/tauri.ts`, including browser/lab no-op or cancel-safe behavior.

- [ ] **Step 5: Run Rust tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml workspace`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/workspace.rs src-tauri/src/lib.rs src/lib/tauri.ts src-tauri/Cargo.toml src-tauri/Cargo.lock
git commit -m "feat: add native workspace filesystem service"
```

---

### Task 4: Settings Workspace Root UI and Migration Prompt

**Files:**
- Modify: `src/components/views/session-view.tsx`
- Modify: `src/lib/wslc/store.ts`
- Test: `tests/autostart-wiring.test.mjs`

**Interfaces:**
- Consumes Task 2 `workspaceRoot`, `setWorkspaceRoot`.
- Consumes Task 3 native wrappers: `pickWorkspaceRoot`, `ensureWorkspaceRoot`, `openWorkspacePath`, `moveWorkspaceRoot`.
- Produces store action: `changeWorkspaceRoot(nextRoot: string, mode: "move" | "keep"): Promise<void>`.

- [ ] **Step 1: Add failing UI/store wiring tests**

Assert `SessionView` contains a Workspace section, `Choose folder`, `Open folder`, and references `changeWorkspaceRoot`; assert store persists the root only after `moveWorkspaceRoot` resolves in move mode.

- [ ] **Step 2: Run regression test and verify RED**

Run: `node --test tests/autostart-wiring.test.mjs`

Expected: FAIL on missing Settings UI/action.

- [ ] **Step 3: Implement store transaction semantics**

Implement:

```ts
changeWorkspaceRoot: async (nextRoot, mode) => {
  const previous = get().workspaceRoot;
  await ensureWorkspaceRoot(nextRoot);
  if (mode === "move") await moveWorkspaceRoot(previous, nextRoot);
  set({ workspaceRoot: nextRoot });
  savePrefs(/* existing prefs + workspaceRoot */);
}
```

If any native call throws, set `lastError` and leave `workspaceRoot` unchanged.

- [ ] **Step 4: Implement Settings UI**

Add a Workspace card before Appearance. Show the root in a read-only/path field, `Choose folder`, and `Open folder`. After selecting a different root, open a confirmation dialog with exactly **Move existing data**, **Keep existing data**, and **Cancel**. Keep mode must warn that old files remain in the old root.

- [ ] **Step 5: Run tests and TypeScript**

Run:

```bash
node --test tests/autostart-wiring.test.mjs
pnpm exec tsc --noEmit
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/views/session-view.tsx src/lib/wslc/store.ts tests/autostart-wiring.test.mjs
git commit -m "feat: configure Quay workspace root"
```

---

### Task 5: Cube Workspace Paths and Rename Semantics

**Files:**
- Modify: `src/lib/wslc/groups.ts`
- Modify: `src/components/views/groups-view.tsx`
- Test: `tests/workspace.test.mjs`
- Test: `tests/autostart-wiring.test.mjs`

**Interfaces:**
- Consumes Task 1 `defaultCubeWorkspacePath`, `isGeneratedCubeWorkspacePath`, `resolveWorkspacePath`.
- Consumes Task 3 `pickWorkspaceDescendant`, `openWorkspacePath`, `moveWorkspaceEntry`.
- Produces lazy normalization: loaded/saved Cubes always expose a usable `workspacePath` in UI, while old persisted data remains compatible.

- [ ] **Step 1: Add failing Cube default and rename tests**

Add pure tests proving a Cube without `workspacePath` derives `cubes/<slug>`, a customized path remains unchanged on rename, and a generated default is recognizable for the rename prompt.

Add wiring assertions that `groups-view.tsx` displays `Workspace folder` and uses `moveWorkspaceEntry` only after explicit rename confirmation.

- [ ] **Step 2: Verify RED**

Run:

```bash
node --test tests/workspace.test.mjs
node --test tests/autostart-wiring.test.mjs
```

Expected: FAIL on missing Cube workspace integration.

- [ ] **Step 3: Normalize Cube workspace path in group loading/saving**

When reading a Cube with no `workspacePath`, expose `defaultCubeWorkspacePath(group.name)` without destructively migrating unrelated fields. On save, persist the normalized path.

- [ ] **Step 4: Add Cube editor controls**

Show relative path, resolved absolute path, `Choose folder`, and `Open`. Folder selection must convert the chosen absolute descendant back to a relative path before persistence.

On rename, if the previous path was generated from the old name, prompt **Rename folder / Keep existing folder / Cancel**. `Rename folder` invokes `moveWorkspaceEntry(root, oldRelative, newRelative)` first and only then saves the new name/path. `Keep` saves name but preserves path. `Cancel` closes the prompt without save.

- [ ] **Step 5: Run tests and TypeScript**

Run:

```bash
node --test tests/workspace.test.mjs tests/autostart-wiring.test.mjs
pnpm exec tsc --noEmit
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/wslc/groups.ts src/components/views/groups-view.tsx tests/workspace.test.mjs tests/autostart-wiring.test.mjs
git commit -m "feat: add Cube workspace folders"
```

---

### Task 6: Cube-Member Container Workspace UI

**Files:**
- Modify: `src/components/cube-container-dialog.tsx`
- Modify: `src/lib/wslc/groups.ts`
- Test: `tests/workspace.test.mjs`
- Test: `tests/autostart-wiring.test.mjs`

**Interfaces:**
- Consumes Task 1 `defaultCubeContainerWorkspacePath`, `DEFAULT_WORKSPACE_TARGET`, `isGeneratedContainerWorkspacePath`.
- Consumes Cube `workspacePath` from Task 5.
- Consumes Task 3 picker/open/move wrappers.

- [ ] **Step 1: Add failing default/member tests**

Add a pure test that a Cube member `api` under `cubes/local-coding` derives `cubes/local-coding/api` and `/workspace` target. Add wiring assertions for `workspacePath`, `workspaceTarget`, `Choose folder`, and `Open` in `cube-container-dialog.tsx`.

- [ ] **Step 2: Verify RED**

Run: `node --test tests/workspace.test.mjs tests/autostart-wiring.test.mjs`

Expected: FAIL.

- [ ] **Step 3: Add Cube-member fields and save behavior**

When initializing a new member spec, fill missing `workspacePath` from the parent Cube path and missing `workspaceTarget` with `/workspace`. Persist relative path/target in `RunSpec`; do not add the managed workspace into ordinary `mounts` text.

- [ ] **Step 4: Add container rename prompt**

If name changes while the path is still generated from the old name, prompt **Rename folder / Keep existing folder / Cancel** with the same transactional ordering as Task 5.

- [ ] **Step 5: Run tests and TypeScript**

Run:

```bash
node --test tests/workspace.test.mjs tests/autostart-wiring.test.mjs
pnpm exec tsc --noEmit
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/components/cube-container-dialog.tsx src/lib/wslc/groups.ts tests/workspace.test.mjs tests/autostart-wiring.test.mjs
git commit -m "feat: add Cube container workspace folders"
```

---

### Task 7: Standalone Container Workspace UI

**Files:**
- Modify: `src/components/run-dialog.tsx`
- Test: `tests/workspace.test.mjs`
- Test: `tests/autostart-wiring.test.mjs`

**Interfaces:**
- Consumes Task 1 `defaultStandaloneWorkspacePath`, `DEFAULT_WORKSPACE_TARGET`.
- Consumes Task 3 picker/open wrappers.

- [ ] **Step 1: Add failing standalone-container wiring test**

Assert `run-dialog.tsx` initializes `workspacePath` using `containers/<slug(name)>`, initializes `workspaceTarget` to `/workspace`, and renders Workspace folder controls separate from ordinary Mounts.

- [ ] **Step 2: Verify RED**

Run: `node --test tests/autostart-wiring.test.mjs`

Expected: FAIL.

- [ ] **Step 3: Implement standalone defaults/UI**

Add Workspace folder and container destination controls. Keep path relative and selection constrained under the global root. Do not inject a textual `-v` row into the normal mounts editor.

- [ ] **Step 4: Run tests and TypeScript**

Run:

```bash
node --test tests/workspace.test.mjs tests/autostart-wiring.test.mjs
pnpm exec tsc --noEmit
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/run-dialog.tsx tests/workspace.test.mjs tests/autostart-wiring.test.mjs
git commit -m "feat: add standalone container workspaces"
```

---

### Task 8: Managed Workspace Mount at the WSLC Boundary

**Files:**
- Modify: `src/lib/wslc/store.ts`
- Test: `tests/workspace.test.mjs`
- Test: `tests/autostart-wiring.test.mjs`

**Interfaces:**
- Consumes Task 1 `resolveWorkspacePath`, `DEFAULT_WORKSPACE_TARGET`.
- Consumes Task 2 `workspaceRoot`.
- Changes `runArgs` contract to accept the workspace root or a resolved managed mount while preserving ordinary mounts.

- [ ] **Step 1: Add failing managed-mount regression tests**

Assert that a spec with `workspacePath: "cubes/demo/api"`, `workspaceTarget: "/workspace"`, and ordinary mount `D:\\data:/data:rw` produces both `-v D:\\Quay\\cubes\\demo\\api:/workspace:rw` and `-v D:\\data:/data:rw`, with the managed mount generated separately from `spec.mounts`.

- [ ] **Step 2: Verify RED**

Run: `node --test tests/workspace.test.mjs tests/autostart-wiring.test.mjs`

Expected: FAIL because `runArgs` does not resolve/add the managed mount.

- [ ] **Step 3: Implement final-boundary mount generation**

Before invoking WSLC, derive effective `workspacePath` lazily if absent, call `ensureHostDirectory(resolvedSource)`, and append:

```ts
args.push("-v", `${resolvedSource}:${spec.workspaceTarget || DEFAULT_WORKSPACE_TARGET}:rw`);
```

Then append ordinary `spec.mounts` exactly as before. The Cube root itself is never mounted automatically; only each member spec's own workspace path is mounted.

- [ ] **Step 4: Run frontend tests and TypeScript**

Run:

```bash
node --test tests/workspace.test.mjs tests/autostart-wiring.test.mjs
pnpm exec tsc --noEmit
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/wslc/store.ts tests/workspace.test.mjs tests/autostart-wiring.test.mjs
git commit -m "feat: mount managed container workspaces"
```

---

### Task 9: Backward Compatibility and Lazy Migration

**Files:**
- Modify: `src/lib/wslc/groups.ts`
- Modify: `src/lib/wslc/store.ts`
- Modify: `src/components/run-dialog.tsx`
- Test: `tests/workspace.test.mjs`

**Interfaces:**
- Consumes all Task 1 path-default helpers.
- Guarantees old `RunSpec`/Cube objects without workspace fields remain runnable and existing absolute ordinary mounts remain untouched.

- [ ] **Step 1: Add failing compatibility tests**

Add fixtures representing pre-feature Cube and RunSpec data. Assert generated workspace fields appear at use/save time, existing `mounts` strings are byte-for-byte unchanged, and no arbitrary mount is rewritten under `workspaceRoot`.

- [ ] **Step 2: Verify RED**

Run: `node --test tests/workspace.test.mjs`

Expected: FAIL on one or more compatibility expectations.

- [ ] **Step 3: Implement lazy defaults only**

Centralize fallback calculation so missing fields are derived at read/run time and only persisted when the user saves the affected Cube/container. Do not run an eager migration over localStorage.

- [ ] **Step 4: Run tests**

Run: `node --test tests/workspace.test.mjs tests/autostart-wiring.test.mjs`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/wslc/groups.ts src/lib/wslc/store.ts src/components/run-dialog.tsx tests/workspace.test.mjs
git commit -m "fix: preserve existing mounts during workspace migration"
```

---

### Task 10: Full Verification and PR

**Files:**
- Modify only if verification exposes defects.

**Interfaces:**
- Validates the complete feature across frontend, Rust, installer, and both Windows architectures.

- [ ] **Step 1: Run all Node regression tests**

```bash
node --test tests/*.test.mjs
```

Expected: all PASS.

- [ ] **Step 2: Run TypeScript validation**

```bash
pnpm install --frozen-lockfile
pnpm exec tsc --noEmit
```

Expected: PASS.

- [ ] **Step 3: Run Rust tests**

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

Expected: PASS.

- [ ] **Step 4: Run the Windows installer build command used by CI**

Use the exact `Build Windows installer` command from `.github/workflows/ci.yml` for the local/current architecture where available.

Expected: successful bundle generation.

- [ ] **Step 5: Review the diff against the spec**

Check specifically that:

```text
- no absolute Cube/container workspace paths are persisted
- no move happens without explicit user choice
- no destination conflict is overwritten
- Cube/container rename persistence occurs only after successful move
- ordinary mounts are unchanged
- managed workspace mount is separate and non-deletable in the ordinary mounts UI
- /workspace remains only the default and is editable
```

- [ ] **Step 6: Push implementation branch and open PR**

Create a feature branch from current `main` (not the design-only branch), apply the implementation commits, push, and open a PR whose body links both:

```text
docs/superpowers/specs/2026-08-25-quay-workspace-root-design.md
docs/superpowers/plans/2026-08-25-quay-workspace-root.md
```

- [ ] **Step 7: Wait for GitHub Actions**

Require both Windows jobs to finish successfully:

```text
windows-latest / x86_64-pc-windows-msvc / x64
windows-11-arm / aarch64-pc-windows-msvc / arm64
```

Do not merge while either is queued, running, failed, cancelled, or skipped in a blocking way.
