import { Router } from "express";
import { query } from "../db/index.js";

const router = Router();

// GET /api/bounties/:id — Single bounty detail
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const bountyRes = await query(
      `SELECT b.*, c.author AS chapter_author, c.depth, n.title AS novel_title
       FROM bounties b
       JOIN chapters c ON c.id = b.chapter_id
       JOIN novels n ON n.id = b.novel_id
       WHERE b.id = $1`,
      [id]
    );

    if (bountyRes.rows.length === 0) {
      return res.status(404).json({ error: "Bounty not found" });
    }

    res.json(bountyRes.rows[0]);
  } catch (err) {
    console.error("GET /api/bounties/:id error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
