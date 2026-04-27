// Browser-safe surface: ABIs + pure-viem writer helpers. No Node-only
// modules (fs / os / path) so this can be bundled for the frontend.
// vote-store lives at @onchain-novel/shared/vote-store (Node-only).
export {
  novelCoreAbi,
  roundManagerAbi,
  votingEngineAbi,
  prizePoolAbi,
  bountyBoardAbi,
  rulesEngineAbi,
  userRegistryAbi,
} from "./abi.js";

export * from "./contracts.js";
export * from "./resolveContracts.js";
