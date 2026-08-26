import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { AppearanceProvider } from "@/components/appearance-provider";
import { GettingStartedView } from "@/components/views/getting-started-view";
import { useWslc } from "@/lib/wslc/store";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  const onboardingCompleted = useWslc((s) => s.onboardingCompleted);
  if (onboardingCompleted) return <AppShell />;
  return (
    <AppearanceProvider>
      <GettingStartedView />
    </AppearanceProvider>
  );
}
