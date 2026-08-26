import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("log polling targets running containers concurrently and isolates failures", async () => {
  const source = await read("src/lib/wslc/log-store.ts");
  assert.match(source, /status === "running"/);
  assert.match(source, /Promise\.allSettled/);
  assert.match(source, /logsRefreshInFlight/);
  assert.match(source, /container", "logs"/);
  assert.doesNotMatch(source, /lastError/);
});
