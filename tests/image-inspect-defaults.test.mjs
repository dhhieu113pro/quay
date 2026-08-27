import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => {
  try { return readFileSync(new URL(path, import.meta.url), "utf8"); }
  catch { return ""; }
};

const inspectDefaults = read("../src/lib/wslc/image-inspect-defaults.ts");
const store = read("../src/lib/wslc/store.ts");
const runDialog = read("../src/components/run-dialog.tsx");
const cubeDialog = read("../src/components/cube-container-dialog.tsx");

test("image inspect parser extracts safe runtime defaults", () => {
  assert.match(inspectDefaults, /parseImageInspect/);
  assert.match(inspectDefaults, /Env/);
  assert.match(inspectDefaults, /ExposedPorts/);
  assert.match(inspectDefaults, /WorkingDir/);
  assert.match(inspectDefaults, /Entrypoint/);
  assert.match(inspectDefaults, /Cmd/);
  assert.match(inspectDefaults, /Volumes/);
});

test("image inspect defaults filter noisy environment and preserve user values", () => {
  assert.match(inspectDefaults, /PATH/);
  assert.match(inspectDefaults, /applyImageInspectDefaults/);
  assert.match(inspectDefaults, /values\.has/);
  assert.match(inspectDefaults, /Image default/);
});

test("image inspect metadata is cached and inspect failure is non-blocking", () => {
  assert.match(store, /imageInspectCache/);
  assert.match(store, /inspectImage/);
  assert.match(store, /image[^\n]*inspect/i);
  assert.match(store, /catch|\.ok/);
});

test("Run Container and Cube member flows request inspect defaults", () => {
  assert.match(runDialog, /inspectImage/);
  assert.match(runDialog, /applyImageInspectDefaults/);
  assert.match(cubeDialog, /inspectImage/);
  assert.match(cubeDialog, /applyImageInspectDefaults/);
});

test("trusted required-env rules remain authoritative over image metadata", () => {
  assert.match(runDialog, /applyRuntimeEnvDefaults/);
  assert.match(runDialog, /applyImageInspectDefaults/);
  assert.match(cubeDialog, /applyRuntimeEnvDefaults/);
  assert.match(cubeDialog, /applyImageInspectDefaults/);
});
