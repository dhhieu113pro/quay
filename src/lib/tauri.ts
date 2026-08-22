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
