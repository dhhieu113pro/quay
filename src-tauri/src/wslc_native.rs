#![cfg(windows)]

use std::ffi::{c_char, c_void, CStr, CString, OsStr};
use std::mem::transmute_copy;
use std::os::windows::ffi::OsStrExt;
use std::path::{Path, PathBuf};
use std::ptr::{null, null_mut};
use std::sync::{Arc, Mutex};

pub type HResult = i32;
type WslcSession = *mut c_void;
type WslcContainer = *mut c_void;

const COINIT_MULTITHREADED: u32 = 0;
const WSLC_CONTAINER_NETWORKING_MODE_BRIDGED: i32 = 1;
const WSLC_CONTAINER_START_FLAG_ATTACH: i32 = 1;
const WSLC_CONTAINER_STATE_CREATED: i32 = 1;
const WSLC_CONTAINER_STATE_RUNNING: i32 = 2;
const WSLC_CONTAINER_STATE_EXITED: i32 = 3;
const WSLC_CONTAINER_STATE_DELETED: i32 = 4;
const WSLC_SIGNAL_SIGTERM: i32 = 15;
const WSLC_DELETE_CONTAINER_FLAG_FORCE: i32 = 1;
const WSLC_PORT_PROTOCOL_TCP: i32 = 0;

#[repr(C, align(8))]
struct WslcSessionSettings { opaque: [u8; 72] }
#[repr(C, align(8))]
struct WslcContainerSettings { opaque: [u8; 104] }
#[repr(C, align(8))]
struct WslcProcessSettings { opaque: [u8; 72] }

#[repr(C)]
struct WslcPullImageOptions {
    uri: *const c_char,
    progress_callback: *const c_void,
    progress_callback_context: *mut c_void,
    registry_auth: *const c_char,
}

#[repr(C)]
struct WslcContainerPortMapping {
    windows_port: u16,
    container_port: u16,
    protocol: i32,
    windows_address: *mut c_void,
}

#[repr(C)]
struct WslcContainerVolume {
    windows_path: *const u16,
    container_path: *const c_char,
    read_only: i32,
}

#[repr(C)]
#[derive(Clone, Copy)]
struct WslcProcessCallbacks {
    on_stdout: Option<unsafe extern "system" fn(i32, *const u8, u32, *mut c_void)>,
    on_stderr: Option<unsafe extern "system" fn(i32, *const u8, u32, *mut c_void)>,
    on_exit: Option<unsafe extern "system" fn(i32, *mut c_void)>,
}

type InitSessionSettings = unsafe extern "system" fn(*const u16, *const u16, *mut WslcSessionSettings) -> HResult;
type SetSessionCpu = unsafe extern "system" fn(*mut WslcSessionSettings, u32) -> HResult;
type SetSessionMemory = unsafe extern "system" fn(*mut WslcSessionSettings, u32) -> HResult;
type CreateSession = unsafe extern "system" fn(*mut WslcSessionSettings, *mut WslcSession, *mut *mut u16) -> HResult;
type TerminateSession = unsafe extern "system" fn(WslcSession) -> HResult;
type ReleaseSession = unsafe extern "system" fn(WslcSession) -> HResult;
type PullSessionImage = unsafe extern "system" fn(WslcSession, *const WslcPullImageOptions, *mut *mut u16) -> HResult;
type InitProcessSettings = unsafe extern "system" fn(*mut WslcProcessSettings) -> HResult;
type SetProcessCmdLine = unsafe extern "system" fn(*mut WslcProcessSettings, *const *const c_char, usize) -> HResult;
type SetProcessEnv = unsafe extern "system" fn(*mut WslcProcessSettings, *const *const c_char, usize) -> HResult;
type SetProcessWorkingDirectory = unsafe extern "system" fn(*mut WslcProcessSettings, *const c_char) -> HResult;
type InitContainerSettings = unsafe extern "system" fn(*const c_char, *mut WslcContainerSettings) -> HResult;
type SetContainerName = unsafe extern "system" fn(*mut WslcContainerSettings, *const c_char) -> HResult;
type SetContainerInitProcess = unsafe extern "system" fn(*mut WslcContainerSettings, *mut WslcProcessSettings) -> HResult;
type SetContainerNetworkingMode = unsafe extern "system" fn(*mut WslcContainerSettings, i32) -> HResult;
type SetContainerPortMappings = unsafe extern "system" fn(*mut WslcContainerSettings, *const WslcContainerPortMapping, u32) -> HResult;
type SetContainerVolumes = unsafe extern "system" fn(*mut WslcContainerSettings, *const WslcContainerVolume, u32) -> HResult;
type CreateContainer = unsafe extern "system" fn(WslcSession, *const WslcContainerSettings, *mut WslcContainer, *mut *mut u16) -> HResult;
type SetInitCallbacks = unsafe extern "system" fn(WslcContainer, *const WslcProcessCallbacks, *mut c_void) -> HResult;
type StartContainer = unsafe extern "system" fn(WslcContainer, i32, *mut *mut u16) -> HResult;
type GetContainerState = unsafe extern "system" fn(WslcContainer, *mut i32) -> HResult;
type GetContainerId = unsafe extern "system" fn(WslcContainer, *mut c_char) -> HResult;
type InspectContainer = unsafe extern "system" fn(WslcContainer, *mut *mut c_char) -> HResult;
type StopContainer = unsafe extern "system" fn(WslcContainer, i32, u32, *mut *mut u16) -> HResult;
type DeleteContainer = unsafe extern "system" fn(WslcContainer, i32, *mut *mut u16) -> HResult;
type ReleaseContainer = unsafe extern "system" fn(WslcContainer) -> HResult;

