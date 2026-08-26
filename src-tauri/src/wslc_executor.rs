use std::collections::{HashMap, HashSet};
use std::io::Read;
use std::process::{Command, Stdio};
use std::sync::{
    atomic::{AtomicBool, AtomicUsize, Ordering},
    Arc, Condvar, Mutex,
};
use std::thread;
use std::time::{Duration, Instant};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Lane {
    Query,
    Mutation,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CommandPolicy {
    pub lane: Lane,
    pub timeout: Duration,
}

pub fn classify(args: &[String]) -> CommandPolicy {
    let first = args.first().map(String::as_str).unwrap_or("");
    let second = args.get(1).map(String::as_str).unwrap_or("");
    let lane = match (first, second) {
        ("version", _) => Lane::Query,
        ("container", "list" | "logs" | "inspect") => Lane::Query,
        ("image", "list" | "inspect") => Lane::Query,
        ("volume", "list" | "inspect") => Lane::Query,
        ("network", "list" | "inspect") => Lane::Query,
        _ => Lane::Mutation,
    };
    let timeout = if first == "pull" || (first == "image" && second == "pull") {
        Duration::from_secs(600)
    } else if lane == Lane::Query {
        Duration::from_secs(15)
    } else {
        Duration::from_secs(60)
    };
    CommandPolicy { lane, timeout }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CliResult {
    pub ok: bool,
    pub output: String,
    pub error: String,
    pub exit_code: i32,
}

pub trait ProcessRunner: Send + Sync + 'static {
    fn run(&self, args: &[String], timeout: Duration) -> Result<CliResult, String>;
}

#[derive(Default)]
pub struct SystemProcessRunner;

impl ProcessRunner for SystemProcessRunner {
    fn run(&self, args: &[String], timeout: Duration) -> Result<CliResult, String> {
        let mut command = Command::new("wslc");
        command
            .args(args)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);

        let mut child = command
            .spawn()
            .map_err(|e| format!("failed to execute wslc {}: {e}", args.join(" ")))?;

        let stdout_reader = child.stdout.take().map(|mut pipe| {
            thread::spawn(move || -> Result<String, String> {
                let mut bytes = Vec::new();
                pipe.read_to_end(&mut bytes)
                    .map_err(|e| format!("could not read wslc stdout: {e}"))?;
                Ok(String::from_utf8_lossy(&bytes).into_owned())
            })
        });
        let stderr_reader = child.stderr.take().map(|mut pipe| {
            thread::spawn(move || -> Result<String, String> {
                let mut bytes = Vec::new();
                pipe.read_to_end(&mut bytes)
                    .map_err(|e| format!("could not read wslc stderr: {e}"))?;
                Ok(String::from_utf8_lossy(&bytes).into_owned())
            })
        });

        let deadline = Instant::now() + timeout;
        loop {
            if let Some(status) = child
                .try_wait()
                .map_err(|e| format!("could not wait for wslc {}: {e}", args.join(" ")))?
            {
                let output = join_reader(stdout_reader, "stdout")?;
                let error = join_reader(stderr_reader, "stderr")?;
                return Ok(CliResult {
                    ok: status.success(),
                    output: output.trim().to_string(),
                    error: error.trim().to_string(),
                    exit_code: status.code().unwrap_or(-1),
                });
            }
            if Instant::now() >= deadline {
                let _ = child.kill();
                let _ = child.wait();
                let _ = join_reader(stdout_reader, "stdout");
                let _ = join_reader(stderr_reader, "stderr");
                return Err(format!(
                    "wslc {} timed out after {}s",
                    args.join(" "),
                    timeout.as_secs()
                ));
            }
            thread::sleep(Duration::from_millis(25));
        }
    }
}

fn join_reader(
    reader: Option<thread::JoinHandle<Result<String, String>>>,
    name: &str,
) -> Result<String, String> {
    match reader {
        Some(reader) => reader
            .join()
            .map_err(|_| format!("wslc {name} reader panicked"))?,
        None => Ok(String::new()),
    }
}

