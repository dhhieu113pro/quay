# Quay Getting Started Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a first-run Getting Started experience that defaults Quay workspace storage to the app-data location, verifies WSLC readiness, captures essential preferences, and can be re-run from Settings.

**Architecture:** Keep onboarding state in the existing persisted Quay preferences/store rather than introducing a second settings system. Add one focused Getting Started view gated at the root route, reuse existing workspace migration and autostart APIs, and change the native default workspace root to Quay's application-data directory.

**Tech Stack:** React 19, TypeScript 5.9, Zustand, TanStack Router, Tauri 2, Rust, existing Node regression tests, GitHub Actions Windows x64/ARM64.

**Spec:** `docs/superpowers/specs/2026-08-25-getting-started-design.md`

## Global Constraints

- First-run workspace root is required and defaults to Quay's app-data-managed location.
- Existing persisted workspace roots remain authoritative for upgrading users.
- Onboarding is shown automatically only while `onboardingCompleted !== true`.
- The first-run screen has no skip action.
- Re-run mode is available from Settings and can be cancelled.
- Workspace migration must reuse the existing Move / Keep / Cancel behavior.
- Windows sign-in defaults off.
- Appearance defaults to System.
- Do not add network, registry, Cube, container env, or mount configuration to onboarding.
- `onboardingCompleted` is persisted only after required workspace setup succeeds.
- CI must cover Windows x64 and ARM64, TypeScript, Rust tests, and installer builds.

---

### Task 1: Persist onboarding completion without breaking existing preferences

**Files:**
- Modify: `src/lib/wslc/prefs.ts`
- Modify: `src/lib/wslc/store.ts`
- Test: `tests/getting-started.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces: `QuayPrefs.onboardingCompleted?: boolean`
- Produces store state: `onboardingCompleted: boolean`
- Produces store action: `setOnboardingCompleted(completed: boolean): void`
- Existing `workspaceRoot` and `launchAtSignIn` remain the single sources of truth.

- [ ] **Step 1: Write the failing preference tests**

Create `tests/getting-started.test.mjs` with assertions that `prefs.ts` declares `onboardingCompleted?: boolean`, fallback load yields false/undefined semantics, and save/load preserves true.

- [ ] **Step 2: Wire a dedicated test script**

Add to `package.json`:

```json
"test:getting-started": "node --test tests/getting-started.test.mjs"
```

Also include this test file in the existing CI regression script used by the Windows jobs so it runs on both architectures.

- [ ] **Step 3: Run the tests and verify RED**

Run:

```bash
pnpm test:getting-started
```

Expected: FAIL because `onboardingCompleted` is not yet persisted.

- [ ] **Step 4: Implement minimal preference/store persistence**

In `prefs.ts`, extend `QuayPrefs`:

```ts
onboardingCompleted?: boolean;
```

Normalize loaded JSON with:

```ts
onboardingCompleted: parsed.onboardingCompleted === true,
```

In `WslcState`, add:

```ts
onboardingCompleted: boolean;
setOnboardingCompleted: (completed: boolean) => void;
```

Initialize from `prefs.onboardingCompleted === true`, include it in every `saveCurrentPrefs()` write, and make `setOnboardingCompleted` update state and preferences together.

- [ ] **Step 5: Run tests and typecheck**

```bash
pnpm test:getting-started
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/wslc/prefs.ts src/lib/wslc/store.ts tests/getting-started.test.mjs package.json
git commit -m "feat: persist getting started state"
```

---

### Task 2: Make native workspace default use Quay AppData

**Files:**
- Modify: `src-tauri/src/workspace.rs`
- Modify if needed for Tauri access: `src-tauri/src/lib.rs`
- Test: Rust unit tests in `src-tauri/src/workspace.rs`
- Test: `tests/getting-started.test.mjs`

**Interfaces:**
- Existing frontend API remains `getDefaultWorkspaceRoot(): Promise<string>`.
- Existing Tauri command remains `workspace_default_root`.
- New behavior returns a Quay-owned application-data path, not `%USERPROFILE%\\Quay`.

- [ ] **Step 1: Add a failing Rust test for the path policy**

Extract the path construction into a pure helper that accepts an app-data base path:

```rust
fn default_workspace_root_from_app_data(app_data: &Path) -> PathBuf
```

Test that `C:\\Users\\me\\AppData\\Roaming\\Quay` resolves to a workspace root under that Quay application directory and does not fall back to `C:\\Users\\me\\Quay`.

- [ ] **Step 2: Verify RED**

```bash
cargo test --manifest-path src-tauri/Cargo.toml workspace
```

Expected: FAIL until the helper/native command is updated.

- [ ] **Step 3: Resolve the Tauri application-data directory natively**

Update `workspace_default_root` to use Tauri's application path resolver associated with the Quay application. Keep the command frontend-compatible and return an absolute Windows path string.

The command must not read `%APPDATA%` manually or synthesize a username path in TypeScript.

- [ ] **Step 4: Keep browser-lab fallback deterministic**

In `src/lib/tauri.ts`, change the non-Tauri fallback from `D:\\Quay` to a clearly synthetic app-data-style lab path, for example:

```ts
"D:\\QuayAppData\\workspace"
```

This fallback is test-only/browser-lab behavior; native Windows remains authoritative.

- [ ] **Step 5: Run Rust and frontend regression tests**

```bash
cargo test --manifest-path src-tauri/Cargo.toml
pnpm test:getting-started
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/workspace.rs src-tauri/src/lib.rs src/lib/tauri.ts tests/getting-started.test.mjs
git commit -m "feat: default workspace to Quay app data"
```

---

### Task 3: Add transactional onboarding completion action

**Files:**
- Modify: `src/lib/wslc/store.ts`
- Test: `tests/getting-started.test.mjs`

**Interfaces:**
- Produces:

```ts
type CompleteOnboardingInput = {
  workspaceRoot: string;
  launchAtSignIn: boolean;
};