#[link(name = "kernel32")]
extern "system" {
    fn LoadLibraryW(name: *const u16) -> *mut c_void;
    fn GetProcAddress(module: *mut c_void, name: *const c_char) -> *mut c_void;
    fn FreeLibrary(module: *mut c_void) -> i32;
}
#[link(name = "ole32")]
extern "system" {
    fn CoInitializeEx(reserved: *mut c_void, coinit: u32) -> HResult;
    fn CoUninitialize();
    fn CoTaskMemFree(ptr: *const c_void);
}

fn failed(hr: HResult) -> bool { hr < 0 }
fn wide(value: &OsStr) -> Vec<u16> { value.encode_wide().chain(std::iter::once(0)).collect() }

unsafe fn take_wide_error(ptr: *mut u16) -> Option<String> {
    if ptr.is_null() { return None; }
    let mut len = 0usize;
    while *ptr.add(len) != 0 { len += 1; }
    let text = String::from_utf16_lossy(std::slice::from_raw_parts(ptr, len));
    CoTaskMemFree(ptr.cast());
    Some(text)
}

unsafe fn take_ansi(ptr: *mut c_char) -> Option<String> {
    if ptr.is_null() { return None; }
    let text = CStr::from_ptr(ptr).to_string_lossy().into_owned();
    CoTaskMemFree(ptr.cast());
    Some(text)
}

fn check(hr: HResult, context: &str) -> Result<(), String> {
    if failed(hr) { Err(format!("{context} failed: HRESULT 0x{:08X}", hr as u32)) } else { Ok(()) }
}
unsafe fn check_with_error(hr: HResult, error: *mut u16, context: &str) -> Result<(), String> {
    if failed(hr) {
        let detail = take_wide_error(error).unwrap_or_else(|| "no SDK error message".into());
        Err(format!("{context} failed: HRESULT 0x{:08X}: {detail}", hr as u32))
    } else {
        if !error.is_null() { let _ = take_wide_error(error); }
        Ok(())
    }
}

struct ComApartment;
impl ComApartment {
    fn init() -> Result<Self, String> {
        let hr = unsafe { CoInitializeEx(null_mut(), COINIT_MULTITHREADED) };
        if failed(hr) { Err(format!("CoInitializeEx failed: HRESULT 0x{:08X}", hr as u32)) } else { Ok(Self) }
    }
}
impl Drop for ComApartment { fn drop(&mut self) { unsafe { CoUninitialize() }; } }

#[derive(Clone, serde::Serialize)]
pub struct NativeLog {
    pub ts: i64,
    pub stream: String,
    pub text: String,
}

struct CallbackContext {
    logs: Arc<Mutex<Vec<NativeLog>>>,
    exit_code: Arc<Mutex<Option<i32>>>,
}

