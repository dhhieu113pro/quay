import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const catalog = await readFile(new URL("../src/lib/wslc/catalog.ts", import.meta.url), "utf8");
const groups = await readFile(new URL("../src/lib/wslc/groups.ts", import.meta.url), "utf8");

test("LocalCoding catalog images remain available without a duplicate workspace mount", () => {
  assert.doesNotMatch(catalog, /D:\\\\wslc\\\\workspaces:\/workspace:rw/);
  assert.match(catalog, /name: "local-coding-mcp"[^\n]+mounts: ""/);
  assert.match(catalog, /image: "ngrok\/ngrok:latest"/);
});

test("Quay does not seed a built-in LocalCoding Cube", () => {
  assert.doesNotMatch(groups, /const localCoding: ContainerGroup/);
  assert.match(groups, /export const builtInGroups: ContainerGroup\[\] = \[\];/);
});

test("LocalCoding catalog presets are no longer coupled to the removed Cube", () => {
  assert.doesNotMatch(catalog, /groupId: "local-coding"/);
  assert.doesNotMatch(catalog, /export const mcpStack/);
  assert.match(catalog, /http local-coding-mcp:5000 --log=stdout/);
});

test("Cube container names are prefixed with the Cube display name", () => {
  assert.match(groups, /export function cubeContainerName\(/);
  assert.match(groups, /name: cubeContainerName\(group\.name, spec\.name \|\| spec\.image\)/);
  assert.match(groups, /const name = cubeContainerName\(group\.name, spec\.name \|\| spec\.image\)/);
  assert.match(groups, /filter\(\(item\) => item\.name !== name\)/);
});
