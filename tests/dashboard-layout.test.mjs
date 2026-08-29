import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const dashboard = await readFile(
  new URL("../src/components/views/dashboard-view.tsx", import.meta.url),
  "utf8",
);

test("dashboard CLI activity cannot force horizontal page overflow", () => {
  assert.match(dashboard, /className="grid min-w-0 gap-4 lg:grid-cols-2"/);
  assert.match(
    dashboard,
    /<section className="min-w-0 rounded-xl border border-border bg-card">[\s\S]*?<h2 className="text-sm font-medium">CLI activity<\/h2>/,
  );
  assert.match(dashboard, /className="flex min-w-0 items-center justify-between gap-2"/);
  assert.match(
    dashboard,
    /className="min-w-0 flex-1 break-all font-mono text-xs text-accent"/,
  );
});
