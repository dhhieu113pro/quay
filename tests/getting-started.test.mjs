import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("preferences persist onboarding completion", async () => {
  const source = await read("src/lib/wslc/prefs.ts");
  assert.match(source, /onboardingCompleted\?: boolean/);
  assert.match(source, /onboardingCompleted:\s*parsed\.onboardingCompleted === true/);
});

test("store completes onboarding only after workspace setup", async () => {
  const source = await read("src/lib/wslc/store.ts");
  assert.match(source, /completeOnboarding/);
  assert.ok(source.indexOf("ensureWorkspaceRoot(input.workspaceRoot)") < source.indexOf("onboardingCompleted: true"));
});

test("native default workspace comes from app data", async () => {
  const rust = await read("src-tauri/src/workspace.rs");
  const tauri = await read("src/lib/tauri.ts");
  assert.match(rust, /default_workspace_root_from_app_data/);
  assert.doesNotMatch(rust, /join\("Quay"\).*USERPROFILE/s);
  assert.match(tauri, /QuayAppData/);
});

test("getting started view contains approved essential setup", async () => {
  const source = await read("src/components/views/getting-started-view.tsx");
  for (const text of ["Welcome to Quay", "Workspace", "WSLC", "Preferences", "Start using Quay"]) {
    assert.match(source, new RegExp(text));
  }
  assert.match(source, /rerun/);
  assert.match(source, /Move existing data/);
  assert.match(source, /Keep existing data/);
});

test("root route gates AppShell until onboarding completes", async () => {
  const source = await read("src/routes/index.tsx");
  assert.match(source, /onboardingCompleted/);
  assert.match(source, /GettingStartedView/);
  assert.match(source, /AppShell/);
});

test("Settings can rerun Getting Started", async () => {
  const source = await read("src/components/views/session-view.tsx");
  assert.match(source, /Run Getting Started again/);
});
