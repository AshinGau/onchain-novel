import { Router } from "express";
import { query } from "../db/index.js";
import { verifyWallet } from "../utils/auth.js";
import { safeInt } from "../utils/validate.js";

const router = Router();

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
      `SELECT id, author, chapter_index, vote_count, is_world_line, is_canon, declared_length
       FROM chapters WHERE novel_id = $1 AND parent_id = $2 AND id != $3
       ORDER BY vote_count DESC`,
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
      `SELECT id, author, chapter_index, vote_count, is_world_line, is_canon, declared_length
       FROM chapters WHERE parent_id = $1
       ORDER BY vote_count DESC`,
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
         SELECT id, parent_id, author, chapter_index, content_text, content_fetched, is_canon, 0 AS depth
         FROM chapters WHERE id = $1
         UNION ALL
         SELECT c.id, c.parent_id, c.author, c.chapter_index, c.content_text, c.content_fetched, c.is_canon, chain.depth + 1
         FROM chapters c
         INNER JOIN chain ON c.id = chain.parent_id
         WHERE chain.parent_id != '0' AND chain.parent_id::bigint > 0 AND chain.depth < 100
       )
       SELECT id, parent_id, author, chapter_index, content_text, content_fetched, is_canon
       FROM chain ORDER BY depth DESC`,
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
      "SELECT * FROM comments WHERE chapter_id = $1 AND deleted = FALSE ORDER BY created_at DESC LIMIT $2 OFFSET $3",
      [id, limit, offset]
    );
    res.json({ comments: commentsRes.rows });
  } catch (err) {
    console.error("GET /api/chapters/:id/comments error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/chapters/:id/comments — Create a comment (requires wallet signature)
router.post("/:id/comments", verifyWallet, async (req, res) => {
  try {
    const { id } = req.params;
    const { content } = req.body;
    const authorAddress = req.verifiedAddress;

    if (!content || typeof content !== "string" || content.trim().length === 0) {
      return res.status(400).json({ error: "Content is required" });
    }
    if (content.length > 5000) {
      return res.status(400).json({ error: "Content must be 5000 characters or less" });
    }

    // Verify chapter exists
    const chapterRes = await query("SELECT id FROM chapters WHERE id = $1", [id]);
    if (chapterRes.rows.length === 0) {
      return res.status(404).json({ error: "Chapter not found" });
    }

    const result = await query(
      "INSERT INTO comments (chapter_id, author_address, content) VALUES ($1, $2, $3) RETURNING *",
      [id, authorAddress || null, content.trim()]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("POST /api/chapters/:id/comments error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /api/chapters/:id/comments/:commentId — Soft-delete (requires wallet signature)
router.delete("/:id/comments/:commentId", verifyWallet, async (req, res) => {
  try {
    const { id, commentId } = req.params;
    const authorAddress = req.verifiedAddress;

    // Atomic: delete only if owned by this address
    const result = await query(
      "UPDATE comments SET deleted = TRUE WHERE id = $1 AND chapter_id = $2 AND deleted = FALSE AND LOWER(author_address) = LOWER($3) RETURNING id",
      [commentId, id, authorAddress]
    );
    if (result.rows.length === 0) {
      return res.status(403).json({ error: "Comment not found or not owned by you" });
    }
    res.json({ success: true });
  } catch (err) {
    console.error("DELETE /api/chapters/:id/comments/:commentId error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
