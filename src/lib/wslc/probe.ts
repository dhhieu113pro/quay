import { isTauri, probeWslc } from "@/lib/tauri";

export type ProbeResult = {
  /** Overall runtime readiness: wslc is available to the native CLI worker. */
  wsl: boolean;
  wslVersion: string | null;
  wslc: boolean;
  wslcOnPath: boolean;
  version: string | null;
  missing: string[];
  note: string;
};

export async function checkHost(): Promise<ProbeResult> {
  if (!isTauri()) {
    return {
      wsl: false,
      wslVersion: null,
      wslc: false,
      wslcOnPath: false,
      version: null,
      missing: ["wsl", "wslc"],
      note: "This desktop is not talking to a Windows host yet.",
    };
  }

  try {
    const probe = await probeWslc();
    const missing = [
      ...(probe.wsl ? [] : ["wsl"]),
      ...(probe.wslc ? [] : ["wslc"]),
    ];

    let note: string;
    if (!probe.wsl) {
      note = "WSL is not available. Install WSL, then update to a build that includes WSL Containers.";
    } else if (!probe.wslc) {
      note = "WSL is installed, but wslc.exe is not available. Update WSL to 2.9.3+ pre-release and retry.";
    } else {
      note = probe.version ?? "wslc is ready";
    }

    return {
      wsl: probe.wsl,
      wslVersion: probe.wslVersion,
      wslc: probe.wslc,
      wslcOnPath: probe.wslc,
      version: probe.version,
      missing,
      note,
    };
  } catch (err) {
    return {
      wsl: false,
      wslVersion: null,
      wslc: false,
      wslcOnPath: false,
      version: null,
      missing: ["wslc"],
      note: err instanceof Error ? err.message : "Could not probe Quay runtime",
    };
  }
}
