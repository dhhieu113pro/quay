import type { RunSpec } from "./types";

export interface CatalogPreset {
  image: string; name: string; label: string; hint: string; ports: string;
  env: string; mounts: string; workdir: string; command?: string;
  gpu?: boolean; groupId?: string;
}

export const catalogPresets: CatalogPreset[] = [
  { image: "ghcr.io/dhhieu113pro/local-coding-mcp:latest", name: "local-coding-mcp", label: "local-coding-mcp", hint: "MCP on :5000/mcp — ChatGPT, Grok", ports: "5000:5000", env: ["ASPNETCORE_URLS=http://0.0.0.0:5000", "ASPNETCORE_ENVIRONMENT=Production", "AllowedRoots__0=/workspace", "CommandTimeoutSeconds=60"].join("\n"), mounts: "D:\\wslc\\workspaces:/workspace:rw", workdir: "/workspace", groupId: "local-coding" },
  { image: "ngrok/ngrok:latest", name: "local-coding-mcp-ngrok", label: "ngrok", hint: "Public HTTPS → MCP :5000  (paste NGROK_AUTHTOKEN)", ports: "4040:4040", env: "NGROK_AUTHTOKEN=", mounts: "", workdir: "/", command: "http local-coding-mcp:5000 --log=stdout", groupId: "local-coding" },
  { image: "nginx:latest", name: "web", label: "nginx", hint: "HTTP :80", ports: "8080:80", env: "", mounts: "", workdir: "/" },
  { image: "postgres:16", name: "db", label: "postgres", hint: "5432", ports: "5432:5432", env: "POSTGRES_USER=quay\nPOSTGRES_DB=app\nPOSTGRES_PASSWORD=quay", mounts: "pgdata:/var/lib/postgresql/data:rw", workdir: "/" },
  { image: "redis:7", name: "cache", label: "redis", hint: "6379", ports: "6379:6379", env: "", mounts: "redisdata:/data:rw", workdir: "/data" },
];

export const mcpStack = catalogPresets.slice(0, 2);

export function specFromPreset(p: CatalogPreset): RunSpec {
  return { image: p.image, name: p.name, command: p.command ?? "", ports: p.ports,
    env: p.env, mounts: p.mounts, gpu: Boolean(p.gpu), remove: false, detach: true,
    workdir: p.workdir, groupId: p.groupId };
}
