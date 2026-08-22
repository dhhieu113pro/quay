// Thin Tauri bridge. Each UI action is JSON over stdin to quay-host.exe
// which calls Microsoft.WSL.Containers.

use serde_json::Value;
use std::io::{BufRead, BufReader, Write};
use std::process::{Command, Stdio};
use std::sync::Mutex;
use tauri::State;

pub struct Sidecar {
    stdin: Mutex<std::process::ChildStdin>,
    stdout: Mutex<BufReader<std::process::ChildStdout>>,
}

impl Sidecar {
    pub fn spawn() -> Result<Self, String> {
        let mut child = Command::new("quay-host")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(Self {
            stdin: Mutex::new(child.stdin.take().ok_or("no stdin")?),
            stdout: Mutex::new(BufReader::new(child.stdout.take().ok_or("no stdout")?)),
        })
    }
}

#[tauri::command]
fn wslc_invoke(sidecar: State<Sidecar>, payload: Value) -> Result<Value, String> {
    let line = serde_json::to_string(&payload).map_err(|e| e.to_string())?;
    {
        let mut stdin = sidecar.stdin.lock().map_err(|e| e.to_string())?;
        writeln!(stdin, "{line}").map_err(|e| e.to_string())?;
        stdin.flush().map_err(|e| e.to_string())?;
    }
    let mut reply = String::new();
    sidecar
        .stdout
        .lock()
        .map_err(|e| e.to_string())?
        .read_line(&mut reply)
        .map_err(|e| e.to_string())?;
    serde_json::from_str(reply.trim()).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let sidecar = Sidecar::spawn().expect("start C# sidecar");
    tauri::Builder::default()
        .manage(sidecar)
        .invoke_handler(tauri::generate_handler![wslc_invoke])
        .run(tauri::generate_context!())
        .expect("error while running Quay");
}
