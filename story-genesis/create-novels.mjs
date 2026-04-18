#!/usr/bin/env node
/**
 * Create all story-genesis novels on the local Anvil chain.
 *
 * Usage:
 *   node story-genesis/create-novels.mjs
 *
 * Requirements:
 *   - Local stack running (./scripts/dev.sh start)
 *   - Node.js with access to viem (resolved from web/frontend/node_modules)
 *   - yaml parser (from root devDependencies)
 *
 * Reads RPC URL and contract addresses from config.yaml (the same single
 * source of truth the rest of the codebase uses).
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
} = require("viem");
const { privateKeyToAccount } = require("viem/accounts");
const { foundry } = require("viem/chains");

import { readFileSync, readdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import YAML from "yaml";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

// ── Config ──────────────────────────────────────────────────────────────────
const configPath = process.env.ONCHAIN_NOVEL_CONFIG || join(ROOT, "config.yaml");
const cfg = YAML.parse(readFileSync(configPath, "utf-8"));

const RPC_URL = cfg.chain.rpcUrl;
// Anvil test account #1 — deterministic, safe to hardcode for local dev.
const PRIVATE_KEY =
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";

const COVER_BASE_URL =
  "https://raw.githubusercontent.com/AshinGau/onchain-novel/refs/heads/main/story-genesis/images";

const NOVEL_CORE = cfg.contracts.novelCore;
const RULES_ENGINE = cfg.contracts.rulesEngine;

if (!NOVEL_CORE || !RULES_ENGINE) {
  console.error("contracts.novelCore / contracts.rulesEngine empty in config.yaml — run ./scripts/dev.sh start first");
  process.exit(1);
}

// ── ABI fragments ───────────────────────────────────────────────────────────
const novelCoreAbi = parseAbi([
  "function createNovel((uint64 minChapterLength, uint64 maxChapterLength, uint256 submissionFee, uint32 worldLineCount, uint256 voteStake, uint256 nominationFee, uint64 nominateDuration, uint64 commitDuration, uint64 revealDuration, uint64 minRoundGap, uint16 prizeReleaseRate, uint16 voterRewardRate, uint8 contentLocation, string contentBaseUrl, uint256 ruleFee, uint64 ruleVoteDuration, uint32 ruleQuorum) config, (string title, string description, string coverUri) metadata, (bytes32 contentHash, uint64 declaredLength, bytes content) rootChapter) external payable returns (uint64 novelId)",
  "function submitChapter(uint64 novelId, uint64 parentId, (bytes32 contentHash, uint64 declaredLength, bytes content) submission) external payable returns (uint64 chapterId)",
  "event ChapterSubmitted(uint64 indexed novelId, uint64 indexed chapterId, address indexed author, uint64 parentId, uint32 depth)",
]);

const rulesEngineAbi = parseAbi([
  "function setCreatorRules(uint64 novelId, string[] names, string[] contents) external",
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
  // Strip leading "NN-" prefix
  return dirName.replace(/^\d+-/, "");
}

function numberFromDir(dirName) {
  const m = dirName.match(/^(\d+)-/);
  return m ? m[1] : null;
}

function coverUriForDir(dirName) {
  const num = numberFromDir(dirName);
  if (!num) return "";
  const file = join(__dirname, "images", `${num}.jpeg`);
  return existsSync(file) ? `${COVER_BASE_URL}/${num}.jpeg` : "";
}

// ChapterSubmitted(uint64 indexed novelId, uint64 indexed chapterId, address indexed author, ...)
// topics: [sig, novelId, chapterId, author]
function findChapterSubmittedLog(receipt) {
  return receipt.logs.find(
    (l) =>
      l.address.toLowerCase() === NOVEL_CORE.toLowerCase() &&
      l.topics.length >= 4
  );
}

function parseCreateReceipt(receipt) {
  // NovelCreated(uint64 indexed novelId, address indexed creator) → topics.length === 3
  const novelLog = receipt.logs.find(
    (l) =>
      l.address.toLowerCase() === NOVEL_CORE.toLowerCase() &&
      l.topics.length === 3
  );
  const chLog = findChapterSubmittedLog(receipt);
  return {
    novelId: novelLog ? BigInt(novelLog.topics[1]) : null,
    rootId: chLog ? BigInt(chLog.topics[2]) : null,
  };
}

async function submitChapterTx(client, publicClient, novelId, parentId, submission, submissionFee) {
  const hash = await client.writeContract({
    address: NOVEL_CORE,
    abi: novelCoreAbi,
    functionName: "submitChapter",
    args: [novelId, parentId, submission],
    value: submissionFee,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  const chLog = findChapterSubmittedLog(receipt);
  if (!chLog) throw new Error(`No ChapterSubmitted event in tx ${hash}`);
  return BigInt(chLog.topics[2]);
}

// ── Novel config (post-2026-04-13 simplification: 17 fields) ───────────────
const defaultConfig = {
  minChapterLength: 1000n,
  maxChapterLength: 50000n,
  submissionFee: parseEther("0.005"),
  worldLineCount: 2,
  voteStake: parseEther("0.001"), // must be <= submissionFee
  nominationFee: parseEther("0.01"),
  nominateDuration: 86400n,  // 1 day
  commitDuration: 259200n,   // 3 days
  revealDuration: 172800n,   // 2 days
  minRoundGap: 172800n,      // 2 days
  prizeReleaseRate: 2000,    // 20%
  voterRewardRate: 1500,     // 15%
  contentLocation: 0,        // Onchain
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

    const rootChapter = encodeChapter(ch1);
    const prizePool = randomPrizePool();
    const coverUri = coverUriForDir(dir);
    const metadata = { title, description, coverUri };

    const coverTag = coverUri ? "🖼" : "  ";
    console.log(
      `${coverTag} Creating: ${title}  (prize: ${Number(prizePool / 10n ** 18n)} ETH)`
    );

    // 1. createNovel (root chapter, must send submissionFee + initial prize pool)
    const totalValue = defaultConfig.submissionFee + prizePool;
    const createTx = await client.writeContract({
      address: NOVEL_CORE,
      abi: novelCoreAbi,
      functionName: "createNovel",
      args: [defaultConfig, metadata, rootChapter],
      value: totalValue,
    });
    const createReceipt = await publicClient.waitForTransactionReceipt({
      hash: createTx,
    });

    const { novelId, rootId } = parseCreateReceipt(createReceipt);
    if (!novelId || !rootId) {
      console.error(`  ✗ Failed to extract novelId/rootId from tx ${createTx}`);
      continue;
    }
    console.log(`  ✓ Novel #${novelId} created, root chapter #${rootId} (tx: ${createTx.slice(0, 10)}…)`);

    // 2. submitChapter #2 (parent = root)
    const ch2Id = await submitChapterTx(
      client, publicClient, novelId, rootId, encodeChapter(ch2),
      defaultConfig.submissionFee,
    );
    console.log(`  ✓ Chapter #${ch2Id} submitted (parent #${rootId})`);

    // 3. submitChapter #3 (parent = ch2)
    const ch3Id = await submitChapterTx(
      client, publicClient, novelId, ch2Id, encodeChapter(ch3),
      defaultConfig.submissionFee,
    );
    console.log(`  ✓ Chapter #${ch3Id} submitted (parent #${ch2Id})`);

    // 4. setCreatorRules
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
