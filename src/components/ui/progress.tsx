import { cn } from "@/lib/utils";

export function Progress({
  value,
  className,
}: {
  value: number;
  className?: string;
}) {
  const pct = Math.min(100, Math.max(0, value));
  return (
    <div
      className={cn(
        "h-1.5 w-full overflow-hidden rounded-full bg-elevated",
        className,
      )}
    >
      <div
        className="h-full rounded-full bg-accent transition-[width] duration-[var(--motion-fast)] ease-[var(--ease-smooth-out)]"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
