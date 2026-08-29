#![cfg(windows)]

#[path = "../src/storage/mod.rs"]
mod storage;
#[path = "../src/wslc_executor.rs"]
mod wslc_executor;
#[path = "../src/pull_manager.rs"]
mod pull_manager;

use pull_manager::{PullEventSink, PullExecution, PullExecutor, PullJob, PullManager, ProgressUpdate};
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use storage::audit::{AuditQuery, AuditStatus};
use storage::Storage;
use wslc_executor::{CliResult, ProcessRunner, WslcExecutor};

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

#[derive(Clone)]
struct FixedRunner {
    result: Result<CliResult, String>,
}

impl ProcessRunner for FixedRunner {
    fn run(&self, _args: &[String], _timeout: Duration) -> Result<CliResult, String> {
        self.result.clone()
    }
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
        let metadata = wslc_executor::describe_mutation(&args).expect("mutation metadata");
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
        assert!(wslc_executor::describe_mutation(&args).is_none(), "query should not be audited: {args:?}");
    }
}

#[test]
fn executor_records_doing_then_done_or_error_without_blocking_execution() {
    let (storage, path) = test_storage("audit-executor");
    let success = WslcExecutor::with_runner_and_storage(
        Arc::new(FixedRunner {
            result: Ok(CliResult { ok: true, output: "started".into(), error: String::new(), exit_code: 0 }),
        }),
        2,
        Some(storage.clone()),
    );
    success.execute(strings(&["container", "start", "api"])).unwrap();

    let failed = WslcExecutor::with_runner_and_storage(
        Arc::new(FixedRunner {
            result: Ok(CliResult { ok: false, output: String::new(), error: "password=secret failed".into(), exit_code: 17 }),
        }),
        2,
        Some(storage.clone()),
    );
    failed.execute(strings(&["container", "restart", "api"])).unwrap();

    let rows = storage.query_audit(&AuditQuery::default()).unwrap();
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

    let query_executor = WslcExecutor::with_runner_and_storage(
        Arc::new(FixedRunner {
            result: Ok(CliResult { ok: true, output: "[]".into(), error: String::new(), exit_code: 0 }),
        }),
        2,
        Some(storage.clone()),
    );
    query_executor.execute(strings(&["container", "list"])).unwrap();
    assert_eq!(storage.query_audit(&AuditQuery::default()).unwrap().len(), 4);

    drop(storage);
    let _ = std::fs::remove_file(path);
}

#[derive(Default)]
struct NoopSink;
impl PullEventSink for NoopSink {
    fn emit(&self, _job: &PullJob) {}
}

struct ImmediatePull {
    outcome: Result<PullExecution, String>,
}
impl PullExecutor for ImmediatePull {
    fn execute(
        &self,
        _reference: &str,
        _cancelled: Arc<AtomicBool>,
        _on_progress: Arc<dyn Fn(ProgressUpdate) + Send + Sync>,
    ) -> Result<PullExecution, String> {
        self.outcome.clone()
    }
}

fn wait_for_terminal(manager: &PullManager, id: &str) {
    for _ in 0..100 {
        if manager.list().iter().find(|job| job.id == id).is_some_and(|job| pull_manager::is_terminal(&job.status)) {
            return;
        }
        std::thread::sleep(Duration::from_millis(10));
    }
    panic!("pull did not reach a terminal state");
}

#[test]
fn pull_manager_uses_the_same_audit_store_for_success_failure_and_cancel() {
    let (storage, path) = test_storage("audit-pulls");
    let history = path.with_extension("pulls.json");

    let success = PullManager::new_with_storage(
        history.clone(),
        Arc::new(ImmediatePull { outcome: Ok(PullExecution::Completed) }),
        Arc::new(NoopSink),
        1,
        Some(storage.clone()),
    );
    let completed = success.start("nginx:latest").unwrap();
    wait_for_terminal(&success, &completed.id);
    success.shutdown();

    let failed = PullManager::new_with_storage(
        history.clone(),
        Arc::new(ImmediatePull { outcome: Err("token=supersecret registry failure".into()) }),
        Arc::new(NoopSink),
        1,
        Some(storage.clone()),
    );
    let failed_job = failed.start("ghcr.io/acme/private:latest").unwrap();
    wait_for_terminal(&failed, &failed_job.id);
    failed.shutdown();

    let queued = PullManager::new_with_storage(
        history.clone(),
        Arc::new(ImmediatePull { outcome: Ok(PullExecution::Completed) }),
        Arc::new(NoopSink),
        0,
        Some(storage.clone()),
    );
    let cancelled = queued.start("redis:latest").unwrap();
    queued.cancel(&cancelled.id).unwrap();
    queued.shutdown();

    let rows = storage.query_audit(&AuditQuery { category: Some("image".into()), ..Default::default() }).unwrap();
    for reference in ["nginx:latest", "ghcr.io/acme/private:latest", "redis:latest"] {
        let lifecycle = rows.iter().filter(|row| row.target_name.as_deref() == Some(reference)).collect::<Vec<_>>();
        assert!(lifecycle.iter().any(|row| row.status == AuditStatus::Doing));
        assert!(lifecycle.iter().any(|row| matches!(row.status, AuditStatus::Done | AuditStatus::Error)));
    }
    let failure = rows.iter().find(|row| row.target_name.as_deref() == Some("ghcr.io/acme/private:latest") && row.status == AuditStatus::Error).expect("failed pull audit");
    assert!(failure.error.as_deref().unwrap_or_default().contains("REDACTED"));
    assert!(!failure.error.as_deref().unwrap_or_default().contains("supersecret"));

    drop(storage);
    let _ = std::fs::remove_file(path);
    let _ = std::fs::remove_file(history);
}
