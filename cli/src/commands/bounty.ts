import { Command } from "commander";
import { parseEther } from "viem";

import {
  claimBounty as claimBountyTx,
  createBounty as createBountyTx,
  designateBounty as designateBountyTx,
  refundBounty as refundBountyTx,
} from "../shared/index.js";
import { apiGet } from "../utils/api.js";
import { getContracts, getWalletClient, waitForTx } from "../utils/client.js";
import { error, eth, header, kv, parseDuration, success, txHash } from "../utils/format.js";

export function registerBountyCommands(program: Command): void {
  const bounty = program.command("bounty").description("Bounty commands");

  bounty
    .command("create <chapter-id>")
    .description("Create a bounty to incentivize writing continuations")
    .requiredOption("--value <eth>", "bounty amount in ETH")
    .requiredOption("--deadline <duration>", "deadline from now (e.g., 7d, 24h, 30m)")
    .action(async (chapterId, opts) => {
      try {
        const client = getWalletClient();
        const contracts = getContracts();

        const durationSeconds = parseDuration(opts.deadline);
        const deadlineTimestamp = BigInt(Math.floor(Date.now() / 1000) + durationSeconds);

        const hash = await createBountyTx(client, {
          chapterId: BigInt(chapterId),
          deadline: deadlineTimestamp,
          value: parseEther(opts.value),
          bountyBoard: contracts.bountyBoard,
        });
        txHash(hash);
        await waitForTx(hash);
        success(
          `Bounty created for chapter #${chapterId} (${opts.value} ETH, deadline: ${opts.deadline})`,
        );
      } catch (err) {
        error(String(err));
        process.exit(1);
      }
    });

  bounty
    .command("designate <bounty-id> <chapter-id>")
    .description("Designate a preferred continuation for your bounty (before deadline)")
    .action(async (bountyId, chapterId) => {
      try {
        const client = getWalletClient();
        const contracts = getContracts();
        const hash = await designateBountyTx(client, {
          bountyId: BigInt(bountyId),
          chapterId: BigInt(chapterId),
          bountyBoard: contracts.bountyBoard,
        });
        txHash(hash);
        await waitForTx(hash);
        success(`Bounty #${bountyId} designated chapter #${chapterId}`);
      } catch (err) {
        error(String(err));
        process.exit(1);
      }
    });

  bounty
    .command("list")
    .description("List active bounties (earning opportunities)")
    .option("--novel-id <id>", "Filter by novel ID")
    .action(async (opts) => {
      try {
        const url = opts.novelId
          ? `/api/bounties/active?novelId=${opts.novelId}`
          : "/api/bounties/active";
        const data = await apiGet<{ bounties: Record<string, unknown>[] }>(url);
        if (data.bounties.length === 0) {
          console.log("No active bounties found.");
          return;
        }
        header("Active Bounties");
        for (const b of data.bounties) {
          kv(`Bounty #${b.id}`, `Chapter #${b.chapter_id} (${b.novel_title})`);
          kv("  Locked", eth(BigInt(String(b.locked_amount ?? "0"))));
          if (b.create_time) kv("  Created", new Date(Number(b.create_time) * 1000).toISOString());
          kv("  Deadline", new Date(Number(b.deadline) * 1000).toISOString());
          if (Number(b.designated_chapter_id) > 0) {
            kv("  Designated", `Chapter #${b.designated_chapter_id}`);
          }
          console.log();
        }
      } catch (err) {
        error(String(err));
        process.exit(1);
      }
    });

  bounty
    .command("claim <bounty-id>")
    .description("Claim bounty reward (for qualifying authors after deadline)")
    .action(async (bountyId) => {
      try {
        const client = getWalletClient();
        const contracts = getContracts();
        const hash = await claimBountyTx(client, BigInt(bountyId), contracts.bountyBoard);
        txHash(hash);
        await waitForTx(hash);
        success("Bounty claimed");
      } catch (err) {
        error(String(err));
        process.exit(1);
      }
    });

  bounty
    .command("refund <bounty-id>")
    .description("Refund bounty (if no continuations were submitted before deadline)")
    .action(async (bountyId) => {
      try {
        const client = getWalletClient();
        const contracts = getContracts();
        const hash = await refundBountyTx(client, BigInt(bountyId), contracts.bountyBoard);
        txHash(hash);
        await waitForTx(hash);
        success("Bounty refunded");
      } catch (err) {
        error(String(err));
        process.exit(1);
      }
    });

  bounty
    .command("info <bounty-id>")
    .description("Show bounty details")
    .action(async (bountyId) => {
      try {
        const data = await apiGet<Record<string, unknown>>(`/api/bounties/${bountyId}`);
        header(`Bounty #${bountyId}`);
        kv("Chapter", `#${data.chapter_id} (${data.novel_title})`);
        kv("Tipper", data.tipper);
        kv("Locked Amount", eth(BigInt(String(data.locked_amount ?? "0"))));
        kv("Deadline", data.deadline);
        kv("Claimed", data.claimed ? "Yes" : "No");
        console.log();
      } catch (err) {
        error(String(err));
        process.exit(1);
      }
    });
}
