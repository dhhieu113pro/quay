use crate::operations::{OperationError, QuayOperations};
use serde_json::{json, Value};
use std::time::{SystemTime, UNIX_EPOCH};

pub fn dispatch(operations: &QuayOperations, name: &str, arguments: &Value) -> Result<Value, OperationError> {
    match name {
        "quay.cube.list" => Ok(Value::Array(operations.cube_registry().list())),
        "quay.cube.inspect" => {
            let id = required_string(arguments, "id")?;
            operations.cube_registry().find(id).ok_or_else(|| OperationError::not_found(format!("cube not found: {id}")))
        }
        "quay.cube.start" => start_cube(operations, required_string(arguments, "id")?),
        "quay.cube.stop" => stop_cube(operations, required_string(arguments, "id")?),
        "quay.cube.create" => create_cube(operations, arguments),
        "quay.cube.clone" => clone_cube(operations, arguments),
        _ => Err(OperationError::invalid_input(format!("unsupported Cube tool: {name}"))),
    }
}

pub fn dispatch_destructive(operations: &QuayOperations, name: &str, arguments: &Value) -> Result<Value, OperationError> {
    match name {
        "quay.cube.delete" => operations.cube_registry().delete_from_mcp(required_string(arguments, "id")?),
        _ => Err(OperationError::invalid_input(format!("unsupported destructive Cube tool: {name}"))),
    }
}

fn create_cube(operations: &QuayOperations, arguments: &Value) -> Result<Value, OperationError> {
    let name = required_string(arguments, "name")?;
    let id = unique_id(name);
    let specs = arguments.get("containers").and_then(Value::as_array).cloned().unwrap_or_default().into_iter()
        .map(|value| normalize_spec(value, name, &id)).collect::<Result<Vec<_>, _>>()?;
    let cube = json!({
        "id": id,
        "name": name,
        "network": format!("{}NetWork", compact_name(name)),
        "env": "",
        "builtIn": false,
        "autoStart": false,
        "workspacePath": format!("cubes/{}", slug(name)),
        "specs": specs
    });
    operations.cube_registry().upsert_from_mcp(cube)
}

fn clone_cube(operations: &QuayOperations, arguments: &Value) -> Result<Value, OperationError> {
    let source = operations.cube_registry().find(required_string(arguments, "id")?)
        .ok_or_else(|| OperationError::not_found("source cube not found"))?;
    let name = required_string(arguments, "name")?;
    let id = unique_id(name);
    let mut cube = source.as_object().cloned().ok_or_else(|| OperationError::backend_failure("invalid Cube registry record"))?;
    cube.insert("id".into(), Value::String(id.clone()));
    cube.insert("name".into(), Value::String(name.to_string()));
    cube.insert("network".into(), Value::String(format!("{}NetWork", compact_name(name))));
    cube.insert("builtIn".into(), Value::Bool(false));
    if let Some(specs) = cube.get_mut("specs").and_then(Value::as_array_mut) {
        for spec in specs {
            if let Some(object) = spec.as_object_mut() {
                object.insert("groupId".into(), Value::String(id.clone()));
            }
        }
    }
    operations.cube_registry().upsert_from_mcp(Value::Object(cube))
}

fn start_cube(operations: &QuayOperations, id: &str) -> Result<Value, OperationError> {
    let cube = operations.cube_registry().find(id).ok_or_else(|| OperationError::not_found(format!("cube not found: {id}")))?;
    let network = cube.get("network").and_then(Value::as_str).unwrap_or("").trim();
    if !network.is_empty() { operations.invoke(json!({"cmd":"ensure_network","name":network}))?; }
    let specs = cube.get("specs").and_then(Value::as_array).cloned().unwrap_or_default();
    let mut results = Vec::new();
    for spec in specs {
        let container_name = spec.get("name").and_then(Value::as_str).unwrap_or("").trim();
        if container_name.is_empty() { continue; }
        match run_cli(operations, vec!["container", "inspect", container_name]) {
            Ok(_) => results.push(run_cli(operations, vec!["container", "start", container_name])?),
            Err(error) if error.code() == "not_found" || error.code() == "backend_failure" => {
                results.push(run_spec(operations, &spec, network)?);
            }
            Err(error) => return Err(error),
        }
    }
    Ok(json!({"cube":id,"started":results.len(),"results":results}))
}

fn stop_cube(operations: &QuayOperations, id: &str) -> Result<Value, OperationError> {
    let cube = operations.cube_registry().find(id).ok_or_else(|| OperationError::not_found(format!("cube not found: {id}")))?;
    let mut names = cube.get("specs").and_then(Value::as_array).cloned().unwrap_or_default().into_iter()
        .filter_map(|spec| spec.get("name").and_then(Value::as_str).map(str::to_string)).collect::<Vec<_>>();
    names.reverse();
    let mut stopped = 0usize;
    for name in names {
        if run_cli(operations, vec!["container", "stop", name.as_str()]).is_ok() { stopped += 1; }
    }
    Ok(json!({"cube":id,"stopped":stopped}))
}

