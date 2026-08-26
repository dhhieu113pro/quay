import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const groups = await readFile(new URL("../src/lib/wslc/groups.ts", import.meta.url), "utf8");
const groupsView = await readFile(new URL("../src/components/views/groups-view.tsx", import.meta.url), "utf8");
const kvEditor = await readFile(new URL("../src/components/kv-editor.tsx", import.meta.url), "utf8");

test("Cube network is generated from the Cube name and is not editable", () => {
  assert.match(groups, /export function cubeNetworkName\(/);
  assert.match(groups, /replace\(\/\\s\+\/g, ""\).*NetWork/);
  assert.match(groupsView, /value=\{cubeNetworkName\(currentDraft\.name\)\}/);
  assert.match(groupsView, /disabled/);
});

test("Cube workspace is display-only while Open remains available", () => {
  assert.match(groupsView, /Workspace folder/);
  assert.doesNotMatch(groupsView, />Choose folder<\/Button>/);
  assert.doesNotMatch(groupsView, /pickWorkspaceDescendant/);
  assert.match(groupsView, /openWorkspacePath\(workspaceRoot, workspacePath\)/);
});

test("Cube environment distinguishes container-derived rows from removable custom rows", () => {
  assert.match(groupsView, /containerEnvKeys/);
  assert.match(groupsView, /protectedKeys=\{containerEnvKeys\}/);
  assert.match(kvEditor, /protectedKeys/);
  assert.match(kvEditor, /!protectedKeys\.has\(row\.key\.trim\(\)\)/);
});
