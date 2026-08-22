# Microsoft Store

Quay is a full-trust Win32 desktop (Tauri + C# sidecar). It talks to WSL, so it cannot ship as a sandboxed UWP/MSIX without `runFullTrust`. Partner Center’s **EXE or MSI app** listing is the path Tauri documents and the one this repo builds for.

## First listing (once)

1. Open [Partner Center](https://partner.microsoft.com) → **Windows & Xbox** → **New product** → **EXE or MSI app**.
2. Reserve the name **Quay for WSL** (plain “Quay” is likely taken).
3. Store listing copy is in [`store/listing.md`](../store/listing.md). Privacy policy URL:
   `https://github.com/dhhieu113pro/quay/blob/main/docs/privacy.md`
   Support URL:
   `https://github.com/dhhieu113pro/quay/issues`
4. Cut a GitHub Release (`git tag v0.1.0 && git push --tags`). The **Release** workflow attaches:
   - `Quay_<version>_x64-setup.exe` (NSIS)
   - `Quay_<version>_x64_en-US.msi`
5. In Partner Center, point the package at the GitHub Release asset URL, or upload the file from the **Microsoft Store** workflow artifact.
6. Silent install argument:
   - NSIS: `/S`
   - MSI: `/quiet`
7. Notes for certification: requires Windows 10 22H2+ / Windows 11, WSL **2.9.3+** (`wsl --update --pre-release`), and `wslc.exe`. The app is a developer tool that starts a WSL container session on the machine.

Publisher display name in the installer is **Hieu Dam** so it does not collide with the product name **Quay** (Store rejects that match).

## GitHub secrets (later updates)

After the first listing is live, add these repository secrets and tick **Submit to Partner Center** on the **Microsoft Store** workflow:

| Secret | Where |
| --- | --- |
| `STORE_PRODUCT_ID` | Partner Center product / Store ID |
| `SELLER_ID` | Partner Center → Account settings |
| `AZURE_AD_TENANT_ID` | Entra ID tenant linked to Partner Center |
| `AZURE_AD_APPLICATION_CLIENT_ID` | Entra app registration, **Manager** role in Partner Center |
| `AZURE_AD_APPLICATION_SECRET` | That app’s client secret |

Optional Authenticode (SmartScreen on GitHub Releases):

| Secret | Where |
| --- | --- |
| `TAURI_SIGNING_PRIVATE_KEY` | `tauri signer generate` minisign key (updater) |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | Key password |

## Local Store bundle

On a Windows box with Node 22, Rust, and .NET 9:

```powershell
./scripts/prepare-sidecar.ps1
npm ci
npm run tauri -- build --bundles nsis,msi --config src-tauri/tauri.store.conf.json
```

The Store overlay (`src-tauri/tauri.store.conf.json`) uses the **offline** WebView2 installer so certification does not depend on a network fetch.
