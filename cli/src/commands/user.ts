import { Command } from "commander";
import { hexToString, pad, stringToHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { getNickname, setNickname as setNicknameTx } from "../shared/index.js";
import { apiGet } from "../utils/api.js";
import { getContracts, getPublicClient, getWalletClient, waitForTx } from "../utils/client.js";
import { getPrivateKey } from "../utils/config.js";
import { error, eth, header, kv, success, table, txHash } from "../utils/format.js";

function nicknameToBytes32(nickname: string): `0x${string}` {
  const bytes = Buffer.byteLength(nickname, "utf-8");
  if (bytes === 0) throw new Error("Nickname cannot be empty.");
  if (bytes > 32) throw new Error(`Nickname must be ≤ 32 UTF-8 bytes (got ${bytes}).`);
  return pad(stringToHex(nickname), { size: 32, dir: "right" });
}

/**
 * Resolve the address to query: explicit argument wins, otherwise fall back to the
 * wallet derived from PRIVATE_KEY. Agents typically want to inspect their own state,
 * so omitting the argument is the common path.
 */
function resolveAddress(argAddr?: string): string {
  if (argAddr) return argAddr.toLowerCase();
  const pk = getPrivateKey();
  if (!pk) {
    error(
      "No address given and PRIVATE_KEY env not set. " +
        "Either pass an address or export PRIVATE_KEY.",
    );
    process.exit(1);
  }
  return privateKeyToAccount(pk).address.toLowerCase();
}

export function registerUserCommands(program: Command): void {
  const user = program.command("user").description("Query user (address) activity");

  user
    .command("set-nickname <nickname>")
    .description(
      "Register a one-time, immutable on-chain nickname (≤32 UTF-8 bytes). " +
        "Cannot be changed once set.",
    )
    .action(async (nickname) => {
      try {
        const contracts = getContracts();
        const bytes32 = nicknameToBytes32(nickname);
        const client = getWalletClient();
        const hash = await setNicknameTx(client, bytes32, contracts.userRegistry);
        txHash(hash);
        await waitForTx(hash);
        success(`Nickname set: ${nickname}`);
      } catch (err) {
        error(String(err));
        process.exit(1);
      }
    });

  user
    .command("nickname [address]")
    .description("Show the on-chain nickname for an address (defaults to PRIVATE_KEY wallet).")
    .action(async (addrArg) => {
      try {
        const contracts = getContracts();
        const addr = resolveAddress(addrArg) as `0x${string}`;
        const pub = getPublicClient();
        const raw = (await getNickname(pub, addr, contracts.userRegistry)) as `0x${string}`;
        const decoded =
          raw && raw !== `0x${"00".repeat(32)}` ? hexToString(raw, { size: 32 }) : "";
        header(`Nickname — ${addr}`);
        kv("Nickname", decoded || "(unset)");
        console.log();
      } catch (err) {
        error(String(err));
        process.exit(1);
      }
    });

  user
    .command("votes [address]")
    .description("List voting history. Defaults to the wallet derived from PRIVATE_KEY.")
    .option("--page <n>", "page number", "1")
    .option("--limit <n>", "page size (max 100)", "20")
    .action(async (addrArg, opts) => {
      try {
        const addr = resolveAddress(addrArg);
        const page = parseInt(opts.page) || 1;
        const limit = Math.min(parseInt(opts.limit) || 20, 100);
        const data = await apiGet<{ votes: Record<string, unknown>[]; total: number }>(
          `/api/users/${addr}/votes?page=${page}&limit=${limit}`,
        );

        header(`Votes — ${addr}`);
        kv("Total", data.total);
        if (data.votes.length === 0) {
          console.log("  (no votes)\n");
          return;
        }
        table(
          data.votes.map((v) => ({
            Novel: `#${v.novel_id}`,
            Round: v.round,
            Revealed: v.revealed ? "yes" : "no",
            Candidate: v.revealed ? `ID.${v.candidate_id}` : "-",
            Claimed: v.claimed ? "yes" : "no",
            Title: String(v.novel_title ?? "").slice(0, 28),
          })),
        );
        console.log();
      } catch (err) {
        error(String(err));
        process.exit(1);
      }
    });

  user
    .command("chapters [address]")
    .description("List chapters authored by an address. Defaults to PRIVATE_KEY wallet.")
    .option("--page <n>", "page number", "1")
    .option("--limit <n>", "page size (max 200)", "50")
    .action(async (addrArg, opts) => {
      try {
        const addr = resolveAddress(addrArg);
        const page = parseInt(opts.page) || 1;
        const limit = Math.min(parseInt(opts.limit) || 50, 200);
        const data = await apiGet<{
          chapters: Record<string, unknown>[];
          pagination: { total: number };
        }>(`/api/users/${addr}/chapters?page=${page}&limit=${limit}`);

        header(`Chapters — ${addr}`);
        kv("Total", data.pagination.total);
        if (data.chapters.length === 0) {
          console.log("  (no chapters)\n");
          return;
        }
        table(
          data.chapters.map((c) => ({
            Chapter: `ID.${c.id}`,
            Novel: `#${c.novel_id}`,
            Depth: c.depth,
            WorldLine: c.is_world_line ? "yes" : "no",
            Votes: c.vote_count,
            Comments: c.comment_count,
            Title: String(c.novel_title ?? "").slice(0, 24),
          })),
        );
        console.log();
      } catch (err) {
        error(String(err));
        process.exit(1);
      }
    });

  user
    .command("rewards [address]")
    .description(
      "Show unclaimed voting rewards, past reward claims, and participated novels. " +
        "Use this to find unclaimed rewards after round settlement.",
    )
    .action(async (addrArg) => {
      try {
        const addr = resolveAddress(addrArg);
        const data = await apiGet<{
          unclaimedVotes: Record<string, unknown>[];
          rewardClaims: Record<string, unknown>[];
          participatedNovels: Record<string, unknown>[];
        }>(`/api/users/${addr}/rewards`);

        header(`Rewards — ${addr}`);

        if (data.unclaimedVotes.length > 0) {
          console.log("\n  Unclaimed voting rewards (run `vote claim <novel-id> <round>`):");
          table(
            data.unclaimedVotes.map((v) => ({
              Novel: `#${v.novel_id}`,
              Round: v.round,
              Title: String(v.novel_title ?? "").slice(0, 32),
            })),
          );
        } else {
          console.log("\n  No unclaimed voting rewards.");
        }

        if (data.rewardClaims.length > 0) {
          console.log("\n  Past reward claims:");
          table(
            data.rewardClaims.slice(0, 20).map((r) => ({
              Novel: `#${r.novel_id}`,
              Round: r.round ?? "-",
              Source: r.source,
              Amount: eth(String(r.amount ?? "0")),
              At: String(r.created_at ?? "").slice(0, 19),
            })),
          );
        }

        if (data.participatedNovels.length > 0) {
          console.log(`\n  Participated in ${data.participatedNovels.length} novels.`);
        }
        console.log();
      } catch (err) {
        error(String(err));
        process.exit(1);
      }
    });
}
