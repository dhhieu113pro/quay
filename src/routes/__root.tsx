import { useEffect, useState } from "react";
import { createRootRoute, HeadContent, Outlet, Scripts } from "@tanstack/react-router";
import { APPEARANCE_BOOT } from "@/lib/appearance";
import appCss from "../styles.css?url";

const APP_NAME = "Quay";

function StartupSkeleton() {
  return (
    <div
      data-startup-skeleton
      aria-label="Loading Quay"
      aria-live="polite"
      className="fixed inset-0 z-[100] flex min-h-dvh bg-background text-foreground"
    >
      <div className="hidden w-56 shrink-0 border-r border-border bg-card/80 p-4 md:block">
        <div className="mb-7 flex items-center gap-3">
          <div className="size-9 rounded-lg bg-elevated" />
          <div className="h-4 w-20 rounded bg-elevated" />
        </div>
        <div className="space-y-2">
          {["w-28", "w-24", "w-32", "w-20", "w-28"].map((width, index) => (
            <div key={index} className={`h-9 ${width} rounded-md bg-elevated/80`} />
          ))}
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-14 shrink-0 items-center justify-between border-b border-border px-5">
          <div className="h-4 w-28 rounded bg-elevated" />
          <div className="h-6 w-24 rounded-full bg-elevated" />
        </div>
        <div className="min-h-0 flex-1 p-5 sm:p-6">
          <div className="mx-auto w-full max-w-6xl animate-pulse motion-reduce:animate-none">
            <div className="mb-6 flex items-start justify-between gap-4">
              <div className="space-y-2">
                <div className="h-6 w-36 rounded bg-elevated" />
                <div className="h-3 w-72 max-w-[65vw] rounded bg-elevated/80" />
              </div>
              <div className="h-9 w-28 rounded-lg bg-elevated" />
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              {[0, 1, 2].map((item) => (
                <div key={item} className="overflow-hidden rounded-xl border border-border bg-card">
                  <div className="space-y-3 p-4">
                    <div className="flex items-center gap-3">
                      <div className="size-10 rounded-lg bg-elevated" />
                      <div className="min-w-0 flex-1 space-y-2">
                        <div className="h-4 w-32 rounded bg-elevated" />
                        <div className="h-3 w-48 max-w-full rounded bg-elevated/75" />
                      </div>
                    </div>
                    <div className="h-3 w-40 rounded bg-elevated/60" />
                  </div>
                  <div className="space-y-px border-y border-border bg-border">
                    <div className="h-12 bg-background/70" />
                    <div className="h-12 bg-background/70" />
                  </div>
                  <div className="flex gap-2 p-4">
                    <div className="h-9 w-24 rounded-lg bg-elevated" />
                    <div className="h-9 w-28 rounded-lg bg-elevated/75" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function RootDocument() {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <HeadContent />
        <script dangerouslySetInnerHTML={{ __html: APPEARANCE_BOOT }} />
      </head>
      <body className="bg-background text-foreground" onContextMenu={(event) => event.preventDefault()}>
        <Outlet />
        {!hydrated ? <StartupSkeleton /> : null}
        <Scripts />
      </body>
    </html>
  );
}

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: APP_NAME },
      { name: "theme-color", content: "#0c0d10" },
      {
        name: "description",
        content:
          "A dock for WSL containers. Tauri desktop powered by the installed wslc CLI.",
      },
    ],
    links: [
      { rel: "icon", type: "image/svg+xml", href: "/favicon.svg" },
      { rel: "icon", type: "image/png", sizes: "32x32", href: "/favicon-32.png" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
      { rel: "stylesheet", href: appCss },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      {
        rel: "preconnect",
        href: "https://fonts.gstatic.com",
        crossOrigin: "anonymous",
      },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&display=swap",
      },
    ],
  }),
  component: RootDocument,
});
