import { isTauri, probeWslc } from "@/lib/tauri";

export type ProbeResult = {
  wslc: boolean;
  sidecar: boolean;
  version: string | null;
  missing: string[];
  note: string;
};

export async function checkHost(): Promise<ProbeResult> {
  if (!isTauri()) {
    return {
      wslc: false,
      sidecar: false,
      version: null,
      missing: ["wslc"],
      note: "This desktop is not talking to a Windows host yet.",
    };
  }
  try {
    const probe = await probeWslc();
    const missing = probe.wslc ? [] : ["wslc"];
    return {
      wslc: probe.wslc,
      sidecar: probe.sidecar,
      version: probe.version,
      missing,
      note: probe.wslc
        ? probe.version ?? "wslc on PATH"
        : "wslc.exe is not on PATH. Install WSL 2.9.3+ (pre-release).",
    };
  } catch (err) {
    return {
      wslc: false,
      sidecar: false,
      version: null,
      missing: ["wslc"],
      note: err instanceof Error ? err.message : "Could not probe wslc",
    };
  }
}
