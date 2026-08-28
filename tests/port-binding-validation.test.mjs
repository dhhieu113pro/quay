import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const inspectModule = await import(new URL("../src/lib/wslc/image-inspect-defaults.ts", import.meta.url));
const portEditor = read("../src/components/port-binding-editor.tsx");
const runDialog = read("../src/components/run-dialog.tsx");
const cubeDialog = read("../src/components/cube-container-dialog.tsx");

test("host port validation rejects blank, non-numeric, out-of-range, and duplicate ports", () => {
  assert.equal(typeof inspectModule.publishedHostPortErrors, "function");
  assert.equal(typeof inspectModule.hasPublishedHostPortErrors, "function");

  assert.deepEqual(inspectModule.publishedHostPortErrors("8080:80,5353:53/udp"), [null, null]);
  assert.deepEqual(inspectModule.publishedHostPortErrors(":80"), ["Host port is required"]);
  assert.deepEqual(inspectModule.publishedHostPortErrors("http:80"), ["Host port must be numeric"]);
  assert.deepEqual(inspectModule.publishedHostPortErrors("0:80,65536:443"), [
    "Host port must be between 1 and 65535",
    "Host port must be between 1 and 65535",
  ]);
  assert.deepEqual(inspectModule.publishedHostPortErrors("8080:80,8080:443/udp"), [
    "Host port is already used",
    "Host port is already used",
  ]);
  assert.equal(inspectModule.hasPublishedHostPortErrors("8080:80,5353:53/udp"), false);
  assert.equal(inspectModule.hasPublishedHostPortErrors("8080:80,8080:443"), true);
});

test("host port input is normalized to digits only", () => {
  assert.equal(typeof inspectModule.sanitizePublishedHostPortInput, "function");
  assert.equal(inspectModule.sanitizePublishedHostPortInput("8e0-80"), "8080");
  assert.equal(inspectModule.sanitizePublishedHostPortInput(" 5353 "), "5353");
});

test("port editor renders inline validation and both dialogs block invalid submissions", () => {
  assert.match(portEditor, /publishedHostPortErrors/);
  assert.match(portEditor, /sanitizePublishedHostPortInput/);
  assert.match(portEditor, /aria-invalid/);
  assert.match(portEditor, /text-destructive/);
  assert.match(portEditor, /Host port/);

  for (const source of [runDialog, cubeDialog]) {
    assert.match(source, /hasPublishedHostPortErrors/);
    assert.match(source, /invalidPorts/);
  }
  assert.match(runDialog, /missing\.length > 0 \|\| invalidPorts/);
  assert.match(cubeDialog, /missing\.length > 0 \|\| invalidPorts/);
});
