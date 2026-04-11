export {
  novelCoreAbi,
  votingEngineAbi,
  prizePoolAbi,
  bountyBoardAbi,
  rulesEngineAbi,
} from "./abi.js";

export {
  // Types
  type NovelConfig,
  type NovelMetadata,
  type ContentSubmission,
  type CreateNovelParams,
  type SubmitChapterParams,
  type CommitVoteParams,
  type RevealVoteParams,
  type NominateCandidateParams,
  type TipParams,
  type ForkNovelParams,
  type CreateBountyParams,
  type DesignateBountyParams,
  type ProposeRuleParams,
  type SetCreatorRulesParams,

  // Helpers
  computeCommitHash,
  toBytes32Salt,
  buildContentSubmission,

  // Write operations
  createNovel,
  submitChapter,
  commitVote,
  revealVote,
  startRound,
  closeNomination,
  closeCommit,
  settleRound,
  nominateCandidate,
  tipNovel,
  tipChapter,
  claimReward,
  claimVotingReward,
  completeNovel,
  forkNovel,
  createBounty,
  designateBounty,
  claimBounty,
  refundBounty,
  setCreatorRules,
  proposeRule,
  voteOnRuleProposal,

  // Read operations
  getNovel,
  getChapter,
  getWorldLineAncestors,
  getRoundData,
  getNovelMetadata,
  getPoolBalance,
  getRuleNames,
  getRule,
  getRuleProposal,
} from "./contracts.js";

export type { OnchainNovelConfig } from "./config.js";
