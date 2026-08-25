import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const nativeBridge = readFileSync(new URL("../src-tauri/src/lib.rs", import.meta.url), "utf8");
const runtime = readFileSync(new URL("../src-tauri/src/wslc_runtime.rs", import.meta.url), "utf8");
const groups = readFileSync(new URL("../src/lib/wslc/groups.ts", import.meta.url), "utf8");
const groupsView = readFileSync(new URL("../src/components/views/groups-view.tsx", import.meta.url), "utf8");
const cubeContainerDialog = readFileSync(new URL("../src/components/cube-container-dialog.tsx", import.meta.url), "utf8");

test("WSLC Tauri invocation does not wait for blocking CLI work on the command thread", () => {
  assert.match(runtime, /impl Clone for CliWorker|derive\([^)]*Clone[^)]*\)[\s\S]*pub struct CliWorker/);
  assert.match(nativeBridge, /async fn wslc_invoke/);
  assert.match(nativeBridge, /spawn_blocking/);
});

test("Cube lifecycle policy is centralized", () => {
  assert.match(groups, /export function specConfigured\(/);
  assert.match(groups, /export function cubeCanConfigure\(/);
  assert.match(groups, /export function cubeCanStart\(/);
});

test("Cube configuration is locked whenever a member is running or transitioning", () => {
  assert.match(groupsView, /cubeCanConfigure\(/);
  assert.match(groupsView, /disabled=\{!canConfigure\}/);
  assert.match(groupsView, /operations\[`container:\$\{member\.name\}`\]/);
});

test("Cube start is disabled until every configured member can run", () => {
  assert.match(groupsView, /cubeCanStart\(/);
  assert.match(groupsView, /need configuration/);
});

test("stopped Cube members can be edited using their existing RunSpec", () => {
  assert.match(cubeContainerDialog, /initialSpec\?: RunSpec/);
  assert.match(cubeContainerDialog, /initialSpec \? "Edit Container"/);
  assert.match(groupsView, /setContainerEditor\(\{ cube, spec: member\.spec \}\)/);
});
