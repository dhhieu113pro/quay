use serde::{Deserialize, Serialize};
use std::time::Duration;

const SEARCH_URL: &str = "https://hub.docker.com/v2/search/repositories/";

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

fn normalize_query(query: &str) -> Option<String> {
    let query = query.trim();
    (!query.is_empty()).then(|| query.to_string())
}

fn map_response(raw: &str) -> Result<Vec<ImageSearchResult>, String> {
    let response: SearchResponse = serde_json::from_str(raw)
        .map_err(|e| format!("invalid Docker Hub search response: {e}"))?;
    Ok(response
        .results
        .into_iter()
        .take(8)
        .map(|row| ImageSearchResult {
            name: row.repo_name,
            description: row.short_description.unwrap_or_default(),
            official: row.is_official.unwrap_or(false),
            stars: row.star_count,
            pulls: row.pull_count,
            updated_at: row.last_updated,
        })
        .collect())
}

pub async fn search(query: &str) -> Result<Vec<ImageSearchResult>, String> {
    let Some(query) = normalize_query(query) else {
        return Ok(Vec::new());
    };
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(5))
        .build()
        .map_err(|e| format!("could not create Docker Hub client: {e}"))?;
    let response = client
        .get(SEARCH_URL)
        .query(&[("query", query.as_str()), ("page_size", "8")])
        .send()
        .await
        .map_err(|e| format!("Docker Hub search failed: {e}"))?;
    if !response.status().is_success() {
        return Err(format!("Docker Hub search returned HTTP {}", response.status()));
    }
    let raw = response
        .text()
        .await
        .map_err(|e| format!("could not read Docker Hub response: {e}"))?;
    map_response(&raw)
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
