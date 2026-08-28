import {
  DEFAULT_WORKSPACE_TARGET,
  defaultCubeContainerWorkspacePath,
  defaultCubeWorkspacePath,
  normalizeWorkspacePath,
} from "@/lib/workspace";
import { mcpStack, specFromPreset } from "./catalog";
import type { Container, ContainerGroup, RunSpec } from "./types";

const GROUPS_KEY = "quay.groups.v1";
const BUILTIN_OVERRIDES_KEY = "quay.group-overrides.v1";
const ASSIGNMENTS_KEY = "quay.container-groups.v1";

export function cubeNetworkName(name: string) {
  return `${name.trim().replace(/\s+/g, "")}NetWork`;
}

export function cubeContainerName(cubeName: string, name: string) {
  const cube = cubeName.trim();
  const member = name.trim();
  if (!cube || !member) return member;
  const prefix = `${cube}-`;
  return member.toLowerCase().startsWith(prefix.toLowerCase()) ? member : `${prefix}${member}`;
}

const localCoding: ContainerGroup = {
  id: "local-coding",
  name: "LocalCoding",
  network: cubeNetworkName("LocalCoding"),
  env: "",
  builtIn: true,
  autoStart: false,
  workspacePath: defaultCubeWorkspacePath("LocalCoding"),
  specs: mcpStack.map((preset) => ({ ...specFromPreset(preset), name: cubeContainerName("LocalCoding", preset.name), groupId: "local-coding" })),
};

export const builtInGroups: ContainerGroup[] = [localCoding];

function safeParse<T>(key: string, fallback: T): T {
  if (typeof localStorage === "undefined") return fallback;
  try { return JSON.parse(localStorage.getItem(key) || "") as T; }
  catch { return fallback; }
}

function envEntries(raw: string) {
  return raw.split("\n").map((line) => line.trim()).filter(Boolean).map((line) => {
    const at = line.indexOf("=");
    return [at < 0 ? line : line.slice(0, at), at < 0 ? "" : line.slice(at + 1)] as const;
  });
}

export function slugGroupName(name: string) {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || `cube-${Date.now()}`;
}
export function defaultGroupNetwork(id: string) { return `quay-${id}`; }

function mergeSpecs(base: RunSpec[], extras: RunSpec[] = []) {
  const byName = new Map(base.map((spec) => [spec.name, { ...spec }]));
  for (const spec of extras) byName.set(spec.name, { ...spec });
  return Array.from(byName.values());
}

export function normalizeGroupWorkspace(group: ContainerGroup): ContainerGroup {
  const workspacePath = normalizeWorkspacePath(group.workspacePath || defaultCubeWorkspacePath(group.name));
  return { ...group, network: cubeNetworkName(group.name), workspacePath, specs: (group.specs ?? []).map((spec) => ({ ...spec, name: cubeContainerName(group.name, spec.name || spec.image), groupId: group.id,
    workspacePath: normalizeWorkspacePath(spec.workspacePath || defaultCubeContainerWorkspacePath(workspacePath, cubeContainerName(group.name, spec.name || spec.image))),
    workspaceTarget: spec.workspaceTarget?.trim() || DEFAULT_WORKSPACE_TARGET })) };
}

export function loadGroups(): ContainerGroup[] {
  const overrides = safeParse<Record<string, Partial<ContainerGroup>>>(BUILTIN_OVERRIDES_KEY, {});
  const builtIns = builtInGroups.map((group) => {
    const override = overrides[group.id] ?? {};
    const overrideSpecs = (override.specs ?? []).map((spec) => ({ ...spec, name: cubeContainerName(group.name, spec.name || spec.image) }));
    return normalizeGroupWorkspace({ ...group, env: override.env ?? group.env,
      autoStart: override.autoStart ?? group.autoStart, workspacePath: override.workspacePath ?? group.workspacePath,
      protectedEnvKeys: override.protectedEnvKeys ?? group.protectedEnvKeys,
      specs: mergeSpecs(group.specs, overrideSpecs) });
  });
  const users = safeParse<ContainerGroup[]>(GROUPS_KEY, []).filter((group) => group && group.id && group.name)
    .map((group) => normalizeGroupWorkspace({ ...group, builtIn: false, env: group.env ?? "", specs: group.specs ?? [] }));
  return [...builtIns, ...users];
}

export function saveGroup(input: ContainerGroup) {
  if (typeof localStorage === "undefined") return;
  const group = normalizeGroupWorkspace(input);
  if (group.builtIn) {
    const overrides = safeParse<Record<string, Partial<ContainerGroup>>>(BUILTIN_OVERRIDES_KEY, {});
    const base = builtInGroups.find((item) => item.id === group.id);
    const baseNames = new Set(base?.specs.map((spec) => spec.name) ?? []);
    const extras = group.specs.filter((spec) => !baseNames.has(spec.name));
    overrides[group.id] = { env: group.env, autoStart: group.autoStart, workspacePath: group.workspacePath,
      protectedEnvKeys: group.protectedEnvKeys, specs: extras };
    localStorage.setItem(BUILTIN_OVERRIDES_KEY, JSON.stringify(overrides));
    return;
  }
  const users = loadGroups().filter((item) => !item.builtIn && item.id !== group.id);
  users.push({ ...group, builtIn: false });
  localStorage.setItem(GROUPS_KEY, JSON.stringify(users));
}

