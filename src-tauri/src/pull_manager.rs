use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum PullJobStatus {
    Queued,
    Pulling,
    Completed,
    Failed,
    Cancelling,
    Cancelled,
    Interrupted,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PullJob {
    pub id: String,
    pub reference: String,
    pub status: PullJobStatus,
    pub current_bytes: u64,
    pub total_bytes: Option<u64>,
    pub progress: Option<f64>,
    pub bytes_per_second: Option<u64>,
    pub started_at: Option<u64>,
    pub created_at: u64,
    pub updated_at: u64,
    pub finished_at: Option<u64>,
    pub message: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq)]
pub struct ProgressUpdate {
    pub current_bytes: Option<u64>,
    pub total_bytes: Option<u64>,
    pub progress: Option<f64>,
    pub message: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn job(id: &str, status: PullJobStatus, updated_at: u64) -> PullJob {
        PullJob {
            id: id.into(),
            reference: format!("{id}:latest"),
            status,
            current_bytes: 0,
            total_bytes: None,
            progress: None,
            bytes_per_second: None,
            started_at: None,
            created_at: updated_at,
            updated_at,
            finished_at: None,
            message: None,
            error: None,
        }
    }

    #[test]
    fn parses_byte_fraction_without_inventing_missing_values() {
        let update = parse_progress_fragment("Downloading 12.5 MB / 50 MB");
        assert_eq!(update.current_bytes, Some(13_107_200));
        assert_eq!(update.total_bytes, Some(52_428_800));
        assert_eq!(update.progress, Some(25.0));
    }

    #[test]
    fn stage_only_output_is_indeterminate() {
        let update = parse_progress_fragment("Pulling fs layer");
        assert_eq!(update.progress, None);
        assert_eq!(update.total_bytes, None);
        assert_eq!(update.message.as_deref(), Some("Pulling fs layer"));
    }

    #[test]
    fn persisted_active_jobs_become_interrupted() {
        let now = 1_700_000_000_000_u64;
        let loaded = normalize_loaded_jobs(vec![job("pull-1", PullJobStatus::Pulling, now - 10)], now);
        assert_eq!(loaded[0].status, PullJobStatus::Interrupted);
        assert_eq!(loaded[0].finished_at, Some(now));
    }

    #[test]
    fn retention_keeps_active_jobs_and_latest_fifty_terminal_jobs() {
        let mut jobs = vec![job("active", PullJobStatus::Queued, 1000)];
        for index in 0..60_u64 {
            jobs.push(job(&format!("done-{index}"), PullJobStatus::Completed, index));
        }
        let retained = prune_history(jobs);
        assert!(retained.iter().any(|item| item.id == "active"));
        assert_eq!(retained.iter().filter(|item| is_terminal(&item.status)).count(), 50);
        assert!(!retained.iter().any(|item| item.id == "done-0"));
        assert!(retained.iter().any(|item| item.id == "done-59"));
    }

    #[test]
    fn persistence_round_trip_restores_terminal_job() {
        let path = std::env::temp_dir().join(format!("quay-pull-jobs-{}.json", std::process::id()));
        let expected = vec![job("done", PullJobStatus::Completed, 42)];
        save_jobs(&path, &expected).unwrap();
        let actual = load_jobs(&path, 100);
        let _ = std::fs::remove_file(&path);
        assert_eq!(actual, expected);
    }
}
