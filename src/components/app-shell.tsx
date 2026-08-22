import { useEffect, type ReactNode } from "react";
import {
  Box,
  Cpu,
  LayoutGrid,
  Layers,
  Minus,
  Square,
  Terminal,
  X,
} from "lucide-react";
import { Toaster } from "sonner";
import { Mark } from "@/components/mark";
import { RunDialog } from "@/components/run-dialog";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ContainersView } from "@/components/views/containers-view";
import { DashboardView } from "@/components/views/dashboard-view";
import { HostView } from "@/components/views/host-view";
import { ImagesView } from "@/components/views/images-view";
import { SessionView } from "@/components/views/session-view";
import { cn, formatBytes } from "@/lib/utils";
import { useWslc } from "@/lib/wslc/store";
import type { ViewId } from "@/lib/wslc/types";

const NAV: Array<{ id: ViewId; label: string; icon: typeof Box }> = [
  { id: "dashboard", label: "Overview", icon: LayoutGrid },
  { id: "containers", label: "Containers", icon: Box },
  { id: "images", label: "Images", icon: Layers },
  { id: "session", label: "Session", icon: Cpu },
  { id: "host", label: "C# host", icon: Terminal },
];

export function AppShell() {
  const view = useWslc((s) => s.view);
  const setView = useWslc((s) => s.setView);
  const tick = useWslc((s) => s.tick);
  const session = useWslc((s) => s.session);
  const containers = useWslc((s) => s.containers);
  const running = containers.filter((c) => c.status === "running").length;

  useEffect(() => {
    const id = window.setInterval(tick, 2000);
    return () => window.clearInterval(id);
  }, [tick]);

  return (
    <TooltipProvider delayDuration={250}>
      <div className="flex h-dvh flex-col overflow-hidden bg-background text-foreground">
        <Titlebar />
        <div className="flex min-h-0 flex-1">
          <nav className="hidden w-52 shrink-0 flex-col border-r border-border bg-card md:flex">
            <p className="px-4 pb-2 pt-4 text-xs uppercase tracking-widest text-subtle">
              Workspace
            </p>
            {NAV.map((item) => (
              <NavBtn
                key={item.id}
                {...item}
                active={view === item.id}
                onClick={() => setView(item.id)}
              />
            ))}
            <div className="mt-auto border-t border-border px-4 py-3">
              <p className="text-xs text-muted-foreground">
                {running} running
              </p>
              <p className="mt-0.5 font-mono text-xs text-subtle">
                {session.filesystem} · {session.networking}
              </p>
            </div>
          </nav>
          <main
            className={cn(
              "min-h-0 min-w-0 flex-1 pb-20 md:pb-0",
              view === "containers" ? "flex overflow-hidden" : "overflow-y-auto",
            )}
          >
            {view === "dashboard" ? <DashboardView /> : null}
            {view === "containers" ? (
              <div className="flex h-full min-h-0 flex-col">
                <ContainersView />
              </div>
            ) : null}
            {view === "images" ? <ImagesView /> : null}
            {view === "volumes" ? <ImagesView /> : null}
            {view === "session" ? <SessionView /> : null}
            {view === "host" ? <HostView /> : null}
          </main>
        </div>
        <StatusBar />
        <MobileNav view={view} onChange={setView} />
        <RunDialog />
        <Toaster
          theme="dark"
          position="bottom-right"
          toastOptions={{
            className:
              "!bg-card !text-foreground !border-border !font-sans text-sm",
          }}
        />
      </div>
    </TooltipProvider>
  );
}

function Titlebar() {
  const session = useWslc((s) => s.session);
  return (
    <header className="flex h-12 shrink-0 items-center border-b border-border bg-card pl-3 pr-1">
      <Mark className="size-6" />
      <div className="ml-2 min-w-0">
        <p className="truncate text-sm font-medium leading-none">Quay</p>
        <p className="mt-0.5 hidden truncate text-xs text-subtle sm:block">
          WSL container manager · C# host
        </p>
      </div>
      <div className="ml-auto flex items-center gap-2">
        <span
          className={cn(
            "hidden items-center gap-1.5 rounded-full px-2 py-1 text-xs sm:inline-flex",
            session.running ? "bg-ok/15 text-ok" : "bg-elevated text-muted-foreground",
          )}
        >
          <span
            className={cn(
              "size-1.5 rounded-full",
              session.running ? "bg-ok" : "bg-subtle",
            )}
          />
          {session.running ? "session up" : "session down"}
        </span>
        <div className="hidden md:flex">
          <CaptionBtn label="Minimize">
            <Minus className="size-3.5" />
          </CaptionBtn>
          <CaptionBtn label="Maximize">
            <Square className="size-3" />
          </CaptionBtn>
          <CaptionBtn label="Close" danger>
            <X className="size-3.5" />
          </CaptionBtn>
        </div>
      </div>
    </header>
  );
}

function CaptionBtn({
  children,
  label,
  danger,
}: {
  children: ReactNode;
  label: string;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      className={cn(
        "grid h-12 w-11 place-items-center text-muted-foreground hover:bg-elevated hover:text-foreground",
        danger && "hover:bg-destructive hover:text-destructive-foreground",
      )}
    >
      {children}
    </button>
  );
}

function NavBtn({
  id,
  label,
  icon: Icon,
  active,
  onClick,
}: {
  id: ViewId;
  label: string;
  icon: typeof Box;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={cn(
        "mx-2 flex h-10 items-center gap-2.5 rounded-md px-2.5 text-sm",
        active
          ? "bg-elevated text-foreground"
          : "text-muted-foreground hover:bg-elevated/70 hover:text-foreground",
      )}
    >
      <Icon className="size-4" />
      {label}
      <span className="sr-only">{id}</span>
    </button>
  );
}

function StatusBar() {
  const session = useWslc((s) => s.session);
  const containers = useWslc((s) => s.containers);
  const last = useWslc((s) => s.calls[0]);
  const running = containers.filter((c) => c.status === "running").length;
  const mem = containers
    .filter((c) => c.status === "running")
    .reduce((a, c) => a + c.memoryMB, 0);

  return (
    <footer className="hidden h-8 shrink-0 items-center gap-4 border-t border-border bg-card px-3 font-mono text-xs text-muted-foreground md:flex">
      <span className={session.running ? "text-ok" : "text-warn"}>
        {session.running ? "WSLC" : "DOWN"} {session.wslVersion}
      </span>
      <span>
        {running} ctr · {formatBytes(mem)}
      </span>
      <span className="truncate">
        {session.cpuCount} vCPU · {session.filesystem} · {session.networking}
        {session.gpu ? " · GPU" : ""}
      </span>
      <span className="ml-auto truncate text-subtle">
        {last ? last.method : "idle"}
      </span>
    </footer>
  );
}

function MobileNav({
  view,
  onChange,
}: {
  view: ViewId;
  onChange: (v: ViewId) => void;
}) {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-30 flex border-t border-border bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
      {NAV.map((item) => {
        const Icon = item.icon;
        const active = view === item.id;
        return (
          <Tooltip key={item.id}>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => onChange(item.id)}
                className={cn(
                  "flex h-14 min-h-11 flex-1 flex-col items-center justify-center gap-1 text-xs",
                  active ? "text-foreground" : "text-muted-foreground",
                )}
              >
                <Icon className="size-4" />
                {item.label}
              </button>
            </TooltipTrigger>
            <TooltipContent>{item.label}</TooltipContent>
          </Tooltip>
        );
      })}
    </nav>
  );
}
