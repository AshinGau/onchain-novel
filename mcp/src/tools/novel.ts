import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { formatEther, parseEther } from "viem";
import { z } from "zod";

import { config } from "../config.js";
import {
  buildContentSubmission,
  completeNovel,
  createNovel,
  forkNovel,
  getNovel,
  getNovelMetadata,
  setCreatorRules,
  type NovelConfig,
} from "../shared/index.js";
import { apiGet, hasApi } from "../utils/api.js";
import { getPublicClient, getWalletClient } from "../utils/client.js";
import { fail, inlineSafe, ok, sanitizeError, untrusted } from "../utils/response.js";

const ROUND_PHASES = ["Submitting", "Committing", "Revealing", "Settling"];

const novelConfigSchema = {
  minChapterLength: z.number().default(1000).describe("Min chapter bytes"),
  maxChapterLength: z.number().default(50000).describe("Max chapter bytes"),
  submissionFee: z.string().default("0.001").describe("Submission fee in ETH"),
  worldLineCount: z.number().default(3).describe("World lines per round"),
  voteStake: z.string().default("0.001").describe("Vote stake in ETH"),
  nominationFee: z.string().default("0.1").describe("Nomination fee in ETH"),
  nominateDuration: z.number().default(86400).describe("Nominate phase seconds"),
  commitDuration: z.number().default(172800).describe("Commit phase seconds"),
  revealDuration: z.number().default(86400).describe("Reveal phase seconds"),
  minRoundGap: z.number().default(86400).describe("Min gap between rounds seconds"),
  prizeReleaseRate: z.number().default(2000).describe("Release rate basis points"),
  voterRewardRate: z.number().default(500).describe("Voter reward basis points"),
  contentLocation: z.number().default(0).describe("0=Onchain, 1=External, 2=HTTP"),
  contentBaseUrl: z.string().default("").describe("Base URL for External/HTTP mode"),
  ruleFee: z.string().default("0.01").describe("Rule proposal fee in ETH"),
  ruleVoteDuration: z.number().default(259200).describe("Rule vote duration seconds"),
  ruleQuorum: z.number().default(7).describe("Votes needed for rule proposal"),
  initialPrizeEth: z.string().optional().describe("Initial prize pool ETH"),
};

function parseNovelConfig(p: Record<string, unknown>): NovelConfig {
  return {
    minChapterLength: BigInt(p.minChapterLength as number),
    maxChapterLength: BigInt(p.maxChapterLength as number),
    submissionFee: parseEther(p.submissionFee as string),
    worldLineCount: p.worldLineCount as number,
    voteStake: parseEther(p.voteStake as string),
    nominationFee: parseEther(p.nominationFee as string),
    nominateDuration: BigInt(p.nominateDuration as number),
    commitDuration: BigInt(p.commitDuration as number),
    revealDuration: BigInt(p.revealDuration as number),
    minRoundGap: BigInt(p.minRoundGap as number),
    prizeReleaseRate: p.prizeReleaseRate as number,
    voterRewardRate: p.voterRewardRate as number,
    contentLocation: (p.contentLocation as number) ?? 0,
    contentBaseUrl: (p.contentBaseUrl as string) ?? "",
    ruleFee: parseEther((p.ruleFee as string) ?? "0.01"),
    ruleVoteDuration: BigInt((p.ruleVoteDuration as number) ?? 259200),
    ruleQuorum: (p.ruleQuorum as number) ?? 7,
  };
}

