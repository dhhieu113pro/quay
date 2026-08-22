/** Split `D:\src:/workspace:rw` without treating the drive colon as a delimiter. */
export function parseMountLine(line: string): {
  source: string;
  destination: string;
  mode: "rw" | "ro";
} {
  const trimmed = line.trim();
  const modeMatch = trimmed.match(/:(rw|ro)$/i);
  const mode = modeMatch?.[1]?.toLowerCase() === "ro" ? "ro" : "rw";
  const rest = modeMatch ? trimmed.slice(0, -modeMatch[0].length) : trimmed;
  const destAt = rest.lastIndexOf(":/");
  if (destAt >= 0) {
    return {
      source: rest.slice(0, destAt),
      destination: rest.slice(destAt + 1),
      mode,
    };
  }
  const last = rest.lastIndexOf(":");
  if (last >= 0) {
    return {
      source: rest.slice(0, last),
      destination: rest.slice(last + 1),
      mode,
    };
  }
  return { source: rest, destination: rest, mode };
}

export function parseMountsRaw(raw: string) {
  return raw
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .map(parseMountLine);
}
