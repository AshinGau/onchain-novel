import { Router } from "express";
import { query } from "../db/index.js";
import { verifyEip191 } from "../utils/auth.js";
import { safeInt } from "../utils/validate.js";

const router = Router();

// Per-address rate limit for comments: 10 per chapter per hour, enforced inline
const COMMENT_WINDOW_MS = 60 * 60 * 1000;
const COMMENT_MAX_PER_WINDOW = 10;
// Reject signed messages older than this (replay protection)
const COMMENT_TIMESTAMP_TOLERANCE_MS = 5 * 60 * 1000;

// GET /api/chapters/:id — Chapter detail with content
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const chapterRes = await query(
      `SELECT c.*, n.title AS novel_title, n.config
       FROM chapters c
       JOIN novels n ON n.id = c.novel_id
       WHERE c.id = $1`,
      [id]
    );

    if (chapterRes.rows.length === 0) {
      return res.status(404).json({ error: "Chapter not found" });
    }

    res.json(chapterRes.rows[0]);
  } catch (err) {
    console.error("GET /api/chapters/:id error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/chapters/:id/siblings — Same parent chapters
router.get("/:id/siblings", async (req, res) => {
  try {
    const { id } = req.params;
    const chapterRes = await query("SELECT parent_id, novel_id FROM chapters WHERE id = $1", [id]);
    if (chapterRes.rows.length === 0) {
      return res.status(404).json({ error: "Chapter not found" });
    }

    const { parent_id, novel_id } = chapterRes.rows[0];
    const siblingsRes = await query(
      `SELECT id, author, depth, "timestamp", is_world_line, declared_length
       FROM chapters WHERE novel_id = $1 AND parent_id = $2 AND id != $3
       ORDER BY "timestamp" DESC`,
      [novel_id, parent_id, id]
    );

    res.json({ siblings: siblingsRes.rows });
  } catch (err) {
    console.error("GET /api/chapters/:id/siblings error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/chapters/:id/children — Direct children
router.get("/:id/children", async (req, res) => {
  try {
    const { id } = req.params;
    const childrenRes = await query(
      `SELECT id, author, depth, "timestamp", is_world_line, declared_length
       FROM chapters WHERE parent_id = $1
       ORDER BY "timestamp" DESC`,
      [id]
    );
    res.json({ children: childrenRes.rows });
  } catch (err) {
    console.error("GET /api/chapters/:id/children error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/chapters/:id/context — Ancestor chain for writing context
router.get("/:id/context", async (req, res) => {
  try {
    const { id } = req.params;

    const ancestorsRes = await query(
      `WITH RECURSIVE chain AS (
         SELECT id, parent_id, author, depth, content_text, content_fetched, is_world_line, 0 AS chain_depth
         FROM chapters WHERE id = $1
         UNION ALL
         SELECT c.id, c.parent_id, c.author, c.depth, c.content_text, c.content_fetched, c.is_world_line, chain.chain_depth + 1
         FROM chapters c
         INNER JOIN chain ON c.id = chain.parent_id
         WHERE chain.parent_id != '0' AND chain.parent_id::bigint > 0 AND chain.chain_depth < 100
       )
       SELECT id, parent_id, author, depth, content_text, content_fetched, is_world_line
       FROM chain ORDER BY chain_depth DESC`,
      [id]
    );

    res.json({ ancestors: ancestorsRes.rows });
  } catch (err) {
    console.error("GET /api/chapters/:id/context error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/chapters/:id/comments
router.get("/:id/comments", async (req, res) => {
  try {
    const { id } = req.params;
    const page = safeInt(req.query.page, 1, 1, 1000);
    const limit = safeInt(req.query.limit, 20, 1, 50);
    const offset = (page - 1) * limit;

    const commentsRes = await query(
      "SELECT id, chapter_id, author, content, created_at FROM comments WHERE chapter_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3",
      [id, limit, offset]
    );
    res.json({ comments: commentsRes.rows });
  } catch (err) {
    console.error("GET /api/chapters/:id/comments error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/chapters/:id/comments — Append a new comment (EIP-191 signed)
//
// Request body: { address, content, timestamp, signature }
// Canonical message format:  Comment on chapter {id} at {timestamp}: {content}
// Reject if: signature mismatch, timestamp too old, rate limit exceeded.
router.post("/:id/comments", async (req, res) => {
  try {
    const { id } = req.params;
    const { address, content, timestamp, signature } = req.body ?? {};

    if (typeof address !== "string" || typeof signature !== "string") {
      return res.status(400).json({ error: "address and signature are required" });
    }
    if (typeof content !== "string" || content.trim().length === 0) {
      return res.status(400).json({ error: "content is required" });
    }
    if (content.length > 5000) {
      return res.status(400).json({ error: "content must be 5000 characters or less" });
    }
    const ts = Number(timestamp);
    if (!Number.isFinite(ts) || ts <= 0) {
      return res.status(400).json({ error: "timestamp is required (unix seconds)" });
    }

    // Replay protection: timestamp must be within tolerance window
    const nowMs = Date.now();
    if (Math.abs(nowMs - ts * 1000) > COMMENT_TIMESTAMP_TOLERANCE_MS) {
      return res.status(400).json({ error: "timestamp out of tolerance window" });
    }

    // Verify chapter exists
    const chapterRes = await query("SELECT id FROM chapters WHERE id = $1", [id]);
    if (chapterRes.rows.length === 0) {
      return res.status(404).json({ error: "chapter not found" });
    }

    // Verify EIP-191 signature against canonical message
    const message = `Comment on chapter ${id} at ${ts}: ${content}`;
    const verified = await verifyEip191(address, message, signature);
    if (!verified) {
      return res.status(401).json({ error: "invalid signature" });
    }

    // Per-address rate limit on this chapter
    const rateRes = await query(
      "SELECT COUNT(*)::int AS n FROM comments WHERE chapter_id = $1 AND LOWER(author) = $2 AND created_at > NOW() - ($3 || ' milliseconds')::interval",
      [id, verified, COMMENT_WINDOW_MS]
    );
    if (rateRes.rows[0].n >= COMMENT_MAX_PER_WINDOW) {
      return res.status(429).json({ error: "rate limit exceeded for this chapter" });
    }

    const result = await query(
      "INSERT INTO comments (chapter_id, author, content, signature) VALUES ($1, $2, $3, $4) RETURNING id, chapter_id, author, content, created_at",
      [id, verified, content.trim(), signature]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("POST /api/chapters/:id/comments error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/chapters/:id/bounties — Bounties targeting this chapter
router.get("/:id/bounties", async (req, res) => {
  try {
    const { id } = req.params;
    const bountiesRes = await query(
      "SELECT * FROM bounties WHERE chapter_id = $1 ORDER BY block_number DESC",
      [id]
    );
    res.json({ bounties: bountiesRes.rows });
  } catch (err) {
    console.error("GET /api/chapters/:id/bounties error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/chapters/:id/tips — Tips for this chapter
router.get("/:id/tips", async (req, res) => {
  try {
    const { id } = req.params;
    const tipsRes = await query(
      "SELECT * FROM chapter_tips WHERE chapter_id = $1 ORDER BY block_number DESC",
      [id]
    );
    res.json({ tips: tipsRes.rows });
  } catch (err) {
    console.error("GET /api/chapters/:id/tips error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
