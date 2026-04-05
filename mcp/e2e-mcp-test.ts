/**
 * E2E MCP Integration Test
 *
 * Tests MCP utility functions and ABI interactions against a live Anvil node
 * with deployed contracts. Called from e2e-test.sh.
 *
 * Env vars expected: RPC_URL, NOVEL_CORE_ADDRESS, VOTING_ENGINE_ADDRESS,
 * PRIZE_POOL_ADDRESS, CHAPTER_NFT_ADDRESS, PRIVATE_KEY, MCP_NOVEL_ID,
 * PK_CREATOR, PK_WRITER_A, PK_WRITER_B, PK_VOTER_A, PK_VOTER_B, PK_KEEPER
 */

import {
  createPublicClient,
  createWalletClient,
  http,
  parseEther,
  formatEther,
  keccak256,
  encodePacked,
  toBytes,
  toHex,
  parseAbi,
  type PublicClient,
  type Transport,
  type Chain,
  type WalletClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import {
  novelCoreAbi as novelCoreAbiRaw,
  votingEngineAbi as votingEngineAbiRaw,
  prizePoolAbi as prizePoolAbiRaw,
  chapterNFTAbi as chapterNFTAbiRaw,
} from "./src/abi/index.js";
import { computeVotingRoundId } from "./src/utils/voting-round-id.js";

// Parse human-readable ABIs into viem ABI format
const novelCoreAbi = parseAbi(novelCoreAbiRaw);
const votingEngineAbi = parseAbi(votingEngineAbiRaw);
const prizePoolAbi = parseAbi(prizePoolAbiRaw);
const chapterNFTAbi = parseAbi(chapterNFTAbiRaw);

// ── Setup ──
const RPC_URL = process.env.RPC_URL!;
const NOVEL_CORE = process.env.NOVEL_CORE_ADDRESS! as `0x${string}`;
const VOTING_ENGINE = process.env.VOTING_ENGINE_ADDRESS! as `0x${string}`;
const PRIZE_POOL = process.env.PRIZE_POOL_ADDRESS! as `0x${string}`;
const CHAPTER_NFT = process.env.CHAPTER_NFT_ADDRESS! as `0x${string}`;
const NOVEL_ID = BigInt(process.env.MCP_NOVEL_ID!);

function makeClient(pk: string) {
  const account = privateKeyToAccount(pk as `0x${string}`);
  return {
    public: createPublicClient({ chain: foundry, transport: http(RPC_URL) }) as PublicClient<Transport, Chain>,
    wallet: createWalletClient({ account, chain: foundry, transport: http(RPC_URL) }),
    address: account.address,
  };
}

const creator = makeClient(process.env.PK_CREATOR!);
const writerA = makeClient(process.env.PK_WRITER_A!);
const writerB = makeClient(process.env.PK_WRITER_B!);
const voterA = makeClient(process.env.PK_VOTER_A!);
const voterB = makeClient(process.env.PK_VOTER_B!);
const keeper = makeClient(process.env.PK_KEEPER!);

const publicClient = creator.public;

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

async function waitTx(client: WalletClient, hash: `0x${string}`) {
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success") throw new Error(`Tx failed: ${hash}`);
  return receipt;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Tests ──

async function testReadNovel() {
  const novel = (await publicClient.readContract({
    address: NOVEL_CORE,
    abi: novelCoreAbi,
    functionName: "getNovel",
    args: [NOVEL_ID],
  })) as any;

  if (novel.id !== NOVEL_ID) return fail("getNovel: wrong ID");
  if (novel.creator.toLowerCase() !== creator.address.toLowerCase())
    return fail("getNovel: wrong creator");
  if (novel.active !== true) return fail("getNovel: not active");
  if (typeof novel.config.contentBaseUrl !== "string")
    return fail("getNovel: contentBaseUrl missing from ABI decode");
  pass("MCP ABI: getNovel (incl. contentBaseUrl)");
}

async function testReadWorldLines() {
  const worldLines = (await publicClient.readContract({
    address: NOVEL_CORE,
    abi: novelCoreAbi,
    functionName: "getActiveWorldLines",
    args: [NOVEL_ID],
  })) as bigint[];

  if (worldLines.length === 0) return fail("getActiveWorldLines: empty");
  pass(`MCP ABI: getActiveWorldLines (${worldLines.length} lines)`);
  return worldLines;
}

async function testSubmitChapter(
  client: ReturnType<typeof makeClient>,
  parentId: bigint,
  content: string,
  label: string
) {
  const contentBytes = toBytes(content);
  const contentHex = toHex(contentBytes);
  const contentHash = keccak256(contentHex);
  const declaredLength = BigInt(contentBytes.length);

  // Read stake amount
  const novel = (await publicClient.readContract({
    address: NOVEL_CORE,
    abi: novelCoreAbi,
    functionName: "getNovel",
    args: [NOVEL_ID],
  })) as any;

  const submission = {
    contentHash,
    declaredLength,
    content: contentHex,
  };

  const hash = await client.wallet.writeContract({
    address: NOVEL_CORE,
    abi: novelCoreAbi,
    functionName: "submitChapter",
    args: [NOVEL_ID, parentId, submission],
    value: novel.config.stakeAmount,
  });
  await waitTx(client.wallet, hash);
  pass(`MCP ABI: submitChapter (${label})`);
}

async function testVotingRoundId() {
  // Verify our TS computation matches what the contract would produce
  const id = computeVotingRoundId(NOVEL_ID, 1, 1, false);
  if (id === 0n) return fail("computeVotingRoundId returned 0");
  pass(`MCP util: computeVotingRoundId = ${id.toString().slice(0, 20)}...`);
  return id;
}

async function testCommitVote(
  client: ReturnType<typeof makeClient>,
  votingRoundId: bigint,
  candidateId: bigint,
  salt: `0x${string}`,
  stakeEth: string,
  label: string
) {
  const commitHash = keccak256(
    encodePacked(["uint256", "bytes32"], [candidateId, salt])
  );

  const hash = await client.wallet.writeContract({
    address: VOTING_ENGINE,
    abi: votingEngineAbi,
    functionName: "commitVote",
    args: [NOVEL_ID, votingRoundId, commitHash],
    value: parseEther(stakeEth),
  });
  await waitTx(client.wallet, hash);
  pass(`MCP ABI: commitVote (${label})`);
}

async function testRevealVote(
  client: ReturnType<typeof makeClient>,
  votingRoundId: bigint,
  candidateId: bigint,
  salt: `0x${string}`,
  label: string
) {
  const hash = await client.wallet.writeContract({
    address: VOTING_ENGINE,
    abi: votingEngineAbi,
    functionName: "revealVote",
    args: [NOVEL_ID, votingRoundId, candidateId, salt],
  });
  await waitTx(client.wallet, hash);
  pass(`MCP ABI: revealVote (${label})`);
}

async function testKeeperTransition(
  fn: string,
  label: string
) {
  const hash = await keeper.wallet.writeContract({
    address: NOVEL_CORE,
    abi: novelCoreAbi,
    functionName: fn as any,
    args: [NOVEL_ID],
  });
  await waitTx(keeper.wallet, hash);
  pass(`MCP ABI: ${fn} (${label})`);
}

async function testGetCandidates(votingRoundId: bigint) {
  const candidates = (await publicClient.readContract({
    address: VOTING_ENGINE,
    abi: votingEngineAbi,
    functionName: "getCandidates",
    args: [NOVEL_ID, votingRoundId],
  })) as bigint[];

  if (candidates.length === 0) return fail("getCandidates: empty");
  pass(`MCP ABI: getCandidates (${candidates.length} candidates)`);
  return candidates;
}

async function testPoolBalance() {
  const balance = (await publicClient.readContract({
    address: PRIZE_POOL,
    abi: prizePoolAbi,
    functionName: "getPoolBalance",
    args: [NOVEL_ID],
  })) as bigint;

  pass(`MCP ABI: getPoolBalance = ${formatEther(balance)} ETH`);
  return balance;
}

async function testTipNovel() {
  const hash = await voterB.wallet.writeContract({
    address: PRIZE_POOL,
    abi: prizePoolAbi,
    functionName: "tipNovel",
    args: [NOVEL_ID],
    value: parseEther("0.01"),
  });
  await waitTx(voterB.wallet, hash);
  pass("MCP ABI: tipNovel");
}

async function testGetClaimableStake() {
  const claimable = (await publicClient.readContract({
    address: NOVEL_CORE,
    abi: novelCoreAbi,
    functionName: "getClaimableStake",
    args: [NOVEL_ID, writerA.address],
  })) as bigint;

  pass(`MCP ABI: getClaimableStake = ${formatEther(claimable)} ETH`);
}

async function testClaimStakeRefund() {
  const hash = await writerA.wallet.writeContract({
    address: NOVEL_CORE,
    abi: novelCoreAbi,
    functionName: "claimStakeRefund",
    args: [NOVEL_ID],
  });
  await waitTx(writerA.wallet, hash);
  pass("MCP ABI: claimStakeRefund");
}

async function testGetPendingReward() {
  const reward = (await publicClient.readContract({
    address: PRIZE_POOL,
    abi: prizePoolAbi,
    functionName: "getPendingReward",
    args: [NOVEL_ID, creator.address],
  })) as bigint;

  pass(`MCP ABI: getPendingReward (creator) = ${formatEther(reward)} ETH`);
}

async function testClaimReward() {
  const reward = (await publicClient.readContract({
    address: PRIZE_POOL,
    abi: prizePoolAbi,
    functionName: "getPendingReward",
    args: [NOVEL_ID, creator.address],
  })) as bigint;

  if (reward === 0n) {
    info("No reward to claim for creator (prize pool may be empty)");
    return;
  }

  const hash = await creator.wallet.writeContract({
    address: PRIZE_POOL,
    abi: prizePoolAbi,
    functionName: "claimReward",
    args: [NOVEL_ID],
  });
  await waitTx(creator.wallet, hash);
  pass("MCP ABI: claimReward");
}

async function testClaimVotingReward(votingRoundId: bigint) {
  // Sweep first
  const sweepHash = await keeper.wallet.writeContract({
    address: VOTING_ENGINE,
    abi: votingEngineAbi,
    functionName: "sweepUnrevealedStakes",
    args: [NOVEL_ID, votingRoundId],
  });
  await waitTx(keeper.wallet, sweepHash);
  pass("MCP ABI: sweepUnrevealedStakes");

  const hash = await voterA.wallet.writeContract({
    address: VOTING_ENGINE,
    abi: votingEngineAbi,
    functionName: "claimVotingReward",
    args: [NOVEL_ID, votingRoundId],
  });
  await waitTx(voterA.wallet, hash);
  pass("MCP ABI: claimVotingReward");
}

async function testGetChapter() {
  const chapter = (await publicClient.readContract({
    address: NOVEL_CORE,
    abi: novelCoreAbi,
    functionName: "getChapter",
    args: [NOVEL_ID + 2n], // First submitted chapter in novel 2
  })) as any;

  if (chapter.id === 0n) return fail("getChapter: not found");
  pass(`MCP ABI: getChapter #${chapter.id}`);
}

// ── Main ──
async function main() {
  console.log("\n  MCP Integration Tests (Novel #" + NOVEL_ID + ")\n");

  // Phase 1: Read operations on novel
  await testReadNovel();
  const worldLines = await testReadWorldLines();
  const parentId = worldLines![0];

  // Phase 2: Writer submissions via MCP ABI
  await testSubmitChapter(writerA, parentId, "MCP Writer A chapter content for testing the full flow end to end, must be at least 100 bytes long so padding here.", "writer A");
  await testSubmitChapter(writerB, parentId, "MCP Writer B chapter content for testing the full flow end to end, must be at least 100 bytes long so padding here.", "writer B");

  // Phase 3: Keeper transitions + Voting via MCP ABI
  await sleep(3000);
  await testKeeperTransition("closeSubmissions", "→ Committing");

  const votingRoundId = await testVotingRoundId();

  await testGetCandidates(votingRoundId!);

  // Both voters vote for the same candidate (first submitted chapter after genesis)
  const submissions = (await publicClient.readContract({
    address: NOVEL_CORE,
    abi: novelCoreAbi,
    functionName: "getRoundSubmissions",
    args: [NOVEL_ID, 1, 1],
  })) as bigint[];
  info(`Round submissions: ${submissions.join(", ")}`);

  const targetCandidate = submissions[0]; // writer A's chapter
  const saltA = "0x0000000000000000000000000000000000000000000000000000000000aabbcc" as `0x${string}`;
  const saltB = "0x0000000000000000000000000000000000000000000000000000000000ddeeff" as `0x${string}`;

  await testCommitVote(voterA, votingRoundId!, targetCandidate, saltA, "0.05", "voter A");
  await testCommitVote(voterB, votingRoundId!, targetCandidate, saltB, "0.1", "voter B");

  await sleep(3000);
  await testKeeperTransition("closeCommit", "→ Revealing");

  await testRevealVote(voterA, votingRoundId!, targetCandidate, saltA, "voter A");
  await testRevealVote(voterB, votingRoundId!, targetCandidate, saltB, "voter B");

  await sleep(3000);
  await testKeeperTransition("settleRound", "→ Epoch voting");

  // Phase 4: Epoch voting
  const epochVotingId = computeVotingRoundId(NOVEL_ID, 1, 1, true);
  const epochCandidates = await testGetCandidates(epochVotingId);
  info(`Epoch candidates: ${epochCandidates!.join(", ")}`);

  const epochTarget = epochCandidates![0];
  const eSaltA = "0x00000000000000000000000000000000000000000000000000000000000e0001" as `0x${string}`;
  const eSaltB = "0x00000000000000000000000000000000000000000000000000000000000e0002" as `0x${string}`;

  await testCommitVote(voterA, epochVotingId, epochTarget, eSaltA, "0.05", "epoch voter A");
  await testCommitVote(voterB, epochVotingId, epochTarget, eSaltB, "0.1", "epoch voter B");

  await sleep(3000);
  await testKeeperTransition("closeEpochCommit", "→ Epoch Revealing");

  await testRevealVote(voterA, epochVotingId, epochTarget, eSaltA, "epoch voter A");
  await testRevealVote(voterB, epochVotingId, epochTarget, eSaltB, "epoch voter B");

  await sleep(3000);
  await testKeeperTransition("settleEpoch", "Canon + NFTs + Rewards");

  // Phase 5: Post-settlement reads and claims
  await testPoolBalance();
  await testGetPendingReward();
  await testTipNovel();
  await testGetClaimableStake();
  await testClaimStakeRefund();
  await testClaimReward();
  await testClaimVotingReward(votingRoundId!);
  await testGetChapter();

  // Summary
  console.log(`\n  Results: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
