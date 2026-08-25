import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const store = readFileSync(new URL("../src/lib/wslc/store.ts", import.meta.url), "utf8");
const appShell = readFileSync(new URL("../src/components/app-shell.tsx", import.meta.url), "utf8");
const sessionView = readFileSync(new URL("../src/components/views/session-view.tsx", import.meta.url), "utf8");

test("Windows sign-in preference delegates to the native Tauri autostart bridge", () => {
  assert.match(store, /getLaunchAtSignIn/);
  assert.match(store, /setNativeLaunchAtSignIn/);
  assert.match(store, /await\s+setNativeLaunchAtSignIn\(launchAtSignIn\)/);
});

test("Windows sign-in preference is reconciled from the operating system", () => {
  assert.match(store, /await\s+getLaunchAtSignIn\(\)/);
  assert.match(store, /launchAtSignIn:\s+nativeLaunchAtSignIn/);
});

test("settings navigation uses the Settings label while preserving the session view id", () => {
  assert.match(appShell, /\{ id: "session", label: "Settings", icon: Cpu \}/);
  assert.doesNotMatch(appShell, /\{ id: "session", label: "Session", icon: Cpu \}/);
});

test("Windows sign-in settings do not render cube auto-start controls", () => {
  assert.doesNotMatch(sessionView, /setGroupAutoStart/);
  assert.doesNotMatch(sessionView, /groups\.map/);
  assert.doesNotMatch(sessionView, /Auto start/);
});
