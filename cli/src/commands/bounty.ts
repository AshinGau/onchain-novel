import { Command } from "commander";
import { parseEther } from "viem";
import {
  createBounty as createBountyTx,
  claimBounty as claimBountyTx,
  refundBounty as refundBountyTx,
} from "../shared/index.js";
import { getWalletClient, getContracts } from "../utils/client.js";
import { apiGet } from "../utils/api.js";
import { header, kv, success, error, txHash, eth, parseDuration } from "../utils/format.js";

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
        if (!contracts.bountyBoard) {
          error("BountyBoard contract address not configured. Run 'onchain-novel-cli config set contracts.bountyBoard <address>'.");
          return process.exit(1);
        }

        const durationSeconds = parseDuration(opts.deadline);
        const deadlineTimestamp = BigInt(Math.floor(Date.now() / 1000) + durationSeconds);

        const hash = await createBountyTx(client, {
          chapterId: BigInt(chapterId),
          deadline: deadlineTimestamp,
          value: parseEther(opts.value),
          bountyBoard: contracts.bountyBoard,
        });
        txHash(hash);
        success(`Bounty created for chapter #${chapterId} (${opts.value} ETH, deadline: ${opts.deadline})`);
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
        if (!contracts.bountyBoard) {
          error("BountyBoard contract address not configured.");
          return process.exit(1);
        }
        const hash = await claimBountyTx(client, BigInt(bountyId), contracts.bountyBoard);
        txHash(hash);
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
        if (!contracts.bountyBoard) {
          error("BountyBoard contract address not configured.");
          return process.exit(1);
        }
        const hash = await refundBountyTx(client, BigInt(bountyId), contracts.bountyBoard);
        txHash(hash);
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
