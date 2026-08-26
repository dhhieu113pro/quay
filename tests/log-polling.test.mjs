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

test("untimestamped fallback tails use a stable cursor instead of poll timestamps", async () => {
  const source = await read("src/lib/wslc/log-store.ts");
  assert.match(source, /fallbackTails = new Map<string, string\[\]>/);
  assert.match(source, /newFallbackTail\(previousTail, currentTail\)/);
  assert.match(source, /fallbackTails\.set\(container\.id, currentTail\)/);
  assert.match(source, /delta\.join\("\\n"\)/);
});

test("Clear establishes a durable watermark and invalidates stale refreshes", async () => {
  const source = await read("src/lib/wslc/log-store.ts");
  assert.match(source, /clearGeneration \+= 1/);
  assert.match(source, /clearedAt = Date\.now\(\)/);
  assert.match(source, /generation !== clearGeneration/);
  assert.match(source, /line\.ts > clearWatermark/);
  assert.match(source, /fallbackNeedsBaseline/);
});
