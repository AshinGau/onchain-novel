import { Router } from "express";

import { getClient, query } from "../db/index.js";
import { createLogger } from "../utils/logger.js";
import { isId, parsePagination, safeInt, validateIdParams } from "../utils/validate.js";

const log = createLogger("api:novels");
const router = Router();

interface ChapterRow {
  id: string;
  parent_id: string;
  author: string;
  content_hash: string;
  depth: number;
  timestamp: string;
  is_world_line: boolean;
  declared_length: number;
  created_at: string;
}

const SORT_OPTIONS: Record<string, string> = {
  hot: "view_count DESC",
  pool: "pool_balance DESC",
  tipped: "total_funded DESC",
  active: "last_chapter_at DESC NULLS LAST",
  latest: "created_at DESC",
};

// GET /api/novels — List novels with pagination, sorting, filtering
router.get("/", async (req, res) => {
  try {
    const { page, limit, offset } = parsePagination(req.query);
    const sort = (req.query.sort as string) || "latest";
    if (!SORT_OPTIONS[sort]) {
      return res
        .status(400)
        .json({ error: `Invalid sort. Options: ${Object.keys(SORT_OPTIONS).join(", ")}` });
    }
    const filter = req.query.filter as string;

    let where = "1=1";
    const params: unknown[] = [];
    let paramIdx = 1;

    if (filter === "active") {
      where += ` AND active = TRUE`;
    } else if (filter === "completed") {
      where += ` AND active = FALSE`;
    }

    const search = (req.query.search as string)?.trim();
    if (search) {
      if (/^\d+$/.test(search)) {
        // Novel IDs are uint64 — pass as string so pg binds to BIGINT without JS-number truncation.
        if (!isId(search)) {
          return res.status(400).json({ error: "search id out of range" });
        }
        where += ` AND novels.id = $${paramIdx++}`;
        params.push(search);
      } else if (/^0x[0-9a-fA-F]+$/i.test(search)) {
        where += ` AND novels.creator = $${paramIdx++}`;
        params.push(search.toLowerCase());
      } else {
        // Substring ILIKE on title OR description. CJK-friendly (no char-count
        // floor) and tolerant of where the keyword sits in the title. At
        // current scale this is a sequential scan; revisit with a trigram or
        // tsvector index if the catalog ever grows past tens of thousands.
        const escaped = search.replace(/[%_]/g, "\\$&");
        where += ` AND (novels.title ILIKE $${paramIdx} OR novels.description ILIKE $${paramIdx})`;
        paramIdx++;
        params.push(`%${escaped}%`);
      }
    }

    const orderBy = SORT_OPTIONS[sort] || SORT_OPTIONS.latest;

    const countRes = await query(`SELECT COUNT(*) FROM novels WHERE ${where}`, params);
    const total = parseInt(countRes.rows[0].count);

    const novelsRes = await query(
      `SELECT novels.id, novels.creator, novels.title, novels.description, novels.cover_uri, novels.config,
              novels.current_round, novels.round_phase, novels.phase_start_time, novels.last_settle_time,
              novels.active, novels.pool_balance, novels.total_tipped, novels.total_funded, novels.view_count,
              novels.last_chapter_at, novels.created_at,
              COALESCE(cs.chapter_count, 0) AS chapter_count,
              COALESCE(cs.author_count, 0) AS author_count
       FROM novels
       LEFT JOIN LATERAL (
         SELECT COUNT(*) AS chapter_count, COUNT(DISTINCT author) AS author_count
         FROM chapters WHERE novel_id = novels.id
       ) cs ON true
       WHERE ${where}
       ORDER BY ${orderBy}
       LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
      [...params, limit, offset],
    );

    res.json({
      novels: novelsRes.rows,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (err) {
    log.error({ err }, "GET /api/novels error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/novels/:id — Novel detail
router.get("/:id", validateIdParams("id"), async (req, res) => {
  try {
    const { id } = req.params;
    const novelRes = await query(
      `SELECT n.*,
              COALESCE(cs.chapter_count, 0) AS chapter_count,
              COALESCE(cs.author_count, 0) AS author_count
       FROM novels n
       LEFT JOIN LATERAL (
         SELECT COUNT(*) AS chapter_count, COUNT(DISTINCT author) AS author_count
         FROM chapters WHERE novel_id = n.id
       ) cs ON true
       WHERE n.id = $1`,
      [id],
    );

    if (novelRes.rows.length === 0) {
      return res.status(404).json({ error: "Novel not found" });
    }

    // Increment view count (fire-and-forget, non-blocking)
    query("UPDATE novels SET view_count = view_count + 1 WHERE id = $1", [id]).catch(() => {});

    const row = novelRes.rows[0];
    row.view_count = (parseInt(row.view_count) + 1).toString();
    res.json(row);
  } catch (err) {
    log.error({ err }, "GET /api/novels/:id error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/novels/:id/tree — Story tree with depth pagination
// Query params: maxDepth (default 10) — load chapters up to this depth
router.get("/:id/tree", validateIdParams("id"), async (req, res) => {
  try {
    const { id } = req.params;
    const maxDepth = safeInt(req.query.maxDepth, 10, 1, 100);

    const [chaptersRes, hasMoreRes] = await Promise.all([
      query(
        `SELECT id, parent_id, author, depth, "timestamp",
                is_world_line, declared_length, content_hash, created_at
         FROM chapters WHERE novel_id = $1 AND depth <= $2
         ORDER BY id ASC`,
        [id, maxDepth],
      ),
      query(
        `SELECT EXISTS(SELECT 1 FROM chapters WHERE novel_id = $1 AND depth > $2) AS has_more`,
        [id, maxDepth],
      ),
    ]);

    res.json({
      chapters: chaptersRes.rows,
      hasMore: hasMoreRes.rows[0]?.has_more ?? false,
      maxDepth,
    });
  } catch (err) {
    log.error({ err }, "GET /api/novels/:id/tree error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/novels/:id/worldlines — Current active world line ancestors
// Returns chapters that are current world line ancestors (branching points for the next round).
router.get("/:id/worldlines", validateIdParams("id"), async (req, res) => {
  try {
    const { id } = req.params;
    const wlRes = await query(
      `SELECT c.id, c.parent_id, c.author, c.content_hash, c.depth, c."timestamp",
              c.is_world_line, c.declared_length
       FROM chapters c WHERE c.novel_id = $1 AND c.is_world_line = TRUE
       ORDER BY c.depth DESC, c.id ASC`,
      [id],
    );
    res.json({ worldlines: wlRes.rows });
  } catch (err) {
    log.error({ err }, "GET /api/novels/:id/worldlines error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/novels/:id/lines — Story lines (full root → leaf chains) under a sort mode.
// Modes:
//   canon   — one line per current worldLineAncestor, chain stops at the ancestor.
//   longest — for each ancestor walk all leaf descendants, build root→leaf chains,
//             return the top N by chain length (multiple per ancestor allowed).
//   active  — top N leaves across the novel by created_at DESC, chains root→leaf.
//   funded  — top N leaves by SUM(chapter_tips.amount) DESC, chains root→leaf.
// Default mode = longest. Default limit = novel.config.worldLineCount.
router.get("/:id/lines", validateIdParams("id"), async (req, res) => {
  try {
    const { id } = req.params;
    const mode = (req.query.mode as string) || "longest";
    if (!["canon", "longest", "active", "funded"].includes(mode)) {
      return res
        .status(400)
        .json({ error: `Invalid mode. Use: canon | longest | active | funded` });
    }

    // Look up worldLineCount as default limit (config is JSONB).
    const novelRes = await query<{ world_line_count: number }>(
      `SELECT (config->>'worldLineCount')::int AS world_line_count
       FROM novels WHERE id = $1`,
      [id],
    );
    if (novelRes.rows.length === 0) {
      return res.status(404).json({ error: "Novel not found" });
    }
    const defaultLimit = novelRes.rows[0].world_line_count || 3;
    const limit = safeInt(req.query.limit, defaultLimit, 1, 16);

    // Load every chapter for the novel into memory once. Chapters per novel are
    // bounded (a few thousand at most), and every mode needs the parent chain
    // for chain reconstruction.
    const chRes = await query<ChapterRow>(
      `SELECT id, parent_id, author, content_hash, depth, "timestamp",
              is_world_line, declared_length, created_at
       FROM chapters WHERE novel_id = $1`,
      [id],
    );
    if (chRes.rows.length === 0) {
      return res.json({ mode, lines: [] });
    }
    const byId = new Map<string, ChapterRow>();
    const childrenOf = new Map<string, string[]>();
    for (const c of chRes.rows) {
      byId.set(c.id, c);
      const parentKey = String(c.parent_id);
      if (!childrenOf.has(parentKey)) childrenOf.set(parentKey, []);
      childrenOf.get(parentKey)!.push(c.id);
    }

    function chainTo(leafId: string): ChapterRow[] {
      const chain: ChapterRow[] = [];
      let cur: string | undefined = leafId;
      // Walk parent_id up to root (parent_id "0" or missing in map).
      while (cur && cur !== "0") {
        const ch = byId.get(cur);
        if (!ch) break;
        chain.push(ch);
        cur = String(ch.parent_id);
      }
      return chain.reverse();
    }

    // Find every leaf descendant of `nodeId` (including nodeId itself if it has no children).
    function leavesUnder(nodeId: string): string[] {
      const out: string[] = [];
      const stack = [nodeId];
      while (stack.length > 0) {
        const cur = stack.pop()!;
        const kids = childrenOf.get(cur);
        if (!kids || kids.length === 0) {
          out.push(cur);
        } else {
          for (const k of kids) stack.push(k);
        }
      }
      return out;
    }

    let lines: { leafId: string; ancestorId: string; chain: ChapterRow[] }[] = [];

    if (mode === "canon") {
      const ancestors = chRes.rows.filter((c) => c.is_world_line);
      ancestors.sort((a, b) => Number(b.depth) - Number(a.depth) || Number(a.id) - Number(b.id));
      lines = ancestors
        .slice(0, limit)
        .map((a) => ({ leafId: a.id, ancestorId: a.id, chain: chainTo(a.id) }));
    } else if (mode === "longest") {
      const ancestors = chRes.rows.filter((c) => c.is_world_line);
      const candidates: { leafId: string; ancestorId: string; chain: ChapterRow[] }[] = [];
      for (const a of ancestors) {
        for (const leafId of leavesUnder(a.id)) {
          candidates.push({ leafId, ancestorId: a.id, chain: chainTo(leafId) });
        }
      }
      // Longest first; tie-break by newer leaf (higher id).
      candidates.sort(
        (x, y) => y.chain.length - x.chain.length || Number(y.leafId) - Number(x.leafId),
      );
      lines = candidates.slice(0, limit);
    } else if (mode === "active") {
      // Leaves = chapters with no children, ordered by recency.
      const leaves = chRes.rows
        .filter((c) => !childrenOf.has(c.id))
        .sort(
          (a, b) =>
            new Date(b.created_at).getTime() - new Date(a.created_at).getTime() ||
            Number(b.id) - Number(a.id),
        )
        .slice(0, limit);
      lines = leaves.map((l) => ({ leafId: l.id, ancestorId: l.id, chain: chainTo(l.id) }));
    } else {
      // funded: aggregate chapter tips by leaf.
      const leafIds = chRes.rows.filter((c) => !childrenOf.has(c.id)).map((c) => c.id);
      if (leafIds.length === 0) {
        return res.json({ mode, lines: [] });
      }
      const tipRes = await query<{ chapter_id: string; total: string }>(
        `SELECT chapter_id, COALESCE(SUM(amount::numeric), 0)::text AS total
         FROM chapter_tips
         WHERE chapter_id = ANY($1::bigint[])
         GROUP BY chapter_id`,
        [leafIds],
      );
      const totalById = new Map(tipRes.rows.map((r) => [r.chapter_id, BigInt(r.total)]));
      const ranked = leafIds
        .map((leafId) => ({ leafId, total: totalById.get(leafId) ?? 0n }))
        .sort((a, b) => {
          if (a.total !== b.total) return a.total > b.total ? -1 : 1;
          return Number(b.leafId) - Number(a.leafId);
        })
        .slice(0, limit);
      lines = ranked.map((r) => ({ leafId: r.leafId, ancestorId: r.leafId, chain: chainTo(r.leafId) }));
    }

    res.json({ mode, lines });
  } catch (err) {
    log.error({ err }, "GET /api/novels/:id/lines error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/novels/:id/rounds/:round — Round data (candidates, votes, etc.)
router.get("/:id/rounds/:round", validateIdParams("id", "round"), async (req, res) => {
  try {
    const { id, round } = req.params;

    const [votesRes, candidatesRes] = await Promise.all([
      query(
        `SELECT voter, revealed, candidate_id, claimed, commit_block, reveal_block
         FROM votes WHERE novel_id = $1 AND round = $2
         ORDER BY commit_block ASC`,
        [id, round],
      ),
      query(
        `SELECT rc.chapter_id, rc.position, c.author, c.depth, c."timestamp", c.parent_id
         FROM round_candidates rc
         JOIN chapters c ON c.id = rc.chapter_id
         WHERE rc.novel_id = $1 AND rc.round = $2
         ORDER BY rc.position ASC`,
        [id, round],
      ),
    ]);

    res.json({ votes: votesRes.rows, candidates: candidatesRes.rows });
  } catch (err) {
    log.error({ err }, "GET /api/novels/:id/rounds/:round error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/novels/:id/forks — Fork children (paginated)
// Fork info is derived from root chapter's parentId pointing to a different novel
router.get("/:id/forks", validateIdParams("id"), async (req, res) => {
  try {
    const { id } = req.params;
    const { page, limit, offset } = parsePagination(req.query);

    const forksRes = await query(
      `SELECT n.id, n.creator, n.title, n.description, n.active,
              c.parent_id AS fork_source_chapter_id, n.pool_balance, n.created_at
       FROM novels n
       JOIN chapters c ON c.novel_id = n.id AND c.depth = 1
       JOIN chapters src ON src.id = c.parent_id AND src.novel_id = $1
       WHERE c.parent_id != 0
       ORDER BY n.created_at DESC
       LIMIT $2 OFFSET $3`,
      [id, limit, offset],
    );
    res.json({ forks: forksRes.rows, pagination: { page, limit } });
  } catch (err) {
    log.error({ err }, "GET /api/novels/:id/forks error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/novels/:id/rounds — List of rounds with per-round rewards summary
router.get("/:id/rounds", validateIdParams("id"), async (req, res) => {
  try {
    const { id } = req.params;
    const { page, limit, offset } = parsePagination(req.query);

    const roundsRes = await query(
      `SELECT round, creator_royalty, author_rewards, voter_rewards,
              total_voter_pool, ranked_candidates, block_number
       FROM round_rewards WHERE novel_id = $1
       ORDER BY round DESC LIMIT $2 OFFSET $3`,
      [id, limit, offset],
    );
    res.json({ rounds: roundsRes.rows, pagination: { page, limit } });
  } catch (err) {
    log.error({ err }, "GET /api/novels/:id/rounds error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/novels/:id/reward-summary — Aggregate prize-pool distribution across all rounds
router.get("/:id/reward-summary", validateIdParams("id"), async (req, res) => {
  try {
    const { id } = req.params;
    const sumRes = await query(
      `SELECT COUNT(*)::int AS rounds,
              COALESCE(SUM(creator_royalty), 0) AS total_creator_royalty,
              COALESCE(SUM(author_rewards), 0)  AS total_author_rewards,
              COALESCE(SUM(voter_rewards), 0)   AS total_voter_rewards
       FROM round_rewards WHERE novel_id = $1`,
      [id],
    );
    const keeperRes = await query(
      `SELECT COALESCE(SUM(amount), 0) AS total_keeper_rewards
       FROM keeper_rewards WHERE novel_id = $1`,
      [id],
    );
    res.json({ ...sumRes.rows[0], ...keeperRes.rows[0] });
  } catch (err) {
    log.error({ err }, "GET /api/novels/:id/reward-summary error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/novels/:id/stats
router.get("/:id/stats", validateIdParams("id"), async (req, res) => {
  const client = await getClient();
  try {
    const { id } = req.params;
    await client.query("BEGIN");
    await client.query("SET LOCAL statement_timeout = '3s'");
    const statsRes = await client.query(
      `SELECT
        (SELECT COUNT(*) FROM chapters WHERE novel_id = $1) AS chapter_count,
        (SELECT COUNT(DISTINCT author) FROM chapters WHERE novel_id = $1) AS author_count,
        (SELECT COUNT(*) FROM votes WHERE novel_id = $1) AS vote_count,
        (SELECT COALESCE(SUM(amount), 0) FROM tips WHERE novel_id = $1) AS total_tipped,
        (SELECT COUNT(*) FROM bounties WHERE novel_id = $1) AS bounty_count`,
      [id],
    );
    await client.query("COMMIT");
    res.json(statsRes.rows[0]);
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    log.error({ err }, "GET /api/novels/:id/stats error");
    res.status(500).json({ error: "Internal server error" });
  } finally {
    client.release();
  }
});

// GET /api/novels/:id/tips
router.get("/:id/tips", validateIdParams("id"), async (req, res) => {
  try {
    const { id } = req.params;
    const { page, limit, offset } = parsePagination(req.query);

    const tipsRes = await query(
      "SELECT * FROM tips WHERE novel_id = $1 ORDER BY block_number DESC LIMIT $2 OFFSET $3",
      [id, limit, offset],
    );
    res.json({ tips: tipsRes.rows });
  } catch (err) {
    log.error({ err }, "GET /api/novels/:id/tips error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/novels/:id/bounties — Bounties for a novel
router.get("/:id/bounties", validateIdParams("id"), async (req, res) => {
  try {
    const { id } = req.params;
    const { page, limit, offset } = parsePagination(req.query);

    const bountiesRes = await query(
      "SELECT * FROM bounties WHERE novel_id = $1 ORDER BY block_number DESC LIMIT $2 OFFSET $3",
      [id, limit, offset],
    );
    res.json({ bounties: bountiesRes.rows });
  } catch (err) {
    log.error({ err }, "GET /api/novels/:id/bounties error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
