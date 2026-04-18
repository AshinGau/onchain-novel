/**
 * Contract addresses + ABIs for the browser bundle.
 *
 * Addresses are injected at build time by next.config.ts (see `env` field
 * there), which reads them from the repo's config.yaml. ABIs come from
 * @onchain-novel/shared/chain — the single source of truth shared with
 * the backend indexer and CLI.
 */

export {
  novelCoreAbi,
  roundManagerAbi,
  votingEngineAbi,
  prizePoolAbi,
  bountyBoardAbi,
  rulesEngineAbi,
  userRegistryAbi,
} from "@onchain-novel/shared/chain";

const ZERO = "0x0000000000000000000000000000000000000000" as `0x${string}`;

function addr(envVar: string | undefined): `0x${string}` {
  return (envVar as `0x${string}` | undefined) ?? ZERO;
}

export const NOVEL_CORE_ADDRESS = addr(process.env.NEXT_PUBLIC_NOVEL_CORE);
export const ROUND_MANAGER_ADDRESS = addr(process.env.NEXT_PUBLIC_ROUND_MANAGER);
export const PRIZE_POOL_ADDRESS = addr(process.env.NEXT_PUBLIC_PRIZE_POOL);
export const VOTING_ENGINE_ADDRESS = addr(process.env.NEXT_PUBLIC_VOTING_ENGINE);
export const BOUNTY_BOARD_ADDRESS = addr(process.env.NEXT_PUBLIC_BOUNTY_BOARD);
export const RULES_ENGINE_ADDRESS = addr(process.env.NEXT_PUBLIC_RULES_ENGINE);
export const USER_REGISTRY_ADDRESS = addr(process.env.NEXT_PUBLIC_USER_REGISTRY);