struct QueryLimiter {
    active: Mutex<usize>,
    changed: Condvar,
    limit: usize,
}

impl QueryLimiter {
    fn new(limit: usize) -> Self {
        Self {
            active: Mutex::new(0),
            changed: Condvar::new(),
            limit: limit.max(1),
        }
    }

    fn acquire(&self) -> Result<QueryPermit<'_>, String> {
        let mut active = self
            .active
            .lock()
            .map_err(|_| "query lane poisoned".to_string())?;
        while *active >= self.limit {
            active = self
                .changed
                .wait(active)
                .map_err(|_| "query lane poisoned".to_string())?;
        }
        *active += 1;
        Ok(QueryPermit { limiter: self })
    }
}

struct QueryPermit<'a> {
    limiter: &'a QueryLimiter,
}

impl Drop for QueryPermit<'_> {
    fn drop(&mut self) {
        if let Ok(mut active) = self.limiter.active.lock() {
            *active = active.saturating_sub(1);
            self.limiter.changed.notify_one();
        }
    }
}

type SharedResult = Result<CliResult, String>;

struct InFlight {
    result: Mutex<Option<SharedResult>>,
    ready: Condvar,
}

impl InFlight {
    fn new() -> Self {
        Self {
            result: Mutex::new(None),
            ready: Condvar::new(),
        }
    }

    fn complete(&self, result: SharedResult) {
        if let Ok(mut slot) = self.result.lock() {
            *slot = Some(result);
            self.ready.notify_all();
        }
    }

    fn wait(&self) -> SharedResult {
        let mut slot = self
            .result
            .lock()
            .map_err(|_| "query result poisoned".to_string())?;
        while slot.is_none() {
            slot = self
                .ready
                .wait(slot)
                .map_err(|_| "query result poisoned".to_string())?;
        }
        slot.clone()
            .ok_or_else(|| "query result disappeared".to_string())?
    }
}

struct ExecutorInner {
    runner: Arc<dyn ProcessRunner>,
    mutation: Mutex<()>,
    queries: QueryLimiter,
    in_flight: Mutex<HashMap<String, Arc<InFlight>>>,
    accepting: AtomicBool,
}

#[derive(Clone)]
pub struct WslcExecutor {
    inner: Arc<ExecutorInner>,
}

impl WslcExecutor {
    pub fn new() -> Self {
        Self::with_runner(Arc::new(SystemProcessRunner), 4)
    }

    pub fn with_runner(runner: Arc<dyn ProcessRunner>, query_limit: usize) -> Self {
        Self {
            inner: Arc::new(ExecutorInner {
                runner,
                mutation: Mutex::new(()),
                queries: QueryLimiter::new(query_limit),
                in_flight: Mutex::new(HashMap::new()),
                accepting: AtomicBool::new(true),
            }),
        }
    }

    pub fn execute(&self, args: Vec<String>) -> Result<CliResult, String> {
        if !self.inner.accepting.load(Ordering::SeqCst) {
            return Err("WSLC executor is shutting down".into());
        }
        let policy = classify(&args);
        match policy.lane {
            Lane::Mutation => self.execute_mutation(&args, policy.timeout),
            Lane::Query => self.execute_query(args, policy.timeout),
        }
    }

    fn execute_mutation(&self, args: &[String], timeout: Duration) -> Result<CliResult, String> {
        let _guard = self
            .inner
            .mutation
            .lock()
            .map_err(|_| "mutation lane poisoned".to_string())?;
        if !self.inner.accepting.load(Ordering::SeqCst) {
            return Err("WSLC executor is shutting down".into());
        }
        self.inner.runner.run(args, timeout)
    }

