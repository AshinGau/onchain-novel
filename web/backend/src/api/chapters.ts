import { Router } from "express";

import { getClient, query } from "../db/index.js";
import { verifyEip191 } from "../utils/auth.js";
import { createLogger } from "../utils/logger.js";
import { isAddress, parsePagination, safeInt, validateIdParams } from "../utils/validate.js";

const log = createLogger("api:chapters");
const router = Router();

// Per-address rate limit for comments: 10 per chapter per hour, enforced inline
const COMMENT_WINDOW_MS = 60 * 60 * 1000;
const COMMENT_MAX_PER_WINDOW = 10;
// Reject signed messages older than this (replay protection)
const COMMENT_TIMESTAMP_TOLERANCE_MS = 60 * 1000;

// GET /api/chapters/:id — Chapter detail with content
router.get("/:id", validateIdParams("id"), async (req, res) => {
  try {
    const { id } = req.params;
    const chapterRes = await query(
      `SELECT c.*, n.title AS novel_title, n.config
       FROM chapters c
       JOIN novels n ON n.id = c.novel_id
       WHERE c.id = $1`,
      [id],
    );

    if (chapterRes.rows.length === 0) {
      return res.status(404).json({ error: "Chapter not found" });
    }

    res.json(chapterRes.rows[0]);
  } catch (err) {
    log.error({ err }, "GET /api/chapters/:id error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/chapters/:id/siblings — Same parent chapters
router.get("/:id/siblings", validateIdParams("id"), async (req, res) => {
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
      [novel_id, parent_id, id],
    );

    res.json({ siblings: siblingsRes.rows });
  } catch (err) {
    log.error({ err }, "GET /api/chapters/:id/siblings error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/chapters/:id/children — Direct children (paginated)
router.get("/:id/children", validateIdParams("id"), async (req, res) => {
  try {
    const { id } = req.params;
    const { page, limit, offset } = parsePagination(req.query, {
      defaultLimit: 50,
      maxLimit: 200,
    });

    const [childrenRes, countRes] = await Promise.all([
      query(
        `SELECT id, author, depth, "timestamp", is_world_line, declared_length
         FROM chapters WHERE parent_id = $1
         ORDER BY "timestamp" DESC, id DESC
         LIMIT $2 OFFSET $3`,
        [id, limit, offset],
      ),
      query(`SELECT COUNT(*)::int AS n FROM chapters WHERE parent_id = $1`, [id]),
    ]);
    res.json({
      children: childrenRes.rows,
      pagination: { page, limit, total: countRes.rows[0]?.n ?? 0 },
    });
  } catch (err) {
    log.error({ err }, "GET /api/chapters/:id/children error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/chapters/:id/context — Ancestor chain for writing context
router.get("/:id/context", validateIdParams("id"), async (req, res) => {
  const client = await getClient();
  try {
    const { id } = req.params;
    const maxDepth = safeInt(req.query.maxDepth, 100, 1, 200);

    await client.query("BEGIN");
    await client.query("SET LOCAL statement_timeout = '3s'");
    const ancestorsRes = await client.query(
      `WITH RECURSIVE chain AS (
         SELECT id, parent_id, author, depth, content_text, content_fetched, is_world_line, "timestamp", 0 AS chain_depth
         FROM chapters WHERE id = $1
         UNION ALL
         SELECT c.id, c.parent_id, c.author, c.depth, c.content_text, c.content_fetched, c.is_world_line, c."timestamp", chain.chain_depth + 1
         FROM chapters c
         INNER JOIN chain ON c.id = chain.parent_id
         WHERE chain.parent_id != 0 AND chain.chain_depth < $2
       )
       SELECT id, parent_id, author, depth, content_text, content_fetched, is_world_line, "timestamp"
       FROM chain ORDER BY chain_depth DESC`,
      [id, maxDepth],
    );
    await client.query("COMMIT");

    res.json({ ancestors: ancestorsRes.rows });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    log.error({ err }, "GET /api/chapters/:id/context error");
    res.status(500).json({ error: "Internal server error" });
  } finally {
    client.release();
  }
});

// GET /api/chapters/:id/comments
router.get("/:id/comments", validateIdParams("id"), async (req, res) => {
  try {
    const { id } = req.params;
    const { page, limit, offset } = parsePagination(req.query);

    const commentsRes = await query(
      "SELECT id, chapter_id, author, content, created_at FROM comments WHERE chapter_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3",
      [id, limit, offset],
    );
    res.json({ comments: commentsRes.rows });
  } catch (err) {
    log.error({ err }, "GET /api/chapters/:id/comments error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/chapters/:id/comments — Append a new comment (EIP-191 signed)
//
// Request body: { address, content, timestamp, signature }
// Canonical message format:  Comment on chapter {id} at {timestamp}: {content}
// Reject if: signature mismatch, timestamp too old, rate limit exceeded.
router.post("/:id/comments", validateIdParams("id"), async (req, res) => {
  try {
    const { id } = req.params;
    const { address, content, timestamp, signature } = req.body ?? {};

    if (!isAddress(address) || typeof signature !== "string") {
      return res.status(400).json({ error: "address and signature are required" });
    }
    if (typeof content !== "string") {
      return res.status(400).json({ error: "content is required" });
    }
    // Canonicalize BEFORE signature check so client/server agree on the signed bytes.
    const cleanContent = content.trim();
    if (cleanContent.length === 0) {
      return res.status(400).json({ error: "content is required" });
    }
    if (cleanContent.length > 5000) {
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

    // Verify EIP-191 signature against canonical message (uses the same trimmed content that will be persisted)
    const message = `Comment on chapter ${id} at ${ts}: ${cleanContent}`;
    const verified = await verifyEip191(address, message, signature);
    if (!verified) {
      return res.status(401).json({ error: "invalid signature" });
    }

    // Per-address rate limit on this chapter
    const rateRes = await query(
      "SELECT COUNT(*)::int AS n FROM comments WHERE chapter_id = $1 AND author = $2 AND created_at > NOW() - ($3 || ' milliseconds')::interval",
      [id, verified, COMMENT_WINDOW_MS],
    );
    if (rateRes.rows[0].n >= COMMENT_MAX_PER_WINDOW) {
      return res.status(429).json({ error: "rate limit exceeded for this chapter" });
    }

    const result = await query(
      "INSERT INTO comments (chapter_id, author, content, signature) VALUES ($1, $2, $3, $4) RETURNING id, chapter_id, author, content, created_at",
      [id, verified, cleanContent, signature],
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    log.error({ err }, "POST /api/chapters/:id/comments error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/chapters/:id/bounties — Bounties targeting this chapter (paginated)
router.get("/:id/bounties", validateIdParams("id"), async (req, res) => {
  try {
    const { id } = req.params;
    const { page, limit, offset } = parsePagination(req.query);
    const bountiesRes = await query(
      "SELECT * FROM bounties WHERE chapter_id = $1 ORDER BY block_number DESC LIMIT $2 OFFSET $3",
      [id, limit, offset],
    );
    res.json({ bounties: bountiesRes.rows, pagination: { page, limit } });
  } catch (err) {
    log.error({ err }, "GET /api/chapters/:id/bounties error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/chapters/:id/tips — Tips for this chapter (paginated)
router.get("/:id/tips", validateIdParams("id"), async (req, res) => {
  try {
    const { id } = req.params;
    const { page, limit, offset } = parsePagination(req.query);
    const tipsRes = await query(
      "SELECT * FROM chapter_tips WHERE chapter_id = $1 ORDER BY block_number DESC LIMIT $2 OFFSET $3",
      [id, limit, offset],
    );
    res.json({ tips: tipsRes.rows, pagination: { page, limit } });
  } catch (err) {
    log.error({ err }, "GET /api/chapters/:id/tips error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
