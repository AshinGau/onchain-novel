/**
 * UI-only constants. API base URL now lives in lib/api.ts (via the shared
 * client); contract addresses live in lib/contracts.ts.
 */

import { chain } from "./chain";

/** Native token symbol shown in UI. Derived from the chain object built in
 *  lib/chain.ts so it stays in sync with wagmi/RainbowKit's nativeCurrency. */
export const TOKEN_SYMBOL = chain.nativeCurrency.symbol;

/** Reader-facing labels for contract phases: 0=Idle, 1=Nominating, 2=Committing, 3=Revealing */
export const ROUND_PHASES = ["Writing", "Nominating", "Voting", "Revealing"] as const;

export type RoundPhase = (typeof ROUND_PHASES)[number];

export function phaseLabel(phase: number): RoundPhase {
  const label = ROUND_PHASES[phase];
  if (!label) throw new Error(`Unknown round phase: ${phase}`);
  return label;
}
