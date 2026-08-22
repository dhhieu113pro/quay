<p align="center">
  <img src="docs/logo.png" width="180" height="180" alt="Quay — stacked containers on a dock">
</p>

<h1 align="center">Quay</h1>

<p align="center">A desktop for <a href="https://learn.microsoft.com/windows/wsl/wsl-container">WSL containers</a> (<code>wslc</code>).</p>

<p align="center">
  <img src="docs/quay-hero.svg" alt="Quay — run and manage WSL containers, groups, images, logs, ports and GPU on Windows" width="1100">
</p>

A **quay** is a dock — the stone edge where ships tie up. Linux containers on Windows are the ships. Quay is the berth: list containers, pull images, start and stop workloads, configure ports and mounts, and manage related containers as Groups from a Windows desktop UI.

Microsoft ships `wslc.exe` (and the `container.exe` alias) with the WSL Containers feature. Quay keeps the architecture intentionally simple: the React UI calls Tauri commands, Rust launches the installed `wslc` CLI, and the UI refreshes from the real WSLC state.

<p align="center">
  <img src="docs/shots/overview.jpg" alt="Overview — session stats and running containers" width="920">
</p>
<p align="center">
  <img src="docs/shots/containers.jpg" alt="Container list with start, stop, and inspect" width="450">
  &nbsp;
  <img src="docs/shots/run.jpg" alt="Run container dialog" width="450">
</p>
<p align="center">
  <img src="docs/shots/images.jpg" alt="Image catalog with pull" width="450">
  &nbsp;
  <img src="docs/shots/session.jpg" alt="WSLC host information" width="450">
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
│ Hyper-V · virtiofs  │
│ networking · GPU    │
└─────────────────────┘
```

There is **no C# sidecar**, no `Quay.Host`, no custom `Quay` WSLC session, and no bundled `wslcsdk.dll`. Quay uses the same default WSLC session that you see from the command line.

## Install

Windows x64 and ARM64. WSL **2.9.3+** and `wslc.exe` must be available on `PATH`.

**[Download the latest installer](https://github.com/dhhieu113pro/quay/releases/latest)**

| File | Machine |
| --- | --- |
| `Quay_*_x64-setup.exe` | Intel / AMD. Silent: `/S` |
| `Quay_*_arm64-setup.exe` | Snapdragon / Copilot+ / ARM64. Silent: `/S` |
| `Quay_*_*_en-US.msi` | Same arches. Silent: `msiexec /i Quay_*.msi /quiet` |

Close hides Quay to the tray; quit from the tray menu. Appearance follows sunrise and sunset, or can be locked to light or dark from the titlebar.

GitHub Actions only builds/packages the Windows x64 and Windows ARM64 installers. WSLC runtime tests are local-only because GitHub-hosted runners do not reliably provide the WSL Containers runtime. Tag `v*` runs the Release workflow and publishes installers to GitHub Releases.

## What you can do

- **Containers** — run containers with names, ports, environment variables, bind mounts, working directory and GPU options
- **Lifecycle** — list real WSLC containers and start, stop or remove them through `wslc`
- **Groups** — start and stop related containers together on a shared WSLC network
- **Images** — work with images through the WSLC CLI
- **Configuration** — configure Group-specific workspace paths, tokens and public endpoints
- **Appearance** — automatic light/dark mode or explicit light/dark selection; close hides to tray

For the built-in `local-coding` Group, Quay uses the real WSLC network `mcp-net` so the MCP container and ngrok container can resolve each other by container name.

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
read WSLC state again
  ↓
update the UI from the actual result
```

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

## Repository layout

| Path | Role |
| --- | --- |
| `src/` | React desktop UI — overview, containers, groups, images and host/session views |
| `src/lib/wslc/` | WSLC models, CLI/group orchestration and UI state integration |
| `src-tauri/` | Tauri 2 Rust backend; executes `wslc.exe` directly |
| `tests/run-all.ps1` | Local Windows runtime verification using real WSLC |
| `.github/workflows/ci.yml` | Build/package Windows x64 + ARM64 installers |
| `.github/workflows/release.yml` | Tag `v*` → GitHub Release (NSIS + MSI) |
| `.github/workflows/store.yml` | Microsoft Store packaging/submission workflow |
| `docs/store.md` | Partner Center notes, silent flags and release setup |
| `docs/logo.png` | App mark |
| `docs/shots/` | Product screenshots used above |

## CI and releases

CI does **not** test the WSLC runtime. It only proves that Quay packages successfully for the two supported Windows architectures:

```text
Windows x64   → Tauri → NSIS + MSI
Windows ARM64 → Tauri → NSIS + MSI
```

Runtime verification stays local:

```powershell
npm run test:windows
```

A release is created by pushing a version tag, for example:

```powershell
git tag v0.1.3
git push origin v0.1.3
```

## License

MIT
