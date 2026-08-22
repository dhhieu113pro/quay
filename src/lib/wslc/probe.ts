import { isTauri, probeWslc } from "@/lib/tauri";

export type ProbeResult = {
  /** Overall runtime readiness: wslc is available to the native CLI worker. */
  wslc: boolean;
  wslcOnPath: boolean;
  version: string | null;
  missing: string[];
  note: string;
};

export async function checkHost(): Promise<ProbeResult> {
  if (!isTauri()) {
    return {
      wslc: false,
      wslcOnPath: false,
      version: null,
      missing: ["wslc"],
      note: "This desktop is not talking to a Windows host yet.",
    };
  }

  try {
    const probe = await probeWslc();
    const missing = probe.wslc ? [] : ["wslc"];

    let note: string;
    if (!probe.wslc) {
      note = "wslc.exe is not on PATH. Install WSL 2.9.3+ (pre-release).";
    } else {
      note = probe.version ?? "wslc on PATH";
    }

    return {
      wslc: probe.wslc,
      wslcOnPath: probe.wslc,
      version: probe.version,
      missing,
      note,
    };
  } catch (err) {
    return {
      wslc: false,
      wslcOnPath: false,
      version: null,
      missing: ["wslc"],
      note: err instanceof Error ? err.message : "Could not probe Quay runtime",
    };
  }
}
