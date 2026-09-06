export type RuntimeEnvSource = "Required" | "Image default";

export interface RuntimeEnvVariable {
  key: string;
  value: string;
  source: RuntimeEnvSource;
  required?: boolean;
}

function imageRepository(image: string) {
  let reference = image.trim().toLowerCase();
  const digestAt = reference.indexOf("@");
  if (digestAt >= 0) reference = reference.slice(0, digestAt);

  const lastSlash = reference.lastIndexOf("/");
  const lastColon = reference.lastIndexOf(":");
  if (lastColon > lastSlash) reference = reference.slice(0, lastColon);

  const parts = reference.split("/").filter(Boolean);
  if (parts.length === 0) return "";
  if (parts.length === 1) return `docker.io/library/${parts[0]}`;

  const first = parts[0];
  const hasRegistry = first.includes(".") || first.includes(":") || first === "localhost";
  if (!hasRegistry) return `docker.io/${parts.join("/")}`;

  if (first === "index.docker.io") parts[0] = "docker.io";
  return parts.join("/");
}

export function runtimeEnvForImage(image: string): RuntimeEnvVariable[] {
  switch (imageRepository(image)) {
    case "docker.io/library/postgres":
      return [
        { key: "POSTGRES_USER", value: "quay", source: "Image default" },
        { key: "POSTGRES_DB", value: "app", source: "Image default" },
        { key: "POSTGRES_PASSWORD", value: "", source: "Required", required: true },
      ];
    case "docker.io/library/mysql":
      return [{ key: "MYSQL_ROOT_PASSWORD", value: "", source: "Required", required: true }];
    case "docker.io/library/mariadb":
      return [{ key: "MARIADB_ROOT_PASSWORD", value: "", source: "Required", required: true }];
    case "docker.io/ngrok/ngrok":
      return [{ key: "NGROK_AUTHTOKEN", value: "", source: "Required", required: true }];
    case "ghcr.io/dhhieu113pro/ai-router":
      return [
        { key: "AIROUTER_ADMIN_KEY", value: "", source: "Required", required: true },
        { key: "AIROUTER_API_KEY", value: "", source: "Image default" },
      ];
    case "ghcr.io/dhhieu113pro/local-coding-mcp":
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
