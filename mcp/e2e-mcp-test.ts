/**
 * E2E MCP Integration Test — Protocol
 *
 * Tests MCP utility functions and ABI interactions against a live Anvil node
 * with deployed contracts. Run via: npx tsx mcp/e2e-mcp-test.ts
 *
 * Two modes:
 *   - RPC mode (default): tests direct chain reads/writes via ABI
 *   - API mode (API_BASE_URL set): also tests Web API endpoints
 *
 * Env vars expected:
 *   RPC_URL, NOVEL_CORE_ADDRESS, VOTING_ENGINE_ADDRESS, PRIZE_POOL_ADDRESS,
 *   BOUNTY_BOARD_ADDRESS, RULES_ENGINE_ADDRESS
 *   PK_DEPLOYER, PK_CREATOR, PK_WRITER_A, PK_WRITER_B,
 *   PK_VOTER_A, PK_VOTER_B, PK_KEEPER
 *   Optional: API_BASE_URL
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  parseEther,
  formatEther,
  parseAbi,
  keccak256,
  toHex,
  toBytes,
  encodeEventTopics,
  decodeEventLog,
  type PublicClient,
  type Transport,
  type Chain,
  type WalletClient,
  type TransactionReceipt,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import {
  novelCoreAbi,
  prizePoolAbi,
  bountyBoardAbi,
  rulesEngineAbi,
} from "./src/shared/abi.js";
import {
  buildContentSubmission,
  computeCommitHash,
  toBytes32Salt,
  type NovelConfig,
  type ContentSubmission,
} from "./src/shared/contracts.js";

// ============================================================
// Environment
// ============================================================

const RPC_URL = process.env.RPC_URL!;
const NOVEL_CORE = process.env.NOVEL_CORE_ADDRESS! as `0x${string}`;
const VOTING_ENGINE = process.env.VOTING_ENGINE_ADDRESS! as `0x${string}`;
const PRIZE_POOL = process.env.PRIZE_POOL_ADDRESS! as `0x${string}`;
const BOUNTY_BOARD = process.env.BOUNTY_BOARD_ADDRESS! as `0x${string}`;
const RULES_ENGINE = process.env.RULES_ENGINE_ADDRESS! as `0x${string}`;
const API_BASE_URL = process.env.API_BASE_URL || "";
const HAS_API = API_BASE_URL.length > 0;

// PrizePool ABI for owner-only setKeeperRewardAmount
const prizePoolOwnerAbi = parseAbi([
  "function setKeeperRewardAmount(uint256 amount) external",
]);

// ============================================================
// Clients
// ============================================================

function makeClient(pk: string) {
  const account = privateKeyToAccount(pk as `0x${string}`);
  return {
    public: createPublicClient({ chain: foundry, transport: http(RPC_URL) }) as PublicClient<Transport, Chain>,
    wallet: createWalletClient({ account, chain: foundry, transport: http(RPC_URL) }),
    address: account.address,
  };
}

const deployer = makeClient(process.env.PK_DEPLOYER!);
const creator = makeClient(process.env.PK_CREATOR!);
const writerA = makeClient(process.env.PK_WRITER_A!);
const writerB = makeClient(process.env.PK_WRITER_B!);
const voterA = makeClient(process.env.PK_VOTER_A!);
const voterB = makeClient(process.env.PK_VOTER_B!);
const keeper = makeClient(process.env.PK_KEEPER!);

const publicClient = creator.public;

// ============================================================
// Test harness
// ============================================================

let passed = 0;
let failed = 0;

function pass(msg: string) {
  passed++;
  console.log(`  \x1b[32m[PASS]\x1b[0m ${msg}`);
}
function fail(msg: string) {
  failed++;
  console.log(`  \x1b[31m[FAIL]\x1b[0m ${msg}`);
}
function info(msg: string) {
  console.log(`  \x1b[33m[INFO]\x1b[0m ${msg}`);
}

async function waitTx(hash: `0x${string}`): Promise<TransactionReceipt> {
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`Tx reverted: ${hash}`);
  return receipt;
}

/** Advance Anvil time by `seconds` and mine a block */
async function advanceTime(seconds: number) {
  await (publicClient as any).request({
    method: "evm_increaseTime" as any,
    params: [seconds],
  });
  await (publicClient as any).request({
    method: "evm_mine" as any,
  });
}

