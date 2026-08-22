import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-[opacity,transform,background-color,color,border-color] duration-[var(--motion-quick)] ease-[var(--ease-out)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-40 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 active:scale-[0.98]",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:opacity-90",
        secondary:
          "bg-secondary text-secondary-foreground border border-border hover:bg-elevated",
        ghost: "hover:bg-elevated text-foreground",
        outline:
          "border border-border bg-transparent hover:bg-elevated text-foreground",
        destructive: "bg-destructive text-destructive-foreground hover:opacity-90",
        link: "text-accent underline-offset-4 hover:underline",
      },
      size: {
        default: "h-11 px-4 min-h-11",
        sm: "h-9 px-3 text-[13px]",
        lg: "h-12 px-5",
        icon: "h-11 w-11",
        "icon-sm": "h-9 w-9",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
