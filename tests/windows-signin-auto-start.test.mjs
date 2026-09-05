import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const nativeLib = readFileSync(new URL("../src-tauri/src/lib.rs", import.meta.url), "utf8");
const tauri = readFileSync(new URL("../src/lib/tauri.ts", import.meta.url), "utf8");
const prefs = readFileSync(new URL("../src/lib/wslc/prefs.ts", import.meta.url), "utf8");
const store = readFileSync(new URL("../src/lib/wslc/store.ts", import.meta.url), "utf8");
const containersView = readFileSync(new URL("../src/components/views/containers-view.tsx", import.meta.url), "utf8");
const groupsView = readFileSync(new URL("../src/components/views/groups-view.tsx", import.meta.url), "utf8");

test("Windows startup registration marks launches that came from sign-in", () => {
  assert.match(nativeLib, /WINDOWS_SIGN_IN_ARG/);
  assert.match(nativeLib, /--windows-sign-in/);
  assert.match(nativeLib, /windows_sign_in_launch/);
  assert.match(tauri, /startedAtWindowsSignIn/);
});

test("manual Quay launches do not run sign-in auto-start targets", () => {
  assert.match(store, /if\s*\(!\(await startedAtWindowsSignIn\(\)\)\)\s*return;/);
});

test("sign-in auto-start waits for the current WSLC inventory", () => {
  assert.match(store, /await\s+refreshAll\(\);[\s\S]*await\s+startWindowsSignInTargets\(\);/);
});

test("standalone container auto-start preferences are persisted by container name", () => {
  assert.match(prefs, /containerAuto:\s*Record<string, boolean>/);
  assert.match(store, /containerAuto:\s*prefs\.containerAuto/);
  assert.match(store, /setContainerAutoStart/);
  assert.match(store, /containerAuto\[container\.name\]/);
});

test("sign-in auto-start skips already-running standalone containers and Cube members", () => {
  assert.match(store, /container\.status\s*!==\s*"running"/);
  assert.match(store, /cubeNames\.has\(container\.name\)/);
  assert.match(store, /group\.autoStart/);
});

test("Containers UI exposes a per-container Windows sign-in toggle", () => {
  assert.match(containersView, /setContainerAutoStart/);
  assert.match(containersView, /Start at Windows sign-in/);
});

test("Cubes UI exposes the existing Cube auto-start flag", () => {
  assert.match(groupsView, /setGroupAutoStart/);
  assert.match(groupsView, /Start at Windows sign-in/);
});