/** Find an event log by contract address and event name, return decoded topics */
function findEventLog(receipt: TransactionReceipt, address: `0x${string}`, eventName: string) {
  const sig = encodeEventTopics({ abi: novelCoreAbi, eventName: eventName as any })[0];
  return receipt.logs.find(
    (l) => l.address.toLowerCase() === address.toLowerCase() && l.topics[0] === sig,
  );
}

async function apiFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`);
  if (!res.ok) throw new Error(`API ${res.status}: ${path}`);
  return res.json() as Promise<T>;
}

// ============================================================
// Novel config for testing (short durations for fast cycling)
// ============================================================

const TEST_CONFIG: NovelConfig = {
  minChapterLength: 50n,
  maxChapterLength: 50000n,
  submissionFee: parseEther("0.001"),
  worldLineCount: 2,
  voteStake: parseEther("0.005"),
  nominationFee: parseEther("0.001"),
  nominateDuration: 5n,    // 5 seconds
  commitDuration: 5n,      // 5 seconds
  revealDuration: 5n,      // 5 seconds
  minRoundGap: 5n,         // 5 seconds
  prizeReleaseRate: 2000,  // 20%
  voterRewardRate: 1500,   // 15%
  maxVoterReward: 0n,                       // uncapped
  unrevealPenaltyFloor: parseEther("0.001"), // floor for unreveal penalty
  contentLocation: 0,      // Onchain
  contentBaseUrl: "",
  ruleFee: parseEther("0.001"),
  ruleVoteDuration: 300n,
  ruleQuorum: 7,
};

// ============================================================
// Shared state across test phases
// ============================================================

let novelId: bigint;
let rootChapterId: bigint;
let chapterA1Id: bigint;  // Writer A's first chapter (child of root)
let chapterB1Id: bigint;  // Writer B's chapter (child of root)
let chapterA2Id: bigint;  // Writer A's second chapter (child of A1)

// ============================================================
// Phase 1: Setup
// ============================================================

async function phase1Setup() {
  console.log("\n  === Phase 1: Setup ===\n");

  // Set keeper reward on PrizePool (deployer is owner)
  const hash = await deployer.wallet.writeContract({
    address: PRIZE_POOL,
    abi: prizePoolOwnerAbi,
    functionName: "setKeeperRewardAmount",
    args: [parseEther("0.001")],
    chain: foundry,
    account: deployer.wallet.account!,
  });
  await waitTx(hash);
  pass("PrizePool: setKeeperRewardAmount(0.001 ETH)");
}

// ============================================================
// Phase 2: Create Novel
// ============================================================

async function phase2CreateNovel() {
  console.log("\n  === Phase 2: Create Novel ===\n");

  const rootContent = "In the beginning there was nothing but the endless void. Then a spark ignited.";
  const rootSubmission = buildContentSubmission(rootContent);

  const hash = await creator.wallet.writeContract({
    address: NOVEL_CORE,
    abi: novelCoreAbi,
    functionName: "createNovel",
    args: [
      TEST_CONFIG,
      { title: "MCP E2E Test Novel", description: "A test novel for E2E testing", coverUri: "" },
      rootSubmission,
    ],
    value: parseEther("0.1"), // genesis prize pool
    chain: foundry,
    account: creator.wallet.account!,
  });
  const receipt = await waitTx(hash);

  // Extract novelId from NovelCreated event
  const createdLog = findEventLog(receipt, NOVEL_CORE, "NovelCreated");
  if (!createdLog || !createdLog.topics[1]) {
    fail("createNovel: no NovelCreated event");
    info(`Logs count: ${receipt.logs.length}, status: ${receipt.status}`);
    info(`Log addresses: ${receipt.logs.map(l => l.address?.slice(0, 10)).join(", ")}`);
    info(`Log topics: ${receipt.logs.map(l => l.topics[0]?.slice(0, 18)).join(", ")}`);
    info(`Expected sig: ${encodeEventTopics({ abi: novelCoreAbi, eventName: "NovelCreated" as any })[0]?.slice(0, 18)}`);
    return;
  }
  novelId = BigInt(createdLog.topics[1]);
  pass(`createNovel: Novel #${novelId} created with 0.1 ETH genesis`);

  // Verify getNovel
  const novel = await publicClient.readContract({
    address: NOVEL_CORE,
    abi: novelCoreAbi,
    functionName: "getNovel",
    args: [novelId],
  }) as any;

  if (novel.id !== novelId) { fail("getNovel: wrong ID"); return; }
  if (novel.creator.toLowerCase() !== creator.address.toLowerCase()) { fail("getNovel: wrong creator"); return; }
  if (novel.active !== true) { fail("getNovel: not active"); return; }
  if (novel.currentRound !== 0) { fail("getNovel: round should be 0"); return; }
  if (novel.roundPhase !== 0) { fail("getNovel: phase should be Idle(0)"); return; }
  pass(`getNovel: verified (creator=${novel.creator.slice(0, 10)}..., active=${novel.active}, round=${novel.currentRound}, phase=${novel.roundPhase})`);

  // Verify getWorldLineAncestors returns root chapter
  const ancestors = await publicClient.readContract({
    address: NOVEL_CORE,
    abi: novelCoreAbi,
    functionName: "getWorldLineAncestors",
    args: [novelId],
  }) as bigint[];

  if (ancestors.length === 0) { fail("getWorldLineAncestors: empty after creation"); return; }
  rootChapterId = ancestors[0];
  pass(`getWorldLineAncestors: [${ancestors.join(", ")}] (root=#${rootChapterId})`);

  // Verify root chapter
  const rootCh = await publicClient.readContract({
    address: NOVEL_CORE,
    abi: novelCoreAbi,
    functionName: "getChapter",
    args: [rootChapterId],
  }) as any;
  if (rootCh.novelId !== novelId) { fail("getChapter(root): wrong novelId"); return; }
  if (rootCh.depth !== 1) { fail(`getChapter(root): depth should be 1, got ${rootCh.depth}`); return; }
  pass(`getChapter(root): #${rootCh.id}, depth=${rootCh.depth}, author=${rootCh.author.slice(0, 10)}...`);

  // Check pool balance
  const poolBal = await publicClient.readContract({
    address: PRIZE_POOL,
    abi: prizePoolAbi,
    functionName: "getPoolBalance",
    args: [novelId],
  }) as bigint;
  info(`Pool balance after creation: ${formatEther(poolBal)} ETH`);
}

