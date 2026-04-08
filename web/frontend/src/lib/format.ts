import { formatEther } from "viem";
import { TOKEN_SYMBOL } from "./config";

/** Shorten an address: 0x1234...abcd */
export function shortAddress(addr: string): string {
  if (!addr || addr.length < 10) return addr ?? "";
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

/** Format wei string to readable token amount */
export function formatBalance(wei: string | bigint): string {
  const value = typeof wei === "string" ? BigInt(wei || "0") : wei;
  const num = parseFloat(formatEther(value));
  if (num === 0) return `0 ${TOKEN_SYMBOL}`;
  if (num < 0.0001) return `<0.0001 ${TOKEN_SYMBOL}`;
  return `${num.toFixed(4)} ${TOKEN_SYMBOL}`;
}

/** Format a compact number (1.2K, 3.4M) */
export function formatCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

/** Relative time string */
export function timeAgo(isoOrTimestamp: string | number): string {
  const ms =
    typeof isoOrTimestamp === "number"
      ? isoOrTimestamp * 1000
      : new Date(isoOrTimestamp).getTime();
  const diff = Date.now() - ms;
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return "just now";
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(ms).toLocaleDateString();
}

/** Truncate text with ellipsis */
export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max) + "...";
}
