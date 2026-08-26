import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("../src/components/views/groups-view.tsx", import.meta.url), "utf8");

test("Cube member rows do not expose per-container configuration", () => {
  assert.doesNotMatch(source, /aria-label=\{`Configure \$\{member\.name\}`\}/);
  assert.doesNotMatch(source, /setContainerEditor\(\{ cube, spec: member\.spec \}\)/);
});

test("Cube-level configuration and Add Container remain available", () => {
  assert.match(source, />Add Container<\/Button>/);
  assert.match(source, />Configure<\/Button>/);
  assert.match(source, /setContainerEditor\(\{ cube \}\)/);
});
