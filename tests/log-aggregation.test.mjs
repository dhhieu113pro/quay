import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("aggregated logs sort, deduplicate, and stay bounded", async () => {
  const source = await read("src/lib/wslc/logs.ts");
  assert.match(source, /new Map<string, AggregatedLogLine>/);
  assert.match(source, /sort\(\(a, b\) => a\.ts - b\.ts \|\| a\.id\.localeCompare\(b\.id\)\)/);
  assert.match(source, /slice\(-maxLines\)/);
  assert.match(source, /maxLines = 10_000/);
});

test("source labels distinguish Cube and standalone containers", async () => {
  const source = await read("src/lib/wslc/logs.ts");
  assert.match(source, /\$\{line\.cubeName\}\[\$\{line\.containerName\}\]/);
  assert.match(source, /\[\$\{line\.containerName\}\]/);
});
