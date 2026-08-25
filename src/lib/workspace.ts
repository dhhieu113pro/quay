const DRIVE_ABSOLUTE = /^[a-zA-Z]:[\\/]/;
const UNC_ABSOLUTE = /^(?:\\\\|\/\/)/;

export const DEFAULT_WORKSPACE_TARGET = "/workspace";

function slug(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "workspace";
}

export function normalizeWorkspacePath(path: string): string {
  const raw = path.trim();
  if (!raw) throw new Error("Workspace path is empty");
  if (DRIVE_ABSOLUTE.test(raw) || UNC_ABSOLUTE.test(raw) || raw.startsWith("/") || raw.startsWith("\\")) {
    throw new Error("Workspace path must be relative to the Quay workspace root");
  }
  const parts = raw.replace(/\\/g, "/").split("/").filter(Boolean);
  if (!parts.length || parts.some((part) => part === "." || part === "..")) {
    throw new Error("Workspace path cannot contain traversal segments");
  }
  return parts.join("/");
}

export function defaultCubeWorkspacePath(name: string): string {
  return `cubes/${slug(name)}`;
}

export function defaultStandaloneWorkspacePath(name: string): string {
  return `containers/${slug(name)}`;
}

export function defaultCubeContainerWorkspacePath(cubePath: string, containerName: string): string {
  return `${normalizeWorkspacePath(cubePath)}/${slug(containerName)}`;
}

export function resolveWorkspacePath(root: string, relativePath: string): string {
  const base = root.trim().replace(/[\\/]+$/, "");
  if (!DRIVE_ABSOLUTE.test(`${base}\\`) && !UNC_ABSOLUTE.test(base)) {
    throw new Error("Quay workspace root must be an absolute Windows path");
  }
  return `${base}\\${normalizeWorkspacePath(relativePath).replace(/\//g, "\\")}`;
}

export function relativeWorkspacePath(root: string, absolutePath: string): string {
  const base = root.trim().replace(/[\\/]+$/, "");
  const candidate = absolutePath.trim().replace(/[\\/]+$/, "");
  const baseLower = base.toLowerCase();
  const candidateLower = candidate.toLowerCase();
  if (candidateLower === baseLower) throw new Error("Choose a folder inside the Quay workspace root");
  const normalizedCandidate = candidateLower.replace(/\//g, "\\");
  const normalizedBase = baseLower.replace(/\//g, "\\");
  if (!normalizedCandidate.startsWith(`${normalizedBase}\\`)) {
    throw new Error("Selected folder must be inside the Quay workspace root");
  }
  return normalizeWorkspacePath(candidate.slice(base.length + 1));
}

export function isGeneratedCubeWorkspacePath(path: string | undefined, name: string): boolean {
  return !path || normalizeWorkspacePath(path) === defaultCubeWorkspacePath(name);
}

export function isGeneratedContainerWorkspacePath(
  path: string | undefined,
  parentPath: string | undefined,
  name: string,
): boolean {
  if (!path) return true;
  const expected = parentPath
    ? defaultCubeContainerWorkspacePath(parentPath, name)
    : defaultStandaloneWorkspacePath(name);
  return normalizeWorkspacePath(path) === expected;
}
