import { Router } from "express";
import { query } from "../db/index.js";

const router = Router();

// GET /api/users/:address/votes — User voting history
router.get("/:address/votes", async (req, res) => {
  try {
    const { address } = req.params;
    const addr = address.toLowerCase();
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(50, parseInt(req.query.limit as string) || 20);
    const offset = (page - 1) * limit;

    const votesRes = await query(
      `SELECT v.*, n.title AS novel_title
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
      `SELECT v.novel_id, v.voting_round_id, n.title AS novel_title
       FROM votes v
       LEFT JOIN novels n ON n.id = v.novel_id
       WHERE LOWER(v.voter) = $1 AND v.revealed = TRUE AND v.claimed = FALSE`,
      [addr]
    );

    // Stake events
    const stakeRes = await query(
      `SELECT se.novel_id, se.event_type, SUM(se.amount) AS total_amount, n.title AS novel_title
       FROM stake_events se
       LEFT JOIN novels n ON n.id = se.novel_id
       WHERE LOWER(se.author) = $1
       GROUP BY se.novel_id, se.event_type, n.title`,
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
      `SELECT DISTINCT novel_id FROM (
         SELECT novel_id FROM chapters WHERE LOWER(author) = $1
         UNION
         SELECT novel_id FROM votes WHERE LOWER(voter) = $1
       ) t`,
      [addr]
    );

    res.json({
      unclaimedVotes: unclaimedVotesRes.rows,
      stakeEvents: stakeRes.rows,
      rewardClaims: claimsRes.rows,
      participatedNovelIds: novelsRes.rows.map(r => r.novel_id),
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
      `SELECT c.id, c.novel_id, c.chapter_index, c.round, c.epoch, c.vote_count,
              c.is_world_line, c.is_canon, c.created_at, n.title AS novel_title
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

// GET /api/users/:address/nfts — User's chapter NFTs
router.get("/:address/nfts", async (req, res) => {
  try {
    const { address } = req.params;
    const addr = address.toLowerCase();

    const nftsRes = await query(
      `SELECT cn.*, n.title AS novel_title
       FROM chapter_nfts cn
       LEFT JOIN novels n ON n.id = cn.novel_id
       WHERE LOWER(cn.author) = $1
       ORDER BY cn.block_number DESC`,
      [addr]
    );

    res.json({ nfts: nftsRes.rows });
  } catch (err) {
    console.error("GET /api/users/:address/nfts error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
