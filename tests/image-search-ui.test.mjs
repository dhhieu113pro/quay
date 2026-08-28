import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const shell = await readFile(new URL("../src/components/app-shell.tsx", import.meta.url), "utf8");
const images = await readFile(new URL("../src/components/views/images-view.tsx", import.meta.url), "utf8");
let search = "";
try {
  search = await readFile(new URL("../src/components/image-search.tsx", import.meta.url), "utf8");
} catch {
  search = "";
}

test("titlebar owns Docker Hub image search", () => {
  assert.match(shell, /<ImageSearch/);
  assert.match(search, /Search Docker Hub images/);
  assert.match(search, /300/);
  assert.match(search, /ArrowDown|ArrowUp/);
  assert.match(search, /Enter/);
  assert.match(search, /requestId/);
});

test("search supports direct refs and Docker Hub result pulls", () => {
  assert.match(search, /startPull\(value\)/);
  assert.match(search, /startPull\(`\$\{result\.name\}:latest`\)/);
});

test("Images view no longer owns image pulling", () => {
  assert.doesNotMatch(images, /pull-catalog/);
  assert.doesNotMatch(images, /pullImage/);
  assert.doesNotMatch(images, /startPull/);
});
