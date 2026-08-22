# Microsoft Store

Quay is a full-trust Win32 Tauri desktop. It runs the installed WSL Containers CLI, so the Partner Center **EXE or MSI app** flow is the intended Store path.

## First listing

1. Open [Partner Center](https://partner.microsoft.com) → **Windows & Xbox** → **New product** → **EXE or MSI app**.
2. Reserve the name **Quay for WSL**.
3. Copy the current listing text from [`store/listing.md`](../store/listing.md).
4. Use these URLs:
   - Privacy: `https://github.com/dhhieu113pro/quay/blob/main/docs/privacy.md`
   - Support: `https://github.com/dhhieu113pro/quay/issues`
   - Website: `https://github.com/dhhieu113pro/quay`
5. Use a GitHub Release whose tag matches the internal Quay version. For the current release, use `v0.1.3`.
6. The Release workflow produces x64 and ARM64 NSIS/MSI installers. The **Microsoft Store package** workflow can also be run manually to build Store-specific offline-WebView2 installers for both architectures.
7. In Partner Center, point the package to the appropriate GitHub Release asset URL or upload the installer produced by the Store workflow.
8. Silent install arguments:
   - NSIS: `/S`
   - MSI: `/quiet`
9. Certification notes:
   - Quay is a developer tool for Microsoft WSL Containers.
   - It uses the installed `wslc.exe` directly and the default WSLC session.
   - It does not install another container engine or Windows service.
   - It requires a WSL build with WSL Containers (`wsl --update --pre-release` when needed).
   - The app can diagnose missing WSL/WSLC on first launch.

Publisher display name in the installer is **Hieu Dam** so it does not collide with the product name **Quay**.

## Store package workflow

The `.github/workflows/store.yml` workflow intentionally **builds packages only**. Partner Center submission remains manual so the repository does not report a successful submission without actually completing the Partner Center API transaction.

The workflow:

- verifies `package.json`, `tauri.conf.json`, and `Cargo.toml` use the same version;
- builds x64 on `windows-latest`;
- builds ARM64 on `windows-11-arm`;
- uses the Store Tauri overlay with the offline WebView2 installer;
- uploads separate x64 and ARM64 artifacts.

## Pre-submission test checklist

Test the installer on a clean Windows account/machine before uploading it to Partner Center:

- Install and launch Quay with WSL/WSLC missing: setup screen must explain what is missing.
- Install/update WSL, press **Check again**, and confirm Quay opens without reinstalling.
- Pull an image and run/start/stop/remove a standalone container.
- Open Inspect → Logs and verify logs only refresh while the Logs tab is in use.
- Start the built-in LocalCoding Cube with no prior `D:\wslc\workspaces` folder; Quay should create it automatically.
- Confirm LocalCoding MCP can start without an ngrok token and ngrok is shown as optional/needs configuration.
- Configure an ngrok token and confirm the ngrok member can then start.
- Verify the Terminal gives a clear message for an image without `/bin/sh`.
- Close the window and verify Quay remains in the tray; quit from the tray.
- Uninstall Quay and verify the application is removed normally.
- Repeat the smoke test for the architecture being submitted (x64 and/or ARM64).

## Local Store bundle

On Windows with Node 22 and Rust:

```powershell
npm ci --legacy-peer-deps
npm run tauri -- build --bundles nsis,msi --config src-tauri/tauri.store.conf.json
```

The Store overlay (`src-tauri/tauri.store.conf.json`) uses the **offline** WebView2 installer so certification does not depend on downloading WebView2 during installation.