unsafe extern "system" fn on_output(io: i32, data: *const u8, len: u32, context: *mut c_void) {
    if context.is_null() || data.is_null() || len == 0 { return; }
    let ctx = &*(context as *const CallbackContext);
    let text = String::from_utf8_lossy(std::slice::from_raw_parts(data, len as usize)).into_owned();
    if let Ok(mut logs) = ctx.logs.lock() {
        logs.push(NativeLog {
            ts: std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis() as i64,
            stream: if io == 2 { "stderr".into() } else { "stdout".into() },
            text,
        });
        if logs.len() > 500 { let excess = logs.len() - 500; logs.drain(0..excess); }
    }
}
unsafe extern "system" fn on_exit(code: i32, context: *mut c_void) {
    if context.is_null() { return; }
    let ctx = &*(context as *const CallbackContext);
    if let Ok(mut value) = ctx.exit_code.lock() { *value = Some(code); }
}

pub struct NativeApi {
    module: *mut c_void,
    _com: ComApartment,
    init_session_settings: InitSessionSettings,
    set_session_cpu: SetSessionCpu,
    set_session_memory: SetSessionMemory,
    create_session: CreateSession,
    terminate_session: TerminateSession,
    release_session: ReleaseSession,
    pull_session_image: PullSessionImage,
    init_process_settings: InitProcessSettings,
    set_process_cmd_line: SetProcessCmdLine,
    set_process_env: SetProcessEnv,
    set_process_workdir: SetProcessWorkingDirectory,
    init_container_settings: InitContainerSettings,
    set_container_name: SetContainerName,
    set_container_init_process: SetContainerInitProcess,
    set_container_networking_mode: SetContainerNetworkingMode,
    set_container_port_mappings: SetContainerPortMappings,
    set_container_volumes: SetContainerVolumes,
    create_container: CreateContainer,
    set_init_callbacks: SetInitCallbacks,
    start_container: StartContainer,
    get_container_state: GetContainerState,
    get_container_id: GetContainerId,
    inspect_container: InspectContainer,
    stop_container: StopContainer,
    delete_container: DeleteContainer,
    release_container: ReleaseContainer,
}
unsafe impl Send for NativeApi {}
unsafe impl Sync for NativeApi {}

impl NativeApi {
    pub fn load() -> Result<Arc<Self>, String> {
        let com = ComApartment::init()?;
        let candidates = dll_candidates();
        let mut loaded = None;
        for path in &candidates {
            let w = wide(path.as_os_str());
            let module = unsafe { LoadLibraryW(w.as_ptr()) };
            if !module.is_null() { loaded = Some(module); break; }
        }
        let module = loaded.ok_or_else(|| format!("wslcsdk.dll not found. Tried:\n{}", candidates.iter().map(|p| format!("- {}", p.display())).collect::<Vec<_>>().join("\n")))?;
        unsafe fn symbol<T: Copy>(module: *mut c_void, name: &'static [u8]) -> Result<T, String> {
            let ptr = GetProcAddress(module, name.as_ptr().cast());
            if ptr.is_null() { return Err(format!("missing WSLC SDK export {}", CStr::from_bytes_with_nul_unchecked(name).to_string_lossy())); }
            Ok(transmute_copy(&ptr))
        }
        let api = unsafe { Self {
            module, _com: com,
            init_session_settings: symbol(module, b"WslcInitSessionSettings\0")?,
            set_session_cpu: symbol(module, b"WslcSetSessionSettingsCpuCount\0")?,
            set_session_memory: symbol(module, b"WslcSetSessionSettingsMemory\0")?,
            create_session: symbol(module, b"WslcCreateSession\0")?,
            terminate_session: symbol(module, b"WslcTerminateSession\0")?,
            release_session: symbol(module, b"WslcReleaseSession\0")?,
            pull_session_image: symbol(module, b"WslcPullSessionImage\0")?,
            init_process_settings: symbol(module, b"WslcInitProcessSettings\0")?,
            set_process_cmd_line: symbol(module, b"WslcSetProcessSettingsCmdLine\0")?,
            set_process_env: symbol(module, b"WslcSetProcessSettingsEnvVariables\0")?,
            set_process_workdir: symbol(module, b"WslcSetProcessSettingsWorkingDirectory\0")?,
            init_container_settings: symbol(module, b"WslcInitContainerSettings\0")?,
            set_container_name: symbol(module, b"WslcSetContainerSettingsName\0")?,
            set_container_init_process: symbol(module, b"WslcSetContainerSettingsInitProcess\0")?,
            set_container_networking_mode: symbol(module, b"WslcSetContainerSettingsNetworkingMode\0")?,
            set_container_port_mappings: symbol(module, b"WslcSetContainerSettingsPortMappings\0")?,
            set_container_volumes: symbol(module, b"WslcSetContainerSettingsVolumes\0")?,
            create_container: symbol(module, b"WslcCreateContainer\0")?,
            set_init_callbacks: symbol(module, b"WslcSetContainerInitProcessIOCallbacks\0")?,
            start_container: symbol(module, b"WslcStartContainer\0")?,
            get_container_state: symbol(module, b"WslcGetContainerState\0")?,
            get_container_id: symbol(module, b"WslcGetContainerID\0")?,
            inspect_container: symbol(module, b"WslcInspectContainer\0")?,
            stop_container: symbol(module, b"WslcStopContainer\0")?,
            delete_container: symbol(module, b"WslcDeleteContainer\0")?,
            release_container: symbol(module, b"WslcReleaseContainer\0")?,
        }};
        Ok(Arc::new(api))
    }

