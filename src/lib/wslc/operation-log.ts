export type StoredOperationLog = {
  id: string;
  ts: number;
  containerName?: string;
  command: string;
  text: string;
};

const STORAGE_KEY = "quay.operationLogs";
const MAX_OPERATION_LOGS = 500;

export function redactOperationText(value: string) {
  return value
    .replace(/((?:NGROK_AUTHTOKEN|API[_-]?KEY|TOKEN|PASSWORD|SECRET)\s*=\s*)([^\s"']+)/gi, "$1[REDACTED]")
    .replace(/(Bearer\s+)([^\s"']+)/gi, "$1[REDACTED]");
}

function storageAvailable() {
  return typeof localStorage !== "undefined";
}

export function loadOperationLogs(): StoredOperationLog[] {
  if (!storageAvailable()) return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const row = entry as Partial<StoredOperationLog>;
      if (typeof row.id !== "string" || typeof row.ts !== "number" || typeof row.command !== "string" || typeof row.text !== "string") return [];
      return [{
        id: row.id,
        ts: row.ts,
        containerName: typeof row.containerName === "string" ? row.containerName : undefined,
        command: row.command,
        text: row.text,
      }];
    });
  } catch {
    return [];
  }
}

export function appendOperationLog(input: Omit<StoredOperationLog, "id" | "ts"> & { id?: string; ts?: number }) {
  const entry: StoredOperationLog = {
    id: input.id ?? crypto.randomUUID(),
    ts: input.ts ?? Date.now(),
    containerName: input.containerName,
    command: redactOperationText(input.command),
    text: redactOperationText(input.text),
  };
  if (!storageAvailable()) return entry;
  try {
    const next = [...loadOperationLogs(), entry].slice(-MAX_OPERATION_LOGS);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Diagnostics must never break a WSLC operation.
  }
  return entry;
}

export function clearOperationLogs() {
  if (!storageAvailable()) return;
  try { localStorage.removeItem(STORAGE_KEY); }
  catch { /* ignore storage failures */ }
}