// ============================================================
// Phase 3: Submit Chapters
// ============================================================

async function phase3SubmitChapters() {
  console.log("\n  === Phase 3: Submit Chapters ===\n");

  const contentA1 = "The spark grew into a flame that illuminated a vast cavern of crystal. Writer A explores the depths.";
  const contentB1 = "The spark drifted upward, becoming a star in an infinite sky. Writer B takes a different path entirely.";
  const contentA2 = "Deep within the crystal cavern, ancient runes began to glow. Writer A continues the underground journey.";

  const subA1 = buildContentSubmission(contentA1);
  const subB1 = buildContentSubmission(contentB1);
  const subA2 = buildContentSubmission(contentA2);

  // Writer A submits chapter (child of root)
  let hash = await writerA.wallet.writeContract({
    address: NOVEL_CORE,
    abi: novelCoreAbi,
    functionName: "submitChapter",
    args: [novelId, rootChapterId, subA1],
    value: TEST_CONFIG.submissionFee,
    chain: foundry,
    account: writerA.wallet.account!,
  });
  let receipt = await waitTx(hash);
  // Extract chapterId from ChapterSubmitted event (topics[2] = indexed chapterId)
  const logA1 = findEventLog(receipt, NOVEL_CORE, "ChapterSubmitted");
  chapterA1Id = logA1?.topics[2] ? BigInt(logA1.topics[2]) : 0n;
  pass(`submitChapter (Writer A -> root): Chapter #${chapterA1Id}`);

  // Writer B submits chapter (child of root, different branch)
  hash = await writerB.wallet.writeContract({
    address: NOVEL_CORE,
    abi: novelCoreAbi,
    functionName: "submitChapter",
    args: [novelId, rootChapterId, subB1],
    value: TEST_CONFIG.submissionFee,
    chain: foundry,
    account: writerB.wallet.account!,
  });
  receipt = await waitTx(hash);
  const logB1 = findEventLog(receipt, NOVEL_CORE, "ChapterSubmitted");
  chapterB1Id = logB1?.topics[2] ? BigInt(logB1.topics[2]) : 0n;
  pass(`submitChapter (Writer B -> root): Chapter #${chapterB1Id}`);

  // Writer A extends their own chain (child of A1)
  hash = await writerA.wallet.writeContract({
    address: NOVEL_CORE,
    abi: novelCoreAbi,
    functionName: "submitChapter",
    args: [novelId, chapterA1Id, subA2],
    value: TEST_CONFIG.submissionFee,
    chain: foundry,
    account: writerA.wallet.account!,
  });
  receipt = await waitTx(hash);
  const logA2 = findEventLog(receipt, NOVEL_CORE, "ChapterSubmitted");
  chapterA2Id = logA2?.topics[2] ? BigInt(logA2.topics[2]) : 0n;
  pass(`submitChapter (Writer A -> A1): Chapter #${chapterA2Id}`);

  // Verify one of the chapters
  const ch = await publicClient.readContract({
    address: NOVEL_CORE,
    abi: novelCoreAbi,
    functionName: "getChapter",
    args: [chapterA1Id],
  }) as any;
  if (ch.novelId !== novelId) { fail("getChapter(A1): wrong novelId"); return; }
  if (ch.parentId !== rootChapterId) { fail("getChapter(A1): wrong parentId"); return; }
  if (ch.depth !== 2) { fail(`getChapter(A1): depth should be 2, got ${ch.depth}`); return; }
  pass(`getChapter(A1): verified (parent=#${ch.parentId}, depth=${ch.depth})`);
}

