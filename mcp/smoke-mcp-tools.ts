/**
 * MCP Tool Smoke Test
 *
 * Spawns the MCP server as a subprocess and exercises the tool layer via the
 * MCP SDK client. Verifies the new flows added per docs/cli.md + docs/backend.md:
 *
 *   - novel_create (voteStake <= submissionFee invariant)
 *   - chapter_submit
 *   - chapter_comment + chapter_comments (off-chain EIP-191 signed)
 *   - vote_commit (auto-salt + keeper-assisted submission)
 *   - vote_reveal (salt fallback from local store)
 *
 * Env vars (set by smoke-test.sh wrapper):
 *   RPC_URL, NOVEL_CORE_ADDRESS, VOTING_ENGINE_ADDRESS, PRIZE_POOL_ADDRESS,
 *   BOUNTY_BOARD_ADDRESS, RULES_ENGINE_ADDRESS, API_BASE_URL,
 *   PK_CREATOR, PK_WRITER_A, PK_VOTER_A, PK_KEEPER
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const RPC_URL = process.env.RPC_URL!;
const NOVEL_CORE = process.env.NOVEL_CORE_ADDRESS!;
const VOTING_ENGINE = process.env.VOTING_ENGINE_ADDRESS!;
const PRIZE_POOL = process.env.PRIZE_POOL_ADDRESS!;
const BOUNTY_BOARD = process.env.BOUNTY_BOARD_ADDRESS!;
const RULES_ENGINE = process.env.RULES_ENGINE_ADDRESS!;
const API_BASE_URL = process.env.API_BASE_URL || "";

const PK_CREATOR = process.env.PK_CREATOR!;
const PK_WRITER_A = process.env.PK_WRITER_A!;
const PK_VOTER_A = process.env.PK_VOTER_A!;
const PK_KEEPER = process.env.PK_KEEPER!;

const ADDR_VOTER_A = "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65";

let passed = 0;
let failed = 0;
const pass = (m: string) => { passed++; console.log(`  \x1b[32m[PASS]\x1b[0m ${m}`); };
const fail = (m: string) => { failed++; console.log(`  \x1b[31m[FAIL]\x1b[0m ${m}`); };
const info = (m: string) => console.log(`  \x1b[33m[INFO]\x1b[0m ${m}`);

const SERVER_BIN = join(import.meta.dirname ?? new URL(".", import.meta.url).pathname, "dist", "index.js");

// HOME isolation so we don't clobber the user's vote-salts.json
const SMOKE_HOME = mkdtempSync(join(tmpdir(), "mcp-smoke-"));

function envFor(pk: string): Record<string, string> {
  return {
    RPC_URL,
    NOVEL_CORE_ADDRESS: NOVEL_CORE,
    VOTING_ENGINE_ADDRESS: VOTING_ENGINE,
    PRIZE_POOL_ADDRESS: PRIZE_POOL,
    BOUNTY_BOARD_ADDRESS: BOUNTY_BOARD,
    RULES_ENGINE_ADDRESS: RULES_ENGINE,
    API_BASE_URL,
    PRIVATE_KEY: pk,
    HOME: SMOKE_HOME,
    PATH: process.env.PATH ?? "",
  };
}

async function withClient<T>(pk: string, fn: (client: Client) => Promise<T>): Promise<T> {
  const transport = new StdioClientTransport({
    command: "node",
    args: [SERVER_BIN],
    env: envFor(pk),
  });
  const client = new Client({ name: "smoke-test", version: "0.0.0" }, { capabilities: {} });
  await client.connect(transport);
  try {
    return await fn(client);
  } finally {
    await client.close();
  }
}

function callText(result: any): string {
  const c = result.content;
  if (Array.isArray(c) && c.length > 0 && typeof c[0]?.text === "string") {
    return c[0].text as string;
  }
  return JSON.stringify(result);
}

function advanceTime(seconds: number): void {
  execSync(
    `cast rpc evm_increaseTime ${seconds} --rpc-url ${RPC_URL}`,
    { stdio: "ignore" },
  );
  execSync(`cast rpc evm_mine --rpc-url ${RPC_URL}`, { stdio: "ignore" });
}

async function waitForApiNovel(novelId: number, timeoutSec = 15): Promise<void> {
  for (let i = 0; i < timeoutSec; i++) {
    try {
      const res = await fetch(`${API_BASE_URL}/api/novels/${novelId}`);
      if (res.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`API novel ${novelId} did not appear in ${timeoutSec}s`);
}

async function main() {
  console.log("\n  MCP Tool Smoke Test\n");

  if (!existsSync(SERVER_BIN)) {
    console.error(`MCP server bin not found at ${SERVER_BIN}. Run 'npm run build' first.`);
    process.exit(1);
  }

  // ============================================================
  // novel_create with new config flags
  // ============================================================
  console.log("\n  === novel_create ===");
  const rootContent =
    "Genesis chapter long enough to satisfy the minChapterLength floor. " +
    "A decentralized story begins with this initial spark of inspiration that will be expanded upon by future authors.";

  await withClient(PK_CREATOR, async (client) => {
    const res = await client.callTool({
      name: "novel_create",
      arguments: {
        title: "MCP Smoke Test",
        description: "smoke",
        coverUri: "",
        rootContent,
        minChapterLength: 100,
        maxChapterLength: 50000,
        submissionFee: "0.001",
        worldLineCount: 2,
        voteStake: "0.001",
        nominationFee: "0.1",
        nominateDuration: 5,
        commitDuration: 5,
        revealDuration: 5,
        minRoundGap: 5,
        prizeReleaseRate: 2000,
        voterRewardRate: 500,
        ruleFee: "0.01",
        ruleVoteDuration: 60,
        ruleQuorum: 1,
        initialPrizeEth: "0.1",
      },
    });
    const text = callText(res);
    if (text.includes("Novel created")) pass(`novel_create -> ${text.split("\n")[0]}`);
    else fail(`novel_create unexpected: ${text}`);
  });

  await waitForApiNovel(1);
  pass("indexer picked up novel #1");

  // ============================================================
  // chapter_submit (two children of root for round-1 candidates)
  // ============================================================
  console.log("\n  === chapter_submit ===");
  await withClient(PK_WRITER_A, async (client) => {
    const res = await client.callTool({
      name: "chapter_submit",
      arguments: {
        novelId: 1,
        parentId: 1,
        content:
          "A child chapter that is comfortably longer than the minimum chapter length floor and adds detail to the story so far.",
      },
    });
    const text = callText(res);
    if (text.includes("Chapter submitted")) pass("chapter_submit (writer A)");
    else fail(`chapter_submit: ${text}`);
  });

  await withClient(PK_KEEPER, async (client) => {
    const res = await client.callTool({
      name: "chapter_submit",
      arguments: {
        novelId: 1,
        parentId: 1,
        content:
          "A second child chapter on a different branch with enough characters to satisfy the minimum chapter length floor in the config.",
      },
    });
    const text = callText(res);
    if (text.includes("Chapter submitted")) pass("chapter_submit (second branch)");
    else fail(`chapter_submit second: ${text}`);
  });

  // ============================================================
  // chapter_comment + chapter_comments
  // ============================================================
  console.log("\n  === chapter_comment / chapter_comments ===");
  await withClient(PK_VOTER_A, async (client) => {
    const post = await client.callTool({
      name: "chapter_comment",
      arguments: { chapterId: 2, content: "Great chapter, looking forward to more" },
    });
    const text = callText(post);
    if (text.includes("Comment posted")) pass(`chapter_comment -> ${text}`);
    else fail(`chapter_comment: ${text}`);

    const list = await client.callTool({
      name: "chapter_comments",
      arguments: { chapterId: 2 },
    });
    const listText = callText(list);
    if (listText.includes("Great chapter")) pass("chapter_comments lists posted comment");
    else fail(`chapter_comments: ${listText}`);
  });

  // ============================================================
  // Round 1: vote_start -> close_nomination -> vote_commit (auto salt) ->
  //          close_commit -> vote_reveal (local backup)
  // ============================================================
  console.log("\n  === voting cycle ===");

  advanceTime(10);
  await withClient(PK_KEEPER, async (client) => {
    // The MCP exposes vote_start; closeNomination/closeCommit are not in tools
    // (per design they are keeper-only; we drive them via cast for the test).
    const res = await client.callTool({ name: "vote_start", arguments: { novelId: 1 } });
    const text = callText(res);
    if (text.includes("Round started")) pass("vote_start");
    else fail(`vote_start: ${text}`);
  });

  advanceTime(10);
  // closeNomination via cast (no MCP tool for this)
  execSync(
    `cast send --rpc-url ${RPC_URL} --private-key ${PK_KEEPER} ${NOVEL_CORE} "closeNomination(uint64)" 1`,
    { stdio: "ignore" },
  );
  pass("closeNomination via cast");

  // vote_commit with auto-salt + keeper-assisted submission
  await withClient(PK_VOTER_A, async (client) => {
    const res = await client.callTool({
      name: "vote_commit",
      arguments: { novelId: 1, candidateId: 2, keeperAssisted: true },
    });
    const text = callText(res);
    if (text.includes("Vote committed")) pass("vote_commit (auto-salt)");
    else fail(`vote_commit: ${text}`);
    if (text.includes("Salt saved")) pass("vote_commit persisted local backup");
    else fail(`vote_commit local backup line missing: ${text}`);
    if (text.includes("Keeper will auto-reveal")) pass("vote_commit submitted keeper-assisted reveal");
    else fail(`vote_commit keeper line missing: ${text}`);
  });

  // Verify pending_votes row in DB (via psql, cheap and reliable)
  const pgUrl = process.env.DATABASE_URL!;
  const pendingCount = execSync(
    `psql -t -A -d "${pgUrl}" -c "SELECT COUNT(*) FROM pending_votes WHERE novel_id = 1 AND round = 1 AND LOWER(voter) = LOWER('${ADDR_VOTER_A}') AND status = 'committed'"`,
  ).toString().trim();
  if (pendingCount === "1") pass("pending_votes row created in DB");
  else fail(`pending_votes count expected 1, got ${pendingCount}`);

  advanceTime(10);
  execSync(
    `cast send --rpc-url ${RPC_URL} --private-key ${PK_KEEPER} ${NOVEL_CORE} "closeCommit(uint64)" 1`,
    { stdio: "ignore" },
  );
  pass("closeCommit via cast");

  // vote_reveal without salt - falls back to local backup
  await withClient(PK_VOTER_A, async (client) => {
    const res = await client.callTool({
      name: "vote_reveal",
      arguments: { novelId: 1, candidateId: 2 },
    });
    const text = callText(res);
    if (text.includes("Vote revealed")) pass("vote_reveal (local salt fallback)");
    else fail(`vote_reveal: ${text}`);
  });

  // Cleanup HOME isolation
  rmSync(SMOKE_HOME, { recursive: true, force: true });

  console.log(`\n  Results: ${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error("Fatal:", e);
  rmSync(SMOKE_HOME, { recursive: true, force: true });
  process.exit(1);
});
