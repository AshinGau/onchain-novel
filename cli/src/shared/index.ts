export {
  novelCoreAbi,
  roundManagerAbi,
  prizePoolAbi,
  bountyBoardAbi,
  rulesEngineAbi,
  userRegistryAbi,
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
  type UpdateNovelMetadataParams,

  // Path-proof params
  type StartRoundParams,
  type SettleRoundParams,
  type CompleteNovelParams,
  type VoteOnRuleProposalParams,

  // Helpers
  computeCommitHash,
  toBytes32Salt,
  buildContentSubmission,
  buildWorldLineProof,
  buildPathToAnchor,

  // Write operations
  createNovel,
  updateNovelMetadata,
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
  setNickname,

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
  getNickname,
} from "./contracts.js";

export type { OnchainNovelConfig } from "./config.js";
