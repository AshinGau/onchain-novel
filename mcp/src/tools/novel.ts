import { type McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { parseEther, formatEther, keccak256, toHex, toBytes } from "viem";
import { novelCoreAbi } from "../abi/index.js";
import { config } from "../config.js";
import { getPublicClient, getWalletClient } from "../utils/wallet.js";
import { hasApi, apiFetch } from "../utils/api-client.js";

const ROUND_PHASE_NAMES = ["Submitting", "Committing", "Revealing", "Settling"];
const EPOCH_PHASE_NAMES = ["Rounds", "Committing", "Revealing", "Settling"];

export function registerNovelTools(server: McpServer): void {
  server.tool(
    "create_novel",
    "Create a new collaborative novel on-chain with bootstrap chapters forming a linear chain. Send ETH to fund the initial prize pool.",
    {
      minChapterLength: z.number().describe("Minimum content bytes per chapter"),
      maxChapterLength: z.number().describe("Maximum content bytes per chapter"),
      roundMinDuration: z.number().describe("Minimum round duration in seconds"),
      roundMinSubmissions: z.number().describe("Minimum submissions before round can close (must be >= worldLineCount)"),
      worldLineCount: z.number().describe("Number of parallel world lines to keep per round"),
      roundsPerEpoch: z.number().describe("Rounds per epoch before epoch voting"),
      prizeReleaseRate: z.number().describe("Epoch release rate in basis points (e.g. 3000 = 30%)"),
      voterRewardRate: z.number().describe("Voter reward rate in basis points (max 2000 = 20%)"),
      commitDuration: z.number().describe("Commit phase duration in seconds"),
      revealDuration: z.number().describe("Reveal phase duration in seconds"),
      stakeAmount: z.string().describe("Required stake per chapter submission in ETH (e.g. '0.01')"),
      spamRounds: z.number().describe("Consecutive rounds for spam tracking"),
      spamThreshold: z.number().describe("Bottom X percentile counts as spam (e.g. 20)"),
      contentLocation: z.number().default(0).describe("Content storage mode: 0=Onchain, 1=External (IPFS/Arweave), 2=HTTP"),
      contentBaseUrl: z.string().default("").describe("Base URL for content storage (External/HTTP only, ignored for Onchain)"),
      ruleFee: z.string().default("0.001").describe("Fee to propose a rule in ETH (goes to prize pool)"),
      ruleVoteDuration: z.number().default(259200).describe("Seconds before a rule proposal expires (default 3 days)"),
      ruleQuorum: z.number().default(7).describe("Canon-author votes needed to pass a rule proposal"),
      title: z.string().describe("Novel title"),
      description: z.string().default("").describe("Novel description / synopsis"),
      coverUri: z.string().default("").describe("Cover image URI (IPFS/Arweave/HTTP)"),
      bootstrapContents: z.array(z.string()).describe("Array of bootstrap chapter contents (text strings). These form a linear chain as the story foundation."),
      initialPrizeEth: z.string().optional().describe("Initial prize pool deposit in ETH (e.g. '1.0')"),
      rules: z.array(z.object({
        name: z.string().describe("Rule name (max 64 bytes)"),
        content: z.string().describe("Rule content"),
      })).optional().describe("Initial world-building rules (story background, characters, plot threads). These are creative reference for AI agents, not rigid constraints."),
    },
    async (params) => {
      try {
        const walletClient = getWalletClient();
        const publicClient = getPublicClient();

        const novelConfig = {
          minChapterLength: BigInt(params.minChapterLength),
          maxChapterLength: BigInt(params.maxChapterLength),
          roundMinDuration: BigInt(params.roundMinDuration),
          roundMinSubmissions: params.roundMinSubmissions,
          worldLineCount: params.worldLineCount,
          roundsPerEpoch: params.roundsPerEpoch,
          prizeReleaseRate: params.prizeReleaseRate,
          voterRewardRate: params.voterRewardRate,
          commitDuration: BigInt(params.commitDuration),
          revealDuration: BigInt(params.revealDuration),
          stakeAmount: parseEther(params.stakeAmount),
          spamRounds: params.spamRounds,
          spamThreshold: params.spamThreshold,
          contentLocation: params.contentLocation,
          contentBaseUrl: params.contentBaseUrl,
          ruleFee: parseEther(params.ruleFee),
          ruleVoteDuration: BigInt(params.ruleVoteDuration),
          ruleQuorum: params.ruleQuorum,
        };

        const value = params.initialPrizeEth
          ? parseEther(params.initialPrizeEth)
          : 0n;

        const metadata = {
          title: params.title,
          description: params.description,
          coverUri: params.coverUri,
        };

        // Build ContentSubmission[] from bootstrap contents
        const bootstrapChapters = params.bootstrapContents.map((text) => {
          const contentBytes = toHex(toBytes(text));
          return {
            contentHash: keccak256(contentBytes),
            declaredLength: BigInt(toBytes(text).length),
            content: contentBytes,
          };
        });

        const hash = await walletClient.writeContract({
          address: config.novelCoreAddress,
          abi: novelCoreAbi,
          functionName: "createNovel",
          args: [novelConfig, metadata, bootstrapChapters],
          value,
        });

        const receipt = await publicClient.waitForTransactionReceipt({ hash });

        // Extract novelId from NovelCreated event log
        const novelCreatedLog = receipt.logs.find(
          (l) => l.address.toLowerCase() === config.novelCoreAddress.toLowerCase() && l.topics.length >= 2
        );
        const novelId = novelCreatedLog?.topics[1] ? BigInt(novelCreatedLog.topics[1]) : null;

        // Set initial rules if provided
        const validRules = (params.rules ?? []).filter((r) => r.name.trim() && r.content.trim());
        let rulesInfo = "";
        if (validRules.length > 0 && novelId) {
          try {
            const rulesHash = await walletClient.writeContract({
              address: config.novelCoreAddress,
              abi: novelCoreAbi,
              functionName: "setCreatorRules",
              args: [novelId, validRules.map((r) => r.name.trim()), validRules.map((r) => r.content.trim())],
            });
            await publicClient.waitForTransactionReceipt({ hash: rulesHash });
            rulesInfo = `\nRules: ${validRules.length} rule(s) set (tx: ${rulesHash})`;
          } catch (err) {
            rulesInfo = `\nRules: Failed to set — ${err instanceof Error ? err.message : String(err)}`;
          }
        }

        return {
          content: [
            {
              type: "text" as const,
              text: `Novel created successfully.${novelId ? `\nNovel ID: ${novelId}` : ""}\nTransaction: ${hash}\nBlock: ${receipt.blockNumber}\nStatus: ${receipt.status}${rulesInfo}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Failed to create novel: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "get_novel",
    "Get the full state of a novel by ID, including current round/epoch phases, configuration, and statistics.",
    {
      novelId: z.number().describe("Novel ID to query"),
    },
    async (params) => {
      try {
        // Prefer API (richer data: chapter_count, author_count, pool_balance, etc.)
        if (hasApi()) {
          const novel = await apiFetch<Record<string, unknown>>(`/api/novels/${params.novelId}`);
          if (!novel) {
            return { content: [{ type: "text" as const, text: `Novel ${params.novelId} not found.` }] };
          }
          const cfg = novel.config as Record<string, unknown>;
          const info = [
            `Novel #${novel.id}: ${novel.title}`,
            novel.description ? `Description: ${novel.description}` : "",
            `Creator: ${novel.creator}`,
            `Active: ${novel.active}`,
            `Current Round: ${novel.current_round} (${ROUND_PHASE_NAMES[novel.round_phase as number]})`,
            `Current Epoch: ${novel.current_epoch} (${EPOCH_PHASE_NAMES[novel.epoch_phase as number]})`,
            `Phase Start: ${novel.phase_start_time}`,
            `Bootstrap Chapters: ${novel.bootstrap_chapter_count}`,
            `Cumulative Canon: ${novel.cumulative_canon_chapters}`,
            `Stake: ${formatEther(BigInt(cfg.stakeAmount as string))} ETH`,
            `World Lines: ${cfg.worldLineCount}`,
            `Rounds/Epoch: ${cfg.roundsPerEpoch}`,
            `Min Submissions: ${cfg.roundMinSubmissions}`,
            `Pool Balance: ${formatEther(BigInt(novel.pool_balance as string))} ETH`,
            `Chapters: ${novel.chapter_count ?? "?"}`,
            `Authors: ${novel.author_count ?? "?"}`,
            cfg.ruleFee ? `Rule Fee: ${formatEther(BigInt(cfg.ruleFee as string))} ETH` : "",
            cfg.ruleQuorum ? `Rule Quorum: ${cfg.ruleQuorum} votes` : "",
            cfg.ruleVoteDuration ? `Rule Vote Duration: ${cfg.ruleVoteDuration}s` : "",
            novel.fork_source_novel_id
              ? `Forked from Novel #${novel.fork_source_novel_id} Chapter #${novel.fork_source_chapter_id}`
              : "",
          ].filter(Boolean).join("\n");

          return { content: [{ type: "text" as const, text: info }] };
        }

        // Fallback: read from chain
        const publicClient = getPublicClient();

        const [novel, metadata] = await Promise.all([
          publicClient.readContract({
            address: config.novelCoreAddress,
            abi: novelCoreAbi,
            functionName: "getNovel",
            args: [BigInt(params.novelId)],
          }) as Promise<Record<string, unknown>>,
          publicClient.readContract({
            address: config.novelCoreAddress,
            abi: novelCoreAbi,
            functionName: "getNovelMetadata",
            args: [BigInt(params.novelId)],
          }) as Promise<{ title: string; description: string; coverUri: string }>,
        ]);

        if ((novel as { id: bigint }).id === 0n) {
          return {
            content: [
              { type: "text" as const, text: `Novel ${params.novelId} not found.` },
            ],
          };
        }

        const n = novel as {
          id: bigint;
          creator: string;
          config: {
            minChapterLength: bigint;
            maxChapterLength: bigint;
            roundMinDuration: bigint;
            roundMinSubmissions: number;
            worldLineCount: number;
            roundsPerEpoch: number;
            prizeReleaseRate: number;
            voterRewardRate: number;
            commitDuration: bigint;
            revealDuration: bigint;
            stakeAmount: bigint;
            spamRounds: number;
            spamThreshold: number;
          };
          currentRound: number;
          currentEpoch: number;
          roundPhase: number;
          epochPhase: number;
          phaseStartTime: bigint;
          bootstrapChapterCount: number;
          cumulativeCanonChapters: number;
          active: boolean;
          forkSourceNovelId: bigint;
          forkSourceChapterId: bigint;
        };

        const info = [
          `Novel #${n.id}: ${metadata.title}`,
          metadata.description ? `Description: ${metadata.description}` : "",
          metadata.coverUri ? `Cover: ${metadata.coverUri}` : "",
          `Creator: ${n.creator}`,
          `Active: ${n.active}`,
          `Current Round: ${n.currentRound} (${ROUND_PHASE_NAMES[n.roundPhase]})`,
          `Current Epoch: ${n.currentEpoch} (${EPOCH_PHASE_NAMES[n.epochPhase]})`,
          `Phase Start: ${new Date(Number(n.phaseStartTime) * 1000).toISOString()}`,
          `Bootstrap Chapters: ${n.bootstrapChapterCount}`,
          `Cumulative Canon: ${n.cumulativeCanonChapters}`,
          `Stake: ${formatEther(n.config.stakeAmount)} ETH`,
          `World Lines: ${n.config.worldLineCount}`,
          `Rounds/Epoch: ${n.config.roundsPerEpoch}`,
          `Min Submissions: ${n.config.roundMinSubmissions}`,
          (n.config as any).ruleFee ? `Rule Fee: ${formatEther((n.config as any).ruleFee)} ETH` : "",
          (n.config as any).ruleQuorum ? `Rule Quorum: ${(n.config as any).ruleQuorum} votes` : "",
          (n.config as any).ruleVoteDuration ? `Rule Vote Duration: ${(n.config as any).ruleVoteDuration}s` : "",
          n.forkSourceNovelId > 0n
            ? `Forked from Novel #${n.forkSourceNovelId} Chapter #${n.forkSourceChapterId}`
            : "",
        ]
          .filter(Boolean)
          .join("\n");

        return { content: [{ type: "text" as const, text: info }] };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Failed to get novel: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "get_active_world_lines",
    "Get the currently active world line chapter IDs for a novel. These are the branches available for continuation.",
    {
      novelId: z.number().describe("Novel ID"),
    },
    async (params) => {
      try {
        if (hasApi()) {
          const data = await apiFetch<{ worldlines: { id: string; author: string; chapter_index: number; vote_count: string }[] }>(
            `/api/novels/${params.novelId}/worldlines`
          );
          if (data.worldlines.length === 0) {
            return { content: [{ type: "text" as const, text: `No active world lines for novel ${params.novelId}.` }] };
          }
          const lines = data.worldlines.map(
            (wl) => `  - Chapter #${wl.id} (index ${wl.chapter_index}, by ${wl.author}, ${wl.vote_count} votes)`
          );
          return { content: [{ type: "text" as const, text: `Active world lines for Novel #${params.novelId}:\n${lines.join("\n")}` }] };
        }

        const publicClient = getPublicClient();

        const worldLines = (await publicClient.readContract({
          address: config.novelCoreAddress,
          abi: novelCoreAbi,
          functionName: "getActiveWorldLines",
          args: [BigInt(params.novelId)],
        })) as bigint[];

        if (worldLines.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: `No active world lines for novel ${params.novelId}.`,
              },
            ],
          };
        }

        return {
          content: [
            {
              type: "text" as const,
              text: `Active world lines for Novel #${params.novelId}:\n${worldLines.map((id) => `  - Chapter #${id}`).join("\n")}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Failed to get world lines: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "fork_novel",
    "Create a new independent novel by forking from a rejected branch of an existing novel.",
    {
      originalNovelId: z.number().describe("Source novel ID"),
      branchChapterId: z.number().describe("Chapter ID of the rejected branch to fork from"),
      minChapterLength: z.number().describe("Minimum content bytes per chapter"),
      maxChapterLength: z.number().describe("Maximum content bytes per chapter"),
      roundMinDuration: z.number().describe("Minimum round duration in seconds"),
      roundMinSubmissions: z.number().describe("Minimum submissions before round can close"),
      worldLineCount: z.number().describe("Number of world lines to keep per round"),
      roundsPerEpoch: z.number().describe("Rounds per epoch"),
      prizeReleaseRate: z.number().describe("Epoch release rate in basis points"),
      voterRewardRate: z.number().describe("Voter reward rate in basis points"),
      commitDuration: z.number().describe("Commit phase duration in seconds"),
      revealDuration: z.number().describe("Reveal phase duration in seconds"),
      stakeAmount: z.string().describe("Required stake per submission in ETH"),
      spamRounds: z.number().describe("Spam tracking window"),
      spamThreshold: z.number().describe("Bottom percentile for spam"),
      ruleFee: z.string().default("0.001").describe("Fee to propose a rule in ETH"),
      ruleVoteDuration: z.number().default(259200).describe("Rule proposal vote duration in seconds"),
      ruleQuorum: z.number().default(7).describe("Canon-author votes needed for rule proposal"),
      title: z.string().describe("Novel title for the forked novel"),
      description: z.string().default("").describe("Novel description"),
      coverUri: z.string().default("").describe("Cover image URI"),
      initialPrizeEth: z.string().optional().describe("Initial prize pool in ETH"),
    },
    async (params) => {
      try {
        const walletClient = getWalletClient();
        const publicClient = getPublicClient();

        const novelConfig = {
          minChapterLength: BigInt(params.minChapterLength),
          maxChapterLength: BigInt(params.maxChapterLength),
          roundMinDuration: BigInt(params.roundMinDuration),
          roundMinSubmissions: params.roundMinSubmissions,
          worldLineCount: params.worldLineCount,
          roundsPerEpoch: params.roundsPerEpoch,
          prizeReleaseRate: params.prizeReleaseRate,
          voterRewardRate: params.voterRewardRate,
          commitDuration: BigInt(params.commitDuration),
          revealDuration: BigInt(params.revealDuration),
          stakeAmount: parseEther(params.stakeAmount),
          spamRounds: params.spamRounds,
          spamThreshold: params.spamThreshold,
          contentLocation: 0, // Default to Onchain
          contentBaseUrl: "", // Inherited from source novel (overridden by contract)
          ruleFee: parseEther(params.ruleFee),
          ruleVoteDuration: BigInt(params.ruleVoteDuration),
          ruleQuorum: params.ruleQuorum,
        };

        const value = params.initialPrizeEth
          ? parseEther(params.initialPrizeEth)
          : 0n;

        const forkMetadata = {
          title: params.title,
          description: params.description,
          coverUri: params.coverUri,
        };

        const hash = await walletClient.writeContract({
          address: config.novelCoreAddress,
          abi: novelCoreAbi,
          functionName: "forkNovel",
          args: [
            BigInt(params.originalNovelId),
            BigInt(params.branchChapterId),
            novelConfig,
            forkMetadata,
            [], // empty bootstrap chapters (fork root only)
          ],
          value,
        });

        const receipt = await publicClient.waitForTransactionReceipt({ hash });

        return {
          content: [
            {
              type: "text" as const,
              text: `Novel forked successfully from Novel #${params.originalNovelId} Chapter #${params.branchChapterId}.\nTransaction: ${hash}\nBlock: ${receipt.blockNumber}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Failed to fork novel: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "update_novel_metadata",
    "Update a novel's metadata (title, description, cover). Only callable by the novel creator.",
    {
      novelId: z.number().describe("Novel ID"),
      title: z.string().describe("Novel title"),
      description: z.string().default("").describe("Novel description"),
      coverUri: z.string().default("").describe("Cover image URI"),
    },
    async (params) => {
      try {
        const walletClient = getWalletClient();
        const publicClient = getPublicClient();

        const hash = await walletClient.writeContract({
          address: config.novelCoreAddress,
          abi: novelCoreAbi,
          functionName: "updateNovelMetadata",
          args: [
            BigInt(params.novelId),
            { title: params.title, description: params.description, coverUri: params.coverUri },
          ],
        });

        const receipt = await publicClient.waitForTransactionReceipt({ hash });

        return {
          content: [
            {
              type: "text" as const,
              text: `Novel #${params.novelId} metadata updated.\nTitle: ${params.title}\nTransaction: ${hash}\nBlock: ${receipt.blockNumber}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Failed to update metadata: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.tool(
    "complete_novel",
    "Deactivate a novel (owner only). Must be in Submitting phase.",
    {
      novelId: z.number().describe("Novel ID to complete"),
    },
    async (params) => {
      try {
        const walletClient = getWalletClient();
        const publicClient = getPublicClient();

        const hash = await walletClient.writeContract({
          address: config.novelCoreAddress,
          abi: novelCoreAbi,
          functionName: "completeNovel",
          args: [BigInt(params.novelId)],
        });

        const receipt = await publicClient.waitForTransactionReceipt({ hash });

        return {
          content: [
            {
              type: "text" as const,
              text: `Novel #${params.novelId} completed.\nTransaction: ${hash}\nBlock: ${receipt.blockNumber}`,
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: `Failed to complete novel: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  // ── API-only tools ──────────────────────────────────────────────

  server.tool(
    "discover_novels",
    "Browse and search novels. Supports sorting (hot/pool/tipped/active/latest), filtering (active/completed), and text search by title, creator address, or novel ID. Requires API_BASE_URL.",
    {
      sort: z.enum(["hot", "pool", "tipped", "active", "latest"]).default("latest").describe("Sort order"),
      filter: z.enum(["active", "completed", "all"]).default("all").describe("Filter by status"),
      search: z.string().optional().describe("Search by title, creator address (0x...), or novel ID"),
      page: z.number().default(1).describe("Page number"),
      limit: z.number().default(10).describe("Results per page (max 50)"),
    },
    async (params) => {
      try {
        if (!hasApi()) {
          return { content: [{ type: "text" as const, text: "discover_novels requires API_BASE_URL to be configured." }], isError: true };
        }
        const qs = new URLSearchParams();
        qs.set("sort", params.sort);
        if (params.filter !== "all") qs.set("filter", params.filter);
        if (params.search) qs.set("search", params.search);
        qs.set("page", String(params.page));
        qs.set("limit", String(params.limit));

        const data = await apiFetch<{
          novels: { id: string; title: string; creator: string; active: boolean; pool_balance: string; chapter_count: string; author_count: string; current_epoch: number; current_round: number }[];
          pagination: { page: number; limit: number; total: number; totalPages: number };
        }>(`/api/novels?${qs}`);

        if (data.novels.length === 0) {
          return { content: [{ type: "text" as const, text: "No novels found." }] };
        }

        const lines = data.novels.map((n) =>
          `  #${n.id} "${n.title}" by ${n.creator.slice(0, 10)}... | ${n.active ? "Active" : "Completed"} | E${n.current_epoch}R${n.current_round} | ${n.chapter_count} chapters, ${n.author_count} authors | Pool: ${formatEther(BigInt(n.pool_balance))} ETH`
        );

        const text = [
          `Novels (page ${data.pagination.page}/${data.pagination.totalPages}, ${data.pagination.total} total):`,
          ...lines,
        ].join("\n");

        return { content: [{ type: "text" as const, text }] };
      } catch (error) {
        return { content: [{ type: "text" as const, text: `Failed: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
      }
    }
  );

  server.tool(
    "get_novel_stats",
    "Get detailed statistics for a novel (chapter count, author count, vote count, total tipped, canon count, NFT count). Requires API_BASE_URL.",
    {
      novelId: z.number().describe("Novel ID"),
    },
    async (params) => {
      try {
        if (!hasApi()) {
          return { content: [{ type: "text" as const, text: "get_novel_stats requires API_BASE_URL to be configured." }], isError: true };
        }
        const stats = await apiFetch<Record<string, string>>(`/api/novels/${params.novelId}/stats`);
        const lines = [
          `Novel #${params.novelId} Statistics:`,
          `  Chapters: ${stats.chapter_count}`,
          `  Authors: ${stats.author_count}`,
          `  Votes: ${stats.vote_count}`,
          `  Canon chapters: ${stats.canon_count}`,
          `  NFTs minted: ${stats.nft_count}`,
          `  Total tipped: ${formatEther(BigInt(stats.total_tipped))} ETH`,
        ];
        return { content: [{ type: "text" as const, text: lines.join("\n") }] };
      } catch (error) {
        return { content: [{ type: "text" as const, text: `Failed: ${error instanceof Error ? error.message : String(error)}` }], isError: true };
      }
    }
  );
}
