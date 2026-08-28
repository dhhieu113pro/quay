import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const types = await readFile(new URL("../src/lib/wslc/types.ts", import.meta.url), "utf8");
const tauri = await readFile(new URL("../src/lib/tauri.ts", import.meta.url), "utf8");
const native = await readFile(new URL("../src-tauri/src/lib.rs", import.meta.url), "utf8");
const store = await readFile(new URL("../src/lib/wslc/store.ts", import.meta.url), "utf8");

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

test("Tauri owns and exposes the native background pull manager", () => {
  for (const command of ["pull_start", "pull_list", "pull_cancel", "pull_clear_history"]) {
    assert.match(native, new RegExp(`fn ${command}\\b`));
  }
  assert.match(native, /pull_manager\.shutdown\(\)/);
  assert.match(native, /quay:\/\/pull-job-updated/);
});

test("Zustand reconciles native pull jobs", () => {
  for (const action of ["startPull", "cancelPull", "clearPullHistory", "syncPullJobs", "applyPullJobUpdate"]) {
    assert.match(store, new RegExp(`${action}:`));
  }
  assert.doesNotMatch(store, /pullImage:/);
  assert.match(store, /status === "completed"/);
  assert.match(store, /refreshInventory\(\)/);
  assert.match(store, /status === "failed"/);
});
