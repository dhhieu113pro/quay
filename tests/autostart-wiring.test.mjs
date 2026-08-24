import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const store = readFileSync(new URL("../src/lib/wslc/store.ts", import.meta.url), "utf8");

test("Windows sign-in preference delegates to the native Tauri autostart bridge", () => {
  assert.match(store, /getLaunchAtSignIn/);
  assert.match(store, /setNativeLaunchAtSignIn/);
  assert.match(store, /await\s+setNativeLaunchAtSignIn\(launchAtSignIn\)/);
});

test("Windows sign-in preference is reconciled from the operating system", () => {
  assert.match(store, /await\s+getLaunchAtSignIn\(\)/);
  assert.match(store, /launchAtSignIn:\s+nativeLaunchAtSignIn/);
});
