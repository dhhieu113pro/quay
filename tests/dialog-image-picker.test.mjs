import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const runDialog = await readFile(new URL("../src/components/run-dialog.tsx", import.meta.url), "utf8");
const cubeDialog = await readFile(new URL("../src/components/cube-container-dialog.tsx", import.meta.url), "utf8");
const picker = await readFile(new URL("../src/components/image-picker.tsx", import.meta.url), "utf8").catch(() => "");
const downloadsButton = await readFile(new URL("../src/components/downloads-button.tsx", import.meta.url), "utf8");

test("run and cube dialogs use the shared searchable image picker", () => {
  assert.match(runDialog, /ImagePicker/);
  assert.match(cubeDialog, /ImagePicker/);
  assert.doesNotMatch(runDialog, /pulled-image-catalog|<datalist/);
  assert.doesNotMatch(cubeDialog, /cube-image-catalog|<datalist/);
});

test("image picker supports local images, Docker Hub, GHCR, and explicit downloads", () => {
  assert.match(picker, /localImages/);
  assert.match(picker, /imageSearch/);
  assert.match(picker, /Docker Hub/);
  assert.match(picker, /GHCR/);
  assert.match(picker, /ghcr\.io\//);
  assert.match(picker, /Download/);
  assert.match(picker, /startPull/);
});

test("image picker exposes pull progress and selects the image after completion", () => {
  assert.match(picker, /PullProgress/);
  assert.match(picker, /queued|pulling|cancelling/);
  assert.match(picker, /pendingJob\.status\s*!==\s*["']completed["']/);
  assert.match(picker, /onSelect/);
  assert.match(picker, /onBusyChange/);
});

test("editing search invalidates image readiness until a valid image is selected", () => {
  assert.match(picker, /onReadyChange/);
  assert.match(picker, /query\.trim\(\)\s*===\s*value\.trim\(\)/);
  assert.match(runDialog, /imageReady/);
  assert.match(runDialog, /disabled=\{[^}]*!imageReady/);
  assert.match(cubeDialog, /imageReady/);
  assert.match(cubeDialog, /disabled=\{[^}]*!imageReady/);
});

test("container actions wait for an image download to finish", () => {
  assert.match(runDialog, /imageDownloading/);
  assert.match(runDialog, /disabled=\{[^}]*imageDownloading/);
  assert.match(cubeDialog, /imageDownloading/);
  assert.match(cubeDialog, /disabled=\{[^}]*imageDownloading/);
});

test("cube presets use the same picker download path instead of bypassing it", () => {
  assert.match(picker, /suggestedImages/);
  assert.match(cubeDialog, /suggestedImages=/);
  assert.doesNotMatch(cubeDialog, /applyImage\(preset\.image\)/);
});

test("downloads icon badge renders the number of active downloads", () => {
  assert.match(downloadsButton, /activeCount\s*=\s*pulls\.filter/);
  assert.match(downloadsButton, /activeCount > 0/);
  assert.match(downloadsButton, /activeCount > 9 \? ["']9\+["'] : activeCount/);
});
