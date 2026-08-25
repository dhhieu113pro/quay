use std::time::Duration;

#[cfg(test)]
mod tests {
    use super::*;

    fn strings(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| (*value).to_string()).collect()
    }

    #[test]
    fn known_reads_use_query_lane() {
        for args in [
            strings(&["container", "list"]),
            strings(&["image", "list"]),
            strings(&["volume", "list"]),
            strings(&["container", "logs", "demo"]),
            strings(&["version"]),
        ] {
            assert_eq!(classify(&args).lane, Lane::Query);
        }
    }

    #[test]
    fn mutations_and_unknowns_are_serialized() {
        for args in [
            strings(&["container", "run"]),
            strings(&["container", "start"]),
            strings(&["container", "stop"]),
            strings(&["image", "rm"]),
            strings(&["volume", "create"]),
            strings(&["mystery", "command"]),
        ] {
            assert_eq!(classify(&args).lane, Lane::Mutation);
        }
    }

    #[test]
    fn timeout_policy_matches_spec() {
        assert_eq!(classify(&strings(&["container", "list"])).timeout, Duration::from_secs(15));
        assert_eq!(classify(&strings(&["container", "start", "demo"])).timeout, Duration::from_secs(60));
        assert_eq!(classify(&strings(&["image", "pull", "ubuntu:24.04"])).timeout, Duration::from_secs(600));
    }
}
