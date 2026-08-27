import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const inspect = readFileSync(new URL("../src/components/container-inspect.tsx", import.meta.url), "utf8");
const store = readFileSync(new URL("../src/lib/wslc/store.ts", import.meta.url), "utf8");
let editor = "";
try { editor = readFileSync(new URL("../src/lib/wslc/existing-container-env.ts", import.meta.url), "utf8"); } catch { /* RED until implementation exists */ }

test("existing container inspector exposes an Environment editor with recreation warning", () => {
  assert.match(inspect, /TabsTrigger value="environment"/);
  assert.match(inspect, /Environment changes require container recreation/);
  assert.match(inspect, /Save & recreate/);
});

test("existing container environment is loaded from container inspect data", () => {
  assert.match(editor, /parseExistingContainerInspect/);
  assert.match(editor, /Config/);
  assert.match(editor, /Env/);
  assert.match(inspect, /loadExistingContainerConfig/);
});

test("running container env save uses stop recreate start while stopped stays stopped", () => {
  assert.match(store, /recreateContainerWithEnv/);
  assert.match(store, /wasRunning/);
  assert.match(store, /container.*stop|stop.*container/i);
  assert.match(store, /container.*remove|remove.*container/i);
  assert.match(store, /runArgs/);
  assert.match(store, /container.*start|start.*container/i);
});

test("Cube inherited environment remains read-only while custom container env stays editable", () => {
  assert.match(inspect, /inheritedRows/);
  assert.match(inspect, /withoutEnvKeys/);
  assert.match(inspect, /EnvEditor/);
});