    fn execute_query(&self, args: Vec<String>, timeout: Duration) -> Result<CliResult, String> {
        let key = query_key(&args);
        let (entry, leader) = {
            let mut map = self
                .inner
                .in_flight
                .lock()
                .map_err(|_| "query deduplication state poisoned".to_string())?;
            if let Some(existing) = map.get(&key) {
                (existing.clone(), false)
            } else {
                let entry = Arc::new(InFlight::new());
                map.insert(key.clone(), entry.clone());
                (entry, true)
            }
        };

        if !leader {
            return entry.wait();
        }

        let result = (|| {
            let _permit = self.inner.queries.acquire()?;
            if !self.inner.accepting.load(Ordering::SeqCst) {
                return Err("WSLC executor is shutting down".into());
            }
            self.inner.runner.run(&args, timeout)
        })();

        entry.complete(result.clone());
        if let Ok(mut map) = self.inner.in_flight.lock() {
            if map.get(&key).is_some_and(|current| Arc::ptr_eq(current, &entry)) {
                map.remove(&key);
            }
        }
        result
    }

    pub fn ensure_network(&self, name: &str) -> Result<CliResult, String> {
        if !self.inner.accepting.load(Ordering::SeqCst) {
            return Err("WSLC executor is shutting down".into());
        }
        let _guard = self
            .inner
            .mutation
            .lock()
            .map_err(|_| "mutation lane poisoned".to_string())?;
        let list_args = vec!["network".into(), "list".into()];
        let listed = self.inner.runner.run(&list_args, Duration::from_secs(60))?;
        if !listed.ok {
            return Ok(listed);
        }
        if listed.output.lines().any(|line| {
            line.split_whitespace()
                .any(|part| part.eq_ignore_ascii_case(name))
        }) {
            return Ok(listed);
        }
        let create_args = vec!["network".into(), "create".into(), name.into()];
        self.inner
            .runner
            .run(&create_args, Duration::from_secs(60))
    }

    pub fn shutdown(&self) {
        self.inner.accepting.store(false, Ordering::SeqCst);
        self.inner.queries.changed.notify_all();
    }
}

impl Default for WslcExecutor {
    fn default() -> Self {
        Self::new()
    }
}

