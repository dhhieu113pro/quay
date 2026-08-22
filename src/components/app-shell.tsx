import { useEffect, type ReactNode } from "react";
import {
  Box,
  Boxes,
  Cpu,
  LayoutGrid,
  Layers,
  Minus,
  Square,
  SquareTerminal,
  X,
} from "lucide-react";
import { Toaster } from "sonner";
import { AppearanceProvider, useAppearance } from "@/components/appearance-provider";
import { AppearanceToggle } from "@/components/appearance-toggle";
import { Mark } from "@/components/mark";
import { RunDialog } from "@/components/run-dialog";
import { SetupScreen } from "@/components/setup-screen";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { ContainersView } from "@/components/views/containers-view";
import { DashboardView } from "@/components/views/dashboard-view";
import { CubesView } from "@/components/views/groups-view";
import { ImagesView } from "@/components/views/images-view";
import { SessionView } from "@/components/views/session-view";
import { TerminalView } from "@/components/views/terminal-view";
import { cn } from "@/lib/utils";
import { useWslc } from "@/lib/wslc/store";
import type { ViewId } from "@/lib/wslc/types";
import { windowAction } from "@/lib/tauri";

const QUAY_VERSION = "0.1.3";

const NAV: Array<{ id: ViewId; label: string; icon: typeof Box }> = [
  { id: "dashboard", label: "Overview", icon: LayoutGrid },
  { id: "groups", label: "Cubes", icon: Boxes },
  { id: "containers", label: "Containers", icon: Box },
  { id: "terminal", label: "Terminal", icon: SquareTerminal },
  { id: "images", label: "Images", icon: Layers },
  { id: "session", label: "Session", icon: Cpu },
];

function wslcVersionLabel(version: string) {
  return version.replace(/^wslc\s*/i, "").trim() || "—";
}

export function AppShell() {
  const view = useWslc((s) => s.view);
  const setView = useWslc((s) => s.setView);
  const tick = useWslc((s) => s.tick);
  const session = useWslc((s) => s.session);
  const containers = useWslc((s) => s.containers);
  const gate = useWslc((s) => s.gate);
  const retryProbe = useWslc((s) => s.retryProbe);
  const running = containers.filter((c) => c.status === "running").length;
  const gated = gate === "checking" || gate === "missing";

  useEffect(() => {
    void retryProbe();
  }, [retryProbe]);

  useEffect(() => {
    if (gated) return;
    const id = window.setInterval(() => {
      void tick();
    }, 1000);
    return () => window.clearInterval(id);
  }, [tick, gated]);

  return (
    <AppearanceProvider>
    <TooltipProvider delayDuration={250}>
      <div className="flex h-dvh flex-col overflow-hidden bg-background text-foreground">
        <Titlebar />
        {gated ? (
          <SetupScreen />
        ) : (
          <>
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
                WSLC {wslcVersionLabel(session.version)}
              </p>
            </div>
          </nav>
          <main
            className={cn(
              "min-h-0 min-w-0 flex-1 pb-20 md:pb-0",
              view === "containers" || view === "terminal"
                ? "flex overflow-hidden"
                : "overflow-y-auto",
            )}
          >
            {view === "dashboard" ? <DashboardView /> : null}
            {view === "groups" ? <CubesView /> : null}
            {view === "containers" ? (
              <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col">
                <ContainersView />
              </div>
            ) : null}
            {view === "terminal" ? <TerminalView /> : null}
            {view === "images" ? <ImagesView /> : null}
            {view === "volumes" ? <ImagesView /> : null}
            {view === "session" ? <SessionView /> : null}
          </main>
        </div>
        <StatusBar />
        <MobileNav view={view} onChange={setView} />
        <RunDialog />
          </>
        )}
        <ThemedToaster />
        </div>
      </TooltipProvider>
    </AppearanceProvider>
  );
}

function ThemedToaster() {
  const { scheme } = useAppearance();
  return (
    <Toaster
      theme={scheme}
      position="bottom-right"
      toastOptions={{
        className: "!bg-card !text-foreground !border-border !font-sans text-sm",
      }}
    />
  );
}

function Titlebar() {
  const session = useWslc((s) => s.session);
  const gate = useWslc((s) => s.gate);
  const gated = gate === "checking" || gate === "missing";
  const live = session.running && !gated;
  return (
    <header
      data-tauri-drag-region
      className="flex h-12 shrink-0 items-center border-b border-border bg-card pl-3 pr-1"
    >
      <Mark className="size-6" />
      <div className="ml-2 min-w-0">
        <p className="truncate text-sm font-medium leading-none">Quay</p>
        <p className="mt-0.5 hidden truncate text-xs text-subtle sm:block">
          WSL container manager
        </p>
      </div>
      <div className="ml-auto flex items-center gap-2">
        <span
          className={cn(
            "hidden items-center gap-1.5 rounded-full px-2 py-1 text-xs sm:inline-flex",
            live ? "bg-ok/15 text-ok" : gated ? "bg-warn/15 text-warn" : "bg-elevated text-muted-foreground",
          )}
        >
          <span
            className={cn(
              "size-1.5 rounded-full",
              live ? "bg-ok" : gated ? "bg-warn" : "bg-subtle",
            )}
          />
          {gated ? "wslc missing" : live ? "session up" : "session down"}
        </span>
        <AppearanceToggle compact />
        <div className="hidden md:flex">
          <CaptionBtn label="Minimize" onClick={() => void windowAction("minimize")}>
            <Minus className="size-3.5" />
          </CaptionBtn>
          <CaptionBtn label="Maximize" onClick={() => void windowAction("toggleMaximize")}>
            <Square className="size-3" />
          </CaptionBtn>
          <Tooltip>
            <TooltipTrigger asChild>
              <CaptionBtn label="Hide to tray" danger onClick={() => void windowAction("close")}>
                <X className="size-3.5" />
              </CaptionBtn>
            </TooltipTrigger>
            <TooltipContent>Hide to tray</TooltipContent>
          </Tooltip>
        </div>
      </div>
    </header>
  );
}

function CaptionBtn({
  children,
  label,
  danger,
  onClick,
}: {
  children: ReactNode;
  label: string;
  danger?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
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

  return (
    <footer className="hidden h-8 shrink-0 items-center gap-4 border-t border-border bg-card px-3 font-mono text-xs text-muted-foreground md:flex">
      <span className="text-foreground">Quay v{QUAY_VERSION}</span>
      <span className={session.running ? "text-ok" : "text-warn"}>
        {session.running ? "WSLC" : "DOWN"} {wslcVersionLabel(session.version)}
      </span>
      <span>{running} running</span>
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
