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
