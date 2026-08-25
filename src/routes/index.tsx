import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { GettingStartedView } from "@/components/views/getting-started-view";
import { useWslc } from "@/lib/wslc/store";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  const onboardingCompleted = useWslc((s) => s.onboardingCompleted);
  return onboardingCompleted ? <AppShell /> : <GettingStartedView />;
}
