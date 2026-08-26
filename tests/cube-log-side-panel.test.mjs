import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const groupsView = readFileSync(new URL("../src/components/views/groups-view.tsx", import.meta.url), "utf8");
const panelPath = new URL("../src/components/cube-logs-panel.tsx", import.meta.url);
let panel = "";
try { panel = readFileSync(panelPath, "utf8"); } catch { /* RED until panel exists */ }

test("Cube logs open an inline side panel instead of navigating to Logs", () => {
  assert.doesNotMatch(groupsView, /onClick=\{\(\) => openLogs\(\{ cubeId: cube\.id \}\)\}/);
  assert.match(groupsView, /setLogCubeId\(cube\.id\)/);
  assert.match(groupsView, /<CubeLogsPanel/);
});

test("Cube log panel reuses aggregated logs with cube scoping and follow behavior", () => {
  assert.match(panel, /useLogs/);
  assert.match(panel, /filterAggregatedLogs\(lines, cubeId, null\)/);
  assert.match(panel, /refreshAggregatedLogs/);
  assert.match(panel, /isNearBottom/);
  assert.match(panel, /onClose/);
});
