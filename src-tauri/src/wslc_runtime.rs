#![cfg(windows)]

use crate::storage::Storage;
use crate::wslc_executor::{CliResult, WslcExecutor};
use serde_json::{json, Value};
use std::mem::size_of;
use std::sync::{Arc, Mutex};
use std::thread;

#[derive(Default)]
pub struct HostSampler {
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

pub fn invoke(
    executor: &WslcExecutor,
    host: &Arc<Mutex<HostSampler>>,
    storage: Option<&Storage>,
    root: Value,
) -> Result<Value, String> {
    let cmd = root.get("cmd").and_then(Value::as_str).ok_or("missing cmd")?;
    match cmd {
        "health" => {
            let args = vec!["version".into()];
            let result = crate::wslc_audit::execute_with_audit(storage, &args, || executor.execute(args.clone()))?;
            Ok(json!({"ok": result.ok, "wslc": result.ok, "session": "default", "output": result.output, "error": result.error, "exitCode": result.exit_code, "command": "wslc version"}))
        }
        "host_stats" => host
            .lock()
            .map_err(|_| "host sampler poisoned".to_string())?
            .sample(),
        "run_cli" => {
            let args = root.get("args").and_then(Value::as_array).ok_or("missing args")?.iter()
                .map(|x| x.as_str().map(str::to_string).ok_or("args must be strings"))
                .collect::<Result<Vec<_>, _>>()?;
            let result = crate::wslc_audit::execute_with_audit(storage, &args, || executor.execute(args.clone()))?;
            Ok(result_json(result, &args))
        }
        "ensure_network" => {
            let name = root.get("name").and_then(Value::as_str).filter(|x| !x.trim().is_empty()).ok_or("missing network name")?;
            let args = vec!["network".into(), "ensure".into(), name.to_string()];
            let result = crate::wslc_audit::execute_with_audit(storage, &args, || executor.ensure_network(name))?;
            Ok(json!({"ok": result.ok, "output": result.output, "error": result.error, "exitCode": result.exit_code, "network": name}))
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

fn result_json(result: CliResult, args: &[String]) -> Value {
    json!({"ok": result.ok, "output": result.output, "error": result.error, "exitCode": result.exit_code, "command": format!("wslc {}", args.join(" "))})
}
