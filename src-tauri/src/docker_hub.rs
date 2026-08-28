use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ImageSearchResult {
    pub name: String,
    pub description: String,
    pub official: bool,
    pub stars: Option<u64>,
    pub pulls: Option<u64>,
    pub updated_at: Option<String>,
}

#[derive(Debug, Deserialize)]
struct SearchResponse {
    results: Vec<SearchRow>,
}

#[derive(Debug, Deserialize)]
struct SearchRow {
    repo_name: String,
    short_description: Option<String>,
    is_official: Option<bool>,
    star_count: Option<u64>,
    pull_count: Option<u64>,
    last_updated: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_docker_hub_results_into_quay_contract() {
        let raw = r#"{
          "results": [{
            "repo_name": "nginx",
            "short_description": "Official build of Nginx.",
            "is_official": true,
            "star_count": 21000,
            "pull_count": 1000000,
            "last_updated": "2026-08-20T00:00:00Z"
          }]
        }"#;
        let mapped = map_response(raw).unwrap();
        assert_eq!(mapped[0].name, "nginx");
        assert!(mapped[0].official);
        assert_eq!(mapped[0].pulls, Some(1_000_000));
    }

    #[test]
    fn empty_query_returns_no_results_without_network() {
        assert!(normalize_query("   ").is_none());
        assert_eq!(normalize_query(" nginx ").as_deref(), Some("nginx"));
    }
}
