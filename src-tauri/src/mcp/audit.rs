use crate::operations::{OperationKind, QuayOperations};
use serde_json::{Map, Value};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

static MCP_AUDIT_SEQUENCE: AtomicU64 = AtomicU64::new(1);

pub fn redact_value(value: Value) -> Value {
    match value {
        Value::Object(object) => Value::Object(
            object
                .into_iter()
                .map(|(key, value)| {
                    if is_sensitive_key(&key) {
                        (key, Value::String("[REDACTED]".into()))
                    } else {
                        (key, redact_value(value))
                    }
                })
                .collect::<Map<_, _>>(),
        ),
        Value::Array(values) => Value::Array(values.into_iter().map(redact_value).collect()),
        other => other,
    }
}

fn is_sensitive_key(key: &str) -> bool {
    matches!(
        key.to_ascii_lowercase().as_str(),
        "env"
            | "environment"
            | "token"
            | "secret"
            | "password"
            | "passwd"
            | "api_key"
            | "apikey"
            | "authorization"
            | "access_token"
            | "refresh_token"
    )
}

fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

fn target_from_arguments(arguments: &Value) -> (Option<String>, Option<String>) {
    let object = arguments.as_object();
    let id = object
        .and_then(|value| value.get("id"))
        .and_then(Value::as_str)
        .or_else(|| object.and_then(|value| value.get("reference")).and_then(Value::as_str))
        .map(str::to_string);
    let name = object
        .and_then(|value| value.get("name"))
        .and_then(Value::as_str)
        .map(str::to_string);
    (id, name)
}

pub fn record(
    operations: &QuayOperations,
    tool: &str,
    kind: OperationKind,
    arguments: &Value,
    success: bool,
    error: Option<&str>,
    confirmation_required: bool,
    confirmation_outcome: Option<&str>,
    duration_ms: i64,
) {
    #[cfg(windows)]
    {
        use crate::storage::audit::{AuditStatus, AuditWrite};

        let Some(storage) = operations.storage() else { return; };
        let ts = now_millis();
        let sequence = MCP_AUDIT_SEQUENCE.fetch_add(1, Ordering::Relaxed);
        let operation_id = format!("mcp-{ts}-{sequence}");
        let (target_id, target_name) = target_from_arguments(arguments);
        let target_type = tool.split('.').nth(1).map(str::to_string);
        let metadata = serde_json::json!({
            "tool": tool,
            "kind": kind,
            "arguments": redact_value(arguments.clone()),
            "confirmationRequired": confirmation_required,
            "confirmationOutcome": confirmation_outcome,
        });
        let event = AuditWrite {
            id: format!("{operation_id}:done"),
            operation_id,
            ts,
            category: "mcp".into(),
            action: tool.into(),
            target_type,
            target_id,
            target_name,
            status: if success { AuditStatus::Done } else { AuditStatus::Error },
            message: Some(if success { "MCP operation completed".into() } else { "MCP operation failed".into() }),
            command: None,
            error: error.map(str::to_string),
            duration_ms: Some(duration_ms),
            metadata_json: serde_json::to_string(&metadata).ok(),
        };
        if let Err(error) = storage.append_audit(&event) {
            eprintln!("mcp audit: {error}");
        }
    }

    #[cfg(not(windows))]
    {
        let _ = (operations, tool, kind, arguments, success, error, confirmation_required, confirmation_outcome, duration_ms);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn redacts_sensitive_fields_recursively() {
        let value = json!({
            "id": "container-1",
            "env": {"API_KEY": "secret"},
            "nested": {"token": "abc", "safe": "ok"},
            "authorization": "Bearer xyz"
        });
        let redacted = redact_value(value);
        assert_eq!(redacted["id"], "container-1");
        assert_eq!(redacted["env"], "[REDACTED]");
        assert_eq!(redacted["nested"]["token"], "[REDACTED]");
        assert_eq!(redacted["nested"]["safe"], "ok");
        assert_eq!(redacted["authorization"], "[REDACTED]");
    }

    #[test]
    fn extracts_safe_target_identifiers() {
        let (id, name) = target_from_arguments(&json!({"id":"abc","name":"demo","env":{"X":"Y"}}));
        assert_eq!(id.as_deref(), Some("abc"));
        assert_eq!(name.as_deref(), Some("demo"));
    }
}
