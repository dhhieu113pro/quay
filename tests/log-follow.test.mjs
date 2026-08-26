import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("follow policy uses a 24px bottom threshold", async () => {
  const source = await read("src/lib/log-follow.ts");
  assert.match(source, /threshold = 24/);
  assert.match(source, /scrollHeight - \(scrollTop \+ clientHeight\) <= threshold/);
});

test("scrolling away pauses follow and returning to bottom resumes it", async () => {
  const source = await read("src/components/views/logs-view.tsx");
  assert.match(source, /setFollow\(nearBottom\)/);
  assert.match(source, /if \(nearBottom\) setNewWhilePaused\(false\)/);
  assert.match(source, /New logs/);
  assert.match(source, /resumeFollow/);
});
