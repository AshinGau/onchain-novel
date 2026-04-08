import { Command } from "commander";
import { parseEther } from "viem";
import {
  createNovel as createNovelTx,
  forkNovel as forkNovelTx,
  completeNovel as completeNovelTx,
  buildContentSubmission,
  type NovelConfig,
  type NovelMetadata,
} from "../shared/index.js";
import { getWalletClient, getContracts } from "../utils/client.js";
import { apiGet } from "../utils/api.js";
import { header, kv, success, error, txHash, eth, table, roundPhaseName } from "../utils/format.js";

function buildNovelConfig(opts: Record<string, string>): NovelConfig {
  return {
    minChapterLength: BigInt(opts.minLength ?? "100"),
    maxChapterLength: BigInt(opts.maxLength ?? "50000"),
    submissionFee: parseEther(opts.submissionFee ?? "0.001"),
    worldLineCount: parseInt(opts.worldLines ?? "3"),
    voteStake: parseEther(opts.voteStake ?? "0.001"),
    nominationFee: parseEther(opts.nominationFee ?? "0.001"),
    nominateDuration: BigInt(opts.nominateDuration ?? "3600"),
    commitDuration: BigInt(opts.commitDuration ?? "3600"),
    revealDuration: BigInt(opts.revealDuration ?? "3600"),
    minRoundGap: BigInt(opts.minRoundGap ?? "60"),
    prizeReleaseRate: parseInt(opts.prizeReleaseRate ?? "1000"),
    voterRewardRate: parseInt(opts.voterRewardRate ?? "3000"),
    contentLocation: parseInt(opts.contentLocation ?? "0"),
    contentBaseUrl: opts.contentBaseUrl ?? "",
    ruleFee: parseEther(opts.ruleFee ?? "0.001"),
    ruleVoteDuration: BigInt(opts.ruleVoteDuration ?? "86400"),
    ruleQuorum: parseInt(opts.ruleQuorum ?? "3"),
  };
}

function buildMetadata(opts: Record<string, string>): NovelMetadata {
  return {
    title: opts.title ?? "Untitled Novel",
    description: opts.description ?? "",
    coverUri: opts.coverUri ?? "",
  };
}

