# Partner Center listing

Paste these fields into the EXE/MSI product. Screenshots: 1920×1080 PNG, dark UI, at least four (overview, containers, run dialog, session).

**Name:** Quay for WSL

**Short description (100 characters):**
A dock for WSL containers. Tauri desktop powered by the installed wslc CLI.

**Description:**

Quay is a desktop for WSL containers (`wslc`). Linux containers on Windows sit at the quay — list them, pull images, start and stop, exec in, watch logs, hand GPU and ports across.

The window is a Tauri WebView. Native work runs through `wslc.exe`, shipped with WSL 2.9.3. Same muscle memory as Docker (`run`, `pull`, `ps`, `stop`), but the runtime is a dedicated Hyper-V VM: virtiofs, consomme networking, CDI GPU.

What you can do

- Start a WSL container session (vCPU, memory, data path)
- Pull and remove images with progress
- Run containers with ports, env, bind mounts, and GPU
- Inspect, logs, and exec
- See the exact CLI command Quay invokes

Requires

- Windows 10 22H2 or Windows 11
- WSL 2.9.3 or newer (`wsl --update --pre-release`)
- `wslc.exe` on PATH

Quay does not replace Docker Desktop’s compose ecosystem. It is the native WSL container API with a UI.

**App category:** Developer tools

**Keywords:** WSL, containers, wslc, docker, C#, Tauri, Hyper-V, GPU

**Copyright:** © 2026 Hieu Dam

**Website:** https://github.com/dhhieu113pro/quay

**Support:** https://github.com/dhhieu113pro/quay/issues

**Privacy:** https://github.com/dhhieu113pro/quay/blob/main/docs/privacy.md

**Silent install (NSIS):** `/S`

**Silent install (MSI):** `/quiet`