export function rememberGroupSpec(group: ContainerGroup, spec: RunSpec) {
  const normalizedGroup = normalizeGroupWorkspace(group);
  const normalized = { ...spec, groupId: group.id, workspacePath: spec.workspacePath || defaultCubeContainerWorkspacePath(normalizedGroup.workspacePath!, spec.name || spec.image), workspaceTarget: spec.workspaceTarget || DEFAULT_WORKSPACE_TARGET };
  const updated = syncGroupEnv({ ...normalizedGroup, specs: [...normalizedGroup.specs.filter((item) => item.name !== normalized.name), normalized] });
  saveGroup(updated); return updated;
}

export function deleteGroupDefinition(id: string) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(GROUPS_KEY, JSON.stringify(loadGroups().filter((group) => !group.builtIn && group.id !== id)));
  const assignments = loadAssignments();
  for (const [name, groupId] of Object.entries(assignments)) if (groupId === id) delete assignments[name];
  localStorage.setItem(ASSIGNMENTS_KEY, JSON.stringify(assignments));
}

export function mergeEnv(first: string, second: string) {
  const values = new Map<string, string>();
  for (const source of [first, second]) for (const [key, value] of envEntries(source)) values.set(key, value);
  return Array.from(values, ([key, value]) => `${key}=${value}`).join("\n");
}
export function withoutEnvKeys(env: string, inheritedEnv: string) {
  const inheritedKeys = new Set(envEntries(inheritedEnv).map(([key]) => key));
  return envEntries(env).filter(([key]) => !inheritedKeys.has(key)).map(([key, value]) => `${key}=${value}`).join("\n");
}
export function syncGroupEnv(group: ContainerGroup): ContainerGroup {
  const normalized = normalizeGroupWorkspace(group);
  const values = new Map(envEntries(normalized.env));
  const protectedEnvKeys = new Set(normalized.protectedEnvKeys ?? []);
  for (const spec of normalized.specs) {
    for (const [key, value] of envEntries(spec.env)) {
      protectedEnvKeys.add(key);
      if (!values.has(key)) values.set(key, value);
    }
  }
  const env = Array.from(values, ([key, value]) => `${key}=${value}`).join("\n");
  return { ...normalized, env, protectedEnvKeys: Array.from(protectedEnvKeys), specs: normalized.specs.map((spec) => ({ ...spec, env: withoutEnvKeys(spec.env, env) })) };
}
export function effectiveSpec(spec: RunSpec, group?: ContainerGroup): RunSpec {
  if (!group) return spec;
  const normalized = normalizeGroupWorkspace(group);
  return { ...spec, groupId: group.id, env: mergeEnv(spec.env, group.env), workspacePath: spec.workspacePath || defaultCubeContainerWorkspacePath(normalized.workspacePath!, spec.name || spec.image), workspaceTarget: spec.workspaceTarget || DEFAULT_WORKSPACE_TARGET };
}

export function specConfigured(spec: RunSpec, group?: ContainerGroup) {
  const effective = effectiveSpec(spec, group);
  return Boolean(effective.name.trim() && effective.image.trim() && effective.workspacePath?.trim() && effective.workspaceTarget?.trim());
}

function memberNames(cube: ContainerGroup) { return new Set(cube.specs.map((spec) => spec.name).filter(Boolean)); }
export function cubeCanConfigure(cube: ContainerGroup, containers: Container[], operations: Record<string, unknown>) {
  if (operations[`cube:${cube.id}`]) return false;
  const names = memberNames(cube);
  return !containers.some((container) => (container.groupId === cube.id || names.has(container.name)) &&
    (container.status === "running" || container.status === "paused" || container.status === "removing" || operations[`container:${container.name}`]));
}
export function cubeCanStart(cube: ContainerGroup, containers: Container[], operations: Record<string, unknown>) {
  return cube.specs.length > 0 && cubeCanConfigure(cube, containers, operations) && cube.specs.every((spec) => specConfigured(spec, cube));
}

export function loadAssignments(): Record<string, string> { return safeParse<Record<string, string>>(ASSIGNMENTS_KEY, {}); }
export function assignContainer(name: string, groupId?: string) {
  if (typeof localStorage === "undefined" || !name.trim()) return;
  const assignments = loadAssignments(); if (groupId) assignments[name.trim()] = groupId; else delete assignments[name.trim()];
  localStorage.setItem(ASSIGNMENTS_KEY, JSON.stringify(assignments));
}
export function groupForContainer(name: string) { return loadAssignments()[name]; }
