import { invokeWslcHost } from "@/lib/tauri";

export interface WslcStatsSummary {
  cpuPercent: number;
  memoryMB: number;
  running: number;
}

const field = (row: Record<string, unknown>, ...names: string[]) => {
  for (const [key, value] of Object.entries(row)) {
    if (names.some((name) => key.toLowerCase() === name.toLowerCase())) return value;
  }
  return undefined;
};

function parsePercent(value: unknown) {
  const parsed = Number.parseFloat(String(value ?? "").replace("%", "").trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseSizeMB(value: string) {
  const match = value.trim().match(/^([\d.]+)\s*(B|KiB|MiB|GiB|TiB|KB|MB|GB|TB)$/i);
  if (!match) return 0;

  const amount = Number.parseFloat(match[1] ?? "0");
  if (!Number.isFinite(amount)) return 0;

  switch ((match[2] ?? "").toLowerCase()) {
    case "b": return amount / (1024 * 1024);
    case "kib": return amount / 1024;
    case "kb": return amount / 1000;
    case "mib": return amount;
    case "mb": return amount;
    case "gib": return amount * 1024;
    case "gb": return amount * 1000;
    case "tib": return amount * 1024 * 1024;
    case "tb": return amount * 1000 * 1000;
    default: return 0;
  }
}

function statsRows(output?: string): Record<string, unknown>[] {
  if (!output?.trim()) return [];
  try {
    const parsed: unknown = JSON.parse(output);
    if (Array.isArray(parsed)) {
      return parsed.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object");
    }
    if (parsed && typeof parsed === "object") return [parsed as Record<string, unknown>];
  } catch {
    return [];
  }
  return [];
}

export async function loadWslcStatsSummary(): Promise<WslcStatsSummary | null> {
  const result = await invokeWslcHost({
    cmd: "run_cli",
    args: ["stats", "--format", "json"],
  });
  if (!result.ok) return null;

  const rows = statsRows(result.output);
  let cpuPercent = 0;
  let memoryMB = 0;

  for (const row of rows) {
    cpuPercent += parsePercent(field(row, "CPUPerc", "cpuPercent", "cpu"));
    const usage = String(field(row, "MemUsage", "memoryUsage", "memory") ?? "");
    const used = usage.split("/")[0]?.trim() ?? "";
    memoryMB += parseSizeMB(used);
  }

  return {
    cpuPercent,
    memoryMB,
    running: rows.length,
  };
}
