# Quay

Tauri-style desktop for **WSL containers**. The WebView is this UI. Native work is a C# sidecar on [`Microsoft.WSL.Containers`](https://learn.microsoft.com/windows/wsl/wsl-container).

```
WebView (this UI)
    invoke JSON over stdin
C# sidecar  —  Microsoft.WSL.Containers
    WinRT
WSL container VM  (Hyper-V, virtiofs, consomme, CDI GPU)
```

Requires WSL **2.9.3+** (`wsl --update --pre-release`) and `wslc.exe` on PATH.

## Layout

| Path | Role |
| --- | --- |
| `src/` | React UI (containers, images, session, live C# invoke log) |
| `host/` | `Quay.Host` — C# sidecar |
| `src-tauri/` | Thin Rust bridge that shells out to the sidecar |

## C# sidecar

```bash
cd host
dotnet add package Microsoft.WSL.Containers
dotnet run
```

The host speaks JSON lines on stdin:

```json
{"cmd":"pull","image":"docker.io/library/nginx:latest"}
{"cmd":"run","image":"nginx:latest","name":"web"}
{"cmd":"stop","id":"..."}
{"cmd":"rm","id":"..."}
{"cmd":"ps"}
```

Same surface as `wslc run`, `wslc pull`, `wslc container stop`.

## UI

The preview you used is a simulated lab (nginx, Postgres, Redis, Webtop, a CUDA trainer) so the desktop can be driven without Windows. On a real box the sidecar calls the WSL container API instead of the simulator in `src/lib/wslc/store.ts`.

```bash
npm install
npm run dev
```

## License

MIT
