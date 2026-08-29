use crate::pull_manager::{PullJob, PullJobStatus};
use crate::storage::audit::{AuditStatus, AuditWrite};
use crate::storage::Storage;

fn terminal_duration(job: &PullJob) -> Option<i64> {
    let start = job.started_at.unwrap_or(job.created_at);
    let end = job.finished_at.unwrap_or(job.updated_at);
    Some(end.saturating_sub(start).min(i64::MAX as u64) as i64)
}

pub fn record_pull_job(storage: &Storage, job: &PullJob) {
    let (status, phase, message, error, duration_ms) = match &job.status {
        PullJobStatus::Queued => (AuditStatus::Doing, "doing", "Image pull queued", None, None),
        PullJobStatus::Completed => (AuditStatus::Done, "terminal", "Image pull completed", None, terminal_duration(job)),
        PullJobStatus::Cancelled => (AuditStatus::Done, "terminal", "Image pull cancelled", None, terminal_duration(job)),
        PullJobStatus::Failed => (AuditStatus::Error, "terminal", "Image pull failed", job.error.clone(), terminal_duration(job)),
        PullJobStatus::Interrupted => (AuditStatus::Error, "terminal", "Image pull interrupted", job.error.clone(), terminal_duration(job)),
        PullJobStatus::Pulling | PullJobStatus::Cancelling => return,
    };

    let event = AuditWrite {
        id: format!("pull:{}:{phase}:{}", job.id, job.updated_at),
        operation_id: job.id.clone(),
        ts: job.updated_at.min(i64::MAX as u64) as i64,
        category: "image".into(),
        action: "pull".into(),
        target_type: Some("image".into()),
        target_id: None,
        target_name: Some(job.reference.clone()),
        status,
        message: Some(message.into()),
        command: Some(format!("wslc pull {}", job.reference)),
        error,
        duration_ms,
        metadata_json: None,
    };

    if let Err(error) = storage.append_audit(&event) {
        // Pull execution must never be blocked by diagnostic persistence.
        eprintln!("pull audit: {error}");
    }
}
