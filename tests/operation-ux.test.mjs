import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const store = await readFile(new URL("../src/lib/wslc/store.ts", import.meta.url), "utf8");
const logStore = await readFile(new URL("../src/lib/wslc/log-store.ts", import.meta.url), "utf8");
const containers = await readFile(new URL("../src/components/views/containers-view.tsx", import.meta.url), "utf8");
const images = await readFile(new URL("../src/components/views/images-view.tsx", import.meta.url), "utf8");
const groups = await readFile(new URL("../src/components/views/groups-view.tsx", import.meta.url), "utf8");

test("operation state records meaningful lifecycle labels instead of booleans", () => {
  assert.match(store, /type OperationStatus\s*=\s*"starting"\s*\|\s*"stopping"\s*\|\s*"restarting"\s*\|\s*"removing"/);
  assert.match(store, /operations:\s*Record<string, OperationStatus>/);
  assert.match(store, /runOperation\s*=\s*async\s*\(key:\s*string,\s*status:\s*OperationStatus,/);
});

test("container actions render the exact operation status and disable conflicting actions", () => {
  assert.match(containers, /status=\{operations\[`container:\$\{c\.name\}`\]\}/);
  assert.match(containers, /Starting…|Stopping…|Restarting…/);
  assert.match(containers, /disabled=\{Boolean\(status\)\}/);
});

test("image pulling is not tracked by generic operations", () => {
  assert.doesNotMatch(store, /runOperation\(`image:\$\{[^}]+\}`,\s*"pulling"/);
  assert.doesNotMatch(store, /execute\(\["pull"/);
  assert.match(images, /removeImage/);
});

test("cube actions show starting and stopping states", () => {
  assert.match(groups, /operations\[`cube:\$\{[^}]+\}`\]/);
  assert.match(groups, /Starting…|Stopping…/);
});

test("failed container starts keep a per-container error and capture stopped-container logs", () => {
  assert.match(store, /operationErrors:\s*Record<string,\s*string>/);
  assert.match(store, /captureContainerStartFailure/);
  assert.match(store, /\["container",\s*"logs",\s*"--tail",\s*"200",\s*name\]/);
  assert.match(store, /appendOperationLog/);
});

test("cube members expose failed starts and a direct path to logs", () => {
  assert.match(groups, /operationErrors\[`container:\$\{member\.name\}`\]/);
  assert.match(groups, /Start failed/);
  assert.match(groups, /View logs/);
});

test("operation diagnostics persist across Quay restarts", () => {
  assert.match(logStore, /quay\.operationLogs/);
  assert.match(logStore, /localStorage\.getItem/);
  assert.match(logStore, /localStorage\.setItem/);
  assert.match(logStore, /redact/i);
});
