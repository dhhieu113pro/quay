import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const cargo = readFileSync(new URL("../src-tauri/Cargo.toml", import.meta.url), "utf8");
const nativeBridge = readFileSync(new URL("../src-tauri/src/lib.rs", import.meta.url), "utf8");

test("Quay registers the official Tauri single-instance plugin", () => {
  assert.match(cargo, /tauri-plugin-single-instance\s*=/);
  assert.match(nativeBridge, /tauri_plugin_single_instance::init/);
});

test("a second Quay launch restores and focuses the existing main window", () => {
  assert.match(nativeBridge, /tauri_plugin_single_instance::init\(\|app,[^|]*\|\s*\{[\s\S]*show_main\(app\)/);
});

test("single-instance registration happens before normal app setup", () => {
  const plugin = nativeBridge.indexOf("tauri_plugin_single_instance::init");
  const setup = nativeBridge.indexOf(".setup(|app|");
  assert.ok(plugin >= 0, "single-instance plugin registration is missing");
  assert.ok(setup >= 0, "normal Tauri setup is missing");
  assert.ok(plugin < setup, "single-instance plugin must be registered before setup");
});
