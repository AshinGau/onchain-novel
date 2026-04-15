/** API base URL for the backend */
export const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001/api";

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
