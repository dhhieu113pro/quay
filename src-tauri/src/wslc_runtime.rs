#![cfg(windows)]

use serde_json::{json, Value};
use std::mem::size_of;
use std::process::{Command, Stdio};
use std::sync::mpsc::{self, Receiver, Sender};
use std::thread;

#[derive(Clone)]
pub struct CliWorker {
    tx: Sender<Request>,
}

struct Request {
    payload: Value,
    reply: Sender<Result<Value, String>>,
}

#[derive(Default)]
struct HostSampler {
    previous_cpu: Option<(u64, u64, u64)>,
}

#[repr(C)]
struct FileTime { low: u32, high: u32 }

#[repr(C)]
struct MemoryStatusEx {
    length: u32, memory_load: u32, total_phys: u64, avail_phys: u64,
    total_page_file: u64, avail_page_file: u64, total_virtual: u64,
    avail_virtual: u64, avail_extended_virtual: u64,
}

#[link(name = "kernel32")]
extern "system" {
    fn GetSystemTimes(idle: *mut FileTime, kernel: *mut FileTime, user: *mut FileTime) -> i32;
    fn GlobalMemoryStatusEx(status: *mut MemoryStatusEx) -> i32;
}

impl CliWorker {
    pub fn spawn() -> Self {
        let (tx, rx) = mpsc::channel::<Request>();
        thread::Builder::new().name("quay-wslc-cli".into()).spawn(move || worker_loop(rx)).expect("spawn Quay WSLC CLI worker");
        Self { tx }
    }

    pub fn invoke(&self, payload: Value) -> Result<Value, String> {
        let (reply_tx, reply_rx) = mpsc::channel();
        self.tx.send(Request { payload, reply: reply_tx }).map_err(|e| e.to_string())?;
        reply_rx.recv().map_err(|e| e.to_string())?
    }
}

fn worker_loop(rx: Receiver<Request>) {
    let mut host = HostSampler::default();
    for request in rx {
        let result = handle(&request.payload, &mut host);
        let _ = request.reply.send(result);
    }
}

fn handle(root: &Value, host: &mut HostSampler) -> Result<Value, String> {
    let cmd = root.get("cmd").and_then(Value::as_str).ok_or("missing cmd")?;
    match cmd {
        "health" => {
            let result = run_wslc(&["version".into()])?;
            Ok(json!({"ok": result.ok, "wslc": result.ok, "session": "default", "output": result.output, "error": result.error, "exitCode": result.exit_code}))
        }
        "host_stats" => host.sample(),
        "run_cli" => {
            let args = root.get("args").and_then(Value::as_array).ok_or("missing args")?.iter()
                .map(|x| x.as_str().map(str::to_string).ok_or("args must be strings"))
                .collect::<Result<Vec<_>, _>>()?;
            let result = run_wslc(&args)?;
            Ok(result_json(result, &args))
        }
        "ensure_network" => {
            let name = root.get("name").and_then(Value::as_str).filter(|x| !x.trim().is_empty()).ok_or("missing network name")?;
            let list_args = vec!["network".into(), "list".into()];
            let listed = run_wslc(&list_args)?;
            if !listed.ok { return Ok(result_json(listed, &list_args)); }
            if listed.output.lines().any(|line| line.split_whitespace().any(|part| part.eq_ignore_ascii_case(name))) {
                return Ok(json!({"ok": true, "output": listed.output, "network": name}));
            }
            let create_args = vec!["network".into(), "create".into(), name.into()];
            let created = run_wslc(&create_args)?;
            Ok(result_json(created, &create_args))
        }
        _ => Err(format!("unknown command '{cmd}'")),
    }
}

impl HostSampler {
    fn sample(&mut self) -> Result<Value, String> {
        let (idle, kernel, user) = system_times()?;
        let cpu_percent = self.previous_cpu.map_or(0.0, |(old_idle, old_kernel, old_user)| {
            let idle_delta = idle.saturating_sub(old_idle) as f64;
            let kernel_delta = kernel.saturating_sub(old_kernel) as f64;
            let user_delta = user.saturating_sub(old_user) as f64;
            let total = kernel_delta + user_delta;
            if total <= 0.0 { 0.0 } else { ((total - idle_delta) / total * 100.0).clamp(0.0, 100.0) }
        });
        self.previous_cpu = Some((idle, kernel, user));
        let (total_memory, available_memory, memory_load) = memory_status()?;
        let used_memory = total_memory.saturating_sub(available_memory);
        let mib = 1024.0 * 1024.0;
        let cpu_count = thread::available_parallelism().map(|value| value.get()).unwrap_or(0);
        Ok(json!({"ok": true, "cpuCount": cpu_count, "cpuPercent": cpu_percent, "memoryPercent": memory_load, "memoryTotalMB": total_memory as f64 / mib, "memoryUsedMB": used_memory as f64 / mib}))
    }
}

fn file_time_value(value: FileTime) -> u64 { ((value.high as u64) << 32) | value.low as u64 }

fn system_times() -> Result<(u64, u64, u64), String> {
    let mut idle = FileTime { low: 0, high: 0 };
    let mut kernel = FileTime { low: 0, high: 0 };
    let mut user = FileTime { low: 0, high: 0 };
    let ok = unsafe { GetSystemTimes(&mut idle, &mut kernel, &mut user) };
    if ok == 0 { return Err("GetSystemTimes failed".into()); }
    Ok((file_time_value(idle), file_time_value(kernel), file_time_value(user)))
}

fn memory_status() -> Result<(u64, u64, u32), String> {
    let mut status = MemoryStatusEx { length: size_of::<MemoryStatusEx>() as u32, memory_load: 0, total_phys: 0, avail_phys: 0, total_page_file: 0, avail_page_file: 0, total_virtual: 0, avail_virtual: 0, avail_extended_virtual: 0 };
    let ok = unsafe { GlobalMemoryStatusEx(&mut status) };
    if ok == 0 { return Err("GlobalMemoryStatusEx failed".into()); }
    Ok((status.total_phys, status.avail_phys, status.memory_load))
}

struct CliResult { ok: bool, output: String, error: String, exit_code: i32 }

fn run_wslc(args: &[String]) -> Result<CliResult, String> {
    let mut command = Command::new("wslc");
    command.args(args).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    command.creation_flags(CREATE_NO_WINDOW);
    let output = command.output().map_err(|e| format!("failed to execute wslc: {e}"))?;
    Ok(CliResult { ok: output.status.success(), output: String::from_utf8_lossy(&output.stdout).trim().to_string(), error: String::from_utf8_lossy(&output.stderr).trim().to_string(), exit_code: output.status.code().unwrap_or(-1) })
}

fn result_json(result: CliResult, args: &[String]) -> Value {
    json!({"ok": result.ok, "output": result.output, "error": result.error, "exitCode": result.exit_code, "command": format!("wslc {}", args.join(" "))})
}
