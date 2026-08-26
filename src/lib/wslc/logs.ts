import type { AggregatedLogLine } from "./types";

const ISO_PREFIX = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?)\s+(.*)$/;

function lineId(containerId: string, ts: number, stream: "stdout" | "stderr", text: string, ordinal: number) {
  return `${containerId}|${ts}|${stream}|${ordinal}|${text}`;
}

export function parseContainerLogs(input: {
  output?: string;
  containerId: string;
  containerName: string;
  cubeId?: string;
  cubeName?: string;
  receivedAt?: number;
}): AggregatedLogLine[] {
  const receivedAt = input.receivedAt ?? Date.now();
  const duplicateCounts = new Map<string, number>();
  return (input.output ?? "").split(/\r?\n/).filter(Boolean).map((raw, index) => {
    const stderr = raw.startsWith("stderr: ");
    const normalized = stderr ? raw.slice(8) : raw.startsWith("stdout: ") ? raw.slice(8) : raw;
    const match = normalized.match(ISO_PREFIX);
    const parsedTs = match ? Date.parse(match[1]) : Number.NaN;
    const text = match ? match[2] : normalized;
    const stream = stderr ? "stderr" as const : "stdout" as const;
    const ts = Number.isFinite(parsedTs) ? parsedTs : receivedAt + index;
    const duplicateKey = `${stream}|${text}`;
    const ordinal = duplicateCounts.get(duplicateKey) ?? 0;
    duplicateCounts.set(duplicateKey, ordinal + 1);
    return {
      id: lineId(input.containerId, ts, stream, text, ordinal),
      ts,
      containerId: input.containerId,
      containerName: input.containerName,
      cubeId: input.cubeId,
      cubeName: input.cubeName,
      stream,
      text,
    };
  });
}

export function mergeAggregatedLogs(
  existing: AggregatedLogLine[],
  incoming: AggregatedLogLine[],
  maxLines = 10_000,
): AggregatedLogLine[] {
  const byId = new Map<string, AggregatedLogLine>();
  for (const line of existing) byId.set(line.id, line);
  for (const line of incoming) byId.set(line.id, line);
  return [...byId.values()]
    .sort((a, b) => a.ts - b.ts || a.id.localeCompare(b.id))
    .slice(-maxLines);
}

export function formatLogSource(line: AggregatedLogLine) {
  return line.cubeName ? `${line.cubeName}[${line.containerName}]` : `[${line.containerName}]`;
}
