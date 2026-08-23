# Microsoft Store

Quay supports two Store packaging paths:

- **Automated MSIX submission** through `.github/workflows/store-msix.yml`. A tag such as `v0.1.5-store` builds x64 + ARM64 Store MSIX packages and submits them directly through the Microsoft Store submission API.
- **Manual MSI/EXE packaging** through `.github/workflows/store.yml` for the traditional Win32 Partner Center flow.

The `-store` suffix is only a deployment trigger. `v0.1.5-store` produces Store package version `0.1.5`.

## First listing and API prerequisites

The Microsoft Store submission API can update an existing Partner Center product, but it cannot create the first product/submission for you.

1. Reserve **Quay for WSL** in Partner Center.
2. Complete the first submission manually, including the age-ratings questionnaire and required listing metadata.
3. Associate a Microsoft Entra application with the Partner Center account.
4. Copy the current listing text from [`store/listing.md`](../store/listing.md).
5. Use these URLs:
   - Privacy: `https://github.com/dhhieu113pro/quay/blob/main/docs/privacy.md`
   - Support: `https://github.com/dhhieu113pro/quay/issues`
   - Website: `https://github.com/dhhieu113pro/quay`
6. Keep these certification notes:
   - Quay is a developer tool for Microsoft WSL Containers.
   - It uses the installed `wslc.exe` directly and the default WSLC session.
   - It does not install another container engine or Windows service.
   - It requires a WSL build with WSL Containers (`wsl --update --pre-release` when needed).
   - The app can diagnose missing WSL/WSLC on first launch.

Publisher display name is **Hieu Dam** so it does not collide with the product name **Quay**.

## Repository configuration

The Store MSIX build already uses the Partner Center identity values:

- `STORE_PACKAGE_NAME` — Partner Center `Package/Identity/Name`
- `STORE_PUBLISHER` — Partner Center `Package/Identity/Publisher`
- `STORE_PUBLISHER_DISPLAY_NAME` — publisher display name

These can be repository variables or secrets.

Direct API submission additionally needs:

- `STORE_TENANT_ID` — Microsoft Entra tenant ID; repository variable or secret
- `STORE_CLIENT_ID` — Microsoft Entra application/client ID; repository variable or secret
- `STORE_CLIENT_SECRET` — Microsoft Entra client secret; **repository secret**
- `STORE_APPLICATION_ID` — Partner Center Store ID for Quay (for example the `9...` application ID); repository variable or secret

Do not commit the client secret to the repository.

## Automatic Store submission

Push a tag ending in `-store`:

```powershell
git tag v0.1.5-store
git push origin v0.1.5-store
```

Only tags matching `vX.Y.Z-store` are accepted. The normal Release workflow explicitly excludes these tags.

The Store workflow then:

1. runs the Store submission API unit tests;
2. derives `X.Y.Z` from the tag and synchronizes the Tauri/Cargo/package versions for the build;
3. builds the x64 and ARM64 Quay executables;
4. creates unsigned Store MSIX packages with the exact Partner Center identity;
5. verifies that both architecture packages exist;
6. creates a ZIP containing both MSIX files;
7. obtains a Microsoft Entra client-credentials token for `https://manage.devcenter.microsoft.com`;
8. creates a new Partner Center submission copied from the last completed submission;
9. updates that submission so both new MSIX files are `PendingUpload`;
10. uploads the ZIP to the SAS URL returned by Partner Center;
11. commits the submission;
12. polls until Partner Center accepts it into preprocessing/certification, or fails the GitHub Actions job with the Store error details.

A manual `workflow_dispatch` run of `store-msix.yml` remains build-only. It does not submit to Partner Center because API submission is intentionally tied to a `-store` tag.

The API implementation lives in [`scripts/store-submission.mjs`](../scripts/store-submission.mjs), with tests in [`tests/store-submission.test.mjs`](../tests/store-submission.test.mjs).

## Manual Store package workflow

The `.github/workflows/store.yml` workflow continues to build the traditional MSI/EXE Store artifacts only. It:

- verifies `package.json`, `tauri.conf.json`, and `Cargo.toml` use the same version;
- builds x64 on `windows-latest`;
- builds ARM64 on `windows-11-arm`;
- uses the Store Tauri overlay with the offline WebView2 installer;
- uploads separate x64 and ARM64 artifacts.

For MSI/EXE Store submissions, Microsoft requires the installer and contained PE binaries to be Authenticode-signed by a certificate chaining to the Microsoft Trusted Root Program. The automated `-store` path therefore uses MSIX instead, which Partner Center signs as part of Store processing.

## Pre-submission test checklist

Test Quay on a clean Windows account/machine before creating a Store tag:

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
- Repeat the smoke test for x64 and ARM64 when possible.

## Local Store bundle

On Windows with Node 22 and Rust:

```powershell
npm ci --legacy-peer-deps
npm run tauri -- build --bundles nsis,msi --config src-tauri/tauri.store.conf.json
```

The Store overlay (`src-tauri/tauri.store.conf.json`) uses the **offline** WebView2 installer so certification does not depend on downloading WebView2 during installation.
