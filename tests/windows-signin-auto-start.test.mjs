import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const nativeLib = readFileSync(new URL("../src-tauri/src/lib.rs", import.meta.url), "utf8");
const tauri = readFileSync(new URL("../src/lib/tauri.ts", import.meta.url), "utf8");
const appShell = readFileSync(new URL("../src/components/app-shell.tsx", import.meta.url), "utf8");
const containersView = readFileSync(new URL("../src/components/views/containers-view.tsx", import.meta.url), "utf8");
const groupsView = readFileSync(new URL("../src/components/views/groups-view.tsx", import.meta.url), "utf8");
const containerAutoStartUrl = new URL("../src/lib/wslc/container-autostart.ts", import.meta.url);
const containerAutoStart = existsSync(containerAutoStartUrl) ? readFileSync(containerAutoStartUrl, "utf8") : "";

test("Windows startup registration marks launches that came from sign-in", () => {
  assert.match(nativeLib, /WINDOWS_SIGN_IN_ARG/);
  assert.match(nativeLib, /--windows-sign-in/);
  assert.match(nativeLib, /windows_sign_in_launch/);
  assert.match(tauri, /startedAtWindowsSignIn/);
});

test("legacy Quay startup registrations are rewritten when enabled", () => {
  assert.match(tauri, /getLaunchAtSignIn\([\s\S]*?autostart_enabled[\s\S]*?autostart_set/);
});

test("manual Quay launches do not run sign-in auto-start targets", () => {
  assert.match(appShell, /if\s*\(!\(await startedAtWindowsSignIn\(\)\)\)\s*return;/);
});

test("sign-in auto-start refreshes the WSLC container inventory before deciding what to start", () => {
  assert.match(appShell, /await\s+tick\(\);[\s\S]*useWslc\.getState\(\)/);
});

test("standalone container auto-start preferences are persisted by container name", () => {
  assert.match(containerAutoStart, /Record<string, boolean>/);
  assert.match(containerAutoStart, /localStorage/);
  assert.match(containerAutoStart, /setContainerAutoStart/);
  assert.match(containerAutoStart, /\[name\]/);
});

test("standalone auto-start requires an explicit true preference", () => {
  assert.match(appShell, /selected\[container\.name\]\s*!==\s*true/);
});

test("sign-in auto-start skips already-running standalone containers and Cube members", () => {
  assert.match(appShell, /container\.status\s*===\s*"running"/);
  assert.match(appShell, /cubeNames\.has\(container\.name\)/);
  assert.match(appShell, /startAutoGroups\(\)/);
});

test("Containers UI exposes a per-container Windows sign-in toggle", () => {
  assert.match(containersView, /setContainerAutoStart/);
  assert.match(containersView, /Start at Windows sign-in/);
});

test("Cubes UI exposes the existing Cube auto-start flag", () => {
  assert.match(groupsView, /setGroupAutoStart/);
  assert.match(groupsView, /Start at Windows sign-in/);
});