fn query_key(args: &[String]) -> String {
    args.iter()
        .map(|arg| arg.trim())
        .collect::<Vec<_>>()
        .join("\u{1f}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::AtomicUsize;

    fn strings(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| (*value).to_string()).collect()
    }

    struct MockState {
        active_queries: AtomicUsize,
        active_mutations: AtomicUsize,
        max_queries: AtomicUsize,
        max_mutations: AtomicUsize,
        counts: Mutex<HashMap<String, usize>>,
        blocked: Mutex<HashSet<String>>,
        started: Mutex<HashSet<String>>,
        changed: Condvar,
        delay_ms: AtomicUsize,
        timeouts: Mutex<HashSet<String>>,
    }

    struct MockRunner {
        state: Arc<MockState>,
    }

    impl MockRunner {
        fn new() -> Self {
            Self {
                state: Arc::new(MockState {
                    active_queries: AtomicUsize::new(0),
                    active_mutations: AtomicUsize::new(0),
                    max_queries: AtomicUsize::new(0),
                    max_mutations: AtomicUsize::new(0),
                    counts: Mutex::new(HashMap::new()),
                    blocked: Mutex::new(HashSet::new()),
                    started: Mutex::new(HashSet::new()),
                    changed: Condvar::new(),
                    delay_ms: AtomicUsize::new(0),
                    timeouts: Mutex::new(HashSet::new()),
                }),
            }
        }

        fn block_command(&self, args: Vec<&str>) {
            self.state
                .blocked
                .lock()
                .unwrap()
                .insert(args.join(" "));
        }

        fn release(&self, command: &str) {
            self.state.blocked.lock().unwrap().remove(command);
            self.state.changed.notify_all();
        }

        fn wait_until_started(&self, command: &str) {
            let mut started = self.state.started.lock().unwrap();
            while !started.contains(command) {
                started = self.state.changed.wait(started).unwrap();
            }
        }

        fn delay_all(&self, duration: Duration) {
            self.state
                .delay_ms
                .store(duration.as_millis() as usize, Ordering::SeqCst);
        }

        fn timeout_command(&self, args: Vec<&str>) {
            self.state
                .timeouts
                .lock()
                .unwrap()
                .insert(args.join(" "));
        }

        fn clear_timeout(&self, command: &str) {
            self.state.timeouts.lock().unwrap().remove(command);
        }

        fn execution_count(&self, command: &str) -> usize {
            *self
                .state
                .counts
                .lock()
                .unwrap()
                .get(command)
                .unwrap_or(&0)
        }

        fn max_query_concurrency(&self) -> usize {
            self.state.max_queries.load(Ordering::SeqCst)
        }

        fn max_mutation_concurrency(&self) -> usize {
            self.state.max_mutations.load(Ordering::SeqCst)
        }
    }

    fn update_max(maximum: &AtomicUsize, value: usize) {
        let mut current = maximum.load(Ordering::SeqCst);
        while value > current {
            match maximum.compare_exchange(current, value, Ordering::SeqCst, Ordering::SeqCst) {
                Ok(_) => break,
                Err(actual) => current = actual,
            }
        }
    }

    impl ProcessRunner for MockRunner {
        fn run(&self, args: &[String], _timeout: Duration) -> Result<CliResult, String> {
            let command = args.join(" ");
            {
                let mut counts = self.state.counts.lock().unwrap();
                *counts.entry(command.clone()).or_default() += 1;
            }
            {
                self.state.started.lock().unwrap().insert(command.clone());
                self.state.changed.notify_all();
            }

            let lane = classify(args).lane;
            let active = match lane {
                Lane::Query => self.state.active_queries.fetch_add(1, Ordering::SeqCst) + 1,
                Lane::Mutation => self.state.active_mutations.fetch_add(1, Ordering::SeqCst) + 1,
            };
            match lane {
                Lane::Query => update_max(&self.state.max_queries, active),
                Lane::Mutation => update_max(&self.state.max_mutations, active),
            }

            let timeout = self.state.timeouts.lock().unwrap().contains(&command);
            if timeout {
                match lane {
                    Lane::Query => { self.state.active_queries.fetch_sub(1, Ordering::SeqCst); }
                    Lane::Mutation => { self.state.active_mutations.fetch_sub(1, Ordering::SeqCst); }
                }
                return Err(format!("{command} timed out"));
            }

            {
                let mut blocked = self.state.blocked.lock().unwrap();
                while blocked.contains(&command) {
                    blocked = self.state.changed.wait(blocked).unwrap();
                }
            }

            let delay = self.state.delay_ms.load(Ordering::SeqCst);
            if delay > 0 {
                thread::sleep(Duration::from_millis(delay as u64));
            }

            match lane {
                Lane::Query => { self.state.active_queries.fetch_sub(1, Ordering::SeqCst); }
                Lane::Mutation => { self.state.active_mutations.fetch_sub(1, Ordering::SeqCst); }
            }

            Ok(CliResult {
                ok: true,
                output: command,
                error: String::new(),
                exit_code: 0,
            })
        }
    }

    fn spawn_execute(
        executor: WslcExecutor,
        args: Vec<String>,
    ) -> thread::JoinHandle<Result<CliResult, String>> {
        thread::spawn(move || executor.execute(args))
    }

    #[test]
    fn known_reads_use_query_lane() {
        for args in [
            strings(&["container", "list"]),
            strings(&["image", "list"]),
            strings(&["volume", "list"]),
            strings(&["container", "logs", "demo"]),
            strings(&["version"]),
        ] {
            assert_eq!(classify(&args).lane, Lane::Query);
        }
    }

    #[test]
    fn mutations_and_unknowns_are_serialized() {
        for args in [
            strings(&["container", "run"]),
            strings(&["container", "start"]),
            strings(&["container", "stop"]),
            strings(&["image", "rm"]),
            strings(&["volume", "create"]),
            strings(&["mystery", "command"]),
        ] {
            assert_eq!(classify(&args).lane, Lane::Mutation);
        }
    }

    #[test]
    fn timeout_policy_matches_spec() {
        assert_eq!(classify(&strings(&["container", "list"])).timeout, Duration::from_secs(15));
        assert_eq!(classify(&strings(&["container", "start", "demo"])).timeout, Duration::from_secs(60));
        assert_eq!(classify(&strings(&["image", "pull", "ubuntu:24.04"])).timeout, Duration::from_secs(600));
        assert_eq!(classify(&strings(&["pull", "ubuntu:24.04"])).timeout, Duration::from_secs(600));
    }

    #[test]
    fn slow_mutation_does_not_block_query() {
        let runner = Arc::new(MockRunner::new());
        runner.block_command(vec!["container", "start", "slow"]);
        let executor = WslcExecutor::with_runner(runner.clone(), 4);
        let mutation = spawn_execute(executor.clone(), strings(&["container", "start", "slow"]));
        runner.wait_until_started("container start slow");
        assert!(executor.execute(strings(&["container", "list"])).is_ok());
        runner.release("container start slow");
        mutation.join().unwrap().unwrap();
    }

    #[test]
    fn mutations_never_overlap() {
        let runner = Arc::new(MockRunner::new());
        runner.delay_all(Duration::from_millis(40));
        let executor = WslcExecutor::with_runner(runner.clone(), 4);
        let a = spawn_execute(executor.clone(), strings(&["container", "start", "a"]));
        let b = spawn_execute(executor.clone(), strings(&["container", "stop", "b"]));
        a.join().unwrap().unwrap();
        b.join().unwrap().unwrap();
        assert_eq!(runner.max_mutation_concurrency(), 1);
    }

    #[test]
    fn query_concurrency_is_bounded_to_four() {
        let runner = Arc::new(MockRunner::new());
        runner.delay_all(Duration::from_millis(40));
        let executor = WslcExecutor::with_runner(runner.clone(), 4);
        let joins = (0..12)
            .map(|index| spawn_execute(executor.clone(), strings(&["container", "logs", &format!("c{index}")])))
            .collect::<Vec<_>>();
        for join in joins {
            join.join().unwrap().unwrap();
        }
        assert!(runner.max_query_concurrency() <= 4);
        assert!(runner.max_query_concurrency() >= 2);
    }

    #[test]
    fn identical_queries_share_one_inflight_execution() {
        let runner = Arc::new(MockRunner::new());
        runner.delay_all(Duration::from_millis(80));
        let executor = WslcExecutor::with_runner(runner.clone(), 4);
        let a = spawn_execute(executor.clone(), strings(&["container", "list"]));
        let b = spawn_execute(executor.clone(), strings(&["container", "list"]));
        a.join().unwrap().unwrap();
        b.join().unwrap().unwrap();
        assert_eq!(runner.execution_count("container list"), 1);
    }

    #[test]
    fn timed_out_query_releases_capacity() {
        let runner = Arc::new(MockRunner::new());
        runner.timeout_command(vec!["container", "list"]);
        let executor = WslcExecutor::with_runner(runner.clone(), 1);
        assert!(executor.execute(strings(&["container", "list"])).is_err());
        runner.clear_timeout("container list");
        assert!(executor.execute(strings(&["image", "list"])).is_ok());
    }

    #[test]
    fn timeout_releases_mutation_lane() {
        let runner = Arc::new(MockRunner::new());
        runner.timeout_command(vec!["container", "start", "a"]);
        let executor = WslcExecutor::with_runner(runner.clone(), 4);
        assert!(executor.execute(strings(&["container", "start", "a"])).is_err());
        runner.clear_timeout("container start a");
        assert!(executor.execute(strings(&["container", "stop", "b"])).is_ok());
    }

    #[test]
    fn shutdown_rejects_new_work() {
        let executor = WslcExecutor::with_runner(Arc::new(MockRunner::new()), 4);
        executor.shutdown();
        let err = executor.execute(strings(&["container", "list"])).unwrap_err();
        assert!(err.contains("shutting down"));
    }
}
