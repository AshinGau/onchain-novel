import { Router } from "express";
import { query } from "../db/index.js";
import { verifyWallet } from "../utils/auth.js";
import { validateAddress, safeInt } from "../utils/validate.js";

const router = Router();

// Validate address on all routes
router.use("/:address", validateAddress);
router.use("/:address/*", validateAddress);

// GET /api/notifications/:address — Get user's notifications (personal + broadcasts for their novels)
router.get("/:address", async (req, res) => {
  try {
    const { address } = req.params;
    const addr = address.toLowerCase();
    const page = safeInt(req.query.page, 1, 1, 1000);
    const limit = safeInt(req.query.limit, 20, 1, 50);
    const offset = (page - 1) * limit;
    const unreadOnly = req.query.unread === "true";

    // Get novels the user participates in (for broadcast notifications)
    const participatedRes = await query(
      `SELECT DISTINCT novel_id FROM (
         SELECT novel_id FROM chapters WHERE LOWER(author) = $1
         UNION
         SELECT novel_id FROM votes WHERE LOWER(voter) = $1
         UNION
         SELECT novel_id FROM tips WHERE LOWER(tipper) = $1
       ) t`,
      [addr]
    );
    const participatedIds = participatedRes.rows.map(r => r.novel_id);

    let where = `(LOWER(recipient) = $1`;
    const params: unknown[] = [addr];
    let paramIdx = 2;

    if (participatedIds.length > 0) {
      where += ` OR (recipient IS NULL AND novel_id = ANY($${paramIdx++}))`;
      params.push(participatedIds);
    }
    where += `)`;

    if (unreadOnly) {
      where += ` AND read = FALSE`;
    }

    const countRes = await query(
      `SELECT COUNT(*) FROM notifications WHERE ${where}`,
      params
    );

    const notifRes = await query(
      `SELECT * FROM notifications WHERE ${where}
       ORDER BY created_at DESC
       LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
      [...params, limit, offset]
    );

    res.json({
      notifications: notifRes.rows,
      total: parseInt(countRes.rows[0].count),
      unreadCount: unreadOnly ? parseInt(countRes.rows[0].count) : undefined,
    });
  } catch (err) {
    console.error("GET /api/notifications/:address error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/notifications/:address/unread-count
router.get("/:address/unread-count", async (req, res) => {
  try {
    const { address } = req.params;
    const addr = address.toLowerCase();

    const participatedRes = await query(
      `SELECT DISTINCT novel_id FROM (
         SELECT novel_id FROM chapters WHERE LOWER(author) = $1
         UNION
         SELECT novel_id FROM votes WHERE LOWER(voter) = $1
         UNION
         SELECT novel_id FROM tips WHERE LOWER(tipper) = $1
       ) t`,
      [addr]
    );
    const participatedIds = participatedRes.rows.map(r => r.novel_id);

    let where = `(LOWER(recipient) = $1`;
    const params: unknown[] = [addr];
    let paramIdx = 2;

    if (participatedIds.length > 0) {
      where += ` OR (recipient IS NULL AND novel_id = ANY($${paramIdx++}))`;
      params.push(participatedIds);
    }
    where += `) AND read = FALSE`;

    const countRes = await query(`SELECT COUNT(*) FROM notifications WHERE ${where}`, params);
    res.json({ count: parseInt(countRes.rows[0].count) });
  } catch (err) {
    console.error("GET /api/notifications/:address/unread-count error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/notifications/:address/mark-read — Mark notifications as read
router.post("/:address/mark-read", verifyWallet, async (req, res) => {
  try {
    const address = req.params.address as string;
    const verifiedAddress = req.verifiedAddress as string;
    if (verifiedAddress !== address.toLowerCase()) {
      return res.status(403).json({ error: "Address mismatch" });
    }
    const addr = address.toLowerCase();
    const { ids } = req.body; // optional: specific notification IDs

    if (ids && Array.isArray(ids) && ids.length > 0) {
      // Mark specific notifications by ID (works for both personal and broadcast)
      await query(
        "UPDATE notifications SET read = TRUE WHERE id = ANY($1) AND read = FALSE",
        [ids]
      );
    } else {
      // Mark all: personal by recipient + broadcast by novel participation
      const participatedRes = await query(
        `SELECT DISTINCT novel_id FROM (
           SELECT novel_id FROM chapters WHERE LOWER(author) = $1
           UNION SELECT novel_id FROM votes WHERE LOWER(voter) = $1
           UNION SELECT novel_id FROM tips WHERE LOWER(tipper) = $1
         ) t`, [addr]
      );
      const novelIds = participatedRes.rows.map(r => r.novel_id);

      await query(
        "UPDATE notifications SET read = TRUE WHERE LOWER(recipient) = $1 AND read = FALSE",
        [addr]
      );
      if (novelIds.length > 0) {
        await query(
          "UPDATE notifications SET read = TRUE WHERE recipient IS NULL AND novel_id = ANY($1) AND read = FALSE",
          [novelIds]
        );
      }
    }

    res.json({ success: true });
  } catch (err) {
    console.error("POST /api/notifications/:address/mark-read error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