completeOnboarding(input: CompleteOnboardingInput): Promise<void>;
```

- Consumes existing `ensureWorkspaceRoot`, `setNativeLaunchAtSignIn`, and persisted prefs.

- [ ] **Step 1: Add failing tests for transaction ordering**

Assert source-level wiring that `completeOnboarding` calls workspace validation/creation before setting `onboardingCompleted: true`, and that the completion flag is not written on the error path.

- [ ] **Step 2: Verify RED**

```bash
pnpm test:getting-started
```

Expected: FAIL because `completeOnboarding` does not exist.

- [ ] **Step 3: Implement the store action**

Add `completeOnboarding` to `WslcState` and implement:

```ts
await ensureWorkspaceRoot(input.workspaceRoot);
const launchAtSignIn = await setNativeLaunchAtSignIn(input.launchAtSignIn);
set({
  workspaceRoot: input.workspaceRoot,
  launchAtSignIn,
  onboardingCompleted: true,
});
saveCurrentPrefs({
  workspaceRoot: input.workspaceRoot,
  launchAtSignIn,
  onboardingCompleted: true,
});
```

Do not set state/prefs to completed before `ensureWorkspaceRoot` succeeds.

- [ ] **Step 4: Run tests/typecheck**

```bash
pnpm test:getting-started
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/wslc/store.ts tests/getting-started.test.mjs
git commit -m "feat: complete onboarding transactionally"
```

---

### Task 4: Build the Getting Started view

**Files:**
- Create: `src/components/views/getting-started-view.tsx`
- Reuse: `src/components/appearance-toggle.tsx`
- Reuse: `src/components/ui/button.tsx`, `input.tsx`, `switch.tsx`
- Test: `tests/getting-started.test.mjs`

**Interfaces:**
- Component:

```ts
export function GettingStartedView({ rerun = false, onDone, onCancel }: {
  rerun?: boolean;
  onDone?: () => void;
  onCancel?: () => void;
}): JSX.Element;
```

- Consumes store state/actions: `workspaceRoot`, `launchAtSignIn`, `session`, `gate`, `probeNote`, `completeOnboarding`, `changeWorkspaceRoot`, `startSession`.
- Consumes Tauri APIs: `getDefaultWorkspaceRoot`, `pickWorkspaceRoot`, `openWorkspacePath`.

- [ ] **Step 1: Add failing UI wiring tests**

Assert the new view contains the three approved sections and exact primary copy:

```text
Welcome to Quay
Workspace
WSLC
Preferences
Start using Quay
```

Assert first-run mode has no skip button and sign-in defaults from store false.

- [ ] **Step 2: Verify RED**

```bash
pnpm test:getting-started
```

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement first-run workspace state**

On mount, if the store has a persisted non-empty workspace root use it. Otherwise call `getDefaultWorkspaceRoot()` and display that value. Keep the selection in local draft state until completion.

Provide **Choose folder** via `pickWorkspaceRoot(draftRoot)` and **Open folder** via `openWorkspacePath(draftRoot)`.

- [ ] **Step 4: Implement WSLC readiness section**

Render status from existing store probe/session state:

- Ready when gate/runtime is available;
- Stopped when installed but session not running;
- Missing/unavailable when probe says WSLC is absent.

Expose **Start WSLC** only when the runtime is installed but stopped, calling existing `startSession()`.

Do not add WSLC configuration fields.

- [ ] **Step 5: Implement preferences section**

Use local onboarding draft state for Windows sign-in, initialized false on genuine first run and current setting in re-run mode. Render existing appearance control, which defaults to System through the existing appearance subsystem.

- [ ] **Step 6: Implement completion/error UX**

On **Start using Quay**, call `completeOnboarding({ workspaceRoot: draftRoot, launchAtSignIn })`. Disable the action while saving. On failure, keep the user on the page and show a `toast.error`/inline actionable error; do not call `onDone`.

When successful, call `onDone?.()`.

In rerun mode only, show **Cancel** that invokes `onCancel?.()`.

- [ ] **Step 7: Run tests/typecheck**

```bash
pnpm test:getting-started
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/components/views/getting-started-view.tsx tests/getting-started.test.mjs
git commit -m "feat: add Quay getting started view"
```

---

### Task 5: Gate initial app startup on onboarding completion

**Files:**
- Modify: `src/routes/index.tsx`
- Possibly modify: `src/components/app-shell.tsx` only if startup state must be surfaced there
- Test: `tests/getting-started.test.mjs`

**Interfaces:**
- Root route chooses `GettingStartedView` when `onboardingCompleted` is false and `AppShell` when true.
- No new route is required unless TanStack Router hydration behavior makes a dedicated route necessary.

- [ ] **Step 1: Add failing route-gate tests**

Assert `index.tsx` consumes `onboardingCompleted` and renders `GettingStartedView` before `AppShell` for incomplete state.

- [ ] **Step 2: Verify RED**

```bash
pnpm test:getting-started
```

Expected: FAIL.

- [ ] **Step 3: Implement the gate**

In `Home`, read `onboardingCompleted` from `useWslc`. Render:

```tsx
return onboardingCompleted ? <AppShell /> : <GettingStartedView />;
```

Do not show normal navigation/sidebar before onboarding is complete.

- [ ] **Step 4: Verify first-run/returning-user behavior**

Run:

```bash
pnpm test:getting-started
pnpm typecheck
```

Expected: tests cover both incomplete and completed preference states.

- [ ] **Step 5: Commit**

```bash
git add src/routes/index.tsx tests/getting-started.test.mjs
git commit -m "feat: gate Quay on getting started"
```

---

### Task 6: Add Settings re-run flow and reuse workspace migration

**Files:**
- Modify: `src/components/views/session-view.tsx`
- Modify: `src/components/app-shell.tsx` if a view overlay/state hook is needed
- Modify: `src/components/views/getting-started-view.tsx`
- Test: `tests/getting-started.test.mjs`

**Interfaces:**
- Settings exposes **Run Getting Started again**.
- Re-run mode can cancel back to Settings.
- Changing workspace during re-run uses existing `changeWorkspaceRoot(nextRoot, "move" | "keep")` and the existing Move / Keep / Cancel decision rather than directly calling `completeOnboarding` with a changed root.

- [ ] **Step 1: Add failing re-run tests**

Assert Settings contains `Run Getting Started again`, rerun mode exposes Cancel, and workspace changes reference `changeWorkspaceRoot` / Move / Keep choices.

- [ ] **Step 2: Verify RED**

```bash
pnpm test:getting-started
```

Expected: FAIL.

- [ ] **Step 3: Add a lightweight Settings launch state**

Use local UI state in `SessionView` (or AppShell only if required) to open `GettingStartedView rerun` without resetting `onboardingCompleted`.

- [ ] **Step 4: Reuse migration behavior**

When re-run draft root differs from current root, present the same semantic choices:

```text
Move existing data
Keep existing data
Cancel
```

Call existing `changeWorkspaceRoot(nextRoot, mode)` before saving remaining onboarding preferences. Do not duplicate `moveWorkspaceRoot` logic in the component.

- [ ] **Step 5: Preserve existing data**

Do not clear groups, containers, images, volumes, or preferences when re-running onboarding.

- [ ] **Step 6: Run regression tests/typecheck**

```bash
pnpm test:getting-started
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/components/views/session-view.tsx src/components/views/getting-started-view.tsx src/components/app-shell.tsx tests/getting-started.test.mjs
git commit -m "feat: rerun getting started from settings"
```

---

### Task 7: Full verification and PR readiness

**Files:**
- Modify only if verification exposes defects: relevant files above
- Verify: `.github/workflows/ci.yml`

**Interfaces:**
- No new production interface.

- [ ] **Step 1: Run all frontend regression suites**

```bash
pnpm test:autostart
pnpm test:getting-started
pnpm test:store-submission
pnpm test:pages
pnpm typecheck
```

Expected: PASS.

- [ ] **Step 2: Run Rust tests locally where supported**

```bash
cargo test --manifest-path src-tauri/Cargo.toml
```

Expected: PASS.

- [ ] **Step 3: Review CI wiring**

Confirm `tests/getting-started.test.mjs` runs in the Windows matrix before TypeScript/build steps on both:

```text
windows-latest / x86_64-pc-windows-msvc
windows-11-arm / aarch64-pc-windows-msvc
```

- [ ] **Step 4: Inspect the complete diff against the spec**

Confirm:

- AppData default is native and not synthesized in frontend code;
- first run cannot skip;
- workspace creation gates completion;
- WSLC setup is status/action only;
- sign-in defaults off;
- theme remains System by default;
- Settings re-run exists;
- workspace migration is reused;
- no advanced Cube/container config leaked into onboarding.

- [ ] **Step 5: Push/open the implementation PR and wait for full CI**

Do not merge until both Windows jobs complete successfully through installer builds.

- [ ] **Step 6: Commit any final verification-only fixes**

```bash
git add <only-files-changed-by-verification>
git commit -m "fix: complete getting started verification"
```

Skip this commit if verification required no code changes.