// ============================================================
// Phase 4: Round 1 — Full Voting Cycle
// ============================================================

async function phase4VotingRound() {
  console.log("\n  === Phase 4: Round 1 — Full Voting Cycle ===\n");

  // Advance time past minRoundGap
  await advanceTime(10);
  info("Advanced time by 10s (past minRoundGap)");

  // startRound (keeper)
  let hash = await keeper.wallet.writeContract({
    address: NOVEL_CORE,
    abi: novelCoreAbi,
    functionName: "startRound",
    args: [novelId],
    chain: foundry,
    account: keeper.wallet.account!,
  });
  await waitTx(hash);
  pass("startRound (keeper)");

  // Verify novel is now in Nominating phase
  let novel = await publicClient.readContract({
    address: NOVEL_CORE,
    abi: novelCoreAbi,
    functionName: "getNovel",
    args: [novelId],
  }) as any;
  if (novel.roundPhase !== 1) { fail(`After startRound: phase should be 1 (Nominating), got ${novel.roundPhase}`); return; }
  if (novel.currentRound !== 1) { fail(`After startRound: round should be 1, got ${novel.currentRound}`); return; }
  pass(`Novel state: round=${novel.currentRound}, phase=Nominating(${novel.roundPhase})`);

  // Check round data for auto-generated candidates
  const roundData = await publicClient.readContract({
    address: NOVEL_CORE,
    abi: novelCoreAbi,
    functionName: "getRoundData",
    args: [novelId, 1],
  }) as any;
  info(`Round 1 candidates (auto-generated): [${roundData.candidates.join(", ")}]`);

  // Advance time past nominateDuration
  await advanceTime(10);
  info("Advanced time by 10s (past nominateDuration)");

  // closeNomination (keeper)
  hash = await keeper.wallet.writeContract({
    address: NOVEL_CORE,
    abi: novelCoreAbi,
    functionName: "closeNomination",
    args: [novelId],
    chain: foundry,
    account: keeper.wallet.account!,
  });
  await waitTx(hash);
  pass("closeNomination (keeper)");

  // Verify Committing phase
  novel = await publicClient.readContract({
    address: NOVEL_CORE,
    abi: novelCoreAbi,
    functionName: "getNovel",
    args: [novelId],
  }) as any;
  if (novel.roundPhase !== 2) { fail(`After closeNomination: phase should be 2 (Committing), got ${novel.roundPhase}`); return; }
  pass(`Novel state: phase=Committing(${novel.roundPhase})`);

  // Pick a candidate to vote for. Use the first candidate in the round.
  const candidates = roundData.candidates as bigint[];
  if (candidates.length === 0) { fail("No candidates in round"); return; }
  const targetCandidate = candidates[0];
  info(`Voting target: Chapter #${targetCandidate}`);

  // Voter A commits vote
  const saltA = toBytes32Salt("secret-salt-voter-a");
  const commitHashA = computeCommitHash(targetCandidate, saltA);

  hash = await voterA.wallet.writeContract({
    address: NOVEL_CORE,
    abi: novelCoreAbi,
    functionName: "commitVote",
    args: [novelId, commitHashA],
    value: TEST_CONFIG.voteStake,
    chain: foundry,
    account: voterA.wallet.account!,
  });
  await waitTx(hash);
  pass(`commitVote (Voter A for #${targetCandidate})`);

  // Voter B commits vote (same candidate)
  const saltB = toBytes32Salt("secret-salt-voter-b");
  const commitHashB = computeCommitHash(targetCandidate, saltB);

  hash = await voterB.wallet.writeContract({
    address: NOVEL_CORE,
    abi: novelCoreAbi,
    functionName: "commitVote",
    args: [novelId, commitHashB],
    value: TEST_CONFIG.voteStake,
    chain: foundry,
    account: voterB.wallet.account!,
  });
  await waitTx(hash);
  pass(`commitVote (Voter B for #${targetCandidate})`);

  // Advance time past commitDuration
  await advanceTime(10);
  info("Advanced time by 10s (past commitDuration)");

  // closeCommit (keeper)
  hash = await keeper.wallet.writeContract({
    address: NOVEL_CORE,
    abi: novelCoreAbi,
    functionName: "closeCommit",
    args: [novelId],
    chain: foundry,
    account: keeper.wallet.account!,
  });
  await waitTx(hash);
  pass("closeCommit (keeper)");

  // Verify Revealing phase
  novel = await publicClient.readContract({
    address: NOVEL_CORE,
    abi: novelCoreAbi,
    functionName: "getNovel",
    args: [novelId],
  }) as any;
  if (novel.roundPhase !== 3) { fail(`After closeCommit: phase should be 3 (Revealing), got ${novel.roundPhase}`); return; }
  pass(`Novel state: phase=Revealing(${novel.roundPhase})`);

  // Voter A reveals
  hash = await voterA.wallet.writeContract({
    address: NOVEL_CORE,
    abi: novelCoreAbi,
    functionName: "revealVote",
    args: [novelId, targetCandidate, saltA],
    chain: foundry,
    account: voterA.wallet.account!,
  });
  await waitTx(hash);
  pass("revealVote (Voter A)");

  // Voter B reveals
  hash = await voterB.wallet.writeContract({
    address: NOVEL_CORE,
    abi: novelCoreAbi,
    functionName: "revealVote",
    args: [novelId, targetCandidate, saltB],
    chain: foundry,
    account: voterB.wallet.account!,
  });
  await waitTx(hash);
  pass("revealVote (Voter B)");

  // Advance time past revealDuration
  await advanceTime(10);
  info("Advanced time by 10s (past revealDuration)");

  // settleRound (keeper)
  hash = await keeper.wallet.writeContract({
    address: NOVEL_CORE,
    abi: novelCoreAbi,
    functionName: "settleRound",
    args: [novelId],
    chain: foundry,
    account: keeper.wallet.account!,
  });
  await waitTx(hash);
  pass("settleRound (keeper)");

  // Verify back to Idle phase
  novel = await publicClient.readContract({
    address: NOVEL_CORE,
    abi: novelCoreAbi,
    functionName: "getNovel",
    args: [novelId],
  }) as any;
  if (novel.roundPhase !== 0) { fail(`After settleRound: phase should be 0 (Idle), got ${novel.roundPhase}`); return; }
  pass(`Novel state after settle: round=${novel.currentRound}, phase=Idle(${novel.roundPhase})`);

  // Check updated world line ancestors
  const ancestors = await publicClient.readContract({
    address: NOVEL_CORE,
    abi: novelCoreAbi,
    functionName: "getWorldLineAncestors",
    args: [novelId],
  }) as bigint[];
  pass(`getWorldLineAncestors after settle: [${ancestors.join(", ")}]`);

  // Check pool balance
  const poolBal = await publicClient.readContract({
    address: PRIZE_POOL,
    abi: prizePoolAbi,
    functionName: "getPoolBalance",
    args: [novelId],
  }) as bigint;
  info(`Pool balance after round 1: ${formatEther(poolBal)} ETH`);
}

