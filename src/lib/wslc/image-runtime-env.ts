export type RuntimeEnvSource = "Required" | "Image default";

export interface RuntimeEnvVariable {
  key: string;
  value: string;
  source: RuntimeEnvSource;
  required?: boolean;
}

function imageLeaf(image: string) {
  const withoutDigest = image.trim().toLowerCase().split("@")[0] ?? "";
  const leaf = withoutDigest.split("/").pop() ?? "";
  return leaf.split(":")[0] ?? "";
}

export function runtimeEnvForImage(image: string): RuntimeEnvVariable[] {
  switch (imageLeaf(image)) {
    case "postgres":
      return [
        { key: "POSTGRES_USER", value: "quay", source: "Image default" },
        { key: "POSTGRES_DB", value: "app", source: "Image default" },
        { key: "POSTGRES_PASSWORD", value: "", source: "Required", required: true },
      ];
    case "mysql":
      return [{ key: "MYSQL_ROOT_PASSWORD", value: "", source: "Required", required: true }];
    case "mariadb":
      return [{ key: "MARIADB_ROOT_PASSWORD", value: "", source: "Required", required: true }];
    case "ngrok":
      return [{ key: "NGROK_AUTHTOKEN", value: "", source: "Required", required: true }];
    case "local-coding-mcp":
      return [
        { key: "ASPNETCORE_URLS", value: "http://0.0.0.0:5000", source: "Image default" },
        { key: "ASPNETCORE_ENVIRONMENT", value: "Production", source: "Image default" },
        { key: "AllowedRoots__0", value: "/workspace", source: "Image default" },
        { key: "CommandTimeoutSeconds", value: "60", source: "Image default" },
      ];
    default:
      return [];
  }
}

function parseEnv(raw: string) {
  const rows = raw.split("\n").map((line) => line.trimEnd()).filter(Boolean);
  return rows.map((line) => {
    const eq = line.indexOf("=");
    return eq === -1 ? [line, ""] as const : [line.slice(0, eq), line.slice(eq + 1)] as const;
  });
}

function joinEnv(values: Map<string, string>) {
  return Array.from(values, ([key, value]) => `${key}=${value}`).join("\n");
}

export function applyRuntimeEnvDefaults(raw: string, image: string) {
  const values = new Map(parseEnv(raw));
  for (const variable of runtimeEnvForImage(image)) {
    if (!values.has(variable.key)) values.set(variable.key, variable.value);
  }
  return joinEnv(values);
}

export function reconcileRuntimeEnvDefaults(raw: string, previousImage: string, nextImage: string) {
  const values = new Map(parseEnv(raw));
  for (const variable of runtimeEnvForImage(previousImage)) {
    if (values.get(variable.key) === variable.value) values.delete(variable.key);
  }
  return applyRuntimeEnvDefaults(joinEnv(values), nextImage);
}

export function runtimeEnvSourceByKey(image: string) {
  return Object.fromEntries(runtimeEnvForImage(image).map((variable) => [variable.key, variable.source])) as Record<string, RuntimeEnvSource>;
}

export function requiredEnvKeys(image: string) {
  return new Set(runtimeEnvForImage(image).filter((variable) => variable.required).map((variable) => variable.key));
}

export function missingRequiredEnv(raw: string, image: string) {
  const values = new Map(parseEnv(raw));
  return runtimeEnvForImage(image)
    .filter((variable) => variable.required && !(values.get(variable.key) ?? "").trim())
    .map((variable) => variable.key);
}
