import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import chalk from "chalk";
import { Command } from "commander";
import { parseEther } from "viem";


import { buildContentSubmission, submitChapter as submitChapterTx } from "../shared/index.js";
import { apiGet, apiPost, fetchNovelConfig } from "../utils/api.js";
import { getContracts, getWalletClient, waitForTx } from "../utils/client.js";
import { resolveContent, warnIfOutOfRange } from "../utils/content.js";
import { error, header, kv, success, table, txHash } from "../utils/format.js";

/** Render the per-chapter notes skeleton. Root chapters (parent_id = 0) get a slightly different schema. */
function renderNotesSkeleton(
  id: string | number,
  depth: string | number,
  parentId: string | number,
): string {
  const isRoot = String(parentId) === "0";
  const header = `# ID.${id} — ch${depth}, ${isRoot ? "root (no parent)" : `continues from ID.${parentId}`}`;
  const preamble = `<!-- This file is your STRUCTURED analysis of chapter ${id}. Filling it IS the act
of understanding — skimming the raw content without writing notes means you have
not analyzed this chapter.

Remove each <!-- TODO --> marker once you finish that section. A gate before
drafting (Step 5) checks that every ancestor's notes have zero TODO markers. -->`;

  const happened = `## 本章主要发生了什么
<!-- TODO: 3-6 句具体情节。
     ✓ 好："A 为救 B 拔枪射中了 C 的肩膀，C 退却但认出了 A 戴的十字吊坠。"
     ✗ 差："展开了一场紧张的对决。" -->`;

  const delta = isRoot
    ? `## 初始世界设定
<!-- TODO: 时间 / 地点 / 主要人物 / 权力格局 / 技术水平 / 文化特征。
     这是后续所有续写的起点，要具体。 -->`
    : `## 相对 parent 推进了什么
<!-- TODO: 状态增量。任选适用：
     - 谁的位置 / 处境变了
     - 谁和谁的关系变了
     - 谁知道了什么之前不知道的事
     - 哪个悬念被解开 / 加深
     - 世界格局有什么变化 -->`;

  const newElements = `## 新引入的元素
<!-- TODO: 本章才出现的：
     - 新人物（名字、身份、关系）
     - 新地点 / 新组织 / 新设定
     - 新伏笔
     若完全无新元素，直接写"无"。 -->`;

  const hooks = `## 埋下 / 收割的钩子
<!-- TODO:
     - 埋下：本章留下的新悬念。具体些，不要"一个神秘的预感"。
     - 收割${isRoot ? "（root 章节通常无可收割，留空或写'无'）" : ""}：本章解答了 / 推进了哪个 ancestor 的悬念？注明 ancestor chapterId。 -->`;

  const voice = `## 语气和风格特征
<!-- TODO: 1-2 句，够下一位作者匹配 voice 就行。
     例："第三人称限知视角，冷峻克制的短句，大量感官细节，对话不用引号。" -->`;

  return [header, preamble, happened, delta, newElements, hooks, voice].join("\n\n") + "\n";
}

