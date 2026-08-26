import { catalogPresets, specFromPreset } from "./catalog";
import type { RunSpec } from "./types";

const GENERIC_DEFAULTS = {
  command: "",
  ports: "",
  env: "",
  mounts: "",
  workdir: "/",
} satisfies Pick<RunSpec, "command" | "ports" | "env" | "mounts" | "workdir">;

const DEFAULTED_FIELDS = ["command", "ports", "env", "mounts", "workdir"] as const;

export function containerNameFromImage(image: string) {
  const leaf = image.trim().split("/").pop() ?? "";
  const withoutDigest = leaf.split("@")[0] ?? "";
  const withoutTag = withoutDigest.split(":")[0] ?? "";
  return withoutTag
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, "-")
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "")
    .slice(0, 63) || "container";
}

function presetSpec(image: string) {
  const preset = catalogPresets.find((item) => item.image === image.trim());
  return preset ? specFromPreset(preset) : null;
}

export function applyImageDefaults(current: RunSpec, image: string, nameTouched = false): RunSpec {
  const previousPreset = presetSpec(current.image);
  const nextPreset = presetSpec(image);
  const previousAutoName = previousPreset?.name ?? containerNameFromImage(current.image);
  const nextAutoName = nextPreset?.name ?? containerNameFromImage(image);
  const initialImage = !current.image.trim();

  const next: RunSpec = { ...current, image };
  if (!nameTouched && (initialImage || !current.name.trim() || current.name === previousAutoName)) {
    next.name = nextAutoName;
  }

  for (const field of DEFAULTED_FIELDS) {
    const previousDefault = previousPreset?.[field] ?? GENERIC_DEFAULTS[field];
    const nextDefault = nextPreset?.[field] ?? GENERIC_DEFAULTS[field];
    if (initialImage || current[field] === previousDefault) next[field] = nextDefault;
  }

  return next;
}
