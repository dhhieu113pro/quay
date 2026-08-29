import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");
const logStore = await read("src/lib/wslc/log-store.ts");
const tauri = await read("src/lib/tauri.ts");

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
  assert.match(logStore, /dedupeKey\s*[,}]/);
  assert.match(logStore, /sequence/);
});

test("container stop restart and removal drain logs around destructive lifecycle commands", () => {
  assert.match(tauri, /destructiveLifecycleContainer/);
  assert.match(tauri, /bestEffortLogDrain/);
  assert.match(tauri, /await bestEffortLogDrain\(containerName\)/);
  assert.match(tauri, /await invokeNative<WslcInvokeResult>\("wslc_invoke", \{ payload \}\)/);
  assert.match(tauri, /"stop"/);
  assert.match(tauri, /"restart"/);
  assert.match(tauri, /"rm"/);
});

test("failed run and start commands keep the stopped container tail in sqlite history", () => {
  assert.match(tauri, /failedLifecycleContainer/);
  assert.match(tauri, /!result\.ok/);
  assert.match(tauri, /failureContainerName/);
  assert.match(logStore, /history:\$\{containerName\}/);
});

test("clear removes sqlite container history without clearing audit history", () => {
  assert.match(logStore, /clearContainerLogs/);
  assert.doesNotMatch(logStore, /clearAudit/);
});
