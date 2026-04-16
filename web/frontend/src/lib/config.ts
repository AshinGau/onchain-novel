/**
 * API base URL for the backend.
 *
 * Resolution order:
 *   1. NEXT_PUBLIC_API_URL env var (deployment override)
 *   2. In the browser: derive from window.location.hostname so a page served
 *      to a mobile phone over LAN (e.g. 192.168.1.2:3000) hits 192.168.1.2:3001
 *      for the API instead of the device's own localhost (which has no backend).
 *   3. SSR fallback: localhost (the dev server runs on the same host as backend).
 */
function resolveApiUrl(): string {
  if (process.env.NEXT_PUBLIC_API_URL) return process.env.NEXT_PUBLIC_API_URL;
  if (typeof window !== "undefined") {
    return `${window.location.protocol}//${window.location.hostname}:3001/api`;
  }
  return "http://localhost:3001/api";
}

export const API_URL = resolveApiUrl();

/** Native token symbol shown in UI */
export const TOKEN_SYMBOL = process.env.NEXT_PUBLIC_TOKEN_SYMBOL || "ETH";

/** Round phase labels (matches contract enum) */
/** Reader-facing labels for contract phases:
 *  0=Idle, 1=Nominating, 2=Committing, 3=Revealing */
export const ROUND_PHASES = ["Writing", "Nominating", "Voting", "Revealing"] as const;

export type RoundPhase = (typeof ROUND_PHASES)[number];

export function phaseLabel(phase: number): RoundPhase {
  return ROUND_PHASES[phase] ?? "Writing";
}
