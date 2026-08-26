import type { AggregatedLogLine, Container, ContainerGroup } from "./types";

export function filterAggregatedLogs(
  lines: AggregatedLogLine[],
  cubeId: string | null,
  containerName: string | null,
) {
  return lines.filter((line) => {
    if (cubeId && line.cubeId !== cubeId) return false;
    if (containerName && line.containerName !== containerName) return false;
    return true;
  });
}

export function containerOptionsForCube(
  containers: Container[],
  groups: ContainerGroup[],
  cubeId: string | null,
): Array<{ name: string; label: string }> {
  const names = new Set<string>();
  if (cubeId) {
    const cube = groups.find((item) => item.id === cubeId);
    for (const spec of cube?.specs ?? []) if (spec.name) names.add(spec.name);
    for (const container of containers) if (container.groupId === cubeId) names.add(container.name);
  } else {
    for (const container of containers) names.add(container.name);
    for (const cube of groups) for (const spec of cube.specs) if (spec.name) names.add(spec.name);
  }
  return [...names].sort((a, b) => a.localeCompare(b)).map((name) => ({ name, label: name }));
}
