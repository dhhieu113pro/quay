#![cfg(windows)]

use crate::storage::audit::{AuditStatus, AuditWrite};
use crate::storage::Storage;
use crate::wslc_executor::CliResult;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

static OPERATION_SEQUENCE: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MutationMetadata {
    pub category: String,
    pub action: String,
    pub target_type: Option<String>,
    pub target_name: Option<String>,
    pub command: String,
}

fn now_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

fn normalize_action(action: &str) -> String {
    match action {
        "rm" | "delete" => "remove".into(),
        other => other.to_string(),
    }
}

fn named_argument(args: &[String], names: &[&str]) -> Option<String> {
    for (index, arg) in args.iter().enumerate() {
        if names.iter().any(|name| arg == name) {
            if let Some(value) = args.get(index + 1).filter(|value| !value.trim().is_empty()) {
                return Some(value.clone());
            }
        }
    }
    None
}

fn command_target(args: &[String], index: usize) -> Option<String> {
    args.get(index)
        .filter(|value| !value.trim().is_empty() && !value.starts_with('-'))
        .cloned()
}

pub fn describe_mutation(args: &[String]) -> Option<MutationMetadata> {
    let first = args.first()?.as_str();
    let second = args.get(1).map(String::as_str).unwrap_or("");

    let is_query = matches!(
        (first, second),
        ("version", _)
            | ("container", "list" | "logs" | "inspect")
            | ("image", "list" | "inspect")
            | ("volume", "list" | "inspect")
            | ("network", "list" | "inspect")
    );
    if is_query {
        return None;
    }

    let (category, action, target_type, target_name) = match first {
        "run" => (
            "container".to_string(),
            "run".to_string(),
            Some("container".to_string()),
            named_argument(args, &["--name", "-n"]),
        ),
        "pull" => (
            "image".to_string(),
            "pull".to_string(),
            Some("image".to_string()),
            command_target(args, 1),
        ),
        "container" => (
            "container".to_string(),
            normalize_action(second),
            Some("container".to_string()),
            command_target(args, 2),
        ),
        "image" => (
            "image".to_string(),
            normalize_action(second),
            Some("image".to_string()),
            command_target(args, 2),
        ),
        "volume" => (
            "volume".to_string(),
            normalize_action(second),
            Some("volume".to_string()),
            command_target(args, 2),
        ),
        "network" => (
            "network".to_string(),
            normalize_action(second),
            Some("network".to_string()),
            command_target(args, 2),
        ),
        "session" => (
            "session".to_string(),
            normalize_action(second),
            Some("session".to_string()),
            command_target(args, 2),
        ),
        _ => return None,
    };

    if action.is_empty() {
        return None;
    }

    Some(MutationMetadata {
        category,
        action,
        target_type,
        target_name,
        command: format!("wslc {}", args.join(" ")),
    })
}

fn write_event(storage: &Storage, event: AuditWrite) {
    if let Err(error) = storage.append_audit(&event) {
        eprintln!("audit: {error}");
    }
}

pub fn execute_with_audit<F>(
    storage: Option<&Storage>,
    args: &[String],
    execute: F,
) -> Result<CliResult, String>
where
    F: FnOnce() -> Result<CliResult, String>,
{
    let Some(metadata) = describe_mutation(args) else {
        return execute();
    };
    let Some(storage) = storage else {
        return execute();
    };

    let started_at = now_millis();
    let operation_id = format!(
        "wslc-{started_at}-{}",
        OPERATION_SEQUENCE.fetch_add(1, Ordering::Relaxed)
    );
    write_event(
        storage,
        AuditWrite {
            id: format!("{operation_id}:doing"),
            operation_id: operation_id.clone(),
            ts: started_at,
            category: metadata.category.clone(),
            action: metadata.action.clone(),
            target_type: metadata.target_type.clone(),
            target_id: None,
            target_name: metadata.target_name.clone(),
            status: AuditStatus::Doing,
            message: Some("Operation started".into()),
            command: Some(metadata.command.clone()),
            error: None,
            duration_ms: None,
            metadata_json: None,
        },
    );

    let timer = Instant::now();
    let result = execute();
    let duration_ms = timer.elapsed().as_millis().min(i64::MAX as u128) as i64;
    let terminal_at = now_millis();

    match &result {
        Ok(cli) => {
            let status = if cli.ok { AuditStatus::Done } else { AuditStatus::Error };
            let error = if cli.ok {
                None
            } else if cli.error.trim().is_empty() {
                Some(format!("WSLC exited with code {}", cli.exit_code))
            } else {
                Some(cli.error.clone())
            };
            write_event(
                storage,
                AuditWrite {
                    id: format!("{operation_id}:terminal"),
                    operation_id,
                    ts: terminal_at,
                    category: metadata.category,
                    action: metadata.action,
                    target_type: metadata.target_type,
                    target_id: None,
                    target_name: metadata.target_name,
                    status,
                    message: Some(if cli.ok { "Operation completed" } else { "Operation failed" }.into()),
                    command: Some(metadata.command),
                    error,
                    duration_ms: Some(duration_ms),
                    metadata_json: None,
                },
            );
        }
        Err(error) => {
            write_event(
                storage,
                AuditWrite {
                    id: format!("{operation_id}:terminal"),
                    operation_id,
                    ts: terminal_at,
                    category: metadata.category,
                    action: metadata.action,
                    target_type: metadata.target_type,
                    target_id: None,
                    target_name: metadata.target_name,
                    status: AuditStatus::Error,
                    message: Some("Operation failed".into()),
                    command: Some(metadata.command),
                    error: Some(error.clone()),
                    duration_ms: Some(duration_ms),
                    metadata_json: None,
                },
            );
        }
    }

    result
}
