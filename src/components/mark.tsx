import { cn } from "@/lib/utils";

export function Mark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      className={cn("size-7", className)}
      aria-hidden="true"
    >
      <rect width="32" height="32" rx="7" fill="#0c0d10" />
      <path d="M5 25h22l-2 3H7z" fill="#6a717c" />
      <path d="M5 25h22v.7H5z" className="fill-accent" />
      <path d="M9 17h12l3 3.2H12z" fill="#5f7386" />
      <rect x="9" y="13.2" width="12" height="3.8" className="fill-accent" />
      <path d="M21 13.2l3 3.2v3.8l-3-3.2z" fill="#6d8296" />
      <path d="M9 12.4h12l3 3.2H12z" fill="#c9ced6" />
      <rect x="9" y="8.6" width="12" height="3.8" className="fill-foreground" />
      <path d="M21 8.6l3 3.2v3.8l-3-3.2z" fill="#b7bcc4" />
    </svg>
  );
}
