pub mod schema;

use rusqlite::Connection;
use std::fmt;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

#[derive(Clone)]
pub struct Storage {
    connection: Arc<Mutex<Connection>>,
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

impl Storage {
    pub fn open(path: PathBuf) -> Result<Self, StorageError> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let mut connection = Connection::open(path)?;
        connection.busy_timeout(Duration::from_secs(5))?;
        schema::initialize(&mut connection)?;
        Ok(Self { connection: Arc::new(Mutex::new(connection)) })
    }

    pub fn with_connection<T>(
        &self,
        work: impl FnOnce(&mut Connection) -> Result<T, rusqlite::Error>,
    ) -> Result<T, StorageError> {
        let mut connection = self.connection.lock().map_err(|_| StorageError::Poisoned)?;
        work(&mut connection).map_err(StorageError::from)
    }
}
