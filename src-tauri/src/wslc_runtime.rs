#![cfg(windows)]

use crate::wslc_native::{Container, ContainerSpec, NativeApi, Session, VolumeSpec};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::mpsc::{self, Receiver, Sender};
use std::thread;
use std::time::{SystemTime, UNIX_EPOCH};

pub struct NativeWorker {
    tx: Sender<Request>,
}

struct Request {
    payload: Value,
    reply: Sender<Result<Value, String>>,
}

impl NativeWorker {
    pub fn spawn() -> Self {
        let (tx, rx) = mpsc::channel::<Request>();
        thread::Builder::new()
            .name("quay-wslc-native".into())
            .spawn(move || worker_loop(rx))
            .expect("spawn quay native WSLC worker");
        Self { tx }
    }

    pub fn invoke(&self, payload: Value) -> Result<Value, String> {
        let (reply_tx, reply_rx) = mpsc::channel();
        self.tx
            .send(Request {
                payload,
                reply: reply_tx,
            })
            .map_err(|e| e.to_string())?;
        reply_rx.recv().map_err(|e| e.to_string())?
    }
}

fn worker_loop(rx: Receiver<Request>) {
    let mut runtime = NativeRuntime::new();
    for request in rx {
        let result = match runtime.as_mut() {
            Ok(runtime) => runtime.handle(&request.payload),
            Err(error) => {
                if request.payload.get("cmd").and_then(Value::as_str) == Some("health") {
                    Ok(
                        json!({"ok": false, "wslc": false, "session": "Quay", "missing": [], "error": error}),
                    )
                } else {
                    Err(error.clone())
                }
            }
        };
        let _ = request.reply.send(result);
    }
}

struct ManagedContainer {
    name: String,
    image: String,
    container: Container,
    ports: String,
    mounts: String,
    env: String,
    command: Vec<String>,
    workdir: String,
    gpu: bool,
    created_at: i64,
    started_at: Option<i64>,
    finished_at: Option<i64>,
    bridge_ip: Option<String>,
}

struct NativeRuntime {
    _api: std::sync::Arc<NativeApi>,
    _session: Session,
    containers: HashMap<String, ManagedContainer>,
}

impl NativeRuntime {
    fn new() -> Result<Self, String> {
        let api = NativeApi::load()?;
        let storage = PathBuf::from(r"C:\WslcData");
        let session = api.create_session("Quay", &storage, 4, 4096)?;
        Ok(Self {
            _api: api,
            _session: session,
            containers: HashMap::new(),
        })
    }

    fn handle(&mut self, root: &Value) -> Result<Value, String> {
        let cmd = root
            .get("cmd")
            .and_then(Value::as_str)
            .ok_or("missing cmd")?;
        match cmd {
            "health" => Ok(json!({"ok": true, "wslc": true, "session": "Quay", "missing": []})),
            "pull" => {
                let image = required(root, "image")?;
                self._session.pull(image)?;
                Ok(json!({"ok": true, "image": image}))
            }
            "run" => self.run(root),
            "ps" => self.ps(),
            "stop" => self.stop(required(root, "id")?),
            "rm" => self.remove(required(root, "id")?),
            _ => Err(format!("unknown command '{cmd}'")),
        }
    }

    fn run(&mut self, root: &Value) -> Result<Value, String> {
        let image = required(root, "image")?.to_string();
        let name = required(root, "name")?.to_string();
        if self.containers.contains_key(&name) {
            self.remove(&name)?;
        }

        self._session.pull(&image)?;
        let command_text = root
            .get("command")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let mut command = split_command_line(command_text);
        command = self.resolve_container_names(command);
        if command.is_empty() {
            return Err(format!(
                "container '{name}' requires an explicit command for the native WSLC API"
            ));
        }

        let ports_text = root
            .get("ports")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        let env_text = root
            .get("env")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        let mounts_text = root
            .get("mounts")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string();
        let workdir = root
            .get("workdir")
            .and_then(Value::as_str)
            .unwrap_or("/")
            .to_string();
        let gpu = root.get("gpu").and_then(Value::as_bool).unwrap_or(false);

        let spec = ContainerSpec {
            image: image.clone(),
            name: name.clone(),
            command: command.clone(),
            workdir: workdir.clone(),
            ports: parse_ports(&ports_text)?,
            env: parse_env(&env_text),
            volumes: parse_volumes(&mounts_text)?,
        };

        let container = self._session.create_container(&spec)?;
        let created_at = now_ms();
        container.start()?;
        let started_at = now_ms();
        let bridge_ip = find_bridge_ip(&container.inspect().unwrap_or_default());
        let managed = ManagedContainer {
            name: name.clone(),
            image,
            container,
            ports: ports_text,
            mounts: mounts_text,
            env: env_text,
            command,
            workdir,
            gpu,
            created_at,
            started_at: Some(started_at),
            finished_at: None,
            bridge_ip,
        };
        let snapshot = snapshot(&managed)?;
        self.containers.insert(name, managed);
        Ok(json!({"ok": true, "container": snapshot}))
    }

    fn ps(&mut self) -> Result<Value, String> {
        let mut items = Vec::new();
        for managed in self.containers.values_mut() {
            if managed.bridge_ip.is_none() {
                managed.bridge_ip =
                    find_bridge_ip(&managed.container.inspect().unwrap_or_default());
            }
            items.push(snapshot(managed)?);
        }
        Ok(json!({"ok": true, "containers": items}))
    }

    fn stop(&mut self, id: &str) -> Result<Value, String> {
        let key = self.find_key(id)?;
        let managed = self.containers.get_mut(&key).ok_or("container not found")?;
        managed.container.stop()?;
        managed.finished_at = Some(now_ms());
        Ok(json!({"ok": true, "container": snapshot(managed)?}))
    }