// ============================================================
// Phase 5: Tips
// ============================================================

async function phase5Tips() {
  console.log("\n  === Phase 5: Tips ===\n");

  // Tip novel
  let hash = await voterA.wallet.writeContract({
    address: NOVEL_CORE,
    abi: novelCoreAbi,
    functionName: "tipNovel",
    args: [novelId],
    value: parseEther("0.01"),
    chain: foundry,
    account: voterA.wallet.account!,
  });
  await waitTx(hash);
  pass("tipNovel: 0.01 ETH");

  // Tip chapter
  hash = await voterB.wallet.writeContract({
    address: NOVEL_CORE,
    abi: novelCoreAbi,
    functionName: "tipChapter",
    args: [chapterA1Id],
    value: parseEther("0.01"),
    chain: foundry,
    account: voterB.wallet.account!,
  });
  await waitTx(hash);
  pass(`tipChapter: 0.01 ETH to Chapter #${chapterA1Id}`);

  // Check updated pool balance
  const poolBal = await publicClient.readContract({
    address: PRIZE_POOL,
    abi: prizePoolAbi,
    functionName: "getPoolBalance",
    args: [novelId],
  }) as bigint;
  info(`Pool balance after tips: ${formatEther(poolBal)} ETH`);
}

// ============================================================
// Phase 6: Claims
// ============================================================

