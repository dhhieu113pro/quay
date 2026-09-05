use crate::operations::{OperationError, OperationKind, QuayOperations};
use serde::Serialize;
use serde_json::{json, Map, Value};

#[derive(Debug, Clone, Serialize)]
pub struct ToolSpec {
    pub name: &'static str,
    pub description: &'static str,
    pub kind: OperationKind,
    pub input_schema: Value,
}

fn object_schema(properties: Value, required: &[&str]) -> Value {
    json!({
        "type": "object",
        "properties": properties,
        "required": required,
        "additionalProperties": false
    })
}

fn no_args() -> Value { object_schema(json!({}), &[]) }
fn id_schema() -> Value {
    object_schema(json!({"id": {"type":"string", "minLength":1, "description":"Container, image, or cube identifier/name."}}), &["id"])
}

pub fn tool_catalog() -> Vec<ToolSpec> {
    vec![
        tool("quay.host.status", "Read Quay/WSLC host health and host resource status. No side effects.", OperationKind::ReadOnly, no_args()),
        tool("quay.container.list", "List all containers known to WSLC. No side effects.", OperationKind::ReadOnly, no_args()),
        tool("quay.container.inspect", "Inspect one container by ID or name. No side effects.", OperationKind::ReadOnly, id_schema()),
        tool("quay.container.logs", "Read recent logs for one container. No side effects.", OperationKind::ReadOnly,
            object_schema(json!({"id":{"type":"string","minLength":1},"tail":{"type":"integer","minimum":1,"maximum":10000,"default":200}}), &["id"])),
        tool("quay.container.start", "Start a stopped container.", OperationKind::StateChanging, id_schema()),
        tool("quay.container.stop", "Stop a running container.", OperationKind::StateChanging, id_schema()),
        tool("quay.container.restart", "Restart a container.", OperationKind::StateChanging, id_schema()),
        tool("quay.container.run", "Create and run a container from an image. This changes local container state.", OperationKind::StateChanging,
            object_schema(json!({
                "image":{"type":"string","minLength":1},
                "name":{"type":"string"},
                "detach":{"type":"boolean","default":true},
                "remove":{"type":"boolean","default":false},
                "gpu":{"type":"boolean","default":false},
                "workdir":{"type":"string"},
                "network":{"type":"string"},
                "ports":{"type":"array","items":{"type":"string"}},
                "env":{"type":"object","additionalProperties":{"type":"string"}},
                "mounts":{"type":"array","items":{"type":"string"}},
                "command":{"type":"array","items":{"type":"string"}}
            }), &["image"])),
        tool("quay.container.clone", "Clone a container configuration under a new name. This creates a new container.", OperationKind::StateChanging,
            object_schema(json!({"id":{"type":"string","minLength":1},"name":{"type":"string","minLength":1}}), &["id","name"])),
        tool("quay.container.update_ports", "Recreate a stopped container with replacement published port bindings. Container recreation is a high-impact state change.", OperationKind::StateChanging,
            object_schema(json!({"id":{"type":"string","minLength":1},"ports":{"type":"array","items":{"type":"string"}}}), &["id","ports"])),
        tool("quay.container.update_env", "Recreate a container with replacement environment variables while preserving its other inspected configuration.", OperationKind::StateChanging,
            object_schema(json!({"id":{"type":"string","minLength":1},"env":{"type":"object","additionalProperties":{"type":"string"}}}), &["id","env"])),
        tool("quay.container.delete", "Delete a container. DESTRUCTIVE: Quay requires explicit human confirmation before execution.", OperationKind::Destructive, id_schema()),
        tool("quay.image.list", "List local images. No side effects.", OperationKind::ReadOnly, no_args()),
        tool("quay.image.inspect", "Inspect one local image. No side effects.", OperationKind::ReadOnly, id_schema()),
        tool("quay.image.pull", "Pull an image through Quay's background pull manager.", OperationKind::StateChanging,
            object_schema(json!({"reference":{"type":"string","minLength":1}}), &["reference"])),
        tool("quay.image.delete", "Delete a local image. DESTRUCTIVE: Quay requires explicit human confirmation before execution.", OperationKind::Destructive, id_schema()),
        tool("quay.cube.list", "List Quay Cubes. No side effects.", OperationKind::ReadOnly, no_args()),
        tool("quay.cube.inspect", "Inspect a Quay Cube. No side effects.", OperationKind::ReadOnly, id_schema()),
        tool("quay.cube.start", "Start all configured members of a Quay Cube.", OperationKind::StateChanging, id_schema()),
        tool("quay.cube.stop", "Stop all running members of a Quay Cube.", OperationKind::StateChanging, id_schema()),
        tool("quay.cube.create", "Create a Quay Cube definition.", OperationKind::StateChanging,
            object_schema(json!({"name":{"type":"string","minLength":1},"containers":{"type":"array","items":{"type":"object"}}}), &["name"])),
        tool("quay.cube.clone", "Clone a Quay Cube definition.", OperationKind::StateChanging,
            object_schema(json!({"id":{"type":"string","minLength":1},"name":{"type":"string","minLength":1}}), &["id","name"])),
        tool("quay.cube.delete", "Delete a Quay Cube definition. DESTRUCTIVE: Quay requires explicit human confirmation before execution.", OperationKind::Destructive, id_schema()),
        tool("quay.audit.query", "Query recent Quay operation audit records. No side effects.", OperationKind::ReadOnly,
            object_schema(json!({"limit":{"type":"integer","minimum":1,"maximum":1000,"default":100},"operation":{"type":"string"}}), &[])),
    ]
}

