import { useState } from "react";
import { toast } from "sonner";
import { Download, LoaderCircle, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatBytes, relativeTime } from "@/lib/utils";
import { useWslc } from "@/lib/wslc/store";

export function ImagesView() {
  const images = useWslc((s) => s.images);
  const volumes = useWslc((s) => s.volumes);
  const operations = useWslc((s) => s.operations);
  const pulls = useWslc((s) => s.pulls);
  const startPull = useWslc((s) => s.startPull);
  const removeImage = useWslc((s) => s.removeImage);
  const createVolume = useWslc((s) => s.createVolume);
  const deleteVolume = useWslc((s) => s.deleteVolume);
  const catalog = useWslc((s) => s.catalog);
  const now = useWslc((s) => s.now);
  const [ref, setRef] = useState("ghcr.io/dhhieu113pro/local-coding-mcp:latest");
  const [volName, setVolName] = useState("");
  const reference = ref.trim();
  const activePull = pulls.find((item) => item.reference === reference && ["queued", "pulling", "cancelling"].includes(item.status));
  const volumeStatus = volName.trim() ? operations[`volume:${volName.trim()}`] : undefined;
  const creatingVolume = volumeStatus === "creating";

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 p-4 md:p-6">
      <div>
        <h1 className="text-xl font-medium tracking-tight">Images & volumes</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Image and volume operations run directly through the installed <span className="font-mono text-foreground/80">wslc.exe</span> CLI.
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
            onSubmit={(event) => {
              event.preventDefault();
              const value = ref.trim();
              if (!value || activePull) return;
              void startPull(value);
              toast(`Pulling ${value}`);
            }}
          >
            <Input
              list="pull-catalog"
              value={ref}
              onChange={(event) => setRef(event.target.value)}
              placeholder="nginx:latest"
              className="font-mono"
              disabled={Boolean(activePull)}
            />
            <datalist id="pull-catalog">
              {catalog.map((item) => <option key={item} value={item} />)}
            </datalist>
            <Button type="submit" disabled={Boolean(activePull) || !ref.trim()}>
              {activePull ? <LoaderCircle className="size-4 animate-spin" /> : <Download className="size-4" />}
              {activePull?.status === "queued" ? "Queued…" : activePull?.status === "cancelling" ? "Cancelling…" : activePull ? "Pulling…" : "Pull"}
            </Button>
          </form>

          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
            {images.length ? images.map((img) => {
              const imageReference = `${img.repository}:${img.tag}`;
              const status = operations[`image:${imageReference}`];
              const busy = Boolean(status);
              return (
                <li key={img.id} className="flex items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">
                      {img.repository}<span className="text-muted-foreground">:{img.tag}</span>
                    </p>
                    <p className="mt-0.5 truncate font-mono text-xs text-subtle">
                      {img.id} · {formatBytes(img.sizeBytes)} · {relativeTime(img.createdAt, now)}
                    </p>
                  </div>
                  {status === "removing" ? <span className="text-xs text-muted-foreground">Removing…</span> : null}
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    disabled={busy}
                    aria-label={`Remove ${imageReference}`}
                    onClick={() => {
                      removeImage(img.id);
                      toast(`Removing ${imageReference}`);
                    }}
                  >
                    {busy ? <LoaderCircle className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
                  </Button>
                </li>
              );
            }) : (
              <li className="px-4 py-10 text-center text-sm text-muted-foreground">No pulled images yet.</li>
            )}
          </ul>
        </TabsContent>

        <TabsContent value="volumes" className="flex flex-col gap-4">
          <form
            className="flex flex-col gap-2 sm:flex-row"
            onSubmit={(event) => {
              event.preventDefault();
              const value = volName.trim();
              if (!value || volumeStatus) return;
              createVolume(value);
              toast(`Creating volume ${value}`);
              setVolName("");
            }}
          >
            <Input
              value={volName}
              onChange={(event) => setVolName(event.target.value)}
              placeholder="volume name"
              disabled={Boolean(volumeStatus)}
            />
            <Button type="submit" disabled={!volName.trim() || Boolean(volumeStatus)}>
              {creatingVolume ? <LoaderCircle className="size-4 animate-spin" /> : null}
              {creatingVolume ? "Creating…" : "Create"}
            </Button>
          </form>
          <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
            {volumes.length ? volumes.map((volume) => {
              const status = operations[`volume:${volume.name}`];
              const busy = Boolean(status);
              return (
                <li key={volume.name} className="flex items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm">{volume.name}</p>
                    <p className="mt-0.5 truncate font-mono text-xs text-subtle">
                      {volume.mountpoint || "WSLC volume"} · {formatBytes(volume.sizeBytes)}
                    </p>
                  </div>
                  {status === "removing" ? <span className="text-xs text-muted-foreground">Removing…</span> : null}
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Remove ${volume.name}`}
                    disabled={volume.inUse || busy}
                    onClick={() => {
                      deleteVolume(volume.name);
                      toast(`Removing volume ${volume.name}`);
                    }}
                  >
                    {busy ? <LoaderCircle className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
                  </Button>
                </li>
              );
            }) : (
              <li className="px-4 py-10 text-center text-sm text-muted-foreground">No volumes yet.</li>
            )}
          </ul>
        </TabsContent>
      </Tabs>
    </div>
  );
}