    fn remove(&mut self, id: &str) -> Result<Value, String> {
        let key = self.find_key(id)?;
        let mut managed = self.containers.remove(&key).ok_or("container not found")?;
        let _ = managed.container.stop();
        managed.container.delete()?;
        Ok(json!({"ok": true}))
    }

    fn find_key(&self, id: &str) -> Result<String, String> {
        if self.containers.contains_key(id) {
            return Ok(id.to_string());
        }
        for (name, managed) in &self.containers {
            if managed.container.id().ok().as_deref() == Some(id) {
                return Ok(name.clone());
            }
        }
        Err(format!(
            "container '{id}' is not managed by the Quay native session"
        ))
    }

    fn resolve_container_names(&mut self, command: Vec<String>) -> Vec<String> {
        command
            .into_iter()
            .map(|mut arg| {
                for managed in self.containers.values_mut() {
                    if managed.bridge_ip.is_none() {
                        managed.bridge_ip =
                            find_bridge_ip(&managed.container.inspect().unwrap_or_default());
                    }
                    if let Some(ip) = &managed.bridge_ip {
                        arg = arg.replace(&managed.name, ip);
                    }
                }
                arg
            })
            .collect()
    }
}

fn snapshot(managed: &ManagedContainer) -> Result<Value, String> {
    let status = managed.container.state()?;
    Ok(json!({
        "id": managed.container.id()?,
        "name": managed.name,
        "image": managed.image,
        "status": status,
        "createdAt": managed.created_at,
        "startedAt": managed.started_at,
        "finishedAt": managed.finished_at,
        "exitCode": managed.container.exit_code(),
        "ports": managed.ports,
        "mounts": managed.mounts,
        "env": managed.env,
        "gpu": managed.gpu,
        "command": managed.command,
        "workdir": managed.workdir,
        "bridgeIp": managed.bridge_ip,
        "logs": managed.container.logs(),
    }))
}

fn required<'a>(root: &'a Value, name: &str) -> Result<&'a str, String> {
    root.get(name)
        .and_then(Value::as_str)
        .filter(|x| !x.trim().is_empty())
        .ok_or_else(|| format!("missing or empty '{name}'"))
}

fn parse_ports(value: &str) -> Result<Vec<(u16, u16)>, String> {
    value
        .split(',')
        .filter(|x| !x.trim().is_empty())
        .map(|item| {
            let mut parts = item.trim().split(':');
            let host = parts
                .next()
                .ok_or_else(|| format!("invalid port '{item}'"))?
                .parse::<u16>()
                .map_err(|_| format!("invalid port '{item}'"))?;
            let container = parts
                .next()
                .ok_or_else(|| format!("invalid port '{item}'"))?
                .parse::<u16>()
                .map_err(|_| format!("invalid port '{item}'"))?;
            if parts.next().is_some() {
                return Err(format!("invalid port '{item}'"));
            }
            Ok((host, container))
        })
        .collect()
}

fn parse_env(value: &str) -> Vec<String> {
    value
        .lines()
        .map(str::trim)
        .filter(|x| !x.is_empty())
        .map(str::to_string)
        .collect()
}

fn parse_volumes(value: &str) -> Result<Vec<VolumeSpec>, String> {
    let mut result = Vec::new();
    for line in value.lines().map(str::trim).filter(|x| !x.is_empty()) {
        let mode_at = line
            .rfind(':')
            .ok_or_else(|| format!("invalid mount '{line}'"))?;
        let mode = &line[mode_at + 1..];
        let paths = &line[..mode_at];
        let dest_at = paths
            .rfind(':')
            .ok_or_else(|| format!("invalid mount '{line}'"))?;
        let source = &paths[..dest_at];
        let destination = &paths[dest_at + 1..];
        if !PathBuf::from(source).is_absolute() {
            return Err(format!(
                "named volume '{source}' is not supported by the native runner yet"
            ));
        }
        result.push(VolumeSpec {
            windows_path: PathBuf::from(source),
            container_path: destination.to_string(),
            read_only: mode.eq_ignore_ascii_case("ro"),
        });
    }
    Ok(result)
}

fn split_command_line(value: &str) -> Vec<String> {
    let mut result = Vec::new();
    let mut current = String::new();
    let mut quote: Option<char> = None;
    let mut chars = value.chars().peekable();
    while let Some(ch) = chars.next() {
        if let Some(q) = quote {
            if ch == q {
                quote = None;
            } else if ch == '\\' && chars.peek() == Some(&q) {
                current.push(chars.next().unwrap());
            } else {
                current.push(ch);
            }
        } else if ch == '\'' || ch == '"' {
            quote = Some(ch);
        } else if ch.is_whitespace() {
            if !current.is_empty() {
                result.push(std::mem::take(&mut current));
            }
        } else {
            current.push(ch);
        }
    }
    if !current.is_empty() {
        result.push(current);
    }
    result
}

fn find_bridge_ip(inspect: &str) -> Option<String> {
    let value: Value = serde_json::from_str(inspect).ok()?;
    fn walk(value: &Value) -> Option<String> {
        match value {
            Value::Object(map) => {
                if let Some(ip) = map
                    .get("IPAddress")
                    .and_then(Value::as_str)
                    .filter(|x| !x.is_empty() && *x != "0.0.0.0")
                {
                    return Some(ip.to_string());
                }
                map.values().find_map(walk)
            }
            Value::Array(items) => items.iter().find_map(walk),
            _ => None,
        }
    }
    walk(&value)
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}
