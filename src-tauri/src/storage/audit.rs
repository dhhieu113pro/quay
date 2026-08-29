use crate::storage::{Storage, StorageError};
use rusqlite::{params_from_iter, types::Value, Row};
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AuditStatus {
    Doing,
    Done,
    Error,
}

impl AuditStatus {
    fn as_str(self) -> &'static str {
        match self {
            Self::Doing => "doing",
            Self::Done => "done",
            Self::Error => "error",
        }
    }

    fn from_db(value: &str) -> Result<Self, rusqlite::Error> {
        match value {
            "doing" => Ok(Self::Doing),
            "done" => Ok(Self::Done),
            "error" => Ok(Self::Error),
            _ => Err(rusqlite::Error::InvalidQuery),
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuditWrite {
    pub id: String,
    pub operation_id: String,
    pub ts: i64,
    pub category: String,
    pub action: String,
    pub target_type: Option<String>,
    pub target_id: Option<String>,
    pub target_name: Option<String>,
    pub status: AuditStatus,
    pub message: Option<String>,
    pub command: Option<String>,
    pub error: Option<String>,
    pub duration_ms: Option<i64>,
    pub metadata_json: Option<String>,
}

pub type AuditEvent = AuditWrite;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct AuditQuery {
    pub status: Option<AuditStatus>,
    pub category: Option<String>,
    pub target: Option<String>,
    pub search: Option<String>,
    pub from_ts: Option<i64>,
    pub to_ts: Option<i64>,
    pub limit: usize,
    pub before_ts: Option<i64>,
}

impl Default for AuditQuery {
    fn default() -> Self {
        Self {
            status: None,
            category: None,
            target: None,
            search: None,
            from_ts: None,
            to_ts: None,
            limit: 100,
            before_ts: None,
        }
    }
}

fn redact_assignment(input: &str, key: &str) -> String {
    let lower = input.to_ascii_lowercase();
    let needle = format!("{}=", key.to_ascii_lowercase());
    let mut output = input.to_string();
    let mut search_from = 0usize;
    loop {
        let lower_output = output.to_ascii_lowercase();
        let Some(relative) = lower_output[search_from..].find(&needle) else { break };
        let start = search_from + relative + needle.len();
        let rest = &output[start..];
        let end_offset = rest
            .find(|c: char| c.is_whitespace() || matches!(c, ',' | ';' | '&'))
            .unwrap_or(rest.len());
        output.replace_range(start..start + end_offset, "REDACTED");
        search_from = start + "REDACTED".len();
        if search_from >= output.len() { break; }
    }
    let _ = lower;
    output
}

fn redact_bearer(input: &str) -> String {
    let mut output = input.to_string();
    let lower = output.to_ascii_lowercase();
    let needles = ["authorization: bearer ", "bearer "];
    for needle in needles {
        let Some(pos) = lower.find(needle) else { continue };
        let start = pos + needle.len();
        let rest = &output[start..];
        let end = rest.find(|c: char| c.is_whitespace() || c == ',').unwrap_or(rest.len());
        output.replace_range(start..start + end, "REDACTED");
        break;
    }
    output
}

fn redact_url_userinfo(input: &str) -> String {
    let mut output = input.to_string();
    let mut cursor = 0usize;
    loop {
        let Some(relative_scheme) = output[cursor..].find("://") else { break };
        let authority_start = cursor + relative_scheme + 3;
        let authority_end = output[authority_start..]
            .find(|c: char| matches!(c, '/' | '?' | '#' | ' ' | '\n' | '\r' | '\t'))
            .map(|offset| authority_start + offset)
            .unwrap_or(output.len());
        let authority = &output[authority_start..authority_end];
        if let Some(at) = authority.find('@') {
            let credentials_end = authority_start + at;
            output.replace_range(authority_start..credentials_end, "REDACTED");
            cursor = authority_start + "REDACTED@".len();
        } else {
            cursor = authority_end;
        }
        if cursor >= output.len() { break; }
    }
    output
}

pub fn redact_audit_text(input: &str) -> String {
    let mut value = input.to_string();
    for key in [
        "password",
        "passwd",
        "token",
        "secret",
        "api_key",
        "apikey",
        "ngrok_authtoken",
        "access_token",
        "refresh_token",
    ] {
        value = redact_assignment(&value, key);
    }
    value = redact_bearer(&value);
    redact_url_userinfo(&value)
}

fn sanitized(value: &Option<String>) -> Option<String> {
    value.as_deref().map(redact_audit_text)
}

fn row_to_event(row: &Row<'_>) -> Result<AuditEvent, rusqlite::Error> {
    let status: String = row.get(8)?;
    Ok(AuditEvent {
        id: row.get(0)?,
        operation_id: row.get(1)?,
        ts: row.get(2)?,
        category: row.get(3)?,
        action: row.get(4)?,
        target_type: row.get(5)?,
        target_id: row.get(6)?,
        target_name: row.get(7)?,
        status: AuditStatus::from_db(&status)?,
        message: row.get(9)?,
        command: row.get(10)?,
        error: row.get(11)?,
        duration_ms: row.get(12)?,
        metadata_json: row.get(13)?,
    })
}

impl Storage {
    pub fn append_audit(&self, event: &AuditWrite) -> Result<(), StorageError> {
        let message = sanitized(&event.message);
        let command = sanitized(&event.command);
        let error = sanitized(&event.error);
        self.with_connection(|conn| {
            conn.execute(
                "INSERT INTO audit_events (id, operation_id, ts, category, action, target_type, target_id, target_name, status, message, command, error, duration_ms, metadata_json) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
                rusqlite::params![
                    event.id,
                    event.operation_id,
                    event.ts,
                    event.category,
                    event.action,
                    event.target_type,
                    event.target_id,
                    event.target_name,
                    event.status.as_str(),
                    message,
                    command,
                    error,
                    event.duration_ms,
                    event.metadata_json,
                ],
            )?;
            Ok(())
        })
    }

    pub fn query_audit(&self, query: &AuditQuery) -> Result<Vec<AuditEvent>, StorageError> {
        let mut sql = String::from(
            "SELECT id, operation_id, ts, category, action, target_type, target_id, target_name, status, message, command, error, duration_ms, metadata_json FROM audit_events WHERE 1=1",
        );
        let mut values: Vec<Value> = Vec::new();

        if let Some(status) = query.status {
            sql.push_str(" AND status = ?");
            values.push(Value::Text(status.as_str().to_string()));
        }
        if let Some(category) = query.category.as_deref().filter(|value| !value.trim().is_empty()) {
            sql.push_str(" AND category = ?");
            values.push(Value::Text(category.trim().to_string()));
        }
        if let Some(target) = query.target.as_deref().filter(|value| !value.trim().is_empty()) {
            sql.push_str(" AND (COALESCE(target_name, '') LIKE ? OR COALESCE(target_id, '') LIKE ?)");
            let pattern = format!("%{}%", target.trim());
            values.push(Value::Text(pattern.clone()));
            values.push(Value::Text(pattern));
        }
        if let Some(search) = query.search.as_deref().filter(|value| !value.trim().is_empty()) {
            sql.push_str(" AND (category LIKE ? OR action LIKE ? OR COALESCE(target_name, '') LIKE ? OR COALESCE(message, '') LIKE ? OR COALESCE(command, '') LIKE ? OR COALESCE(error, '') LIKE ?)");
            let pattern = format!("%{}%", search.trim());
            for _ in 0..6 { values.push(Value::Text(pattern.clone())); }
        }
        if let Some(from_ts) = query.from_ts {
            sql.push_str(" AND ts >= ?");
            values.push(Value::Integer(from_ts));
        }
        if let Some(to_ts) = query.to_ts {
            sql.push_str(" AND ts <= ?");
            values.push(Value::Integer(to_ts));
        }
        if let Some(before_ts) = query.before_ts {
            sql.push_str(" AND ts < ?");
            values.push(Value::Integer(before_ts));
        }

        sql.push_str(" ORDER BY ts DESC, id DESC LIMIT ?");
        values.push(Value::Integer(query.limit.clamp(1, 500) as i64));

        self.with_connection(|conn| {
            let mut statement = conn.prepare(&sql)?;
            let rows = statement.query_map(params_from_iter(values.iter()), row_to_event)?;
            rows.collect()
        })
    }

    pub fn clear_audit(&self) -> Result<usize, StorageError> {
        self.with_connection(|conn| conn.execute("DELETE FROM audit_events", []))
    }
}
