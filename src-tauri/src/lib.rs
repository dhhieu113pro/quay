//! Thin Tauri bridge. Each UI action is JSON over stdin to `quay-host.exe`,
//! which calls `Microsoft.WSL.Containers`. Close hides to the tray; Quit on
//! the tray menu actually exits.

use serde_json::Value;
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{ChildStdin, ChildStdout, Command, Stdio};
use std::sync::Mutex;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, State, WindowEvent};

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
        cmd.stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
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

fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
    }
}

fn setup_tray(app: &AppHandle) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "Show Quay", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &quit])?;

    let mut tray = TrayIconBuilder::with_id("main")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .tooltip("Quay")
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show_main(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
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

fn run_capture(program: &str, args: &[&str]) -> Option<String> {
    let mut cmd = Command::new(program);
    cmd.args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let out = cmd.output().ok()?;
    let text = String::from_utf8_lossy(&out.stdout);
    let err = String::from_utf8_lossy(&out.stderr);
    let combined = format!("{text}{err}");
    let trimmed = combined.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.lines().next().unwrap_or(trimmed).to_string())
    }
}

#[tauri::command]
fn wslc_probe(sidecar: State<Sidecar>) -> Value {
    let version = run_capture("wslc", &["version"])
        .or_else(|| run_capture("container", &["version"]));
    let sidecar_up = sidecar.stdin.lock().ok().is_some_and(|g| g.is_some());
    serde_json::json!({
        "wslc": version.is_some(),
        "sidecar": sidecar_up,
        "version": version,
    })
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
            if let Err(err) = setup_tray(app.handle()) {
                eprintln!("tray: {err}");
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![wslc_invoke, sidecar_up, wslc_probe])
        .run(tauri::generate_context!())
        .expect("error while running Quay");
}
