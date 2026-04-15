import { Router } from "express";

import { query } from "../db/index.js";
import { createLogger } from "../utils/logger.js";
import { parsePagination, validateIdParams } from "../utils/validate.js";

const log = createLogger("api:rules");
const router = Router();

// Validate any :id / :novelId style param before it hits the DB.
router.use("/novels/:id/rules", validateIdParams("id"));
router.use("/novels/:id/rule-proposals", validateIdParams("id"));
router.use("/rule-proposals/:id", validateIdParams("id"));

// GET /api/novels/:id/rules — all rules for a novel
router.get("/novels/:id/rules", async (req, res) => {
  try {
    const novelId = req.params.id;
    const result = await query(
      "SELECT name, content FROM rules WHERE novel_id = $1 ORDER BY name",
      [novelId],
    );
    res.json(result.rows);
  } catch (err) {
    log.error({ err }, "GET /api/novels/:id/rules error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/novels/:id/rule-proposals — list proposals for a novel
router.get("/novels/:id/rule-proposals", async (req, res) => {
  try {
    const novelId = req.params.id;
    const status = req.query.status as string | undefined;
    const { page, limit, offset } = parsePagination(req.query);

    let where = "WHERE novel_id = $1";
    if (status === "active") {
      where += " AND executed = FALSE";
    } else if (status === "executed") {
      where += " AND executed = TRUE";
    }

    const result = await query(
      `SELECT * FROM rule_proposals ${where} ORDER BY id DESC LIMIT $2 OFFSET $3`,
      [novelId, limit, offset],
    );
    res.json(result.rows);
  } catch (err) {
    log.error({ err }, "GET /api/novels/:id/rule-proposals error");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/rule-proposals/:id — single proposal with votes
router.get("/rule-proposals/:id", async (req, res) => {
  try {
    const proposalId = req.params.id;
    const proposalRes = await query("SELECT * FROM rule_proposals WHERE id = $1", [proposalId]);
    if (proposalRes.rows.length === 0) {
      return res.status(404).json({ error: "Proposal not found" });
    }

    const votesRes = await query(
      "SELECT voter, block_number FROM rule_proposal_votes WHERE proposal_id = $1 ORDER BY block_number",
      [proposalId],
    );

    res.json({ ...proposalRes.rows[0], votes: votesRes.rows });
  } catch (err) {
    log.error({ err }, "GET /api/rule-proposals/:id error");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
