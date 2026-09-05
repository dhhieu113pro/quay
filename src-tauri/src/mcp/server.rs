use crate::mcp::config::McpConfig;
use crate::mcp::confirmation::ConfirmationBroker;
use crate::mcp::tools::{dispatch_destructive_after_approval, dispatch_tool, tool_catalog, tool_spec};
use crate::operations::{OperationError, OperationKind, QuayOperations};
use rmcp::model::{
    CallToolRequestParams, CallToolResponse, CallToolResult, Implementation, ListToolsResult,
    PaginatedRequestParams, ProtocolVersion, ServerCapabilities, ServerInfo, Tool, ToolAnnotations,
};
use rmcp::service::RequestContext;
use rmcp::transport::streamable_http_server::{
    session::local::LocalSessionManager, StreamableHttpServerConfig, StreamableHttpService,
};
use rmcp::{ErrorData as McpError, RoleServer, ServerHandler};
use serde_json::Value;
use std::sync::Arc;
use tokio::task::JoinHandle;
use tokio_util::sync::CancellationToken;

#[derive(Clone)]
pub struct QuayMcpServer {
    operations: QuayOperations,
    confirmations: ConfirmationBroker,
}

impl QuayMcpServer {
    pub fn new(operations: QuayOperations, confirmations: ConfirmationBroker) -> Self {
        Self { operations, confirmations }
    }

    fn rmcp_tool(name: &str) -> Result<Tool, McpError> {
        let spec = tool_spec(name).ok_or_else(|| McpError::invalid_params(format!("unknown tool: {name}"), None))?;
        let schema = spec
            .input_schema
            .as_object()
            .cloned()
            .ok_or_else(|| McpError::internal_error("tool schema is not an object", None))?;
        let annotations = ToolAnnotations::new()
            .read_only(spec.kind == OperationKind::ReadOnly)
            .destructive(spec.kind == OperationKind::Destructive)
            .open_world(false);
        Ok(Tool::new(spec.name, spec.description, Arc::new(schema)).with_annotations(annotations))
    }

    async fn execute(&self, request: CallToolRequestParams) -> Result<CallToolResponse, McpError> {
        let name = request.name.to_string();
        let arguments = Value::Object(request.arguments.unwrap_or_default());
        let spec = tool_spec(&name).ok_or_else(|| McpError::invalid_params(format!("unknown tool: {name}"), None))?;

        if spec.kind == OperationKind::Destructive {
            if let Err(error) = self.confirmations.request(&name, arguments.clone()).await {
                return Ok(CallToolResult::structured_error(operation_error_value(&error)).into());
            }
            let operations = self.operations.clone();
            let result = tokio::task::spawn_blocking(move || {
                dispatch_destructive_after_approval(&operations, &name, arguments)
            })
            .await
            .map_err(|error| McpError::internal_error(format!("MCP worker failed: {error}"), None))?;
            return Ok(operation_result(result).into());
        }

        let operations = self.operations.clone();
        let result = tokio::task::spawn_blocking(move || dispatch_tool(&operations, &name, arguments))
            .await
            .map_err(|error| McpError::internal_error(format!("MCP worker failed: {error}"), None))?;
        Ok(operation_result(result).into())
    }
}

impl ServerHandler for QuayMcpServer {
    fn get_info(&self) -> ServerInfo {
        ServerInfo::new(ServerCapabilities::builder().enable_tools().build())
            .with_server_info(Implementation::new("quay", env!("CARGO_PKG_VERSION")))
            .with_protocol_version(ProtocolVersion::V_2026_07_28)
            .with_instructions(
                "Control Quay containers, images, cubes, and audit data. Destructive operations require explicit approval in Quay. Raw shell execution is not exposed."
                    .to_string(),
            )
    }

    async fn list_tools(
        &self,
        _request: Option<PaginatedRequestParams>,
        _context: RequestContext<RoleServer>,
    ) -> Result<ListToolsResult, McpError> {
        let tools = tool_catalog()
            .iter()
            .map(|spec| Self::rmcp_tool(spec.name))
            .collect::<Result<Vec<_>, _>>()?;
        Ok(ListToolsResult::with_all_items(tools))
    }

    async fn call_tool(
        &self,
        request: CallToolRequestParams,
        _context: RequestContext<RoleServer>,
    ) -> Result<CallToolResponse, McpError> {
        self.execute(request).await
    }

    fn get_tool(&self, name: &str) -> Option<Tool> { Self::rmcp_tool(name).ok() }
}

fn operation_result(result: Result<Value, OperationError>) -> CallToolResult {
    match result {
        Ok(value) => CallToolResult::structured(value),
        Err(error) => CallToolResult::structured_error(operation_error_value(&error)),
    }
}

fn operation_error_value(error: &OperationError) -> Value {
    serde_json::json!({ "code": error.code(), "message": error.message() })
}

pub struct McpRuntime {
    endpoint: String,
    cancellation: CancellationToken,
    task: Option<JoinHandle<()>>,
}

impl McpRuntime {
    pub async fn start(
        config: &McpConfig,
        operations: QuayOperations,
        confirmations: ConfirmationBroker,
    ) -> Result<Self, OperationError> {
        config.validate()?;
        let listener = tokio::net::TcpListener::bind((config.bind, config.port))
            .await
            .map_err(|error| OperationError::conflict(format!("could not bind MCP endpoint {}: {error}", config.endpoint())))?;
        let cancellation = CancellationToken::new();
        let service_server = QuayMcpServer::new(operations, confirmations);
        let service = StreamableHttpService::new(
            move || Ok(service_server.clone()),
            LocalSessionManager::default().into(),
            StreamableHttpServerConfig::default()
                .with_legacy_session_mode(false)
                .with_json_response(true)
                .with_cancellation_token(cancellation.child_token()),
        );
        let router = axum::Router::new().nest_service("/mcp", service);
        let shutdown = cancellation.clone();
        let task = tokio::spawn(async move {
            let _ = axum::serve(listener, router)
                .with_graceful_shutdown(shutdown.cancelled_owned())
                .await;
        });
        Ok(Self { endpoint: config.endpoint(), cancellation, task: Some(task) })
    }

    pub fn endpoint(&self) -> &str { &self.endpoint }
    pub fn is_running(&self) -> bool { self.task.as_ref().is_some_and(|task| !task.is_finished()) }
    pub fn cancel(&self) { self.cancellation.cancel(); }

    pub async fn shutdown(&mut self) {
        self.cancel();
        if let Some(task) = self.task.take() { let _ = task.await; }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn converts_catalog_to_rmcp_tools() {
        let tool = QuayMcpServer::rmcp_tool("quay.container.delete").unwrap();
        assert_eq!(tool.name, "quay.container.delete");
        assert!(tool.annotations.as_ref().is_some_and(|value| value.is_destructive()));
    }

    #[test]
    fn raw_exec_is_not_registered() {
        assert!(QuayMcpServer::rmcp_tool("quay.exec").is_err());
    }
}
