import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip as RTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Box, Boxes, Cpu, Layers, MemoryStick } from "lucide-react";
import { RunCubeDialog } from "@/components/run-cube-dialog";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/status-pill";
import { invokeWslcHost } from "@/lib/tauri";
import { formatBytes, formatUptime } from "@/lib/utils";
import { useWslc } from "@/lib/wslc/store";

type HostStats = {
  cpuCount: number;
  cpuPercent: number;
  memoryPercent: number;
  memoryTotalMB: number;
  memoryUsedMB: number;
};

type HostPoint = { t: number; cpu: number; mem: number };

const EMPTY_HOST: HostStats = {
  cpuCount: 0,
  cpuPercent: 0,
  memoryPercent: 0,
  memoryTotalMB: 0,
  memoryUsedMB: 0,
};

export function DashboardView() {
  const session = useWslc((s) => s.session);
  const containers = useWslc((s) => s.containers);
  const images = useWslc((s) => s.images);
  const calls = useWslc((s) => s.calls);
  const now = useWslc((s) => s.now);
  const setView = useWslc((s) => s.setView);
  const selectContainer = useWslc((s) => s.selectContainer);
  const setRunOpen = useWslc((s) => s.setRunOpen);
  const cubes = useWslc((s) => s.groups);
  const [cubeRunOpen, setCubeRunOpen] = useState(false);
  const [host, setHost] = useState<HostStats>(EMPTY_HOST);
  const [hostHistory, setHostHistory] = useState<HostPoint[]>([]);

  useEffect(() => {
    let disposed = false;

    const sample = async () => {
      try {
        const stats = await invokeWslcHost({ cmd: "host_stats" });
        if (disposed || !stats.ok) return;
        const next: HostStats = {
          cpuCount: Number(stats.cpuCount) || 0,
          cpuPercent: Number(stats.cpuPercent) || 0,
          memoryPercent: Number(stats.memoryPercent) || 0,
          memoryTotalMB: Number(stats.memoryTotalMB) || 0,
          memoryUsedMB: Number(stats.memoryUsedMB) || 0,
        };
        setHost(next);
        setHostHistory((current) => [
          ...current,
          { t: Date.now(), cpu: next.cpuPercent, mem: next.memoryPercent },
        ].slice(-60));
      } catch {
        // Keep the last good sample. Container operations must continue to work
        // even if Windows host statistics are temporarily unavailable.
      }
    };

    void sample();
    const id = window.setInterval(() => void sample(), 1000);
    return () => {
      disposed = true;
      window.clearInterval(id);
    };
  }, []);

  const running = containers.filter((c) => c.status === "running");

  const runningCubes = useMemo(
    () =>
      cubes
        .map((cube) => {
          const names = new Set(cube.specs.map((spec) => spec.name));
          const members = containers.filter(
            (container) => container.groupId === cube.id || names.has(container.name),
          );
          const runningMembers = members.filter((container) => container.status === "running");
          return {
            cube,
            members: runningMembers,
            total: Math.max(cube.specs.length, members.length),
          };
        })
        .filter((item) => item.members.length > 0),
    [containers, cubes],
  );

  const cubeContainerIds = useMemo(
    () => new Set(runningCubes.flatMap((item) => item.members.map((container) => container.id))),
    [runningCubes],
  );
  const standaloneRunning = running.filter((container) => !cubeContainerIds.has(container.id));

  const chart = useMemo(
    () =>
      hostHistory.map((m) => ({
        t: m.t,
        cpu: Math.round(m.cpu),
        mem: Math.round(m.mem),
      })),
    [hostHistory],
  );

  return (
    <>
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 p-4 md:p-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-widest text-subtle">Session</p>
            <h1 className="mt-1 text-2xl font-medium tracking-tight">{session.name}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Tauri WebView running the installed{" "}
              <span className="font-mono text-foreground/80">wslc.exe</span> CLI
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setCubeRunOpen(true)}>
              <Boxes className="size-4" />
              Run Cube
            </Button>
            <Button onClick={() => setRunOpen(true)}>
              <Box className="size-4" />
              Run Container
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat
            icon={<Box className="size-4" />}
            label="Running"
            value={`${running.length}`}
            hint={`${containers.length} total`}
          />
          <Stat
            icon={<Layers className="size-4" />}
            label="Images"
            value={`${images.length}`}
            hint={formatBytes(images.reduce((a, i) => a + i.sizeMB, 0))}
          />
          <Stat
            icon={<Cpu className="size-4" />}
            label="Logical CPU"
            value={host.cpuCount ? `${host.cpuCount}` : "—"}
            hint={host.cpuCount ? `${Math.round(host.cpuPercent)}% host load` : "reading Windows host"}
          />
          <Stat
            icon={<MemoryStick className="size-4" />}
            label="Memory"
            value={host.memoryTotalMB ? formatBytes(host.memoryUsedMB) : "—"}
            hint={host.memoryTotalMB
              ? `of ${formatBytes(host.memoryTotalMB)} · ${Math.round(host.memoryPercent)}%`
              : "reading Windows host"}
          />
        </div>

        <section className="rounded-xl border border-border bg-card">
          <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
            <div>
              <h2 className="text-sm font-medium">Running Cubes</h2>
              <p className="mt-0.5 text-xs text-subtle">
                Active containers grouped by Cube.
              </p>
            </div>
            <button
              type="button"
              className="text-xs text-accent hover:underline"
              onClick={() => setView("groups")}
            >
              All Cubes
            </button>
          </div>

          {runningCubes.length ? (
            <div className="divide-y divide-border">
              {runningCubes.map(({ cube, members, total }) => (
                <div key={cube.id}>
                  <button
                    type="button"
                    onClick={() => setView("groups")}
                    className="flex w-full flex-wrap items-center gap-3 bg-elevated/40 px-4 py-2.5 text-left hover:bg-elevated/70"
                  >
                    <Boxes className="size-4 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{cube.name}</p>
                      <p className="font-mono text-xs text-subtle">
                        {cube.network} · {members.length}/{total} running
                      </p>
                    </div>
                  </button>
                  <ul className="divide-y divide-border/70">
                    {members.map((container) => (
                      <li key={container.id} className="flex items-center gap-3 px-4 py-2.5 pl-10">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm">{container.name}</p>
                          <p className="truncate font-mono text-xs text-muted-foreground">
                            {container.image}
                          </p>
                        </div>
                        <p className="hidden font-mono text-xs tabular-nums text-subtle sm:block">
                          {formatUptime(container.startedAt, now)}
                        </p>
                        <StatusPill status={container.status} />
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-6">
              <p className="text-sm text-muted-foreground">No Cubes are running.</p>
              <Button size="sm" variant="secondary" onClick={() => setCubeRunOpen(true)}>
                Run Cube
              </Button>
            </div>
          )}
        </section>

        <section className="rounded-xl border border-border bg-card p-4">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h2 className="text-sm font-medium">Windows host load</h2>
              <p className="mt-0.5 text-xs text-subtle">Live host CPU and physical memory, sampled every second.</p>
            </div>
            <p className="font-mono text-xs tabular-nums text-muted-foreground">
              CPU {Math.round(host.cpuPercent)}% · MEM {Math.round(host.memoryPercent)}%
            </p>
          </div>
          <div className="h-36">
            <HostChart data={chart} />
          </div>
        </section>

        <div className="grid gap-4 lg:grid-cols-2">
          <section className="rounded-xl border border-border bg-card">
            <div className="flex items-center justify-between px-4 py-3">
              <h2 className="text-sm font-medium">Standalone containers</h2>
              <button
                type="button"
                className="text-xs text-accent hover:underline"
                onClick={() => setView("containers")}
              >
                All Containers
              </button>
            </div>
            {standaloneRunning.length ? (
              <ul className="divide-y divide-border">
                {standaloneRunning.slice(0, 5).map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setView("containers");
                        selectContainer(c.id);
                      }}
                      className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-elevated"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm">{c.name}</p>
                        <p className="truncate font-mono text-xs text-muted-foreground">
                          {c.image}
                        </p>
                      </div>
                      <p className="hidden font-mono text-xs tabular-nums text-subtle sm:block">
                        {formatUptime(c.startedAt, now)}
                      </p>
                      <StatusPill status={c.status} />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="px-4 pb-4 text-sm text-muted-foreground">
                No standalone containers are running.
              </p>
            )}
          </section>

          <section className="rounded-xl border border-border bg-card">
            <div className="flex items-center justify-between px-4 py-3">
              <h2 className="text-sm font-medium">CLI activity</h2>
              <button
                type="button"
                className="text-xs text-accent hover:underline"
                onClick={() => setView("session")}
              >
                Session
              </button>
            </div>
            <ul className="divide-y divide-border">
              {calls.slice(0, 5).map((c) => (
                <li key={c.id} className="px-4 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-mono text-xs text-accent">{c.method}</p>
                    <span className={c.ok ? "text-ok text-xs" : "text-destructive text-xs"}>
                      {c.ok ? "ok" : "err"}
                    </span>
                  </div>
                  <p className="mt-1 truncate text-xs text-muted-foreground">{c.result}</p>
                </li>
              ))}
            </ul>
          </section>
        </div>
      </div>

      <RunCubeDialog open={cubeRunOpen} onOpenChange={setCubeRunOpen} />
    </>
  );
}

function HostChart({
  data,
}: {
  data: Array<{ t: number; cpu: number; mem: number }>;
}) {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  if (!ready) {
    return <div className="h-full rounded-lg bg-elevated" />;
  }
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="cpuFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-accent)" stopOpacity={0.28} />
            <stop offset="100%" stopColor="var(--color-accent)" stopOpacity={0} />
          </linearGradient>
        </defs>
        <XAxis dataKey="t" hide />
        <YAxis domain={[0, 100]} hide />
        <RTooltip
          contentStyle={{
            background: "var(--color-popover)",
            border: "1px solid var(--color-border)",
            borderRadius: 8,
            fontSize: 12,
            color: "var(--color-foreground)",
          }}
          labelFormatter={() => ""}
        />
        <Area
          type="monotone"
          dataKey="cpu"
          stroke="var(--color-accent)"
          fill="url(#cpuFill)"
          strokeWidth={1.5}
          isAnimationActive={false}
        />
        <Area
          type="monotone"
          dataKey="mem"
          stroke="var(--color-foreground)"
          fill="transparent"
          strokeWidth={1}
          strokeOpacity={0.45}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

function Stat({
  icon,
  label,
  value,
  hint,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-center gap-2 text-muted-foreground">
        {icon}
        <span className="text-xs uppercase tracking-widest">{label}</span>
      </div>
      <p className="mt-2 text-2xl font-medium tabular-nums tracking-tight">{value}</p>
      <p className="mt-1 text-xs text-subtle">{hint}</p>
    </div>
  );
}