export function registerNovelTools(server: McpServer): void {
  // ── novel_create ──
  server.tool(
    "novel_create",
    "Create a new collaborative novel on-chain with a root chapter.",
    {
      title: z.string().describe("Novel title"),
      description: z.string().default("").describe("Synopsis"),
      coverUri: z.string().default("").describe("Cover image URI"),
      rootContent: z.string().describe("Root chapter text content"),
      ...novelConfigSchema,
      rules: z
        .array(z.object({ name: z.string(), content: z.string() }))
        .optional()
        .describe("Initial world-building rules"),
    },
    async (params) => {
      try {
        const wallet = getWalletClient();
        const pub = getPublicClient();
        const novelConfig = parseNovelConfig(params);
        const rootChapter = buildContentSubmission(params.rootContent);
        const value = params.initialPrizeEth ? parseEther(params.initialPrizeEth) : 0n;

        const hash = await createNovel(wallet, {
          config: novelConfig,
          metadata: {
            title: params.title,
            description: params.description,
            coverUri: params.coverUri,
          },
          rootChapter,
          value,
          novelCore: config.novelCore,
        });
        const receipt = await pub.waitForTransactionReceipt({ hash });

        // Extract novelId from event log
        const log = receipt.logs.find(
          (l) => l.address.toLowerCase() === config.novelCore.toLowerCase() && l.topics.length >= 2,
        );
        const novelId = log?.topics[1] ? BigInt(log.topics[1]) : null;

        // Set initial rules if provided
        let rulesInfo = "";
        const validRules = (params.rules ?? []).filter((r) => r.name.trim() && r.content.trim());
        if (validRules.length > 0 && novelId && config.rulesEngine) {
          try {
            const rHash = await setCreatorRules(wallet, {
              novelId,
              names: validRules.map((r) => r.name.trim()),
              contents: validRules.map((r) => r.content.trim()),
              rulesEngine: config.rulesEngine,
            });
            await pub.waitForTransactionReceipt({ hash: rHash });
            rulesInfo = `\nRules: ${validRules.length} rule(s) set`;
          } catch (err) {
            rulesInfo = `\nRules: Failed — ${sanitizeError(err)}`;
          }
        }

        return ok(
          `Novel created.${novelId ? ` ID: ${novelId}` : ""}\nTx: ${hash}\nBlock: ${receipt.blockNumber}${rulesInfo}`,
        );
      } catch (error) {
        return fail(
          `Failed to create novel: ${sanitizeError(error)}`,
        );
      }
    },
  );

  // ── novel_info ──
  server.tool(
    "novel_info",
    "Get full state of a novel by ID.",
    { novelId: z.number().describe("Novel ID") },
    async (params) => {
      try {
        if (hasApi()) {
          const novel = await apiGet<Record<string, unknown>>(`/api/novels/${params.novelId}`);
          if (!novel) return ok(`Novel ${params.novelId} not found.`);
          const cfg = novel.config as Record<string, unknown>;
          const lines = [
            `Novel #${novel.id}: ${inlineSafe(String(novel.title ?? ""), 200)}`,
            novel.description
              ? `Description:\n${untrusted("novel-description", String(novel.description))}`
              : "",
            `Creator: ${novel.creator}`,
            `Active: ${novel.active}`,
            `Round: ${novel.current_round} (${ROUND_PHASES[novel.round_phase as number]})`,
            `Pool: ${formatEther(BigInt(cfg.submissionFee as string))} ETH submission fee`,
            `World Lines: ${cfg.worldLineCount}`,
            novel.pool_balance
              ? `Pool Balance: ${formatEther(BigInt(novel.pool_balance as string))} ETH`
              : "",
            `Chapters: ${novel.chapter_count ?? "?"}`,
            `Authors: ${novel.author_count ?? "?"}`,
          ].filter(Boolean);
          return ok(lines.join("\n"));
        }

        const pub = getPublicClient();
        const [novel, metadata] = await Promise.all([
          getNovel(pub, BigInt(params.novelId), config.novelCore),
          getNovelMetadata(pub, BigInt(params.novelId), config.novelCore),
        ]);
        const n = novel as any;
        if (n.id === 0n) return ok(`Novel ${params.novelId} not found.`);
        const m = metadata as { title: string; description: string };
        return ok(
          [
            `Novel #${n.id}: ${inlineSafe(m.title, 200)}`,
            m.description
              ? `Description:\n${untrusted("novel-description", m.description)}`
              : "",
            `Creator: ${n.creator}`,
            `Active: ${n.active}`,
            `Round: ${n.currentRound} (${ROUND_PHASES[n.roundPhase]})`,
            `Stake: ${formatEther(n.config.voteStake)} ETH`,
          ]
            .filter(Boolean)
            .join("\n"),
        );
      } catch (error) {
        return fail(`Failed: ${sanitizeError(error)}`);
      }
    },
  );

  // ── novel_list ──
  server.tool(
    "novel_list",
    "Browse novels with round/phase info. Use sort=active to find novels with recent chapters; " +
      "inspect the phase column to spot Committing/Revealing rounds (voting opportunities). " +
      "Requires API_BASE_URL.",
    {
      sort: z.enum(["hot", "pool", "tipped", "active", "latest"]).default("latest"),
      filter: z.enum(["active", "completed", "all"]).default("all"),
      search: z.string().optional().describe("Search by title, address, or ID"),
      page: z.number().default(1),
      limit: z.number().default(10),
    },
    async (params) => {
      try {
        if (!hasApi()) return fail("novel_list requires API_BASE_URL.");
        const qs = new URLSearchParams();
        qs.set("sort", params.sort);
        if (params.filter !== "all") qs.set("filter", params.filter);
        if (params.search) qs.set("search", params.search);
        qs.set("page", String(params.page));
        qs.set("limit", String(params.limit));

        const data = await apiGet<{
          novels: {
            id: string;
            title: string;
            creator: string;
            active: boolean;
            pool_balance: string;
            chapter_count: string;
            author_count: string;
            current_round: number;
            round_phase: number;
          }[];
          pagination: { page: number; totalPages: number; total: number };
        }>(`/api/novels?${qs}`);

        if (data.novels.length === 0) return ok("No novels found.");
        const lines = data.novels.map(
          (n) =>
            `  #${n.id} "${inlineSafe(n.title, 60)}" by ${n.creator.slice(0, 10)}... | ${n.active ? "Active" : "Done"} | r${n.current_round} ${ROUND_PHASES[n.round_phase] ?? "?"} | ${n.chapter_count} ch | Pool: ${formatEther(BigInt(n.pool_balance))} ETH`,
        );
        return ok(
          `Novels (${data.pagination.page}/${data.pagination.totalPages}, ${data.pagination.total} total):\n${lines.join("\n")}`,
        );
      } catch (error) {
        return fail(`Failed: ${sanitizeError(error)}`);
      }
    },
  );

  // ── novel_fork ──
  server.tool(
    "novel_fork",
    "Create a NEW novel whose root is seeded from a chapter of an existing novel (cross-novel reference). " +
      "`sourceChapterId` refers to the source novel's chapter; the new novel has independent config, " +
      "rules, and prize pool. A forkFee = max(submissionFee, sourcePoolBalance * forkFeeRate / 10000) " +
      "is paid to the source pool.",
    {
      sourceChapterId: z.number().describe("Chapter ID to fork from"),
      title: z.string().describe("New novel title"),
      rootContent: z.string().describe("Root chapter content for the fork"),
      description: z.string().default(""),
      coverUri: z.string().default(""),
      ...novelConfigSchema,
    },
    async (params) => {
      try {
        const wallet = getWalletClient();
        const pub = getPublicClient();
        const novelConfig = parseNovelConfig(params);
        const rootChapter = buildContentSubmission(params.rootContent);
        const value = params.initialPrizeEth ? parseEther(params.initialPrizeEth) : 0n;

        const hash = await forkNovel(wallet, {
          sourceChapterId: BigInt(params.sourceChapterId),
          config: novelConfig,
          metadata: {
            title: params.title,
            description: params.description,
            coverUri: params.coverUri,
          },
          rootChapter,
          value,
          novelCore: config.novelCore,
        });
        const receipt = await pub.waitForTransactionReceipt({ hash });
        return ok(
          `Novel forked from Chapter #${params.sourceChapterId}.\nTx: ${hash}\nBlock: ${receipt.blockNumber}`,
        );
      } catch (error) {
        return fail(`Failed: ${sanitizeError(error)}`);
      }
    },
  );

  // ── novel_complete ──
  server.tool(
    "novel_complete",
    "Complete a novel (creator / keeper / owner; anyone after inactivity timeout). " +
      "Final-path author derivation is fully on-chain via NovelCore.collectPathAuthors.",
    { novelId: z.number().describe("Novel ID") },
    async (params) => {
      try {
        const wallet = getWalletClient();
        const pub = getPublicClient();
        const hash = await completeNovel(wallet, {
          novelId: BigInt(params.novelId),
          roundManager: config.roundManager,
        });
        const receipt = await pub.waitForTransactionReceipt({ hash });
        return ok(
          `Novel #${params.novelId} completed.\nTx: ${hash}\nBlock: ${receipt.blockNumber}`,
        );
      } catch (error) {
        return fail(`Failed: ${sanitizeError(error)}`);
      }
    },
  );
}
