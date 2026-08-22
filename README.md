<p align="center">
  <img src="docs/logo.png" width="180" height="180" alt="Quay — stacked containers on a dock">
</p>

<h1 align="center">Quay</h1>

<p align="center">A desktop for <a href="https://learn.microsoft.com/windows/wsl/wsl-container">WSL containers</a> (<code>wslc</code>).</p>

<p align="center">
  <img src="docs/quay-hero.svg" alt="Quay — run and manage WSL containers, Cubes, images, logs, ports and GPU on Windows" width="1100">
</p>

A **quay** is a dock — the stone edge where ships tie up. Linux containers on Windows are the ships. Quay is the berth: list containers, pull images, start and stop workloads, configure ports and mounts, and manage related containers as Cubes from a Windows desktop UI.

Microsoft ships `wslc.exe` (and the `container.exe` alias) with the WSL Containers feature. Quay keeps the architecture intentionally simple: the React UI calls Tauri commands, Rust launches the installed `wslc` CLI, and the UI refreshes from the real WSLC state.

<p align="center">
  <img src="docs/shots/overview.jpg" alt="Overview — WSLC status and running containers" width="920">
</p>
<p align="center">
  <img src="docs/shots/containers.jpg" alt="Container list with start, stop, and inspect" width="450">
  &nbsp;
  <img src="docs/shots/run.jpg" alt="Run container dialog" width="450">
</p>
<p align="center">
  <img src="docs/shots/images.jpg" alt="Images and volumes" width="450">
  &nbsp;
  <img src="docs/shots/session.jpg" alt="WSLC runtime information" width="450">
</p>

```text
┌─────────────────────┐
│ React / Tauri UI    │
└──────────┬──────────┘
           │ invoke
┌──────────▼──────────┐
│ Rust backend        │
│ std::process::Command
└──────────┬──────────┘
           │
           │ wslc ...
┌──────────▼──────────┐
│ wslc.exe            │
│ default WSLC session│
└──────────┬──────────┘
           │
┌──────────▼──────────┐
│ WSL container VM    │
└─────────────────────┘
```

There is **no C# sidecar**, no `Quay.Host`, no custom `Quay` WSLC session, and no bundled `wslcsdk.dll`. Quay uses the same default WSLC session that you see from the command line.

## Install

Windows x64 and ARM64. WSL **2.9.3+** and `wslc.exe` must be available to Quay.

