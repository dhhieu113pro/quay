use serde::{Deserialize, Serialize};
use std::cmp::Reverse;
use std::collections::{HashMap, HashSet};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PullExecution {
    Completed,
    Cancelled,
}

pub trait PullExecutor: Send + Sync + 'static {
    fn execute(
        &self,
        reference: &str,
        cancelled: Arc<AtomicBool>,
        on_progress: Arc<dyn Fn(ProgressUpdate) + Send + Sync>,
    ) -> Result<PullExecution, String>;
}

pub trait PullEventSink: Send + Sync + 'static {
    fn emit(&self, job: &PullJob);
}

pub struct SystemPullExecutor;

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
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

struct PullState {
    jobs: Vec<PullJob>,
    running: HashSet<String>,
    cancellations: HashMap<String, Arc<AtomicBool>>,
    last_progress_persisted: HashMap<String, u64>,
}

struct PullManagerInner {
    state: Mutex<PullState>,
    changed: Condvar,
    executor: Arc<dyn PullExecutor>,
    sink: Arc<dyn PullEventSink>,
    history_path: PathBuf,
    concurrency: usize,
    sequence: AtomicU64,
    shutting_down: AtomicBool,
}

#[derive(Clone)]
pub struct PullManager {
    inner: Arc<PullManagerInner>,
}

impl PullManager {
    pub fn new(
        history_path: PathBuf,
        executor: Arc<dyn PullExecutor>,
        sink: Arc<dyn PullEventSink>,
        concurrency: usize,
    ) -> Self {
        let jobs = load_jobs(&history_path, now_millis());
        let manager = Self {
            inner: Arc::new(PullManagerInner {
                state: Mutex::new(PullState {
                    jobs,
                    running: HashSet::new(),
                    cancellations: HashMap::new(),
                    last_progress_persisted: HashMap::new(),
                }),
                changed: Condvar::new(),
                executor,
                sink,
                history_path,
                concurrency,
                sequence: AtomicU64::new(1),
                shutting_down: AtomicBool::new(false),
            }),
        };
        let jobs = manager.list();
        if !jobs.is_empty() {
            manager.persist_nonfatal(&jobs);
        }
        manager
    }

    pub fn start(&self, reference: &str) -> Result<PullJob, String> {
        if self.inner.shutting_down.load(Ordering::SeqCst) {
            return Err("Quay is shutting down".into());
        }
        let reference = reference.trim();
        if reference.is_empty() {
            return Err("image reference is empty".into());
        }

        let now = now_millis();
        let (created, jobs) = {
            let mut state = self.inner.state.lock().unwrap();
            if let Some(existing) = state.jobs.iter().find(|job| {
                job.reference == reference
                    && matches!(
                        job.status,
                        PullJobStatus::Queued | PullJobStatus::Pulling | PullJobStatus::Cancelling
                    )
            }) {
                return Ok(existing.clone());
            }
            let sequence = self.inner.sequence.fetch_add(1, Ordering::Relaxed);
            let job = PullJob {
                id: format!("pull-{now}-{sequence}"),
                reference: reference.to_string(),
                status: PullJobStatus::Queued,
                current_bytes: 0,
                total_bytes: None,
                progress: None,
                bytes_per_second: None,
                started_at: None,
                created_at: now,
                updated_at: now,
                finished_at: None,
                message: Some("Queued".into()),
                error: None,
            };
            state.jobs.push(job.clone());
            (job, state.jobs.clone())
        };

        self.inner.sink.emit(&created);
        self.persist_nonfatal(&jobs);
        self.schedule();
        Ok(self
            .list()
            .into_iter()
            .find(|job| job.id == created.id)
            .unwrap_or(created))
    }

    pub fn list(&self) -> Vec<PullJob> {
        let mut jobs = self.inner.state.lock().unwrap().jobs.clone();
        jobs.sort_by_key(|job| Reverse(job.updated_at));
        jobs
    }

