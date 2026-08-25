import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const store = readFileSync(new URL("../src/lib/wslc/store.ts", import.meta.url), "utf8");
const types = readFileSync(new URL("../src/lib/wslc/types.ts", import.meta.url), "utf8");
const utils = readFileSync(new URL("../src/lib/utils.ts", import.meta.url), "utf8");
const groups = readFileSync(new URL("../src/lib/wslc/groups.ts", import.meta.url), "utf8");
const appShell = readFileSync(new URL("../src/components/app-shell.tsx", import.meta.url), "utf8");
const sessionView = readFileSync(new URL("../src/components/views/session-view.tsx", import.meta.url), "utf8");
const imagesView = readFileSync(new URL("../src/components/views/images-view.tsx", import.meta.url), "utf8");
const dashboardView = readFileSync(new URL("../src/components/views/dashboard-view.tsx", import.meta.url), "utf8");
const groupsView = readFileSync(new URL("../src/components/views/groups-view.tsx", import.meta.url), "utf8");
const cubeContainerDialog = readFileSync(new URL("../src/components/cube-container-dialog.tsx", import.meta.url), "utf8");
const kvEditor = readFileSync(new URL("../src/components/kv-editor.tsx", import.meta.url), "utf8");

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

test("desktop sidebar does not duplicate status bar runtime information", () => {
  assert.doesNotMatch(appShell, /mt-auto border-t border-border px-4 py-3/);
  assert.match(appShell, /function StatusBar\(\)/);
  assert.match(appShell, /Quay v\{QUAY_VERSION\}/);
  assert.match(appShell, /\{running\} running/);
});

test("Windows sign-in settings do not render cube auto-start controls", () => {
  assert.doesNotMatch(sessionView, /setGroupAutoStart/);
  assert.doesNotMatch(sessionView, /groups\.map/);
  assert.doesNotMatch(sessionView, /Auto start/);
});

test("image and volume sizes are normalized to bytes before display", () => {
  assert.match(types, /export interface ImageRecord[\s\S]*?sizeBytes: number;/);
  assert.match(types, /export interface VolumeRecord[\s\S]*?sizeBytes: number;/);
  assert.doesNotMatch(types, /export interface ImageRecord[\s\S]*?sizeMB: number;/);
  assert.doesNotMatch(types, /export interface VolumeRecord[\s\S]*?sizeMB: number;/);
  assert.match(store, /function sizeBytesFrom/);
  assert.match(store, /Number\(value\(row, "size"\)\)/);
  assert.match(store, /Number\(value\(row, "sizemb"\)\).*1024.*1024/s);
  assert.match(imagesView, /formatBytes\(img\.sizeBytes\)/);
  assert.match(imagesView, /formatBytes\(volume\.sizeBytes\)/);
});

test("dashboard uses byte-normalized image totals and centralized MB conversion", () => {
  assert.match(dashboardView, /images\.reduce\(\(a, i\) => a \+ i\.sizeBytes, 0\)/);
  assert.doesNotMatch(dashboardView, /i\.sizeMB/);
  assert.match(utils, /export function mebibytesToBytes\(mebibytes: number\)/);
  assert.match(dashboardView, /formatBytes\(mebibytesToBytes\(host\.memoryUsedMB\)\)/);
  assert.match(dashboardView, /formatBytes\(mebibytesToBytes\(host\.memoryTotalMB\)\)/);
});

test("formatBytes accepts bytes and scales through binary units", () => {
  assert.match(utils, /export function formatBytes\(bytes: number\)/);
  assert.match(utils, /1024 \* 1024 \* 1024 \* 1024/);
  assert.match(utils, /TB/);
  assert.match(utils, /GB/);
  assert.match(utils, /MB/);
  assert.match(utils, /KB/);
  assert.match(utils, / B/);
});

test("Cube environment automatically imports variables from member containers", () => {
  assert.match(groups, /export function syncGroupEnv\(/);
  assert.match(groupsView, /syncGroupEnv\(/);
  assert.match(groupsView, /saveGroup\(syncGroupEnv\(/);
});

test("Cube environment wins when a container defines the same variable", () => {
  assert.match(groups, /env:\s*mergeEnv\(spec\.env,\s*group\.env\)/);
});

test("container environment editor exposes Cube variables as inherited and non-removable", () => {
  assert.match(kvEditor, /inheritedRows/);
  assert.match(cubeContainerDialog, /inheritedRows=/);
  assert.match(cubeContainerDialog, /withoutEnvKeys\(/);
});
