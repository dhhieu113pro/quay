import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const shell = await readFile(new URL("../src/components/app-shell.tsx", import.meta.url), "utf8");
const button = await readFile(new URL("../src/components/downloads-button.tsx", import.meta.url), "utf8").catch(() => "");
const panel = await readFile(new URL("../src/components/downloads-panel.tsx", import.meta.url), "utf8").catch(() => "");
const progress = await readFile(new URL("../src/components/pull-progress.tsx", import.meta.url), "utf8").catch(() => "");

test("titlebar exposes downloads immediately before appearance", () => {
  assert.match(shell, /<DownloadsButton[\s\S]*<AppearanceToggle compact/);
});

test("downloads badge counts native active pull states", () => {
  for (const state of ["queued", "pulling", "cancelling"]) {
    assert.match(button, new RegExp(`"${state}"`));
  }
});

test("downloads panel exposes cancellation, history, and image navigation", () => {
  assert.match(panel, /cancelPull/);
  assert.match(panel, /clearPullHistory/);
  assert.match(panel, /View images/);
});

test("pull progress supports determinate and indeterminate jobs", () => {
  assert.match(progress, /job\.progress/);
  assert.match(progress, /indeterminate|animate-pulse/);
});

test("app shell synchronizes pull history and subscribes to native updates", () => {
  assert.match(shell, /onPullJobUpdated/);
  assert.match(shell, /syncPullJobs/);
});
