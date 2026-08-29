use rusqlite::{Connection, Result};

const SCHEMA_V1: &str = r#"
CREATE TABLE IF NOT EXISTS audit_events (
    id TEXT PRIMARY KEY,
    operation_id TEXT NOT NULL,
    ts INTEGER NOT NULL,
    category TEXT NOT NULL,
    action TEXT NOT NULL,
    target_type TEXT,
    target_id TEXT,
    target_name TEXT,
    status TEXT NOT NULL,
    message TEXT,
    command TEXT,
    error TEXT,
    duration_ms INTEGER,
    metadata_json TEXT
);

CREATE INDEX IF NOT EXISTS ix_audit_events_ts
    ON audit_events(ts DESC);
CREATE INDEX IF NOT EXISTS ix_audit_events_operation
    ON audit_events(operation_id, ts);
CREATE INDEX IF NOT EXISTS ix_audit_events_target
    ON audit_events(target_type, target_name, ts DESC);
CREATE INDEX IF NOT EXISTS ix_audit_events_status
    ON audit_events(status, ts DESC);

CREATE TABLE IF NOT EXISTS container_log_lines (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    container_id TEXT,
    container_name TEXT NOT NULL,
    cube_id TEXT,
    cube_name TEXT,
    source_ts INTEGER,
    captured_ts INTEGER NOT NULL,
    stream TEXT NOT NULL,
    text TEXT NOT NULL,
    payload_bytes INTEGER NOT NULL,
    dedupe_key TEXT NOT NULL UNIQUE
);

CREATE INDEX IF NOT EXISTS ix_container_logs_time
    ON container_log_lines(captured_ts DESC);
CREATE INDEX IF NOT EXISTS ix_container_logs_container
    ON container_log_lines(container_name, captured_ts DESC);
CREATE INDEX IF NOT EXISTS ix_container_logs_cube
    ON container_log_lines(cube_id, captured_ts DESC);

CREATE TABLE IF NOT EXISTS storage_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
"#;

pub fn initialize(conn: &mut Connection) -> Result<()> {
    conn.pragma_update(None, "foreign_keys", "ON")?;
    if !conn.is_autocommit() {
        return Err(rusqlite::Error::InvalidQuery);
    }

    // WAL is persistent for file databases. SQLite reports `memory` for
    // in-memory connections, which is expected and used by unit tests.
    let _: String = conn.query_row("PRAGMA journal_mode = WAL", [], |row| row.get(0))?;

    let tx = conn.transaction()?;
    tx.execute_batch(SCHEMA_V1)?;
    tx.pragma_update(None, "user_version", 1_i64)?;
    tx.commit()?;
    Ok(())
}
