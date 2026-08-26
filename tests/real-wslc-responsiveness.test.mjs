import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const runner = readFileSync(new URL("./run-all.ps1", import.meta.url), "utf8");

test("local WSLC validation includes concurrent query responsiveness checks", () => {
  assert.match(runner, /Run-Step "WSLC responsiveness under mutation"/);
  assert.match(runner, /Start-Job/);
  assert.match(runner, /container list/);
  assert.match(runner, /MaxQueryLatencyMs/);
  assert.match(runner, /throw .*query latency/i);
});

test("local WSLC validation covers image pull responsiveness and cleanup", () => {
  assert.match(runner, /Run-Step "WSLC responsiveness during image pull"/);
  assert.match(runner, /wslc pull/);
  assert.match(runner, /Remove-WslcContainer/);
  assert.match(runner, /finally/);
});
