import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const store = await readFile(new URL("../src/lib/wslc/store.ts", import.meta.url), "utf8");
const tauri = await readFile(new URL("../src/lib/tauri.ts", import.meta.url), "utf8");
const operationLog = await readFile(new URL("../src/lib/wslc/operation-log.ts", import.meta.url), "utf8");
const logStore = await readFile(new URL("../src/lib/wslc/log-store.ts", import.meta.url), "utf8");
const wslcAudit = await readFile(new URL("../src-tauri/src/wslc_audit.rs", import.meta.url), "utf8");
const pullAudit = await readFile(new URL("../src-tauri/src/pull_audit.rs", import.meta.url), "utf8");
const containers = await readFile(new URL("../src/components/views/containers-view.tsx", import.meta.url), "utf8");
const images = await readFile(new URL("../src/components/views/images-view.tsx", import.meta.url), "utf8");
const groups = await readFile(new URL("../src/components/views/groups-view.tsx", import.meta.url), "utf8");
const runDialog = await readFile(new URL("../src/components/run-dialog.tsx", import.meta.url), "utf8");
const dashboard = await readFile(new URL("../src/components/views/dashboard-view.tsx", import.meta.url), "utf8");

test("operation state records meaningful lifecycle labels instead of booleans", () => {
  assert.match(store, /type OperationStatus\s*=\s*"starting"\s*\|\s*"stopping"\s*\|\s*"restarting"\s*\|\s*"removing"/);
  assert.match(store, /operations:\s*Record<string, OperationStatus>/);
  assert.match(store, /runOperation\s*=\s*async\s*\(key:\s*string,\s*status:\s*OperationStatus,/);
});

test("container actions render the exact operation status and disable conflicting actions", () => {
  assert.match(containers, /status=\{operations\[`container:\$\{c\.name\}`\]\}/);
  assert.match(containers, /Starting…|Stopping…|Restarting…/);
  assert.match(containers, /disabled=\{Boolean\(status\)\}/);
});

test("run dialog shows the full generated command and lets users copy it", () => {
  assert.match(runDialog, /Command preview/);
  assert.match(runDialog, /navigator\.clipboard\.writeText\(preview\)/);
  assert.match(runDialog, /whitespace-pre-wrap/);
  assert.doesNotMatch(runDialog, /truncate font-mono text-\[11px\] text-subtle/);
});

test("image pulling is not tracked by generic operations", () => {
  assert.doesNotMatch(store, /runOperation\(`image:\$\{[^}]+\}`,\s*"pulling"/);
  assert.doesNotMatch(store, /execute\(\["pull"/);
  assert.match(images, /removeImage/);
});

test("cube actions show starting and stopping states", () => {
  assert.match(groups, /operations\[`cube:\$\{[^}]+\}`\]/);
  assert.match(groups, /Starting…|Stopping…/);
});

test("failed container lifecycle commands are audited natively instead of browser localStorage", () => {
  assert.doesNotMatch(tauri, /captureLifecycleFailure/);
  assert.doesNotMatch(tauri, /appendOperationLog/);
  assert.match(wslcAudit, /execute_with_audit/);
  assert.match(wslcAudit, /AuditStatus::Doing/);
  assert.match(wslcAudit, /AuditStatus::Error/);
  assert.match(pullAudit, /record_pull_job/);
});

test("legacy operation diagnostics remain readable and redact secrets for migration", () => {
  assert.match(operationLog, /quay\.operationLogs/);
  assert.match(operationLog, /localStorage\.getItem/);
  assert.match(operationLog, /localStorage\.setItem/);
  assert.match(operationLog, /MAX_OPERATION_LOGS\s*=\s*500/);
  assert.match(operationLog, /REDACTED/);
  assert.match(operationLog, /NGROK_AUTHTOKEN/);
});

test("audit diagnostics are no longer merged into container output history", () => {
  assert.doesNotMatch(logStore, /loadOperationLogs/);
  assert.doesNotMatch(logStore, /operationDiagnosticLines/);
  assert.doesNotMatch(logStore, /clearOperationLogs/);
  assert.match(logStore, /queryContainerLogs/);
  assert.match(logStore, /clearContainerLogs/);
});

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