fn tool(name: &'static str, description: &'static str, kind: OperationKind, input_schema: Value) -> ToolSpec {
    ToolSpec { name, description, kind, input_schema }
}

pub fn tool_spec(name: &str) -> Option<ToolSpec> {
    tool_catalog().into_iter().find(|tool| tool.name == name)
}

pub fn dispatch_tool(operations: &QuayOperations, name: &str, arguments: Value) -> Result<Value, OperationError> {
    let spec = tool_spec(name).ok_or_else(|| OperationError::invalid_input(format!("unknown MCP tool: {name}")))?;
    if spec.kind == OperationKind::Destructive {
        return Err(OperationError::confirmation_required(format!("{name} requires explicit human approval")));
    }

    match name {
        "quay.host.status" => {
            let health = operations.invoke(json!({"cmd":"health"}))?;
            let resources = operations.invoke(json!({"cmd":"host_stats"}))?;
            Ok(json!({"health":health,"resources":resources}))
        }
        "quay.container.list" => run_cli(operations, vec!["container", "list", "--all", "--no-trunc", "--format", "json"]),
        "quay.container.inspect" => run_cli(operations, vec!["container", "inspect", required_string(&arguments, "id")?]),
        "quay.container.logs" => {
            let tail = arguments.get("tail").and_then(Value::as_u64).unwrap_or(200).clamp(1, 10_000);
            run_cli(operations, vec!["container", "logs", "--tail", &tail.to_string(), required_string(&arguments, "id")?])
        }
        "quay.container.start" => run_cli(operations, vec!["container", "start", required_string(&arguments, "id")?]),
        "quay.container.stop" => run_cli(operations, vec!["container", "stop", required_string(&arguments, "id")?]),
        "quay.container.restart" => run_cli(operations, vec!["container", "restart", required_string(&arguments, "id")?]),
        "quay.container.run" => run_container(operations, &arguments),
        "quay.container.clone" => clone_container(operations, &arguments),
        "quay.container.update_ports" => recreate_container(operations, &arguments, RecreateMode::Ports),
        "quay.container.update_env" => recreate_container(operations, &arguments, RecreateMode::Environment),
        "quay.image.list" => run_cli(operations, vec!["image", "list", "--no-trunc", "--format", "json"]),
        "quay.image.inspect" => run_cli(operations, vec!["image", "inspect", required_string(&arguments, "id")?]),
        "quay.image.pull" => {
            #[cfg(windows)]
            {
                let job = operations.pull_start(required_string(&arguments, "reference")?)?;
                serde_json::to_value(job).map_err(|error| OperationError::backend_failure(error.to_string()))
            }
            #[cfg(not(windows))]
            {
                Err(OperationError::runtime_unavailable("WSLC pulls are only available on Windows"))
            }
        }
        "quay.cube.list" | "quay.cube.inspect" | "quay.cube.start" | "quay.cube.stop" | "quay.cube.create" | "quay.cube.clone" => {
            Err(OperationError::backend_failure("Cube definitions are still frontend-owned; backend cube synchronization is required before MCP cube execution"))
        }
        "quay.audit.query" => operations.query_audit_json(&arguments),
        _ => Err(OperationError::invalid_input(format!("unsupported MCP tool: {name}"))),
    }
}

pub fn dispatch_destructive_after_approval(operations: &QuayOperations, name: &str, arguments: Value) -> Result<Value, OperationError> {
    match name {
        "quay.container.delete" => run_cli(operations, vec!["container", "rm", required_string(&arguments, "id")?]),
        "quay.image.delete" => run_cli(operations, vec!["image", "rm", required_string(&arguments, "id")?]),
        "quay.cube.delete" => Err(OperationError::backend_failure("Cube definitions are still frontend-owned; backend cube synchronization is required before MCP cube deletion")),
        _ => Err(OperationError::invalid_input(format!("{name} is not a destructive MCP tool"))),
    }
}

