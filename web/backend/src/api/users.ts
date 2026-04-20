import { Router } from "express";

import { query } from "../db/index.js";
import { createLogger } from "../utils/logger.js";
import { parsePagination, validateAddress } from "../utils/validate.js";

const log = createLogger("api:users");
const router = Router();

// GET /api/users/nicknames/batch — Batch lookup nicknames for multiple addresses
router.get("/nicknames/batch", async (req, res) => {
  try {
    const addresses = (req.query.addresses as string)
      ?.split(",")
      .map((a) => a.toLowerCase())
      .filter(Boolean);
    if (!addresses || addresses.length === 0) {
      res.json({ nicknames: {} });
      return;
    }
    const limited = addresses.slice(0, 100);
    const placeholders = limited.map((_, i) => `$${i + 1}`).join(",");
    const result = await query(
      `SELECT address, nickname FROM nicknames WHERE address IN (${placeholders})`,
      limited,
    );
    const map: Record<string, string> = {};
    for (const row of result.rows) {
      map[row.address] = row.nickname;
    }
    res.json({ nicknames: map });
  } catch (err) {
    log.error({ err }, "GET /api/users/nicknames/batch error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/users/:address/votes — User voting history
router.get("/:address/votes", validateAddress, async (req, res) => {
  try {
    const { address } = req.params as { address: string };
    const addr = address.toLowerCase();
    const { page, limit, offset } = parsePagination(req.query);

    const votesRes = await query(
      `SELECT v.*, n.title AS novel_title, n.round_phase
       FROM votes v
       LEFT JOIN novels n ON n.id = v.novel_id
       WHERE v.voter = $1
       ORDER BY v.commit_block DESC
       LIMIT $2 OFFSET $3`,
      [addr, limit, offset],
    );

    const countRes = await query("SELECT COUNT(*) FROM votes WHERE voter = $1", [addr]);

    res.json({
      votes: votesRes.rows,
      total: parseInt(countRes.rows[0].count),
    });
  } catch (err) {
    log.error({ err }, "GET /api/users/:address/votes error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/users/:address/rewards — Reward summary
router.get("/:address/rewards", validateAddress, async (req, res) => {
  try {
    const { address } = req.params as { address: string };
    const addr = address.toLowerCase();

    // Unclaimed voting rewards (revealed but not claimed)
    const unclaimedVotesRes = await query(
      `SELECT v.novel_id, v.round, n.title AS novel_title
       FROM votes v
       LEFT JOIN novels n ON n.id = v.novel_id
       WHERE v.voter = $1 AND v.revealed = TRUE AND v.claimed = FALSE`,
      [addr],
    );

    const { page, limit, offset } = parsePagination(req.query, {
      defaultLimit: 50,
      maxLimit: 200,
    });

    // Past reward claims (per-row, newest first)
    const claimsRes = await query(
      `SELECT rc.novel_id, rc.source, rc.amount, rc.round,
              rc.block_number, rc.created_at, n.title AS novel_title
       FROM reward_claims rc
       LEFT JOIN novels n ON n.id = rc.novel_id
       WHERE rc.claimant = $1
       ORDER BY rc.created_at DESC
       LIMIT $2 OFFSET $3`,
      [addr, limit, offset],
    );

    // Novels the user participated in (as author or voter)
    const novelsRes = await query(
      `SELECT DISTINCT t.novel_id, n.title AS novel_title FROM (
         SELECT novel_id FROM chapters WHERE author = $1
         UNION
         SELECT novel_id FROM votes WHERE voter = $1
       ) t
       LEFT JOIN novels n ON n.id = t.novel_id
       ORDER BY t.novel_id DESC
       LIMIT 200`,
      [addr],
    );

    res.json({
      unclaimedVotes: unclaimedVotesRes.rows,
      rewardClaims: claimsRes.rows,
      participatedNovels: novelsRes.rows.map((r) => ({
        novel_id: r.novel_id,
        novel_title: r.novel_title || "",
      })),
      pagination: { page, limit },
    });
  } catch (err) {
    log.error({ err }, "GET /api/users/:address/rewards error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/users/:address/chapters — User's submitted chapters (paginated)
router.get("/:address/chapters", validateAddress, async (req, res) => {
  try {
    const { address } = req.params as { address: string };
    const addr = address.toLowerCase();
    const { page, limit, offset } = parsePagination(req.query, {
      defaultLimit: 50,
      maxLimit: 200,
    });

    const [chaptersRes, countRes] = await Promise.all([
      query(
        `SELECT c.id, c.novel_id, c.depth, c."timestamp",
                c.is_world_line, c.created_at, n.title AS novel_title,
                (SELECT COUNT(*) FROM comments cm WHERE cm.chapter_id = c.id)::int AS comment_count,
                (SELECT COUNT(*) FROM votes v WHERE v.candidate_id = c.id AND v.revealed = TRUE)::int AS vote_count
         FROM chapters c
         LEFT JOIN novels n ON n.id = c.novel_id
         WHERE c.author = $1
         ORDER BY c.created_at DESC
         LIMIT $2 OFFSET $3`,
        [addr, limit, offset],
      ),
      query(`SELECT COUNT(*)::int AS n FROM chapters WHERE author = $1`, [addr]),
    ]);

    res.json({
      chapters: chaptersRes.rows,
      pagination: { page, limit, total: countRes.rows[0]?.n ?? 0 },
    });
  } catch (err) {
    log.error({ err }, "GET /api/users/:address/chapters error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/users/:address/nickname — User nickname
router.get("/:address/nickname", validateAddress, async (req, res) => {
  try {
    const { address } = req.params as { address: string };
    const result = await query("SELECT nickname FROM nicknames WHERE address = $1", [
      address.toLowerCase(),
    ]);
    res.json({ nickname: result.rows[0]?.nickname ?? null });
  } catch (err) {
    log.error({ err }, "GET /api/users/:address/nickname error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
