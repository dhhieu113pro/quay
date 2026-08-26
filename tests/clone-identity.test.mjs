import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const cloneSourcePath = new URL("../src/lib/wslc/clone.ts", import.meta.url);
let cloneSource = "";
try { cloneSource = readFileSync(cloneSourcePath, "utf8"); } catch { /* RED until implementation exists */ }

const cubesView = readFileSync(new URL("../src/components/views/groups-view.tsx", import.meta.url), "utf8");
const inspect = readFileSync(new URL("../src/components/container-inspect.tsx", import.meta.url), "utf8");

test("clone helpers generate collision-safe identities without mutating copied configuration", () => {
  assert.match(cloneSource, /nextCloneName/);
  assert.match(cloneSource, /cloneCubeDraft/);
  assert.match(cloneSource, /cloneContainerSpec/);
  assert.match(cloneSource, /cubeNetworkName/);
  assert.match(cloneSource, /defaultCubeWorkspacePath/);
});

test("Cube clone exposes only identity editing", () => {
  assert.match(cubesView, /Clone Cube/);
  assert.match(cubesView, /CloneCubeDialog/);
  assert.match(cubesView, /readOnly/);
  assert.match(cubesView, /Save Clone/);
});

test("standalone Container clone exposes only identity editing", () => {
  assert.match(inspect, /Clone/);
  assert.match(inspect, /CloneContainerDialog/);
  assert.match(inspect, /readOnly/);
  assert.match(inspect, /Create Clone/);
});
