//! Thin Tauri bridge. Each UI action is JSON over stdin to `quay-host.exe`,
//! which calls `Microsoft.WSL.Containers`.

use serde_json::Value;
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{ChildStdin, ChildStdout, Command, Stdio};
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};

pub struct Sidecar {
    stdin: Mutex<Option<ChildStdin>>,
    stdout: Mutex<Option<BufReader<ChildStdout>>>,
}

impl Sidecar {
    fn empty() -> Self {
        Self {
            stdin: Mutex::new(None),
            stdout: Mutex::new(None),
        }
    }

    fn spawn(bin: PathBuf) -> Result<Self, String> {
        let mut cmd = Command::new(&bin);
        cmd.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }
        let mut child = cmd
            .spawn()
            .map_err(|e| format!("spawn {}: {e}", bin.display()))?;
        Ok(Self {
            stdin: Mutex::new(child.stdin.take()),
            stdout: Mutex::new(child.stdout.take().map(BufReader::new)),
        })
    }
}

fn host_binary(app: &AppHandle) -> PathBuf {
    #[cfg(debug_assertions)]
    {
        let mut dev = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        dev.pop();
        dev.push("host");
        dev.push("publish");
        dev.push("quay-host.exe");
        if dev.exists() {
            return dev;
        }
        dev.set_file_name("quay-host");
        if dev.exists() {
            return dev;
        }
    }

    let exe_dir = app
        .path()
        .executable_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    let win = exe_dir.join("quay-host.exe");
    if win.exists() {
        return win;
    }
    exe_dir.join("quay-host")
}

#[tauri::command]
fn wslc_invoke(sidecar: State<Sidecar>, payload: Value) -> Result<Value, String> {
    let line = serde_json::to_string(&payload).map_err(|e| e.to_string())?;
    {
        let mut stdin = sidecar.stdin.lock().map_err(|e| e.to_string())?;
        let stdin = stdin.as_mut().ok_or("C# sidecar is not running")?;
        writeln!(stdin, "{line}").map_err(|e| e.to_string())?;
        stdin.flush().map_err(|e| e.to_string())?;
    }
    let mut reply = String::new();
    sidecar
        .stdout
        .lock()
        .map_err(|e| e.to_string())?
        .as_mut()
        .ok_or("C# sidecar is not running")?
        .read_line(&mut reply)
        .map_err(|e| e.to_string())?;
    serde_json::from_str(reply.trim()).map_err(|e| e.to_string())
}

#[tauri::command]
fn sidecar_up(sidecar: State<Sidecar>) -> bool {
    sidecar.stdin.lock().ok().is_some_and(|g| g.is_some())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let bin = host_binary(app.handle());
            let sidecar = match Sidecar::spawn(bin) {
                Ok(s) => s,
                Err(err) => {
                    eprintln!("quay-host: {err}");
                    Sidecar::empty()
                }
            };
            app.manage(sidecar);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![wslc_invoke, sidecar_up])
        .run(tauri::generate_context!())
        .expect("error while running Quay");
}
