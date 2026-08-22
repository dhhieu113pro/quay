import { mcpStack, specFromPreset } from "./catalog";
import type { ContainerGroup, RunSpec } from "./types";

const GROUPS_KEY = "quay.groups.v1";
const ASSIGNMENTS_KEY = "quay.container-groups.v1";

const localCoding: ContainerGroup = {
  id: "local-coding",
  name: "LocalCoding",
  network: "mcp-net",
  env: "",
  builtIn: true,
  autoStart: false,
  specs: mcpStack.map((preset) => ({ ...specFromPreset(preset), groupId: "local-coding" })),
};

export const builtInGroups: ContainerGroup[] = [localCoding];

function safeParse<T>(key: string, fallback: T): T {
  if (typeof localStorage === "undefined") return fallback;
  try {
    return JSON.parse(localStorage.getItem(key) || "") as T;
  } catch {
    return fallback;
  }
}

export function slugGroupName(name: string) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || `group-${Date.now()}`;
}

export function defaultGroupNetwork(id: string) {
  return `quay-${id}`;
}

export function loadGroups(): ContainerGroup[] {
  const users = safeParse<ContainerGroup[]>(GROUPS_KEY, [])
    .filter((group) => group && group.id && group.name)
    .map((group) => ({
      ...group,
      builtIn: false,
      env: group.env ?? "",
      network: group.network || defaultGroupNetwork(group.id),
      specs: group.specs ?? [],
    }));
  return [...builtInGroups.map((group) => ({ ...group, specs: group.specs.map((spec) => ({ ...spec })) })), ...users];
}

export function saveGroup(group: ContainerGroup) {
  if (group.builtIn || typeof localStorage === "undefined") return;
  const users = loadGroups().filter((item) => !item.builtIn && item.id !== group.id);
  users.push({ ...group, builtIn: false });
  localStorage.setItem(GROUPS_KEY, JSON.stringify(users));
}

export function deleteGroupDefinition(id: string) {
  if (typeof localStorage === "undefined") return;
  const users = loadGroups().filter((group) => !group.builtIn && group.id !== id);
  localStorage.setItem(GROUPS_KEY, JSON.stringify(users));
  const assignments = loadAssignments();
  for (const [name, groupId] of Object.entries(assignments)) {
    if (groupId === id) delete assignments[name];
  }
  localStorage.setItem(ASSIGNMENTS_KEY, JSON.stringify(assignments));
}

export function mergeEnv(groupEnv: string, containerEnv: string) {
  const values = new Map<string, string>();
  for (const source of [groupEnv, containerEnv]) {
    for (const raw of source.split("\n")) {
      const line = raw.trim();
      if (!line) continue;
      const at = line.indexOf("=");
      const key = at < 0 ? line : line.slice(0, at);
      const value = at < 0 ? "" : line.slice(at + 1);
      values.set(key, value);
    }
  }
  return Array.from(values, ([key, value]) => `${key}=${value}`).join("\n");
}

export function effectiveSpec(spec: RunSpec, group?: ContainerGroup): RunSpec {
  if (!group) return spec;
  return {
    ...spec,
    groupId: group.id,
    env: mergeEnv(group.env, spec.env),
  };
}

export function loadAssignments(): Record<string, string> {
  return safeParse<Record<string, string>>(ASSIGNMENTS_KEY, {});
}

export function assignContainer(name: string, groupId?: string) {
  if (typeof localStorage === "undefined" || !name.trim()) return;
  const assignments = loadAssignments();
  if (groupId) assignments[name.trim()] = groupId;
  else delete assignments[name.trim()];
  localStorage.setItem(ASSIGNMENTS_KEY, JSON.stringify(assignments));
}

export function groupForContainer(name: string) {
  return loadAssignments()[name];
}
