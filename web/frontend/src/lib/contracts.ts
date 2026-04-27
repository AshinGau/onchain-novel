/**
 * Contract addresses + ABIs for the browser bundle.
 *
 * Addresses are injected at build time by next.config.ts (see `env` field
 * there), which reads `contracts.novelCore` from config.yaml and resolves the
 * other six on-chain via NovelCore's address book. If next.config.ts couldn't
 * resolve them, the build itself fails — by the time this module loads, every
 * NEXT_PUBLIC_* below is a baked-in string literal.
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

export const NOVEL_CORE_ADDRESS = process.env.NEXT_PUBLIC_NOVEL_CORE as `0x${string}`;
export const ROUND_MANAGER_ADDRESS = process.env.NEXT_PUBLIC_ROUND_MANAGER as `0x${string}`;
export const PRIZE_POOL_ADDRESS = process.env.NEXT_PUBLIC_PRIZE_POOL as `0x${string}`;
export const VOTING_ENGINE_ADDRESS = process.env.NEXT_PUBLIC_VOTING_ENGINE as `0x${string}`;
export const BOUNTY_BOARD_ADDRESS = process.env.NEXT_PUBLIC_BOUNTY_BOARD as `0x${string}`;
export const RULES_ENGINE_ADDRESS = process.env.NEXT_PUBLIC_RULES_ENGINE as `0x${string}`;
export const USER_REGISTRY_ADDRESS = process.env.NEXT_PUBLIC_USER_REGISTRY as `0x${string}`;
