#![cfg(windows)]

use quay_lib::wslc_native::{ContainerSpec, NativeApi};
use std::io::{Read, Write};
use std::net::TcpStream;
use std::path::PathBuf;
use std::thread;
use std::time::{Duration, Instant};

fn main() -> Result<(), String> {
    let api = NativeApi::load()?;
    let session_name = format!("Quay-Rust-Smoke-{}", std::process::id());
    let storage = std::env::temp_dir().join(&session_name);
    std::fs::create_dir_all(&storage).map_err(|e| e.to_string())?;

    let session = api.create_session(&session_name, &storage, 2, 2048)?;
    println!("Rust native WSLC session created: {session_name}");

    let image = "docker.io/library/nginx:latest";
    println!("Pulling {image}");
    session.pull(image)?;

    let mut container = session.create_container(&ContainerSpec {
        image: image.into(),
        name: "quay-rust-nginx-smoke".into(),
        command: vec!["/usr/sbin/nginx".into(), "-g".into(), "daemon off;".into()],
        workdir: "/".into(),
        ports: vec![(18081, 80)],
        env: vec![],
        volumes: vec![],
    })?;

    container.start()?;
    if !container.is_running()? {
        return Err("native WSLC nginx container is not running after start".into());
    }

    wait_for_nginx()?;
    println!("PASS: Rust -> native WSLC C API -> nginx -> HTTP 200/default page");

    let _ = container.stop();
    container.delete()?;
    drop(container);
    drop(session);
    let _ = std::fs::remove_dir_all(PathBuf::from(storage));
    Ok(())
}

fn wait_for_nginx() -> Result<(), String> {
    let deadline = Instant::now() + Duration::from_secs(60);
    let mut last = String::new();
    while Instant::now() < deadline {
        match request() {
            Ok(body) if body.contains("Welcome to nginx") => return Ok(()),
            Ok(body) => last = format!("unexpected response: {body}"),
            Err(err) => last = err,
        }
        thread::sleep(Duration::from_millis(500));
    }
    Err(format!("timed out waiting for nginx on 127.0.0.1:18081: {last}"))
}

fn request() -> Result<String, String> {
    let mut stream = TcpStream::connect_timeout(
        &"127.0.0.1:18081".parse().map_err(|e: std::net::AddrParseError| e.to_string())?,
        Duration::from_secs(2),
    ).map_err(|e| e.to_string())?;
    stream.set_read_timeout(Some(Duration::from_secs(2))).map_err(|e| e.to_string())?;
    stream.write_all(b"GET / HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n").map_err(|e| e.to_string())?;
    let mut response = String::new();
    stream.read_to_string(&mut response).map_err(|e| e.to_string())?;
    if !response.starts_with("HTTP/1.1 200") {
        return Err(format!("nginx did not return HTTP 200: {}", response.lines().next().unwrap_or("empty response")));
    }
    Ok(response)
}
