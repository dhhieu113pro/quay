import { useState } from "react";
import { toast } from "sonner";
import { Download, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatBytes, relativeTime } from "@/lib/utils";
import { useWslc } from "@/lib/wslc/store";

export function ImagesView() {
  const images = useWslc((s) => s.images);
  const volumes = useWslc((s) => s.volumes);
  const pulls = useWslc((s) => s.pulls);
  const pullImage = useWslc((s) => s.pullImage);
  const removeImage = useWslc((s) => s.removeImage);
  const createVolume = useWslc((s) => s.createVolume);
  const deleteVolume = useWslc((s) => s.deleteVolume);
  const catalog = useWslc((s) => s.catalog);
  const now = useWslc((s) => s.now);
  const [ref, setRef] = useState("python:3.12");
  const [volName, setVolName] = useState("");

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-4 md:p-6">
      <div>
        <h1 className="text-xl font-medium tracking-tight">Images & volumes</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Pulls run through{" "}
          <span className="font-mono text-foreground/80">Session.PullImageAsync</span>{" "}
          with progress events.
        </p>
      </div>

      <Tabs defaultValue="images">
        <TabsList>
          <TabsTrigger value="images">Images</TabsTrigger>
          <TabsTrigger value="volumes">Volumes</TabsTrigger>
        </TabsList>
        <TabsContent value="images" className="flex flex-col gap-4">
          <form
            className="flex flex-col gap-2 sm:flex-row"
            onSubmit={(e) => {
              e.preventDefault();
              pullImage(ref);
              toast(`Pull ${ref}`);
            }}
          >
            <Input
              list="pull-catalog"
              value={ref}
              onChange={(e) => setRef(e.target.value)}
              placeholder="nginx:latest"
              className="font-mono"
            />
            <datalist id="pull-catalog">
              {catalog.map((c) => (
                <option key={c} value={c} />
              ))}
            </datalist>
            <Button type="submit">
              <Download className="size-4" />
              Pull
            </Button>
          </form>

          {pulls.length > 0 ? (
            <ul className="space-y-2">
              {pulls.map((p) => {
                const pct = Math.round((p.currentBytes / p.totalBytes) * 100);
                return (
                  <li
                    key={p.id}
                    className="rounded-lg border border-border bg-card p-3"
                  >
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="font-mono">{p.reference}</span>
                      <span className="tabular-nums text-muted-foreground">
                        {p.status} · {pct}%
                      </span>
                    </div>
                    <Progress value={pct} className="mt-2" />
                  </li>
                );
              })}
            </ul>
          ) : null}

          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
            {images.map((img) => (
              <li
                key={img.id}
                className="flex items-center gap-3 px-4 py-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">
                    {img.repository}
                    <span className="text-muted-foreground">:{img.tag}</span>
                  </p>
                  <p className="mt-0.5 truncate font-mono text-xs text-subtle">
                    {img.id} · {formatBytes(img.sizeMB)} · {img.containers} ctr ·{" "}
                    {relativeTime(img.createdAt, now)}
                  </p>
                </div>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`Remove ${img.repository}:${img.tag}`}
                  onClick={() => {
                    removeImage(img.id);
                    toast(`Remove ${img.repository}:${img.tag}`);
                  }}
                >
                  <Trash2 className="size-4" />
                </Button>
              </li>
            ))}
          </ul>
        </TabsContent>

        <TabsContent value="volumes" className="flex flex-col gap-4">
          <form
            className="flex flex-col gap-2 sm:flex-row"
            onSubmit={(e) => {
              e.preventDefault();
              createVolume(volName);
              toast(`Volume ${volName}`);
              setVolName("");
            }}
          >
            <Input
              value={volName}
              onChange={(e) => setVolName(e.target.value)}
              placeholder="volume name"
            />
            <Button type="submit">Create</Button>
          </form>
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
            {volumes.map((v) => (
              <li key={v.name} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm">{v.name}</p>
                  <p className="mt-0.5 truncate font-mono text-xs text-subtle">
                    {v.mountpoint} · {formatBytes(v.sizeMB)} ·{" "}
                    {v.inUse ? "in use" : "unused"}
                  </p>
                </div>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`Remove ${v.name}`}
                  disabled={v.inUse}
                  onClick={() => deleteVolume(v.name)}
                >
                  <Trash2 className="size-4" />
                </Button>
              </li>
            ))}
          </ul>
        </TabsContent>
      </Tabs>
    </div>
  );
}
