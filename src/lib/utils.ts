import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function shortId(id: string) {
  return id.slice(0, 12);
}

export function formatBytes(bytes: number) {
  const value = Number.isFinite(bytes) ? Math.max(0, bytes) : 0;
  const KB = 1024;
  const MB = 1024 * 1024;
  const GB = 1024 * 1024 * 1024;
  const TB = 1024 * 1024 * 1024 * 1024;

  const format = (amount: number, unit: "KB" | "MB" | "GB" | "TB") =>
    `${amount >= 100 ? Math.round(amount) : amount.toFixed(1)} ${unit}`;

  if (value >= TB) return format(value / TB, "TB");
  if (value >= GB) return format(value / GB, "GB");
  if (value >= MB) return format(value / MB, "MB");
  if (value >= KB) return format(value / KB, "KB");
  return `${Math.round(value)} B`;
}

export function formatUptime(startedAt?: number, now = Date.now()) {
  if (!startedAt) return "—";
  const s = Math.max(0, Math.floor((now - startedAt) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${sec}s`;
  return `${sec}s`;
}

export function relativeTime(ts: number, now = Date.now()) {
  const d = Math.max(0, Math.floor((now - ts) / 1000));
  if (d < 5) return "just now";
  if (d < 60) return `${d}s ago`;
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  return `${Math.floor(d / 86400)}d ago`;
}
