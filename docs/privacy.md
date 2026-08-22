# Privacy

Quay runs on your PC. It does not have an account system and does not send telemetry, crash reports, or usage data to us.

## What it touches

- **WSL containers** on this machine, through the installed `wslc.exe` command-line tool.
- **Images you pull** from the registries you name (for example `docker.io`). Those registries see the pull, not us.
- **Local files** you bind-mount into a container.

## Network

The UI is a local WebView. Installers may download the Evergreen WebView2 runtime from Microsoft if your Windows install does not already have it. Store builds embed/offline-install that runtime so the installer works without a second download.

## Microsoft Store

If you install from the Store, Microsoft’s own Store policies and diagnostics apply to the Store client, not to Quay’s process.

## Contact

Issues and questions: [github.com/dhhieu113pro/quay/issues](https://github.com/dhhieu113pro/quay/issues)
