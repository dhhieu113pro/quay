import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("Logs is a first-class workspace", async () => {
  const types = await read("src/lib/wslc/types.ts");
  const shell = await read("src/components/app-shell.tsx");
  assert.match(types, /\| "logs"/);
  assert.match(shell, /id: "logs", label: "Logs"/);
  assert.match(shell, /<LogsView \/>/);
});

test("Logs view polls only while mounted", async () => {
  const source = await read("src/components/views/logs-view.tsx");
  assert.match(source, /refreshAggregatedLogs\(\)/);
  assert.match(source, /setInterval\([^]*1500/);
  assert.match(source, /clearInterval/);
});

test("Logs rows render millisecond timestamps and source labels", async () => {
  const source = await read("src/components/views/logs-view.tsx");
  assert.match(source, /getMilliseconds\(\)/);
  assert.match(source, /formatLogSource\(line\)/);
  assert.match(source, /line\.stream === "stderr"/);
});
