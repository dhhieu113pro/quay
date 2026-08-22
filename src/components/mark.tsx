import { cn } from "@/lib/utils";

export function Mark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      className={cn("size-7", className)}
      aria-hidden="true"
    >
      <rect width="32" height="32" rx="7" className="fill-elevated" />
      <rect x="7" y="8" width="18" height="6" rx="1.2" className="fill-accent" />
      <rect x="7" y="16" width="18" height="6" rx="1.2" className="fill-foreground/80" />
      <rect x="9" y="9.6" width="3" height="2.6" rx="0.4" className="fill-background" />
      <rect x="9" y="17.6" width="3" height="2.6" rx="0.4" className="fill-background" />
    </svg>
  );
}
