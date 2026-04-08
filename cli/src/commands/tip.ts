import { Command } from "commander";
import { parseEther } from "viem";
import {
  tipNovel as tipNovelTx,
  tipChapter as tipChapterTx,
  claimReward as claimRewardTx,
} from "onchain-novel-shared";
import { getWalletClient, getContracts } from "../utils/client.js";
import { success, error, txHash } from "../utils/format.js";

export function registerTipCommands(program: Command): void {
  const tip = program.command("tip").description("Tip novels or chapters");

  tip
    .command("novel <novel-id>")
    .description("Tip a novel")
    .requiredOption("--value <eth>", "tip amount in ETH")
    .action(async (novelId, opts) => {
      try {
        const client = getWalletClient();
        const contracts = getContracts();
        const hash = await tipNovelTx(client, {
          id: BigInt(novelId),
          value: parseEther(opts.value),
          novelCore: contracts.novelCore,
        });
        txHash(hash);
        success(`Tipped novel #${novelId} with ${opts.value} ETH`);
      } catch (err) {
        error(String(err));
        process.exit(1);
      }
    });

  tip
    .command("chapter <chapter-id>")
    .description("Tip a chapter (50% to author, 50% to prize pool)")
    .requiredOption("--value <eth>", "tip amount in ETH")
    .action(async (chapterId, opts) => {
      try {
        const client = getWalletClient();
        const contracts = getContracts();
        const hash = await tipChapterTx(client, {
          id: BigInt(chapterId),
          value: parseEther(opts.value),
          novelCore: contracts.novelCore,
        });
        txHash(hash);
        success(`Tipped chapter #${chapterId} with ${opts.value} ETH`);
      } catch (err) {
        error(String(err));
        process.exit(1);
      }
    });

  tip
    .command("claim <novel-id>")
    .description("Claim accumulated author/creator rewards")
    .action(async (novelId) => {
      try {
        const client = getWalletClient();
        const contracts = getContracts();
        const hash = await claimRewardTx(client, BigInt(novelId), contracts.novelCore);
        txHash(hash);
        success("Rewards claimed");
      } catch (err) {
        error(String(err));
        process.exit(1);
      }
    });
}