**[Download the latest installer](https://github.com/dhhieu113pro/quay/releases/latest)**

| File | Machine |
| --- | --- |
| `Quay_*_x64-setup.exe` | Intel / AMD. Silent: `/S` |
| `Quay_*_arm64-setup.exe` | Snapdragon / Copilot+ / ARM64. Silent: `/S` |
| `Quay_*_*_en-US.msi` | Same architectures. Silent: `msiexec /i Quay_*.msi /quiet` |

On first launch Quay checks WSL and WSLC separately. If the runtime is missing, the setup screen shows the install/update commands and can retry without reinstalling Quay.

Close hides Quay to the tray; quit from the tray menu. Appearance follows sunrise and sunset, or can be locked to light or dark from the titlebar.

GitHub Actions builds/packages the Windows x64 and Windows ARM64 installers. WSLC runtime tests are local-only because GitHub-hosted runners do not reliably provide the WSL Containers runtime. Tag `v*` runs the Release workflow and publishes installers to GitHub Releases.

## What you can do

- **Containers** — run standalone containers with names, ports, environment variables, bind mounts, working directory and GPU options
- **Lifecycle** — list real WSLC containers and start, stop, restart or remove them through `wslc`
- **Cubes** — start and stop related containers together on a shared WSLC network
- **Images & volumes** — work with pulled images and volumes through the WSLC CLI
- **Logs & exec** — read logs on demand and execute shell commands inside running containers
- **Terminal** — run real one-shot commands through `wslc exec`; containers without `/bin/sh` receive a clear unsupported-shell message
- **Appearance** — automatic light/dark mode or explicit light/dark selection; close hides to tray

### Built-in LocalCoding Cube

Quay includes a built-in **LocalCoding** Cube:

- `local-coding-mcp` — `ghcr.io/dhhieu113pro/local-coding-mcp:latest`, exposed on port 5000
- `local-coding-mcp-ngrok` — optional public HTTPS tunnel
- shared WSLC network: `mcp-net`

The core MCP member can start on a fresh Quay install. If the image is not pulled, starting it lets WSLC pull/create/start it. Quay creates the default `D:\wslc\workspaces` host directory automatically before the first run. ngrok does not block the Cube: it stays marked **Needs token** until `NGROK_AUTHTOKEN` is configured.

## How Quay talks to WSLC

Quay runs the installed CLI directly from Rust. Typical commands look like:

```powershell
wslc container list --all
wslc network create mcp-net
wslc run -d --name web -p 8080:80 nginx:latest
wslc container stop web
wslc container rm web
```

Quay intentionally uses the **default WSLC session**. It does not add `--session Quay` or create a separate VM/session.

The operational rule is simple:

```text
UI action
  ↓
wslc command
  ↓
read the affected WSLC state again
  ↓
update the UI from the actual result
```

Container state is refreshed periodically at a modest interval. Image/volume inventory refreshes on initial load, when the Images page is opened, and after relevant mutations. Container logs refresh only while the Logs pane is in use.

## Requirements (Windows)

- Windows with WSL installed
- WSL Containers / `wslc.exe`
- WSL **2.9.3+**
- Node.js and Rust only when building Quay from source

Check your setup:

```powershell
wsl --version
wslc version
wslc container list --all
```

If your WSL version does not yet contain WSLC, update WSL using the Microsoft instructions for the WSL Containers preview/version you are targeting.

## UI / development

Install dependencies and start Tauri:

```bash
npm install
npm run tauri dev
```

No .NET SDK, C# host build, NuGet restore, native WSLC SDK DLL, or sidecar preparation step is required.

Build installers locally:

```powershell
npm run tauri -- build --bundles nsis,msi
```

Run the local Windows test suite:

```powershell
$env:NGROK_AUTHTOKEN = "your-token"
npm run test:windows
```

Runtime tests use the real default WSLC session on your Windows machine. They are intentionally not run on GitHub-hosted Actions runners.

The Rust backend also has an opt-in real-container lifecycle test. It runs an `alpine:latest` container through the same `CliWorker` used by Quay, verifies the real JSON list record and logs, and removes its uniquely named container:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml real_wslc_container_lifecycle -- --ignored --nocapture
```

Set `QUAY_WSLC_TEST_IMAGE` to use another image that provides `sh` and `printf`.

## Repository layout

| Path | Role |
| --- | --- |
| `src/` | React desktop UI — overview, Cubes, containers, terminal, images and runtime views |
| `src/lib/wslc/` | WSLC models, CLI/Cube orchestration and UI state integration |
| `src-tauri/` | Tauri 2 Rust backend; executes `wslc.exe` directly |
| `tests/run-all.ps1` | Local Windows runtime verification using real WSLC |
| `.github/workflows/ci.yml` | Build/package Windows x64 + ARM64 installers |
| `.github/workflows/release.yml` | Tag `v*` → GitHub Release (NSIS + MSI) |
| `.github/workflows/store.yml` | Manual Microsoft Store package build for x64 + ARM64 |
| `docs/store.md` | Partner Center checklist, silent flags and release setup |
| `docs/logo.png` | App mark |
| `docs/shots/` | Product screenshots |

## CI and releases

CI does **not** test the WSLC runtime. It proves that Quay packages successfully for the two supported Windows architectures:

```text
Windows x64   → Tauri → NSIS + MSI
Windows ARM64 → Tauri → NSIS + MSI
```

Runtime verification stays local:

```powershell
npm run test:windows
```

Create a release by pushing a version tag that matches the internal application version:

```powershell
git tag v0.1.3
git push origin v0.1.3
```

## License

MIT