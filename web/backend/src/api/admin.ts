import { Router } from "express";

import { query } from "../db/index.js";
import { createLogger } from "../utils/logger.js";
import { validateIdParams } from "../utils/validate.js";

const log = createLogger("api:admin");
const router = Router();

// ── localhost guard ──────────────────────────────────────────────────────────

function localhostOnly(req: import("express").Request, res: import("express").Response, next: import("express").NextFunction): void {
  const ip = req.ip || req.socket.remoteAddress || "";
  if (ip === "127.0.0.1" || ip === "::ffff:127.0.0.1" || ip === "::1") return next();
  log.warn({ ip }, "Admin endpoint rejected non-localhost caller");
  res.status(403).json({ error: "admin endpoints are localhost-only" });
}

router.use(localhostOnly);

// ── routes ─────────────────────────────────────────────────────────────────────

// DELETE /api/admin/novels/:id — hide novel + chapters from frontend
// Two separate queries (not a transaction) — acceptable for dev-stage admin tooling.
router.delete("/novels/:id", validateIdParams("id"), async (req, res) => {
  try {
    const { id } = req.params;
    const result = await query(
      "UPDATE novels SET deleted = TRUE WHERE id = $1 AND deleted = FALSE RETURNING id",
      [id],
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Novel not found or already deleted" });
    }
    await query("UPDATE chapters SET deleted = TRUE WHERE novel_id = $1", [id]);
    log.info({ novelId: id }, "Novel soft-deleted");
    res.json({ deleted: id });
  } catch (err) {
    log.error({ err }, "DELETE /api/admin/novels/:id error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/admin/novels/:id/restore
router.post("/novels/:id/restore", validateIdParams("id"), async (req, res) => {
  try {
    const { id } = req.params;
    const result = await query(
      "UPDATE novels SET deleted = FALSE WHERE id = $1 AND deleted = TRUE RETURNING id",
      [id],
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: "Novel not found or not deleted" });
    }
    await query("UPDATE chapters SET deleted = FALSE WHERE novel_id = $1", [id]);
    log.info({ novelId: id }, "Novel restored");
    res.json({ restored: id });
  } catch (err) {
    log.error({ err }, "POST /api/admin/novels/:id/restore error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