fn run_spec(operations: &QuayOperations, spec: &Value, network: &str) -> Result<Value, OperationError> {
    let image = spec.get("image").and_then(Value::as_str).map(str::trim).filter(|value| !value.is_empty())
        .ok_or_else(|| OperationError::invalid_input("Cube container image is required"))?;
    let mut args = vec!["run".to_string()];
    if spec.get("detach").and_then(Value::as_bool).unwrap_or(true) { args.push("-d".into()); }
    if spec.get("remove").and_then(Value::as_bool).unwrap_or(false) { args.push("--rm".into()); }
    if spec.get("gpu").and_then(Value::as_bool).unwrap_or(false) { args.extend(["--gpus".into(), "all".into()]); }
    push_pair(&mut args, "--name", spec.get("name").and_then(Value::as_str));
    push_pair(&mut args, "-w", spec.get("workdir").and_then(Value::as_str));
    if !network.is_empty() { args.extend(["--network".into(), network.to_string()]); }
    for port in lines(spec.get("ports").and_then(Value::as_str)) { args.extend(["-p".into(), port]); }
    for env in lines(spec.get("env").and_then(Value::as_str)) { args.extend(["-e".into(), env]); }
    for mount in lines(spec.get("mounts").and_then(Value::as_str)) { args.extend(["-v".into(), mount]); }
    args.push(image.to_string());
    if let Some(command) = spec.get("command").and_then(Value::as_str) { args.extend(command.split_whitespace().map(str::to_string)); }
    operations.invoke(json!({"cmd":"run_cli","args":args}))
}

fn normalize_spec(value: Value, cube_name: &str, group_id: &str) -> Result<Value, OperationError> {
    let mut object = value.as_object().cloned().ok_or_else(|| OperationError::invalid_input("Cube containers must be objects"))?;
    let image = object.get("image").and_then(Value::as_str).unwrap_or("").trim().to_string();
    if image.is_empty() { return Err(OperationError::invalid_input("Cube container image is required")); }
    let member = object.get("name").and_then(Value::as_str).map(str::trim).filter(|value| !value.is_empty()).unwrap_or(&image).to_string();
    let name = if member.to_ascii_lowercase().starts_with(&format!("{}-", cube_name.to_ascii_lowercase())) { member } else { format!("{cube_name}-{member}") };
    object.insert("image".into(), Value::String(image));
    object.insert("name".into(), Value::String(name));
    object.insert("groupId".into(), Value::String(group_id.to_string()));
    for key in ["command", "ports", "env", "mounts", "workdir"] { object.entry(key.into()).or_insert_with(|| Value::String(String::new())); }
    for (key, default) in [("gpu", false), ("remove", false), ("detach", true)] { object.entry(key.into()).or_insert(Value::Bool(default)); }
    Ok(Value::Object(object))
}

fn required_string<'a>(arguments: &'a Value, key: &str) -> Result<&'a str, OperationError> {
    arguments.get(key).and_then(Value::as_str).map(str::trim).filter(|value| !value.is_empty())
        .ok_or_else(|| OperationError::invalid_input(format!("missing or empty {key}")))
}
fn run_cli<T: serde::Serialize>(operations: &QuayOperations, args: T) -> Result<Value, OperationError> { operations.invoke(json!({"cmd":"run_cli","args":args})) }
fn push_pair(args: &mut Vec<String>, flag: &str, value: Option<&str>) { if let Some(value) = value.map(str::trim).filter(|value| !value.is_empty()) { args.extend([flag.into(), value.into()]); } }
fn lines(value: Option<&str>) -> Vec<String> { value.unwrap_or("").lines().map(str::trim).filter(|value| !value.is_empty()).map(str::to_string).collect() }
fn compact_name(name: &str) -> String { name.trim().split_whitespace().collect::<String>() }
fn slug(name: &str) -> String { let value = name.trim().to_ascii_lowercase().chars().map(|c| if c.is_ascii_alphanumeric() { c } else { '-' }).collect::<String>(); value.trim_matches('-').to_string() }
fn unique_id(name: &str) -> String {
    let millis = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis();
    format!("{}-{millis}", slug(name))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn cube_ids_are_slugged() { assert!(unique_id("My Cube").starts_with("my-cube-")); }
    #[test] fn line_fields_ignore_blank_lines() { assert_eq!(lines(Some("8080:80\n\n9090:90")), vec!["8080:80", "9090:90"]); }
}
