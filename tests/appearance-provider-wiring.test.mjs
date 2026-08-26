import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const home = await readFile(new URL("../src/routes/index.tsx", import.meta.url), "utf8");
const root = await readFile(new URL("../src/routes/__root.tsx", import.meta.url), "utf8");

test("first-run onboarding is rendered inside AppearanceProvider", () => {
  assert.match(home, /import\s*\{\s*AppearanceProvider\s*\}\s*from\s*["']@\/components\/appearance-provider["']/);
  assert.match(home, /<AppearanceProvider>[\s\S]*<GettingStartedView\s*\/>[\s\S]*<\/AppearanceProvider>/);
});

test("normal AppShell remains on its existing provider path", () => {
  assert.match(home, /if\s*\(onboardingCompleted\)\s*return\s*<AppShell\s*\/>/);
});

test("root route suppresses the WebView context menu globally", () => {
  assert.match(root, /<body[^>]*onContextMenu=\{\(event\)\s*=>\s*event\.preventDefault\(\)\}/);
});