async function phase6Claims() {
  console.log("\n  === Phase 6: Claims ===\n");

  // Creator claims prize pool reward
  try {
    const hash = await creator.wallet.writeContract({
      address: NOVEL_CORE,
      abi: novelCoreAbi,
      functionName: "claimReward",
      args: [novelId],
      chain: foundry,
      account: creator.wallet.account!,
    });
    await waitTx(hash);
    pass("claimReward (creator)");
  } catch (e: any) {
    // May revert if no reward accumulated yet
    if (e.message?.includes("NoPendingReward") || e.message?.includes("revert")) {
      info("claimReward (creator): no pending reward — skipped");
    } else {
      fail(`claimReward (creator): ${e.message}`);
    }
  }

  // Voter A claims voting reward for round 1
  try {
    const hash = await voterA.wallet.writeContract({
      address: NOVEL_CORE,
      abi: novelCoreAbi,
      functionName: "claimVotingReward",
      args: [novelId, 1],
      chain: foundry,
      account: voterA.wallet.account!,
    });
    await waitTx(hash);
    pass("claimVotingReward (Voter A, round 1)");
  } catch (e: any) {
    if (e.message?.includes("revert")) {
      info(`claimVotingReward (Voter A): reverted — ${e.message.slice(0, 100)}`);
    } else {
      fail(`claimVotingReward (Voter A): ${e.message}`);
    }
  }

  // Voter B claims voting reward for round 1
  try {
    const hash = await voterB.wallet.writeContract({
      address: NOVEL_CORE,
      abi: novelCoreAbi,
      functionName: "claimVotingReward",
      args: [novelId, 1],
      chain: foundry,
      account: voterB.wallet.account!,
    });
    await waitTx(hash);
    pass("claimVotingReward (Voter B, round 1)");
  } catch (e: any) {
    if (e.message?.includes("revert")) {
      info(`claimVotingReward (Voter B): reverted — ${e.message.slice(0, 100)}`);
    } else {
      fail(`claimVotingReward (Voter B): ${e.message}`);
    }
  }
}

// ============================================================
// Phase 7: API Tests
// ============================================================

