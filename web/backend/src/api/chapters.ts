import { Router } from "express";
import { query } from "../db/index.js";
import { verifyWallet } from "../utils/auth.js";

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

    // Increment novel view count
    await query("UPDATE novels SET view_count = view_count + 1 WHERE id = $1", [chapterRes.rows[0].novel_id]);

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
    const ancestors: any[] = [];
    let currentId = id;

    // Walk up the parent chain (max 100 to prevent infinite loops)
    for (let i = 0; i < 100; i++) {
      const chRes = await query(
        `SELECT id, parent_id, author, chapter_index, content_text, content_fetched, is_canon
         FROM chapters WHERE id = $1`,
        [currentId]
      );
      if (chRes.rows.length === 0) break;
      ancestors.unshift(chRes.rows[0]);
      if (chRes.rows[0].parent_id === "0" || chRes.rows[0].parent_id === 0) break;
      currentId = chRes.rows[0].parent_id;
    }

    res.json({ ancestors });
  } catch (err) {
    console.error("GET /api/chapters/:id/context error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/chapters/:id/comments
router.get("/:id/comments", async (req, res) => {
  try {
    const { id } = req.params;
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(50, parseInt(req.query.limit as string) || 20);
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

    const commentRes = await query(
      "SELECT * FROM comments WHERE id = $1 AND chapter_id = $2 AND deleted = FALSE",
      [commentId, id]
    );
    if (commentRes.rows.length === 0) {
      return res.status(404).json({ error: "Comment not found" });
    }

    if (commentRes.rows[0].author_address?.toLowerCase() !== authorAddress?.toLowerCase()) {
      return res.status(403).json({ error: "Only the author can delete this comment" });
    }

    await query("UPDATE comments SET deleted = TRUE WHERE id = $1", [commentId]);
    res.json({ success: true });
  } catch (err) {
    console.error("DELETE /api/chapters/:id/comments/:commentId error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
