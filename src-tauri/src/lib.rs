//! Native Tauri bridge for Microsoft WSL Containers.
//! Quay talks directly to the official WSLC flat C API from Rust; there is no
//! child C# process or stdio IPC. Close hides to tray; Quit actually exits.

#[cfg(windows)]
pub mod wslc_native;
#[cfg(windows)]
mod wslc_runtime;

use serde_json::Value;
use std::process::{Command, Stdio};
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, State, WindowEvent};

pub struct Backend {
    #[cfg(windows)]
    worker: wslc_runtime::NativeWorker,
}

impl Backend {
    fn new() -> Self {
        Self {
            #[cfg(windows)]
            worker: wslc_runtime::NativeWorker::spawn(),
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
fn wslc_invoke(backend: State<Backend>, payload: Value) -> Result<Value, String> {
    #[cfg(windows)]
    {
        backend.worker.invoke(payload)
    }
    #[cfg(not(windows))]
    {
        let _ = backend;
        let _ = payload;
        Err("native WSLC is only available on Windows".into())
    }
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
    let combined = format!(
        "{}{}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr)
    );
    let trimmed = combined.trim();
    (!trimmed.is_empty()).then(|| trimmed.lines().next().unwrap_or(trimmed).to_string())
}

#[tauri::command]
fn wslc_probe(backend: State<Backend>) -> Value {
    let version = run_capture("wslc", &["version"])
        .or_else(|| run_capture("container", &["version"]));
    #[cfg(windows)]
    let health = backend.worker.invoke(serde_json::json!({"cmd":"health"})).ok();
    #[cfg(not(windows))]
    let health: Option<Value> = None;
    let native_up = health.as_ref().and_then(|x| x.get("ok")).and_then(Value::as_bool).unwrap_or(false);
    let native_error = health.as_ref().and_then(|x| x.get("error")).cloned();
    serde_json::json!({
        "wslc": native_up,
        "native": native_up,
        // Kept temporarily for frontend compatibility; no sidecar process exists.
        "sidecar": native_up,
        "version": version,
        "sidecarPath": null,
        "sidecarError": native_error,
    })
}

#[tauri::command]
fn sidecar_up(backend: State<Backend>) -> bool {
    #[cfg(windows)]
    {
        backend.worker.invoke(serde_json::json!({"cmd":"health"}))
            .ok()
            .and_then(|x| x.get("ok").and_then(Value::as_bool))
            .unwrap_or(false)
    }
    #[cfg(not(windows))]
    {
        let _ = backend;
        false
    }
}

const AUTOSTART_VALUE: &str = "Quay";

#[cfg(windows)]
fn run_key() -> &'static str {
    r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run"
}

#[tauri::command]
fn autostart_enabled() -> bool {
    #[cfg(windows)]
    {
        let mut cmd = Command::new("reg");
        cmd.args(["query", run_key(), "/v", AUTOSTART_VALUE])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
        cmd.status().map(|s| s.success()).unwrap_or(false)
    }
    #[cfg(not(windows))]
    {
        false
    }
}

#[tauri::command]
fn autostart_set(enabled: bool) -> Result<bool, String> {
    #[cfg(windows)]
    {
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        let quoted = format!("\"{}\"", exe.display());
        let mut cmd = Command::new("reg");
        if enabled {
            cmd.args(["add", run_key(), "/v", AUTOSTART_VALUE, "/t", "REG_SZ", "/d", &quoted, "/f"]);
        } else {
            cmd.args(["delete", run_key(), "/v", AUTOSTART_VALUE, "/f"]);
        }
        cmd.stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
        let status = cmd.status().map_err(|e| e.to_string())?;
        if enabled && !status.success() {
            return Err("could not write HKCU Run key".into());
        }
        Ok(enabled)
    }
    #[cfg(not(windows))]
    {
        let _ = enabled;
        Err("Windows sign-in start is only available on Windows".into())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            #[cfg(windows)]
            if let Ok(resource_dir) = app.path().resource_dir() {
                let dll = resource_dir.join("binaries").join("wslcsdk.dll");
                if dll.is_file() {
                    std::env::set_var("QUAY_WSLC_SDK_DLL", dll);
                }
            }
            app.manage(Backend::new());
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
        .invoke_handler(tauri::generate_handler![
            wslc_invoke,
            sidecar_up,
            wslc_probe,
            autostart_enabled,
            autostart_set
        ])
        .run(tauri::generate_context!())
        .expect("error while running Quay");
}
