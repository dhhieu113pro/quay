use super::{Storage, StorageError};
use crate::storage::audit::redact_audit_text;
use rusqlite::params;
use serde::{Deserialize, Serialize};

const MIGRATION_KEY: &str = "legacy_operation_logs_v1";

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LegacyOperationLog {
    pub id: String,
    pub ts: i64,
    pub container_name: Option<String>,
    pub command: String,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LegacyImportResult {
    pub imported: usize,
    pub already_imported: bool,
}

impl Storage {
    pub fn import_legacy_operation_logs(
        &self,
        entries: &[LegacyOperationLog],
    ) -> Result<LegacyImportResult, StorageError> {
        self.with_connection(|conn| {
            let tx = conn.transaction()?;
            let already_imported: bool = tx.query_row(
                "SELECT EXISTS(SELECT 1 FROM storage_meta WHERE key = ?1)",
                params![MIGRATION_KEY],
                |row| row.get(0),
            )?;
            if already_imported {
                tx.rollback()?;
                return Ok(LegacyImportResult { imported: 0, already_imported: true });
            }

            let mut imported = 0usize;
            for entry in entries {
                if entry.id.trim().is_empty() || entry.command.trim().is_empty() || entry.text.trim().is_empty() {
                    return Err(rusqlite::Error::InvalidQuery);
                }
                let event_id = format!("legacy:{}", entry.id);
                let operation_id = format!("legacy:{}", entry.id);
                let command = redact_audit_text(&entry.command);
                let message = redact_audit_text(&entry.text);
                tx.execute(
                    "INSERT INTO audit_events(\
                        id,operation_id,ts,category,action,target_type,target_name,status,message,command\
                    ) VALUES(?1,?2,?3,'legacy','diagnostic.import','container',?4,'error',?5,?6)",
                    params![event_id, operation_id, entry.ts, entry.container_name, message, command],
                )?;
                imported += 1;
            }

            tx.execute(
                "INSERT INTO storage_meta(key,value) VALUES(?1,?2)",
                params![MIGRATION_KEY, imported.to_string()],
            )?;
            tx.commit()?;
            Ok(LegacyImportResult { imported, already_imported: false })
        })
    }
}
