import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("log filters support All, Cube, and Container", async () => {
  const helper = await read("src/lib/wslc/log-filters.ts");
  const view = await read("src/components/views/logs-view.tsx");
  assert.match(helper, /if \(cubeId && line\.cubeId !== cubeId\) return false/);
  assert.match(helper, /if \(containerName && line\.containerName !== containerName\) return false/);
  assert.match(view, /Cube log filter/);
  assert.match(view, /Container log filter/);
  assert.match(view, /<option value="">All<\/option>/);
});

test("changing Cube resets the Container filter", async () => {
  const source = await read("src/lib/wslc/log-store.ts");
  assert.match(source, /setLogCubeFilter: \(cubeId\) => set\(\{ logCubeFilter: cubeId, logContainerFilter: null \}\)/);
});
