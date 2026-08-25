import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const nativeBridge = readFileSync(new URL("../src-tauri/src/lib.rs", import.meta.url), "utf8");
const executor = readFileSync(new URL("../src-tauri/src/wslc_executor.rs", import.meta.url), "utf8");
const runtime = readFileSync(new URL("../src-tauri/src/wslc_runtime.rs", import.meta.url), "utf8");
const workspaceRust = readFileSync(new URL("../src-tauri/src/workspace.rs", import.meta.url), "utf8");
const store = readFileSync(new URL("../src/lib/wslc/store.ts", import.meta.url), "utf8");
const stackRunner = readFileSync(new URL("../src/lib/wslc/stack-runner.ts", import.meta.url), "utf8");
const groups = readFileSync(new URL("../src/lib/wslc/groups.ts", import.meta.url), "utf8");
const groupsView = readFileSync(new URL("../src/components/views/groups-view.tsx", import.meta.url), "utf8");
const cubeContainerDialog = readFileSync(new URL("../src/components/cube-container-dialog.tsx", import.meta.url), "utf8");

test("WSLC Tauri invocation uses a two-lane executor off the command thread", () => {
  assert.match(executor, /pub struct WslcExecutor/);
  assert.match(executor, /Lane::Query/);
  assert.match(executor, /Lane::Mutation/);
  assert.match(executor, /QueryLimiter::new\(query_limit\)/);
  assert.match(nativeBridge, /async fn wslc_invoke/);
  assert.match(nativeBridge, /spawn_blocking/);
  assert.doesNotMatch(runtime, /pub struct CliWorker/);
});

test("WSLC process execution has bounded timeout and query deduplication", () => {
  assert.match(executor, /timed out after/);
  assert.match(executor, /in_flight/);
  assert.match(executor, /query_key/);
  assert.match(executor, /Duration::from_secs\(600\)/);
});

test("container and inventory refreshes coalesce duplicate in-flight requests", () => {
  assert.match(store, /containersRefreshInFlight/);
  assert.match(store, /inventoryRefreshInFlight/);
  assert.match(store, /if \(containersRefreshInFlight\) return containersRefreshInFlight/);
  assert.match(store, /if \(inventoryRefreshInFlight\) return inventoryRefreshInFlight/);
});

test("successful mutations converge through one authoritative refresh helper", () => {
  assert.match(store, /const refreshAfterMutation = async/);
  assert.match(store, /await refreshAfterMutation\(\)/);
  assert.doesNotMatch(groupsView, /disabled=\{Object\.keys\(operations\)\.length/);
});

test("Cube startup stays sequential and performs one final authoritative read", () => {
  assert.match(stackRunner, /for \(const spec of group\.specs\)/);
  assert.match(stackRunner, /await runCli\(args\)/);
  assert.match(stackRunner, /return readNativeGroup\(group\)/);
  const start = stackRunner.indexOf("for (const spec of group.specs)");
  const end = stackRunner.indexOf("return readNativeGroup(group)", start);
  const loop = stackRunner.slice(start, end);
  assert.doesNotMatch(loop, /await listCli\(false\)[\s\S]*await listCli\(true\)/);
});

test("slow workspace picker and migration commands use spawn_blocking", () => {
  assert.match(workspaceRust, /pub async fn workspace_pick_root/);
  assert.match(workspaceRust, /pub async fn workspace_pick_descendant/);
  assert.match(workspaceRust, /pub async fn workspace_move_root/);
  assert.match(workspaceRust, /pub async fn workspace_move_entry/);
  assert.match(workspaceRust, /tauri::async_runtime::spawn_blocking/);
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
  assert.match(groupsView, /configuration before this Cube can start/);
});

test("stopped Cube members can be edited using their existing RunSpec", () => {
  assert.match(cubeContainerDialog, /initialSpec\?: RunSpec/);
  assert.match(cubeContainerDialog, /initialSpec \? "Edit Container"/);
  assert.match(groupsView, /setContainerEditor\(\{ cube, spec: member\.spec \}\)/);
});
