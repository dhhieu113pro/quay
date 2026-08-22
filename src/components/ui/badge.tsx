import type { HTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium tracking-wide",
  {
    variants: {
      variant: {
        default: "border-transparent bg-elevated text-muted-foreground",
        running: "border-transparent bg-ok/15 text-ok",
        exited: "border-transparent bg-elevated text-muted-foreground",
        created: "border-transparent bg-warn/15 text-warn",
        paused: "border-transparent bg-warn/15 text-warn",
        gpu: "border-transparent bg-accent/15 text-accent",
        danger: "border-transparent bg-destructive/15 text-destructive",
        outline: "border-border text-muted-foreground",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export function Badge({
  className,
  variant,
  ...props
}: HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