    pub fn create_session(self: &Arc<Self>, name: &str, storage: &Path, cpu: u32, memory_mb: u32) -> Result<Session, String> {
        std::fs::create_dir_all(storage).map_err(|e| format!("create {}: {e}", storage.display()))?;
        let name_w = wide(OsStr::new(name));
        let storage_w = wide(storage.as_os_str());
        let mut settings = WslcSessionSettings { opaque: [0; 72] };
        unsafe {
            check((self.init_session_settings)(name_w.as_ptr(), storage_w.as_ptr(), &mut settings), "WslcInitSessionSettings")?;
            check((self.set_session_cpu)(&mut settings, cpu), "WslcSetSessionSettingsCpuCount")?;
            check((self.set_session_memory)(&mut settings, memory_mb), "WslcSetSessionSettingsMemory")?;
            let mut handle = null_mut();
            let mut error = null_mut();
            check_with_error((self.create_session)(&mut settings, &mut handle, &mut error), error, "WslcCreateSession")?;
            Ok(Session { api: Arc::clone(self), handle })
        }
    }
}
impl Drop for NativeApi { fn drop(&mut self) { if !self.module.is_null() { unsafe { FreeLibrary(self.module); } } } }

pub struct Session { api: Arc<NativeApi>, handle: WslcSession }
impl Session {
    pub fn pull(&self, image: &str) -> Result<(), String> {
        let image = CString::new(image).map_err(|e| e.to_string())?;
        let options = WslcPullImageOptions { uri: image.as_ptr(), progress_callback: null(), progress_callback_context: null_mut(), registry_auth: null() };
        unsafe { let mut error = null_mut(); check_with_error((self.api.pull_session_image)(self.handle, &options, &mut error), error, "WslcPullSessionImage") }
    }

