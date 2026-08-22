# Partner Center listing

Paste these fields into the EXE/MSI product. Use current Quay screenshots at 1920×1080 where possible: Overview, Cubes, Containers, Run Container, Terminal, and Images.

**Name:** Quay for WSL

**Short description (100 characters):**
A lightweight desktop manager for WSL Containers, powered directly by the installed wslc CLI.

**Description:**

Quay is a Windows desktop manager for WSL Containers (`wslc`). It provides a focused UI for everyday container work while keeping Microsoft’s WSL Containers runtime as the source of truth.

Quay runs the installed `wslc.exe` command-line tool directly through a small Rust/Tauri backend. It uses the default WSLC session and does not install a separate container engine, background service, C# sidecar, or bundled WSLC SDK.

What you can do

- List, start, stop, restart, inspect, and remove WSL containers
- Pull and remove container images
- Run containers with ports, environment variables, bind mounts, working directory, and GPU flags
- Organize related containers into Cubes on a shared WSLC network
- Use the built-in LocalCoding Cube for a local MCP coding service; ngrok is optional
- Read container logs and execute shell commands inside running containers
- Use Windows x64 and Windows ARM64 builds
- Launch Quay at Windows sign-in and keep it available from the system tray

First run

Quay checks whether WSL and `wslc.exe` are available and shows the commands needed to install or update WSL. The built-in LocalCoding Cube creates its default `D:\wslc\workspaces` directory automatically when first started.

Requires

- Windows with a WSL build that includes WSL Containers
- WSL 2.9.3 or newer (`wsl --update --pre-release`)
- `wslc.exe` available to Quay

Quay is intended for developers using Microsoft’s WSL Containers feature. It does not replace Docker Desktop or provide Docker Compose compatibility.

**App category:** Developer tools

**Keywords:** WSL, containers, wslc, Docker, Tauri, Rust, Hyper-V, developer tools

**Copyright:** © 2026 Hieu Dam

**Website:** https://github.com/dhhieu113pro/quay

**Support:** https://github.com/dhhieu113pro/quay/issues

**Privacy:** https://github.com/dhhieu113pro/quay/blob/main/docs/privacy.md

**Silent install (NSIS):** `/S`

**Silent install (MSI):** `/quiet`
