export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function windowAction(kind: "minimize" | "toggleMaximize" | "close") {
  if (!isTauri()) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const win = getCurrentWindow();
  if (kind === "minimize") await win.minimize();
  else if (kind === "toggleMaximize") await win.toggleMaximize();
  else await win.close();
}

export type WslcProbe = {
  wslc: boolean;
  sidecar: boolean;
  version: string | null;
  sidecarPath?: string | null;
  sidecarError?: string | null;
};

export type WslcInvokeResult = {
  ok: boolean;
  output?: string;
  error?: string;
};

export async function invokeWslcHost(payload: Record<string, unknown>): Promise<WslcInvokeResult> {
  if (!isTauri()) return { ok: true, output: "browser lab" };
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<WslcInvokeResult>("wslc_invoke", { payload });
}

export async function probeWslc(): Promise<WslcProbe> {
  if (!isTauri()) {
    return { wslc: false, sidecar: false, version: null };
  }
  const { invoke } = await import("@tauri-apps/api/core");
  const raw = await invoke<WslcProbe>("wslc_probe");
  return {
    wslc: Boolean(raw?.wslc),
    sidecar: Boolean(raw?.sidecar),
    version: raw?.version ?? null,
    sidecarPath: raw?.sidecarPath ?? null,
    sidecarError: raw?.sidecarError ?? null,
  };
}

export async function getLaunchAtSignIn(): Promise<boolean> {
  if (!isTauri()) return loadLaunchFallback();
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return Boolean(await invoke<boolean>("autostart_enabled"));
  } catch {
    return loadLaunchFallback();
  }
}

export async function setLaunchAtSignIn(enabled: boolean): Promise<boolean> {
  saveLaunchFallback(enabled);
  if (!isTauri()) return enabled;
  const { invoke } = await import("@tauri-apps/api/core");
  return Boolean(await invoke<boolean>("autostart_set", { enabled }));
}

function loadLaunchFallback() {
  try {
    return localStorage.getItem("quay.launchAtSignIn") === "1";
  } catch {
    return false;
  }
}

function saveLaunchFallback(enabled: boolean) {
  try {
    localStorage.setItem("quay.launchAtSignIn", enabled ? "1" : "0");
  } catch {
    /* ignore */
  }
}
