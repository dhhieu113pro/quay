#[path = "../src/storage/mod.rs"]
mod storage;

use storage::audit::{AuditQuery, AuditStatus, AuditWrite};
use storage::Storage;
use std::time::{SystemTime, UNIX_EPOCH};

fn test_storage() -> (Storage, std::path::PathBuf) {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_nanos();
    let path = std::env::temp_dir().join(format!("quay-audit-{nonce}.db"));
    (Storage::open(path.clone()).expect("open storage"), path)
}

fn event(id: &str, operation_id: &str, ts: i64, status: AuditStatus) -> AuditWrite {
    AuditWrite {
        id: id.into(),
        operation_id: operation_id.into(),
        ts,
        category: "container".into(),
        action: "start".into(),
        target_type: Some("container".into()),
        target_id: Some("container-id".into()),
        target_name: Some("postgres".into()),
        status,
        message: None,
        command: None,
        error: None,
        duration_ms: None,
        metadata_json: None,
    }
}

#[test]
fn preserves_append_only_lifecycle_and_incomplete_doing() {
    let (storage, path) = test_storage();
    storage.append_audit(&event("1", "op-success", 10, AuditStatus::Doing)).unwrap();
    storage.append_audit(&event("2", "op-success", 20, AuditStatus::Done)).unwrap();
    storage.append_audit(&event("3", "op-open", 30, AuditStatus::Doing)).unwrap();

    let rows = storage.query_audit(&AuditQuery::default()).unwrap();
    assert_eq!(rows.iter().map(|row| row.status).collect::<Vec<_>>(), vec![
        AuditStatus::Doing,
        AuditStatus::Done,
        AuditStatus::Doing,
    ]);
    assert_eq!(rows[1].operation_id, "op-success");
    assert_eq!(rows[2].operation_id, "op-success");
    assert_eq!(rows[0].operation_id, "op-open");

    drop(storage);
    let _ = std::fs::remove_file(path);
}

#[test]
fn filters_pages_and_clears_only_audit_rows() {
    let (storage, path) = test_storage();
    let mut failed = event("1", "op-1", 100, AuditStatus::Error);
    failed.category = "image".into();
    failed.action = "pull".into();
    failed.target_name = Some("ghcr.io/acme/app:latest".into());
    failed.message = Some("registry pull failed".into());
    storage.append_audit(&failed).unwrap();
    storage.append_audit(&event("2", "op-2", 200, AuditStatus::Done)).unwrap();
    storage.append_audit(&event("3", "op-3", 300, AuditStatus::Doing)).unwrap();

    let filtered = storage.query_audit(&AuditQuery {
        status: Some(AuditStatus::Error),
        category: Some("image".into()),
        target: Some("acme".into()),
        search: Some("registry".into()),
        from_ts: Some(50),
        to_ts: Some(150),
        limit: 50,
        before_ts: None,
    }).unwrap();
    assert_eq!(filtered.len(), 1);
    assert_eq!(filtered[0].operation_id, "op-1");

    let first_page = storage.query_audit(&AuditQuery { limit: 2, ..Default::default() }).unwrap();
    assert_eq!(first_page.iter().map(|row| row.ts).collect::<Vec<_>>(), vec![300, 200]);
    let second_page = storage.query_audit(&AuditQuery { limit: 2, before_ts: Some(200), ..Default::default() }).unwrap();
    assert_eq!(second_page.iter().map(|row| row.ts).collect::<Vec<_>>(), vec![100]);

    storage.with_connection(|conn| {
        conn.execute(
            "INSERT INTO container_log_lines(container_name,captured_ts,stream,text,payload_bytes,dedupe_key) VALUES('postgres',1,'stdout','keep me',7,'keep')",
            [],
        )?;
        Ok(())
    }).unwrap();
    storage.clear_audit().unwrap();
    assert!(storage.query_audit(&AuditQuery::default()).unwrap().is_empty());
    let log_count: i64 = storage.with_connection(|conn| conn.query_row("SELECT COUNT(*) FROM container_log_lines", [], |row| row.get(0))).unwrap();
    assert_eq!(log_count, 1);

    drop(storage);
    let _ = std::fs::remove_file(path);
}

#[test]
fn redacts_secrets_before_persisting_diagnostics() {
    let (storage, path) = test_storage();
    let mut failed = event("1", "op-secret", 100, AuditStatus::Error);
    failed.command = Some("wslc run -e NGROK_AUTHTOKEN=abc -e password=secret https://user:pass@example.com/app".into());
    failed.error = Some("Authorization: Bearer token123".into());
    failed.message = Some("password=hunter2".into());
    storage.append_audit(&failed).unwrap();

    let rows = storage.query_audit(&AuditQuery::default()).unwrap();
    let row = &rows[0];
    for value in [row.command.as_deref(), row.error.as_deref(), row.message.as_deref()].into_iter().flatten() {
        assert!(value.contains("REDACTED"));
        assert!(!value.contains("token123"));
        assert!(!value.contains("hunter2"));
        assert!(!value.contains("user:pass@"));
    }
    assert!(!row.command.as_deref().unwrap().contains("NGROK_AUTHTOKEN=abc"));
    assert!(!row.command.as_deref().unwrap().contains("password=secret"));

    drop(storage);
    let _ = std::fs::remove_file(path);
}
