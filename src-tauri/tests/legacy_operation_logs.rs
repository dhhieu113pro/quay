#[path = "../src/storage/mod.rs"]
mod storage;

use std::time::{SystemTime, UNIX_EPOCH};
use storage::audit::{AuditQuery, AuditStatus};
use storage::legacy::LegacyOperationLog;
use storage::Storage;

fn test_storage() -> (Storage, std::path::PathBuf) {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_nanos();
    let path = std::env::temp_dir().join(format!("quay-legacy-{nonce}.db"));
    (Storage::open(path.clone()).expect("open storage"), path)
}

fn row(id: &str, ts: i64, container: &str, command: &str, text: &str) -> LegacyOperationLog {
    LegacyOperationLog {
        id: id.into(),
        ts,
        container_name: Some(container.into()),
        command: command.into(),
        text: text.into(),
    }
}

#[test]
fn imports_legacy_failures_once_and_marks_transaction_complete() {
    let (storage, path) = test_storage();
    let result = storage.import_legacy_operation_logs(&[
        row("1", 100, "api", "wslc run -e password=secret nginx", "failed password=secret"),
        row("2", 200, "api", "wslc container logs api", "panic"),
    ]).unwrap();
    assert_eq!(result.imported, 2);
    assert!(!result.already_imported);

    let rows = storage.query_audit(&AuditQuery { category: Some("legacy".into()), ..Default::default() }).unwrap();
    assert_eq!(rows.len(), 2);
    assert!(rows.iter().all(|entry| entry.action == "diagnostic.import" && entry.status == AuditStatus::Error));
    assert!(rows.iter().all(|entry| !entry.command.as_deref().unwrap_or_default().contains("password=secret")));

    let second = storage.import_legacy_operation_logs(&[
        row("3", 300, "api", "wslc run nginx", "should not duplicate"),
    ]).unwrap();
    assert!(second.already_imported);
    assert_eq!(second.imported, 0);
    assert_eq!(storage.query_audit(&AuditQuery { category: Some("legacy".into()), ..Default::default() }).unwrap().len(), 2);

    drop(storage);
    let _ = std::fs::remove_file(path);
}

#[test]
fn failed_legacy_import_rolls_back_rows_and_marker() {
    let (storage, path) = test_storage();
    let duplicate = [
        row("same", 100, "api", "wslc run nginx", "first"),
        row("same", 101, "api", "wslc run nginx", "second"),
    ];
    assert!(storage.import_legacy_operation_logs(&duplicate).is_err());

    let audit_count: i64 = storage.with_connection(|conn| conn.query_row("SELECT COUNT(*) FROM audit_events", [], |r| r.get(0))).unwrap();
    let marker_count: i64 = storage.with_connection(|conn| conn.query_row("SELECT COUNT(*) FROM storage_meta WHERE key='legacy_operation_logs_v1'", [], |r| r.get(0))).unwrap();
    assert_eq!(audit_count, 0);
    assert_eq!(marker_count, 0);

    drop(storage);
    let _ = std::fs::remove_file(path);
}