export function registerChapterCommands(program: Command): void {
  const chapter = program.command("chapter").description("Chapter commands");

  chapter
    .command("submit <novel-id> <parent-id>")
    .description("Submit a new chapter")
    .option("--content <text>", "chapter content (mutually exclusive with --file)")
    .option("--file <path>", "read chapter content from a UTF-8 text file")
    .option("--value <eth>", "submission fee in ETH (auto-detected from novel config if not set)")
    .action(async (novelId, parentId, opts) => {
      try {
        const client = getWalletClient();
        const contracts = getContracts();
        const content = resolveContent(opts);

        // Resolve submission fee: --value wins, otherwise backend config. No fallback
        // default — a wrong fee causes a guaranteed revert and wasted gas.
        let value: bigint;
        let novelConfig: Record<string, string> | undefined;
        if (opts.value) {
          value = parseEther(opts.value);
        } else {
          const { config } = await fetchNovelConfig(novelId);
          novelConfig = config;
          value = BigInt(config.submissionFee ?? "0");
        }
        warnIfOutOfRange(content, novelConfig);
        const submission = buildContentSubmission(content);

        const hash = await submitChapterTx(client, {
          novelId: BigInt(novelId),
          parentId: BigInt(parentId),
          submission,
          value,
          novelCore: contracts.novelCore,
        });

        txHash(hash);
        await waitForTx(hash);
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
        header(`Chapter ID.${chapterId}`);
        kv("Novel", `${data.novel_title} (#${data.novel_id})`);
        kv("Author", data.author);
        kv("Parent", `ID.${data.parent_id}`);
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
        const data = await apiGet<{ chapters: Record<string, unknown>[] }>(
          `/api/novels/${novelId}/tree`,
        );
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
          console.log(`${prefix}${connector}ID.${ch.id} (d=${ch.depth}) by ${authorShort}..${wl}`);
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
    .command("children <chapter-id>")
    .description("Show direct children of a chapter")
    .action(async (chapterId) => {
      try {
        const data = await apiGet<{ children: Record<string, unknown>[] }>(
          `/api/chapters/${chapterId}/children`,
        );
        header(`Children of Chapter ID.${chapterId}`);
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

  chapter
    .command("context <chapter-id>")
    .description(
      "Fetch the full ancestor chain (root → target). Essential for evaluating a candidate " +
        "chapter before voting or continuing the story — gives you the complete narrative so far.",
    )
    .option("--max-depth <n>", "max ancestors to walk back", "100")
    .option("--summary", "print only metadata; skip full content")
    .option(
      "--cache <dir>",
      "also write each ancestor's content to <dir>/<id>.md and a TODO notes skeleton to " +
        "<dir>/<id>-ch<depth>-<parentId>.md. Existing files are NOT overwritten.",
    )
    .action(async (chapterId, opts) => {
      try {
        const maxDepth = Math.min(parseInt(opts.maxDepth) || 100, 200);
        const data = await apiGet<{ ancestors: Record<string, unknown>[] }>(
          `/api/chapters/${chapterId}/context?maxDepth=${maxDepth}`,
        );
        header(`Context for Chapter ID.${chapterId}`);
        kv("Ancestors", data.ancestors.length);

        if (opts.cache) {
          mkdirSync(opts.cache, { recursive: true });
          let wrote = 0;
          let skipped = 0;
          let skeletonsAdded = 0;
          for (const a of data.ancestors) {
            const id = String(a.id);
            const depth = String(a.depth);
            const parentId = String(a.parent_id ?? "0");

            const contentPath = join(opts.cache, `${id}.md`);
            if (!existsSync(contentPath)) {
              if (a.content_text) {
                writeFileSync(contentPath, String(a.content_text));
                wrote++;
              }
            } else {
              skipped++;
            }

            const notesPath = join(opts.cache, `${id}-ch${depth}-${parentId}.md`);
            if (!existsSync(notesPath)) {
              writeFileSync(notesPath, renderNotesSkeleton(id, depth, parentId));
              skeletonsAdded++;
            }
          }
          kv("Cached content", `${wrote} new, ${skipped} existing (preserved)`);
          kv("Notes skeletons", `${skeletonsAdded} new (TODO — fill before drafting)`);
          kv("Cache dir", opts.cache);
        }

        if (opts.summary) {
          table(
            data.ancestors.map((a) => ({
              Chapter: `ID.${a.id}`,
              Depth: a.depth,
              Author: String(a.author ?? "").slice(0, 12) + "...",
              WorldLine: a.is_world_line ? "yes" : "no",
              Fetched: a.content_fetched ? "yes" : "no",
            })),
          );
          console.log();
          return;
        }

        for (const a of data.ancestors) {
          console.log(
            chalk.gray(`\n─── Chapter ID.${a.id} (depth ${a.depth}, by ${String(a.author ?? "").slice(0, 10)}...) ───`),
          );
          if (a.content_text) {
            console.log(String(a.content_text));
          } else if (a.content_fetched === false) {
            console.log(chalk.yellow("  (content not yet indexed)"));
          } else {
            console.log(chalk.gray("  (no content)"));
          }
        }
        console.log();
      } catch (err) {
        error(String(err));
        process.exit(1);
      }
    });

  chapter
    .command("comments <chapter-id>")
    .description("List comments on a chapter")
    .option("--page <n>", "page number", "1")
    .option("--limit <n>", "results per page", "20")
    .action(async (chapterId, opts) => {
      try {
        const data = await apiGet<{ comments: Record<string, unknown>[] }>(
          `/api/chapters/${chapterId}/comments?page=${opts.page}&limit=${opts.limit}`,
        );
        header(`Comments on Chapter ID.${chapterId}`);
        if (data.comments.length === 0) {
          console.log(chalk.gray("  (no comments)\n"));
          return;
        }
        for (const c of data.comments) {
          console.log(
            `${chalk.cyan(String(c.author ?? "").slice(0, 12) + "...")} ` +
              chalk.gray(`#${c.id} ${c.created_at}`),
          );
          console.log(`  ${c.content}\n`);
        }
      } catch (err) {
        error(String(err));
        process.exit(1);
      }
    });

  chapter
    .command("comment <chapter-id> <content>")
    .description("Post an off-chain comment (EIP-191 signed, no on-chain tx)")
    .action(async (chapterId, content) => {
      try {
        const client = getWalletClient();
        const address = client.account!.address;
        const ts = Math.floor(Date.now() / 1000);
        const message = `Comment on chapter ${chapterId} at ${ts}: ${content}`;
        const signature = await client.signMessage({ account: client.account!, message });

        const result = await apiPost<{ id: number }>(`/api/chapters/${chapterId}/comments`, {
          address,
          content,
          timestamp: ts,
          signature,
        });

        if (result.status === 201 && result.body?.id) {
          success(`Comment posted (id=${result.body.id})`);
        } else {
          error(`Backend rejected comment (status ${result.status})`);
          process.exit(1);
        }
      } catch (err) {
        error(String(err));
        process.exit(1);
      }
    });
}
