import { Router } from "express";
import { query } from "../db/index.js";

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

export default router;
