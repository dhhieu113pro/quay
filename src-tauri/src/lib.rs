//! Tauri bridge for the WSLC command-line backend.
//! Quay calls the installed `wslc.exe` directly and uses the default WSLC session.
//! Close hides to tray; Quit actually exits.

#[cfg(windows)]
mod wslc_executor;
#[cfg(windows)]
mod wslc_runtime;
mod workspace;

use serde_json::Value;
use std::process::{Command, Stdio};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, State, WindowEvent};

pub struct Backend {
    #[cfg(windows)]
    worker: wslc_runtime::CliWorker,
}

impl Backend {
    fn new() -> Self {
        Self {
            #[cfg(windows)]
            worker: wslc_runtime::CliWorker::spawn(),
        }
    }
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
    let quit = MenuItem::with_id(app, "quit", "Quit Quay", true, None::<&str>)?;
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
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                show_main(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() { tray = tray.icon(icon.clone()); }
    tray.build(app)?;
    Ok(())
}

#[tauri::command]
async fn wslc_invoke(backend: State<'_, Backend>, payload: Value) -> Result<Value, String> {
    #[cfg(windows)] {
        let worker = backend.worker.clone();
        tauri::async_runtime::spawn_blocking(move || worker.invoke(payload))
            .await
            .map_err(|e| format!("WSLC worker task failed: {e}"))?
    }
    #[cfg(not(windows))] {
        let _ = backend;
        let _ = payload;
        Err("WSLC is only available on Windows".into())
    }
}

fn run_capture(program: &str, args: &[&str]) -> Option<String> {
    let mut cmd = Command::new(program);
    cmd.args(args).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    #[cfg(windows)] {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let out = cmd.output().ok()?;
    if !out.status.success() { return None; }
    let combined = format!("{}{}", String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr));
    let trimmed = combined.trim();
    (!trimmed.is_empty()).then(|| trimmed.lines().next().unwrap_or(trimmed).to_string())
}

#[tauri::command]
fn wslc_probe() -> Value {
    let wsl_version = run_capture("wsl", &["--version"]);
    let version = run_capture("wslc", &["version"]);
    serde_json::json!({ "wsl": wsl_version.is_some(), "wslVersion": wsl_version, "wslc": version.is_some(), "version": version })
}

#[tauri::command]
fn ensure_host_directory(path: String) -> Result<bool, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() { return Err("directory path is empty".into()); }
    std::fs::create_dir_all(trimmed).map(|_| true).map_err(|e| format!("could not create {trimmed}: {e}"))
}

const AUTOSTART_VALUE: &str = "Quay";
#[cfg(windows)] fn run_key() -> &'static str { r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run" }

#[tauri::command]
fn autostart_enabled() -> bool {
    #[cfg(windows)] {
        let mut cmd = Command::new("reg");
        cmd.args(["query", run_key(), "/v", AUTOSTART_VALUE]).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
        cmd.status().map(|s| s.success()).unwrap_or(false)
    }
    #[cfg(not(windows))] { false }
}

#[tauri::command]
fn autostart_set(enabled: bool) -> Result<bool, String> {
    #[cfg(windows)] {
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        let quoted = format!("\"{}\"", exe.display());
        let mut cmd = Command::new("reg");
        if enabled { cmd.args(["add", run_key(), "/v", AUTOSTART_VALUE, "/t", "REG_SZ", "/d", &quoted, "/f"]); }
        else { cmd.args(["delete", run_key(), "/v", AUTOSTART_VALUE, "/f"]); }
        cmd.stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
        let status = cmd.status().map_err(|e| e.to_string())?;
        if enabled && !status.success() { return Err("could not write HKCU Run key".into()); }
        Ok(enabled)
    }
    #[cfg(not(windows))] { let _ = enabled; Err("Windows sign-in start is only available on Windows".into()) }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            show_main(app);
        }))
        .setup(|app| {
            app.manage(Backend::new());
            if let Err(err) = setup_tray(app.handle()) { eprintln!("tray: {err}"); }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event { api.prevent_close(); let _ = window.hide(); }
        })
        .invoke_handler(tauri::generate_handler![
            wslc_invoke, wslc_probe, ensure_host_directory, autostart_enabled, autostart_set,
            workspace::workspace_default_root, workspace::workspace_ensure, workspace::workspace_pick_root,
            workspace::workspace_pick_descendant, workspace::workspace_open,
            workspace::workspace_move_root, workspace::workspace_move_entry
        ])
        .run(tauri::generate_context!())
        .expect("error while running Quay");
}