    pub fn cancel(&self, id: &str) -> Result<PullJob, String> {
        let now = now_millis();
        let (job, jobs, cancellation) = {
            let mut state = self.inner.state.lock().unwrap();
            let index = state
                .jobs
                .iter()
                .position(|job| job.id == id)
                .ok_or_else(|| format!("pull job {id} was not found"))?;
            let cancellation = match state.jobs[index].status {
                PullJobStatus::Queued => {
                    state.jobs[index].status = PullJobStatus::Cancelled;
                    state.jobs[index].updated_at = now;
                    state.jobs[index].finished_at = Some(now);
                    state.jobs[index].message = Some("Cancelled".into());
                    None
                }
                PullJobStatus::Pulling => {
                    state.jobs[index].status = PullJobStatus::Cancelling;
                    state.jobs[index].updated_at = now;
                    state.jobs[index].message = Some("Cancelling".into());
                    state.cancellations.get(id).cloned()
                }
                PullJobStatus::Cancelling => state.cancellations.get(id).cloned(),
                _ => None,
            };
            let job = state.jobs[index].clone();
            let jobs = state.jobs.clone();
            (job, jobs, cancellation)
        };

        self.inner.sink.emit(&job);
        self.persist_nonfatal(&jobs);
        if let Some(flag) = cancellation {
            flag.store(true, Ordering::SeqCst);
        }
        Ok(job)
    }

    pub fn clear_history(&self) -> Vec<PullJob> {
        let jobs = {
            let mut state = self.inner.state.lock().unwrap();
            state.jobs.retain(|job| !is_terminal(&job.status));
            state.jobs.clone()
        };
        self.persist_nonfatal(&jobs);
        jobs
    }

    pub fn shutdown(&self) {
        self.inner.shutting_down.store(true, Ordering::SeqCst);
        let now = now_millis();
        let (queued_cancelled, jobs) = {
            let mut state = self.inner.state.lock().unwrap();
            let mut queued_cancelled = Vec::new();
            for job in &mut state.jobs {
                if job.status == PullJobStatus::Queued {
                    job.status = PullJobStatus::Cancelled;
                    job.updated_at = now;
                    job.finished_at = Some(now);
                    job.message = Some("Cancelled".into());
                    queued_cancelled.push(job.clone());
                }
            }
            for flag in state.cancellations.values() {
                flag.store(true, Ordering::SeqCst);
            }
            (queued_cancelled, state.jobs.clone())
        };
        for job in queued_cancelled {
            self.inner.sink.emit(&job);
        }
        self.persist_nonfatal(&jobs);

        let deadline = Instant::now() + Duration::from_secs(5);
        let mut state = self.inner.state.lock().unwrap();
        while !state.running.is_empty() {
            let now = Instant::now();
            if now >= deadline {
                eprintln!("pull manager: timed out waiting for active pulls to stop");
                break;
            }
            let (next, timeout) = self
                .inner
                .changed
                .wait_timeout(state, deadline.saturating_duration_since(now))
                .unwrap();
            state = next;
            if timeout.timed_out() && !state.running.is_empty() {
                eprintln!("pull manager: timed out waiting for active pulls to stop");
                break;
            }
        }
    }

    fn persist_nonfatal(&self, jobs: &[PullJob]) {
        if let Err(error) = save_jobs(&self.inner.history_path, jobs) {
            eprintln!("pull history: {error}");
        }
    }

    fn schedule(&self) {
        if self.inner.shutting_down.load(Ordering::SeqCst) {
            return;
        }

        loop {
            let scheduled = {
                let mut state = self.inner.state.lock().unwrap();
                if self.inner.shutting_down.load(Ordering::SeqCst)
                    || state.running.len() >= self.inner.concurrency
                {
                    return;
                }
                let Some(index) = state
                    .jobs
                    .iter()
                    .position(|job| job.status == PullJobStatus::Queued)
                else {
                    return;
                };
                let now = now_millis();
                let id = state.jobs[index].id.clone();
                let cancellation = Arc::new(AtomicBool::new(false));
                state.jobs[index].status = PullJobStatus::Pulling;
                state.jobs[index].started_at = Some(now);
                state.jobs[index].updated_at = now;
                state.jobs[index].message = Some("Pulling".into());
                state.running.insert(id.clone());
                state.cancellations.insert(id.clone(), cancellation.clone());
                state.last_progress_persisted.insert(id.clone(), now);
                let job = state.jobs[index].clone();
                let jobs = state.jobs.clone();
                (job, jobs, cancellation)
            };

            let (job, jobs, cancellation) = scheduled;
            self.inner.sink.emit(&job);
            self.persist_nonfatal(&jobs);

            let manager = self.clone();
            std::thread::spawn(move || {
                let progress_manager = manager.clone();
                let job_id = job.id.clone();
                let on_progress: Arc<dyn Fn(ProgressUpdate) + Send + Sync> = Arc::new(move |update| {
                    progress_manager.apply_progress(&job_id, update);
                });
                let result = manager
                    .inner
                    .executor
                    .execute(&job.reference, cancellation, on_progress);
                manager.finish_execution(&job.id, result);
            });
        }
    }

