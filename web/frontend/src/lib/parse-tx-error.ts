/**
 * Walk viem's error cause chain to extract the actual contract revert reason
 * instead of showing misleading nonce / gas errors.
 */

/** Known contract custom errors → human-readable messages */
const ERROR_MESSAGES: Record<string, string> = {
  // NovelCore
  InvalidConfig: "Invalid novel configuration.",
  NovelNotFound: "Novel not found.",
  NovelNotActive: "This novel is no longer active.",
  ChapterNotFound: "Chapter not found.",
  NotWorldLine: "This chapter is not a world line.",
  InvalidStakeAmount: "Invalid stake amount.",
  ContentLengthOutOfRange: "Chapter content length is out of the allowed range.",
  WrongRoundPhase: "The round is not in the required phase for this action.",
  WrongEpochPhase: "The epoch is not in the required phase for this action.",
  RoundConditionsNotMet: "Round conditions are not met yet.",
  PhaseNotExpired: "The current phase has not expired yet.",
  NoStakeToRefund: "No stake available to refund.",
  ChapterNotInNovel: "This chapter does not belong to this novel.",
  BranchNotRejected: "This branch has not been rejected.",
  InvalidBootstrapInput: "At least one bootstrap chapter is required.",
  InsufficientForkFee: "Insufficient fee to fork this novel.",
  NotNovelCreator: "Only the novel creator can perform this action.",
  InvalidMetadata: "Invalid novel metadata.",
  ContentHashMismatch: "Content hash does not match.",
  OnchainContentRequired: "On-chain content is required for this novel.",
  OnchainContentForbidden: "This novel does not accept on-chain content.",
  // VotingEngine
  VotingNotInitialized: "Voting has not been initialized for this round.",
  VotingAlreadyInitialized: "Voting is already initialized.",
  AlreadyCommitted: "You have already committed a vote this round.",
  NotCommitted: "You have not committed a vote.",
  AlreadyRevealed: "You have already revealed your vote.",
  InvalidReveal: "Invalid reveal — the candidate or salt does not match your commit.",
  InvalidCandidate: "Invalid candidate selection.",
  AlreadyTallied: "Votes have already been tallied.",
  NotTallied: "Votes have not been tallied yet.",
  AlreadyClaimed: "Reward has already been claimed.",
  NoCandidates: "No candidates available.",
  AlreadySwept: "Already swept.",
  NotRevealed: "You have not revealed your vote.",
  ZeroStake: "Stake must be greater than zero.",
  CommitPhaseClosed: "The commit phase is closed.",
  RevealNotOpen: "The reveal phase is not open.",
  // PrizePool
  TipTooSmall: "Tip amount is too small.",
  NoPendingReward: "No pending reward to claim.",
  NoAuthors: "No authors found.",
  InvalidRate: "Invalid rate configuration.",
  // ChapterNFT
  ChapterAlreadyMinted: "This chapter has already been minted as an NFT.",
  TokenDoesNotExist: "Token does not exist.",
  // ReportRegistry
  BondTooSmall: "Report bond is too small.",
  ReportNotFound: "Report not found.",
  ReportAlreadyResolved: "Report has already been resolved.",
  // Shared
  TransferFailed: "Token transfer failed.",
  OnlyNovelCore: "This action can only be called by NovelCore.",
  ZeroAddress: "Invalid zero address.",
  ZeroAmount: "Amount must be greater than zero.",
};

const NONCE_RE = /nonce/i;
const REVERT_RE = /revert(?:ed)?/i;

interface ParsedError {
  message: string;
  errorName?: string;
}

/**
 * Walk the error cause chain and extract the deepest revert reason.
 * Returns a human-readable message.
 */
export function parseTxError(err: unknown): ParsedError {
  if (!err) return { message: "Transaction failed." };

  // Walk the cause chain to find contract revert data
  let current: any = err;
  let revertErrorName: string | undefined;
  let revertReason: string | undefined;
  let deepestShortMessage: string | undefined;

  for (let depth = 0; current && depth < 10; depth++) {
    // Check for decoded contract error name (viem ContractFunctionRevertedError)
    if (current.data?.errorName && current.data.errorName !== "Error") {
      revertErrorName = current.data.errorName;
    }

    // Check for revert reason string
    if (typeof current.reason === "string" && current.reason) {
      revertReason = current.reason;
    }

    // Track shortMessage at each level — deeper ones are more specific
    if (typeof current.shortMessage === "string" && current.shortMessage) {
      deepestShortMessage = current.shortMessage;
    }

    // Check metaMessages for revert info (viem sometimes puts reason here)
    if (Array.isArray(current.metaMessages)) {
      for (const meta of current.metaMessages) {
        if (typeof meta === "string" && REVERT_RE.test(meta)) {
          // e.g. "Error: WrongRoundPhase()" — extract the error name
          const match = meta.match(/Error:\s*(\w+)\(/);
          if (match) revertErrorName = match[1];
        }
      }
    }

    current = current.cause;
  }

  // 1. Known contract error
  if (revertErrorName && ERROR_MESSAGES[revertErrorName]) {
    return { message: ERROR_MESSAGES[revertErrorName], errorName: revertErrorName };
  }

  // 2. Unknown contract error name — show it raw
  if (revertErrorName) {
    return { message: `Contract error: ${revertErrorName}`, errorName: revertErrorName };
  }

  // 3. Revert reason string (from require("reason"))
  if (revertReason) {
    return { message: revertReason };
  }

  // 4. If it's a nonce error or other misleading RPC error, give a helpful generic message
  const topMessage = (err as any).shortMessage || (err as any).message || "";
  if (NONCE_RE.test(topMessage) || NONCE_RE.test(deepestShortMessage || "")) {
    return { message: "Transaction failed. The on-chain state may have changed — please refresh the page and try again." };
  }

  // 5. User rejected in wallet
  if (/user rejected|user denied/i.test(topMessage)) {
    return { message: "Transaction was rejected in your wallet." };
  }

  // 6. Best available short message (non-nonce)
  if (deepestShortMessage) {
    return { message: deepestShortMessage };
  }

  // 7. Fallback
  const msg = (err as any).shortMessage || (err as any).message;
  if (typeof msg === "string" && msg.length > 0) {
    return { message: msg.length > 150 ? msg.slice(0, 150) + "…" : msg };
  }

  return { message: "Transaction failed." };
}