fn run_cli(operations: &QuayOperations, args: Vec<&str>) -> Result<Value, OperationError> {
    operations.invoke(json!({"cmd":"run_cli","args":args}))
}

fn required_string<'a>(arguments: &'a Value, key: &str) -> Result<&'a str, OperationError> {
    arguments
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| OperationError::invalid_input(format!("missing or empty {key}")))
}

fn run_container(operations: &QuayOperations, arguments: &Value) -> Result<Value, OperationError> {
    let mut args = vec!["run".to_string()];
    if arguments.get("detach").and_then(Value::as_bool).unwrap_or(true) { args.push("-d".into()); }
    if arguments.get("remove").and_then(Value::as_bool).unwrap_or(false) { args.push("--rm".into()); }
    if arguments.get("gpu").and_then(Value::as_bool).unwrap_or(false) { args.extend(["--gpus".into(), "all".into()]); }
    push_pair(&mut args, "--name", optional_string(arguments, "name"));
    push_pair(&mut args, "-w", optional_string(arguments, "workdir"));
    push_pair(&mut args, "--network", optional_string(arguments, "network"));
    for port in string_array(arguments, "ports")? { args.extend(["-p".into(), port]); }
    if let Some(env) = arguments.get("env") {
        let object = env.as_object().ok_or_else(|| OperationError::invalid_input("env must be an object"))?;
        for (key, value) in object {
            let value = value.as_str().ok_or_else(|| OperationError::invalid_input(format!("env.{key} must be a string")))?;
            args.extend(["-e".into(), format!("{key}={value}")]);
        }
    }
    for mount in string_array(arguments, "mounts")? { args.extend(["-v".into(), mount]); }
    args.push(required_string(arguments, "image")?.to_string());
    args.extend(string_array(arguments, "command")?);
    operations.invoke(json!({"cmd":"run_cli","args":args}))
}

fn optional_string<'a>(arguments: &'a Value, key: &str) -> Option<&'a str> {
    arguments.get(key).and_then(Value::as_str).map(str::trim).filter(|value| !value.is_empty())
}

fn push_pair(args: &mut Vec<String>, flag: &str, value: Option<&str>) {
    if let Some(value) = value { args.extend([flag.to_string(), value.to_string()]); }
}

fn string_array(arguments: &Value, key: &str) -> Result<Vec<String>, OperationError> {
    let Some(value) = arguments.get(key) else { return Ok(Vec::new()); };
    let array = value.as_array().ok_or_else(|| OperationError::invalid_input(format!("{key} must be an array")))?;
    array
        .iter()
        .map(|item| item.as_str().map(str::to_string).ok_or_else(|| OperationError::invalid_input(format!("{key} entries must be strings"))))
        .collect()
}

#[derive(Clone, Copy)]
enum RecreateMode { Ports, Environment }

fn clone_container(operations: &QuayOperations, arguments: &Value) -> Result<Value, OperationError> {
    let id = required_string(arguments, "id")?;
    let name = required_string(arguments, "name")?;
    let inspected = run_cli(operations, vec!["container", "inspect", id])?;
    let config = inspected_config(&inspected)?;
    let mut args = existing_run_args(&config, Some(name), None, None)?;
    args.insert(1, "-d".into());
    operations.invoke(json!({"cmd":"run_cli","args":args}))
}

fn recreate_container(operations: &QuayOperations, arguments: &Value, mode: RecreateMode) -> Result<Value, OperationError> {
    let id = required_string(arguments, "id")?;
    let inspected = run_cli(operations, vec!["container", "inspect", id])?;
    let config = inspected_config(&inspected)?;
    let was_running = config.running;
    if matches!(mode, RecreateMode::Ports) && was_running {
        return Err(OperationError::conflict("stop the container before updating ports"));
    }
    if was_running { run_cli(operations, vec!["container", "stop", &config.name])?; }
    run_cli(operations, vec!["container", "rm", &config.name])?;

    let ports = if matches!(mode, RecreateMode::Ports) { Some(string_array(arguments, "ports")?) } else { None };
    let env = if matches!(mode, RecreateMode::Environment) { Some(env_pairs(arguments)?) } else { None };
    let args = existing_run_args(&config, None, ports.as_deref(), env.as_deref())?;
    let created = operations.invoke(json!({"cmd":"run_cli","args":args}))?;
    if !was_running { run_cli(operations, vec!["container", "stop", &config.name])?; }
    Ok(created)
}

