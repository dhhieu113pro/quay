import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_WORKSPACE_TARGET,
  defaultCubeWorkspacePath,
  defaultCubeContainerWorkspacePath,
  defaultStandaloneWorkspacePath,
  normalizeWorkspacePath,
  resolveWorkspacePath,
  isGeneratedCubeWorkspacePath,
  isGeneratedContainerWorkspacePath,
} from "../src/lib/workspace.ts";

test("workspace defaults use portable relative paths", () => {
  assert.equal(defaultCubeWorkspacePath("Local Coding"), "cubes/local-coding");
  assert.equal(defaultCubeContainerWorkspacePath("cubes/local-coding", "API"), "cubes/local-coding/api");
  assert.equal(defaultStandaloneWorkspacePath("Postgres DB"), "containers/postgres-db");
  assert.equal(DEFAULT_WORKSPACE_TARGET, "/workspace");
});

test("workspace normalization rejects absolute and traversal paths", () => {
  assert.equal(normalizeWorkspacePath("cubes\\demo\\api"), "cubes/demo/api");
  assert.throws(() => normalizeWorkspacePath("C:\\temp"));
  assert.throws(() => normalizeWorkspacePath("../../other"));
  assert.throws(() => normalizeWorkspacePath("cubes/demo/../.."));
  assert.throws(() => normalizeWorkspacePath("/tmp/demo"));
});

test("workspace resolution remains under selected root", () => {
  assert.equal(resolveWorkspacePath("D:\\Quay", "cubes/demo/api"), "D:\\Quay\\cubes\\demo\\api");
});

test("generated workspace paths can be recognized for rename prompts", () => {
  assert.equal(isGeneratedCubeWorkspacePath("cubes/local-coding", "Local Coding"), true);
  assert.equal(isGeneratedCubeWorkspacePath("cubes/custom", "Local Coding"), false);
  assert.equal(isGeneratedContainerWorkspacePath("cubes/local-coding/api", "cubes/local-coding", "API"), true);
  assert.equal(isGeneratedContainerWorkspacePath("cubes/local-coding/custom", "cubes/local-coding", "API"), false);
});
