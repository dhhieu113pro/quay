import { mcpStack, specFromPreset } from "./catalog";
import type { ContainerGroup, RunSpec } from "./types";

const GROUPS_KEY = "quay.groups.v1";
const BUILTIN_OVERRIDES_KEY = "quay.group-overrides.v1";
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

function envEntries(raw: string) {
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const at = line.indexOf("=");
      return [at < 0 ? line : line.slice(0, at), at < 0 ? "" : line.slice(at + 1)] as const;
    });
}

export function slugGroupName(name: string) {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || `cube-${Date.now()}`;
}

export function defaultGroupNetwork(id: string) {
  return `quay-${id}`;
}

function mergeSpecs(base: RunSpec[], extras: RunSpec[] = []) {
  const byName = new Map(base.map((spec) => [spec.name, { ...spec }]));
  for (const spec of extras) byName.set(spec.name, { ...spec });
  return Array.from(byName.values());
}

export function loadGroups(): ContainerGroup[] {
  const overrides = safeParse<Record<string, Partial<ContainerGroup>>>(BUILTIN_OVERRIDES_KEY, {});
  const builtIns = builtInGroups.map((group) => {
    const override = overrides[group.id] ?? {};
    return {
      ...group,
      network: override.network || group.network,
      env: override.env ?? group.env,
      autoStart: override.autoStart ?? group.autoStart,
      specs: mergeSpecs(group.specs, override.specs),
    };
  });
  const users = safeParse<ContainerGroup[]>(GROUPS_KEY, [])
    .filter((group) => group && group.id && group.name)
    .map((group) => ({
      ...group,
      builtIn: false,
      env: group.env ?? "",
      network: group.network || defaultGroupNetwork(group.id),
      specs: group.specs ?? [],
    }));
  return [...builtIns, ...users];
}

export function saveGroup(group: ContainerGroup) {
  if (typeof localStorage === "undefined") return;
  if (group.builtIn) {
    const overrides = safeParse<Record<string, Partial<ContainerGroup>>>(BUILTIN_OVERRIDES_KEY, {});
    const base = builtInGroups.find((item) => item.id === group.id);
    const baseNames = new Set(base?.specs.map((spec) => spec.name) ?? []);
    const extras = group.specs.filter((spec) => !baseNames.has(spec.name));
    overrides[group.id] = {
      network: group.network,
      env: group.env,
      autoStart: group.autoStart,
      specs: extras,
    };
    localStorage.setItem(BUILTIN_OVERRIDES_KEY, JSON.stringify(overrides));
    return;
  }
  const users = loadGroups().filter((item) => !item.builtIn && item.id !== group.id);
  users.push({ ...group, builtIn: false });
  localStorage.setItem(GROUPS_KEY, JSON.stringify(users));
}

export function rememberGroupSpec(group: ContainerGroup, spec: RunSpec) {
  const normalized = { ...spec, groupId: group.id };
  const specs = [
    ...group.specs.filter((item) => item.name !== normalized.name),
    normalized,
  ];
  const updated = syncGroupEnv({ ...group, specs });
  saveGroup(updated);
  return updated;
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

export function mergeEnv(first: string, second: string) {
  const values = new Map<string, string>();
  for (const source of [first, second]) {
    for (const [key, value] of envEntries(source)) values.set(key, value);
  }
  return Array.from(values, ([key, value]) => `${key}=${value}`).join("\n");
}

export function withoutEnvKeys(env: string, inheritedEnv: string) {
  const inheritedKeys = new Set(envEntries(inheritedEnv).map(([key]) => key));
  return envEntries(env)
    .filter(([key]) => !inheritedKeys.has(key))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
}

export function syncGroupEnv(group: ContainerGroup): ContainerGroup {
  const values = new Map(envEntries(group.env));
  for (const spec of group.specs) {
    for (const [key, value] of envEntries(spec.env)) {
      if (!values.has(key)) values.set(key, value);
    }
  }
  const env = Array.from(values, ([key, value]) => `${key}=${value}`).join("\n");
  return {
    ...group,
    env,
    specs: group.specs.map((spec) => ({
      ...spec,
      env: withoutEnvKeys(spec.env, env),
    })),
  };
}

export function effectiveSpec(spec: RunSpec, group?: ContainerGroup): RunSpec {
  if (!group) return spec;
  return {
    ...spec,
    groupId: group.id,
    env: mergeEnv(spec.env, group.env),
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
