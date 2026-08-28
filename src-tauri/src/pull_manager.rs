use serde::{Deserialize, Serialize};
use std::cmp::Reverse;
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum PullJobStatus {
    Queued,
    Pulling,
    Completed,
    Failed,
    Cancelling,
    Cancelled,
    Interrupted,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PullJob {
    pub id: String,
    pub reference: String,
    pub status: PullJobStatus,
    pub current_bytes: u64,
    pub total_bytes: Option<u64>,
    pub progress: Option<f64>,
    pub bytes_per_second: Option<u64>,
    pub started_at: Option<u64>,
    pub created_at: u64,
    pub updated_at: u64,
    pub finished_at: Option<u64>,
    pub message: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct ProgressUpdate {
    pub current_bytes: Option<u64>,
    pub total_bytes: Option<u64>,
    pub progress: Option<f64>,
    pub message: Option<String>,
}

fn parse_size(token: &str, unit: &str) -> Option<u64> {
    let value = token.trim().parse::<f64>().ok()?;
    if !value.is_finite() || value < 0.0 {
        return None;
    }
    let multiplier = match unit.trim().to_ascii_uppercase().as_str() {
        "B" => 1.0,
        "KB" => 1024.0,
        "MB" => 1024.0 * 1024.0,
        "GB" => 1024.0 * 1024.0 * 1024.0,
        _ => return None,
    };
    Some((value * multiplier) as u64)
}

pub fn parse_progress_fragment(fragment: &str) -> ProgressUpdate {
    let text = fragment.trim();
    let words: Vec<&str> = text.split_whitespace().collect();
    if words.len() >= 5 {
        for i in 0..=words.len() - 5 {
            if words.get(i + 2) != Some(&"/") {
                continue;
            }
            let current = parse_size(words[i], words[i + 1]);
            let total = parse_size(words[i + 3], words[i + 4]);
            if let (Some(current), Some(total)) = (current, total) {
                if total > 0 {
                    return ProgressUpdate {
                        current_bytes: Some(current),
                        total_bytes: Some(total),
                        progress: Some(
                            ((current as f64 / total as f64) * 100.0).clamp(0.0, 100.0),
                        ),
                        message: Some(text.to_string()),
                    };
                }
            }
        }
    }
    ProgressUpdate {
        message: (!text.is_empty()).then(|| text.to_string()),
        ..Default::default()
    }
}

pub fn is_terminal(status: &PullJobStatus) -> bool {
    matches!(
        status,
        PullJobStatus::Completed
            | PullJobStatus::Failed
            | PullJobStatus::Cancelled
            | PullJobStatus::Interrupted
    )
}

pub fn prune_history(jobs: Vec<PullJob>) -> Vec<PullJob> {
    let (mut active, mut terminal): (Vec<_>, Vec<_>) = jobs
        .into_iter()
        .partition(|job| !is_terminal(&job.status));
    terminal.sort_by_key(|job| Reverse(job.updated_at));
    terminal.truncate(50);
    active.extend(terminal);
    active.sort_by_key(|job| Reverse(job.updated_at));
    active
}

pub fn normalize_loaded_jobs(mut jobs: Vec<PullJob>, now: u64) -> Vec<PullJob> {
    for job in &mut jobs {
        if !is_terminal(&job.status) {
            job.status = PullJobStatus::Interrupted;
            job.updated_at = now;
            job.finished_at = Some(now);
            job.error = Some("Quay exited before this pull finished".into());
        }
    }
    prune_history(jobs)
}

pub fn load_jobs(path: &Path, now: u64) -> Vec<PullJob> {
    let Ok(raw) = std::fs::read_to_string(path) else {
        return Vec::new();
    };
    let Ok(jobs) = serde_json::from_str::<Vec<PullJob>>(&raw) else {
        return Vec::new();
    };
    normalize_loaded_jobs(jobs, now)
}

pub fn save_jobs(path: &Path, jobs: &[PullJob]) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("could not create pull history directory: {e}"))?;
    }
    let retained = prune_history(jobs.to_vec());
    let raw = serde_json::to_string_pretty(&retained)
        .map_err(|e| format!("could not serialize pull history: {e}"))?;
    std::fs::write(path, raw).map_err(|e| format!("could not persist pull history: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::{Arc, Condvar, Mutex};
    use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

    fn job(id: &str, status: PullJobStatus, updated_at: u64) -> PullJob {
        PullJob {
            id: id.into(),
            reference: format!("{id}:latest"),
            status,
            current_bytes: 0,
            total_bytes: None,
            progress: None,
            bytes_per_second: None,
            started_at: None,
            created_at: updated_at,
            updated_at,
            finished_at: None,
            message: None,
            error: None,
        }
    }

    #[test]
    fn parses_byte_fraction_without_inventing_missing_values() {
        let update = parse_progress_fragment("Downloading 12.5 MB / 50 MB");
        assert_eq!(update.current_bytes, Some(13_107_200));
        assert_eq!(update.total_bytes, Some(52_428_800));
        assert_eq!(update.progress, Some(25.0));
    }

    #[test]
    fn stage_only_output_is_indeterminate() {
        let update = parse_progress_fragment("Pulling fs layer");
        assert_eq!(update.progress, None);
        assert_eq!(update.total_bytes, None);
        assert_eq!(update.message.as_deref(), Some("Pulling fs layer"));
    }

    #[test]
    fn persisted_active_jobs_become_interrupted() {
        let now = 1_700_000_000_000_u64;
        let loaded = normalize_loaded_jobs(vec![job("pull-1", PullJobStatus::Pulling, now - 10)], now);
        assert_eq!(loaded[0].status, PullJobStatus::Interrupted);
        assert_eq!(loaded[0].finished_at, Some(now));
    }

    #[test]
    fn retention_keeps_active_jobs_and_latest_fifty_terminal_jobs() {
        let mut jobs = vec![job("active", PullJobStatus::Queued, 1000)];
        for index in 0..60_u64 {
            jobs.push(job(&format!("done-{index}"), PullJobStatus::Completed, index));
        }
        let retained = prune_history(jobs);
        assert!(retained.iter().any(|item| item.id == "active"));
        assert_eq!(retained.iter().filter(|item| is_terminal(&item.status)).count(), 50);
        assert!(!retained.iter().any(|item| item.id == "done-0"));
        assert!(retained.iter().any(|item| item.id == "done-59"));
    }

    #[test]
    fn persistence_round_trip_restores_terminal_job() {
        let path = std::env::temp_dir().join(format!("quay-pull-jobs-{}.json", std::process::id()));
        let expected = vec![job("done", PullJobStatus::Completed, 42)];
        save_jobs(&path, &expected).unwrap();
        let actual = load_jobs(&path, 100);
        let _ = std::fs::remove_file(&path);
        assert_eq!(actual, expected);
    }

    #[derive(Default)]
    struct FakeState {
        started: Vec<String>,
        active: usize,
    }

    #[derive(Default)]
    struct FakeExecutor {
        state: Mutex<FakeState>,
        changed: Condvar,
    }

    impl FakeExecutor {
        fn wait_for_started(&self, count: usize) -> bool {
            let deadline = Instant::now() + Duration::from_secs(2);
            let mut state = self.state.lock().unwrap();
            while state.started.len() < count {
                let now = Instant::now();
                if now >= deadline {
                    return false;
                }
                let (next, timeout) = self.changed.wait_timeout(state, deadline - now).unwrap();
                state = next;
                if timeout.timed_out() && state.started.len() < count {
                    return false;
                }
            }
            true
        }

        fn started(&self) -> Vec<String> {
            self.state.lock().unwrap().started.clone()
        }

        fn active(&self) -> usize {
            self.state.lock().unwrap().active
        }
    }

    impl PullExecutor for FakeExecutor {
        fn execute(
            &self,
            reference: &str,
            cancelled: Arc<AtomicBool>,
            _on_progress: Arc<dyn Fn(ProgressUpdate) + Send + Sync>,
        ) -> Result<PullExecution, String> {
            {
                let mut state = self.state.lock().unwrap();
                state.started.push(reference.to_string());
                state.active += 1;
                self.changed.notify_all();
            }
            while !cancelled.load(Ordering::SeqCst) {
                std::thread::sleep(Duration::from_millis(10));
            }
            {
                let mut state = self.state.lock().unwrap();
                state.active -= 1;
                self.changed.notify_all();
            }
            Ok(PullExecution::Cancelled)
        }
    }

    struct NoopSink;

    impl PullEventSink for NoopSink {
        fn emit(&self, _job: &PullJob) {}
    }

    fn history_path(label: &str) -> std::path::PathBuf {
        let nonce = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        std::env::temp_dir().join(format!("quay-pull-{label}-{}-{nonce}.json", std::process::id()))
    }

    fn manager(label: &str, fake: Arc<FakeExecutor>) -> PullManager {
        PullManager::new(history_path(label), fake, Arc::new(NoopSink), 2)
    }

    #[test]
    fn two_run_and_third_waits() {
        let fake = Arc::new(FakeExecutor::default());
        let manager = manager("two-run", fake.clone());
        manager.start("one:latest").unwrap();
        manager.start("two:latest").unwrap();
        manager.start("three:latest").unwrap();
        assert!(fake.wait_for_started(2));
        let jobs = manager.list();
        assert_eq!(jobs.iter().filter(|job| job.status == PullJobStatus::Pulling).count(), 2);
        assert_eq!(jobs.iter().filter(|job| job.status == PullJobStatus::Queued).count(), 1);
        manager.shutdown();
    }

    #[test]
    fn duplicate_active_reference_reuses_job_id() {
        let fake = Arc::new(FakeExecutor::default());
        let manager = manager("duplicate", fake);
        let first = manager.start(" nginx:latest ").unwrap();
        let duplicate = manager.start("nginx:latest").unwrap();
        assert_eq!(first.id, duplicate.id);
        manager.shutdown();
    }

    #[test]
    fn cancelling_running_job_starts_next_queued_job() {
        let fake = Arc::new(FakeExecutor::default());
        let manager = manager("cancel-running", fake.clone());
        let first = manager.start("one:latest").unwrap();
        manager.start("two:latest").unwrap();
        manager.start("three:latest").unwrap();
        assert!(fake.wait_for_started(2));
        manager.cancel(&first.id).unwrap();
        assert!(fake.wait_for_started(3));
        assert!(fake.started().contains(&"three:latest".to_string()));
        manager.shutdown();
    }

    #[test]
    fn queued_cancel_never_calls_executor() {
        let fake = Arc::new(FakeExecutor::default());
        let manager = manager("cancel-queued", fake.clone());
        manager.start("one:latest").unwrap();
        manager.start("two:latest").unwrap();
        let third = manager.start("three:latest").unwrap();
        assert!(fake.wait_for_started(2));
        let cancelled = manager.cancel(&third.id).unwrap();
        assert_eq!(cancelled.status, PullJobStatus::Cancelled);
        std::thread::sleep(Duration::from_millis(50));
        assert!(!fake.started().contains(&"three:latest".to_string()));
        manager.shutdown();
    }

    #[test]
    fn shutdown_waits_until_running_fake_jobs_observe_cancellation() {
        let fake = Arc::new(FakeExecutor::default());
        let manager = manager("shutdown", fake.clone());
        manager.start("one:latest").unwrap();
        manager.start("two:latest").unwrap();
        assert!(fake.wait_for_started(2));
        manager.shutdown();
        assert_eq!(fake.active(), 0);
    }
}
