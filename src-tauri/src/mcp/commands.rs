use crate::mcp::config::McpConfig;
use crate::mcp::confirmation::{ConfirmationBroker, ConfirmationDecision, ConfirmationRequest};
use crate::mcp::server::McpRuntime;
use crate::operations::{OperationError, QuayOperations};
use serde::Serialize;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpStatus {
    pub enabled: bool,
    pub running: bool,
    pub endpoint: String,
    pub port: u16,
    pub connected_clients: usize,
    pub pending_confirmations: usize,
}

pub struct McpState {
    config_path: PathBuf,
    config: Mutex<McpConfig>,
    runtime: tokio::sync::Mutex<Option<McpRuntime>>,
    operations: QuayOperations,
    confirmations: ConfirmationBroker,
    app: AppHandle,
}

impl McpState {
    pub fn new(config_path: PathBuf, operations: QuayOperations, app: AppHandle) -> Self {
        let config = match McpConfig::load(&config_path) {
            Ok(config) => config,
            Err(error) => {
                eprintln!("mcp config: {error}");
                McpConfig::default()
            }
        };
        let event_app = app.clone();
        let confirmations = ConfirmationBroker::with_notifier(
            Duration::from_secs(60),
            Arc::new(move |request| {
                let _ = event_app.emit("mcp://confirmation-requested", request);
            }),
        );
        Self {
            config_path,
            config: Mutex::new(config),
            runtime: tokio::sync::Mutex::new(None),
            operations,
            confirmations,
            app,
        }
    }

    pub fn config(&self) -> McpConfig { self.config.lock().unwrap().clone() }

    pub async fn start_initial(&self) -> Result<(), OperationError> {
        let config = self.config();
        if !config.enabled { return Ok(()); }
        self.replace_runtime(Some(McpRuntime::start(&config, self.operations.clone(), self.confirmations.clone()).await?)).await;
        self.emit_status().await;
        Ok(())
    }

    pub async fn status(&self) -> McpStatus {
        let config = self.config();
        let runtime = self.runtime.lock().await;
        McpStatus {
            enabled: config.enabled,
            running: runtime.as_ref().is_some_and(McpRuntime::is_running),
            endpoint: config.endpoint(),
            port: config.port,
            connected_clients: 0,
            pending_confirmations: self.confirmations.pending().len(),
        }
    }

    async fn emit_status(&self) {
        let _ = self.app.emit("mcp://status-changed", self.status().await);
    }

    async fn replace_runtime(&self, runtime: Option<McpRuntime>) {
        let old = {
            let mut guard = self.runtime.lock().await;
            std::mem::replace(&mut *guard, runtime)
        };
        if let Some(mut old) = old { old.shutdown().await; }
    }

    pub async fn set_enabled(&self, enabled: bool) -> Result<McpStatus, OperationError> {
        let current = self.config();
        if current.enabled == enabled {
            return Ok(self.status().await);
        }

        if enabled {
            let mut next = current.clone();
            next.enabled = true;
            next.validate()?;
            let runtime = McpRuntime::start(&next, self.operations.clone(), self.confirmations.clone()).await?;
            next.save(&self.config_path)?;
            *self.config.lock().unwrap() = next;
            self.replace_runtime(Some(runtime)).await;
        } else {
            let mut next = current;
            next.enabled = false;
            next.save(&self.config_path)?;
            *self.config.lock().unwrap() = next;
            self.replace_runtime(None).await;
        }
        self.emit_status().await;
        Ok(self.status().await)
    }

    pub async fn set_port(&self, port: u16) -> Result<McpStatus, OperationError> {
        let current = self.config();
        let mut next = current.clone();
        next.port = port;
        next.validate()?;
        if next.port == current.port { return Ok(self.status().await); }

        if next.enabled {
            let runtime = McpRuntime::start(&next, self.operations.clone(), self.confirmations.clone()).await?;
            next.save(&self.config_path)?;
            *self.config.lock().unwrap() = next;
            self.replace_runtime(Some(runtime)).await;
        } else {
            next.save(&self.config_path)?;
            *self.config.lock().unwrap() = next;
        }
        self.emit_status().await;
        Ok(self.status().await)
    }

    pub fn resolve_confirmation(&self, id: &str, approve: bool) -> Result<(), OperationError> {
        self.confirmations.resolve(
            id,
            if approve { ConfirmationDecision::Approve } else { ConfirmationDecision::Reject },
        )
    }

    pub fn pending_confirmations(&self) -> Vec<ConfirmationRequest> { self.confirmations.pending() }

    pub fn cancel_now(&self) {
        if let Some(runtime) = self.runtime.blocking_lock().as_ref() { runtime.cancel(); }
    }
}

#[tauri::command]
pub async fn mcp_get_status(state: State<'_, McpState>) -> Result<McpStatus, String> {
    Ok(state.status().await)
}

#[tauri::command]
pub async fn mcp_set_enabled(state: State<'_, McpState>, enabled: bool) -> Result<McpStatus, String> {
    state.set_enabled(enabled).await.map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn mcp_set_port(state: State<'_, McpState>, port: u16) -> Result<McpStatus, String> {
    state.set_port(port).await.map_err(|error| error.to_string())
}

#[tauri::command]
pub fn mcp_confirm(state: State<'_, McpState>, id: String, approve: bool) -> Result<(), String> {
    state.resolve_confirmation(&id, approve).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn mcp_pending_confirmations(state: State<'_, McpState>) -> Vec<ConfirmationRequest> {
    state.pending_confirmations()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn status_shape_keeps_configured_endpoint() {
        let config = McpConfig::default();
        assert_eq!(config.endpoint(), "http://127.0.0.1:47831/mcp");
    }
}
