import { Router } from "express";
import { query } from "../db/index.js";
import { validateAddress, safeInt } from "../utils/validate.js";

const router = Router();

// Validate address on all routes
router.use("/:address", validateAddress);
router.use("/:address/*", validateAddress);

// GET /api/users/:address/votes — User voting history
router.get("/:address/votes", async (req, res) => {
  try {
    const { address } = req.params;
    const addr = address.toLowerCase();
    const page = safeInt(req.query.page, 1, 1, 1000);
    const limit = safeInt(req.query.limit, 20, 1, 50);
    const offset = (page - 1) * limit;

    const votesRes = await query(
      `SELECT v.*, n.title AS novel_title, n.round_phase
       FROM votes v
       LEFT JOIN novels n ON n.id = v.novel_id
       WHERE LOWER(v.voter) = $1
       ORDER BY v.commit_block DESC
       LIMIT $2 OFFSET $3`,
      [addr, limit, offset]
    );

    const countRes = await query(
      "SELECT COUNT(*) FROM votes WHERE LOWER(voter) = $1",
      [addr]
    );

    res.json({
      votes: votesRes.rows,
      total: parseInt(countRes.rows[0].count),
    });
  } catch (err) {
    console.error("GET /api/users/:address/votes error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/users/:address/rewards — Reward summary
router.get("/:address/rewards", async (req, res) => {
  try {
    const { address } = req.params;
    const addr = address.toLowerCase();

    // Unclaimed voting rewards (revealed but not claimed)
    const unclaimedVotesRes = await query(
      `SELECT v.novel_id, v.round, n.title AS novel_title
       FROM votes v
       LEFT JOIN novels n ON n.id = v.novel_id
       WHERE LOWER(v.voter) = $1 AND v.revealed = TRUE AND v.claimed = FALSE`,
      [addr]
    );

    // Past reward claims
    const claimsRes = await query(
      `SELECT rc.novel_id, rc.source, SUM(rc.amount) AS total_amount, n.title AS novel_title
       FROM reward_claims rc
       LEFT JOIN novels n ON n.id = rc.novel_id
       WHERE LOWER(rc.claimant) = $1
       GROUP BY rc.novel_id, rc.source, n.title`,
      [addr]
    );

    // Novels the user participated in (as author or voter)
    const novelsRes = await query(
      `SELECT DISTINCT t.novel_id, n.title AS novel_title FROM (
         SELECT novel_id FROM chapters WHERE LOWER(author) = $1
         UNION
         SELECT novel_id FROM votes WHERE LOWER(voter) = $1
       ) t
       LEFT JOIN novels n ON n.id = t.novel_id
       ORDER BY t.novel_id DESC`,
      [addr]
    );

    res.json({
      unclaimedVotes: unclaimedVotesRes.rows,
      rewardClaims: claimsRes.rows,
      participatedNovels: novelsRes.rows.map(r => ({ novel_id: r.novel_id, novel_title: r.novel_title || "" })),
    });
  } catch (err) {
    console.error("GET /api/users/:address/rewards error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/users/:address/chapters — User's submitted chapters
router.get("/:address/chapters", async (req, res) => {
  try {
    const { address } = req.params;
    const addr = address.toLowerCase();

    const chaptersRes = await query(
      `SELECT c.id, c.novel_id, c.depth, c."timestamp",
              c.is_world_line, c.created_at, n.title AS novel_title
       FROM chapters c
       LEFT JOIN novels n ON n.id = c.novel_id
       WHERE LOWER(c.author) = $1
       ORDER BY c.created_at DESC`,
      [addr]
    );

    res.json({ chapters: chaptersRes.rows });
  } catch (err) {
    console.error("GET /api/users/:address/chapters error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
