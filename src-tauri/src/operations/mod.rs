use serde::Serialize;
use serde_json::Value;

#[cfg(windows)]
use crate::pull_manager::PullManager;
#[cfg(windows)]
use crate::storage::Storage;
#[cfg(windows)]
use crate::wslc_executor::WslcExecutor;
#[cfg(windows)]
use crate::wslc_runtime::HostSampler;
#[cfg(windows)]
use std::sync::{Arc, Mutex};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum OperationKind {
    ReadOnly,
    StateChanging,
    Destructive,
}

impl OperationKind {
    pub fn from_name(name: &str) -> Self {
        match name {
            "container.delete" | "image.delete" | "cube.delete" => Self::Destructive,
            "host.status"
            | "container.list"
            | "container.inspect"
            | "container.logs"
            | "image.list"
            | "image.inspect"
            | "cube.list"
            | "cube.inspect"
            | "audit.query" => Self::ReadOnly,
            _ => Self::StateChanging,
        }
    }
}

#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct OperationError {
    code: &'static str,
    message: String,
}

impl OperationError {
    pub fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self { code, message: message.into() }
    }

    pub fn invalid_input(message: impl Into<String>) -> Self { Self::new("invalid_input", message) }
    pub fn not_found(message: impl Into<String>) -> Self { Self::new("not_found", message) }
    pub fn runtime_unavailable(message: impl Into<String>) -> Self { Self::new("runtime_unavailable", message) }
    pub fn conflict(message: impl Into<String>) -> Self { Self::new("conflict", message) }
    pub fn confirmation_required(message: impl Into<String>) -> Self { Self::new("confirmation_required", message) }
    pub fn rejected(message: impl Into<String>) -> Self { Self::new("rejected", message) }
    pub fn timeout(message: impl Into<String>) -> Self { Self::new("timeout", message) }
    pub fn cancelled(message: impl Into<String>) -> Self { Self::new("cancelled", message) }
    pub fn backend_failure(message: impl Into<String>) -> Self { Self::new("backend_failure", message) }

    pub fn code(&self) -> &'static str { self.code }
    pub fn message(&self) -> &str { &self.message }
}

impl std::fmt::Display for OperationError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}", self.code, self.message)
    }
}

impl std::error::Error for OperationError {}

#[derive(Clone)]
pub struct QuayOperations {
    #[cfg(windows)]
    executor: WslcExecutor,
    #[cfg(windows)]
    host: Arc<Mutex<HostSampler>>,
    #[cfg(windows)]
    pull_manager: PullManager,
    #[cfg(windows)]
    storage: Option<Storage>,
}

impl QuayOperations {
    #[cfg(windows)]
    pub fn new(
        executor: WslcExecutor,
        host: Arc<Mutex<HostSampler>>,
        pull_manager: PullManager,
        storage: Option<Storage>,
    ) -> Self {
        Self { executor, host, pull_manager, storage }
    }

    #[cfg(not(windows))]
    pub fn new() -> Self { Self {} }

    pub fn invoke(&self, payload: Value) -> Result<Value, OperationError> {
        let cmd = payload
            .get("cmd")
            .and_then(Value::as_str)
            .filter(|value| !value.trim().is_empty())
            .ok_or_else(|| OperationError::invalid_input("missing cmd"))?;

        #[cfg(windows)]
        {
            crate::wslc_runtime::invoke(&self.executor, &self.host, self.storage.as_ref(), payload)
                .map_err(|message| normalize_backend_error(cmd, message))
        }

        #[cfg(not(windows))]
        {
            let _ = cmd;
            Err(OperationError::runtime_unavailable("WSLC is only available on Windows"))
        }
    }

    #[cfg(windows)]
    pub fn pull_start(&self, reference: &str) -> Result<crate::pull_manager::PullJob, OperationError> {
        self.pull_manager.start(reference).map_err(OperationError::backend_failure)
    }

    #[cfg(windows)]
    pub fn pull_manager(&self) -> &PullManager { &self.pull_manager }

    pub fn query_audit_json(&self, arguments: &Value) -> Result<Value, OperationError> {
        #[cfg(windows)]
        {
            let storage = self.storage.as_ref().ok_or_else(|| OperationError::runtime_unavailable("SQLite storage is unavailable"))?;
            let mut query = crate::storage::audit::AuditQuery::default();
            if let Some(limit) = arguments.get("limit").and_then(Value::as_u64) {
                query.limit = (limit as usize).clamp(1, 1000);
            }
            if let Some(operation) = arguments.get("operation").and_then(Value::as_str).map(str::trim).filter(|value| !value.is_empty()) {
                query.search = Some(operation.to_string());
            }
            let events = storage.query_audit(&query).map_err(|error| OperationError::backend_failure(error.to_string()))?;
            serde_json::to_value(events).map_err(|error| OperationError::backend_failure(error.to_string()))
        }
        #[cfg(not(windows))]
        {
            let _ = arguments;
            Err(OperationError::runtime_unavailable("Quay audit storage is unavailable on this platform"))
        }
    }
}

fn normalize_backend_error(cmd: &str, message: String) -> OperationError {
    let lower = message.to_ascii_lowercase();
    if lower.contains("missing ") || lower.contains("must be") || lower.contains("unknown command") {
        OperationError::invalid_input(message)
    } else if lower.contains("not found") || lower.contains("no such") {
        OperationError::not_found(message)
    } else if lower.contains("already") || lower.contains("conflict") {
        OperationError::conflict(message)
    } else if cmd == "health" && (lower.contains("wslc") || lower.contains("executable")) {
        OperationError::runtime_unavailable(message)
    } else {
        OperationError::backend_failure(message)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn operation_error_has_stable_code_and_message() {
        let error = OperationError::invalid_input("missing op");
        assert_eq!(error.code(), "invalid_input");
        assert_eq!(error.message(), "missing op");
    }

    #[test]
    fn classify_operation_marks_delete_as_destructive() {
        assert_eq!(OperationKind::from_name("container.delete"), OperationKind::Destructive);
        assert_eq!(OperationKind::from_name("container.list"), OperationKind::ReadOnly);
        assert_eq!(OperationKind::from_name("container.start"), OperationKind::StateChanging);
    }

    #[test]
    fn normalizes_known_backend_errors() {
        assert_eq!(normalize_backend_error("run_cli", "missing args".into()).code(), "invalid_input");
        assert_eq!(normalize_backend_error("run_cli", "container not found".into()).code(), "not_found");
        assert_eq!(normalize_backend_error("run_cli", "already running".into()).code(), "conflict");
    }
}
