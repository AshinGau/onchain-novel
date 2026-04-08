import { Command } from "commander";
import { parseEther } from "viem";
import { submitChapter as submitChapterTx, buildContentSubmission } from "onchain-novel-shared";
import { getWalletClient, getContracts } from "../utils/client.js";
import { apiGet } from "../utils/api.js";
import { header, kv, success, error, txHash, table } from "../utils/format.js";
import chalk from "chalk";

export function registerChapterCommands(program: Command): void {
  const chapter = program.command("chapter").description("Chapter commands");

  chapter
    .command("submit <novel-id> <parent-id>")
    .description("Submit a new chapter")
    .requiredOption("--content <text>", "chapter content")
    .option("--value <eth>", "submission fee in ETH (auto-detected from novel config if not set)")
    .action(async (novelId, parentId, opts) => {
      try {
        const client = getWalletClient();
        const contracts = getContracts();
        const submission = buildContentSubmission(opts.content);

        // If value not specified, try to read novel config for submission fee
        let value: bigint;
        if (opts.value) {
          value = parseEther(opts.value);
        } else {
          try {
            const novel = await apiGet<Record<string, unknown>>(`/api/novels/${novelId}`);
            const config = novel.config as Record<string, string>;
            value = BigInt(config.submissionFee ?? "0");
          } catch {
            value = parseEther("0.001");
            console.log(chalk.yellow(`  Could not fetch novel config. Using default fee: 0.001 ETH`));
          }
        }

        const hash = await submitChapterTx(client, {
          novelId: BigInt(novelId),
          parentId: BigInt(parentId),
          submission,
          value,
          novelCore: contracts.novelCore,
        });

        txHash(hash);
        success("Chapter submitted");
      } catch (err) {
        error(String(err));
        process.exit(1);
      }
    });

  chapter
    .command("read <chapter-id>")
    .description("Read a chapter's details and content")
    .action(async (chapterId) => {
      try {
        const data = await apiGet<Record<string, unknown>>(`/api/chapters/${chapterId}`);
        header(`Chapter #${chapterId}`);
        kv("Novel", `${data.novel_title} (#${data.novel_id})`);
        kv("Author", data.author);
        kv("Parent", data.parent_id);
        kv("Depth", data.depth);
        kv("World Line", data.is_world_line ? "Yes" : "No");
        kv("Length", data.declared_length);
        kv("Timestamp", data.timestamp);
        kv("Content Hash", data.content_hash);

        if (data.content_text) {
          console.log(chalk.gray("\n─── Content ───────────────────────────────────────────────"));
          console.log(String(data.content_text));
          console.log(chalk.gray("───────────────────────────────────────────────────────────\n"));
        } else if (data.content_fetched === false) {
          console.log(chalk.yellow("\n  Content not yet indexed.\n"));
        }
      } catch (err) {
        error(String(err));
        process.exit(1);
      }
    });

  chapter
    .command("tree <novel-id>")
    .description("Show the chapter tree of a novel")
    .action(async (novelId) => {
      try {
        const data = await apiGet<{ chapters: Record<string, unknown>[] }>(`/api/novels/${novelId}/tree`);
        header(`Chapter Tree — Novel #${novelId}`);

        if (data.chapters.length === 0) {
          console.log(chalk.gray("  (no chapters)"));
          return;
        }

        // Build tree structure
        const byId = new Map<string, Record<string, unknown>>();
        const children = new Map<string, string[]>();
        for (const ch of data.chapters) {
          const id = String(ch.id);
          byId.set(id, ch);
          const parentId = String(ch.parent_id);
          if (!children.has(parentId)) children.set(parentId, []);
          children.get(parentId)!.push(id);
        }

        // Find root(s): chapters with parent_id = 0 or parent not in this novel
        const roots = data.chapters.filter(
          (ch) => String(ch.parent_id) === "0" || !byId.has(String(ch.parent_id)),
        );

        function printTree(id: string, prefix: string, isLast: boolean): void {
          const ch = byId.get(id)!;
          const connector = isLast ? "\\-- " : "|-- ";
          const wl = ch.is_world_line ? chalk.green(" *") : "";
          const authorShort = String(ch.author ?? "").slice(0, 8);
          console.log(
            `${prefix}${connector}#${ch.id} (d=${ch.depth}) by ${authorShort}..${wl}`,
          );
          const kids = children.get(id) ?? [];
          for (let i = 0; i < kids.length; i++) {
            const childPrefix = prefix + (isLast ? "    " : "|   ");
            printTree(kids[i], childPrefix, i === kids.length - 1);
          }
        }

        for (let i = 0; i < roots.length; i++) {
          printTree(String(roots[i].id), "  ", i === roots.length - 1);
        }
        console.log(chalk.gray("\n  * = world line\n"));
      } catch (err) {
        error(String(err));
        process.exit(1);
      }
    });

  chapter
    .command("descendants <chapter-id>")
    .description("Show direct children of a chapter")
    .action(async (chapterId) => {
      try {
        const data = await apiGet<{ children: Record<string, unknown>[] }>(
          `/api/chapters/${chapterId}/children`,
        );
        header(`Descendants of Chapter #${chapterId}`);
        table(
          data.children.map((ch) => ({
            ID: ch.id,
            Author: String(ch.author ?? "").slice(0, 12) + "...",
            Depth: ch.depth,
            "World Line": ch.is_world_line ? "Yes" : "No",
            Length: ch.declared_length,
          })),
        );
        console.log();
      } catch (err) {
        error(String(err));
        process.exit(1);
      }
    });
}