    pub fn create_container(&self, spec: &ContainerSpec) -> Result<Container, String> {
        if spec.command.is_empty() { return Err("native WSLC container command cannot be empty".into()); }
        let image = CString::new(spec.image.as_str()).map_err(|e| e.to_string())?;
        let name = CString::new(spec.name.as_str()).map_err(|e| e.to_string())?;
        let command = spec.command.iter().map(|x| CString::new(x.as_str()).map_err(|e| e.to_string())).collect::<Result<Vec<_>, _>>()?;
        let argv = command.iter().map(|x| x.as_ptr()).collect::<Vec<_>>();
        let env_values = spec.env.iter().map(|x| CString::new(x.as_str()).map_err(|e| e.to_string())).collect::<Result<Vec<_>, _>>()?;
        let env_ptrs = env_values.iter().map(|x| x.as_ptr()).collect::<Vec<_>>();
        let workdir = CString::new(spec.workdir.as_str()).map_err(|e| e.to_string())?;
        let mut process = WslcProcessSettings { opaque: [0; 72] };
        let mut settings = WslcContainerSettings { opaque: [0; 104] };

        let volume_sources = spec.volumes.iter().map(|v| wide(v.windows_path.as_os_str())).collect::<Vec<_>>();
        let volume_destinations = spec.volumes.iter().map(|v| CString::new(v.container_path.as_str()).map_err(|e| e.to_string())).collect::<Result<Vec<_>, _>>()?;
        let native_volumes = spec.volumes.iter().enumerate().map(|(i, v)| WslcContainerVolume {
            windows_path: volume_sources[i].as_ptr(), container_path: volume_destinations[i].as_ptr(), read_only: if v.read_only { 1 } else { 0 }
        }).collect::<Vec<_>>();

        unsafe {
            check((self.api.init_process_settings)(&mut process), "WslcInitProcessSettings")?;
            check((self.api.set_process_cmd_line)(&mut process, argv.as_ptr(), argv.len()), "WslcSetProcessSettingsCmdLine")?;
            if !env_ptrs.is_empty() { check((self.api.set_process_env)(&mut process, env_ptrs.as_ptr(), env_ptrs.len()), "WslcSetProcessSettingsEnvVariables")?; }
            if !spec.workdir.is_empty() { check((self.api.set_process_workdir)(&mut process, workdir.as_ptr()), "WslcSetProcessSettingsWorkingDirectory")?; }
            check((self.api.init_container_settings)(image.as_ptr(), &mut settings), "WslcInitContainerSettings")?;
            check((self.api.set_container_name)(&mut settings, name.as_ptr()), "WslcSetContainerSettingsName")?;
            check((self.api.set_container_init_process)(&mut settings, &mut process), "WslcSetContainerSettingsInitProcess")?;
            check((self.api.set_container_networking_mode)(&mut settings, WSLC_CONTAINER_NETWORKING_MODE_BRIDGED), "WslcSetContainerSettingsNetworkingMode")?;
            let ports = spec.ports.iter().map(|&(host, container)| WslcContainerPortMapping { windows_port: host, container_port: container, protocol: WSLC_PORT_PROTOCOL_TCP, windows_address: null_mut() }).collect::<Vec<_>>();
            if !ports.is_empty() { check((self.api.set_container_port_mappings)(&mut settings, ports.as_ptr(), ports.len() as u32), "WslcSetContainerSettingsPortMappings")?; }
            if !native_volumes.is_empty() { check((self.api.set_container_volumes)(&mut settings, native_volumes.as_ptr(), native_volumes.len() as u32), "WslcSetContainerSettingsVolumes")?; }
            let mut handle = null_mut();
            let mut error = null_mut();
            check_with_error((self.api.create_container)(self.handle, &settings, &mut handle, &mut error), error, "WslcCreateContainer")?;
            let logs = Arc::new(Mutex::new(Vec::new()));
            let exit_code = Arc::new(Mutex::new(None));
            let mut callback_context = Box::new(CallbackContext { logs: Arc::clone(&logs), exit_code: Arc::clone(&exit_code) });
            let callbacks = WslcProcessCallbacks { on_stdout: Some(on_output), on_stderr: Some(on_output), on_exit: Some(on_exit) };
            check((self.api.set_init_callbacks)(handle, &callbacks, (&mut *callback_context as *mut CallbackContext).cast()), "WslcSetContainerInitProcessIOCallbacks")?;
            Ok(Container { api: Arc::clone(&self.api), handle, deleted: false, logs, exit_code, _callback_context: callback_context })
        }
    }
}
impl Drop for Session { fn drop(&mut self) { if !self.handle.is_null() { unsafe { let _ = (self.api.terminate_session)(self.handle); let _ = (self.api.release_session)(self.handle); } self.handle = null_mut(); } } }

pub struct VolumeSpec { pub windows_path: PathBuf, pub container_path: String, pub read_only: bool }
pub struct ContainerSpec {
    pub image: String,
    pub name: String,
    pub command: Vec<String>,
    pub workdir: String,
    pub ports: Vec<(u16, u16)>,
    pub env: Vec<String>,
    pub volumes: Vec<VolumeSpec>,
}

