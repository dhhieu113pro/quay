import { defaultCubeWorkspacePath, defaultStandaloneWorkspacePath } from "@/lib/workspace";
import { cubeNetworkName, slugGroupName } from "@/lib/wslc/groups";
import type { Container, ContainerGroup, RunSpec } from "@/lib/wslc/types";

export function nextCloneName(source: string, existing: Iterable<string>, separator = "-"): string {
  const names = new Set(Array.from(existing, (name) => name.toLowerCase()));
  const base = `${source}${separator}copy`;
  if (!names.has(base.toLowerCase())) return base;
  for (let index = 2; ; index += 1) {
    const candidate = `${base}${separator}${index}`;
    if (!names.has(candidate.toLowerCase())) return candidate;
  }
}

export function cloneCubeDraft(
  source: ContainerGroup,
  existingCubes: ContainerGroup[],
  existingContainerNames: Iterable<string>,
): ContainerGroup {
  const name = nextCloneName(source.name, existingCubes.map((cube) => cube.name), " ");
  const id = slugGroupName(name);
  const usedNames = new Set(Array.from(existingContainerNames));
  const specs = source.specs.map((spec) => {
    const nextName = nextCloneName(spec.name || spec.image.split(/[/:]/).pop() || "container", usedNames);
    usedNames.add(nextName);
    return { ...spec, name: nextName, groupId: id, workspacePath: undefined };
  });
  return {
    ...source,
    id,
    name,
    network: cubeNetworkName(name),
    workspacePath: defaultCubeWorkspacePath(name),
    builtIn: false,
    autoStart: false,
    specs,
  };
}

export function renameCloneCube(draft: ContainerGroup, name: string): ContainerGroup {
  const clean = name.trim();
  const id = slugGroupName(clean);
  return {
    ...draft,
    id,
    name: clean,
    network: cubeNetworkName(clean),
    workspacePath: defaultCubeWorkspacePath(clean),
    specs: draft.specs.map((spec) => ({ ...spec, groupId: id })),
  };
}

export function cloneContainerSpec(container: Container, existingNames: Iterable<string>): RunSpec {
  const name = nextCloneName(container.name, existingNames);
  const ports = container.ports
    .filter((port) => port.host && port.container)
    .map((port) => `${port.host}:${port.container}${port.protocol === "udp" ? "/udp" : ""}`)
    .join(",");
  const env = Object.entries(container.env).map(([key, value]) => `${key}=${value}`).join("\n");
  const mounts = container.mounts.map((mount) => `${mount.source}:${mount.destination}${mount.mode === "ro" ? ":ro" : ""}`).join("\n");
  return {
    image: container.image,
    name,
    command: container.command.join(" "),
    ports,
    env,
    mounts,
    gpu: container.gpu,
    remove: false,
    detach: true,
    workdir: container.workdir || "/",
    workspacePath: defaultStandaloneWorkspacePath(name),
    workspaceTarget: "/workspace",
    groupId: undefined,
  };
}

export function renameCloneContainer(spec: RunSpec, name: string): RunSpec {
  const clean = name.trim();
  return { ...spec, name: clean, workspacePath: defaultStandaloneWorkspacePath(clean || "container") };
}
