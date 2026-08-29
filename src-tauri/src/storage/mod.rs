pub mod audit;
pub mod schema;

use rusqlite::Connection;
use serde::Serialize;
use std::fmt;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

#[derive(Clone)]
pub struct Storage {
    connection: Arc<Mutex<Connection>>,
    path: Arc<PathBuf>,
}

#[derive(Debug)]
pub enum StorageError {
    Io(std::io::Error),
    Sqlite(rusqlite::Error),
    Poisoned,
}

impl fmt::Display for StorageError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Io(error) => write!(f, "storage io error: {error}"),
            Self::Sqlite(error) => write!(f, "storage sqlite error: {error}"),
            Self::Poisoned => write!(f, "storage connection lock poisoned"),
        }
    }
}

impl std::error::Error for StorageError {}

impl From<std::io::Error> for StorageError {
    fn from(value: std::io::Error) -> Self { Self::Io(value) }
}

impl From<rusqlite::Error> for StorageError {
    fn from(value: rusqlite::Error) -> Self { Self::Sqlite(value) }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageStats {
    pub available: bool,
    pub database_bytes: u64,
    pub audit_rows: i64,
    pub container_log_rows: i64,
    pub container_log_payload_bytes: i64,
}

impl StorageStats {
    pub fn unavailable() -> Self {
        Self {
            available: false,
            database_bytes: 0,
            audit_rows: 0,
            container_log_rows: 0,
            container_log_payload_bytes: 0,
        }
    }
}

impl Storage {
    pub fn open(path: PathBuf) -> Result<Self, StorageError> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let mut connection = Connection::open(&path)?;
        connection.busy_timeout(Duration::from_secs(5))?;
        schema::initialize(&mut connection)?;
        Ok(Self {
            connection: Arc::new(Mutex::new(connection)),
            path: Arc::new(path),
        })
    }

    pub fn with_connection<T>(
        &self,
        work: impl FnOnce(&mut Connection) -> Result<T, rusqlite::Error>,
    ) -> Result<T, StorageError> {
        let mut connection = self.connection.lock().map_err(|_| StorageError::Poisoned)?;
        work(&mut connection).map_err(StorageError::from)
    }

    pub fn stats(&self) -> Result<StorageStats, StorageError> {
        let (audit_rows, container_log_rows, container_log_payload_bytes) = self.with_connection(|conn| {
            let audit_rows = conn.query_row("SELECT COUNT(*) FROM audit_events", [], |row| row.get(0))?;
            let container_log_rows = conn.query_row("SELECT COUNT(*) FROM container_log_lines", [], |row| row.get(0))?;
            let container_log_payload_bytes = conn.query_row(
                "SELECT COALESCE(SUM(payload_bytes), 0) FROM container_log_lines",
                [],
                |row| row.get(0),
            )?;
            Ok((audit_rows, container_log_rows, container_log_payload_bytes))
        })?;
        let database_bytes = std::fs::metadata(self.path.as_ref()).map(|metadata| metadata.len()).unwrap_or(0);
        Ok(StorageStats {
            available: true,
            database_bytes,
            audit_rows,
            container_log_rows,
            container_log_payload_bytes,
        })
    }
}
