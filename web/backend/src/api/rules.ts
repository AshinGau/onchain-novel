import { Router } from "express";
import { query } from "../db/index.js";
import { safeInt } from "../utils/validate.js";

const router = Router();

// GET /api/novels/:id/rules — all rules for a novel
router.get("/novels/:id/rules", async (req, res) => {
  try {
    const novelId = req.params.id;
    const result = await query(
      "SELECT name, content FROM rules WHERE novel_id = $1 ORDER BY name",
      [novelId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error("GET /api/novels/:id/rules error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/novels/:id/rule-proposals — list proposals for a novel
router.get("/novels/:id/rule-proposals", async (req, res) => {
  try {
    const novelId = req.params.id;
    const status = req.query.status as string | undefined;
    const page = safeInt(req.query.page, 1, 1, 1000);
    const limit = safeInt(req.query.limit, 20, 1, 50);
    const offset = (page - 1) * limit;

    let where = "WHERE novel_id = $1";
    const params: any[] = [novelId];

    if (status === "active") {
      where += " AND executed = FALSE";
    } else if (status === "executed") {
      where += " AND executed = TRUE";
    }

    const result = await query(
      `SELECT * FROM rule_proposals ${where} ORDER BY id DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    );
    res.json(result.rows);
  } catch (err) {
    console.error("GET /api/novels/:id/rule-proposals error:", err);
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
      [proposalId]
    );

    res.json({ ...proposalRes.rows[0], votes: votesRes.rows });
  } catch (err) {
    console.error("GET /api/rule-proposals/:id error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
