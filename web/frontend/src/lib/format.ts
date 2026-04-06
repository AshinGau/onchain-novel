export function shortenAddress(addr: string): string {
  if (!addr) return "";
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

export function formatEth(wei: string): string {
  if (!wei || wei === "0") return "0";
  const eth = Number(BigInt(wei)) / 1e18;
  if (eth >= 1) return eth.toFixed(2);
  // Show enough decimals to reveal non-zero digits, then trim trailing zeros
  const match = eth.toFixed(18).match(/^0\.(0*)([1-9])/);
  const decimals = match ? match[1].length + 2 : 4;
  return eth.toFixed(Math.max(4, decimals)).replace(/0+$/, "").replace(/\.$/, "");
}

const ROUND_PHASE_NAMES = ["Submitting", "Committing", "Revealing", "Settling"] as const;
const EPOCH_PHASE_NAMES = ["Rounds", "Committing", "Revealing", "Settling"] as const;

export function getPhaseLabel(roundPhase: number, epochPhase: number): string {
  return epochPhase === 0
    ? ROUND_PHASE_NAMES[roundPhase] ?? "Unknown"
    : `Epoch ${EPOCH_PHASE_NAMES[epochPhase] ?? "Unknown"}`;
}

export function formatDuration(seconds: number | string): string {
  const s = Number(seconds);
  if (isNaN(s) || s <= 0) return "0s";
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const parts: string[] = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  if (sec > 0 || parts.length === 0) parts.push(`${sec}s`);
  return parts.join(" ");
}

export function timeAgo(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  if (isNaN(then)) return "";
  const diff = now - then;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
