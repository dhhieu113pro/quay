import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Cube cards open the inline log panel for that Cube", async () => {
  const source = await read("src/components/views/groups-view.tsx");
  assert.match(source, /setLogCubeId\(cube\.id\)/);
  assert.match(source, /<CubeLogsPanel cubeId=\{logCube\.id\} cubeName=\{logCube\.name\}/);
  assert.doesNotMatch(source, /openLogs\(\{ cubeId: cube\.id \}\)/);
  assert.match(source, /aria-label={`Logs for \$\{cube\.name\}`}/);
});
