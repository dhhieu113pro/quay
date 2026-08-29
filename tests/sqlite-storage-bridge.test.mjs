import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const tauri = await readFile(new URL("../src/lib/tauri.ts", import.meta.url), "utf8");
const types = await readFile(new URL("../src/lib/wslc/types.ts", import.meta.url), "utf8");
const migration = await readFile(new URL("../src/lib/wslc/storage-migration.ts", import.meta.url), "utf8").catch(() => "");
const native = await readFile(new URL("../src-tauri/src/lib.rs", import.meta.url), "utf8");

test("frontend exposes typed narrow sqlite history commands", () => {
  for (const command of [
    "audit_query",
    "audit_clear",
    "container_logs_append",
    "container_logs_query",
    "container_log_targets",
    "container_logs_clear",
    "container_logs_cleanup",
    "storage_stats",
    "legacy_operation_logs_import",
  ]) {
    assert.match(tauri + native, new RegExp(command));
  }
  assert.doesNotMatch(tauri, /executeSql|rawSql|sqlite_query/);
  assert.match(types, /\|\s*"audit"/);
  assert.match(types, /export interface AuditEvent/);
  assert.match(types, /export interface ContainerLogRecord/);
  assert.match(types, /export interface StorageStats/);
});

test("legacy operation log migration confirms native commit before clearing localStorage", () => {
  assert.match(migration, /loadOperationLogs\(\)/);
  assert.match(migration, /importLegacyOperationLogs/);
  assert.match(migration, /clearOperationLogs\(\)/);
  const importIndex = migration.indexOf("await importLegacyOperationLogs");
  const clearIndex = migration.indexOf("clearOperationLogs()");
  assert.ok(importIndex >= 0 && clearIndex > importIndex, "legacy storage must only be cleared after native import succeeds");
});

test("new lifecycle failures no longer append browser localStorage diagnostics", () => {
  assert.doesNotMatch(tauri, /appendOperationLog/);
  assert.doesNotMatch(tauri, /captureLifecycleFailure/);
});