fn env_pairs(arguments: &Value) -> Result<Vec<String>, OperationError> {
    let object = arguments.get("env").and_then(Value::as_object).ok_or_else(|| OperationError::invalid_input("env must be an object"))?;
    object.iter().map(|(key, value)| {
        value.as_str().map(|value| format!("{key}={value}")).ok_or_else(|| OperationError::invalid_input(format!("env.{key} must be a string")))
    }).collect()
}

#[derive(Debug)]
struct ExistingConfig {
    name: String,
    image: String,
    command: Vec<String>,
    ports: Vec<String>,
    env: Vec<String>,
    mounts: Vec<String>,
    workdir: String,
    network: Option<String>,
    gpu: bool,
    running: bool,
}

fn inspected_config(result: &Value) -> Result<ExistingConfig, OperationError> {
    let output = result.get("output").and_then(Value::as_str).ok_or_else(|| OperationError::backend_failure("container inspect returned no JSON output"))?;
    let parsed: Value = serde_json::from_str(output).map_err(|error| OperationError::backend_failure(format!("invalid container inspect JSON: {error}")))?;
    let root = parsed.as_array().and_then(|values| values.first()).unwrap_or(&parsed);
    let config = object_any(root, &["Config", "config"]);
    let host_config = object_any(root, &["HostConfig", "hostConfig"]);
    let state = object_any(root, &["State", "state"]);
    let name = string_any(root, &["Name", "name"]).unwrap_or_default().trim_start_matches('/').to_string();
    let image = string_any(config, &["Image", "image"]).or_else(|| string_any(root, &["Image", "image"])).unwrap_or_default().to_string();
    if name.is_empty() || image.is_empty() { return Err(OperationError::backend_failure("container inspect did not include name/image")); }
    let mut command = array_strings(config, &["Entrypoint", "entrypoint"]);
    command.extend(array_strings(config, &["Cmd", "cmd"]));
    let env = array_strings(config, &["Env", "env"]);
    let workdir = string_any(config, &["WorkingDir", "workingDir"]).unwrap_or("/").to_string();
    let network = string_any(host_config, &["NetworkMode", "networkMode"]).map(str::to_string).filter(|value| value != "default" && value != "bridge" && !value.is_empty());
    let gpu = host_config.get("DeviceRequests").or_else(|| host_config.get("deviceRequests")).is_some_and(|value| value.to_string().to_ascii_lowercase().contains("gpu"));
    let running = state.get("Running").or_else(|| state.get("running")).and_then(Value::as_bool).unwrap_or(false);
    Ok(ExistingConfig { name, image, command, ports: inspect_ports(root, host_config), env, mounts: inspect_mounts(root), workdir, network, gpu, running })
}

fn existing_run_args(config: &ExistingConfig, name: Option<&str>, ports: Option<&[String]>, env: Option<&[String]>) -> Result<Vec<String>, OperationError> {
    let mut args = vec!["run".to_string(), "-d".to_string(), "--name".to_string(), name.unwrap_or(&config.name).to_string()];
    if config.gpu { args.extend(["--gpus".into(), "all".into()]); }
    if let Some(network) = &config.network { args.extend(["--network".into(), network.clone()]); }
    if !config.workdir.trim().is_empty() { args.extend(["-w".into(), config.workdir.clone()]); }
    for port in ports.unwrap_or(&config.ports) { args.extend(["-p".into(), port.clone()]); }
    for entry in env.unwrap_or(&config.env) { args.extend(["-e".into(), entry.clone()]); }
    for mount in &config.mounts { args.extend(["-v".into(), mount.clone()]); }
    args.push(config.image.clone());
    args.extend(config.command.clone());
    Ok(args)
}

fn object_any<'a>(value: &'a Value, names: &[&str]) -> &'a Map<String, Value> {
    names.iter().find_map(|name| value.get(*name).and_then(Value::as_object)).unwrap_or_else(|| empty_object())
}

fn empty_object() -> &'static Map<String, Value> {
    static EMPTY: std::sync::OnceLock<Map<String, Value>> = std::sync::OnceLock::new();
    EMPTY.get_or_init(Map::new)
}

fn string_any<'a>(object: &'a Map<String, Value>, names: &[&str]) -> Option<&'a str> {
    names.iter().find_map(|name| object.get(*name).and_then(Value::as_str))
}

fn array_strings(object: &Map<String, Value>, names: &[&str]) -> Vec<String> {
    names.iter().find_map(|name| object.get(*name).and_then(Value::as_array)).map(|items| {
        items.iter().filter_map(Value::as_str).map(str::to_string).collect()
    }).unwrap_or_default()
}

