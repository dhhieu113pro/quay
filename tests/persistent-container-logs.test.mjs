import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const logStore = await read("src/lib/wslc/log-store.ts");
const store = await read("src/lib/wslc/store.ts");

test("running log capture persists parsed lines and reads sqlite history as source of truth", () => {
  assert.match(logStore, /appendContainerLogs/);
  assert.match(logStore, /queryContainerLogs/);
  assert.match(logStore, /listContainerLogTargets/);
  assert.match(logStore, /export async function captureContainerLogs/);
  assert.doesNotMatch(logStore, /loadOperationLogs/);
  assert.doesNotMatch(logStore, /operationDiagnosticLines/);
  assert.doesNotMatch(logStore, /clearOperationLogs/);
});

test("fallback log dedupe is session and sequence aware instead of text-only", () => {
  assert.match(logStore, /fallbackSessionId/);
  assert.match(logStore, /fallbackSequences/);
  assert.match(logStore, /newFallbackTail\(previousTail, currentTail\)/);
  assert.match(logStore, /dedupeKey:/);
  assert.match(logStore, /sequence/);
});

test("container stop restart and removal drain logs around destructive lifecycle commands", () => {
  assert.match(store, /drainContainerLogs/);
  assert.match(store, /await drainContainerLogs\(container\.name\)/);
  assert.match(store, /container", "stop"/);
  assert.match(store, /container", "restart"/);
  assert.match(store, /container", "rm"/);
  assert.match(store, /bestEffortLogDrain/);
});

test("clear removes sqlite container history without clearing audit history", () => {
  assert.match(logStore, /clearContainerLogs/);
  assert.doesNotMatch(logStore, /clearAudit/);
});
