import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

const KEYWORDS =
  /\b(using|namespace|public|private|sealed|class|void|return|await|async|new|if|else|var|string|int|bool|true|false|null|this|switch|Task|throw)\b/g;

export function CodeBlock({
  code,
  className,
  label = "C#",
}: {
  code: string;
  className?: string;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);

  const html = code
    .replace(/&/g, "&")
    .replace(/</g, "<")
    .replace(/>/g, ">")
    .replace(/(\/\/.*)$/gm, '<span class="text-subtle">$1</span>')
    .replace(KEYWORDS, '<span class="text-accent">$1</span>')
    .replace(/("|")([^"\n]*)("|")/g, '<span class="text-ok">"$2"</span>');

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      /* ignore */
    }
  }

  return (
    <div
      className={cn(
        "relative overflow-hidden rounded-lg border border-border bg-background",
        className,
      )}
    >
      <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
        <span className="text-[11px] uppercase tracking-[0.14em] text-subtle">
          {label}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={copy}
          aria-label="Copy code"
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
        </Button>
      </div>
      <pre
        className="overflow-x-auto p-3 font-mono text-[12px] leading-relaxed text-foreground/90"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}