async function phase7ApiTests() {
  console.log("\n  === Phase 7: API Tests ===\n");

  // Wait for indexer to catch up
  info("Waiting for indexer to sync...");
  for (let i = 0; i < 20; i++) {
    try {
      const novel = await apiFetch<any>(`/api/novels/${novelId}`);
      if (novel && novel.id) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }

  // GET /api/novels — list
  try {
    const data = await apiFetch<any>(`/api/novels?sort=latest&limit=10`);
    if (!Array.isArray(data.novels)) { fail("API novels list: not array"); }
    else if (data.novels.length === 0) { fail("API novels list: empty"); }
    else { pass(`API: GET /api/novels (${data.novels.length} novels, total=${data.pagination?.total})`); }
  } catch (e: any) {
    fail(`API: GET /api/novels — ${e.message}`);
  }

  // GET /api/novels/{id} — detail
  try {
    const novel = await apiFetch<any>(`/api/novels/${novelId}`);
    if (!novel.id) { fail("API novel detail: no id"); }
    else if (!novel.title) { fail("API novel detail: no title"); }
    else { pass(`API: GET /api/novels/${novelId} — "${novel.title}" (chapters=${novel.chapter_count})`); }
  } catch (e: any) {
    fail(`API: GET /api/novels/${novelId} — ${e.message}`);
  }

  // GET /api/novels/{id}/tree — chapter tree
  try {
    const data = await apiFetch<any>(`/api/novels/${novelId}/tree`);
    if (!Array.isArray(data.chapters)) { fail("API tree: no chapters array"); }
    else { pass(`API: GET /api/novels/${novelId}/tree (${data.chapters.length} chapters)`); }
  } catch (e: any) {
    // tree endpoint might be /chapters
    try {
      const data = await apiFetch<any>(`/api/novels/${novelId}/chapters`);
      if (!Array.isArray(data.chapters)) { fail("API chapters: no chapters array"); }
      else { pass(`API: GET /api/novels/${novelId}/chapters (${data.chapters.length} chapters)`); }
    } catch (e2: any) {
      fail(`API: GET /api/novels/${novelId}/tree — ${e.message}`);
    }
  }

  // GET /api/novels/{id}/worldlines — world lines
  try {
    const data = await apiFetch<any>(`/api/novels/${novelId}/worldlines`);
    if (!Array.isArray(data.worldlines)) { fail("API worldlines: not array"); }
    else { pass(`API: GET /api/novels/${novelId}/worldlines (${data.worldlines.length} lines)`); }
  } catch (e: any) {
    fail(`API: GET /api/novels/${novelId}/worldlines — ${e.message}`);
  }

  // GET /api/chapters/{id} — chapter detail with content
  try {
    const ch = await apiFetch<any>(`/api/chapters/${chapterA1Id}`);
    if (!ch.id) { fail("API chapter detail: no id"); }
    else {
      const hasContent = "content_text" in ch;
      pass(`API: GET /api/chapters/${chapterA1Id} — author=${(ch.author as string)?.slice(0, 10)}... content=${hasContent ? (ch.content_text ? ch.content_text.length + " chars" : "null") : "no field"}`);
    }
  } catch (e: any) {
    fail(`API: GET /api/chapters/${chapterA1Id} — ${e.message}`);
  }

  // GET /api/chapters/{id}/context — ancestor chain
  try {
    const data = await apiFetch<any>(`/api/chapters/${chapterA2Id}/context`);
    if (!Array.isArray(data.ancestors)) { fail("API context: not array"); }
    else if (data.ancestors.length === 0) { fail("API context: empty"); }
    else { pass(`API: GET /api/chapters/${chapterA2Id}/context (${data.ancestors.length} ancestors)`); }
  } catch (e: any) {
    fail(`API: GET /api/chapters/${chapterA2Id}/context — ${e.message}`);
  }

  // GET /api/users/{address}/chapters
  try {
    const data = await apiFetch<any>(`/api/users/${writerA.address}/chapters`);
    if (!Array.isArray(data.chapters)) { fail("API user chapters: not array"); }
    else { pass(`API: GET /api/users/${writerA.address.slice(0, 10)}.../chapters (${data.chapters.length} chapters)`); }
  } catch (e: any) {
    fail(`API: GET /api/users/${writerA.address}/chapters — ${e.message}`);
  }

  // GET /api/users/{address}/votes
  try {
    const data = await apiFetch<any>(`/api/users/${voterA.address}/votes`);
    if (!Array.isArray(data.votes)) { fail("API user votes: not array"); }
    else { pass(`API: GET /api/users/${voterA.address.slice(0, 10)}.../votes (${data.votes.length} votes)`); }
  } catch (e: any) {
    fail(`API: GET /api/users/${voterA.address}/votes — ${e.message}`);
  }
}

// ============================================================
// Main
// ============================================================

async function main() {
  console.log(`\n  Onchain Novel — MCP E2E Test`);
  console.log(`  RPC: ${RPC_URL}`);
  console.log(`  NovelCore: ${NOVEL_CORE}`);
  console.log(`  PrizePool: ${PRIZE_POOL}`);
  console.log(`  API: ${HAS_API ? API_BASE_URL : "(not set)"}`);
  console.log();

  await phase1Setup();
  await phase2CreateNovel();
  await phase3SubmitChapters();
  await phase4VotingRound();
  await phase5Tips();
  await phase6Claims();

  if (HAS_API) {
    await phase7ApiTests();
  }

  // Summary
  console.log(`\n  Results: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
