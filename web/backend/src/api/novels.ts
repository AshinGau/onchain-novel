import { Router } from "express";
import { query } from "../db/index.js";
import { safeInt } from "../utils/validate.js";

const router = Router();

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
    const page = safeInt(req.query.page, 1, 1, 1000);
    const limit = safeInt(req.query.limit, 20, 1, 50);
    const offset = (page - 1) * limit;
    const sort = (req.query.sort as string) || "latest";
    if (!SORT_OPTIONS[sort]) {
      return res.status(400).json({ error: `Invalid sort. Options: ${Object.keys(SORT_OPTIONS).join(", ")}` });
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
        where += ` AND novels.id = $${paramIdx++}`;
        params.push(parseInt(search));
      } else if (/^0x[0-9a-fA-F]+$/i.test(search)) {
        where += ` AND LOWER(novels.creator) = $${paramIdx++}`;
        params.push(search.toLowerCase());
      } else {
        where += ` AND novels.title ILIKE $${paramIdx++}`;
        params.push(`%${search}%`);
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
      [...params, limit, offset]
    );

    res.json({
      novels: novelsRes.rows,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (err) {
    console.error("GET /api/novels error:", err);
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
      [id]
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
    console.error("GET /api/novels/:id error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/novels/:id/tree — Story tree with depth pagination
// Query params: maxDepth (default 10) — load chapters up to this depth
router.get("/:id/tree", async (req, res) => {
  try {
    const { id } = req.params;
    const maxDepth = safeInt(req.query.maxDepth, 10, 1, 10000);

    const [chaptersRes, hasMoreRes] = await Promise.all([
      query(
        `SELECT id, parent_id, author, depth, "timestamp",
                is_world_line, declared_length, content_hash, created_at
         FROM chapters WHERE novel_id = $1 AND depth <= $2
         ORDER BY id ASC`,
        [id, maxDepth]
      ),
      query(
        `SELECT EXISTS(SELECT 1 FROM chapters WHERE novel_id = $1 AND depth > $2) AS has_more`,
        [id, maxDepth]
      ),
    ]);

    res.json({
      chapters: chaptersRes.rows,
      hasMore: hasMoreRes.rows[0]?.has_more ?? false,
      maxDepth,
    });
  } catch (err) {
    console.error("GET /api/novels/:id/tree error:", err);
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
      [id]
    );
    res.json({ worldlines: wlRes.rows });
  } catch (err) {
    console.error("GET /api/novels/:id/worldlines error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/novels/:id/rounds/:round — Round data (candidates, votes, etc.)
router.get("/:id/rounds/:round", async (req, res) => {
  try {
    const { id, round } = req.params;

    // Get votes for this round
    const votesRes = await query(
      `SELECT voter, revealed, candidate_id, claimed, commit_block, reveal_block
       FROM votes WHERE novel_id = $1 AND round = $2
       ORDER BY commit_block ASC`,
      [id, round]
    );

    res.json({ votes: votesRes.rows });
  } catch (err) {
    console.error("GET /api/novels/:id/rounds/:round error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/novels/:id/forks — Fork children
// Fork info is derived from root chapter's parentId pointing to a different novel
router.get("/:id/forks", async (req, res) => {
  try {
    const { id } = req.params;
    // Find novels whose root chapter has a parentId that is a chapter in this novel
    const forksRes = await query(
      `SELECT n.id, n.creator, n.title, n.description, n.active,
              c.parent_id AS fork_source_chapter_id, n.pool_balance, n.created_at
       FROM novels n
       JOIN chapters c ON c.novel_id = n.id AND c.depth = 1
       JOIN chapters src ON src.id = c.parent_id AND src.novel_id = $1
       WHERE c.parent_id != 0
       ORDER BY n.created_at DESC`,
      [id]
    );
    res.json({ forks: forksRes.rows });
  } catch (err) {
    console.error("GET /api/novels/:id/forks error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/novels/:id/stats
router.get("/:id/stats", async (req, res) => {
  try {
    const { id } = req.params;
    const statsRes = await query(
      `SELECT
        (SELECT COUNT(*) FROM chapters WHERE novel_id = $1) AS chapter_count,
        (SELECT COUNT(DISTINCT author) FROM chapters WHERE novel_id = $1) AS author_count,
        (SELECT COUNT(*) FROM votes WHERE novel_id = $1) AS vote_count,
        (SELECT COALESCE(SUM(amount), 0) FROM tips WHERE novel_id = $1) AS total_tipped,
        (SELECT COUNT(*) FROM bounties WHERE novel_id = $1) AS bounty_count`,
      [id]
    );
    res.json(statsRes.rows[0]);
  } catch (err) {
    console.error("GET /api/novels/:id/stats error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/novels/:id/tips
router.get("/:id/tips", async (req, res) => {
  try {
    const { id } = req.params;
    const page = safeInt(req.query.page, 1, 1, 1000);
    const limit = safeInt(req.query.limit, 20, 1, 50);
    const offset = (page - 1) * limit;

    const tipsRes = await query(
      "SELECT * FROM tips WHERE novel_id = $1 ORDER BY block_number DESC LIMIT $2 OFFSET $3",
      [id, limit, offset]
    );
    res.json({ tips: tipsRes.rows });
  } catch (err) {
    console.error("GET /api/novels/:id/tips error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/novels/:id/bounties — Bounties for a novel
router.get("/:id/bounties", async (req, res) => {
  try {
    const { id } = req.params;
    const page = safeInt(req.query.page, 1, 1, 1000);
    const limit = safeInt(req.query.limit, 20, 1, 50);
    const offset = (page - 1) * limit;

    const bountiesRes = await query(
      "SELECT * FROM bounties WHERE novel_id = $1 ORDER BY block_number DESC LIMIT $2 OFFSET $3",
      [id, limit, offset]
    );
    res.json({ bounties: bountiesRes.rows });
  } catch (err) {
    console.error("GET /api/novels/:id/bounties error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
