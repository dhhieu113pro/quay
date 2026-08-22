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
import { Box, Cpu, Layers, MemoryStick } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/status-pill";
import { formatBytes, formatUptime } from "@/lib/utils";
import { useWslc } from "@/lib/wslc/store";

export function DashboardView() {
  const session = useWslc((s) => s.session);
  const containers = useWslc((s) => s.containers);
  const images = useWslc((s) => s.images);
  const metrics = useWslc((s) => s.metrics);
  const calls = useWslc((s) => s.calls);
  const now = useWslc((s) => s.now);
  const setView = useWslc((s) => s.setView);
  const selectContainer = useWslc((s) => s.selectContainer);
  const setRunOpen = useWslc((s) => s.setRunOpen);

  const running = containers.filter((c) => c.status === "running");
  const memUsed = running.reduce((a, c) => a + c.memoryMB, 0);

  const chart = useMemo(
    () =>
      metrics.map((m) => ({
        t: m.t,
        cpu: Math.round(m.cpu),
        mem: Math.round(m.mem),
      })),
    [metrics],
  );

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-5 p-4 md:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-widest text-subtle">Session</p>
          <h1 className="mt-1 text-2xl font-medium tracking-tight">{session.name}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Tauri WebView talking to a C# sidecar on{" "}
            <span className="font-mono text-foreground/80">Microsoft.WSL.Containers</span>
          </p>
        </div>
        <Button onClick={() => setRunOpen(true)}>Run container</Button>
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
          label="vCPU"
          value={`${session.cpuCount}`}
          hint={session.running ? "session up" : "stopped"}
        />
        <Stat
          icon={<MemoryStick className="size-4" />}
          label="Memory"
          value={formatBytes(memUsed)}
          hint={`of ${formatBytes(session.memoryMB)}`}
        />
      </div>

      <section className="rounded-xl border border-border bg-card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-medium">Host load</h2>
          <p className="font-mono text-xs tabular-nums text-muted-foreground">
            CPU {chart.at(-1)?.cpu ?? 0}% · MEM {chart.at(-1)?.mem ?? 0}%
          </p>
        </div>
        <div className="h-36">
          <HostChart data={chart} />
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-border bg-card">
          <div className="flex items-center justify-between px-4 py-3">
            <h2 className="text-sm font-medium">Containers</h2>
            <button
              type="button"
              className="text-xs text-accent hover:underline"
              onClick={() => setView("containers")}
            >
              All
            </button>
          </div>
          <ul className="divide-y divide-border">
            {containers.slice(0, 5).map((c) => (
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
                    {c.status === "running" ? formatUptime(c.startedAt, now) : "—"}
                  </p>
                  <StatusPill status={c.status} />
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-xl border border-border bg-card">
          <div className="flex items-center justify-between px-4 py-3">
            <h2 className="text-sm font-medium">C# host</h2>
            <button
              type="button"
              className="text-xs text-accent hover:underline"
              onClick={() => setView("host")}
            >
              Sidecar
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
