import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = await readFile(new URL("../src/routes/__root.tsx", import.meta.url), "utf8");
const shell = await readFile(new URL("../src/components/app-shell.tsx", import.meta.url), "utf8");

test("root route provides appearance context to onboarding and app shell", () => {
  assert.match(root, /import\s*\{\s*AppearanceProvider\s*\}\s*from\s*["']@\/components\/appearance-provider["']/);
  assert.match(root, /<AppearanceProvider>[\s\S]*<Outlet\s*\/>[\s\S]*<\/AppearanceProvider>/);
});

test("AppShell does not own the global appearance provider", () => {
  assert.doesNotMatch(shell, /<AppearanceProvider>/);
});
