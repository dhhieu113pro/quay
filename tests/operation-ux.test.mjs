import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const store = await readFile(new URL("../src/lib/wslc/store.ts", import.meta.url), "utf8");
const containers = await readFile(new URL("../src/components/views/containers-view.tsx", import.meta.url), "utf8");
const images = await readFile(new URL("../src/components/views/images-view.tsx", import.meta.url), "utf8");
const groups = await readFile(new URL("../src/components/views/groups-view.tsx", import.meta.url), "utf8");

test("operation state records meaningful lifecycle labels instead of booleans", () => {
  assert.match(store, /type OperationStatus\s*=\s*"starting"\s*\|\s*"stopping"\s*\|\s*"restarting"\s*\|\s*"pulling"\s*\|\s*"removing"/);
  assert.match(store, /operations:\s*Record<string, OperationStatus>/);
  assert.match(store, /runOperation\s*=\s*async\s*\(key:\s*string,\s*status:\s*OperationStatus,/);
});

test("container actions render the exact operation status and disable conflicting actions", () => {
  assert.match(containers, /status=\{operations\[`container:\$\{c\.name\}`\]\}/);
  assert.match(containers, /Starting…|Stopping…|Restarting…/);
  assert.match(containers, /disabled=\{Boolean\(status\)\}/);
});

test("image pulls show an explicit pulling state", () => {
  assert.match(images, /operations\[`image:\$\{[^}]+\}`\]/);
  assert.match(images, /Pulling…/);
});

test("cube actions show starting and stopping states", () => {
  assert.match(groups, /operations\[`cube:\$\{[^}]+\}`\]/);
  assert.match(groups, /Starting…|Stopping…/);
});
