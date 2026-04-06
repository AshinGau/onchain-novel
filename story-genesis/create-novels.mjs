#!/usr/bin/env node
/**
 * Create all 34 story-genesis novels on the local Anvil chain.
 *
 * Usage:
 *   node story-genesis/create-novels.mjs
 *
 * Requirements:
 *   - Local node running (./script/local-node.sh start)
 *   - Node.js with access to viem (resolved from web/frontend/node_modules)
 */

import { createRequire } from "module";
const require = createRequire(
  new URL("../web/frontend/package.json", import.meta.url)
);

const {
  createWalletClient,
  createPublicClient,
  http,
  parseEther,
  keccak256,
  toHex,
  parseAbi,
  encodeFunctionData,
} = require("viem");
const { privateKeyToAccount } = require("viem/accounts");
const { foundry } = require("viem/chains");

import { readFileSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

// ── Config ──────────────────────────────────────────────────────────────────
const RPC_URL = "http://127.0.0.1:8545";
const PRIVATE_KEY =
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";

// Read contract addresses from .local-node/env
const envFile = readFileSync(join(ROOT, ".local-node/env"), "utf-8");
const env = Object.fromEntries(
  envFile
    .split("\n")
    .filter((l) => l.includes("="))
    .map((l) => l.split("="))
);
const NOVEL_CORE = env.NOVEL_CORE_ADDRESS;
const RULES_ENGINE = env.RULES_ENGINE_ADDRESS;

// ── ABI fragments ───────────────────────────────────────────────────────────
const novelCoreAbi = parseAbi([
  "function createNovel((uint64 minChapterLength, uint64 maxChapterLength, uint64 roundMinDuration, uint32 roundMinSubmissions, uint32 worldLineCount, uint32 roundsPerEpoch, uint16 prizeReleaseRate, uint16 voterRewardRate, uint64 commitDuration, uint64 revealDuration, uint256 stakeAmount, uint8 spamRounds, uint8 spamThreshold, uint8 contentLocation, string contentBaseUrl, uint256 ruleFee, uint64 ruleVoteDuration, uint32 ruleQuorum) config, (string title, string description, string coverUri) metadata, (bytes32 contentHash, uint64 declaredLength, bytes content)[] bootstrapChapters) external payable returns (uint256 novelId)",
]);

const rulesEngineAbi = parseAbi([
  "function setCreatorRules(uint256 novelId, string[] names, string[] contents) external",
]);

// ── Helpers ─────────────────────────────────────────────────────────────────
function encodeChapter(text) {
  const contentBytes = new TextEncoder().encode(text);
  const contentHex = toHex(contentBytes);
  const contentHash = keccak256(contentHex);
  const declaredLength = BigInt(contentBytes.length);
  return { contentHash, declaredLength, content: contentHex };
}

function randomPrizePool() {
  // Random 1-10 ETH (integer)
  const eth = Math.floor(Math.random() * 10) + 1;
  return parseEther(eth.toString());
}

function titleFromDir(dirName) {
  // Strip leading "01-" prefix
  return dirName.replace(/^\d+-/, "");
}

// ── Default novel config (matches frontend defaults) ────────────────────────
const defaultConfig = {
  minChapterLength: 500n,
  maxChapterLength: 50000n,
  roundMinDuration: 86400n, // 1 day
  roundMinSubmissions: 3,
  worldLineCount: 2,
  roundsPerEpoch: 3,
  prizeReleaseRate: 3000, // 30%
  voterRewardRate: 1000, // 10%
  commitDuration: 259200n, // 3 days
  revealDuration: 172800n, // 2 days
  stakeAmount: parseEther("0.01"),
  spamRounds: 3,
  spamThreshold: 20,
  contentLocation: 0, // Onchain
  contentBaseUrl: "",
  ruleFee: parseEther("0.001"),
  ruleVoteDuration: 259200n, // 3 days
  ruleQuorum: 7,
};

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  const account = privateKeyToAccount(PRIVATE_KEY);
  const client = createWalletClient({
    account,
    chain: foundry,
    transport: http(RPC_URL),
  });
  const publicClient = createPublicClient({
    chain: foundry,
    transport: http(RPC_URL),
  });

  console.log(`Wallet: ${account.address}`);
  console.log(`NovelCore: ${NOVEL_CORE}`);
  console.log(`RulesEngine: ${RULES_ENGINE}\n`);

  // Discover novel directories (sorted)
  const dirs = readdirSync(__dirname)
    .filter((d) => /^\d{2}-/.test(d))
    .sort();

  console.log(`Found ${dirs.length} novels to create.\n`);

  for (const dir of dirs) {
    const base = join(__dirname, dir);
    const title = titleFromDir(dir);
    const description = readFileSync(join(base, "description.md"), "utf-8").trim();
    const rules = readFileSync(join(base, "rules.md"), "utf-8").trim();
    const ch1 = readFileSync(join(base, "chapter-1.txt"), "utf-8");
    const ch2 = readFileSync(join(base, "chapter-2.txt"), "utf-8");
    const ch3 = readFileSync(join(base, "chapter-3.txt"), "utf-8");

    const bootstrapChapters = [ch1, ch2, ch3].map(encodeChapter);
    const prizePool = randomPrizePool();
    const metadata = { title, description, coverUri: "" };

    console.log(
      `Creating: ${title}  (prize: ${Number(prizePool / 10n ** 18n)} ETH)`
    );

    // 1. createNovel
    const txHash = await client.writeContract({
      address: NOVEL_CORE,
      abi: novelCoreAbi,
      functionName: "createNovel",
      args: [defaultConfig, metadata, bootstrapChapters],
      value: prizePool,
    });

    const receipt = await publicClient.waitForTransactionReceipt({
      hash: txHash,
    });

    // Extract novelId from logs (NovelCreated event from NovelCore contract)
    // NovelCreated(uint256 indexed novelId, address indexed creator, uint8 contentLocation)
    const creationLog = receipt.logs.find(
      (l) =>
        l.address.toLowerCase() === NOVEL_CORE.toLowerCase() &&
        l.topics.length >= 3
    );
    const novelId = creationLog
      ? BigInt(creationLog.topics[1])
      : null;

    if (!novelId) {
      console.error(`  ✗ Failed to extract novelId from tx ${txHash}`);
      continue;
    }

    console.log(`  ✓ Novel #${novelId} created (tx: ${txHash.slice(0, 10)}…)`);

    // 2. setCreatorRules
    const rulesTxHash = await client.writeContract({
      address: RULES_ENGINE,
      abi: rulesEngineAbi,
      functionName: "setCreatorRules",
      args: [novelId, ["story setting"], [rules]],
    });

    await publicClient.waitForTransactionReceipt({ hash: rulesTxHash });
    console.log(`  ✓ Rules set (tx: ${rulesTxHash.slice(0, 10)}…)\n`);
  }

  console.log("Done! All novels created.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
