use crate::operations::OperationError;
use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::sync::oneshot;

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ConfirmationDecision {
    Approve,
    Reject,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfirmationRequest {
    pub id: String,
    pub tool: String,
    pub arguments: Value,
    pub created_at_ms: u64,
    pub expires_at_ms: u64,
}

struct PendingConfirmation {
    request: ConfirmationRequest,
    sender: oneshot::Sender<ConfirmationDecision>,
}

type ConfirmationNotifier = Arc<dyn Fn(ConfirmationRequest) + Send + Sync>;

#[derive(Clone)]
pub struct ConfirmationBroker {
    pending: Arc<Mutex<HashMap<String, PendingConfirmation>>>,
    timeout: Duration,
    sequence: Arc<AtomicU64>,
    notifier: ConfirmationNotifier,
}

impl Default for ConfirmationBroker {
    fn default() -> Self { Self::with_timeout(Duration::from_secs(60)) }
}

impl ConfirmationBroker {
    pub fn with_timeout(timeout: Duration) -> Self {
        Self::with_notifier(timeout, Arc::new(|_| {}))
    }

    pub fn with_notifier(timeout: Duration, notifier: ConfirmationNotifier) -> Self {
        Self {
            pending: Arc::new(Mutex::new(HashMap::new())),
            timeout,
            sequence: Arc::new(AtomicU64::new(1)),
            notifier,
        }
    }

    pub fn pending(&self) -> Vec<ConfirmationRequest> {
        let now = now_ms();
        let mut pending = self.pending.lock().unwrap();
        pending.retain(|_, item| item.request.expires_at_ms > now);
        pending.values().map(|item| item.request.clone()).collect()
    }

    pub fn resolve(&self, id: &str, decision: ConfirmationDecision) -> Result<(), OperationError> {
        let item = self
            .pending
            .lock()
            .unwrap()
            .remove(id)
            .ok_or_else(|| OperationError::conflict("confirmation request is missing, expired, or already resolved"))?;
        item.sender
            .send(decision)
            .map_err(|_| OperationError::conflict("confirmation request is no longer waiting"))
    }

    pub async fn request(&self, tool: &str, arguments: Value) -> Result<(), OperationError> {
        let created_at_ms = now_ms();
        let expires_at_ms = created_at_ms.saturating_add(self.timeout.as_millis() as u64);
        let sequence = self.sequence.fetch_add(1, Ordering::Relaxed);
        let id = format!("mcp-confirm-{created_at_ms}-{sequence}");
        let request = ConfirmationRequest {
            id: id.clone(),
            tool: tool.to_string(),
            arguments,
            created_at_ms,
            expires_at_ms,
        };
        let (sender, receiver) = oneshot::channel();
        self.pending.lock().unwrap().insert(
            id.clone(),
            PendingConfirmation { request: request.clone(), sender },
        );
        (self.notifier)(request);

        let result = tokio::time::timeout(self.timeout, receiver).await;
        self.pending.lock().unwrap().remove(&id);
        match result {
            Ok(Ok(ConfirmationDecision::Approve)) => Ok(()),
            Ok(Ok(ConfirmationDecision::Reject)) => Err(OperationError::rejected("destructive MCP operation was rejected")),
            Ok(Err(_)) => Err(OperationError::cancelled("confirmation request was cancelled")),
            Err(_) => Err(OperationError::timeout("confirmation request expired")),
        }
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[tokio::test]
    async fn destructive_action_waits_for_approval() {
        let broker = ConfirmationBroker::with_timeout(Duration::from_secs(1));
        let waiter = {
            let broker = broker.clone();
            tokio::spawn(async move { broker.request("quay.container.delete", json!({"id":"abc"})).await })
        };
        tokio::task::yield_now().await;
        let pending = broker.pending();
        assert_eq!(pending.len(), 1);
        broker.resolve(&pending[0].id, ConfirmationDecision::Approve).unwrap();
        assert!(waiter.await.unwrap().is_ok());
    }

    #[tokio::test]
    async fn approval_is_one_shot() {
        let broker = ConfirmationBroker::with_timeout(Duration::from_secs(1));
        let waiter = {
            let broker = broker.clone();
            tokio::spawn(async move { broker.request("quay.image.delete", json!({"id":"sha256:x"})).await })
        };
        tokio::task::yield_now().await;
        let request = broker.pending().remove(0);
        assert!(broker.resolve(&request.id, ConfirmationDecision::Approve).is_ok());
        assert_eq!(broker.resolve(&request.id, ConfirmationDecision::Approve).unwrap_err().code(), "conflict");
        assert!(waiter.await.unwrap().is_ok());
    }

    #[tokio::test]
    async fn rejection_returns_rejected_error() {
        let broker = ConfirmationBroker::with_timeout(Duration::from_secs(1));
        let waiter = {
            let broker = broker.clone();
            tokio::spawn(async move { broker.request("quay.cube.delete", json!({"name":"demo"})).await })
        };
        tokio::task::yield_now().await;
        let request = broker.pending().remove(0);
        broker.resolve(&request.id, ConfirmationDecision::Reject).unwrap();
        assert_eq!(waiter.await.unwrap().unwrap_err().code(), "rejected");
    }

    #[tokio::test]
    async fn notifier_receives_new_request() {
        let seen = Arc::new(Mutex::new(Vec::new()));
        let sink = seen.clone();
        let broker = ConfirmationBroker::with_notifier(
            Duration::from_secs(1),
            Arc::new(move |request| sink.lock().unwrap().push(request.tool)),
        );
        let waiter = {
            let broker = broker.clone();
            tokio::spawn(async move { broker.request("quay.container.delete", json!({"id":"abc"})).await })
        };
        tokio::task::yield_now().await;
        assert_eq!(seen.lock().unwrap().as_slice(), ["quay.container.delete"]);
        let request = broker.pending().remove(0);
        broker.resolve(&request.id, ConfirmationDecision::Reject).unwrap();
        let _ = waiter.await;
    }
}
