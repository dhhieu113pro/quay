import { isTauri, probeWslc } from "@/lib/tauri";

export type ProbeResult = {
  /** Overall runtime readiness: wslc is available and Quay.Host is running. */
  wslc: boolean;
  wslcOnPath: boolean;
  sidecar: boolean;
  version: string | null;
  sidecarPath: string | null;
  sidecarError: string | null;
  missing: string[];
  note: string;
};

export async function checkHost(): Promise<ProbeResult> {
  if (!isTauri()) {
    return {
      wslc: false,
      wslcOnPath: false,
      sidecar: false,
      version: null,
      sidecarPath: null,
      sidecarError: null,
      missing: ["wslc", "quay-host"],
      note: "This desktop is not talking to a Windows host yet.",
    };
  }

  try {
    const probe = await probeWslc();
    const ready = probe.wslc && probe.sidecar;
    const missing = [
      ...(probe.wslc ? [] : ["wslc"]),
      ...(probe.sidecar ? [] : ["quay-host"]),
    ];

    let note: string;
    if (!probe.wslc) {
      note = "wslc.exe is not on PATH. Install WSL 2.9.3+ (pre-release).";
    } else if (!probe.sidecar) {
      const details = [
        "Quay.Host backend failed to start.",
        probe.sidecarPath ? `Path: ${probe.sidecarPath}` : null,
        probe.sidecarError ? `Error: ${probe.sidecarError}` : null,
      ].filter(Boolean);
      note = details.join(" ");
    } else {
      note = probe.version ?? "wslc on PATH · Quay.Host running";
    }

    return {
      wslc: ready,
      wslcOnPath: probe.wslc,
      sidecar: probe.sidecar,
      version: probe.version,
      sidecarPath: probe.sidecarPath ?? null,
      sidecarError: probe.sidecarError ?? null,
      missing,
      note,
    };
  } catch (err) {
    return {
      wslc: false,
      wslcOnPath: false,
      sidecar: false,
      version: null,
      sidecarPath: null,
      sidecarError: err instanceof Error ? err.message : "Could not probe Quay runtime",
      missing: ["wslc", "quay-host"],
      note: err instanceof Error ? err.message : "Could not probe Quay runtime",
    };
  }
}
