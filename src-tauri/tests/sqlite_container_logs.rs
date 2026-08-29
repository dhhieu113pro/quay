#[path = "../src/storage/mod.rs"]
mod storage;

use storage::container_logs::{ContainerLogQuery, ContainerLogWrite};
use storage::Storage;
use std::time::{SystemTime, UNIX_EPOCH};

fn test_storage() -> (Storage, std::path::PathBuf) {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_nanos();
    let path = std::env::temp_dir().join(format!("quay-container-logs-{nonce}.db"));
    (Storage::open(path.clone()).expect("open storage"), path)
}

fn line(
    container_id: &str,
    container_name: &str,
    cube_id: Option<&str>,
    cube_name: Option<&str>,
    source_ts: i64,
    captured_ts: i64,
    text: &str,
    dedupe_key: &str,
) -> ContainerLogWrite {
    ContainerLogWrite {
        container_id: Some(container_id.into()),
        container_name: container_name.into(),
        cube_id: cube_id.map(str::to_owned),
        cube_name: cube_name.map(str::to_owned),
        source_ts: Some(source_ts),
        captured_ts,
        stream: "stdout".into(),
        text: text.into(),
        dedupe_key: dedupe_key.into(),
    }
}

#[test]
fn appends_batches_deduplicates_and_preserves_sequence_distinct_lines() {
    let (storage, path) = test_storage();
    let rows = vec![
        line("c1", "api", None, None, 100, 110, "ready", "c1:100:0"),
        line("c1", "api", None, None, 100, 111, "ready", "c1:100:1"),
        line("c1", "api", None, None, 100, 112, "duplicate", "c1:100:0"),
    ];

    assert_eq!(storage.append_container_logs(&rows).unwrap(), 2);
    let persisted = storage.query_container_logs(&ContainerLogQuery::default()).unwrap();
    assert_eq!(persisted.len(), 2);
    assert_eq!(persisted.iter().map(|row| row.text.as_str()).collect::<Vec<_>>(), vec!["ready", "ready"]);
    assert!(persisted.iter().all(|row| row.payload_bytes == 5));

    drop(storage);
    let _ = std::fs::remove_file(path);
}

#[test]
fn queries_pages_filters_and_keeps_historical_targets() {
    let (storage, path) = test_storage();
    storage.append_container_logs(&[
        line("c1", "api-old", Some("cube-a"), Some("Alpha"), 100, 100, "old alpha", "1"),
        line("c2", "worker", Some("cube-a"), Some("Alpha"), 200, 200, "alpha worker", "2"),
        line("c3", "db", Some("cube-b"), Some("Beta"), 300, 300, "postgres ready", "3"),
    ]).unwrap();

    let targets = storage.list_log_targets().unwrap();
    assert_eq!(targets.len(), 3);
    assert!(targets.iter().any(|target| target.container_name == "api-old" && target.container_id.as_deref() == Some("c1")));
    assert!(targets.iter().any(|target| target.cube_id.as_deref() == Some("cube-a") && target.cube_name.as_deref() == Some("Alpha")));

    let filtered = storage.query_container_logs(&ContainerLogQuery {
        container_name: None,
        cube_id: Some("cube-a".into()),
        search: Some("worker".into()),
        from_ts: Some(150),
        to_ts: Some(250),
        limit: 50,
        before_id: None,
    }).unwrap();
    assert_eq!(filtered.len(), 1);
    assert_eq!(filtered[0].container_name, "worker");

    let first = storage.query_container_logs(&ContainerLogQuery { limit: 2, ..Default::default() }).unwrap();
    assert_eq!(first.len(), 2);
    assert!(first[0].id > first[1].id);
    let second = storage.query_container_logs(&ContainerLogQuery {
        limit: 2,
        before_id: Some(first[1].id),
        ..Default::default()
    }).unwrap();
    assert_eq!(second.len(), 1);
    assert_eq!(second[0].container_name, "api-old");

    drop(storage);
    let _ = std::fs::remove_file(path);
}

#[test]
fn clear_container_logs_does_not_clear_audit() {
    let (storage, path) = test_storage();
    storage.append_container_logs(&[line("c1", "api", None, None, 100, 100, "hello", "1")]).unwrap();
    storage.with_connection(|conn| {
        conn.execute(
            "INSERT INTO audit_events(id,operation_id,ts,category,action,status) VALUES('audit-1','op-1',1,'container','start','done')",
            [],
        )?;
        Ok(())
    }).unwrap();

    storage.clear_container_logs().unwrap();
    assert!(storage.query_container_logs(&ContainerLogQuery::default()).unwrap().is_empty());
    let audit_count: i64 = storage.with_connection(|conn| conn.query_row("SELECT COUNT(*) FROM audit_events", [], |row| row.get(0))).unwrap();
    assert_eq!(audit_count, 1);

    drop(storage);
    let _ = std::fs::remove_file(path);
}

#[test]
fn retention_removes_expired_then_oldest_until_payload_budget_is_met() {
    let (storage, path) = test_storage();
    let day = 24 * 60 * 60 * 1000_i64;
    let now = 40 * day;
    storage.append_container_logs(&[
        line("c1", "api", None, None, 1, now - 31 * day, "expired", "expired"),
        line("c1", "api", None, None, 2, now - day, "1111", "recent-1"),
        line("c1", "api", None, None, 3, now - day + 1, "2222", "recent-2"),
        line("c1", "api", None, None, 4, now - day + 2, "3333", "recent-3"),
    ]).unwrap();

    let deleted = storage.enforce_log_retention(now, 30, 8).unwrap();
    assert_eq!(deleted, 2);
    let remaining = storage.query_container_logs(&ContainerLogQuery::default()).unwrap();
    assert_eq!(remaining.len(), 2);
    assert_eq!(remaining.iter().map(|row| row.text.as_str()).collect::<Vec<_>>(), vec!["3333", "2222"]);
    let payload: i64 = storage.with_connection(|conn| conn.query_row("SELECT COALESCE(SUM(payload_bytes), 0) FROM container_log_lines", [], |row| row.get(0))).unwrap();
    assert!(payload <= 8);

    drop(storage);
    let _ = std::fs::remove_file(path);
}
