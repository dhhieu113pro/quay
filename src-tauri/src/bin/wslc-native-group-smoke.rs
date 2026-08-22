#![cfg(windows)]

use quay_lib::wslc_native::{ContainerSpec, NativeApi, VolumeSpec};
use serde_json::Value;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::thread;
use std::time::{Duration, Instant};

fn main() -> Result<(), String> {
    let token = std::env::var("NGROK_AUTHTOKEN").map_err(|_| {
        "NGROK_AUTHTOKEN is required for the native local-coding Group smoke test".to_string()
    })?;

    let api = NativeApi::load()?;
    let session_name = format!("Quay-Rust-Group-Smoke-{}", std::process::id());
    let storage = std::env::temp_dir().join(&session_name);
    let workspace = std::env::temp_dir().join(format!("{session_name}-workspace"));
    std::fs::create_dir_all(&storage).map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&workspace).map_err(|e| e.to_string())?;

    let session = api.create_session(&session_name, &storage, 2, 3072)?;
    let mut mcp = None;
    let mut ngrok = None;

    let result = (|| -> Result<(), String> {
        let mcp_image = "ghcr.io/dhhieu113pro/local-coding-mcp:latest";
        println!("Pulling {mcp_image}");
        session.pull(mcp_image)?;
        let container = session.create_container(&ContainerSpec {
            image: mcp_image.into(),
            name: "local-coding-mcp".into(),
            command: vec!["/usr/bin/dotnet".into(), "/app/LocalCodingMcp.dll".into()],
            workdir: "/app".into(),
            ports: vec![(15000, 5000)],
            env: vec![
                "ASPNETCORE_URLS=http://0.0.0.0:5000".into(),
                "ASPNETCORE_ENVIRONMENT=Production".into(),
                "AllowedRoots__0=/workspace".into(),
                "CommandTimeoutSeconds=60".into(),
            ],
            volumes: vec![VolumeSpec {
                windows_path: workspace.clone(),
                container_path: "/workspace".into(),
                read_only: false,
            }],
        })?;
        container.start()?;
        mcp = Some(container);

        wait_http(
            "127.0.0.1:15000",
            "/health",
            |response| response.starts_with("HTTP/1.1 200"),
            90,
        )?;
        println!("PASS: native Rust local-coding-mcp /health returned HTTP 200");

        let mcp_ip = bridge_ip(mcp.as_ref().unwrap().inspect()?.as_str())
            .ok_or("could not resolve local-coding-mcp bridge IP from WSLC inspect")?;
        println!("local-coding-mcp bridge IP: {mcp_ip}");

        let ngrok_image = "ngrok/ngrok:latest";
        println!("Pulling {ngrok_image}");
        session.pull(ngrok_image)?;
        let container = session.create_container(&ContainerSpec {
            image: ngrok_image.into(),
            name: "local-coding-mcp-ngrok".into(),
            command: vec![
                "http".into(),
                "--url=random-tweed-runt.ngrok-free.dev".into(),
                "--log=stdout".into(),
                format!("{mcp_ip}:5000"),
            ],
            workdir: "/".into(),
            ports: vec![(14040, 4040)],
            env: vec![format!("NGROK_AUTHTOKEN={token}")],
            volumes: vec![],
        })?;
        container.start()?;
        ngrok = Some(container);

        let body = wait_http(
            "127.0.0.1:14040",
            "/api/tunnels",
            |response| response.starts_with("HTTP/1.1 200") && response.contains("public_url"),
            90,
        )
        .map_err(|error| {
            let logs = ngrok
                .as_ref()
                .map(|container| {
                    container
                        .logs()
                        .into_iter()
                        .map(|entry| format!("[{}] {}", entry.stream, entry.text.trim_end()))
                        .collect::<Vec<_>>()
                        .join("\n")
                })
                .unwrap_or_default();
            format!("{error}\nngrok logs:\n{logs}")
        })?;
        if !body.contains("public_url") {
            return Err("ngrok inspector returned no active tunnel".into());
        }
        if !mcp.as_ref().unwrap().is_running()? || !ngrok.as_ref().unwrap().is_running()? {
            return Err("local-coding Group containers are not both running".into());
        }

        println!("PASS: Rust native local-coding Group: MCP healthy + ngrok tunnel active");
        Ok(())
    })();

    if let Some(mut c) = ngrok {
        let _ = c.stop();
        let _ = c.delete();
    }
    if let Some(mut c) = mcp {
        let _ = c.stop();
        let _ = c.delete();
    }
    drop(session);
    let _ = std::fs::remove_dir_all(storage);
    let _ = std::fs::remove_dir_all(workspace);
    result
}

fn wait_http<F>(
    address: &str,
    path: &str,
    validate: F,
    timeout_seconds: u64,
) -> Result<String, String>
where
    F: Fn(&str) -> bool,
{
    let deadline = Instant::now() + Duration::from_secs(timeout_seconds);
    let mut last = String::new();
    while Instant::now() < deadline {
        match request(address, path) {
            Ok(response) if validate(&response) => return Ok(response),
            Ok(response) => {
                last = response
                    .lines()
                    .next()
                    .unwrap_or("unexpected response")
                    .to_string()
            }
            Err(error) => last = error,
        }
        thread::sleep(Duration::from_millis(500));
    }
    Err(format!(
        "timed out waiting for http://{address}{path}: {last}"
    ))
}

fn request(address: &str, path: &str) -> Result<String, String> {
    let mut stream = TcpStream::connect_timeout(
        &address
            .parse()
            .map_err(|e: std::net::AddrParseError| e.to_string())?,
        Duration::from_secs(3),
    )
    .map_err(|e| e.to_string())?;
    stream
        .set_read_timeout(Some(Duration::from_secs(3)))
        .map_err(|e| e.to_string())?;
    let request = format!("GET {path} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n");
    stream
        .write_all(request.as_bytes())
        .map_err(|e| e.to_string())?;
    let mut response = String::new();
    stream
        .read_to_string(&mut response)
        .map_err(|e| e.to_string())?;
    Ok(response)
}

fn bridge_ip(inspect: &str) -> Option<String> {
    let value: Value = serde_json::from_str(inspect).ok()?;
    fn walk(value: &Value) -> Option<String> {
        match value {
            Value::Object(map) => {
                if let Some(ip) = map
                    .get("IPAddress")
                    .and_then(Value::as_str)
                    .filter(|x| !x.is_empty() && *x != "0.0.0.0")
                {
                    return Some(ip.to_string());
                }
                map.values().find_map(walk)
            }
            Value::Array(items) => items.iter().find_map(walk),
            _ => None,
        }
    }
    walk(&value)
}
