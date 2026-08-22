import { cn } from "@/lib/utils";

export function Mark({ className }: { className?: string }) {
  return (
    <img
      src="/logo.png"
      alt=""
      width={28}
      height={28}
      className={cn("size-7 rounded-[7px]", className)}
    />
  );
}
