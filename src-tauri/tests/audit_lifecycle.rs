#![cfg(windows)]

#[path = "../src/storage/mod.rs"]
mod storage;
#[path = "../src/wslc_executor.rs"]
mod wslc_executor;
#[path = "../src/wslc_audit.rs"]
mod wslc_audit;
#[path = "../src/pull_manager.rs"]
mod pull_manager;
#[path = "../src/pull_audit.rs"]
mod pull_audit;

use pull_manager::{PullJob, PullJobStatus};
use std::time::{SystemTime, UNIX_EPOCH};
use storage::audit::{AuditQuery, AuditStatus};
use storage::Storage;
use wslc_executor::CliResult;

fn strings(values: &[&str]) -> Vec<String> {
    values.iter().map(|value| (*value).to_string()).collect()
}

fn test_storage(prefix: &str) -> (Storage, std::path::PathBuf) {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_nanos();
    let path = std::env::temp_dir().join(format!("quay-{prefix}-{nonce}.db"));
    (Storage::open(path.clone()).expect("open storage"), path)
}

#[test]
fn mutation_classifier_covers_supported_state_changes_but_skips_queries() {
    let cases = [
        (strings(&["container", "start", "api"]), "container", "start", Some("api")),
        (strings(&["container", "restart", "api"]), "container", "restart", Some("api")),
        (strings(&["container", "rm", "api"]), "container", "remove", Some("api")),
        (strings(&["run", "--name", "alpha-api", "nginx:latest"]), "container", "run", Some("alpha-api")),
        (strings(&["image", "rm", "nginx:latest"]), "image", "remove", Some("nginx:latest")),
        (strings(&["volume", "create", "cache"]), "volume", "create", Some("cache")),
        (strings(&["session", "terminate", "default"]), "session", "terminate", Some("default")),
    ];

    for (args, category, action, target) in cases {
        let metadata = wslc_audit::describe_mutation(&args).expect("mutation metadata");
        assert_eq!(metadata.category, category);
        assert_eq!(metadata.action, action);
        assert_eq!(metadata.target_name.as_deref(), target);
    }

    for args in [
        strings(&["container", "list"]),
        strings(&["container", "logs", "api"]),
        strings(&["image", "inspect", "nginx:latest"]),
        strings(&["volume", "list"]),
        strings(&["version"]),
    ] {
        assert!(wslc_audit::describe_mutation(&args).is_none(), "query should not be audited: {args:?}");
    }
}

#[test]
fn native_audit_wrapper_records_doing_then_done_or_error_and_skips_queries() {
    let (storage, path) = test_storage("audit-executor");

    let success = wslc_audit::execute_with_audit(
        Some(&storage),
        &strings(&["container", "start", "api"]),
        || Ok(CliResult { ok: true, output: "started".into(), error: String::new(), exit_code: 0 }),
    ).unwrap();
    assert!(success.ok);

    let failure = wslc_audit::execute_with_audit(
        Some(&storage),
        &strings(&["container", "restart", "api"]),
        || Ok(CliResult { ok: false, output: String::new(), error: "password=secret failed".into(), exit_code: 17 }),
    ).unwrap();
    assert!(!failure.ok);

    wslc_audit::execute_with_audit(
        Some(&storage),
        &strings(&["container", "list"]),
        || Ok(CliResult { ok: true, output: "[]".into(), error: String::new(), exit_code: 0 }),
    ).unwrap();

    let rows = storage.query_audit(&AuditQuery::default()).unwrap();
    assert_eq!(rows.len(), 4);
    let start_rows = rows.iter().filter(|row| row.action == "start").collect::<Vec<_>>();
    assert_eq!(start_rows.len(), 2);
    assert_eq!(start_rows[1].status, AuditStatus::Doing);
    assert_eq!(start_rows[0].status, AuditStatus::Done);
    assert_eq!(start_rows[0].operation_id, start_rows[1].operation_id);
    assert!(start_rows[0].duration_ms.is_some());

    let restart_rows = rows.iter().filter(|row| row.action == "restart").collect::<Vec<_>>();
    assert_eq!(restart_rows.len(), 2);
    assert_eq!(restart_rows[1].status, AuditStatus::Doing);
    assert_eq!(restart_rows[0].status, AuditStatus::Error);
    assert_eq!(restart_rows[0].operation_id, restart_rows[1].operation_id);
    assert!(restart_rows[0].error.as_deref().unwrap_or_default().contains("REDACTED"));
    assert!(!restart_rows[0].error.as_deref().unwrap_or_default().contains("secret"));

    drop(storage);
    let _ = std::fs::remove_file(path);
}

fn pull_job(id: &str, reference: &str, status: PullJobStatus, error: Option<&str>, updated_at: u64) -> PullJob {
    PullJob {
        id: id.into(),
        reference: reference.into(),
        status,
        current_bytes: 0,
        total_bytes: None,
        progress: None,
        bytes_per_second: None,
        started_at: None,
        created_at: 1,
        updated_at,
        finished_at: Some(updated_at),
        message: None,
        error: error.map(str::to_owned),
    }
}

#[test]
fn pull_lifecycle_mapper_records_start_success_failure_and_cancel() {
    let (storage, path) = test_storage("audit-pulls");

    pull_audit::record_pull_job(&storage, &pull_job("p1", "nginx:latest", PullJobStatus::Queued, None, 10));
    pull_audit::record_pull_job(&storage, &pull_job("p1", "nginx:latest", PullJobStatus::Completed, None, 20));
    pull_audit::record_pull_job(&storage, &pull_job("p2", "ghcr.io/acme/private:latest", PullJobStatus::Queued, None, 30));
    pull_audit::record_pull_job(&storage, &pull_job("p2", "ghcr.io/acme/private:latest", PullJobStatus::Failed, Some("token=supersecret registry failure"), 40));
    pull_audit::record_pull_job(&storage, &pull_job("p3", "redis:latest", PullJobStatus::Queued, None, 50));
    pull_audit::record_pull_job(&storage, &pull_job("p3", "redis:latest", PullJobStatus::Cancelled, None, 60));

    let rows = storage.query_audit(&AuditQuery { category: Some("image".into()), ..Default::default() }).unwrap();
    for reference in ["nginx:latest", "ghcr.io/acme/private:latest", "redis:latest"] {
        let lifecycle = rows.iter().filter(|row| row.target_name.as_deref() == Some(reference)).collect::<Vec<_>>();
        assert_eq!(lifecycle.len(), 2);
        assert!(lifecycle.iter().any(|row| row.status == AuditStatus::Doing));
        assert!(lifecycle.iter().any(|row| matches!(row.status, AuditStatus::Done | AuditStatus::Error)));
    }
    let failure = rows.iter().find(|row| row.target_name.as_deref() == Some("ghcr.io/acme/private:latest") && row.status == AuditStatus::Error).expect("failed pull audit");
    assert!(failure.error.as_deref().unwrap_or_default().contains("REDACTED"));
    assert!(!failure.error.as_deref().unwrap_or_default().contains("supersecret"));

    drop(storage);
    let _ = std::fs::remove_file(path);
}
