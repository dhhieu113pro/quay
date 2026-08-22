import { useEffect, useState } from "react";
import { Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ContainerGroup } from "@/lib/wslc/types";

const KEY = "quay.stack-configs";

export type StackConfig = {
  workspacePath: string;
  githubToken: string;
  ngrokToken: string;
  ngrokDomain: string;
};

function loadAll(): Record<string, Partial<StackConfig>> {
  if (typeof localStorage === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(KEY) || "{}") as Record<string, Partial<StackConfig>>;
  } catch {
    return {};
  }
}

export function loadStackConfig(groupId: string): StackConfig {
  const saved = loadAll()[groupId] ?? {};
  return {
    workspacePath: saved.workspacePath ?? "D:\\wslc\\workspaces",
    githubToken: saved.githubToken ?? "",
    ngrokToken: saved.ngrokToken ?? "",
    ngrokDomain: saved.ngrokDomain ?? "",
  };
}

export function applyStackConfig(group: ContainerGroup) {
  const cfg = loadStackConfig(group.id);
  group.specs = group.specs.map((spec) => {
    const env = new Map<string, string>();
    for (const line of spec.env.split("\n")) {
      const value = line.trim();
      if (!value) continue;
      const i = value.indexOf("=");
      env.set(i < 0 ? value : value.slice(0, i), i < 0 ? "" : value.slice(i + 1));
    }

    let mounts = spec.mounts
      .split("\n")
      .map((x) => x.trim())
      .filter(Boolean);

    if (spec.name === "local-coding-mcp") {
      if (cfg.githubToken) env.set("GITHUB_TOKEN", cfg.githubToken);
      else env.delete("GITHUB_TOKEN");
      if (cfg.workspacePath) {
        mounts = mounts.filter((m) => !m.includes(":/workspace"));
        mounts.push(`${cfg.workspacePath}:/workspace:rw`);
        env.set("AllowedRoots__0", "/workspace");
      }
    }

    if (spec.name === "ngrok" || spec.name === "local-coding-mcp-ngrok") {
      if (cfg.ngrokToken) env.set("NGROK_AUTHTOKEN", cfg.ngrokToken);
      else env.delete("NGROK_AUTHTOKEN");
      if (cfg.ngrokDomain) env.set("NGROK_DOMAIN", cfg.ngrokDomain);
      else env.delete("NGROK_DOMAIN");

      return {
        ...spec,
        // wslc run preserves the ngrok image ENTRYPOINT; these are its arguments.
        command: cfg.ngrokDomain
          ? `http local-coding-mcp:5000 --url https://${cfg.ngrokDomain} --log=stdout`
          : "http local-coding-mcp:5000 --log=stdout",
        env: Array.from(env, ([k, v]) => `${k}=${v}`).join("\n"),
        mounts: mounts.join("\n"),
      };
    }

    return {
      ...spec,
      // Let the local-coding image use its own Docker ENTRYPOINT and WORKDIR.
      command: spec.name === "local-coding-mcp" ? "" : spec.command,
      workdir: spec.name === "local-coding-mcp" ? "" : spec.workdir,
      env: Array.from(env, ([k, v]) => `${k}=${v}`).join("\n"),
      mounts: mounts.join("\n"),
    };
  });
}

export function StackConfigDialog({ group }: { group: ContainerGroup }) {
  const [open, setOpen] = useState(false);
  const [config, setConfig] = useState<StackConfig>(() => loadStackConfig(group.id));

  useEffect(() => {
    if (open) setConfig(loadStackConfig(group.id));
  }, [open, group.id]);

  const save = () => {
    const all = loadAll();
    all[group.id] = config;
    localStorage.setItem(KEY, JSON.stringify(all));
    applyStackConfig(group);
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="secondary">
          <Settings2 className="mr-1.5 size-3.5" />
          Configure
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Configure Cube · {group.name}</DialogTitle>
          <DialogDescription>
            Cube settings are applied to its containers the next time the Cube starts.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-5">
          <div className="grid gap-2">
            <Label htmlFor="workspace-path">Workspace host path</Label>
            <Input
              id="workspace-path"
              value={config.workspacePath}
              onChange={(e) => setConfig((c) => ({ ...c, workspacePath: e.target.value }))}
              placeholder="D:\\wslc\\workspaces"
            />
            <p className="text-xs text-muted-foreground">
              Mounted into local-coding-mcp at /workspace (read/write).
            </p>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="github-token">GitHub token</Label>
            <Input
              id="github-token"
              type="password"
              value={config.githubToken}
              onChange={(e) => setConfig((c) => ({ ...c, githubToken: e.target.value }))}
              placeholder="ghp_..."
              autoComplete="off"
            />
            <p className="text-xs text-muted-foreground">
              Passed to local-coding-mcp as GITHUB_TOKEN.
            </p>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="ngrok-token">ngrok auth token</Label>
            <Input
              id="ngrok-token"
              type="password"
              value={config.ngrokToken}
              onChange={(e) => setConfig((c) => ({ ...c, ngrokToken: e.target.value }))}
              placeholder="ngrok token"
              autoComplete="off"
            />
            <p className="text-xs text-muted-foreground">
              Passed only to ngrok as NGROK_AUTHTOKEN.
            </p>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="ngrok-domain">ngrok domain</Label>
            <Input
              id="ngrok-domain"
              value={config.ngrokDomain}
              onChange={(e) =>
                setConfig((c) => ({
                  ...c,
                  ngrokDomain: e.target.value
                    .trim()
                    .replace(/^https?:\/\//, "")
                    .replace(/\/$/, ""),
                }))
              }
              placeholder="random-tweed-runt.ngrok-free.dev"
              autoComplete="off"
            />
            <p className="text-xs text-muted-foreground">
              Passed to ngrok as NGROK_DOMAIN and used as the public endpoint URL.
            </p>
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={save}>Save</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
