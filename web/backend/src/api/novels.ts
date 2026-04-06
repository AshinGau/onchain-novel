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
      `SELECT id, creator, title, description, cover_uri, config, current_round, current_epoch,
              round_phase, epoch_phase, phase_start_time, bootstrap_chapter_count,
              cumulative_canon_chapters, active, fork_source_novel_id, fork_source_chapter_id,
              pool_balance, total_tipped, total_funded, view_count, last_chapter_at, created_at,
              (SELECT COUNT(*) FROM chapters WHERE novel_id = novels.id) AS chapter_count,
              (SELECT COUNT(DISTINCT author) FROM chapters WHERE novel_id = novels.id) AS author_count
       FROM novels WHERE ${where}
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

// GET /api/novels/ranking — Top novels by sort criteria
router.get("/ranking", async (req, res) => {
  try {
    const sort = (req.query.sort as string) || "hot";
    if (!SORT_OPTIONS[sort]) {
      return res.status(400).json({ error: `Invalid sort. Options: ${Object.keys(SORT_OPTIONS).join(", ")}` });
    }
    const limit = safeInt(req.query.limit, 10, 1, 50);

    const orderBy = SORT_OPTIONS[sort] || SORT_OPTIONS.hot;

    const novelsRes = await query(
      `SELECT id, creator, title, description, cover_uri, active,
              pool_balance, total_tipped, total_funded, view_count,
              current_round, current_epoch, round_phase, epoch_phase,
              (SELECT COUNT(*) FROM chapters WHERE novel_id = novels.id) AS chapter_count
       FROM novels
       ORDER BY ${orderBy}
       LIMIT $1`,
      [limit]
    );

    res.json({ novels: novelsRes.rows });
  } catch (err) {
    console.error("GET /api/novels/ranking error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/novels/:id — Novel detail
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const novelRes = await query(
      `SELECT n.*,
              (SELECT COUNT(*) FROM chapters WHERE novel_id = n.id) AS chapter_count,
              (SELECT COUNT(DISTINCT author) FROM chapters WHERE novel_id = n.id) AS author_count
       FROM novels n WHERE n.id = $1`,
      [id]
    );

    if (novelRes.rows.length === 0) {
      return res.status(404).json({ error: "Novel not found" });
    }

    // Increment view count
    await query("UPDATE novels SET view_count = view_count + 1 WHERE id = $1", [id]);

    res.json(novelRes.rows[0]);
  } catch (err) {
    console.error("GET /api/novels/:id error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/novels/:id/tree — Story tree chapters, optionally filtered by epoch
router.get("/:id/tree", async (req, res) => {
  try {
    const { id } = req.params;
    const epochParam = req.query.epoch;

    if (epochParam !== undefined) {
      const epoch = safeInt(epochParam, 0, 0, 1000000);

      // Epoch 0 (genesis) merges into epoch 1 in the UI
      const epochCondition = epoch <= 1 ? "(epoch = 0 OR epoch = 1)" : "epoch = $2";
      const params = epoch <= 1 ? [id] : [id, epoch];

      const chaptersRes = await query(
        `SELECT id, parent_id, author, chapter_index, round, epoch, vote_count,
                is_world_line, is_canon, declared_length, content_hash, created_at
         FROM chapters WHERE novel_id = $1 AND ${epochCondition}
         ORDER BY id ASC`,
        params
      );

      // For epoch >= 2, fetch anchor chapters (parents from previous epochs)
      let anchors: typeof chaptersRes.rows = [];
      if (epoch >= 2) {
        const chapterIds = new Set(chaptersRes.rows.map((c) => c.id as string));
        const externalParentIds = chaptersRes.rows
          .map((c) => c.parent_id as string)
          .filter((pid) => pid && pid !== "0" && !chapterIds.has(pid));

        if (externalParentIds.length > 0) {
          const unique = [...new Set(externalParentIds)];
          const placeholders = unique.map((_: string, i: number) => `$${i + 2}`).join(",");
          const anchorRes = await query(
            `SELECT id, parent_id, author, chapter_index, round, epoch, vote_count,
                    is_world_line, is_canon, declared_length, content_hash, created_at
             FROM chapters WHERE novel_id = $1 AND id IN (${placeholders})`,
            [id, ...unique]
          );
          anchors = anchorRes.rows;
        }
      }

      res.json({ chapters: chaptersRes.rows, anchors });
    } else {
      // No epoch filter — return all chapters
      const chaptersRes = await query(
        `SELECT id, parent_id, author, chapter_index, round, epoch, vote_count,
                is_world_line, is_canon, declared_length, content_hash, created_at
         FROM chapters WHERE novel_id = $1
         ORDER BY id ASC`,
        [id]
      );
      res.json({ chapters: chaptersRes.rows });
    }
  } catch (err) {
    console.error("GET /api/novels/:id/tree error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/novels/:id/canon — Canon chapter chain ordered by chapterIndex
router.get("/:id/canon", async (req, res) => {
  try {
    const { id } = req.params;
    const canonRes = await query(
      `SELECT id, parent_id, author, content_hash, declared_length, chapter_index,
              round, epoch, vote_count, content_text, content_fetched
       FROM chapters WHERE novel_id = $1 AND is_canon = TRUE
       ORDER BY chapter_index ASC`,
      [id]
    );
    res.json({ chapters: canonRes.rows });
  } catch (err) {
    console.error("GET /api/novels/:id/canon error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/novels/:id/worldlines — Current active world lines
router.get("/:id/worldlines", async (req, res) => {
  try {
    const { id } = req.params;
    const wlRes = await query(
      `SELECT id, parent_id, author, content_hash, chapter_index, round, epoch, vote_count
       FROM chapters WHERE novel_id = $1 AND is_world_line = TRUE
       ORDER BY id ASC`,
      [id]
    );
    res.json({ worldlines: wlRes.rows });
  } catch (err) {
    console.error("GET /api/novels/:id/worldlines error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/novels/:id/rounds/:round — Round submissions
router.get("/:id/rounds/:round", async (req, res) => {
  try {
    const { id, round } = req.params;
    const { epoch } = req.query;
    const chaptersRes = await query(
      `SELECT c.id, c.parent_id, c.author, c.content_hash, c.declared_length, c.chapter_index,
              c.vote_count, c.is_world_line, c.content_text, c.content_fetched,
              (SELECT COUNT(*) FROM comments WHERE chapter_id = c.id AND deleted = FALSE) AS comment_count
       FROM chapters c WHERE c.novel_id = $1 AND c.round = $2 AND c.epoch = $3
       ORDER BY c.vote_count DESC`,
      [id, round, epoch]
    );
    res.json({ chapters: chaptersRes.rows });
  } catch (err) {
    console.error("GET /api/novels/:id/rounds/:round error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/novels/:id/forks — Fork children
router.get("/:id/forks", async (req, res) => {
  try {
    const { id } = req.params;
    const forksRes = await query(
      `SELECT id, creator, title, description, active, fork_source_chapter_id,
              pool_balance, created_at
       FROM novels WHERE fork_source_novel_id = $1
       ORDER BY created_at DESC`,
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
        (SELECT COUNT(*) FROM chapters WHERE novel_id = $1 AND is_canon = TRUE) AS canon_count,
        (SELECT COUNT(*) FROM chapter_nfts WHERE novel_id = $1) AS nft_count`,
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

export default router;
