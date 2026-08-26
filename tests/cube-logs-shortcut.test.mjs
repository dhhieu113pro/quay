import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Cube cards open Logs filtered to that Cube", async () => {
  const source = await read("src/components/views/groups-view.tsx");
  assert.match(source, /openLogs\(\{ cubeId: cube\.id \}\)/);
  assert.match(source, /aria-label={`Logs for \$\{cube\.name\}`}/);
});
