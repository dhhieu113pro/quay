import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const store = await readFile(new URL("../src/lib/wslc/store.ts", import.meta.url), "utf8");

test("image deletion invokes WSLC with the immutable image id", () => {
  assert.match(
    store,
    /removeImage:\s*\(id\)\s*=>\s*\{[\s\S]*?execute\(\["image",\s*"rm",\s*image\.id\]\)/,
  );
});

test("container deletion invokes WSLC with the immutable container id", () => {
  assert.match(
    store,
    /deleteContainer:\s*\(id\)\s*=>\s*\{[\s\S]*?execute\(\["container",\s*"rm",\s*container\.id\]\)/,
  );
});
