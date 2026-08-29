#[path = "../src/storage/schema.rs"]
mod schema;

use rusqlite::Connection;
use std::time::{SystemTime, UNIX_EPOCH};

fn object_exists(conn: &Connection, name: &str) -> bool {
    conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE name = ?1)",
        [name],
        |row| row.get::<_, i64>(0),
    )
    .expect("sqlite_master lookup")
        == 1
}

#[test]
fn initializes_schema_v1_with_required_objects_and_pragmas() {
    let mut conn = Connection::open_in_memory().expect("in-memory sqlite");
    schema::initialize(&mut conn).expect("initialize schema");

    let version: i64 = conn
        .query_row("PRAGMA user_version", [], |row| row.get(0))
        .expect("user_version");
    assert_eq!(version, 1);

    for name in [
        "audit_events",
        "container_log_lines",
        "storage_meta",
        "ix_audit_events_ts",
        "ix_container_logs_container",
    ] {
        assert!(object_exists(&conn, name), "missing schema object {name}");
    }

    let foreign_keys: i64 = conn
        .query_row("PRAGMA foreign_keys", [], |row| row.get(0))
        .expect("foreign_keys");
    assert_eq!(foreign_keys, 1);
}

#[test]
fn file_database_uses_wal() {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_nanos();
    let path = std::env::temp_dir().join(format!("quay-schema-{nonce}.db"));
    let mut conn = Connection::open(&path).expect("file sqlite");

    schema::initialize(&mut conn).expect("initialize schema");

    let mode: String = conn
        .query_row("PRAGMA journal_mode", [], |row| row.get(0))
        .expect("journal_mode");
    assert_eq!(mode.to_ascii_lowercase(), "wal");

    drop(conn);
    let _ = std::fs::remove_file(&path);
    let _ = std::fs::remove_file(path.with_extension("db-shm"));
    let _ = std::fs::remove_file(path.with_extension("db-wal"));
}