pub struct Container {
    api: Arc<NativeApi>, handle: WslcContainer, deleted: bool,
    logs: Arc<Mutex<Vec<NativeLog>>>, exit_code: Arc<Mutex<Option<i32>>>, _callback_context: Box<CallbackContext>,
}
impl Container {
    pub fn start(&self) -> Result<(), String> { unsafe { let mut error = null_mut(); check_with_error((self.api.start_container)(self.handle, WSLC_CONTAINER_START_FLAG_ATTACH, &mut error), error, "WslcStartContainer") } }
    pub fn state(&self) -> Result<String, String> { unsafe { let mut state = 0; check((self.api.get_container_state)(self.handle, &mut state), "WslcGetContainerState")?; Ok(match state { WSLC_CONTAINER_STATE_CREATED => "created", WSLC_CONTAINER_STATE_RUNNING => "running", WSLC_CONTAINER_STATE_EXITED => "exited", WSLC_CONTAINER_STATE_DELETED => "deleted", _ => "invalid" }.into()) } }
    pub fn is_running(&self) -> Result<bool, String> { Ok(self.state()? == "running") }
    pub fn id(&self) -> Result<String, String> { let mut buffer = [0i8; 65]; unsafe { check((self.api.get_container_id)(self.handle, buffer.as_mut_ptr()), "WslcGetContainerID")?; Ok(CStr::from_ptr(buffer.as_ptr()).to_string_lossy().into_owned()) } }
    pub fn inspect(&self) -> Result<String, String> { unsafe { let mut ptr = null_mut(); check((self.api.inspect_container)(self.handle, &mut ptr), "WslcInspectContainer")?; Ok(take_ansi(ptr).unwrap_or_default()) } }
    pub fn logs(&self) -> Vec<NativeLog> { self.logs.lock().map(|x| x.clone()).unwrap_or_default() }
    pub fn exit_code(&self) -> Option<i32> { self.exit_code.lock().ok().and_then(|x| *x) }
    pub fn stop(&self) -> Result<(), String> { if !self.is_running()? { return Ok(()); } unsafe { let mut error = null_mut(); check_with_error((self.api.stop_container)(self.handle, WSLC_SIGNAL_SIGTERM, 10, &mut error), error, "WslcStopContainer") } }
    pub fn delete(&mut self) -> Result<(), String> { unsafe { let mut error = null_mut(); check_with_error((self.api.delete_container)(self.handle, WSLC_DELETE_CONTAINER_FLAG_FORCE, &mut error), error, "WslcDeleteContainer")?; self.deleted = true; Ok(()) } }
}
impl Drop for Container {
    fn drop(&mut self) {
        if self.handle.is_null() { return; }
        unsafe {
            if !self.deleted {
                let mut error = null_mut(); let _ = (self.api.stop_container)(self.handle, WSLC_SIGNAL_SIGTERM, 2, &mut error); if !error.is_null() { let _ = take_wide_error(error); }
                error = null_mut(); let _ = (self.api.delete_container)(self.handle, WSLC_DELETE_CONTAINER_FLAG_FORCE, &mut error); if !error.is_null() { let _ = take_wide_error(error); }
            }
            let _ = (self.api.release_container)(self.handle);
        }
        self.handle = null_mut();
    }
}

fn dll_candidates() -> Vec<PathBuf> {
    let mut result = Vec::new();
    if let Ok(path) = std::env::var("QUAY_WSLC_SDK_DLL") { result.push(PathBuf::from(path)); }
    if let Ok(exe) = std::env::current_exe() { if let Some(dir) = exe.parent() { result.push(dir.join("wslcsdk.dll")); result.push(dir.join("binaries").join("wslcsdk.dll")); } }
    if let Ok(current) = std::env::current_dir() {
        result.push(current.join("wslcsdk.dll")); result.push(current.join("src-tauri").join("binaries").join("wslcsdk.dll"));
        result.push(current.join("host").join("publish").join("win-x64").join("wslcsdk.dll")); result.push(current.join("host").join("publish").join("win-arm64").join("wslcsdk.dll"));
        if current.ends_with("src-tauri") { if let Some(root) = current.parent() { result.push(root.join("src-tauri").join("binaries").join("wslcsdk.dll")); } }
    }
    result.push(PathBuf::from("wslcsdk.dll")); result
}
