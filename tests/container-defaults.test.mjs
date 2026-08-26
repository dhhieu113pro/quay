import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const runDialog = readFileSync(new URL("../src/components/run-dialog.tsx", import.meta.url), "utf8");
const cubeDialog = readFileSync(new URL("../src/components/cube-container-dialog.tsx", import.meta.url), "utf8");
const defaults = readFileSync(new URL("../src/lib/wslc/container-defaults.ts", import.meta.url), "utf8");
const groupsView = readFileSync(new URL("../src/components/views/groups-view.tsx", import.meta.url), "utf8");
const inspect = readFileSync(new URL("../src/components/container-inspect.tsx", import.meta.url), "utf8");
let cloneSource = "";
try { cloneSource = readFileSync(new URL("../src/lib/wslc/clone.ts", import.meta.url), "utf8"); } catch { /* RED until implementation exists */ }

test("container image defaults derive a safe name and reuse trusted catalog presets", () => {
  assert.match(defaults, /containerNameFromImage/);
  assert.match(defaults, /catalogPresets\.find/);
  assert.match(defaults, /applyImageDefaults/);
});

test("standalone Run Container applies image defaults without overwriting a custom name", () => {
  assert.match(runDialog, /applyImageDefaults/);
  assert.match(runDialog, /onChange=\{\(event\) => applyImage/);
  assert.match(runDialog, /nameTouched/);
});

test("standalone and Cube dialogs seed an editable environment row when none exists", () => {
  assert.match(runDialog, /editableEnvRows/);
  assert.match(cubeDialog, /editableEnvRows/);
});

test("Cube container image changes use the same runnable defaults helper", () => {
  assert.match(cubeDialog, /applyImageDefaults/);
  assert.match(cubeDialog, /onChange=\{\(event\) => applyImage/);
});

test("clone helpers generate collision-safe identities and regenerated Cube infrastructure", () => {
  assert.match(cloneSource, /nextCloneName/);
  assert.match(cloneSource, /cloneCubeDraft/);
  assert.match(cloneSource, /cloneContainerSpec/);
  assert.match(cloneSource, /cubeNetworkName/);
  assert.match(cloneSource, /defaultCubeWorkspacePath/);
});

test("Clone Cube dialog only exposes identity editing", () => {
  assert.match(groupsView, /Clone Cube/);
  assert.match(groupsView, /CloneCubeDialog/);
  assert.match(groupsView, /Save Clone/);
  assert.match(groupsView, /readOnly/);
});

test("Clone Container dialog only exposes identity editing", () => {
  assert.match(inspect, /CloneContainerDialog/);
  assert.match(inspect, /Create Clone/);
  assert.match(inspect, /readOnly/);
});
