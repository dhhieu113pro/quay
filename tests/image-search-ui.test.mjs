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

test("titlebar owns image search", () => {
  assert.match(shell, /<ImageSearch/);
  assert.match(search, /Search images/);
  assert.match(search, /300/);
  assert.match(search, /ArrowDown|ArrowUp/);
  assert.match(search, /Enter/);
  assert.match(search, /requestId/);
});

test("suggestions require an explicit download action", () => {
  assert.match(search, /Download/);
  assert.match(search, /aria-label=.*Download/);
  assert.doesNotMatch(search, /onClick=\{\(\) => pullResult\(result\)\}/);
});

test("clicking outside dismisses image suggestions", () => {
  assert.match(search, /document\.addEventListener\(["']pointerdown["']/);
  assert.match(search, /\.contains\(event\.target as Node\)/);
  assert.match(search, /setOpen\(false\)/);
});

test("search supports Docker Hub and GHCR references", () => {
  assert.match(search, /Docker Hub/);
  assert.match(search, /GHCR/);
  assert.match(search, /ghcr\.io\//);
  assert.match(search, /startPull\(value\)/);
});

test("Images view no longer owns image pulling", () => {
  assert.doesNotMatch(images, /pull-catalog/);
  assert.doesNotMatch(images, /pullImage/);
  assert.doesNotMatch(images, /startPull/);
});