    fn apply_progress(&self, id: &str, update: ProgressUpdate) {
        let now = now_millis();
        let (job, persist_jobs) = {
            let mut state = self.inner.state.lock().unwrap();
            let Some(index) = state.jobs.iter().position(|job| job.id == id) else {
                return;
            };
            if !matches!(state.jobs[index].status, PullJobStatus::Pulling | PullJobStatus::Cancelling) {
                return;
            }

            if let Some(current) = update.current_bytes {
                let previous = state.jobs[index].current_bytes;
                let previous_at = state.jobs[index].updated_at;
                if current >= previous && now > previous_at {
                    let delta_bytes = current - previous;
                    let delta_ms = now - previous_at;
                    state.jobs[index].bytes_per_second = Some(delta_bytes.saturating_mul(1000) / delta_ms);
                }
                state.jobs[index].current_bytes = current;
            }
            if let Some(total) = update.total_bytes {
                state.jobs[index].total_bytes = Some(total);
            }
            if let Some(progress) = update.progress {
                state.jobs[index].progress = Some(progress);
            }
            if let Some(message) = update.message {
                state.jobs[index].message = Some(message);
            }
            state.jobs[index].updated_at = now;
            let job = state.jobs[index].clone();

            let should_persist = state
                .last_progress_persisted
                .get(id)
                .map(|last| now.saturating_sub(*last) >= 1000)
                .unwrap_or(true);
            let persist_jobs = if should_persist {
                state.last_progress_persisted.insert(id.to_string(), now);
                Some(state.jobs.clone())
            } else {
                None
            };
            (job, persist_jobs)
        };

        self.inner.sink.emit(&job);
        if let Some(jobs) = persist_jobs {
            self.persist_nonfatal(&jobs);
        }
    }

    fn finish_execution(&self, id: &str, result: Result<PullExecution, String>) {
        let now = now_millis();
        let (job, jobs) = {
            let mut state = self.inner.state.lock().unwrap();
            let Some(index) = state.jobs.iter().position(|job| job.id == id) else {
                state.running.remove(id);
                state.cancellations.remove(id);
                state.last_progress_persisted.remove(id);
                self.inner.changed.notify_all();
                return;
            };
            let was_cancelling = state.jobs[index].status == PullJobStatus::Cancelling;
            match result {
                Ok(PullExecution::Completed) => {
                    if was_cancelling {
                        state.jobs[index].status = PullJobStatus::Cancelled;
                        state.jobs[index].message = Some("Cancelled".into());
                    } else {
                        state.jobs[index].status = PullJobStatus::Completed;
                        state.jobs[index].message = Some("Completed".into());
                    }
                    state.jobs[index].error = None;
                }
                Ok(PullExecution::Cancelled) => {
                    state.jobs[index].status = PullJobStatus::Cancelled;
                    state.jobs[index].message = Some("Cancelled".into());
                    state.jobs[index].error = None;
                }
                Err(error) => {
                    if was_cancelling {
                        state.jobs[index].status = PullJobStatus::Cancelled;
                        state.jobs[index].message = Some("Cancelled".into());
                        state.jobs[index].error = None;
                    } else {
                        state.jobs[index].status = PullJobStatus::Failed;
                        state.jobs[index].message = Some("Failed".into());
                        state.jobs[index].error = Some(error);
                    }
                }
            }
            state.jobs[index].updated_at = now;
            state.jobs[index].finished_at = Some(now);
            let job = state.jobs[index].clone();
            state.running.remove(id);
            state.cancellations.remove(id);
            state.last_progress_persisted.remove(id);
            state.jobs = prune_history(std::mem::take(&mut state.jobs));
            let jobs = state.jobs.clone();
            self.inner.changed.notify_all();
            (job, jobs)
        };

        self.persist_nonfatal(&jobs);
        self.inner.sink.emit(&job);
        if !self.inner.shutting_down.load(Ordering::SeqCst) {
            self.schedule();
        }
    }
}

