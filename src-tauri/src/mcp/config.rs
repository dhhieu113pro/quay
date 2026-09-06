use crate::operations::OperationError;
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::net::{IpAddr, Ipv4Addr};
use std::path::Path;

pub const DEFAULT_MCP_PORT: u16 = 47_831;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct McpConfig {
    pub enabled: bool,
    pub bind: IpAddr,
    pub port: u16,
}

impl Default for McpConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            bind: IpAddr::V4(Ipv4Addr::LOCALHOST),
            port: DEFAULT_MCP_PORT,
        }
    }
}

impl McpConfig {
    pub fn validate(&self) -> Result<(), OperationError> {
        if !self.bind.is_loopback() {
            return Err(OperationError::invalid_input("MCP v1 only permits loopback bind addresses"));
        }
        if self.port == 0 {
            return Err(OperationError::invalid_input("MCP port must be greater than zero"));
        }
        Ok(())
    }

    pub fn endpoint(&self) -> String {
        let host = match self.bind {
            IpAddr::V4(address) => address.to_string(),
            IpAddr::V6(address) => format!("[{address}]"),
        };
        format!("http://{host}:{}/mcp", self.port)
    }

    pub fn load(path: &Path) -> Result<Self, OperationError> {
        if !path.exists() {
            return Ok(Self::default());
        }
        let raw = fs::read_to_string(path)
            .map_err(|error| OperationError::backend_failure(format!("could not read MCP config: {error}")))?;
        let config: Self = serde_json::from_str(&raw)
            .map_err(|error| OperationError::invalid_input(format!("invalid MCP config: {error}")))?;
        config.validate()?;
        Ok(config)
    }

    pub fn save(&self, path: &Path) -> Result<(), OperationError> {
        self.validate()?;
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| OperationError::backend_failure(format!("could not create MCP config directory: {error}")))?;
        }
        let temp_path = path.with_extension("json.tmp");
        let body = serde_json::to_vec_pretty(self)
            .map_err(|error| OperationError::backend_failure(format!("could not serialize MCP config: {error}")))?;
        let mut file = fs::File::create(&temp_path)
            .map_err(|error| OperationError::backend_failure(format!("could not create MCP config: {error}")))?;
        file.write_all(&body)
            .and_then(|_| file.sync_all())
            .map_err(|error| OperationError::backend_failure(format!("could not write MCP config: {error}")))?;
        replace_file(&temp_path, path)
            .map_err(|error| OperationError::backend_failure(format!("could not replace MCP config: {error}")))?;
        Ok(())
    }
}

#[cfg(windows)]
pub(crate) fn replace_file(source: &Path, destination: &Path) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    const MOVEFILE_REPLACE_EXISTING: u32 = 0x0000_0001;
    const MOVEFILE_WRITE_THROUGH: u32 = 0x0000_0008;
    #[link(name = "kernel32")]
    extern "system" {
        fn MoveFileExW(existing_file_name: *const u16, new_file_name: *const u16, flags: u32) -> i32;
    }
    let source_wide: Vec<u16> = source.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
    let destination_wide: Vec<u16> = destination.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
    let result = unsafe {
        MoveFileExW(
            source_wide.as_ptr(),
            destination_wide.as_ptr(),
            MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
        )
    };
    if result == 0 { Err(std::io::Error::last_os_error()) } else { Ok(()) }
}

#[cfg(not(windows))]
pub(crate) fn replace_file(source: &Path, destination: &Path) -> std::io::Result<()> {
    fs::rename(source, destination)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn default_config_is_disabled_and_loopback_only() {
        let config = McpConfig::default();
        assert!(!config.enabled);
        assert_eq!(config.bind, IpAddr::V4(Ipv4Addr::LOCALHOST));
        assert_eq!(config.endpoint(), "http://127.0.0.1:47831/mcp");
        assert!(config.validate().is_ok());
    }

    #[test]
    fn non_loopback_bind_is_rejected() {
        let config = McpConfig {
            enabled: true,
            bind: "0.0.0.0".parse().unwrap(),
            port: DEFAULT_MCP_PORT,
        };
        assert_eq!(config.validate().unwrap_err().code(), "invalid_input");
    }

    #[test]
    fn zero_port_is_rejected() {
        let config = McpConfig { port: 0, ..McpConfig::default() };
        assert_eq!(config.validate().unwrap_err().code(), "invalid_input");
    }

    #[test]
    fn repeated_save_replaces_existing_config() {
        let suffix = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        let dir = std::env::temp_dir().join(format!("quay-mcp-config-{suffix}"));
        let path = dir.join("mcp.json");
        let first = McpConfig { enabled: true, ..McpConfig::default() };
        first.save(&path).unwrap();
        let second = McpConfig { enabled: false, port: DEFAULT_MCP_PORT + 1, ..McpConfig::default() };
        second.save(&path).unwrap();
        assert_eq!(McpConfig::load(&path).unwrap(), second);
        let _ = fs::remove_dir_all(dir);
    }
}