export function registerNovelCommands(program: Command): void {
  const novel = program.command("novel").description("Novel management commands");

  novel
    .command("create")
    .description("Create a new novel with a root chapter")
    .option("--title <text>", "novel title", "Untitled Novel")
    .option("--description <text>", "novel description", "")
    .option("--cover-uri <uri>", "cover image URI", "")
    .option("--min-length <n>", "min chapter length", "100")
    .option("--max-length <n>", "max chapter length", "50000")
    .option("--submission-fee <eth>", "submission fee in ETH", "0.001")
    .option("--world-lines <n>", "world line count", "3")
    .option("--vote-stake <eth>", "vote stake in ETH", "0.001")
    .option("--nomination-fee <eth>", "nomination fee in ETH", "0.001")
    .option("--nominate-duration <s>", "nominate duration in seconds", "3600")
    .option("--commit-duration <s>", "commit duration in seconds", "3600")
    .option("--reveal-duration <s>", "reveal duration in seconds", "3600")
    .option("--min-round-gap <s>", "min round gap in seconds", "60")
    .option("--prize-release-rate <bps>", "prize release rate in basis points", "1000")
    .option("--voter-reward-rate <bps>", "voter reward rate in basis points", "3000")
    .option("--content-location <n>", "0=Onchain, 1=External, 2=HTTP", "0")
    .option("--content-base-url <url>", "content base URL (for External/HTTP)", "")
    .option("--rule-fee <eth>", "rule proposal fee in ETH", "0.001")
    .option("--rule-vote-duration <s>", "rule vote duration in seconds", "86400")
    .option("--rule-quorum <n>", "rule quorum", "3")
    .requiredOption("--content <text>", "root chapter content")
    .option("--value <eth>", "genesis fund in ETH", "0")
    .action(async (opts) => {
      try {
        const client = getWalletClient();
        const contracts = getContracts();
        const config = buildNovelConfig(opts);
        const metadata = buildMetadata(opts);
        const submission = buildContentSubmission(opts.content);
        const submissionFee = config.submissionFee;
        const extraValue = parseEther(opts.value ?? "0");
        const totalValue = submissionFee + extraValue;

        const hash = await createNovelTx(client, {
          config,
          metadata,
          rootChapter: submission,
          value: totalValue,
          novelCore: contracts.novelCore,
        });

        txHash(hash);
        success("Novel created successfully");
      } catch (err) {
        error(String(err));
        process.exit(1);
      }
    });

  novel
    .command("info <id>")
    .description("Show novel details")
    .action(async (id) => {
      try {
        const data = await apiGet<Record<string, unknown>>(`/api/novels/${id}`);
        header(`Novel #${id}`);
        kv("Title", data.title);
        kv("Creator", data.creator);
        kv("Description", data.description || "(none)");
        kv("Active", data.active);
        kv("Current Round", data.current_round);
        kv("Round Phase", roundPhaseName(Number(data.round_phase)));
        kv("Pool Balance", eth(BigInt(String(data.pool_balance ?? "0"))));
        kv("Total Tipped", eth(BigInt(String(data.total_tipped ?? "0"))));
        kv("Chapters", data.chapter_count);
        kv("Authors", data.author_count);
        kv("Views", data.view_count);
        kv("Created", data.created_at);
        console.log();
      } catch (err) {
        error(String(err));
        process.exit(1);
      }
    });

  novel
    .command("list")
    .description("List novels")
    .option("--sort <field>", "sort by: hot, pool, tipped, active, latest", "latest")
    .option("--limit <n>", "results per page", "10")
    .option("--page <n>", "page number", "1")
    .option("--filter <status>", "filter by: active, completed")
    .option("--search <query>", "search by title, id, or creator address")
    .action(async (opts) => {
      try {
        const params = new URLSearchParams();
        params.set("sort", opts.sort);
        params.set("limit", opts.limit);
        params.set("page", opts.page);
        if (opts.filter) params.set("filter", opts.filter);
        if (opts.search) params.set("search", opts.search);

        const data = await apiGet<{ novels: Record<string, unknown>[]; pagination: Record<string, unknown> }>(
          `/api/novels?${params.toString()}`,
        );

        header("Novels");
        table(
          data.novels.map((n) => ({
            ID: n.id,
            Title: String(n.title ?? "").slice(0, 30),
            Creator: String(n.creator ?? "").slice(0, 10) + "...",
            Active: n.active ? "Yes" : "No",
            Round: n.current_round,
            Chapters: n.chapter_count,
            Pool: eth(BigInt(String(n.pool_balance ?? "0"))),
          })),
        );
        const p = data.pagination;
        console.log(`\n  Page ${p.page}/${p.totalPages} (${p.total} total)\n`);
      } catch (err) {
        error(String(err));
        process.exit(1);
      }
    });

  novel
    .command("fork <chapter-id>")
    .description("Fork a novel from a specific chapter")
    .option("--title <text>", "novel title", "Untitled Fork")
    .option("--description <text>", "novel description", "")
    .option("--cover-uri <uri>", "cover image URI", "")
    .option("--min-length <n>", "min chapter length", "100")
    .option("--max-length <n>", "max chapter length", "50000")
    .option("--submission-fee <eth>", "submission fee in ETH", "0.001")
    .option("--world-lines <n>", "world line count", "3")
    .option("--vote-stake <eth>", "vote stake in ETH", "0.001")
    .option("--nomination-fee <eth>", "nomination fee in ETH", "0.001")
    .option("--nominate-duration <s>", "nominate duration in seconds", "3600")
    .option("--commit-duration <s>", "commit duration in seconds", "3600")
    .option("--reveal-duration <s>", "reveal duration in seconds", "3600")
    .option("--min-round-gap <s>", "min round gap in seconds", "60")
    .option("--prize-release-rate <bps>", "prize release rate in basis points", "1000")
    .option("--voter-reward-rate <bps>", "voter reward rate in basis points", "3000")
    .option("--content-location <n>", "0=Onchain, 1=External, 2=HTTP", "0")
    .option("--content-base-url <url>", "content base URL", "")
    .option("--rule-fee <eth>", "rule proposal fee in ETH", "0.001")
    .option("--rule-vote-duration <s>", "rule vote duration in seconds", "86400")
    .option("--rule-quorum <n>", "rule quorum", "3")
    .requiredOption("--content <text>", "fork root chapter content")
    .option("--value <eth>", "genesis fund in ETH", "0")
    .action(async (chapterId, opts) => {
      try {
        const client = getWalletClient();
        const contracts = getContracts();
        const config = buildNovelConfig(opts);
        const metadata = buildMetadata(opts);
        const submission = buildContentSubmission(opts.content);
        const extraValue = parseEther(opts.value ?? "0");
        const totalValue = config.submissionFee + extraValue;

        const hash = await forkNovelTx(client, {
          sourceChapterId: BigInt(chapterId),
          config,
          metadata,
          rootChapter: submission,
          value: totalValue,
          novelCore: contracts.novelCore,
        });

        txHash(hash);
        success("Novel forked successfully");
      } catch (err) {
        error(String(err));
        process.exit(1);
      }
    });

  novel
    .command("complete <id>")
    .description("Complete a novel (creator or after inactivity timeout)")
    .action(async (id) => {
      try {
        const client = getWalletClient();
        const contracts = getContracts();
        const hash = await completeNovelTx(client, BigInt(id), contracts.novelCore);
        txHash(hash);
        success("Novel completed");
      } catch (err) {
        error(String(err));
        process.exit(1);
      }
    });
}
