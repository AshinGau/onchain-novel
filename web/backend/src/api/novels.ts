import { Router } from "express";

import { getClient, query } from "../db/index.js";
import { createLogger } from "../utils/logger.js";
import { isId, parsePagination, safeInt, validateIdParams } from "../utils/validate.js";

const log = createLogger("api:novels");
const router = Router();

// All :id / :round route params are enforced to be positive integers before hitting the DB.
router.use("/:id", validateIdParams("id"));
router.use("/:id/rounds/:round", validateIdParams("id", "round"));

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
        // Prefix-only ILIKE + 3-char minimum avoids worst-case full-table scans from `%x%`.
        if (search.length < 3) {
          return res.status(400).json({ error: "search term must be at least 3 characters" });
        }
        where += ` AND novels.title ILIKE $${paramIdx++}`;
        params.push(`${search.replace(/[%_]/g, "\\$&")}%`);
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
router.get("/:id", async (req, res) => {
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
router.get("/:id/tree", async (req, res) => {
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
router.get("/:id/worldlines", async (req, res) => {
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

// GET /api/novels/:id/rounds/:round — Round data (candidates, votes, etc.)
router.get("/:id/rounds/:round", async (req, res) => {
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
router.get("/:id/forks", async (req, res) => {
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
router.get("/:id/rounds", async (req, res) => {
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
router.get("/:id/reward-summary", async (req, res) => {
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
router.get("/:id/stats", async (req, res) => {
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
router.get("/:id/tips", async (req, res) => {
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
router.get("/:id/bounties", async (req, res) => {
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