fn inspect_ports(root: &Value, host_config: &Map<String, Value>) -> Vec<String> {
    let bindings = root.get("Ports").or_else(|| root.get("ports")).and_then(Value::as_object)
        .or_else(|| host_config.get("PortBindings").or_else(|| host_config.get("portBindings")).and_then(Value::as_object));
    let Some(bindings) = bindings else { return Vec::new(); };
    let mut result = Vec::new();
    for (container_port, raw_bindings) in bindings {
        let mut split = container_port.split('/');
        let port = split.next().unwrap_or(container_port);
        let protocol = split.next().unwrap_or("tcp");
        let Some(entries) = raw_bindings.as_array() else { continue; };
        for entry in entries {
            let host_ip = entry.get("HostIp").or_else(|| entry.get("hostIp")).and_then(Value::as_str).unwrap_or("").trim();
            let host_port = entry.get("HostPort").or_else(|| entry.get("hostPort")).and_then(Value::as_str).unwrap_or("").trim();
            if host_port.is_empty() { continue; }
            let prefix = if host_ip.is_empty() { host_port.to_string() } else { format!("{host_ip}:{host_port}") };
            result.push(format!("{prefix}:{port}{}", if protocol == "udp" { "/udp" } else { "" }));
        }
    }
    result
}

fn inspect_mounts(root: &Value) -> Vec<String> {
    root.get("Mounts").or_else(|| root.get("mounts")).and_then(Value::as_array).map(|mounts| {
        mounts.iter().filter_map(|mount| {
            let source = mount.get("Source").or_else(|| mount.get("source")).and_then(Value::as_str)?.trim();
            let destination = mount.get("Destination").or_else(|| mount.get("destination")).and_then(Value::as_str)?.trim();
            if source.is_empty() || destination.is_empty() { return None; }
            let read_write = mount.get("RW").or_else(|| mount.get("rw")).and_then(Value::as_bool).unwrap_or(true);
            Some(format!("{source}:{destination}{}", if read_write { "" } else { ":ro" }))
        }).collect()
    }).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catalog_contains_exact_v1_tools_and_no_exec() {
        let expected = vec![
            "quay.host.status",
            "quay.container.list", "quay.container.inspect", "quay.container.logs",
            "quay.container.start", "quay.container.stop", "quay.container.restart",
            "quay.container.run", "quay.container.clone", "quay.container.update_ports",
            "quay.container.update_env", "quay.container.delete",
            "quay.image.list", "quay.image.inspect", "quay.image.pull", "quay.image.delete",
            "quay.cube.list", "quay.cube.inspect", "quay.cube.start", "quay.cube.stop",
            "quay.cube.create", "quay.cube.clone", "quay.cube.delete",
            "quay.audit.query",
        ];
        let tools = tool_catalog();
        assert_eq!(tools.iter().map(|tool| tool.name).collect::<Vec<_>>(), expected);
        assert!(!tools.iter().any(|tool| tool.name.contains("exec") || tool.name.contains("shell")));
    }

    #[test]
    fn every_schema_is_strict_object_schema() {
        for tool in tool_catalog() {
            assert_eq!(tool.input_schema.get("type").and_then(Value::as_str), Some("object"), "{}", tool.name);
            assert_eq!(tool.input_schema.get("additionalProperties").and_then(Value::as_bool), Some(false), "{}", tool.name);
        }
    }

    #[test]
    fn delete_tools_are_destructive() {
        for name in ["quay.container.delete", "quay.image.delete", "quay.cube.delete"] {
            assert_eq!(tool_spec(name).unwrap().kind, OperationKind::Destructive);
        }
    }

    #[test]
    fn parses_inspected_container_config() {
        let result = json!({"output": r#"[{"Name":"/demo","Config":{"Image":"nginx:latest","Env":["A=B"],"Cmd":["nginx"],"WorkingDir":"/app"},"HostConfig":{"NetworkMode":"quay-net","PortBindings":{"80/tcp":[{"HostIp":"127.0.0.1","HostPort":"8080"}]}},"State":{"Running":true},"Mounts":[{"Source":"C:/data","Destination":"/data","RW":false}]}]"#});
        let config = inspected_config(&result).unwrap();
        assert_eq!(config.name, "demo");
        assert_eq!(config.image, "nginx:latest");
        assert_eq!(config.ports, vec!["127.0.0.1:8080:80"]);
        assert_eq!(config.env, vec!["A=B"]);
        assert_eq!(config.mounts, vec!["C:/data:/data:ro"]);
        assert!(config.running);
    }
}
