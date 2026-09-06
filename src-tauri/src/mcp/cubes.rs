use crate::operations::OperationError;
use serde_json::Value;
use std::fs;
use std::io::Write;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, OnceLock};

struct CubeRegistryState {
    path: Option<PathBuf>,
    cubes: Vec<Value>,
    notifier: Arc<dyn Fn(Vec<Value>) + Send + Sync>,
}

fn shared_state() -> Arc<Mutex<CubeRegistryState>> {
    static STATE: OnceLock<Arc<Mutex<CubeRegistryState>>> = OnceLock::new();
    STATE.get_or_init(|| Arc::new(Mutex::new(CubeRegistryState {
        path: None,
        cubes: Vec::new(),
        notifier: Arc::new(|_| {}),
    }))).clone()
}

#[derive(Clone)]
pub struct CubeRegistry { state: Arc<Mutex<CubeRegistryState>> }

impl CubeRegistry {
    pub fn global() -> Self { Self { state: shared_state() } }

    pub fn initialize(&self, path: PathBuf, notifier: Arc<dyn Fn(Vec<Value>) + Send + Sync>) {
        let cubes = fs::read_to_string(&path).ok().and_then(|body| serde_json::from_str::<Vec<Value>>(&body).ok()).unwrap_or_default();
        let mut state = self.state.lock().unwrap();
        state.path = Some(path);
        state.cubes = cubes;
        state.notifier = notifier;
    }

    pub fn list(&self) -> Vec<Value> { self.state.lock().unwrap().cubes.clone() }

    pub fn find(&self, id_or_name: &str) -> Option<Value> {
        self.state.lock().unwrap().cubes.iter().find(|cube| {
            cube.get("id").and_then(Value::as_str).is_some_and(|id| id == id_or_name)
                || cube.get("name").and_then(Value::as_str).is_some_and(|name| name == id_or_name)
        }).cloned()
    }

    pub fn replace_from_ui(&self, cubes: Vec<Value>) -> Result<(), OperationError> { self.replace(cubes, false) }

    pub fn upsert_from_mcp(&self, cube: Value) -> Result<Value, OperationError> {
        let id = cube.get("id").and_then(Value::as_str).ok_or_else(|| OperationError::invalid_input("cube id is required"))?.to_string();
        let mut cubes = self.list();
        cubes.retain(|item| item.get("id").and_then(Value::as_str) != Some(id.as_str()));
        cubes.push(cube.clone());
        self.replace(cubes, true)?;
        Ok(cube)
    }

    pub fn delete_from_mcp(&self, id_or_name: &str) -> Result<Value, OperationError> {
        let existing = self.find(id_or_name).ok_or_else(|| OperationError::not_found(format!("cube not found: {id_or_name}")))?;
        let existing_id = existing.get("id").and_then(Value::as_str).unwrap_or(id_or_name).to_string();
        let mut cubes = self.list();
        cubes.retain(|item| item.get("id").and_then(Value::as_str) != Some(existing_id.as_str()));
        self.replace(cubes, true)?;
        Ok(existing)
    }

    fn replace(&self, cubes: Vec<Value>, notify: bool) -> Result<(), OperationError> {
        let (path, notifier) = {
            let state = self.state.lock().unwrap();
            (state.path.clone(), state.notifier.clone())
        };
        if let Some(path) = path {
            if let Some(parent) = path.parent() {
                fs::create_dir_all(parent).map_err(|error| OperationError::backend_failure(format!("could not create Cube registry directory: {error}")))?;
            }
            let body = serde_json::to_vec_pretty(&cubes).map_err(|error| OperationError::backend_failure(format!("could not serialize Cube registry: {error}")))?;
            let temp = path.with_extension("json.tmp");
            let mut file = fs::File::create(&temp).map_err(|error| OperationError::backend_failure(format!("could not create Cube registry: {error}")))?;
            file.write_all(&body).and_then(|_| file.sync_all()).map_err(|error| OperationError::backend_failure(format!("could not write Cube registry: {error}")))?;
            fs::rename(&temp, &path).map_err(|error| OperationError::backend_failure(format!("could not replace Cube registry: {error}")))?;
        }
        self.state.lock().unwrap().cubes = cubes.clone();
        if notify { notifier(cubes); }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn finds_cube_by_id_or_name() {
        let registry = CubeRegistry::global();
        registry.replace_from_ui(vec![json!({"id":"demo-id","name":"Demo","specs":[]})]).unwrap();
        assert_eq!(registry.find("demo-id").unwrap()["name"], "Demo");
        assert_eq!(registry.find("Demo").unwrap()["id"], "demo-id");
    }
}
