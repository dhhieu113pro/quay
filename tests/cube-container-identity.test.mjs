import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const catalog = await readFile(new URL("../src/lib/wslc/catalog.ts", import.meta.url), "utf8");
const groups = await readFile(new URL("../src/lib/wslc/groups.ts", import.meta.url), "utf8");

test("LocalCoding relies on the managed Cube workspace instead of a duplicate mount", () => {
  assert.doesNotMatch(catalog, /D:\\\\wslc\\\\workspaces:\/workspace:rw/);
  assert.match(catalog, /name: "local-coding-mcp"[^\n]+mounts: ""/);
});

test("Cube container names are prefixed with the Cube display name", () => {
  assert.match(groups, /export function cubeContainerName\(/);
  assert.match(groups, /name: cubeContainerName\(group\.name, spec\.name \|\| spec\.image\)/);
  assert.match(groups, /const name = cubeContainerName\(group\.name, spec\.name \|\| spec\.image\)/);
  assert.match(groups, /filter\(\(item\) => item\.name !== name\)/);
});

test("LocalCoding ngrok targets the prefixed MCP container", () => {
  assert.match(catalog, /http LocalCoding-local-coding-mcp:5000 --log=stdout/);
});