fn spawn_output_reader<R: Read + Send + 'static>(
    mut reader: R,
    on_progress: Arc<dyn Fn(ProgressUpdate) + Send + Sync>,
    stderr_fragments: Option<Arc<Mutex<Vec<String>>>>,
) -> std::thread::JoinHandle<()> {
    std::thread::spawn(move || {
        let mut chunk = [0_u8; 2048];
        let mut fragment = Vec::new();
        let flush = |fragment: &mut Vec<u8>| {
            if fragment.is_empty() {
                return;
            }
            let text = String::from_utf8_lossy(fragment).trim().to_string();
            fragment.clear();
            if text.is_empty() {
                return;
            }
            if let Some(lines) = stderr_fragments.as_ref() {
                let mut lines = lines.lock().unwrap();
                lines.push(text.clone());
                if lines.len() > 20 {
                    let remove = lines.len() - 20;
                    lines.drain(0..remove);
                }
            }
            on_progress(parse_progress_fragment(&text));
        };

        loop {
            match reader.read(&mut chunk) {
                Ok(0) => break,
                Ok(count) => {
                    for byte in &chunk[..count] {
                        if *byte == b'\n' || *byte == b'\r' {
                            flush(&mut fragment);
                        } else {
                            fragment.push(*byte);
                        }
                    }
                }
                Err(_) => break,
            }
        }
        flush(&mut fragment);
    })
}

impl PullExecutor for SystemPullExecutor {
    fn execute(
        &self,
        reference: &str,
        cancelled: Arc<AtomicBool>,
        on_progress: Arc<dyn Fn(ProgressUpdate) + Send + Sync>,
    ) -> Result<PullExecution, String> {
        let mut command = Command::new("wslc");
        command
            .args(["pull", reference])
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x0800_0000);
        }

        let mut child = command
            .spawn()
            .map_err(|e| format!("could not start wslc pull {reference}: {e}"))?;
        let stdout = child.stdout.take().ok_or_else(|| "could not capture wslc pull stdout".to_string())?;
        let stderr = child.stderr.take().ok_or_else(|| "could not capture wslc pull stderr".to_string())?;
        let stderr_fragments = Arc::new(Mutex::new(Vec::new()));
        let stdout_reader = spawn_output_reader(stdout, on_progress.clone(), None);
        let stderr_reader = spawn_output_reader(stderr, on_progress, Some(stderr_fragments.clone()));

        let status = loop {
            if cancelled.load(Ordering::SeqCst) {
                #[cfg(windows)]
                {
                    let pid = child.id().to_string();
                    let mut kill = Command::new("taskkill");
                    kill.args(["/PID", &pid, "/T", "/F"])
                        .stdin(Stdio::null())
                        .stdout(Stdio::null())
                        .stderr(Stdio::null());
                    use std::os::windows::process::CommandExt;
                    kill.creation_flags(0x0800_0000);
                    let _ = kill.status();
                }
                let _ = child.kill();
                let _ = child.wait();
                let _ = stdout_reader.join();
                let _ = stderr_reader.join();
                return Ok(PullExecution::Cancelled);
            }
            match child.try_wait() {
                Ok(Some(status)) => break status,
                Ok(None) => std::thread::sleep(Duration::from_millis(50)),
                Err(error) => {
                    let _ = child.kill();
                    let _ = child.wait();
                    let _ = stdout_reader.join();
                    let _ = stderr_reader.join();
                    return Err(format!("could not wait for wslc pull {reference}: {error}"));
                }
            }
        };

        let _ = stdout_reader.join();
        let _ = stderr_reader.join();
        if status.success() {
            return Ok(PullExecution::Completed);
        }
        let summary = stderr_fragments.lock().unwrap().join(" | ");
        if summary.is_empty() {
            Err(format!("wslc pull {reference} exited with {status}"))
        } else {
            Err(format!("wslc pull {reference} failed: {summary}"))
        }
    }
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
